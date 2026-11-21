defmodule Thirstr.Location do
  @moduledoc """
  F-05 location levels (subset for onboarding S-04 and Welcome counts).
  The server receives H3 cells computed on device; it never sees coordinates
  except for Exact pins (Valkey, not here).
  """
  import Ecto.Query
  alias Thirstr.Repo
  alias Thirstr.Accounts.Account
  alias Thirstr.Profiles.Profile

  alias Thirstr.Settings
  alias Thirstr.Valkey

  @levels ~w(hidden city area exact)
  @pin_ttls [1800, 3600, 7200, 14_400]
  @pin_audiences ~w(verified chats everyone)
  # R-05.9: implied speed above this between updates is a spoofing flag
  @max_kmh 900

  @doc """
  PUT /me/location. Level is account-wide: every own profile gets the same cell row.
  Hidden/Exact need verification (AC-05.4). The device sends H3 cells, never lat/lng.
  """
  def put(%Account{} = a, %Profile{} = _main, params), do: put(a, params)

  def put(%Account{} = a, %{"level" => level} = params) when level in @levels do
    cond do
      level in ~w(hidden exact) and not Account.verified?(a) ->
        {:error, {:not_verified, "#{String.capitalize(level)} is available after you verify"}}

      level == "exact" and Account.safe_mode_on?(a) and params["safe_mode_override"] != true ->
        {:error, {:safe_mode_blocked, "Exact is off in Safe Mode"}}

      level == "hidden" ->
        with {:ok, r8} <- cell(params["cell_r8"] || parent(params["cell_r9"], 8), 8),
             {:ok, until, back} <- hidden_opts(params) do
          Repo.query!(
            "DELETE FROM location_cells WHERE profile_id IN (SELECT id FROM profiles WHERE account_id = $1)",
            [dump(a.id)]
          )

          clear_pins(a)
          set_viewer_cell(a, r8)
          set_account(a, hidden: true, hidden_until: until, hidden_return: back)
          {:ok, :hidden}
        end

      level in ~w(area exact) ->
        with {:ok, r9} <- cell(params["cell_r9"], 9),
             {:ok, r10} <- precise_cell(a, r9, params) do
          velocity_check(a, r9)
          set_viewer_cell(a, r10 || r9)
          if level == "area", do: clear_pins(a)
          set_account(a, hidden: false, hidden_until: nil, hidden_return: nil)
          upsert_all(a, level, r9, :r9, Map.put(params, "cell_r10", r10))
        end

      level == "city" ->
        with {:ok, r5} <- city_cell(params) do
          clear_pins(a)
          set_viewer_cell(a, r5)
          set_account(a, hidden: false, hidden_until: nil, hidden_return: nil)
          upsert_all(a, "city", r5, :r5, params)
        end
    end
  end

  def put(_, _),
    do: {:error, {:validation, %{level: ["must be one of #{Enum.join(@levels, ", ")}"]}}}

  # #114 R-05.7: "Stay hidden" end (ISO 8601, future, ≤ 48 h; nil = until I switch) and
  # "Then come back as" (city | area, default area). The app applies the return level.
  @max_hidden_s 48 * 3600
  defp hidden_opts(params) do
    back = params["return_level"] || "area"
    now = DateTime.utc_now()

    until =
      case params["until"] do
        nil ->
          {:ok, nil}

        s when is_binary(s) ->
          case DateTime.from_iso8601(s) do
            {:ok, t, _} ->
              d = DateTime.diff(t, now)

              if d > 0 and d <= @max_hidden_s,
                do: {:ok, DateTime.truncate(t, :second)},
                else: :error

            _ ->
              :error
          end

        _ ->
          :error
      end

    cond do
      back not in ~w(city area) ->
        {:error, {:validation, %{return_level: ["must be city or area"]}}}

      until == :error ->
        {:error, {:validation, %{until: ["must be a time in the next 48 hours"]}}}

      true ->
        {:ok, elem(until, 1), back}
    end
  end

  # #197 R-05.13: "Show closer distance" is an account setting (kept while on City / Hidden /
  # Exact). `precise` in the body sets it; without it the stored choice applies. It needs the r10
  # cell inside the sent r9 cell (an old build without cell_r10 just stays at Area). Off in
  # Safe Mode (R-05.10): an explicit `precise: true` there is refused.
  defp precise_cell(a, r9, params) do
    explicit = params["precise"]

    if is_boolean(explicit) and explicit != Settings.get(a, "precise_distance"),
      do: Settings.update(a, %{"precise_distance" => explicit})

    want =
      if is_boolean(explicit), do: explicit, else: Settings.get(a, "precise_distance") == true

    cond do
      not want ->
        {:ok, nil}

      Account.safe_mode_on?(a) ->
        if explicit == true,
          do: {:error, {:safe_mode_blocked, "Closer distance is off in Safe Mode"}},
          else: {:ok, nil}

      is_nil(params["cell_r10"]) and explicit != true ->
        {:ok, nil}

      true ->
        with {:ok, r10} <- cell(params["cell_r10"], 10) do
          if cell_parent(r10, 9) == r9,
            do: {:ok, r10},
            else: {:error, {:validation, %{cell_r10: ["must be inside cell_r9"]}}}
        end
    end
  end

  defp cell_parent(hex, res),
    do:
      Repo.query!("SELECT h3_cell_to_parent($1::text::h3index, $2)::text", [hex, res]).rows
      |> hd()
      |> hd()

  defp set_account(a, changes),
    do: Repo.update_all(from(x in Account, where: x.id == ^a.id), set: changes)

  defp parent(nil, _), do: nil

  defp parent(hex, res) do
    case cell(hex, 9) do
      {:ok, c} ->
        Repo.query!("SELECT h3_cell_to_parent($1::text::h3index, $2)::text", [c, res]).rows
        |> hd()
        |> hd()

      _ ->
        nil
    end
  end

  defp upsert_all(a, level, cell, :r9, params) do
    Repo.query!(
      """
      INSERT INTO location_cells (profile_id, level, cell_r10, precise, cell_r9, cell_r8, cell_r7, cell_r5, hide_from_hidden, updated_at)
      SELECT p.id, $2, $5::text::h3index::bigint, $5 IS NOT NULL, c::bigint, h3_cell_to_parent(c, 8)::bigint, h3_cell_to_parent(c, 7)::bigint,
             h3_cell_to_parent(c, 5)::bigint, COALESCE($4, (SELECT bool_or(hide_from_hidden) FROM location_cells x JOIN profiles y ON y.id = x.profile_id WHERE y.account_id = $1), false), now()
      FROM profiles p, (SELECT $3::text::h3index AS c) s
      WHERE p.account_id = $1
      ON CONFLICT (profile_id) DO UPDATE SET level = EXCLUDED.level, cell_r10 = EXCLUDED.cell_r10,
        precise = EXCLUDED.precise, cell_r9 = EXCLUDED.cell_r9,
        cell_r8 = EXCLUDED.cell_r8, cell_r7 = EXCLUDED.cell_r7, cell_r5 = EXCLUDED.cell_r5,
        -- #197: display at r10 only after the next k-anonymity pass confirms the crowd floor
        display_res = CASE WHEN location_cells.display_res = 10 AND NOT EXCLUDED.precise THEN 9
                           ELSE location_cells.display_res END,
        hide_from_hidden = EXCLUDED.hide_from_hidden, updated_at = now()
      """,
      [dump(a.id), level, cell, bool_or_nil(params["hide_from_hidden"]), params["cell_r10"]]
    )

    {:ok, level}
  end

  defp upsert_all(a, "city", cell, :r5, params) do
    Repo.query!(
      """
      INSERT INTO location_cells (profile_id, level, cell_r9, cell_r8, cell_r7, cell_r5, hide_from_hidden, display_res, updated_at)
      SELECT p.id, 'city', NULL, NULL, NULL, $2::text::h3index::bigint,
             COALESCE($3, (SELECT bool_or(hide_from_hidden) FROM location_cells x JOIN profiles y ON y.id = x.profile_id WHERE y.account_id = $1), false), 5, now()
      FROM profiles p WHERE p.account_id = $1
      ON CONFLICT (profile_id) DO UPDATE SET level = 'city', cell_r10 = NULL, precise = false, cell_r9 = NULL, cell_r8 = NULL, cell_r7 = NULL,
        cell_r5 = EXCLUDED.cell_r5, hide_from_hidden = EXCLUDED.hide_from_hidden, display_res = 5, updated_at = now()
      """,
      [dump(a.id), cell, bool_or_nil(params["hide_from_hidden"])]
    )

    {:ok, "city"}
  end

  defp bool_or_nil(b) when is_boolean(b), do: b
  defp bool_or_nil(_), do: nil

  defp city_cell(%{"city_id" => id}) when is_integer(id) do
    case Repo.query!("SELECT cell_r5::h3index::text FROM cities WHERE id = $1", [id]) do
      %{rows: [[c]]} -> {:ok, c}
      _ -> {:error, {:validation, %{city_id: ["unknown city"]}}}
    end
  end

  defp city_cell(%{"cell_r5" => c}), do: cell(c, 5)
  defp city_cell(_), do: {:error, {:validation, %{city_id: ["can't be blank"]}}}

  @doc "Validates an H3 hex string at the expected resolution."
  def cell(hex, res) when is_binary(hex) do
    if Regex.match?(~r/^[0-9a-f]{15}$/, hex) do
      case Repo.query(
             "SELECT h3_is_valid_cell($1::text::h3index) AND h3_get_resolution($1::text::h3index) = $2",
             [hex, res]
           ) do
        {:ok, %{rows: [[true]]}} -> {:ok, hex}
        _ -> {:error, {:validation, %{"cell_r#{res}" => ["invalid H3 cell"]}}}
      end
    else
      {:error, {:validation, %{"cell_r#{res}" => ["invalid H3 cell"]}}}
    end
  end

  def cell(_, res), do: {:error, {:validation, %{"cell_r#{res}" => ["can't be blank"]}}}

  # ------------------------------------------------------------- viewer cell (own queries)

  # The viewer's own cell for Explore queries. Hidden users have no indexed row (F-05).
  defp set_viewer_cell(a, hex) do
    Valkey.put_term("vcell:" <> a.id, hex, 24 * 3600)
    note_viewer_cell(a, hex)
  end

  # #197 R-05.16 spoof brake: > 20 distinct r9 cells per hour → range buckets only for that hour.
  @brake_cells 20
  defp note_viewer_cell(a, hex) do
    with [[r9]] when is_binary(r9) <-
           Repo.query!(
             "SELECT CASE WHEN h3_get_resolution(c) > 9 THEN h3_cell_to_parent(c, 9) ELSE c END::text FROM (SELECT $1::text::h3index c) s",
             [hex]
           ).rows do
      key = "vcells:#{a.id}:#{div(System.system_time(:second), 3600)}"

      case Valkey.command!([
             "EVAL",
             "redis.call('SADD', KEYS[1], ARGV[1]); redis.call('EXPIRE', KEYS[1], 3700); return redis.call('SCARD', KEYS[1])",
             "1",
             key,
             r9
           ]) do
        n when is_integer(n) and n == @brake_cells + 1 ->
          require Logger
          Logger.warning("location.spoof_brake account=#{a.id}")

        _ ->
          :ok
      end
    end

    :ok
  rescue
    _ -> :ok
  end

  @doc "#197 R-05.16: true when the viewer moved through more than 20 r9 cells this hour."
  def spoof_brake?(%Account{} = a) do
    key = "vcells:#{a.id}:#{div(System.system_time(:second), 3600)}"

    case Valkey.command!(["SCARD", key]) do
      n when is_integer(n) -> n > @brake_cells
      _ -> false
    end
  rescue
    _ -> false
  end

  @doc "{lat, lng, res} the viewer queries from: exact pin, else the cell they last sent."
  def viewer_point(%Account{} = a) do
    with nil <- own_pin(a),
         hex when is_binary(hex) <- viewer_cell(a) do
      [[lat, lng, res]] =
        Repo.query!(
          "SELECT (h3_cell_to_lat_lng(c))[1], (h3_cell_to_lat_lng(c))[0], h3_get_resolution(c) FROM (SELECT $1::text::h3index c) s",
          [hex]
        ).rows

      %{lat: lat, lng: lng, res: res, exact: false, cell: hex}
    else
      # #197 R-05.15: distances are measured from the viewer's r10 cell centre, never his pin.
      %{} = pin -> Map.merge(pin, %{exact: true}) |> Map.merge(snap(pin, 10))
      _ -> nil
    end
  end

  defp snap(%{lat: lat, lng: lng}, res) do
    [[la, lo]] =
      Repo.query!(
        "SELECT (h3_cell_to_lat_lng(c))[1], (h3_cell_to_lat_lng(c))[0] FROM (SELECT h3_lat_lng_to_cell(point($2::float8, $1::float8), $3) c) s",
        [lat * 1.0, lng * 1.0, res]
      ).rows

    %{lat: la, lng: lo}
  end

  def viewer_cell(%Account{} = a) do
    case Valkey.command!(["GET", "vcell:" <> a.id]) do
      nil -> fallback_cell(a)
      bin -> Valkey.decode(bin)
    end
  end

  defp fallback_cell(a) do
    case Repo.query!(
           """
           SELECT COALESCE(lc.cell_r9, lc.cell_r5)::h3index::text FROM location_cells lc
           JOIN profiles p ON p.id = lc.profile_id WHERE p.account_id = $1 LIMIT 1
           """,
           [dump(a.id)]
         ).rows do
      [[c]] -> c
      _ -> nil
    end
  end

  # ------------------------------------------------------------- Exact pins (Valkey only)

  @doc "R-05.4: explicit confirm, TTL 30 min…4 h, jitter 10–20 m re-drawn on each set."
  def set_pin(%Account{} = a, params) do
    ttl = params["ttl_s"]
    audience = params["audience"] || "verified"

    cond do
      not Account.verified?(a) ->
        {:error, {:not_verified, "Exact is available after you verify"}}

      Account.safe_mode_on?(a) and params["safe_mode_override"] != true ->
        {:error, {:safe_mode_blocked, "Exact is off in Safe Mode"}}

      params["confirm"] != true ->
        {:error, {:validation, %{confirm: ["confirm sharing your exact position"]}}}

      ttl not in @pin_ttls ->
        {:error, {:validation, %{ttl_s: ["must be 30 min, 1 h, 2 h or 4 h"]}}}

      audience not in @pin_audiences ->
        {:error, {:validation, %{audience: ["invalid"]}}}

      not valid_coord?(params["lat"], params["lng"]) ->
        {:error, {:validation, %{lat: ["invalid coordinates"]}}}

      true ->
        {lat, lng} = jitter(params["lat"], params["lng"])

        %{rows: [[r9]]} =
          Repo.query!("SELECT h3_lat_lng_to_cell(point($1::float8, $2::float8), 9)::text", [
            lng,
            lat
          ])

        with {:ok, _} <-
               put(a, %{"level" => "exact", "cell_r9" => r9, "safe_mode_override" => true}) do
          expires = DateTime.add(DateTime.utc_now(), ttl, :second)

          pin = %{
            lat: lat,
            lng: lng,
            audience: audience,
            expires_at: DateTime.to_iso8601(expires)
          }

          for pid <- pin_profile_ids(a) do
            Valkey.put_term("pin:" <> pid, pin, ttl)
          end

          Valkey.put_term("ownpin:" <> a.id, pin, ttl)
          {:ok, pin}
        end
    end
  end

  def clear_pins(%Account{} = a) do
    keys = ["ownpin:" <> a.id | Enum.map(pin_profile_ids(a), &("pin:" <> &1))]
    Valkey.command!(["DEL" | keys])

    Repo.query!(
      "UPDATE location_cells SET level = 'area' WHERE level = 'exact' AND profile_id IN (SELECT id FROM profiles WHERE account_id = $1)",
      [dump(a.id)]
    )

    :ok
  end

  defp own_pin(a) do
    case Valkey.command!(["GET", "ownpin:" <> a.id]) do
      nil -> nil
      bin -> Valkey.decode(bin) |> Map.take([:lat, :lng]) |> Map.put(:res, 15)
    end
  end

  def own_pin_info(a) do
    case Valkey.command!(["GET", "ownpin:" <> a.id]) do
      nil -> nil
      bin -> Valkey.decode(bin)
    end
  end

  # Sport mode never shows pins (R-11.9).
  defp pin_profile_ids(a) do
    Repo.query!("SELECT id::text FROM profiles WHERE account_id = $1 AND kind <> 'sport'", [
      dump(a.id)
    ]).rows
    |> List.flatten()
  end

  @doc "Pins for a list of profile ids (MGET). Returns %{profile_id => pin}."
  def pins(ids) when ids == [], do: %{}

  def pins(ids) do
    ids
    |> Enum.zip(Valkey.command!(["MGET" | Enum.map(ids, &("pin:" <> &1))]))
    |> Enum.flat_map(fn
      {_, nil} -> []
      {id, bin} -> [{id, Valkey.decode(bin)}]
    end)
    |> Map.new()
  end

  defp valid_coord?(lat, lng),
    do:
      is_number(lat) and is_number(lng) and lat >= -85 and lat <= 85 and lng >= -180 and
        lng <= 180

  defp jitter(lat, lng) do
    d = 10 + :rand.uniform() * 10
    theta = :rand.uniform() * 2 * :math.pi()
    dlat = d * :math.cos(theta) / 111_320
    dlng = d * :math.sin(theta) / (111_320 * :math.cos(lat * :math.pi() / 180))
    {lat + dlat, lng + dlng}
  end

  # ------------------------------------------------------------- visibility toggles

  @doc "PATCH /me/visibility: hide_from_hidden (R-05.6). Incognito is gone (#114): use Hidden."
  def set_visibility(%Account{} = a, params) do
    cond do
      params["incognito"] == true ->
        {:error,
         {:validation, %{incognito: ["Incognito is now Hidden: set location level to hidden"]}}}

      true ->
        if is_boolean(params["hide_from_hidden"]) do
          Repo.query!(
            "UPDATE location_cells SET hide_from_hidden = $2 WHERE profile_id IN (SELECT id FROM profiles WHERE account_id = $1)",
            [dump(a.id), params["hide_from_hidden"]]
          )

          Valkey.put_term("hfh:" <> a.id, params["hide_from_hidden"], 30 * 24 * 3600)
        end

        {:ok, Repo.get!(Account, a.id)}
    end
  end

  def hide_from_hidden?(%Account{} = a) do
    case Valkey.command!(["GET", "hfh:" <> a.id]) do
      nil -> false
      bin -> Valkey.decode(bin)
    end
  end

  # ------------------------------------------------------------- R-05.9 velocity

  defp velocity_check(a, r9) do
    now = System.system_time(:second)

    case Valkey.command!(["GET", "lastcell:" <> a.id]) do
      nil ->
        :ok

      bin ->
        {prev, t} = Valkey.decode(bin)
        dt_h = max(now - t, 1) / 3600

        %{rows: [[km]]} =
          Repo.query!(
            "SELECT h3_great_circle_distance(h3_cell_to_lat_lng($1::text::h3index), h3_cell_to_lat_lng($2::text::h3index), 'km')",
            [prev, r9]
          )

        # cell-size noise: ignore moves under 5 km
        if km > 5 and km / dt_h > @max_kmh, do: Thirstr.Signals.record(a, :velocity)
    end

    Valkey.put_term("lastcell:" <> a.id, {r9, now}, 24 * 3600)
  end

  # ------------------------------------------------------------- R-05.2 k-anonymity

  @doc """
  Every minute: display at r9 only with ≥ 5 visible profiles in the cell, else r8, else r7.
  #197 R-05.14: a precise profile shows at r10 when its r9 cell has ≥ 3 visible profiles.
  """
  @precise_floor 3
  def refresh_k_anonymity(k \\ 5) do
    Repo.query!(
      """
      WITH vis AS (
        SELECT lc.profile_id, lc.cell_r9, lc.cell_r8, p.kind, lc.precise AND lc.cell_r10 IS NOT NULL AS precise
        FROM location_cells lc
        JOIN profiles p ON p.id = lc.profile_id JOIN accounts a ON a.id = p.account_id
        WHERE lc.level <> 'city' AND a.status = 'active' AND NOT a.hidden
      ), c9 AS (SELECT kind, cell_r9, count(*) n FROM vis GROUP BY 1, 2),
         c8 AS (SELECT kind, cell_r8, count(*) n FROM vis GROUP BY 1, 2)
      UPDATE location_cells lc SET display_res = CASE
          WHEN vis.precise AND c9.n >= $2 THEN 10
          WHEN c9.n >= $1 THEN 9 WHEN c8.n >= $1 THEN 8 ELSE 7 END
      FROM vis
      JOIN c9 ON c9.kind = vis.kind AND c9.cell_r9 = vis.cell_r9
      JOIN c8 ON c8.kind = vis.kind AND c8.cell_r8 = vis.cell_r8
      WHERE lc.profile_id = vis.profile_id
        -- SR-08: write only rows whose resolution changes (no full-table rewrite every minute)
        AND lc.display_res IS DISTINCT FROM
            (CASE WHEN vis.precise AND c9.n >= $2 THEN 10
                  WHEN c9.n >= $1 THEN 9 WHEN c8.n >= $1 THEN 8 ELSE 7 END)
      """,
      [k, @precise_floor]
    )

    :ok
  end

  # ------------------------------------------------------------- cities & welcome

  def search_cities(q) when is_binary(q) and byte_size(q) >= 2 do
    # F-20: accent-insensitive prefix match, biggest cities first.
    pattern = Thirstr.Cities.key(q) |> String.replace(~r/[%_\\]/, "") |> Kernel.<>("%")

    Repo.query!(
      "SELECT id, name, country, cell_r5::h3index::text FROM cities WHERE search_key LIKE $1 ORDER BY population DESC, name LIMIT 10",
      [pattern]
    ).rows
    |> Enum.map(fn [id, name, country, cell] ->
      %{id: id, name: name, country: country, cell_r5: cell}
    end)
  end

  def search_cities(_), do: []

  @doc """
  R-02.2 / S-01: visible-people counts around a city, for the blurred live map.
  Counts per r7 cell; no profile data. Paused/hidden profiles excluded.
  """
  def welcome(city_name) do
    case Repo.query!(
           "SELECT name, cell_r5::h3index::text, lat, lng FROM cities WHERE search_key = $1 ORDER BY population DESC LIMIT 1",
           [Thirstr.Cities.key(city_name)]
         ).rows do
      [[name, r5, lat, lng]] ->
        %{rows: cells} =
          Repo.query!(
            """
            SELECT lc.cell_r7::h3index::text, count(*)
            FROM location_cells lc
            JOIN profiles p ON p.id = lc.profile_id
            JOIN accounts a ON a.id = p.account_id
            WHERE lc.cell_r5 IN (SELECT h3_grid_disk($1::text::h3index, 1)::bigint)
              AND lc.cell_r7 IS NOT NULL AND a.status = 'active'
            GROUP BY 1
            """,
            [r5]
          )

        total = cells |> Enum.map(&List.last/1) |> Enum.sum()

        %{
          city: name,
          center: %{lat: lat, lng: lng},
          count: display_count(total),
          cells: Enum.map(cells, fn [c, n] -> %{cell: c, count: n} end)
        }

      _ ->
        %{city: nil, center: nil, count: nil, cells: []}
    end
  end

  @doc "R-02.2: rounded down to nearest 10 below 100; nil below 10 (S-01 special state)."
  def display_count(n) when n < 10, do: nil
  def display_count(n) when n < 100, do: div(n, 10) * 10
  def display_count(n), do: n

  defp dump(uuid), do: Ecto.UUID.dump!(uuid)
end
