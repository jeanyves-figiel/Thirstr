defmodule ThirstrWeb.UserSocket do
  @moduledoc "Realtime (api.md › Realtime). Auth with the access token in connect params."
  use Phoenix.Socket

  channel "user:me", ThirstrWeb.UserChannel
  channel "party:*", ThirstrWeb.SceneChannel
  channel "venue:*", ThirstrWeb.SceneChannel

  @impl true
  def connect(%{"token" => token}, socket, _info) when is_binary(token) do
    case Thirstr.Accounts.authenticate_access(token) do
      {:ok, a, device_id} when a.status not in ~w(banned deleted) ->
        {:ok, assign(socket, account_id: a.id, device_id: device_id)}

      _ ->
        :error
    end
  end

  def connect(_, _, _), do: :error

  @impl true
  def id(socket), do: "socket:" <> socket.assigns.device_id
end
