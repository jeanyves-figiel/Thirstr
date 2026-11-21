defmodule ThirstrWeb.SceneController do
  @moduledoc "B3: Tonight (F-09), parties (F-10), activities & clubs (F-11), venues (F-12)."
  use ThirstrWeb, :controller

  alias Thirstr.{Activities, Nearby, Parties, Tonight, Venues}

  action_fallback ThirstrWeb.FallbackController

  @modes ~w(hookup sport friends)

  defp ctx(conn, params) do
    mode = params["mode"] || "hookup"

    if mode in @modes,
      do: {:ok, Nearby.ctx(conn.assigns.account, mode)},
      else: {:error, {:validation, %{mode: ["hookup, sport or friends"]}}}
  end

  defp hookup(conn), do: Nearby.ctx(conn.assigns.account, "hookup")
  defp sport(conn), do: Nearby.ctx(conn.assigns.account, "sport")

  defp reply({:ok, res}, conn), do: json(conn, res)
  defp reply(:ok, conn), do: send_resp(conn, 204, "")
  defp reply(e, _conn), do: e

  # --- Tonight
  def tonight(conn, p), do: with({:ok, c} <- ctx(conn, p), do: Tonight.list(c, p) |> reply(conn))

  def create_plan(conn, p),
    do:
      with(
        {:ok, c} <- ctx(conn, p),
        {:ok, r} <- Tonight.create(c, p),
        do: conn |> put_status(201) |> json(r)
      )

  def delete_plan(conn, %{"id" => id}), do: Tonight.delete(hookup(conn), id) |> reply(conn)

  # --- Parties
  def parties(conn, _), do: Parties.list(hookup(conn)) |> reply(conn)

  def create_party(conn, p),
    do: with({:ok, r} <- Parties.create(hookup(conn), p), do: conn |> put_status(201) |> json(r))

  def party(conn, %{"id" => id} = p), do: Parties.get(hookup(conn), id, p["code"]) |> reply(conn)

  def update_party(conn, %{"id" => id} = p),
    do: Parties.update(hookup(conn), id, p) |> reply(conn)

  def request_party(conn, %{"id" => id} = p),
    do: Parties.request(hookup(conn), id, p["code"]) |> reply(conn)

  def leave_party(conn, %{"id" => id}), do: Parties.leave(hookup(conn), id) |> reply(conn)

  def rate_party(conn, %{"id" => id} = p),
    do: Parties.rate(hookup(conn), id, p["up"]) |> reply(conn)

  def report_party(conn, %{"id" => id} = p),
    do: Parties.report(hookup(conn), id, p["reason"]) |> reply(conn)

  def party_request_action(conn, %{"id" => id, "profile_id" => pid, "action" => action}) do
    c = hookup(conn)

    case action do
      "accept" -> Parties.accept(c, id, pid)
      "decline" -> Parties.decline(c, id, pid)
      "remove" -> Parties.remove(c, id, pid)
      _ -> {:error, :not_found}
    end
    |> reply(conn)
  end

  # --- Activities & clubs
  def activities(conn, p), do: Activities.list(sport(conn), p) |> reply(conn)

  def create_activity(conn, p),
    do:
      with({:ok, r} <- Activities.create(sport(conn), p), do: conn |> put_status(201) |> json(r))

  def rsvp(conn, %{"id" => id} = p),
    do: Activities.rsvp(sport(conn), id, p["join"] != false) |> reply(conn)

  def activity_members(conn, %{"id" => id}),
    do: Activities.members(sport(conn), id) |> reply(conn)

  def remove_member(conn, %{"id" => id, "profile_id" => pid}),
    do: Activities.remove(sport(conn), id, pid) |> reply(conn)

  def delete_activity(conn, %{"id" => id}), do: Activities.delete(sport(conn), id) |> reply(conn)

  def clubs(conn, _), do: Activities.list_clubs(sport(conn)) |> reply(conn)

  def create_club(conn, p),
    do:
      with(
        {:ok, r} <- Activities.create_club(sport(conn), p),
        do: conn |> put_status(201) |> json(r)
      )

  def club(conn, %{"id" => id}), do: Activities.get_club(sport(conn), id) |> reply(conn)
  def join_club(conn, %{"id" => id}), do: Activities.join_club(sport(conn), id) |> reply(conn)
  def leave_club(conn, %{"id" => id}), do: Activities.leave_club(sport(conn), id) |> reply(conn)

  def club_admin(conn, %{"id" => id, "profile_id" => pid, "action" => action}),
    do: Activities.admin(sport(conn), id, pid, action) |> reply(conn)

  # --- Venues
  @doc "GET /places (#113, F-04 R-04.20): place layers for the viewport."
  def places(conn, p),
    do: Thirstr.Places.list(hookup(conn), p["bbox"], p["kinds"]) |> reply(conn)

  def venues(conn, p), do: with({:ok, c} <- ctx(conn, p), do: Venues.nearby(c) |> reply(conn))

  def create_venue(conn, p),
    do: with({:ok, c} <- ctx(conn, p), do: Venues.create(c, p) |> reply(conn))

  def remove_venue(conn, %{"id" => id}), do: Venues.remove(hookup(conn), id) |> reply(conn)

  def checkin(conn, %{"id" => id} = p),
    do: with({:ok, c} <- ctx(conn, p), do: Venues.checkin(c, id, p) |> reply(conn))

  def update_checkin(conn, %{"id" => id} = p),
    do: Venues.update_checkin(hookup(conn), id, p) |> reply(conn)

  def checkout(conn, _), do: Venues.checkout(hookup(conn)) |> reply(conn)
  def here(conn, %{"id" => id}), do: Venues.here(hookup(conn), id) |> reply(conn)
end
