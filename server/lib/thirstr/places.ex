defmodule Thirstr.Places do
  @moduledoc """
  #113 place layers on the Explore map (F-04 R-04.20): catalogue venues (F-12 R-12.9), official
  parties (F-10 R-10.10) and hosted parties (R-10.11), by viewport.

  Privacy: the client only ever sends its viewport to our API. Venues and official parties are
  public businesses at their own coordinates; hosted parties are shown at their r8 cell centroid
  and only to viewers `GET /parties` would show them to (AC-10.1). Safe Mode → nothing (F-14).
  """
  alias Thirstr.{Nearby, Repo}

  @kinds ~w(clubs saunas parties gyms)
  @venue_kinds %{"clubs" => ~w(club bar other), "saunas" => ~w(sauna), "gyms" => ~w(gym)}
  @max 150
  @max_span 0.5
  # Official parties show from 12 h before start until the end (R-10.10).
  @lead_h 12

  def kinds, do: @kinds

  @doc "GET /places?bbox=w,s,e,n&kinds=… (api.md)."
  def list(ctx, bbox, kinds) do
    kinds = parse_kinds(kinds)

    with {:ok, {w, s, e, n}} <- parse_bbox(bbox) do
      cond do
        ctx.safe_mode -> {:ok, %{places: []}}
        e - w > @max_span or n - s > @max_span -> {:ok, %{places: []}}
        true -> {:ok, %{places: collect(ctx, {w, s, e, n}, kinds)}}
      end
    end
  end

  defp collect(ctx, {w, s, e, n} = box, kinds) do
    centre = %{lat: (s + n) / 2, lng: (w + e) / 2}
    vkinds = kinds |> Enum.flat_map(&Map.get(@venue_kinds, &1, [])) |> Enum.uniq()

    venues = if vkinds == [], do: [], else: venues(ctx, box, vkinds)
    events = if "parties" in kinds, do: events(ctx, box), else: []
    hosted = if "parties" in kinds, do: hosted(ctx, {w, s, e, n}), else: []

    (venues ++ events ++ hosted)
    |> Enum.sort_by(&haversine(centre, &1))
    |> Enum.take(@max)
  end

  defp venues(ctx, {w, s, e, n}, kinds) do
    Repo.query!(
      """
      SELECT v.id::text, v.name, v.kind, v.lat, v.lng, v.hours_text, v.ext_id,
             (SELECT count(*) FROM venue_checkins c WHERE c.venue_id = v.id AND c.auto_out_at > now()),
             v.added_by
      FROM venues v
      WHERE NOT v.hidden AND v.lat BETWEEN $1 AND $2 AND v.lng BETWEEN $3 AND $4
        AND v.kind = ANY($5)
      LIMIT 2000
      """,
      [s, n, w, e, kinds]
    ).rows
    |> Enum.map(fn [id, name, kind, lat, lng, hours, ext, here, by] ->
      %{
        id: id,
        type: "venue",
        kind: kind,
        name: name,
        lat: lat,
        lng: lng,
        hours: hours,
        here: here_label(here),
        distance: distance(ctx, lat, lng),
        source: venue_source(ext, by)
      }
    end)
  end

  # R-12.11: "member" = added by a member (label "Added by a member"; the creator is never shown).
  defp venue_source(ext, _) when is_binary(ext), do: "osm"
  defp venue_source(_, "member"), do: "member"
  defp venue_source(_, _), do: "team"

  defp events(ctx, {w, s, e, n}) do
    Repo.query!(
      """
      SELECT ev.id::text, ev.title, ev.starts_at, ev.ends_at, ev.url, v.id::text, v.name, v.lat, v.lng
      FROM events ev JOIN venues v ON v.id = ev.venue_id
      WHERE NOT v.hidden AND ev.ends_at > now() AND ev.starts_at < now() + make_interval(hours => $5)
        AND v.lat BETWEEN $1 AND $2 AND v.lng BETWEEN $3 AND $4
      ORDER BY ev.starts_at LIMIT 300
      """,
      [s, n, w, e, @lead_h]
    ).rows
    |> Enum.map(fn [id, title, st, en, url, vid, vname, lat, lng] ->
      %{
        id: id,
        type: "event",
        kind: "official",
        name: title,
        lat: lat,
        lng: lng,
        starts_at: utc(st),
        ends_at: utc(en),
        url: url,
        venue_id: vid,
        venue_name: vname,
        distance: distance(ctx, lat, lng),
        source: "team"
      }
    end)
  end

  # R-10.11: exactly the parties GET /parties shows this viewer, at their r8 centroid.
  defp hosted(ctx, {w, s, e, n}) do
    {:ok, %{parties: parties}} = Thirstr.Parties.list(ctx)

    parties
    |> Enum.filter(&(&1.status in ~w(open full live)))
    |> Enum.map(fn p ->
      {lat, lng} = centroid(p.area_cell)

      %{
        id: p.id,
        type: "party",
        kind: "hosted",
        name: p.title,
        lat: lat,
        lng: lng,
        starts_at: p.starts_at,
        ends_at: p.ends_at,
        distance: p.distance,
        seats: %{taken: p.seats_taken, capacity: p.capacity},
        source: "member"
      }
    end)
    |> Enum.filter(&(&1.lat >= s and &1.lat <= n and &1.lng >= w and &1.lng <= e))
  end

  defp centroid(hex) do
    [[lat, lng]] =
      Repo.query!(
        "SELECT (h3_cell_to_lat_lng($1::text::h3index))[1], (h3_cell_to_lat_lng($1::text::h3index))[0]",
        [hex]
      ).rows

    {lat, lng}
  end

  @doc "Kinds param → known kinds (default: clubs, saunas, parties)."
  def parse_kinds(nil), do: ~w(clubs saunas parties)

  def parse_kinds(s) when is_binary(s),
    do: Enum.filter(@kinds, &(&1 in String.split(s, ",", trim: true)))

  def parse_kinds(_), do: ~w(clubs saunas parties)

  defp parse_bbox(s) when is_binary(s) do
    with [w, so, e, n] <- String.split(s, ","),
         {w, ""} <- Float.parse(w),
         {so, ""} <- Float.parse(so),
         {e, ""} <- Float.parse(e),
         {n, ""} <- Float.parse(n),
         true <- w < e and so < n do
      {:ok, {w, so, e, n}}
    else
      _ -> {:error, {:validation, %{bbox: ["w,s,e,n in degrees"]}}}
    end
  end

  defp parse_bbox(_), do: {:error, {:validation, %{bbox: ["required"]}}}

  # R-12.5 labels; nothing at 0.
  defp here_label(0), do: nil
  defp here_label(n) when n < 5, do: "a_few"
  defp here_label(n), do: Integer.to_string(n)

  defp distance(%{point: nil}, _, _), do: nil
  defp distance(%{point: p}, lat, lng), do: Nearby.bucket(haversine(p, %{lat: lat, lng: lng}))

  @doc false
  def haversine(%{lat: la1, lng: lo1}, %{lat: la2, lng: lo2}) do
    r = 6_371_000
    dlat = (la2 - la1) * :math.pi() / 180
    dlng = (lo2 - lo1) * :math.pi() / 180

    a =
      :math.sin(dlat / 2) ** 2 +
        :math.cos(la1 * :math.pi() / 180) * :math.cos(la2 * :math.pi() / 180) *
          :math.sin(dlng / 2) ** 2

    2 * r * :math.asin(:math.sqrt(a))
  end

  defp utc(%NaiveDateTime{} = n), do: DateTime.from_naive!(n, "Etc/UTC")
  defp utc(d), do: d

  # ------------------------------------------------------------------ admin (A-07b)

  @doc "Admin console summary: counts by source and kind, last import, upcoming parties."
  def admin_summary do
    counts =
      Repo.query!("""
      SELECT CASE WHEN ext_id IS NOT NULL THEN 'osm' ELSE added_by END, kind, count(*), count(*) FILTER (WHERE hidden)
      FROM venues GROUP BY 1, 2 ORDER BY 1, 2
      """).rows

    last =
      Repo.query!(
        "SELECT started_at, finished_at, added, updated, removed, error FROM place_imports ORDER BY id DESC LIMIT 1"
      ).rows

    events =
      Repo.query!("""
      SELECT ev.id::text, ev.title, ev.starts_at, ev.ends_at, v.name FROM events ev
      JOIN venues v ON v.id = ev.venue_id WHERE ev.ends_at > now() ORDER BY ev.starts_at LIMIT 100
      """).rows

    %{counts: counts, last: List.first(last), events: events}
  end

  @doc "Venues matching a name (admin search), max 20."
  def search(q) when is_binary(q) and byte_size(q) >= 2 do
    Repo.query!(
      """
      SELECT v.id::text, v.name, v.kind, v.hidden, coalesce(c.name, '')
      FROM venues v
      LEFT JOIN LATERAL (SELECT name FROM cities ORDER BY point(lng, lat) <-> point(v.lng, v.lat) LIMIT 1) c ON v.lat IS NOT NULL
      WHERE v.name ILIKE $1 ORDER BY v.name LIMIT 20
      """,
      ["%" <> String.replace(q, ~r/[%_\\]/, "") <> "%"]
    ).rows
  end

  def search(_), do: []

  @doc "Places added by members (R-12.11), newest first, for review after the fact (A-07b)."
  def member_places(limit \\ 50) do
    Repo.query!(
      """
      SELECT v.id::text, v.name, v.kind, v.hidden, v.created_at, v.lat, v.lng, coalesce(c.name, ''),
             (SELECT count(*) FROM venue_checkins k WHERE k.venue_id = v.id AND k.auto_out_at > now())
      FROM venues v
      LEFT JOIN LATERAL (SELECT name FROM cities ORDER BY point(lng, lat) <-> point(v.lng, v.lat) LIMIT 1) c ON true
      WHERE v.added_by = 'member' ORDER BY v.created_at DESC LIMIT $1
      """,
      [limit]
    ).rows
  end

  @doc "Team deletes a venue (check-ins and parties go with it)."
  def delete_venue(id) do
    with {:ok, _} <- Ecto.UUID.cast(id) do
      Repo.query!("DELETE FROM venues WHERE id = $1", [Nearby.dump(id)])
      Phoenix.PubSub.broadcast(Thirstr.PubSub, "venue:" <> id, {:event, "here.diff", %{}})
      :ok
    end
  end

  def set_hidden(id, hidden) do
    with {:ok, _} <- Ecto.UUID.cast(id) do
      Repo.query!("UPDATE venues SET hidden = $2 WHERE id = $1", [Nearby.dump(id), hidden])
      :ok
    end
  end

  @doc "Add an official party (R-10.10)."
  def add_event(%{"venue_id" => vid, "title" => title} = p) do
    with {:ok, _} <- Ecto.UUID.cast(vid),
         t when byte_size(t) in 1..60 <- String.trim(title || ""),
         {:ok, st} <- dt(p["starts_at"]),
         {:ok, en} <- dt(p["ends_at"]),
         true <- DateTime.compare(en, st) == :gt and DateTime.diff(en, st) <= 24 * 3600,
         url when url in [nil, ""] or binary_part(url, 0, 8) == "https://" <-
           blank(p["url"]) do
      Repo.query!(
        """
        INSERT INTO events (id, venue_id, title, starts_at, ends_at, url, created_at)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now())
        """,
        [Nearby.dump(vid), t, st, en, url]
      )

      :ok
    else
      _ -> {:error, :invalid}
    end
  end

  def add_event(_), do: {:error, :invalid}

  def remove_event(id) do
    with {:ok, _} <- Ecto.UUID.cast(id) do
      Repo.query!("DELETE FROM events WHERE id = $1", [Nearby.dump(id)])
      :ok
    end
  end

  defp blank(nil), do: nil
  defp blank(s), do: if(String.trim(s) == "", do: nil, else: String.trim(s))

  # datetime-local inputs come without zone: read as UTC (admin page says so).
  defp dt(nil), do: :error

  defp dt(s) do
    s = if String.length(s) == 16, do: s <> ":00", else: s

    case DateTime.from_iso8601(s) do
      {:ok, d, _} ->
        {:ok, d}

      _ ->
        case NaiveDateTime.from_iso8601(s) do
          {:ok, n} -> {:ok, DateTime.from_naive!(n, "Etc/UTC")}
          _ -> :error
        end
    end
  end
end
