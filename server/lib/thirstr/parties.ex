defmodule Thirstr.Parties do
  @moduledoc """
  F-10 parties. Only the approximate area (H3 r8 cell) is ever stored or returned; the address
  and door code go E2EE in the guest chat (AC-10.1, R-10.5). Accepts are transactional so the
  capacity can never be exceeded (AC-10.2).
  """
  alias Thirstr.{Nearby, Notify, Repo, Social, Tonight}
  alias Thirstr.Accounts.Account
  alias Thirstr.Moderation.Text

  @rule_chips ~w(age_range safer prep vers_welcome no_chems sober_friendly bring_toys dress_code)
  @audiences ~w(verified chats invite)
  @max_hours 12
  @per_day 3

  import Tonight, only: [check: 3, parse_time: 1]

  def rule_chips, do: @rule_chips

  # ------------------------------------------------------------------ create

  @doc "POST /parties (R-10.1). Safe Mode: creation disabled (R-10.9)."
  def create(ctx, params) do
    title = String.trim(params["title"] || "")
    s = parse_time(params["starts_at"])
    e = parse_time(params["ends_at"])
    cap = params["capacity"]
    rules = List.wrap(params["rules"])
    custom = rules |> Enum.reject(&(&1 in @rule_chips))
    audience = params["audience"] || "verified"
    now = DateTime.utc_now()

    with :ok <- Social.require_verified(ctx.account),
         :ok <- check(not ctx.safe_mode, :safe_mode, "turn off Safe Mode to host"),
         :ok <- check(ctx.kind == "now", :mode, "parties are in Hookup mode"),
         :ok <- Nearby.require_profile(ctx),
         :ok <- Nearby.require_point(ctx),
         :ok <- check(title != "" and String.length(title) <= 40, :title, "1–40 characters"),
         :ok <-
           check(
             not (Text.contact_details?(title) or Text.link?(title)),
             :title,
             "no links or contact details"
           ),
         :ok <- check(s && e && DateTime.compare(e, s) == :gt, :ends_at, "after start"),
         :ok <- check(DateTime.diff(e, s) <= @max_hours * 3600, :ends_at, "max 12 hours"),
         :ok <-
           check(
             DateTime.diff(s, now) > -3600 and DateTime.diff(s, now) < 7 * 86_400,
             :starts_at,
             "within the next 7 days"
           ),
         :ok <- check(is_integer(cap) and cap in 2..50, :capacity, "2–50"),
         :ok <- check(audience in @audiences, :audience, "invalid"),
         :ok <-
           check(
             length(custom) <= 3 and
               Enum.all?(custom, &(is_binary(&1) and String.length(&1) in 1..30)),
             :rules,
             "max 3 custom rules, 30 characters"
           ),
         :ok <- check(live_count(ctx.profile_id) == 0, :party, "you already have a live party"),
         {:ok, _} <- Social.limit(ctx.account, "party", @per_day, 86_400) do
      id = Ecto.UUID.generate()

      code =
        if audience == "invite",
          do: Base.url_encode64(:crypto.strong_rand_bytes(9), padding: false)

      Repo.query!(
        """
        INSERT INTO parties (id, host_profile_id, title, starts_at, ends_at, capacity, rules, audience,
                             cell_r8, cell_r5, status, invite_code, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'open', $11, now())
        """,
        [
          Nearby.dump(id),
          Nearby.dump(ctx.profile_id),
          title,
          s,
          e,
          cap,
          Enum.uniq(rules),
          audience,
          Nearby.cell(ctx.point, 8),
          ctx.r5,
          code
        ]
      )

      get(ctx, id, code)
    end
  end

  defp live_count(pid) do
    [[n]] =
      Repo.query!(
        "SELECT count(*) FROM parties WHERE host_profile_id = $1 AND status IN ('open', 'full') AND ends_at > now()",
        [Nearby.dump(pid)]
      ).rows
      |> Nearby.utc()
      |> Nearby.utc()

    n
  end

  # ------------------------------------------------------------------ read

  @cols """
  p.id::text, p.host_profile_id::text, p.cohost_profile_id::text, p.title, p.starts_at, p.ends_at,
  p.capacity, p.rules, p.audience, p.cell_r8, p.status, p.invite_code,
  (SELECT count(*) FROM party_requests r WHERE r.party_id = p.id AND r.state = 'accepted'),
  (SELECT r.state FROM party_requests r WHERE r.party_id = p.id AND r.profile_id = ANY($2)),
  (SELECT count(*) FROM party_requests r WHERE r.party_id = p.id AND r.rating IS NOT NULL),
  (SELECT count(*) FROM party_requests r WHERE r.party_id = p.id AND r.rating > 0),
  p.hidden
  """

  defp row(r) when length(r) == 17,
    do: r |> Enum.map(&Thirstr.Explore.utc_any/1) |> row_()

  defp row_([
         id,
         host,
         co,
         title,
         s,
         e,
         cap,
         rules,
         aud,
         cell,
         status,
         code,
         taken,
         my,
         nr,
         up,
         hidden
       ]) do
    %{
      id: id,
      host: host,
      cohost: co,
      title: title,
      starts_at: s,
      ends_at: e,
      capacity: cap,
      rules: rules,
      audience: aud,
      cell: cell,
      status: status,
      code: code,
      taken: taken,
      my: my,
      ratings: nr,
      up: up,
      hidden: hidden
    }
  end

  @doc "GET /parties — nearby parties with free or full seats, not ended (R-10.2, R-09.7)."
  def list(ctx) do
    if is_nil(ctx.point) do
      {:ok, %{parties: []}}
    else
      own = Enum.map(ctx.own_ids, &Nearby.dump/1)

      rows =
        Repo.query!(
          """
          SELECT #{@cols} FROM parties p
          WHERE p.cell_r5 = ANY($1) AND p.ends_at > now() AND p.status IN ('open', 'full')
            AND NOT p.hidden
          ORDER BY p.starts_at LIMIT 200
          """,
          [Nearby.area(ctx, 2), own]
        ).rows
        |> Nearby.utc()
        |> Nearby.utc()
        |> Enum.map(&row/1)

      partners = Nearby.chat_partners(ctx, Enum.map(rows, & &1.host))

      rows =
        Enum.filter(rows, fn r ->
          host? = r.host in ctx.own_ids or r.cohost in ctx.own_ids

          host? or not is_nil(r.my) or
            (not ctx.safe_mode and
               ((r.audience == "verified" and ctx.verified) or
                  (r.audience == "chats" and r.host in partners)))
        end)

      people = Nearby.people(ctx, Enum.map(rows, & &1.host))
      Nearby.warm(Enum.map(rows, & &1.cell))

      {:ok,
       %{
         parties:
           rows
           |> Enum.filter(&Map.has_key?(people, &1.host))
           |> Enum.map(&json(ctx, &1, people[&1.host]))
       }}
    end
  end

  defp json(ctx, r, host) do
    host? = r.host in ctx.own_ids or r.cohost in ctx.own_ids

    %{
      id: r.id,
      title: r.title,
      host: host,
      starts_at: r.starts_at,
      ends_at: r.ends_at,
      capacity: r.capacity,
      seats_taken: r.taken,
      rules: r.rules,
      audience: r.audience,
      status: effective_status(r),
      area_cell: Integer.to_string(r.cell, 16) |> String.downcase(),
      distance: Nearby.bucket(Nearby.dist_m(ctx, r.cell)),
      my_state: if(host?, do: "host", else: guest_state(r.my)),
      invite_code: if(host?, do: r.code),
      rating: if(r.ratings >= 3, do: %{up: r.up, total: r.ratings})
    }
  end

  # R-10.4: a declined requester only ever sees "not this time".
  defp guest_state("declined"), do: "not_this_time"
  defp guest_state("removed"), do: "not_this_time"
  defp guest_state(s), do: s

  defp effective_status(%{status: s, ends_at: e, starts_at: st}) do
    now = DateTime.utc_now()

    cond do
      s in ~w(cancelled ended) -> s
      DateTime.compare(e, now) == :lt -> "ended"
      DateTime.compare(st, now) == :lt -> if(s == "full", do: "full", else: "live")
      true -> s
    end
  end

  defp fetch(ctx, id) do
    with {:ok, _} <- Ecto.UUID.cast(id),
         [r] <-
           Repo.query!("SELECT #{@cols} FROM parties p WHERE p.id = $1", [
             Nearby.dump(id),
             Enum.map(ctx.own_ids, &Nearby.dump/1)
           ]).rows do
      {:ok, row(r)}
    else
      _ -> {:error, :not_found}
    end
  end

  @doc "GET /parties/:id (S-14). Host view adds the request list (R-10.3)."
  def get(ctx, id, code \\ nil) do
    with {:ok, r} <- fetch(ctx, id),
         {:ok, people} <- visible(ctx, r, code) do
      host? = r.host in ctx.own_ids or r.cohost in ctx.own_ids
      base = json(ctx, r, people[r.host])

      if host? do
        reqs =
          Repo.query!(
            """
            SELECT r.profile_id::text, r.state, r.created_at, vouch_count(r.profile_id)
            FROM party_requests r WHERE r.party_id = $1 AND r.state IN ('pending', 'accepted')
            ORDER BY r.created_at
            """,
            [Nearby.dump(r.id)]
          ).rows
          |> Nearby.utc()
          |> Nearby.utc()

        cards = Nearby.people(ctx, Enum.map(reqs, &hd/1))

        requests =
          for [pid, st, at, v] <- reqs,
              Map.has_key?(cards, pid),
              do: %{profile: cards[pid], state: st, at: at, vouches: v}

        {:ok, Map.put(base, :requests, requests)}
      else
        {:ok, base}
      end
    end
  end

  defp visible(ctx, r, code) do
    host? = r.host in ctx.own_ids or r.cohost in ctx.own_ids
    people = Nearby.people(ctx, [r.host])

    cond do
      not Map.has_key?(people, r.host) ->
        {:error, :not_found}

      host? or not is_nil(r.my) ->
        {:ok, people}

      r.hidden ->
        {:error, :not_found}

      r.audience == "invite" ->
        if(code && r.code == code, do: {:ok, people}, else: {:error, :not_found})

      ctx.safe_mode ->
        {:error, :not_found}

      r.audience == "verified" ->
        if(ctx.verified,
          do: {:ok, people},
          else: {:error, {:not_verified, "Verify to see this party"}}
        )

      r.audience == "chats" ->
        if(r.host in Nearby.chat_partners(ctx, [r.host]),
          do: {:ok, people},
          else: {:error, :not_found}
        )
    end
  end

  # ------------------------------------------------------------------ guest actions

  @doc "POST /parties/:id/request (R-10.3)."
  def request(ctx, id, code) do
    with :ok <- Social.require_verified(ctx.account),
         :ok <- Nearby.require_profile(ctx),
         {:ok, r} <- fetch(ctx, id),
         {:ok, _} <- visible(ctx, r, code),
         :ok <- check(r.host not in ctx.own_ids, :party, "your own party"),
         :ok <- check(effective_status(r) in ~w(open live), :party, "not taking requests"),
         :ok <- check(r.my in [nil, "left"], :party, "already requested") do
      Repo.query!(
        """
        INSERT INTO party_requests (party_id, profile_id, state, created_at) VALUES ($1, $2, 'pending', now())
        ON CONFLICT (party_id, profile_id) DO UPDATE SET state = 'pending', created_at = now()
        """,
        [Nearby.dump(r.id), Nearby.dump(ctx.profile_id)]
      )

      notify_host(r, "party.request")
      get(ctx, id, code)
    end
  end

  def leave(ctx, id) do
    with {:ok, r} <- fetch(ctx, id) do
      Repo.query!(
        "UPDATE party_requests SET state = 'left' WHERE party_id = $1 AND profile_id = ANY($2) AND state IN ('pending', 'accepted')",
        [Nearby.dump(r.id), Enum.map(ctx.own_ids, &Nearby.dump/1)]
      )

      reopen(r.id)
      seats(r.id)
      :ok
    end
  end

  @doc "POST /parties/:id/rate {up: bool} — accepted guests after the end (R-10.7)."
  def rate(ctx, id, up) do
    with {:ok, r} <- fetch(ctx, id),
         :ok <- check(r.my == "accepted", :party, "guests only"),
         :ok <- check(effective_status(r) == "ended", :party, "after the party"),
         :ok <- check(is_boolean(up), :up, "boolean") do
      Repo.query!(
        "UPDATE party_requests SET rating = $3 WHERE party_id = $1 AND profile_id = ANY($2) AND state = 'accepted'",
        [Nearby.dump(r.id), Enum.map(ctx.own_ids, &Nearby.dump/1), if(up, do: 1, else: -1)]
      )

      :ok
    end
  end

  @doc "POST /parties/:id/report — 2 distinct reports hide the party pending review (R-10.8)."
  def report(ctx, id, reason) do
    with {:ok, r} <- fetch(ctx, id) do
      Repo.query!(
        "INSERT INTO party_reports (party_id, account_id, reason, created_at) VALUES ($1, $2, $3, now()) ON CONFLICT DO NOTHING",
        [
          Nearby.dump(r.id),
          Nearby.dump(ctx.account.id),
          reason && String.slice(to_string(reason), 0, 200)
        ]
      )

      Repo.query!(
        "UPDATE parties SET hidden = true WHERE id = $1 AND (SELECT count(*) FROM party_reports WHERE party_id = $1) >= 2",
        [Nearby.dump(r.id)]
      )

      :ok
    end
  end

  # ------------------------------------------------------------------ host actions

  defp host(ctx, id) do
    with {:ok, r} <- fetch(ctx, id) do
      if r.host in ctx.own_ids or r.cohost in ctx.own_ids,
        do: {:ok, r},
        else: {:error, :forbidden}
    end
  end

  @doc "Accept: transactional seat check (AC-10.2)."
  def accept(ctx, id, pid) do
    with {:ok, r} <- host(ctx, id),
         {:ok, _} <- Ecto.UUID.cast(pid) do
      Repo.transaction(fn ->
        [[cap, status]] =
          Repo.query!("SELECT capacity, status FROM parties WHERE id = $1 FOR UPDATE", [
            Nearby.dump(r.id)
          ]).rows
          |> Nearby.utc()
          |> Nearby.utc()

        [[taken]] =
          Repo.query!(
            "SELECT count(*) FROM party_requests WHERE party_id = $1 AND state = 'accepted'",
            [
              Nearby.dump(r.id)
            ]
          ).rows
          |> Nearby.utc()
          |> Nearby.utc()

        cond do
          status in ~w(cancelled ended) ->
            Repo.rollback({:validation, %{party: ["party is over"]}})

          taken >= cap ->
            Repo.rollback({:validation, %{party: ["party is full"]}})

          true ->
            %{num_rows: n} =
              Repo.query!(
                "UPDATE party_requests SET state = 'accepted' WHERE party_id = $1 AND profile_id = $2 AND state = 'pending'",
                [Nearby.dump(r.id), Nearby.dump(pid)]
              )

            if n == 0, do: Repo.rollback(:not_found)

            if taken + 1 >= cap,
              do:
                Repo.query!("UPDATE parties SET status = 'full' WHERE id = $1", [
                  Nearby.dump(r.id)
                ])

            :ok
        end
      end)
      |> case do
        {:ok, :ok} ->
          notify_profile(pid, "party.accepted")
          seats(r.id)
          get(ctx, id)

        {:error, e} ->
          {:error, e}
      end
    else
      :error -> {:error, :not_found}
      e -> e
    end
  end

  def decline(ctx, id, pid), do: set_state(ctx, id, pid, "declined", ["pending"])
  def remove(ctx, id, pid), do: set_state(ctx, id, pid, "removed", ["accepted", "pending"])

  defp set_state(ctx, id, pid, state, from) do
    with {:ok, r} <- host(ctx, id),
         {:ok, _} <- Ecto.UUID.cast(pid) do
      Repo.query!(
        "UPDATE party_requests SET state = $3 WHERE party_id = $1 AND profile_id = $2 AND state = ANY($4)",
        [Nearby.dump(r.id), Nearby.dump(pid), state, from]
      )

      reopen(r.id)
      seats(r.id)
      get(ctx, id)
    else
      :error -> {:error, :not_found}
      e -> e
    end
  end

  @doc "PATCH /parties/:id — host: status full|open|cancelled|ended, cohost_profile_id."
  def update(ctx, id, params) do
    with {:ok, r} <- host(ctx, id),
         :ok <-
           check(
             is_nil(params["status"]) or params["status"] in ~w(open full cancelled ended),
             :status,
             "invalid"
           ) do
      if s = params["status"] do
        Repo.query!(
          "UPDATE parties SET status = $2 WHERE id = $1 AND status NOT IN ('cancelled', 'ended')",
          [
            Nearby.dump(r.id),
            s
          ]
        )

        if s in ~w(cancelled ended), do: notify_guests(r, "party.status")
      end

      if Map.has_key?(params, "cohost_profile_id") do
        co = params["cohost_profile_id"]

        ok? =
          is_nil(co) or
            Repo.query!(
              "SELECT 1 FROM party_requests WHERE party_id = $1 AND profile_id = $2 AND state = 'accepted'",
              [Nearby.dump(r.id), Nearby.dump(co)]
            ).num_rows == 1

        if ok?,
          do:
            Repo.query!("UPDATE parties SET cohost_profile_id = $2 WHERE id = $1", [
              Nearby.dump(r.id),
              co && Nearby.dump(co)
            ])
      end

      seats(r.id)
      get(ctx, id)
    end
  end

  defp reopen(id) do
    Repo.query!(
      """
      UPDATE parties SET status = 'open' WHERE id = $1 AND status = 'full'
        AND (SELECT count(*) FROM party_requests WHERE party_id = $1 AND state = 'accepted') < capacity
      """,
      [Nearby.dump(id)]
    )
  end

  # R-10.6 seat meter on party:{id}
  defp seats(id) do
    [[taken, cap, status]] =
      Repo.query!(
        "SELECT (SELECT count(*) FROM party_requests WHERE party_id = $1 AND state = 'accepted'), capacity, status FROM parties WHERE id = $1",
        [Nearby.dump(id)]
      ).rows
      |> Nearby.utc()
      |> Nearby.utc()

    Phoenix.PubSub.broadcast(
      Thirstr.PubSub,
      "party:" <> id,
      {:event, "seat.update", %{seats_taken: taken, capacity: cap, status: status}}
    )
  end

  defp notify_host(r, event) do
    for pid <- Enum.reject([r.host, r.cohost], &is_nil/1), do: notify_profile(pid, event)
  end

  defp notify_guests(r, event) do
    Repo.query!(
      "SELECT profile_id::text FROM party_requests WHERE party_id = $1 AND state IN ('accepted', 'pending')",
      [
        Nearby.dump(r.id)
      ]
    ).rows
    |> Nearby.utc()
    |> Nearby.utc()
    |> List.flatten()
    |> Enum.each(&notify_profile(&1, event))
  end

  def notify_profile(pid, event) do
    case Repo.query!("SELECT account_id::text FROM profiles WHERE id = $1", [Nearby.dump(pid)]).rows do
      [[aid]] -> Notify.event(aid, event, %{})
      _ -> :ok
    end
  end

  @doc "Can this account watch party:{id} (seat meter)?"
  def can_watch?(%Account{} = a, id) do
    match?({:ok, _}, get(Nearby.ctx(a, "hookup"), id))
  end
end
