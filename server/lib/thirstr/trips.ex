defmodule Thirstr.Trips do
  @moduledoc """
  F-20 travel plans (#188, docs/spec/features/F20-travel.md).

  Privacy rules:
  - a trip is the city (public `cities` row) + dates; never a position;
  - others learn about a trip only when their own view point (or Look-around city) is within
    the trip city's area, and only when the owner chose "Show me there" (R-20.7, R-20.12);
  - Look-around queries use the trip city's fixed centre as the view point (R-20.15);
  - visitors are never map-pinned and carry no distance (R-20.11, R-20.13).
  """
  alias Thirstr.Repo
  alias Thirstr.Accounts.Account

  # R-20.3 limits
  @max_trips 3
  @ahead_days 180
  @max_days 30
  @show_days [0, 3, 7, 14]
  @creates_per_30d 6
  # trip city "area": r5 cells within 2 rings (~20 km)
  @area_k 2

  def limits(%Account{} = a) do
    used =
      Repo.query!(
        "SELECT count(*) FROM trip_creates WHERE account_id = $1 AND at > now() - interval '30 days'",
        [dump(a.id)]
      ).rows
      |> hd()
      |> hd()

    %{
      max: @max_trips,
      ahead_days: @ahead_days,
      max_days: @max_days,
      creates_left: max(@creates_per_30d - used, 0)
    }
  end

  # ------------------------------------------------------------------ CRUD

  @doc "GET /trips: own trips, soonest first."
  # select_sql/0 is a literal; all values are bound params.
  # sobelow_skip ["SQL.Query"]
  def list(%Account{} = a) do
    Repo.query!(select_sql() <> " WHERE t.account_id = $1 ORDER BY t.first_day, t.created_at", [
      dump(a.id)
    ]).rows
    |> Enum.map(&trip_json/1)
  end

  # select_sql/0 is a literal; all values are bound params.
  # sobelow_skip ["SQL.Query"]
  def get(%Account{} = a, id) do
    with {:ok, _} <- Ecto.UUID.cast(id),
         %{rows: [row]} <-
           Repo.query!(select_sql() <> " WHERE t.account_id = $1 AND t.id = $2", [
             dump(a.id),
             dump(id)
           ]) do
      {:ok, trip_json(row)}
    else
      _ -> {:error, :not_found}
    end
  end

  @doc "POST /trips (R-20.2, R-20.3, R-20.19)."
  def create(%Account{} = a, params) do
    with {:ok, attrs} <- validate(a, params, nil),
         :ok <- count_ok(a),
         :ok <- creates_ok(a) do
      id = Ecto.UUID.generate()

      Repo.transaction(fn ->
        Repo.query!(
          """
          INSERT INTO trips (id, account_id, city_id, first_day, last_day, show_days, say_from, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
          """,
          [
            dump(id),
            dump(a.id),
            attrs.city_id,
            attrs.first_day,
            attrs.last_day,
            attrs.show_days,
            attrs.say_from
          ]
        )

        Repo.query!("INSERT INTO trip_creates (account_id, at) VALUES ($1, now())", [dump(a.id)])
      end)

      get(a, id)
    end
  end

  @doc "PATCH /trips/:id. A new city counts as a new trip for the 6 / 30 d limit."
  def update(%Account{} = a, id, params) do
    with {:ok, cur} <- get(a, id),
         merged =
           Map.merge(
             %{
               "city_id" => cur.city.id,
               "first_day" => Date.to_iso8601(cur.first_day),
               "last_day" => Date.to_iso8601(cur.last_day),
               "show_days" => cur.show_days,
               "say_from" => cur.say_from
             },
             params
           ),
         {:ok, attrs} <- validate(a, merged, id),
         :ok <- if(attrs.city_id != cur.city.id, do: creates_ok(a), else: :ok) do
      Repo.query!(
        """
        UPDATE trips SET city_id = $3, first_day = $4, last_day = $5, show_days = $6, say_from = $7,
          updated_at = now() WHERE id = $1 AND account_id = $2
        """,
        [
          dump(id),
          dump(a.id),
          attrs.city_id,
          attrs.first_day,
          attrs.last_day,
          attrs.show_days,
          attrs.say_from
        ]
      )

      if attrs.city_id != cur.city.id,
        do:
          Repo.query!("INSERT INTO trip_creates (account_id, at) VALUES ($1, now())", [
            dump(a.id)
          ])

      get(a, id)
    end
  end

  def delete(%Account{} = a, id) do
    with {:ok, _} <- get(a, id) do
      Repo.query!("DELETE FROM trips WHERE id = $1 AND account_id = $2", [dump(id), dump(a.id)])
      :ok
    end
  end

  @doc "R-20.4: hourly. Trips end at 12:00 UTC the day after their last day."
  def sweep do
    Repo.query!("""
    DELETE FROM trips WHERE (last_day + 1)::timestamp + interval '12 hours' <= (now() AT TIME ZONE 'UTC')
    """)

    Repo.query!("DELETE FROM trip_creates WHERE at < now() - interval '30 days'")
    :ok
  end

  defp count_ok(a) do
    n =
      Repo.query!("SELECT count(*) FROM trips WHERE account_id = $1", [dump(a.id)]).rows
      |> hd()
      |> hd()

    if n >= @max_trips,
      do: {:error, {:validation, %{trips: ["You can plan up to #{@max_trips} trips"]}}},
      else: :ok
  end

  defp creates_ok(a) do
    if limits(a).creates_left > 0,
      do: :ok,
      else: {:error, {:rate_limited, 24 * 3600}}
  end

  defp validate(a, p, own_id) do
    today = local_today(p["tz_offset_min"])

    with {:ok, city} <- city(p["city_id"]),
         {:ok, first} <- date(p["first_day"], :first_day),
         {:ok, last} <- date(p["last_day"], :last_day),
         :ok <- check(Date.compare(first, today) != :lt, :first_day, "can't be in the past"),
         :ok <-
           check(
             Date.diff(first, today) <= @ahead_days,
             :first_day,
             "must be within #{@ahead_days} days"
           ),
         :ok <- check(Date.compare(last, first) != :lt, :last_day, "must be after the first day"),
         :ok <-
           check(
             Date.diff(last, first) + 1 <= @max_days,
             :last_day,
             "Trips can be up to #{@max_days} days"
           ),
         {:ok, show} <- show_days(p["show_days"]),
         :ok <- verified_to_show(a, show),
         :ok <- safe_mode_ack(city, show, p["safe_mode_ack"]),
         :ok <- no_overlap(a, own_id, show, first, last) do
      {:ok,
       %{
         city_id: city.id,
         first_day: first,
         last_day: last,
         show_days: show,
         say_from: p["say_from"] == true
       }}
    end
  end

  defp check(true, _, _), do: :ok
  defp check(false, field, msg), do: {:error, {:validation, %{field => [msg]}}}

  defp local_today(off) when is_integer(off) and off >= -720 and off <= 840,
    do: DateTime.utc_now() |> DateTime.add(off * 60, :second) |> DateTime.to_date()

  defp local_today(_), do: Date.utc_today()

  defp date(s, field) when is_binary(s) do
    case Date.from_iso8601(s) do
      {:ok, d} -> {:ok, d}
      _ -> {:error, {:validation, %{field => ["must be a date (YYYY-MM-DD)"]}}}
    end
  end

  defp date(_, field), do: {:error, {:validation, %{field => ["can't be blank"]}}}

  defp city(id) when is_integer(id) do
    case Repo.query!("SELECT id, country FROM cities WHERE id = $1", [id]).rows do
      [[id, cc]] -> {:ok, %{id: id, country: cc}}
      _ -> {:error, {:validation, %{city_id: ["unknown city"]}}}
    end
  end

  defp city(_), do: {:error, {:validation, %{city_id: ["can't be blank"]}}}

  defp show_days(nil), do: {:ok, nil}
  defp show_days(d) when d in @show_days, do: {:ok, d}

  defp show_days(_),
    do: {:error, {:validation, %{show_days: ["must be none, 0, 3, 7 or 14 days"]}}}

  defp verified_to_show(_a, nil), do: :ok

  defp verified_to_show(a, _),
    do:
      if(Account.verified?(a),
        do: :ok,
        else: {:error, {:not_verified, "Verify to show yourself in a trip city"}}
      )

  # R-20.19: showing early in a Safe Mode country needs a second confirm.
  defp safe_mode_ack(_city, nil, _), do: :ok

  defp safe_mode_ack(city, _show, ack) do
    if safe_mode_country?(city.country) and ack != true,
      do:
        {:error,
         {:validation, %{safe_mode_ack: ["Confirm that you want to be visible there early"]}}},
      else: :ok
  end

  # R-20.3: one shown trip at a time (shown windows may not overlap).
  defp no_overlap(_a, _own, nil, _f, _l), do: :ok

  defp no_overlap(a, own_id, show, first, last) do
    from = Date.add(first, -show)

    rows =
      Repo.query!(
        """
        SELECT c.name FROM trips t JOIN cities c ON c.id = t.city_id
        WHERE t.account_id = $1 AND t.show_days IS NOT NULL AND ($2::uuid IS NULL OR t.id <> $2)
          AND (t.first_day - t.show_days) <= $4 AND t.last_day >= $3
        LIMIT 1
        """,
        [dump(a.id), own_id && dump(own_id), from, last]
      ).rows

    case rows do
      [[name]] -> {:error, {:conflict, "You're already shown in #{name} then"}}
      _ -> :ok
    end
  end

  @safe_mode_path Path.expand("../../priv/safe_mode/countries.json", __DIR__)
  @external_resource @safe_mode_path
  @safe_mode_countries @safe_mode_path
                       |> File.read!()
                       |> Jason.decode!()
                       |> Map.fetch!("countries")
                       |> MapSet.new()

  def safe_mode_country?(cc), do: MapSet.member?(@safe_mode_countries, cc)

  defp select_sql do
    """
    SELECT t.id::text, c.id, c.name, c.country, c.lat, c.lng, t.first_day, t.last_day, t.show_days, t.say_from
    FROM trips t JOIN cities c ON c.id = t.city_id
    """
  end

  defp trip_json([id, cid, name, cc, lat, lng, first, last, show, say_from]) do
    %{
      id: id,
      city: %{id: cid, name: name, country: cc, lat: lat, lng: lng},
      first_day: first,
      last_day: last,
      show_days: show,
      say_from: say_from,
      shown_from: show && Date.add(first, -show),
      safe_mode_country: safe_mode_country?(cc)
    }
  end

  # ------------------------------------------------------------------ Look around (R-20.15)

  @doc "View point for an own, unexpired trip: the trip city's centre (r5)."
  def point(%Account{} = a, trip_id) do
    case get(a, trip_id) do
      {:ok, t} ->
        [[cell]] =
          Repo.query!("SELECT cell_r5::h3index::text FROM cities WHERE id = $1", [t.city.id]).rows

        {:ok, %{lat: t.city.lat, lng: t.city.lng, res: 5, exact: false, cell: cell, trip: t}}

      e ->
        e
    end
  end

  @doc "Public centre of a catalogue city (map bubble, R-20.11)."
  def city_center(name, cc) do
    case Repo.query!("SELECT lat, lng FROM cities WHERE name = $1 AND country = $2 LIMIT 1", [
           name,
           cc
         ]).rows do
      [[lat, lng]] -> %{lat: lat, lng: lng}
      _ -> nil
    end
  end

  # ------------------------------------------------------------------ visitors (R-20.10–R-20.13)

  @doc """
  Profile ids of visitors listed for a view point, with their trip, in order (soonest arrival,
  then most recent trip). Excludes travellers already here (their own cell is in the area,
  R-20.9: they rank like locals) and the viewer himself. Visibility rules are applied by
  `Explore.candidates/4` afterwards.
  """
  def visitor_trips(%{point: %{lat: lat, lng: lng}} = v) do
    Repo.query!(
      """
      WITH vp AS (SELECT h3_lat_lng_to_cell(point($1::float8, $2::float8), 5) AS r5)
      SELECT p.id::text, c.name, c.country, t.first_day, t.last_day, t.say_from,
             (SELECT lc.cell_r5::h3index::text FROM location_cells lc WHERE lc.profile_id = p.id)
      FROM vp, trips t
      JOIN cities c ON c.id = t.city_id
      JOIN accounts a ON a.id = t.account_id
      JOIN profiles p ON p.account_id = t.account_id
      WHERE t.show_days IS NOT NULL
        AND c.cell_r5 IN (SELECT h3_grid_disk(vp.r5, $4)::bigint)
        AND current_date >= t.first_day - t.show_days AND current_date <= t.last_day
        AND a.verified_at IS NOT NULL AND a.status = 'active' AND NOT a.hidden
        AND a.id <> $3
        AND NOT EXISTS (SELECT 1 FROM location_cells lc WHERE lc.profile_id = p.id
                          AND lc.cell_r5 IN (SELECT h3_grid_disk(c.cell_r5::h3index, $4)::bigint))
      ORDER BY t.first_day, t.created_at DESC
      LIMIT 500
      """,
      [lng, lat, dump(v.account.id), @area_k]
    ).rows
    |> Enum.map(fn [pid, city, cc, first, last, say, home] ->
      {pid, trip_card(city, cc, first, last, false, say, home)}
    end)
  end

  @doc """
  R-20.9: travellers already here among `rows` (account ids) for a view point → %{profile_id => trip}.
  """
  def here(_point, []), do: %{}

  def here(%{lat: lat, lng: lng}, profile_ids) do
    Repo.query!(
      """
      WITH vp AS (SELECT h3_lat_lng_to_cell(point($1::float8, $2::float8), 5) AS r5)
      SELECT DISTINCT ON (p.id) p.id::text, c.name, c.country, t.first_day, t.last_day
      FROM vp, trips t
      JOIN cities c ON c.id = t.city_id
      JOIN profiles p ON p.account_id = t.account_id
      JOIN location_cells lc ON lc.profile_id = p.id
      WHERE p.id = ANY($3::uuid[]) AND t.show_days IS NOT NULL
        AND c.cell_r5 IN (SELECT h3_grid_disk(vp.r5, $4)::bigint)
        AND current_date >= t.first_day - t.show_days AND current_date <= t.last_day
        AND lc.cell_r5 IN (SELECT h3_grid_disk(c.cell_r5::h3index, $4)::bigint)
      ORDER BY p.id, t.first_day
      """,
      [lng, lat, Enum.map(profile_ids, &dump/1), @area_k]
    ).rows
    |> Map.new(fn [pid, city, cc, first, last] ->
      {pid, trip_card(city, cc, first, last, true, false, nil)}
    end)
  end

  @doc "R-20.7: the shown trip of `profile_id` near a view point (or nil)."
  def for_profile(nil, _profile_id), do: nil

  def for_profile(point, profile_id) do
    here = here(point, [profile_id])

    case here[profile_id] do
      nil ->
        Repo.query!(
          """
          WITH vp AS (SELECT h3_lat_lng_to_cell(point($1::float8, $2::float8), 5) AS r5)
          SELECT c.name, c.country, t.first_day, t.last_day, t.say_from,
                 (SELECT lc.cell_r5::h3index::text FROM location_cells lc WHERE lc.profile_id = p.id)
          FROM vp, trips t
          JOIN cities c ON c.id = t.city_id
          JOIN profiles p ON p.account_id = t.account_id
          JOIN accounts a ON a.id = t.account_id
          WHERE p.id = $3 AND t.show_days IS NOT NULL AND a.verified_at IS NOT NULL
            AND c.cell_r5 IN (SELECT h3_grid_disk(vp.r5, $4)::bigint)
            AND current_date >= t.first_day - t.show_days AND current_date <= t.last_day
          ORDER BY t.first_day LIMIT 1
          """,
          [point.lng, point.lat, dump(profile_id), @area_k]
        ).rows
        |> case do
          [[city, cc, first, last, say, home]] ->
            trip_card(city, cc, first, last, false, say, home)

          _ ->
            nil
        end

      t ->
        t
    end
  end

  defp trip_card(city, cc, first, last, here, say_from, home_r5) do
    %{
      city: city,
      country: cc,
      first_day: first,
      last_day: last,
      here: here,
      from: if(say_from and home_r5, do: Thirstr.Explore.city_name(home_r5))
    }
  end

  defp dump(uuid), do: Ecto.UUID.dump!(uuid)
end
