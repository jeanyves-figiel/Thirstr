defmodule Thirstr.Activities do
  @moduledoc """
  F-11 Sport mode: activity posts with RSVPs (and an MLS group chat per post), clubs with
  members and club events. Sport mode never returns hookup content (R-11.9, AC-11.2):
  only `sport` profiles are used here.
  """
  alias Thirstr.{Nearby, Profiles, Repo, Social}
  alias Thirstr.Accounts.Account
  alias Thirstr.Moderation.Text
  alias Thirstr.Profiles.Fields

  import Thirstr.Tonight, only: [check: 3, parse_time: 1]

  @intents ~w(just_sport open_to_more)
  @audiences ~w(verified everyone)

  # R-11.1: activities need Sport turned on (show_in), F-06 R-06.1a.
  defp sport_profile(ctx) do
    case Profiles.main(ctx.account) do
      %{show_in: show_in} = p when is_list(show_in) ->
        if "sport" in show_in,
          do: {:ok, p.id},
          else: {:error, {:conflict_code, "sport_off", "Turn on Sport in Me first"}}

      _ ->
        {:error, :basics_required}
    end
  end

  defp clean?(t), do: not (Text.contact_details?(t) or Text.link?(t))

  # ------------------------------------------------------------------ posts

  @doc "GET /activities?sports=a,b — today and upcoming posts nearby, by start then distance (R-11.5)."
  def list(ctx, params) do
    sports = (params["sports"] || "") |> String.split(",", trim: true)

    if is_nil(ctx.point) do
      {:ok, %{posts: []}}
    else
      own = Enum.map(ctx.own_ids, &Nearby.dump/1)

      rows =
        Repo.query!(
          """
          SELECT ap.id::text, ap.profile_id::text, ap.sport, ap.title, ap.place_text, ap.starts_at,
                 ap.capacity, ap.audience, ap.intent, ap.cell_r8, c.id::text, c.name, v.name,
                 (SELECT count(*) FROM activity_rsvps r WHERE r.post_id = ap.id AND r.state = 'joined'),
                 (SELECT r.state FROM activity_rsvps r WHERE r.post_id = ap.id AND r.profile_id = ANY($2))
          FROM activity_posts ap
          JOIN profiles p ON p.id = ap.profile_id AND 'sport' = ANY(p.show_in)
          LEFT JOIN clubs c ON c.id = ap.club_id
          LEFT JOIN venues v ON v.id = ap.venue_id
          WHERE ap.cell_r5 = ANY($1) AND ap.expires_at > now()
            AND (cardinality($3::text[]) = 0 OR ap.sport = ANY($3))
          ORDER BY ap.starts_at LIMIT 300
          """,
          [Nearby.area(ctx, 2), own, sports]
        ).rows
        |> Nearby.utc()
        |> Nearby.utc()

      rows =
        Enum.filter(rows, fn r ->
          Enum.at(r, 7) == "everyone" or ctx.verified or Enum.at(r, 1) in ctx.own_ids
        end)

      people = Nearby.people(ctx, Enum.map(rows, &Enum.at(&1, 1)))
      Nearby.warm(Enum.map(rows, &Enum.at(&1, 9)))

      posts =
        rows
        |> Enum.filter(&Map.has_key?(people, Enum.at(&1, 1)))
        |> Enum.map(&post_json(ctx, &1, people))
        |> Enum.sort_by(&{DateTime.to_unix(&1.starts_at), &1.dist})
        |> Enum.map(&Map.delete(&1, :dist))

      {:ok, %{posts: posts}}
    end
  end

  defp post_json(
         ctx,
         [id, pid, sport, title, place, s, cap, aud, intent, cell, cid, cname, vname, joined, my],
         people
       ) do
    d = Nearby.dist_m(ctx, cell)

    %{
      id: id,
      host: people[pid],
      sport: sport,
      title: title,
      place: vname || place,
      starts_at: s,
      capacity: cap,
      joined: joined,
      audience: aud,
      intent: intent,
      club: cid && %{id: cid, name: cname},
      distance: Nearby.bucket(d),
      my_state: if(pid in ctx.own_ids, do: "host", else: my),
      dist: d || 0
    }
  end

  @doc "POST /activities (R-11.3): max 3 active, expires start + 3 h."
  def create(ctx, params) do
    title = String.trim(params["title"] || "")
    place = String.trim(params["place_text"] || "")
    s = parse_time(params["starts_at"])
    cap = params["capacity"]
    club = params["club_id"]
    now = DateTime.utc_now()

    with :ok <- Social.require_verified(ctx.account),
         {:ok, pid} <- sport_profile(ctx),
         :ok <- Nearby.require_point(ctx),
         :ok <- validate_post(params, title, place, s, cap, now),
         :ok <- check(is_nil(club) or club_admin?(pid, club), :club_id, "club admins only"),
         :ok <- check(active_posts(pid) < 3, :posts, "max 3 active posts") do
      id = Ecto.UUID.generate()

      Repo.query!(
        """
        INSERT INTO activity_posts (id, profile_id, club_id, venue_id, sport, title, place_text, starts_at,
          capacity, audience, intent, cell_r8, cell_r5, expires_at, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $8::timestamp + interval '3 hours', now())
        """,
        [
          Nearby.dump(id),
          Nearby.dump(pid),
          club && Nearby.dump(club),
          venue(params["venue_id"]),
          params["sport"],
          title,
          if(place == "", do: nil, else: place),
          s,
          cap,
          params["audience"] || "verified",
          params["intent"] || "just_sport",
          Nearby.cell(ctx.point, 8),
          ctx.r5
        ]
      )

      {:ok, %{id: id}}
    end
  end

  defp validate_post(params, title, place, s, cap, now) do
    with :ok <- check(params["sport"] in Fields.sports(), :sport, "invalid"),
         :ok <-
           check(
             title != "" and String.length(title) <= 80 and clean?(title),
             :title,
             "1–80 characters, no contact details"
           ),
         :ok <-
           check(String.length(place) <= 80 and clean?(place), :place_text, "max 80 characters"),
         :ok <-
           check(
             s && DateTime.diff(s, now) > -1800 and DateTime.diff(s, now) < 14 * 86_400,
             :starts_at,
             "within the next 14 days"
           ),
         :ok <- check(is_nil(cap) or (is_integer(cap) and cap in 2..100), :capacity, "2–100"),
         :ok <- check((params["intent"] || "just_sport") in @intents, :intent, "invalid") do
      check((params["audience"] || "verified") in @audiences, :audience, "invalid")
    end
  end

  defp venue(nil), do: nil

  defp venue(id) do
    case Ecto.UUID.cast(id) do
      {:ok, _} -> Nearby.dump(id)
      _ -> nil
    end
  end

  defp active_posts(pid) do
    [[n]] =
      Repo.query!(
        "SELECT count(*) FROM activity_posts WHERE profile_id = $1 AND expires_at > now() AND club_id IS NULL",
        [
          Nearby.dump(pid)
        ]
      ).rows
      |> Nearby.utc()
      |> Nearby.utc()

    n
  end

  defp post(id) do
    with {:ok, _} <- Ecto.UUID.cast(id),
         [[pid, cap, exp]] <-
           Repo.query!(
             "SELECT profile_id::text, capacity, expires_at > now() FROM activity_posts WHERE id = $1",
             [
               Nearby.dump(id)
             ]
           ).rows do
      {:ok, %{host: pid, capacity: cap, live: exp}}
    else
      _ -> {:error, :not_found}
    end
  end

  @doc "POST /activities/:id/rsvp {join: bool} (R-11.4)."
  def rsvp(ctx, id, join) do
    with {:ok, pid} <- sport_profile(ctx),
         {:ok, p} <- post(id),
         :ok <- check(p.live, :post, "ended"),
         :ok <- check(p.host != pid, :post, "your own post"),
         {:ok, _} <- Social.target(ctx.account, p.host) |> found() do
      if join do
        Repo.transaction(fn ->
          Repo.query!("SELECT 1 FROM activity_posts WHERE id = $1 FOR UPDATE", [Nearby.dump(id)])

          [[n]] =
            Repo.query!(
              "SELECT count(*) FROM activity_rsvps WHERE post_id = $1 AND state = 'joined'",
              [Nearby.dump(id)]
            ).rows
            |> Nearby.utc()
            |> Nearby.utc()

          if p.capacity && n >= p.capacity, do: Repo.rollback({:validation, %{post: ["full"]}})

          Repo.query!(
            """
            INSERT INTO activity_rsvps (post_id, profile_id, state, created_at) VALUES ($1, $2, 'joined', now())
            ON CONFLICT (post_id, profile_id) DO UPDATE SET state = 'joined' WHERE activity_rsvps.state <> 'removed'
            """,
            [Nearby.dump(id), Nearby.dump(pid)]
          )
        end)
        |> case do
          {:ok, _} ->
            Thirstr.Parties.notify_profile(p.host, "activity.join")
            :ok

          e ->
            e
        end
      else
        Repo.query!(
          "DELETE FROM activity_rsvps WHERE post_id = $1 AND profile_id = $2 AND state = 'joined'",
          [
            Nearby.dump(id),
            Nearby.dump(pid)
          ]
        )

        :ok
      end
    end
  end

  defp found({:ok, t}), do: {:ok, t}
  defp found(_), do: {:error, :not_found}

  @doc "GET /activities/:id/members — host + joined (cards), for the group chat and host removal."
  def members(ctx, id) do
    with {:ok, p} <- post(id) do
      ids = Thirstr.Groups.members("activity:" <> id)

      if Enum.any?(ctx.own_ids, &(&1 in ids)) do
        cards = Nearby.people(ctx, ids)
        {:ok, %{host: p.host, members: Enum.map(ids, &cards[&1]) |> Enum.reject(&is_nil/1)}}
      else
        {:error, :forbidden}
      end
    end
  end

  def remove(ctx, id, member) do
    with {:ok, p} <- post(id),
         :ok <- if(p.host in ctx.own_ids, do: :ok, else: {:error, :forbidden}),
         {:ok, _} <- Ecto.UUID.cast(member) |> found() do
      Repo.query!(
        "UPDATE activity_rsvps SET state = 'removed' WHERE post_id = $1 AND profile_id = $2",
        [
          Nearby.dump(id),
          Nearby.dump(member)
        ]
      )

      :ok
    end
  end

  def delete(ctx, id) do
    with {:ok, p} <- post(id),
         :ok <- if(p.host in ctx.own_ids, do: :ok, else: {:error, :forbidden}) do
      Repo.query!("DELETE FROM activity_posts WHERE id = $1", [Nearby.dump(id)])
      :ok
    end
  end

  # ------------------------------------------------------------------ clubs (R-11.6)

  def list_clubs(ctx) do
    own = Enum.map(ctx.own_ids, &Nearby.dump/1)

    clubs =
      Repo.query!(
        """
        SELECT c.id::text, c.name, c.sport, c.description, c.join_policy, c.verified_club,
               (SELECT count(*) FROM club_members m WHERE m.club_id = c.id AND m.state = 'member'),
               (SELECT m.state || ':' || m.role FROM club_members m WHERE m.club_id = c.id AND m.profile_id = ANY($2))
        FROM clubs c WHERE c.cell_r5 = ANY($1) OR EXISTS
          (SELECT 1 FROM club_members m WHERE m.club_id = c.id AND m.profile_id = ANY($2))
        ORDER BY 7 DESC LIMIT 100
        """,
        [Nearby.area(ctx, 3), own]
      ).rows
      |> Nearby.utc()
      |> Nearby.utc()
      |> Enum.map(&club_json/1)

    {:ok, %{clubs: clubs}}
  end

  defp club_json([id, name, sport, desc, policy, verified, members, mine]) do
    {state, role} =
      case mine do
        nil -> {nil, nil}
        s -> s |> String.split(":") |> List.to_tuple()
      end

    %{
      id: id,
      name: name,
      sport: sport,
      description: desc,
      join_policy: policy,
      verified_club: verified,
      members: members,
      my_state: state,
      my_role: role
    }
  end

  @doc "POST /clubs — verified, account ≥ 30 days."
  def create_club(ctx, params) do
    name = String.trim(params["name"] || "")
    desc = String.trim(params["description"] || "")

    with :ok <- Social.require_verified(ctx.account),
         :ok <-
           check(
             DateTime.diff(DateTime.utc_now(), ctx.account.inserted_at, :day) >= 30,
             :account,
             "accounts older than 30 days can create clubs"
           ),
         {:ok, pid} <- sport_profile(ctx),
         :ok <- Nearby.require_point(ctx),
         :ok <-
           check(
             name != "" and String.length(name) <= 60 and clean?(name),
             :name,
             "1–60 characters"
           ),
         :ok <-
           check(
             String.length(desc) <= 500 and clean?(desc),
             :description,
             "max 500 characters, no contact details"
           ),
         :ok <- check(params["sport"] in Fields.sports(), :sport, "invalid"),
         :ok <-
           check((params["join_policy"] || "open") in ~w(open request), :join_policy, "invalid"),
         {:ok, _} <- Social.limit(ctx.account, "club", 2, 86_400) do
      id = Ecto.UUID.generate()

      Repo.transaction(fn ->
        Repo.query!(
          "INSERT INTO clubs (id, name, sport, description, cell_r5, join_policy, created_at) VALUES ($1, $2, $3, $4, $5, $6, now())",
          [Nearby.dump(id), name, params["sport"], desc, ctx.r5, params["join_policy"] || "open"]
        )

        Repo.query!(
          "INSERT INTO club_members (club_id, profile_id, role, state, created_at) VALUES ($1, $2, 'admin', 'member', now())",
          [Nearby.dump(id), Nearby.dump(pid)]
        )
      end)

      get_club(ctx, id)
    end
  end

  def get_club(ctx, id) do
    with {:ok, _} <- Ecto.UUID.cast(id) |> found(),
         [row] <-
           Repo.query!(
             """
             SELECT c.id::text, c.name, c.sport, c.description, c.join_policy, c.verified_club,
                    (SELECT count(*) FROM club_members m WHERE m.club_id = c.id AND m.state = 'member'),
                    (SELECT m.state || ':' || m.role FROM club_members m WHERE m.club_id = c.id AND m.profile_id = ANY($2))
             FROM clubs c WHERE c.id = $1
             """,
             [Nearby.dump(id), Enum.map(ctx.own_ids, &Nearby.dump/1)]
           ).rows do
      club = club_json(row)

      events =
        Repo.query!(
          "SELECT id::text, title, sport, starts_at, place_text FROM activity_posts WHERE club_id = $1 AND expires_at > now() ORDER BY starts_at",
          [Nearby.dump(id)]
        ).rows
        |> Nearby.utc()
        |> Nearby.utc()
        |> Enum.map(fn [eid, t, s, at, pl] ->
          %{id: eid, title: t, sport: s, starts_at: at, place: pl}
        end)

      extra =
        if club.my_state == "member" do
          rows =
            Repo.query!(
              "SELECT profile_id::text, role, state FROM club_members WHERE club_id = $1 ORDER BY created_at",
              [
                Nearby.dump(id)
              ]
            ).rows
            |> Nearby.utc()
            |> Nearby.utc()

          cards = Nearby.people(ctx, Enum.map(rows, &hd/1))

          members =
            for [pid, role, st] <- rows,
                cards[pid],
                st == "member" or club.my_role == "admin",
                do: %{profile: cards[pid], role: role, state: st}

          %{member_list: members}
        else
          %{}
        end

      {:ok, club |> Map.put(:events, events) |> Map.merge(extra)}
    else
      [] -> {:error, :not_found}
      e -> e
    end
  end

  def join_club(ctx, id) do
    with {:ok, pid} <- sport_profile(ctx),
         {:ok, club} <- get_club(ctx, id),
         :ok <- check(is_nil(club.my_state), :club, "already a member") do
      state = if club.join_policy == "open", do: "member", else: "requested"

      Repo.query!(
        "INSERT INTO club_members (club_id, profile_id, role, state, created_at) VALUES ($1, $2, 'member', $3, now())",
        [Nearby.dump(id), Nearby.dump(pid), state]
      )

      if state == "requested" do
        Repo.query!(
          "SELECT profile_id::text FROM club_members WHERE club_id = $1 AND role = 'admin'",
          [Nearby.dump(id)]
        ).rows
        |> Nearby.utc()
        |> Nearby.utc()
        |> List.flatten()
        |> Enum.each(&Thirstr.Parties.notify_profile(&1, "club.request"))
      end

      get_club(ctx, id)
    end
  end

  def leave_club(ctx, id) do
    with {:ok, pid} <- sport_profile(ctx),
         {:ok, _} <- Ecto.UUID.cast(id) |> found() do
      Repo.query!(
        """
        DELETE FROM club_members WHERE club_id = $1 AND profile_id = $2
          AND NOT (role = 'admin' AND (SELECT count(*) FROM club_members WHERE club_id = $1 AND role = 'admin') = 1)
        """,
        [Nearby.dump(id), Nearby.dump(pid)]
      )

      :ok
    end
  end

  # sobelow_skip ["SQL.Query"]
  @doc "Admin: approve | remove | promote a member."
  def admin(ctx, id, member, action) when action in ~w(approve remove promote) do
    with {:ok, club} <- get_club(ctx, id),
         :ok <- if(club.my_role == "admin", do: :ok, else: {:error, :forbidden}),
         {:ok, _} <- Ecto.UUID.cast(member) |> found() do
      sql =
        case action do
          "approve" ->
            "UPDATE club_members SET state = 'member' WHERE club_id = $1 AND profile_id = $2"

          "remove" ->
            "DELETE FROM club_members WHERE club_id = $1 AND profile_id = $2 AND role <> 'admin'"

          "promote" ->
            "UPDATE club_members SET role = 'admin' WHERE club_id = $1 AND profile_id = $2 AND state = 'member'"
        end

      Repo.query!(sql, [Nearby.dump(id), Nearby.dump(member)])
      get_club(ctx, id)
    end
  end

  def admin(_, _, _, _), do: {:error, {:validation, %{action: ["invalid"]}}}

  defp club_admin?(pid, club) do
    case Ecto.UUID.cast(club) do
      {:ok, _} ->
        Repo.query!(
          "SELECT 1 FROM club_members WHERE club_id = $1 AND profile_id = $2 AND role = 'admin'",
          [
            Nearby.dump(club),
            Nearby.dump(pid)
          ]
        ).num_rows == 1

      _ ->
        false
    end
  end

  def sweep do
    Repo.query!("DELETE FROM activity_posts WHERE expires_at < now() - interval '1 hour'")
  end

  @doc false
  def account_age_ok?(%Account{inserted_at: t}),
    do: DateTime.diff(DateTime.utc_now(), t, :day) >= 30
end
