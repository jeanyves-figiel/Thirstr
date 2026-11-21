defmodule Thirstr.Moments do
  @moduledoc """
  F-21 Moments (#212): temporary photos (1 h / 6 h / 24 h) with an audience per Moment.
  Spec: docs/spec/features/F21-moments.md (D-21: Moments row + rings, names unless the viewer
  watches quietly).

  Privacy rules enforced here:
  - no location of any kind is stored with a Moment (R-21.20); the phone strips EXIF and burns
    blur in before upload (R-21.4);
  - "everyone" = the Explore audience: blocks both ways, active accounts, `hide_from_unverified`,
    the viewer's lens ∩ the Moment's intents, `main_ok` outside Hookup (R-21.6, R-21.8);
    Safe Mode viewers see only Moments they are listed in (R-21.21);
  - chats / favorites / friends (#247) are resolved on the phone; the server only stores the profile ids;
  - not allowed and "no Moment" both answer 404 (AC-21.2);
  - everything is hard-deleted at expiry, storage objects included (R-21.22).
  """
  alias Thirstr.{Repo, Settings, Social, Storage}
  alias Thirstr.Accounts.Account
  alias Thirstr.Moderation.{Classifier, Text}

  @types ~w(image/jpeg image/png image/heic image/webp image/avif)
  @ttls [3600, 21_600, 86_400]
  @audiences ~w(everyone chats favorites friends)
  @styles ~w(clean pill pop)
  @intents ~w(hookup friends sport)
  @max_live 10
  @per_day 20
  @new_per_day 3
  @max_audience 2_000
  @max_bytes 15_000_000
  @thumb_max 300_000
  @signed_ttl 300

  # ------------------------------------------------------------------ posting (R-21.1…R-21.5)

  @doc "POST /moments/uploads: verified only; returns presigned PUTs for the photo and its 480 px copy."
  def create_upload(%Account{} = a, content_type) do
    with :ok <- Social.require_verified(a),
         true <-
           content_type in @types || {:error, {:validation, %{content_type: ["unsupported"]}}},
         %{} = p <- Thirstr.Profiles.main(a) || {:error, :basics_required},
         :ok <- under_live_cap(a) do
      key = "moments/#{Ecto.UUID.generate()}"
      id = Ecto.UUID.generate()

      Repo.query!(
        """
        INSERT INTO moments (id, account_id, profile_id, storage_key, status, created_at)
        VALUES ($1, $2, $3, $4, 'uploading', now())
        """,
        [dump(id), dump(a.id), dump(p.id), key]
      )

      {:ok, put} = Storage.presigned_put(key, content_type)
      {:ok, thumb} = Storage.presigned_put(thumb_of(key), "image/jpeg")
      {:ok, %{moment_id: id, put_url: put, thumb_put_url: thumb}}
    end
  end

  def thumb_of(key), do: key <> "-t"

  @doc """
  POST /moments/:id/publish: validates options, classifies (permissive public rules, R-21.24),
  and goes live with `expires_at = now + ttl`. Limits: 10 live, 20 per 24 h, 3 per 24 h for
  accounts younger than a day (R-21.5, R-21.26).
  """
  def publish(%Account{} = a, id, params) do
    with {:ok, m} <- own(a, id),
         true <- m.status == "uploading" || {:error, {:conflict, "Already shared"}},
         {:ok, opts} <- options(a, params),
         :ok <- under_live_cap(a),
         {:ok, _} <- day_limit(a),
         {:ok, %{size: size}} when size > 0 and size <= @max_bytes <- Storage.head(m.key) do
      {status, reason, score} =
        case Classifier.impl().classify(m.key, 1, "now") do
          {:review, s} -> {"review", nil, s}
          {ok, s} when ok in [:ok_main, :ok_public] -> {"live", nil, s}
          {:rejected, why, s} -> {"rejected", Atom.to_string(why), s}
        end

      main_ok = Map.get(score || %{}, "main_ok", false) == true
      thumb = if status == "live", do: checked_thumb(m.key)

      Repo.transaction(fn ->
        Repo.query!(
          """
          UPDATE moments SET status = $2, reject_reason = $3, main_ok = $4, thumb_key = $5,
            caption = $6, caption_style = $7, audience = $8, intents = $9, ttl_s = $10::int,
            expires_at = now() + make_interval(secs => $10::int)
          WHERE id = $1
          """,
          [
            dump(id),
            status,
            reason,
            main_ok,
            thumb,
            opts.caption,
            opts.style,
            opts.audience,
            opts.intents,
            opts.ttl
          ]
        )

        Enum.each(Enum.chunk_every(opts.ids, 500), fn chunk ->
          Repo.query!(
            """
            INSERT INTO moment_audience (moment_id, profile_id)
            SELECT $1, p.id FROM profiles p WHERE p.id = ANY($2) ON CONFLICT DO NOTHING
            """,
            [dump(id), Enum.map(chunk, &dump/1)]
          )
        end)
      end)

      if status == "rejected" do
        Storage.delete_many([m.key, thumb_of(m.key)])
        Repo.query!("DELETE FROM moments WHERE id = $1", [dump(id)])
      end

      if status == "live", do: broadcast(m.profile_id)
      {:ok, Map.merge(mine_one(a, id) || %{id: id}, %{status: status, reject_reason: reason})}
    else
      {:ok, %{size: _}} -> {:error, {:validation, %{photo: ["missing or too large"]}}}
      {:error, _} = e -> e
    end
  end

  # R-21.3 / R-21.6 option checks, first failure wins.
  @checks [
    {:audience, &__MODULE__.bad_audience?/1, "everyone, chats, favorites or friends"},
    {:audience, &__MODULE__.closed_everyone?/1,
     "You're hidden: only people you chat with or Favorites"},
    {:ttl_s, &__MODULE__.bad_ttl?/1, "1, 6 or 24 hours"},
    {:intents, &__MODULE__.bad_intents?/1, "hookup, friends or sport"},
    {:caption_style, &__MODULE__.bad_style?/1, "clean, pill or pop"},
    {:caption, &__MODULE__.long_caption?/1, "max 80 characters"},
    {:caption, &__MODULE__.contact_caption?/1, "no links or contact details"},
    {:audience_ids, &__MODULE__.bad_ids?/1, "list of profile ids"},
    {:audience_ids, &__MODULE__.empty_list?/1, "Nobody to show it to yet"}
  ]

  defp options(a, params) do
    o = %{
      audience: params["audience"] || "everyone",
      ttl: params["ttl_s"] || 86_400,
      intents: params["intents"] || ["hookup"],
      style: params["caption_style"] || "clean",
      caption: blank_nil(params["caption"]),
      ids: params["audience_ids"] || [],
      closed?: a.hidden or Account.safe_mode_on?(a)
    }

    case Enum.find_value(@checks, fn {field, bad?, msg} -> bad?.(o) && {field, msg} end) do
      {field, msg} ->
        {:error, {:validation, %{field => [msg]}}}

      nil ->
        {:ok,
         %{
           audience: o.audience,
           ttl: o.ttl,
           intents: Enum.filter(@intents, &(&1 in o.intents)),
           style: o.style,
           caption: o.caption,
           ids: if(o.audience == "everyone", do: [], else: Enum.uniq(o.ids))
         }}
    end
  end

  @doc false
  def bad_audience?(o), do: o.audience not in @audiences
  @doc false
  def closed_everyone?(o), do: o.audience == "everyone" and o.closed?
  @doc false
  def bad_ttl?(o), do: o.ttl not in @ttls

  @doc false
  def bad_intents?(%{intents: i}),
    do: not is_list(i) or i == [] or Enum.any?(i, &(&1 not in @intents))

  @doc false
  def bad_style?(o), do: o.style not in @styles
  @doc false
  def long_caption?(%{caption: c}), do: is_binary(c) and String.length(c) > 80

  @doc false
  def contact_caption?(%{caption: c}),
    do: is_binary(c) and (Text.contact_details?(c) or Text.link?(c))

  @doc false
  def bad_ids?(%{ids: ids}),
    do:
      not is_list(ids) or length(ids) > @max_audience or
        not Enum.all?(ids, &match?({:ok, _}, Ecto.UUID.cast(&1)))

  @doc false
  def empty_list?(o), do: o.audience != "everyone" and o.ids == []

  defp under_live_cap(a) do
    n =
      Repo.query!(
        "SELECT count(*) FROM moments WHERE account_id = $1 AND status IN ('live','review') AND expires_at > now()",
        [dump(a.id)]
      ).rows
      |> hd()
      |> hd()

    if n >= @max_live,
      do: {:error, {:conflict, "You have 10 live Moments. Delete one to share another."}},
      else: :ok
  end

  defp day_limit(a) do
    n =
      if DateTime.diff(DateTime.utc_now(), a.inserted_at, :hour) < 24,
        do: @new_per_day,
        else: @per_day

    Social.limit(a, "moments", n, 86_400)
  end

  defp checked_thumb(key) do
    t = thumb_of(key)

    with {:ok, %{size: size}} when size > 0 and size <= @thumb_max <- Storage.head(t),
         {ok, _} when ok in [:ok_main, :ok_public] <- Classifier.impl().classify(t, 1, "now") do
      t
    else
      _ -> nil
    end
  end

  # ------------------------------------------------------------------ own Moments (R-21.13)

  defp own(%Account{id: aid}, id) do
    with {:ok, _} <- Ecto.UUID.cast(id),
         %{rows: [[key, pid, status]]} <-
           Repo.query!(
             "SELECT storage_key, profile_id::text, status FROM moments WHERE id = $1 AND account_id = $2",
             [dump(id), dump(aid)]
           ) do
      {:ok, %{key: key, profile_id: pid, status: status}}
    else
      _ -> {:error, :not_found}
    end
  end

  @doc """
  GET /moments/mine: live (and in-review) Moments, oldest first, with counts and the Seen by list
  (D-21b C): viewers who watch quietly, are Hidden, or any viewer when the poster himself watches
  quietly, are only counted (R-21.17).
  """
  def mine(%Account{} = a) do
    rows =
      Repo.query!(
        """
        SELECT m.id::text, m.storage_key, m.thumb_key, m.caption, m.caption_style, m.audience,
               m.intents, m.status, m.created_at, m.expires_at, m.main_ok,
               (SELECT count(*) FROM moment_views v WHERE v.moment_id = m.id),
               (SELECT count(*) FROM moment_views v WHERE v.moment_id = m.id AND v.tapped),
               (SELECT count(*) FROM moment_audience x WHERE x.moment_id = m.id)
        FROM moments m
        WHERE m.account_id = $1 AND m.status IN ('live','review') AND m.expires_at > now()
        ORDER BY m.created_at
        """,
        [dump(a.id)]
      ).rows

    quiet_me = Settings.get(a, "moments_quiet") == true

    Enum.map(rows, fn [id, key, thumb, cap, style, aud, intents, st, c, e, mok, seen, taps, n] ->
      viewers = if quiet_me, do: [], else: viewers(id)

      %{
        id: id,
        url: Storage.presigned_get(key, @signed_ttl),
        thumb_url: thumb && Storage.presigned_get(thumb, @signed_ttl),
        caption: cap,
        caption_style: style,
        audience: aud,
        audience_count: n,
        intents: intents,
        status: st,
        main_ok: mok,
        created_at: utc(c),
        expires_at: utc(e),
        seen_count: seen,
        tap_count: taps,
        viewers: viewers,
        quiet_count: max(seen - length(viewers), 0),
        screenshots: screenshots(id)
      }
    end)
  end

  defp mine_one(a, id), do: Enum.find(mine(a), &(&1.id == id))

  defp viewers(moment_id) do
    Repo.query!(
      """
      SELECT p.id::text, p.display_name, p.age, v.at, v.tapped, v.screenshot,
             (SELECT ph.thumb_key FROM photos ph WHERE ph.profile_id = p.id
                AND ph.status IN ('ok_main','ok_public') ORDER BY ph.slot LIMIT 1),
             (SELECT ph.storage_key FROM photos ph WHERE ph.profile_id = p.id
                AND ph.status IN ('ok_main','ok_public') ORDER BY ph.slot LIMIT 1)
      FROM moment_views v
      JOIN profiles p ON p.id = v.viewer_profile_id
      JOIN accounts a ON a.id = p.account_id
      WHERE v.moment_id = $1 AND a.status = 'active' AND NOT a.hidden
        AND COALESCE((a.settings->>'moments_quiet')::boolean, false) = false
      ORDER BY v.at DESC
      LIMIT 200
      """,
      [dump(moment_id)]
    ).rows
    |> Enum.map(fn [pid, name, age, at, tapped, shot, thumb, full] ->
      %{
        profile_id: pid,
        display_name: name,
        age: age,
        at: utc(at),
        tapped: tapped,
        screenshot: shot,
        photo: (thumb || full) && Storage.presigned_get(thumb || full)
      }
    end)
  end

  # Screenshots always reach the poster (R-21.18), named only when the viewer may be named.
  defp screenshots(moment_id) do
    Repo.query!(
      "SELECT count(*) FROM moment_views WHERE moment_id = $1 AND screenshot",
      [dump(moment_id)]
    ).rows
    |> hd()
    |> hd()
  end

  @doc "DELETE /moments/:id: instant (R-21.13)."
  def delete(%Account{} = a, id) do
    with {:ok, m} <- own(a, id) do
      Repo.query!("DELETE FROM moments WHERE id = $1", [dump(id)])
      Storage.delete_many([m.key, thumb_of(m.key)])
      broadcast(m.profile_id)
      :ok
    end
  end

  # ------------------------------------------------------------------ viewing (R-21.9…R-21.12)

  @doc """
  GET /profiles/:id/moments?mode=: the Moments the viewer may see, oldest first. 404 when there
  is none or the viewer isn't allowed (indistinguishable, AC-21.2). URLs are signed for 5 min.
  """
  def for_profile(%Account{} = viewer, profile_id, mode) do
    lens = Thirstr.Explore.lens(mode)

    with {:ok, t} <- Social.target(viewer, profile_id),
         true <- t.account_id == viewer.id or can_see_poster?(viewer, t) || {:error, :not_found},
         [_ | _] = rows <- visible_rows(viewer, [t.id], [lens], t.account_id == viewer.id) do
      seen = seen_ids(viewer, Enum.map(rows, & &1.id))

      {:ok,
       Enum.map(rows, fn r ->
         %{
           id: r.id,
           url: Storage.presigned_get(r.key, @signed_ttl),
           thumb_url: r.thumb && Storage.presigned_get(r.thumb, @signed_ttl),
           caption: r.caption,
           caption_style: r.style,
           created_at: r.created_at,
           expires_at: r.expires_at,
           spicy: not r.main_ok,
           seen: MapSet.member?(seen, r.id)
         }
       end)}
    else
      _ -> {:error, :not_found}
    end
  end

  # R-17.7: a poster hiding from unverified viewers hides his Moments from them too.
  defp can_see_poster?(viewer, t),
    do: Account.verified?(viewer) or t.settings["hide_from_unverified"] != true

  # The core visibility rule, one query for many posters (cards) or one (profile).
  defp visible_rows(viewer, profile_ids, lenses, self?) do
    vp = Thirstr.Profiles.main(viewer)
    vpid = vp && vp.id
    safe = Account.safe_mode_on?(viewer)

    Repo.query!(
      """
      SELECT m.id::text, m.profile_id::text, m.storage_key, m.thumb_key, m.caption, m.caption_style,
             m.created_at, m.expires_at, m.main_ok
      FROM moments m
      WHERE m.profile_id = ANY($1) AND m.status = 'live' AND m.expires_at > now()
        AND ($5 OR (
          NOT EXISTS (SELECT 1 FROM moment_mutes mm WHERE mm.account_id = $2 AND mm.profile_id = m.profile_id)
          AND (
            (m.audience = 'everyone' AND NOT $4 AND m.intents::text[] && $3::text[]
              AND (m.main_ok OR 'hookup' = ANY($3::text[])))
            OR (m.audience <> 'everyone' AND $6::uuid IS NOT NULL AND EXISTS
              (SELECT 1 FROM moment_audience x WHERE x.moment_id = m.id AND x.profile_id = $6::uuid))
          )))
      ORDER BY m.created_at
      """,
      [
        Enum.map(profile_ids, &dump/1),
        dump(viewer.id),
        lenses,
        safe,
        self?,
        vpid && dump(vpid)
      ]
    ).rows
    |> Enum.map(fn [id, pid, key, thumb, cap, style, c, e, mok] ->
      %{
        id: id,
        profile_id: pid,
        key: key,
        thumb: thumb,
        caption: cap,
        style: style,
        created_at: utc(c),
        expires_at: utc(e),
        main_ok: mok
      }
    end)
  end

  defp seen_ids(_viewer, []), do: MapSet.new()

  defp seen_ids(viewer, ids) do
    case Thirstr.Profiles.main(viewer) do
      nil ->
        MapSet.new()

      p ->
        Repo.query!(
          "SELECT moment_id::text FROM moment_views WHERE viewer_profile_id = $1 AND moment_id = ANY($2)",
          [dump(p.id), Enum.map(ids, &dump/1)]
        ).rows
        |> List.flatten()
        |> MapSet.new()
    end
  end

  @doc """
  R-21.27: rings ride on Explore cards. Adds `moments: %{live, unseen}` to each card in one
  query (no extra request from the phone). Cards without Moments get `nil`.
  """
  def annotate([], _v), do: []

  def annotate(cards, %{account: viewer} = v) do
    lenses = Map.get(v, :intents) || [Map.get(v, :lens, "hookup")]
    lenses = Enum.filter(lenses, &(&1 in @intents))
    lenses = if lenses == [], do: ["hookup"], else: lenses
    ids = cards |> Enum.map(& &1.id) |> Enum.uniq()
    rows = visible_rows(viewer, ids, lenses, false)
    seen = seen_ids(viewer, Enum.map(rows, & &1.id))

    by = Enum.group_by(rows, & &1.profile_id)

    Enum.map(cards, fn c ->
      case by[c.id] do
        nil ->
          Map.put(c, :moments, nil)

        list ->
          Map.put(c, :moments, %{
            live: length(list),
            unseen: Enum.any?(list, &(not MapSet.member?(seen, &1.id))),
            thumb: thumb_url(List.last(list))
          })
      end
    end)
  end

  def annotate(cards, _v), do: cards

  defp thumb_url(%{thumb: t}) when is_binary(t), do: Storage.presigned_get(t, @signed_ttl)
  defp thumb_url(_), do: nil

  @doc "Profile view field (S-20): same shape as on cards."
  def summary(%Account{} = viewer, profile_id, lens) do
    case for_profile(viewer, profile_id, lens) do
      {:ok, rows} -> %{live: length(rows), unseen: Enum.any?(rows, &(not &1.seen))}
      _ -> nil
    end
  end

  @doc "POST /moments/views {ids}: records views (batched by the phone, R-21.28)."
  def record_views(%Account{} = a, ids) when is_list(ids) do
    ids = Enum.filter(ids, &match?({:ok, _}, Ecto.UUID.cast(&1))) |> Enum.take(100)
    record(a, ids, nil)
  end

  def record_views(_a, _), do: {:error, {:validation, %{ids: ["must be a list"]}}}

  @doc "POST /moments/:id/screenshot (iOS notice, R-21.18)."
  def screenshot(%Account{} = a, id), do: record(a, [id], "screenshot")

  @doc "POST /moments/:id/tap: a Tap with the Moment (🔥, R-21.11)."
  def tap(%Account{} = a, id) do
    with {:ok, pid} <- poster_of_visible(a, id),
         {:ok, res} <- Social.tap(a, pid),
         {:ok, _} <- record(a, [id], "tapped") do
      {:ok, res}
    end
  end

  defp poster_of_visible(a, id) do
    with {:ok, _} <- Ecto.UUID.cast(id),
         %{rows: [[pid]]} <-
           Repo.query!("SELECT profile_id::text FROM moments WHERE id = $1", [dump(id)]),
         {:ok, rows} <- for_profile(a, pid, "hookup"),
         true <- Enum.any?(rows, &(&1.id == id)) do
      {:ok, pid}
    else
      _ -> {:error, :not_found}
    end
  end

  # Only Moments the viewer may see count; own views are ignored.
  defp record(a, ids, flag) do
    case Thirstr.Profiles.main(a) do
      nil ->
        {:ok, 0}

      p ->
        %{num_rows: n} =
          Repo.query!(
            """
            INSERT INTO moment_views (moment_id, viewer_profile_id, at, tapped, screenshot)
            SELECT m.id, $2, now(), $3 = 'tapped', $3 = 'screenshot'
            FROM moments m
            WHERE m.id = ANY($1) AND m.status = 'live' AND m.expires_at > now() AND m.account_id <> $4
            ON CONFLICT (moment_id, viewer_profile_id) DO UPDATE SET
              tapped = moment_views.tapped OR EXCLUDED.tapped,
              screenshot = moment_views.screenshot OR EXCLUDED.screenshot
            """,
            [Enum.map(ids, &dump/1), dump(p.id), flag || "", dump(a.id)]
          )

        if flag == "screenshot" and n > 0, do: notify_screenshot(ids)
        {:ok, n}
    end
  end

  defp notify_screenshot([id | _]) do
    case Repo.query!("SELECT account_id::text FROM moments WHERE id = $1", [dump(id)]).rows do
      [[aid]] -> Thirstr.Notify.event(aid, "moment.screenshot", %{moment_id: id})
      _ -> :ok
    end
  end

  @doc "PUT/DELETE /moments/mutes/:profile_id (R-21.12)."
  def mute(%Account{} = a, profile_id, on?) do
    case Ecto.UUID.cast(profile_id) do
      {:ok, _} -> set_mute(a, profile_id, on?)
      _ -> {:error, :not_found}
    end
  end

  defp set_mute(a, profile_id, on?) do
    if on? do
      Repo.query!(
        "INSERT INTO moment_mutes (account_id, profile_id) SELECT $1, id FROM profiles WHERE id = $2 ON CONFLICT DO NOTHING",
        [dump(a.id), dump(profile_id)]
      )
    else
      Repo.query!("DELETE FROM moment_mutes WHERE account_id = $1 AND profile_id = $2", [
        dump(a.id),
        dump(profile_id)
      ])
    end

    :ok
  end

  # ------------------------------------------------------------------ retention (R-21.22)

  @doc "ExpirySweep: expired Moments and stale uploads go, storage objects first."
  def sweep do
    keys =
      Repo.query!("""
      DELETE FROM moments
      WHERE expires_at < now() OR (status = 'uploading' AND created_at < now() - interval '1 hour')
      RETURNING storage_key
      """).rows
      |> List.flatten()

    Storage.delete_many(Enum.flat_map(keys, &[&1, thumb_of(&1)]))
    length(keys)
  end

  @doc "Storage keys of an account's Moments (account delete, R-21.23)."
  def keys_of(account_id) do
    Repo.query!("SELECT storage_key FROM moments WHERE account_id = $1", [dump(account_id)]).rows
    |> List.flatten()
    |> Enum.flat_map(&[&1, thumb_of(&1)])
  end

  # ------------------------------------------------------------------ helpers

  defp broadcast(profile_id),
    do: Phoenix.PubSub.broadcast(Thirstr.PubSub, "moments:" <> profile_id, {:moments, profile_id})

  defp blank_nil(t) when is_binary(t) do
    case String.trim(t) do
      "" -> nil
      s -> s
    end
  end

  defp blank_nil(_), do: nil

  defp utc(v), do: Thirstr.Explore.utc(v)
  defp dump(uuid), do: Ecto.UUID.dump!(uuid)
end
