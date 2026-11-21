defmodule ThirstrWeb.ExploreController do
  @moduledoc "F-04 Explore (S-10 map, S-11 grid, tray), F-05 location & visibility, F-09 Now, F-17 settings."
  use ThirstrWeb, :controller

  alias Thirstr.{Explore, Location, Settings, Social, Trips}
  alias ThirstrWeb.MeJSON

  action_fallback ThirstrWeb.FallbackController

  @modes ~w(hookup sport friends)

  def grid(conn, params) do
    with {:ok, v} <- viewer(conn, params) do
      json(conn, Explore.grid(v, Explore.parse_filters(params), params["cursor"]))
    end
  end

  def tray(conn, params) do
    with {:ok, v} <- viewer(conn, params) do
      json(conn, %{items: Explore.tray(v, Explore.parse_filters(params))})
    end
  end

  def summary(conn, params) do
    intents = Explore.parse_intents(params["intents"])
    mode = if intents, do: hd(intents), else: params["mode"] || "hookup"

    with true <- mode in @modes || {:error, {:validation, %{mode: ["hookup, sport or friends"]}}},
         {:ok, trip} <- trip_point(conn, params) do
      json(
        conn,
        Explore.summary(conn.assigns.account, mode, Explore.parse_filters(params), intents, trip)
      )
    end
  end

  @doc "F-20 GET /explore/visitors: listed visitors (map bubble, See all)."
  def visitors(conn, params) do
    with {:ok, v} <- viewer(conn, params) do
      filters = Explore.parse_filters(params)
      rows = Explore.visitors(v, filters)
      center = with [r | _] <- rows, do: Trips.city_center(r.trip.city, r.trip.country)

      json(conn, %{
        count: length(rows),
        center: if(is_map(center), do: center),
        items: rows |> Enum.take(60) |> Enum.map(&Explore.card(&1, v))
      })
    end
  end

  def map(conn, params) do
    with {:ok, v} <- viewer(conn, params),
         {:ok, res} <- Explore.map(v, params["bbox"], Explore.parse_filters(params)) do
      json(conn, res)
    end
  end

  # R-04.18 (#113): `intents` (merged map) wins over the legacy single `mode`.
  defp viewer(conn, params) do
    intents = Explore.parse_intents(params["intents"])
    mode = if intents, do: hd(intents), else: params["mode"] || "hookup"

    with true <- mode in @modes || {:error, {:validation, %{mode: ["hookup, sport or friends"]}}},
         {:ok, trip} <- trip_point(conn, params) do
      {:ok, Explore.viewer(conn.assigns.account, mode, intents) |> Explore.with_trip(trip)}
    end
  end

  # F-20 R-20.15: `trip_id` = look around that (own) trip's city.
  defp trip_point(_conn, %{"trip_id" => id}) when id in [nil, ""], do: {:ok, nil}
  defp trip_point(conn, %{"trip_id" => id}), do: Trips.point(conn.assigns.account, id)
  defp trip_point(_conn, _), do: {:ok, nil}

  # --- location (F-05)

  def location(conn, params) do
    a = conn.assigns.account

    with {:ok, _} <- rate(conn, "loc", 120, 3600),
         {:ok, _} <-
           if(a.onboarding_step == "location",
             do: Thirstr.Onboarding.set_location(a, params),
             else: Location.put(a, params)
           ),
         do: me(conn)
  end

  def pin(conn, params) do
    with {:ok, _} <- rate(conn, "pin", 6, 3600),
         {:ok, _} <- Location.set_pin(conn.assigns.account, params),
         do: me(conn)
  end

  def unpin(conn, _) do
    Location.clear_pins(conn.assigns.account)
    me(conn)
  end

  def visibility(conn, params) do
    with {:ok, _} <- Location.set_visibility(conn.assigns.account, params), do: me(conn)
  end

  # --- Now (F-09)

  def set_now(conn, params) do
    with {:ok, now} <- Social.set_now(conn.assigns.account, params), do: json(conn, now)
  end

  def end_now(conn, _) do
    Social.end_now(conn.assigns.account)
    send_resp(conn, 204, "")
  end

  # --- settings (F-17)

  def settings(conn, _), do: json(conn, Settings.get(conn.assigns.account))

  def update_settings(conn, params) do
    with {:ok, a} <- Settings.update(conn.assigns.account, Map.drop(params, ["format"])),
         do: json(conn, Settings.get(a))
  end

  @doc "F-14: device reports Safe Mode setting + effective state (country detection stays on device)."
  def safe_mode(conn, params) do
    a = conn.assigns.account
    setting = params["setting"]

    cond do
      setting not in [nil | ~w(auto on off)] ->
        {:error, {:validation, %{setting: ["auto, on or off"]}}}

      true ->
        changes =
          [safe_mode: setting || a.safe_mode, safe_mode_active: params["active"] == true]

        a |> Ecto.Changeset.change(changes) |> Thirstr.Repo.update!()
        me(conn)
    end
  end

  defp me(conn),
    do:
      json(conn, MeJSON.me(Thirstr.Repo.get!(Thirstr.Accounts.Account, conn.assigns.account.id)))

  defp rate(conn, bucket, n, window), do: Social.limit(conn.assigns.account, bucket, n, window)
end
