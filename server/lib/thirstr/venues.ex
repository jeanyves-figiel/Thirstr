defmodule Thirstr.Venues do
  @moduledoc """
  F-12 venues & check-in. Only current check-ins exist: rows are deleted at check-out, there is
  no history (AC-12.2). Only people checked in **and** visible see each other (R-12.3), and the
  "here" list needs the caller to be checked in (AC-12.1).
  """
  alias Thirstr.{Nearby, Profiles, Repo, Social}

  import Thirstr.Tonight, only: [check: 3]

  @kinds %{
    "hookup" => ~w(sauna bar club other),
    "friends" => ~w(bar club other),
    "sport" => ~w(gym)
  }
  @max_hours 4
  @near_checkin_m 1500
  # R-12.11 places added by members
  @member_kinds ~w(club bar sauna gym other)
  @per_day 3
  @dup_m 75

  @doc "GET /venues/nearby?mode — venues for the mode (R-12.7)."
  def nearby(ctx) do
    if is_nil(ctx.point) do
      {:ok, %{venues: [], checkin: my_checkin(ctx)}}
    else
      venues =
        Repo.query!(
          """
          SELECT v.id::text, v.name, v.kind, v.cell_r9, v.geofence_radius_m,
                 (SELECT count(*) FROM venue_checkins c WHERE c.venue_id = v.id AND c.auto_out_at > now()),
                 v.added_by = 'member'
          FROM venues v WHERE v.cell_r5 = ANY($1) AND v.kind = ANY($2) AND NOT v.hidden
          """,
          [Nearby.area(ctx, 2), Map.get(@kinds, ctx.mode, @kinds["hookup"])]
        ).rows
        |> Nearby.utc()
        |> tap(&Nearby.warm(Enum.map(&1, fn r -> Enum.at(r, 3) end)))
        |> Enum.map(fn [id, name, kind, cell, r, n, member] ->
          d = Nearby.dist_m(ctx, cell)

          %{
            id: id,
            name: name,
            kind: kind,
            geofence_radius_m: r,
            here: count_label(n),
            member: member,
            area_cell: Integer.to_string(cell, 16) |> String.downcase(),
            distance: Nearby.bucket(d),
            dist: d
          }
        end)
        |> Enum.sort_by(& &1.dist)
        |> Enum.map(&Map.delete(&1, :dist))

      {:ok, %{venues: venues, checkin: my_checkin(ctx)}}
    end
  end

  # R-12.5: counts under 5 are shown as "a few".
  defp count_label(0), do: "0"
  defp count_label(n) when n < 5, do: "a_few"
  defp count_label(n), do: Integer.to_string(n)

  defp my_checkin(ctx) do
    case Repo.query!(
           """
           SELECT c.venue_id::text, v.name, c.visible, c.zone, c.checked_in_at, c.auto_out_at
           FROM venue_checkins c JOIN venues v ON v.id = c.venue_id
           WHERE c.profile_id = ANY($1) AND c.auto_out_at > now()
           """,
           [Enum.map(ctx.own_ids, &Nearby.dump/1)]
         ).rows do
      [[vid, name, vis, zone, at, out] | _] ->
        %{
          venue_id: vid,
          name: name,
          visible: vis,
          zone: zone,
          checked_in_at: at,
          auto_out_at: out
        }

      _ ->
        nil
    end
  end

  defp venue(id) do
    with {:ok, _} <- Ecto.UUID.cast(id),
         [[name, kind, cell, r, hidden, by, creator]] <-
           Repo.query!(
             "SELECT name, kind, cell_r9, geofence_radius_m, hidden, added_by, created_by::text FROM venues WHERE id = $1",
             [Nearby.dump(id)]
           ).rows do
      {:ok,
       %{
         id: id,
         name: name,
         kind: kind,
         cell: cell,
         radius: r,
         hidden: hidden,
         member: by == "member",
         creator: creator
       }}
    else
      _ -> {:error, :not_found}
    end
  end

  @doc "POST /venues/:id/checkin {visible, zone} — verified, not in Safe Mode (R-12.2, R-12.8)."
  def checkin(ctx, id, params) do
    zone = params["zone"] && String.slice(String.trim(to_string(params["zone"])), 0, 40)

    with :ok <- Social.require_verified(ctx.account),
         :ok <- check(not ctx.safe_mode, :safe_mode, "check-in is off in Safe Mode"),
         {:ok, v} <- venue(id),
         :ok <- if(v.hidden, do: {:error, :not_found}, else: :ok),
         %{} = p <- Profiles.main(ctx.account) || {:error, :basics_required},
         :ok <- Nearby.require_point(ctx),
         :ok <-
           check(
             (Nearby.dist_m(ctx, v.cell) || 1.0e9) <= @near_checkin_m,
             :venue,
             "you need to be at the venue"
           ) do
      own = Enum.map(ctx.own_ids, &Nearby.dump/1)
      Repo.query!("DELETE FROM venue_checkins WHERE profile_id = ANY($1)", [own])

      Repo.query!(
        """
        INSERT INTO venue_checkins (venue_id, profile_id, visible, zone, checked_in_at, auto_out_at)
        VALUES ($1, $2, $3, $4, now(), now() + make_interval(hours => $5))
        """,
        [
          Nearby.dump(v.id),
          Nearby.dump(p.id),
          params["visible"] != false,
          blank(zone),
          @max_hours
        ]
      )

      diff(v.id)
      here(ctx, v.id)
    end
  end

  @doc "PATCH /venues/:id/checkin {visible?, zone?} — e.g. Go invisible (R-12.6)."
  def update_checkin(ctx, id, params) do
    with {:ok, v} <- venue(id) do
      own = Enum.map(ctx.own_ids, &Nearby.dump/1)

      if is_boolean(params["visible"]),
        do:
          Repo.query!(
            "UPDATE venue_checkins SET visible = $3 WHERE venue_id = $1 AND profile_id = ANY($2)",
            [Nearby.dump(v.id), own, params["visible"]]
          )

      if Map.has_key?(params, "zone"),
        do:
          Repo.query!(
            "UPDATE venue_checkins SET zone = $3 WHERE venue_id = $1 AND profile_id = ANY($2)",
            [
              Nearby.dump(v.id),
              own,
              blank(params["zone"] && String.slice(to_string(params["zone"]), 0, 40))
            ]
          )

      diff(v.id)
      here(ctx, v.id)
    end
  end

  def checkout(ctx) do
    rows =
      Repo.query!(
        "DELETE FROM venue_checkins WHERE profile_id = ANY($1) RETURNING venue_id::text",
        [
          Enum.map(ctx.own_ids, &Nearby.dump/1)
        ]
      ).rows
      |> Nearby.utc()

    Enum.each(List.flatten(rows), &diff/1)
    :ok
  end

  @doc "GET /venues/:id/here (S-17). 403 unless the caller is checked in here (AC-12.1)."
  def here(ctx, id) do
    with {:ok, v} <- venue(id) do
      own = Enum.map(ctx.own_ids, &Nearby.dump/1)

      case Repo.query!(
             "SELECT profile_id::text, visible FROM venue_checkins WHERE venue_id = $1 AND profile_id = ANY($2) AND auto_out_at > now()",
             [Nearby.dump(v.id), own]
           ).rows do
        [[me, visible]] ->
          rows =
            Repo.query!(
              """
              SELECT c.profile_id::text, c.zone, c.checked_in_at, c.visible,
                     EXISTS (SELECT 1 FROM taps t WHERE t.from_profile_id = c.profile_id AND t.to_profile_id = ANY($2))
              FROM venue_checkins c WHERE c.venue_id = $1 AND c.auto_out_at > now() AND c.profile_id <> $3
              ORDER BY c.checked_in_at DESC
              """,
              [Nearby.dump(v.id), own, Nearby.dump(me)]
            ).rows
            |> Nearby.utc()
            |> Nearby.utc()

          seen = if visible, do: Enum.filter(rows, &Enum.at(&1, 3)), else: []
          cards = Nearby.people(ctx, Enum.map(seen, &hd/1))

          people =
            for [pid, zone, at, _, tapped] <- seen,
                cards[pid],
                do: %{profile: cards[pid], zone: zone, since: at, tapped_me: tapped}

          mine = v.member and v.creator == ctx.account.id

          {:ok,
           %{
             venue: %{
               id: v.id,
               name: v.name,
               kind: v.kind,
               member: v.member,
               mine: mine,
               # R-12.11: the creator can remove it while nobody else is checked in
               removable: mine and rows == []
             },
             me: %{profile_id: me, visible: visible},
             stats: %{
               total: count_label(length(rows) + 1),
               visible_to_you: length(people),
               tapped_you: Enum.count(people, & &1.tapped_me)
             },
             people: people
           }}

        _ ->
          {:error, {:forbidden, "Check in to see who is here"}}
      end
    end
  end

  @doc """
  POST /venues {name, kind, lat, lng, visible?, zone?} (R-12.11): a member adds a place exactly
  where they are and is checked in. No review before: it is live for everyone at once; the team
  can hide or delete it later (A-07b). The creator is never shown to others.
  """
  def create(ctx, params) do
    name = params["name"] |> to_string() |> String.trim() |> String.replace(~r/\s+/u, " ")
    kind = params["kind"]

    with :ok <- Social.require_verified(ctx.account),
         :ok <- check(not ctx.safe_mode, :safe_mode, "check-in is off in Safe Mode"),
         %{} <- Profiles.main(ctx.account) || {:error, :basics_required},
         :ok <- Nearby.require_point(ctx),
         :ok <- check(String.length(name) in 2..60, :name, "2 to 60 characters"),
         :ok <- check(not Regex.match?(~r"://|www\.|@|\d{6,}"iu, name), :name, "just the name"),
         :ok <- check(kind in @member_kinds, :kind, "club, bar, sauna, gym or other"),
         {:ok, pt} <- coords(params),
         :ok <-
           check(
             Thirstr.Places.haversine(ctx.point, pt) <= @near_checkin_m,
             :location,
             "you need to be there"
           ),
         :ok <- daily_limit(ctx.account.id),
         nil <- duplicate(name, pt) do
      id = Ecto.UUID.generate()

      Repo.query!(
        """
        INSERT INTO venues (id, name, kind, lat, lng, cell_r9, cell_r5, added_by, created_by, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'member', $8, now(), now())
        """,
        [
          Nearby.dump(id),
          name,
          kind,
          pt.lat,
          pt.lng,
          Nearby.cell(pt, 9),
          Nearby.cell(pt, 5),
          Nearby.dump(ctx.account.id)
        ]
      )

      case checkin(ctx, id, params) do
        {:ok, here} ->
          {:ok, here}

        err ->
          Repo.query!("DELETE FROM venues WHERE id = $1", [Nearby.dump(id)])
          err
      end
    else
      %{id: _, name: _} = existing -> {:error, {:place_exists, existing}}
      err -> err
    end
  end

  # ~1 m precision is plenty; the place is pinned where the member stands.
  defp coords(%{"lat" => lat, "lng" => lng})
       when is_number(lat) and is_number(lng) and lat >= -85 and lat <= 85 and lng >= -180 and
              lng <= 180,
       do: {:ok, %{lat: Float.round(lat * 1.0, 5), lng: Float.round(lng * 1.0, 5)}}

  defp coords(_), do: {:error, {:validation, %{location: ["turn on location"]}}}

  defp daily_limit(account_id) do
    [[n]] =
      Repo.query!(
        "SELECT count(*) FROM venues WHERE created_by = $1 AND created_at > now() - interval '24 hours'",
        [Nearby.dump(account_id)]
      ).rows

    if n < @per_day,
      do: :ok,
      else: {:error, {:validation, %{name: ["you can add #{@per_day} places a day"]}}}
  end

  # Same place already listed: a similar name within 75 m (any source, not hidden).
  defp duplicate(name, %{lat: lat, lng: lng}) do
    dlat = @dup_m / 111_320
    dlng = dlat / max(:math.cos(lat * :math.pi() / 180), 0.01)
    key = norm(name)

    Repo.query!(
      """
      SELECT id::text, name, kind, lat, lng FROM venues
      WHERE NOT hidden AND lat BETWEEN $1 AND $2 AND lng BETWEEN $3 AND $4
      """,
      [lat - dlat, lat + dlat, lng - dlng, lng + dlng]
    ).rows
    |> Enum.find_value(fn [id, n, k, la, lo] ->
      other = norm(n)

      if Thirstr.Places.haversine(%{lat: lat, lng: lng}, %{lat: la, lng: lo}) <= @dup_m and
           other != "" and (String.contains?(other, key) or String.contains?(key, other)),
         do: %{id: id, name: n, kind: k}
    end)
  end

  defp norm(s) do
    s
    |> String.normalize(:nfd)
    |> String.replace(~r/\p{Mn}/u, "")
    |> String.downcase()
    |> String.replace(~r/[^\p{L}\p{N}]/u, "")
  end

  @doc "DELETE /venues/:id — the creator removes their place while nobody else is checked in."
  def remove(ctx, id) do
    with {:ok, v} <- venue(id),
         true <- (v.member and v.creator == ctx.account.id) || {:error, :forbidden},
         [[0]] <-
           Repo.query!(
             "SELECT count(*) FROM venue_checkins WHERE venue_id = $1 AND NOT (profile_id = ANY($2)) AND auto_out_at > now()",
             [Nearby.dump(v.id), Enum.map(ctx.own_ids, &Nearby.dump/1)]
           ).rows do
      Repo.query!("DELETE FROM venues WHERE id = $1", [Nearby.dump(v.id)])
      diff(v.id)
      :ok
    else
      [[_]] -> {:error, {:conflict, "Someone else is checked in here"}}
      err -> err
    end
  end

  # venue:{id} here.diff (counts only; clients refetch the list).
  defp diff(id),
    do: Phoenix.PubSub.broadcast(Thirstr.PubSub, "venue:" <> id, {:event, "here.diff", %{}})

  @doc "Auto check-out after 4 h (R-12.6); leaving the geofence is detected by the app."
  def sweep do
    Repo.query!("DELETE FROM venue_checkins WHERE auto_out_at < now() RETURNING venue_id::text").rows
    |> Nearby.utc()
    |> Nearby.utc()
    |> List.flatten()
    |> Enum.uniq()
    |> Enum.each(&diff/1)
  end

  defp blank(nil), do: nil
  defp blank(""), do: nil
  defp blank(s), do: s

  @doc "Is this account checked in at venue `id` (channel join)?"
  def checked_in?(ctx, id) do
    match?({:ok, _}, here(ctx, id))
  end
end
