defmodule Thirstr.Explore do
  @moduledoc """
  F-04 Explore: grid, map, tray. Spec: docs/spec/features/F04-explore.md, F05-location.md.

  Privacy rules enforced here (server-side, R-04.9):
  - never return blocked (both ways), paused, quarantined, Hidden accounts;
  - `hide_from_hidden` when the viewer is Hidden (R-05.6);
  - target settings: hide from unverified / new accounts / age range, show-in toggles;
  - Safe Mode targets visible only to verified accounts older than 7 days (F-14);
  - no raw coordinates except Exact pins whose audience includes the viewer (AC-04.2);
  - unverified viewers: no pins, distance ≥ "1–2 km" (R-04.10).
  Vouches never affect ordering (R-18.6).
  """
  alias Thirstr.{Location, Repo, Settings, Storage, Trips, Valkey}
  alias Thirstr.Accounts.Account

  @modes %{"hookup" => "now", "sport" => "sport", "friends" => "friends"}
  @page 60
  @near_m 10_000
  @far_m 100_000
  @sparse 30
  @online_s 300
  @edge_m %{5 => 8544, 7 => 1220, 8 => 461, 9 => 174, 10 => 66}

  def kind_for_mode(mode), do: Map.get(@modes, mode)

  @doc "F-06 R-06.1b: the viewer's lens for a mode param (unknown → hookup)."
  def lens(mode) when mode in ["hookup", "friends", "sport"], do: mode
  def lens(_), do: "hookup"

  @intents ~w(hookup friends sport)

  @doc """
  F-04 R-04.18 (#113): `intents=hookup,friends,sport` param → ordered, non-empty list, or nil
  when absent/invalid (legacy single-mode call).
  """
  def parse_intents(nil), do: nil
  def parse_intents(""), do: nil

  def parse_intents(s) when is_binary(s) do
    given = String.split(s, ",", trim: true)

    case Enum.filter(@intents, &(&1 in given)) do
      [] -> nil
      list -> list
    end
  end

  def parse_intents(_), do: nil

  @doc "R-04.19: a profile's intents, ordered hookup → friends → sport."
  def intents_of(show_in), do: Enum.filter(@intents, &(&1 in (show_in || [])))

  # ------------------------------------------------------------------ viewer

  @doc "Everything the queries need to know about the viewer."
  def viewer(%Account{} = a, mode, intents \\ nil) do
    kind = kind_for_mode(mode) || "now"
    merged = not is_nil(intents)
    intents = intents || [lens(mode)]

    own =
      Repo.query!("SELECT id::text, kind, age FROM profiles WHERE account_id = $1", [dump(a.id)]).rows

    %{
      account: a,
      mode: mode,
      # R-04.18: one lens when a single intent is selected, else per card (first match).
      lens: if(length(intents) == 1, do: hd(intents), else: "mixed"),
      intents: intents,
      merged: merged,
      kind: kind,
      verified: Account.verified?(a),
      new: Account.new?(a),
      hidden: a.hidden,
      safe_mode: Account.safe_mode_on?(a),
      settings: Settings.get(a),
      point: Location.viewer_point(a),
      # #197 R-05.16: ranges only while the viewer jumps through too many cells.
      brake: Location.spoof_brake?(a),
      # F-20 R-20.15: true while looking around a trip city (point = its centre)
      remote: false,
      # R-06.1: one profile per account, whatever the mode.
      profile_id: Enum.find_value(own, fn [id, _, _] -> id end),
      age: Enum.find_value(own, fn [_, k, age] -> if k == "now", do: age end) || 30
    }
  end

  @doc """
  F-20 R-20.15: Look around. The view point becomes the trip city's fixed centre; no Exact pins,
  locals with `show_to_remote` off or in Safe Mode are left out (R-20.17).
  """
  def with_trip(v, nil), do: v

  def with_trip(v, %{} = tp),
    do: %{v | point: Map.take(tp, [:lat, :lng, :res, :exact, :cell]), remote: true}

  # ------------------------------------------------------------------ grid & tray

  @doc "GET /explore/grid (R-04.5): page of 60, same sort as the tray, sparse widening (R-04.7)."
  def grid(v, filters, cursor) do
    offset = parse_cursor(cursor)

    case v.point do
      nil ->
        %{items: [], next: nil, further_from: nil, reason: "no_location", fit_m: nil}

      _ ->
        case offset > 0 && cached_order(v, filters) do
          {order, fit} -> grid_page(v, filters, order, offset, fit)
          _ -> grid_fresh(v, filters, offset)
        end
    end
  end

  defp grid_fresh(v, filters, offset) do
    locals = candidates(v, filters, "show_in_grid") |> sorted()
    all = interleave(locals, visitors(v, filters))
    page = Enum.slice(all, offset, @page)
    next = if length(all) > offset + @page, do: Integer.to_string(offset + @page)
    further_from = Enum.find_index(all, & &1.further)
    fit = fit_m(locals, v)
    put_order(v, filters, all, fit)

    %{
      items: page |> with_here(v) |> Enum.map(&card(&1, v)) |> Thirstr.Moments.annotate(v),
      next: next,
      further_from: further_from && further_from - offset,
      reason: nil,
      fit_m: fit
    }
  end

  # SR-09 (#149): later pages re-read only their own 60 profiles (primary-key lookups, all
  # visibility rules applied again) in the order page 1 computed, instead of the full candidate
  # query + enrichment of up to 1 500 rows per scroll.
  defp grid_page(v, filters, order, offset, fit) do
    slice = Enum.slice(order, offset, @page)
    further = Map.new(slice)
    {vis, loc} = Enum.split_with(slice, &(elem(&1, 1) == :visitor))

    rows =
      candidates(v, filters, "show_in_grid", Enum.map(loc, &elem(&1, 0)))
      |> Map.new(&{&1.id, %{&1 | further: Map.get(further, &1.id) == true}})
      |> Map.merge(
        if(vis == [],
          do: %{},
          else: visitors(v, filters, Enum.map(vis, &elem(&1, 0))) |> Map.new(&{&1.id, &1})
        )
      )

    further_from = Enum.find_index(order, &(elem(&1, 1) == true))

    %{
      items:
        for({id, _} <- slice, r = rows[id], do: r)
        |> with_here(v)
        |> Enum.map(&card(&1, v))
        |> Thirstr.Moments.annotate(v),
      next: if(length(order) > offset + @page, do: Integer.to_string(offset + @page)),
      further_from: further_from && further_from - offset,
      reason: nil,
      fit_m: fit
    }
  end

  @order_cache :thirstr_grid_order
  @order_ttl_s 120
  @order_max 2_000

  @doc "Creates the grid order cache (called once from Application.start)."
  def init_cache do
    if :ets.whereis(@order_cache) == :undefined,
      do: :ets.new(@order_cache, [:named_table, :public, :set, read_concurrency: true])

    :ok
  end

  defp order_key(v, filters),
    do:
      {v.account.id,
       :erlang.phash2(
         {v.intents, v.mode, v.point, v.remote, v.verified, v.hidden, v.new, v.safe_mode, v.age,
          filters}
       )}

  # online_now is decided per page (presence moves fast), so those pages are never cached.
  defp put_order(_v, %{online_now: true}, _all, _fit), do: :ok

  defp put_order(v, filters, all, fit) do
    if :ets.info(@order_cache, :size) >= @order_max, do: :ets.delete_all_objects(@order_cache)

    # packed 17 bytes per profile (uuid + further flag) keeps 1 500 rows ≈ 25 KB
    packed =
      for r <- all,
          into: <<>>,
          do:
            <<dump(r.id)::binary-16,
              cond do
                Map.get(r, :visitor) -> 2
                r.further -> 1
                true -> 0
              end>>

    :ets.insert(
      @order_cache,
      {order_key(v, filters), System.monotonic_time(:second), packed, fit}
    )

    :ok
  end

  defp cached_order(_v, %{online_now: true}), do: nil

  defp cached_order(v, filters) do
    now = System.monotonic_time(:second)

    case :ets.lookup(@order_cache, order_key(v, filters)) do
      [{_, at, packed, fit}] when now - at <= @order_ttl_s ->
        {for(<<id::binary-16, f <- packed>>,
           do: {Ecto.UUID.load!(id), if(f == 2, do: :visitor, else: f == 1)}
         ), fit}

      _ ->
        nil
    end
  end

  @fit_steps [500, 1_000, 2_000, 5_000, 10_000, 25_000, 50_000, 100_000]
  @fit_n 12

  @doc """
  R-04.15 auto-fit radius: distance to the 12th nearest visible person (or the furthest, if
  fewer), rounded up to a coarse step so it tells no more than the distance buckets.
  Unverified viewers: at least 2 km (R-04.10). nil when nobody is visible.
  """
  def fit_m([], _v), do: nil

  def fit_m(rows, v) do
    d =
      rows
      |> Enum.map(& &1.dist_m)
      |> Enum.sort()
      |> Enum.take(@fit_n)
      |> List.last()

    step = Enum.find(@fit_steps, List.last(@fit_steps), &(&1 >= d))
    if v.verified, do: step, else: max(step, 2_000)
  end

  # ------------------------------------------------------------------ visitors (F-20)

  @doc """
  F-20 R-20.12: visitors listed for the viewer's area, with every Explore visibility rule applied
  (via `candidates/4` on their ids), in trip order. Never pinned, never a distance (R-20.13).
  `filters.visitors == false` (Filters › Show visitors off) → none.
  """
  def visitors(v, filters, only_ids \\ nil)
  def visitors(%{point: nil}, _filters, _ids), do: []
  def visitors(_v, %{visitors: false}, _ids), do: []

  def visitors(v, filters, only_ids) do
    trips = Trips.visitor_trips(v)
    trips = if only_ids, do: Enum.filter(trips, &(elem(&1, 0) in only_ids)), else: trips

    case trips do
      [] ->
        []

      _ ->
        rows =
          candidates(
            v,
            Map.delete(filters, :distance_max),
            "show_in_grid",
            Enum.map(trips, &elem(&1, 0))
          )
          |> Map.new(&{&1.id, &1})

        for {id, trip} <- trips, r = rows[id] do
          %{r | further: false, pin: nil}
          |> Map.merge(%{visitor: true, trip: trip, dist_m: 0.0})
        end
    end
  end

  @doc "F-20 R-20.10: first visitor at position 2, then every 6th tile, before Further away."
  def interleave(locals, []), do: locals

  def interleave(locals, visitors) do
    {near, far} = Enum.split_while(locals, &(not &1.further))
    weave(near, visitors, 0, []) ++ far
  end

  defp weave(near, [v | vs], i, acc) when rem(i, 6) == 1, do: weave(near, vs, i + 1, [v | acc])
  defp weave([n | ns], vs, i, acc), do: weave(ns, vs, i + 1, [n | acc])
  defp weave([], vs, _i, acc), do: Enum.reverse(acc, vs)

  # R-20.9: travellers already here keep their rank and get the "Here now" trip.
  defp with_here(rows, v) do
    ids = for r <- rows, not Map.get(r, :visitor, false), do: r.id

    case v.point && Trips.here(v.point, ids) do
      m when map_size(m) > 0 ->
        Enum.map(rows, fn r ->
          case m[r.id] do
            nil -> r
            t -> Map.put(r, :trip, t)
          end
        end)

      _ ->
        rows
    end
  end

  @doc "GET /explore/tray (R-04.4): up to 20 active-now cards."
  def tray(v, filters) do
    if v.point do
      candidates(v, filters, "show_in_map")
      |> Enum.filter(&(&1.pin || &1.now || &1.online))
      |> sorted()
      |> Enum.take(20)
      |> Enum.map(&card(&1, v))
      |> Thirstr.Moments.annotate(v)
    else
      []
    end
  end

  @doc """
  GET /explore/summary (R-04.17, R-04.18): live header data. Per-intent count of people the
  viewer can see within the near radius (grid rules), the union `total` for the selected intents,
  Now count (none when Sport is the only intent) and the viewer's own city-level place name.
  Legacy call (no `intents`): `filters` apply to the active mode only; other modes use defaults.
  """
  def summary(%Account{} = a, mode, filters, intents \\ nil, trip \\ nil) do
    v = viewer(a, mode, intents) |> with_trip(trip)
    viewer = fn m, i -> viewer(a, m, i) |> with_trip(trip) end

    case v.point do
      nil ->
        %{place: nil, counts: %{"hookup" => 0, "friends" => 0, "sport" => 0}, total: 0, now: 0}

      point ->
        near = fn rows -> Enum.reject(rows, &(&1.dist_m > @near_m)) end
        active = candidates(v, filters, "show_in_grid") |> near.()

        counts =
          Map.new(@intents, fn m ->
            n =
              cond do
                v.intents == [m] ->
                  length(active)

                intents ->
                  viewer.(m, [m]) |> candidates(filters, "show_in_grid") |> near.() |> length()

                true ->
                  viewer.(m, nil)
                  |> candidates(parse_filters(%{}), "show_in_grid")
                  |> near.()
                  |> length()
              end

            {m, n}
          end)

        visiting = length(visitors(v, filters))

        %{
          # F-20: looking around → the trip city itself
          place: if(trip, do: trip.trip.city.name, else: place(point)),
          counts: counts,
          # F-20 R-20.10: "N around" includes listed visitors
          total: length(active) + visiting,
          visitors: visiting,
          now: if(v.intents == ["sport"], do: 0, else: Enum.count(active, & &1.now))
        }
    end
  end

  @doc "City-level name for a point (nearest `cities` row to its r5 cell); nil when unknown."
  def place(%{lat: lat, lng: lng}) do
    [[r5]] =
      Repo.query!("SELECT h3_lat_lng_to_cell(point($1::float8, $2::float8), 5)::text", [lng, lat]).rows

    case city_name(r5) do
      "" -> nil
      n -> n
    end
  end

  # R-04.4 sort (#197): nearest first by the distance the card shows, then Now, then online
  # recency. City-only people (no number) after everyone with a distance.
  defp sorted(rows) do
    Enum.sort_by(rows, fn r ->
      city? = r.level == "city"
      shown = if city?, do: 0, else: shown_m(r)
      {r.further, city?, shown, if(r.now, do: 0, else: 1), -(r.seen || 0)}
    end)
  end

  # ------------------------------------------------------------------ map

  @doc """
  GET /explore/map?bbox=w,s,e,n (R-04.2). Returns cell heat, avatars at stable random points
  inside their displayed cell (R-05.3), allowed Exact pins. Unverified viewers get r7 counts
  only; Safe Mode viewers get city-level (r5) counts only.
  """
  def map(v, bbox, filters) do
    with {:ok, {w, s, e, n}} <- parse_bbox(bbox) do
      res =
        cond do
          v.safe_mode -> 5
          not v.verified -> 7
          (e - w) * (n - s) > 2.0 -> 5
          true -> 7
        end

      cells = bbox_cells(w, s, e, n, res)

      rows =
        if cells == [] do
          []
        else
          candidates(v, Map.put(filters, :cells, {res, cells}), "show_in_map")
        end

      heat =
        rows
        |> Enum.group_by(&if(res == 5, do: &1.cell_r5, else: &1.cell_r7))
        |> Enum.map(fn {c, list} -> %{cell: c, res: res, count: length(list)} end)

      detail? = v.verified and not v.safe_mode and res == 7

      {pins, avatars} =
        if detail? do
          rows
          |> Enum.take(400)
          |> Enum.split_with(& &1.pin)
        else
          {[], []}
        end

      {:ok,
       %{
         cells: heat,
         pins:
           pins
           |> Enum.map(&Map.merge(card(&1, v), %{lat: &1.pin.lat, lng: &1.pin.lng}))
           |> Thirstr.Moments.annotate(v),
         avatars:
           avatars
           |> Enum.map(fn r ->
             {lat, lng} = stable_point(r.id, r.dcell_lat, r.dcell_lng, r.display_res)
             Map.merge(card(r, v), %{lat: lat, lng: lng})
           end)
           |> Thirstr.Moments.annotate(v)
       }}
    end
  end

  defp parse_bbox(s) when is_binary(s) do
    with [w, so, e, n] <- String.split(s, ","),
         {w, ""} <- Float.parse(w),
         {so, ""} <- Float.parse(so),
         {e, ""} <- Float.parse(e),
         {n, ""} <- Float.parse(n),
         true <- w < e and so < n and n - so < 20 and e - w < 40 do
      {:ok, {w, so, e, n}}
    else
      _ -> {:error, {:validation, %{bbox: ["w,s,e,n in degrees, max 20°×40°"]}}}
    end
  end

  defp parse_bbox(_), do: {:error, {:validation, %{bbox: ["required"]}}}

  # h3_polygon_to_cells keeps only cells whose centre is inside the polygon: zoomed in past one
  # cell (or at the screen edge) the cell you are looking at was dropped and the map went empty.
  # Pad the box by about one cell edge so every cell touching the viewport is included.
  @cell_pad %{5 => 0.1, 7 => 0.015}

  defp bbox_cells(w, s, e, n, res) do
    pad = Map.fetch!(@cell_pad, res)
    lng_pad = pad / max(:math.cos((s + n) / 2 * :math.pi() / 180), 0.2)

    {w, s, e, n} =
      {max(w - lng_pad, -180.0), max(s - pad, -85.0), min(e + lng_pad, 180.0), min(n + pad, 85.0)}

    %{rows: rows} =
      Repo.query!(
        """
        SELECT c::bigint FROM h3_polygon_to_cells($1::text::polygon, NULL::polygon[], $2::int) c
        LIMIT 3000
        """,
        ["((#{w},#{s}),(#{e},#{s}),(#{e},#{n}),(#{w},#{n}))", res]
      )

    List.flatten(rows)
  end

  @doc "R-05.3: deterministic point inside the displayed cell; seed = profile id + UTC date."
  def stable_point(id, lat, lng, res) do
    <<a::32, b::32, _::binary>> = :crypto.hash(:sha256, id <> Date.to_iso8601(Date.utc_today()))
    r = :math.sqrt(a / 4_294_967_295) * Map.get(@edge_m, res, 1220) * 0.6
    theta = b / 4_294_967_295 * 2 * :math.pi()
    dlat = r * :math.cos(theta) / 111_320
    dlng = r * :math.sin(theta) / (111_320 * :math.cos(lat * :math.pi() / 180))
    {lat + dlat, lng + dlng}
  end

  # ------------------------------------------------------------------ core query

  @doc false
  # The interpolated WHERE fragment is built from fixed clauses; all values are bound params.
  # sobelow_skip ["SQL.Query"]
  def candidates(v, filters, surface, ids \\ nil) do
    {where, params} = filter_sql(v, filters, surface)

    {where, params} =
      if ids,
        do:
          {where <> " AND p.id = ANY($#{10 + length(params)}::uuid[])",
           params ++ [Enum.map(ids, &dump/1)]},
        else: {where, params}

    radius =
      cond do
        ids -> nil
        Map.has_key?(filters, :cells) -> nil
        true -> filters[:distance_max] || @far_m
      end

    disk_k =
      case radius do
        nil -> 0
        r -> min(ceil(r / 15_000) + 1, 14)
      end

    base_params = [
      v.point.lng,
      v.point.lat,
      dump(v.account.id),
      v.intents,
      v.verified,
      v.hidden,
      v.new,
      v.age,
      disk_k
    ]

    sql = """
    WITH vp AS (SELECT point($1::float8, $2::float8) AS pt,
                       h3_lat_lng_to_cell(point($1::float8, $2::float8), 5) AS r5)
    SELECT p.id::text, p.display_name, p.age, p.gender, p.gender_other, p.fields, p.visibility_map,
           p.seeded, a.id::text, a.verified_at, a.inserted_at, a.settings, lc.level, lc.display_res,
           d.dcell::text, (h3_cell_to_lat_lng(d.dcell))[1], (h3_cell_to_lat_lng(d.dcell))[0],
           h3_great_circle_distance(h3_cell_to_lat_lng(d.dcell), vp.pt, 'm'),
           ns.status, ns.text, ns.created_at, COALESCE(ph.thumb_key, ph.storage_key),
           lc.cell_r7, lc.cell_r5, p.public_updated_at, p.show_in
    FROM vp, location_cells lc
    JOIN profiles p ON p.id = lc.profile_id
    JOIN accounts a ON a.id = p.account_id
    CROSS JOIN LATERAL (SELECT (CASE lc.display_res WHEN 10 THEN lc.cell_r10 WHEN 9 THEN lc.cell_r9 WHEN 8 THEN lc.cell_r8
                          WHEN 7 THEN lc.cell_r7 ELSE lc.cell_r5 END)::h3index AS dcell) d
    LEFT JOIN now_status ns ON ns.profile_id = p.id AND ns.expires_at > now()
                          AND NOT ($4::text[] <@ ARRAY['sport']::text[])
    LEFT JOIN photos ph ON ph.id = p.photo_ids[1]
    WHERE p.show_in::text[] && $4::text[]
      AND ($9 = 0 OR lc.cell_r5 IN (SELECT h3_grid_disk(vp.r5, $9)::bigint))
      AND a.id <> $3
      AND a.status = 'active' AND NOT a.hidden
      AND (cardinality(p.photo_ids) > 0 OR p.seeded)
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.account_from = $3 AND b.account_to = a.id)
                                               OR (b.account_from = a.id AND b.account_to = $3))
      AND NOT EXISTS (SELECT 1 FROM profile_hides h WHERE h.account_id = $3 AND h.profile_id = p.id)
      AND NOT (lc.hide_from_hidden AND $6)
      AND (NOT COALESCE((a.settings->>'hide_from_unverified')::boolean, true) OR $5)
      AND (NOT COALESCE((a.settings->>'hide_from_new')::boolean, false) OR NOT $7)
      AND (a.settings->>'hide_from_age_min' IS NULL OR $8 >= (a.settings->>'hide_from_age_min')::int)
      AND (a.settings->>'hide_from_age_max' IS NULL OR $8 <= (a.settings->>'hide_from_age_max')::int)
      AND (NOT (a.safe_mode = 'on' OR a.safe_mode_active) OR ($5 AND NOT $7))
      #{remote_sql(v)}
      #{where}
    ORDER BY 18
    LIMIT 1500
    """

    %{rows: rows} = Repo.query!(sql, base_params ++ params)

    rows = Enum.map(rows, &row/1)
    rows = if radius, do: Enum.filter(rows, &(&1.dist_m <= radius)), else: rows

    rows =
      if radius && is_nil(filters[:distance_max]) do
        near = Enum.count(rows, &(&1.dist_m <= @near_m))

        if near >= @sparse,
          do: Enum.filter(rows, &(&1.dist_m <= @near_m)),
          else: Enum.map(rows, &Map.put(&1, :further, &1.dist_m > @near_m))
      else
        rows
      end

    rows |> enrich(v) |> post_filter(filters)
  end

  # F-20 R-20.17: looking around from afar never returns locals who opted out or are in Safe Mode.
  defp remote_sql(%{remote: true}),
    do:
      "AND COALESCE((a.settings->>'show_to_remote')::boolean, true) AND NOT (a.safe_mode = 'on' OR a.safe_mode_active)"

  defp remote_sql(_), do: ""

  defp row([
         id,
         name,
         age,
         gender,
         gother,
         fields,
         vis,
         seeded,
         aid,
         vat,
         ins,
         settings,
         level,
         dres,
         dcell,
         dlat,
         dlng,
         dist,
         ns,
         ntext,
         nat,
         key,
         r7,
         r5,
         upd,
         show_in
       ]) do
    [vat, ins, nat, upd] = Enum.map([vat, ins, nat, upd], &utc/1)

    %{
      id: id,
      display_name: name,
      age: age,
      gender: gender,
      gender_other: gother,
      fields: fields,
      vis: vis,
      seeded: seeded,
      account_id: aid,
      verified_at: vat,
      inserted_at: ins,
      settings: Map.merge(Settings.defaults(), settings || %{}),
      level: level,
      display_res: dres,
      dcell: dcell,
      dcell_lat: dlat,
      dcell_lng: dlng,
      dist_m: dist,
      now:
        if(ns,
          do: %{status: ns, text: ntext, fresh: DateTime.diff(DateTime.utc_now(), nat) < 600}
        ),
      photo_key: key,
      cell_r7: r7 && to_hex(r7),
      cell_r5: r5 && to_hex(r5),
      further: false,
      pin: nil,
      seen: nil,
      online: false,
      updated_at: upd,
      show_in: show_in || []
    }
  end

  def utc(nil), do: nil
  def utc(%NaiveDateTime{} = n), do: DateTime.from_naive!(n, "Etc/UTC")
  def utc(%DateTime{} = d), do: d

  def utc_any(%NaiveDateTime{} = n), do: utc(n)
  def utc_any(v), do: v

  defp to_hex(i) when is_integer(i), do: Integer.to_string(i, 16) |> String.downcase()

  # Pins (audience-checked) and online state from Valkey.
  defp enrich([], _v), do: []

  defp enrich(rows, v) do
    pins = rows |> Enum.filter(&(&1.level == "exact")) |> Enum.map(& &1.id) |> Location.pins()

    chats =
      if Enum.any?(pins, fn {_, p} -> p.audience == "chats" end) and v.profile_id,
        do: contacts_of(v.profile_id, Map.keys(pins)),
        else: MapSet.new()

    seen =
      rows
      |> Enum.map(& &1.account_id)
      |> Enum.uniq()
      |> then(fn ids ->
        Enum.zip(ids, Valkey.command!(["MGET" | Enum.map(ids, &("seen:" <> &1))]))
      end)
      |> Map.new(fn {id, t} -> {id, t && String.to_integer(t)} end)

    now = System.system_time(:second)
    see_online? = v.settings["online_visible"]

    pins_ok? =
      v.verified and not v.safe_mode and Map.get(v, :intents, [v.mode]) != ["sport"] and
        not Map.get(v, :remote, false)

    Enum.map(rows, fn r ->
      pin = if pins_ok?, do: allowed_pin(pins[r.id], r.id, v, chats)
      t = seen[r.account_id]
      shows_online? = see_online? and r.settings["online_visible"]

      r
      |> Map.put(:pin, pin)
      |> Map.put(:dist_m, if(pin, do: haversine(v.point, pin), else: r.dist_m))
      |> Map.put(:online, shows_online? and t != nil and now - t < @online_s)
      |> Map.put(:seen, if(shows_online?, do: t))
    end)
  end

  defp allowed_pin(nil, _id, _v, _chats), do: nil

  defp allowed_pin(pin, id, v, chats) do
    case pin.audience do
      "everyone" -> pin
      "verified" -> if v.verified, do: pin
      "chats" -> if MapSet.member?(chats, id), do: pin
      _ -> nil
    end
  end

  def contacts_of(profile_id, ids) do
    Repo.query!(
      """
      SELECT CASE WHEN profile_a = $1 THEN profile_b ELSE profile_a END::text FROM contacts
      WHERE (profile_a = $1 AND profile_b = ANY($2)) OR (profile_b = $1 AND profile_a = ANY($2))
      """,
      [dump(profile_id), Enum.map(ids, &dump/1)]
    ).rows
    |> List.flatten()
    |> MapSet.new()
  end

  defp post_filter(rows, f) do
    rows
    |> then(&if f[:online_now], do: Enum.filter(&1, fn r -> r.online end), else: &1)
  end

  # ------------------------------------------------------------------ filters (R-04.8)

  # filter key => {jsonb field, :enum | :multi}. Not `languages` (#106: chats translate on device instead).
  @field_filters %{
    position: {"position", :enum},
    hosting: {"hosting", :enum},
    tribes: {"tribes", :multi},
    build: {"build", :enum},
    looking_for: {"looking_for", :multi},
    sports: {"sports", :multi},
    sport_level: {"sport_level", :enum},
    schedule: {"schedule", :multi},
    sport_intent: {"sport_intent", :enum},
    orientation: {"orientation", :enum}
  }
  # hookup filters only for verified viewers (R-04.8) and only in the Hookup lens (R-06.1b)
  @verified_only ~w(position hosting)a
  @hookup_only ~w(position hosting)a
  # R-04.18: Sport filters only when Sport is the only intent (merged map, #113)
  @sport_only ~w(sports sport_level schedule sport_intent)a

  @doc "Parses query params into a filter map (all filters free, never HIV/ethnicity)."
  def parse_filters(params) do
    list = fn k ->
      case params[k] do
        nil -> nil
        "" -> nil
        s when is_binary(s) -> String.split(s, ",", trim: true)
        l when is_list(l) -> l
      end
    end

    int = fn k ->
      case params[k] do
        nil ->
          nil

        i when is_integer(i) ->
          i

        s ->
          case Integer.parse(to_string(s)) do
            {i, _} -> i
            _ -> nil
          end
      end
    end

    bool = fn k, default ->
      case params[k] do
        nil -> default
        v -> v in [true, "true", "1"]
      end
    end

    base = %{
      age_min: int.("age_min"),
      age_max: int.("age_max"),
      distance_max: (d = int.("distance_max")) && min(d, @far_m),
      verified_only: bool.("verified_only", true),
      online_now: bool.("online_now", false),
      has_now: bool.("has_now", false),
      hide_creators: bool.("hide_creators", true),
      new_members: bool.("new_members", false),
      # F-20 R-20.12: Filters › Show visitors
      visitors: bool.("visitors", true)
    }

    Enum.reduce(@field_filters, base, fn {k, _}, acc ->
      case list.(Atom.to_string(k)) do
        nil -> acc
        vals -> Map.put(acc, k, vals)
      end
    end)
  end

  defp filter_sql(v, f, _surface) do
    # numbered params continue after the 9 base params
    acc = {[], [], 10}

    add = fn {clauses, params, n}, clause_fun, value ->
      {[clause_fun.(n) | clauses], params ++ [value], n + 1}
    end

    acc = if f[:age_min], do: add.(acc, &"p.age >= $#{&1}", f.age_min), else: acc
    acc = if f[:age_max], do: add.(acc, &"p.age <= $#{&1}", f.age_max), else: acc

    {cl, pa, n} = acc
    cl = if f[:verified_only], do: ["a.verified_at IS NOT NULL" | cl], else: cl
    cl = if f[:has_now], do: ["ns.status IS NOT NULL" | cl], else: cl

    cl =
      if f[:hide_creators],
        do: ["NOT COALESCE((p.fields->>'creator')::boolean, false)" | cl],
        else: cl

    cl = if f[:new_members], do: ["a.inserted_at > now() - interval '14 days'" | cl], else: cl
    acc = {cl, pa, n}

    acc =
      case f[:cells] do
        {res, cells} ->
          col = if res == 5, do: "lc.cell_r5", else: "lc.cell_r7"
          add.(acc, &"#{col} = ANY($#{&1}::bigint[])", cells)

        _ ->
          acc
      end

    acc =
      Enum.reduce(@field_filters, acc, fn {k, {field, type}}, acc ->
        vals = f[k]

        cond do
          vals in [nil, []] ->
            acc

          not filter_allowed?(k, v) ->
            acc

          true ->
            default = Thirstr.Profiles.Fields.default_visibility(field)

            add.(
              acc,
              fn i ->
                match =
                  if type == :multi,
                    do: "p.fields->'#{field}' ?| $#{i}::text[]",
                    else: "p.fields->>'#{field}' = ANY($#{i}::text[])"

                "(#{match} AND (COALESCE(p.visibility_map->>'#{field}', '#{default}') = 'public' OR #{v.verified}))"
              end,
              vals
            )
        end
      end)

    {clauses, params, _} = acc
    where = Enum.map_join(Enum.reverse(clauses), "\n", &("      AND " <> &1))
    {where, params}
  end

  defp filter_allowed?(k, v) do
    not (k in @verified_only and not v.verified) and
      not (k in @hookup_only and Map.get(v, :lens, "hookup") != "hookup") and
      not (k in @sport_only and Map.get(v, :merged, false) and v.intents != ["sport"])
  end

  # ------------------------------------------------------------------ cards

  @doc "Card JSON (R-04.5). No account id, no raw coordinates (pins added by the caller)."
  def card(r, v) do
    viewer = if v.verified, do: :verified, else: :stranger
    {fields, _} = Thirstr.Profiles.Fields.visible(r.fields || %{}, r.vis || %{}, viewer)
    fields = Thirstr.Profiles.Fields.lens(fields, card_lens(r, v))

    %{
      id: r.id,
      display_name: r.display_name,
      age: r.age,
      verified: not is_nil(r.verified_at),
      photo: r.photo_key && Storage.presigned_get(r.photo_key),
      online: r.online,
      distance: if(Map.get(r, :visitor), do: nil, else: distance(r, v)),
      now: r.now,
      exact: not is_nil(r.pin),
      pin_expires_at: r.pin && r.pin.expires_at,
      further: r.further,
      creator: fields["creator"] == true,
      intent: fields["sport_intent"],
      position: fields["position"],
      new: DateTime.diff(DateTime.utc_now(), r.inserted_at, :day) < 14,
      intents: intents_of(Map.get(r, :show_in)),
      # F-20 R-20.13
      visitor: Map.get(r, :visitor, false),
      trip: Map.get(r, :trip)
    }
  end

  # R-04.18: the card's lens is his first intent (hookup → friends → sport) among the selected.
  defp card_lens(r, v) do
    case Map.get(v, :lens, "hookup") do
      "mixed" -> Enum.find(v.intents, "hookup", &(&1 in Map.get(r, :show_in, [])))
      l -> l
    end
  end

  @buckets [
    {200, "lt200"},
    {500, "200_500"},
    {1000, "500_1k"},
    {2000, "1_2k"},
    {5000, "2_5k"},
    {10_000, "5_10k"}
  ]

  @doc """
  R-04.6 (#197): rounded distance, step set by the shown person's precision (exact pin,
  r10, r9, r8/r7), rounded down so it never says more than the cell. `bucket` is kept for
  old builds and is the only value under the viewer's spoof brake (R-05.16) or when the
  owner chose `show_distance = range`.
  """
  def distance(r, v) do
    show = r.settings["show_distance"]

    cond do
      show == "none" ->
        nil

      r.level == "city" ->
        %{kind: "city", city: city_name(r.cell_r5)}

      r.pin && show == "exact" && v.verified ->
        %{kind: "exact", m: shown_m(r)}

      true ->
        d = if v.verified, do: r.dist_m, else: max(r.dist_m, 1000.0)
        b = Enum.find_value(@buckets, "10k_plus", fn {max, key} -> if d < max, do: key end)
        base = %{kind: "area", bucket: b, precise: Map.get(r, :display_res) == 10}

        if Map.get(v, :brake, false) or show == "range" do
          base
        else
          {m, floor?} =
            rounded(d, if(r.pin && show == "exact", do: 10, else: Map.get(r, :display_res, 9)))

          m = if v.verified, do: m, else: max(m, 1000)
          Map.merge(base, %{m: m, floor: floor? and v.verified, approx: true})
        end
    end
  end

  # Distance the card shows, in metres (sort key, R-04.4).
  defp shown_m(r) do
    res =
      if r.pin && r.settings["show_distance"] == "exact",
        do: :pin,
        else: Map.get(r, :display_res, 9)

    r.dist_m |> rounded(res) |> elem(0)
  end

  @doc "#197 R-04.6 steps. Returns {metres, floor?}; floor? = show as \"< metres\"."
  def rounded(d, res) when is_number(d) do
    {near, mid, far, min} =
      case res do
        r when r in [:pin, 15] -> {10, 100, 1000, 10}
        10 -> {50, 100, 1000, 100}
        9 -> {100, 500, 1000, 200}
        8 -> {1000, 500, 1000, 1000}
        _ -> {1000, 1000, 1000, 1000}
      end

    step =
      cond do
        d < 1000 -> near
        d < 10_000 -> mid
        true -> far
      end

    m = trunc(d / step) * step

    if m < min, do: {min, true}, else: {m, false}
  end

  @doc "City name for an r5 cell (nearest `cities` row), cached."
  def city_name(nil), do: nil

  def city_name(r5hex) do
    # v2 (#188): the catalogue grew to every city ≥ 15 000; prefer a big city (≥ 50 000) within
    # 15 km so suburbs don't replace the city people know.
    key = "cityname2:" <> r5hex

    case Valkey.command!(["GET", key]) do
      nil ->
        name =
          case Repo.query!(
                 """
                 SELECT name FROM (
                   SELECT name, population,
                          h3_great_circle_distance(point(lng, lat), h3_cell_to_lat_lng($1::text::h3index), 'm') AS d
                   FROM cities) c
                 ORDER BY CASE WHEN population >= 50000 AND d < 15000 THEN 0 ELSE 1 END, d LIMIT 1
                 """,
                 [r5hex]
               ).rows do
            [[n]] -> n
            _ -> ""
          end

        Valkey.command!(["SET", key, name, "EX", "86400"])
        name

      n ->
        n
    end
  end

  defp haversine(%{lat: la1, lng: lo1}, %{lat: la2, lng: lo2}) do
    r = 6_371_000
    dlat = (la2 - la1) * :math.pi() / 180
    dlng = (lo2 - lo1) * :math.pi() / 180

    a =
      :math.sin(dlat / 2) ** 2 +
        :math.cos(la1 * :math.pi() / 180) * :math.cos(la2 * :math.pi() / 180) *
          :math.sin(dlng / 2) ** 2

    2 * r * :math.asin(:math.sqrt(a))
  end

  defp parse_cursor(nil), do: 0

  defp parse_cursor(c) do
    case Integer.parse(to_string(c)) do
      {n, ""} when n >= 0 and n < 5000 -> n
      _ -> 0
    end
  end

  defp dump(uuid), do: Ecto.UUID.dump!(uuid)
end
