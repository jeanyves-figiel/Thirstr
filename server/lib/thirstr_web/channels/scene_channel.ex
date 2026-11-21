defmodule ThirstrWeb.SceneChannel do
  @moduledoc """
  `party:{id}` seat meter (R-10.6) and `venue:{id}` here.diff (R-12.3). Joining needs the same
  access as the REST read: party visible to the viewer, or checked in at the venue (AC-12.1).
  """
  use Phoenix.Channel
  alias Thirstr.{Nearby, Parties, Repo, Venues}
  alias Thirstr.Accounts.Account

  @impl true
  def join("party:" <> id = topic, _params, socket) do
    with %Account{} = a <- Repo.get(Account, socket.assigns.account_id),
         true <- Parties.can_watch?(a, id) do
      :ok = Phoenix.PubSub.subscribe(Thirstr.PubSub, topic)
      {:ok, socket}
    else
      _ -> {:error, %{reason: "forbidden"}}
    end
  end

  def join("venue:" <> id = topic, _params, socket) do
    with %Account{} = a <- Repo.get(Account, socket.assigns.account_id),
         true <- Venues.checked_in?(Nearby.ctx(a), id) do
      :ok = Phoenix.PubSub.subscribe(Thirstr.PubSub, topic)
      {:ok, socket}
    else
      _ -> {:error, %{reason: "forbidden"}}
    end
  end

  @impl true
  def handle_info({:event, event, payload}, socket) do
    push(socket, event, payload)
    {:noreply, socket}
  end
end
