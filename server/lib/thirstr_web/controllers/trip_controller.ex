defmodule ThirstrWeb.TripController do
  @moduledoc "F-20 travel plans (#188): own trips (S-72, S-73)."
  use ThirstrWeb, :controller

  alias Thirstr.{Social, Trips}

  action_fallback ThirstrWeb.FallbackController

  def index(conn, _) do
    a = conn.assigns.account
    json(conn, %{trips: Trips.list(a), limits: Trips.limits(a)})
  end

  def create(conn, params) do
    with {:ok, _} <- Social.limit(conn.assigns.account, "trip_w", 30, 3600),
         {:ok, trip} <- Trips.create(conn.assigns.account, params) do
      conn |> put_status(201) |> json(trip)
    end
  end

  def update(conn, %{"id" => id} = params) do
    with {:ok, _} <- Social.limit(conn.assigns.account, "trip_w", 30, 3600),
         {:ok, trip} <- Trips.update(conn.assigns.account, id, Map.delete(params, "id")) do
      json(conn, trip)
    end
  end

  def delete(conn, %{"id" => id}) do
    with :ok <- Trips.delete(conn.assigns.account, id), do: send_resp(conn, 204, "")
  end
end
