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

  #221 live rings: `moments.watch {ids, intents}` (≤ 60 profiles on screen) subscribes to those
  profiles' Moments topics; when one changes, the viewer gets `moments.ring {profile_id, moments}`
  with the same badge as on cards, and only when his own view of it changed (so a Moment he may
  not see never produces an event).
  """
  use Phoenix.Channel
  alias Thirstr.{Chat, Delivery, Moments, Notify, Repo, Settings, Social}
  alias Thirstr.Accounts.Account

  @impl true
  def join("user:me", params, socket) do
    t0 = System.monotonic_time(:millisecond)
    :ok = Phoenix.PubSub.subscribe(Thirstr.PubSub, Notify.topic(socket.assigns.account_id))
    env? = params["env"] == true

    if env? do
      :ok = Phoenix.PubSub.subscribe(Thirstr.PubSub, Chat.device_topic(socket.assigns.device_id))
      # EN-23 OB-1: this device is online for delivery metrics while this process lives.
      Delivery.join_live(socket.assigns.device_id)
      send(self(), :seen)
    end

    Delivery.socket_joined(env?, System.monotonic_time(:millisecond) - t0)

    {:ok,
     socket |> assign(:env, env?) |> assign(:rings, %{}) |> assign(:ring_intents, ["hookup"])}
  end

  @impl true
  def terminate(reason, _socket) do
    Delivery.socket_closed(reason)
    :ok
  end

  # EN-23 OB-1: a pending push for this device woke it (off the join path).
  @impl true
  def handle_info(:seen, socket) do
    Delivery.device_seen(socket.assigns.device_id)
    {:noreply, socket}
  end

  def handle_info({:event, "message.new", _}, %{assigns: %{env: true}} = socket),
    do: {:noreply, socket}

  def handle_info({:moments, pid}, %{assigns: %{rings: rings}} = socket)
      when is_map_key(rings, pid) do
    with %Account{} = a <- Repo.get(Account, socket.assigns.account_id),
         badge = Map.get(Moments.rings(a, [pid], socket.assigns.ring_intents), pid),
         true <- badge != rings[pid] do
      push(socket, "moments.ring", %{profile_id: pid, moments: badge})
      {:noreply, assign(socket, :rings, Map.put(rings, pid, badge))}
    else
      _ -> {:noreply, socket}
    end
  end

  def handle_info({:moments, _}, socket), do: {:noreply, socket}

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
    {:ok, n} =
      Chat.ack(%Account{id: socket.assigns.account_id}, socket.assigns.device_id, ids, "socket")

    {:reply, {:ok, %{acked: n}}, socket}
  end

  def handle_in("moments.watch", %{"ids" => ids} = p, socket) when is_list(ids) do
    ids =
      ids |> Enum.filter(&match?({:ok, _}, Ecto.UUID.cast(&1))) |> Enum.uniq() |> Enum.take(60)

    intents = Enum.filter(List.wrap(p["intents"]), &(&1 in ~w(hookup friends sport)))
    intents = if intents == [], do: ["hookup"], else: intents
    a = Repo.get(Account, socket.assigns.account_id)

    case a && Social.limit(a, "moments_watch", 30, 60) do
      {:ok, _} ->
        old = Map.keys(socket.assigns.rings)
        for id <- old -- ids, do: Phoenix.PubSub.unsubscribe(Thirstr.PubSub, Moments.topic(id))
        for id <- ids -- old, do: Phoenix.PubSub.subscribe(Thirstr.PubSub, Moments.topic(id))
        rings = if ids == [], do: %{}, else: Moments.rings(a, ids, intents)
        {:reply, :ok, socket |> assign(:rings, rings) |> assign(:ring_intents, intents)}

      _ ->
        {:reply, {:error, %{reason: "rate_limited"}}, socket}
    end
  end

  def handle_in(_, _, socket), do: {:noreply, socket}
end
