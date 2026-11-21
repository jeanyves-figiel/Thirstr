defmodule ThirstrWeb.UserChannel do
  @moduledoc """
  Private per-account topic. Server → client events carry no content (`message.new` only says
  "pull now"). Client → server: `typing`, relayed only when both sides have receipts on (R-07.7).
  Read receipts travel inside MLS messages, so the server never learns them.

  SR-13 (#153): a client that joins with `%{"env" => true}` gets its own device's envelopes
  pushed (`message.env`, same shape as `GET /mls/messages`) or `message.pull` when they are too
  big, instead of the account-wide `message.new`, and acks over the channel (`ack`, same rule as
  `POST /mls/messages/ack`: only after the message is stored on the phone). REST pull stays the
  fallback (start, foreground, reconnect, backlog).
  """
  use Phoenix.Channel
  alias Thirstr.{Chat, Notify, Repo, Settings, Social}
  alias Thirstr.Accounts.Account

  @impl true
  def join("user:me", params, socket) do
    :ok = Phoenix.PubSub.subscribe(Thirstr.PubSub, Notify.topic(socket.assigns.account_id))
    env? = params["env"] == true

    if env?,
      do:
        :ok =
          Phoenix.PubSub.subscribe(Thirstr.PubSub, Chat.device_topic(socket.assigns.device_id))

    {:ok, assign(socket, :env, env?)}
  end

  @impl true
  def handle_info({:event, "message.new", _}, %{assigns: %{env: true}} = socket),
    do: {:noreply, socket}

  def handle_info({:event, event, payload}, socket) do
    push(socket, event, payload)
    {:noreply, socket}
  end

  @impl true
  def handle_in("typing", %{"from_profile_id" => from, "to_profile_id" => to}, socket) do
    a = Repo.get(Account, socket.assigns.account_id)

    with %Account{} <- a,
         {:ok, _} <- Chat.own_profile(a, from),
         {:ok, t} <- Social.target(a, to),
         true <- Settings.get(a, "read_receipts") and t.settings["read_receipts"] != false,
         {:ok, _} <- Social.limit(a, "typing", 120, 60) do
      Phoenix.PubSub.broadcast(
        Thirstr.PubSub,
        Notify.topic(t.account_id),
        {:event, "typing", %{from_profile_id: from, to_profile_id: to}}
      )
    end

    {:noreply, socket}
  end

  def handle_in("ack", %{"ids" => ids}, socket) when is_list(ids) and length(ids) <= 500 do
    {:ok, n} = Chat.ack(%Account{id: socket.assigns.account_id}, socket.assigns.device_id, ids)
    {:reply, {:ok, %{acked: n}}, socket}
  end

  def handle_in(_, _, socket), do: {:noreply, socket}
end
