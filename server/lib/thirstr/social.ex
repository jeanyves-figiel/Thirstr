defmodule Thirstr.Social do
  @moduledoc """
  Profile view (S-20), taps (R-07.15), blocks (account-level, both ways), hides (F-04),
  Now status (F-09 R-09.1…R-09.4). Quarantined senders get fake success (AC-15.1).
  """
  alias Thirstr.{Location, Profiles, Repo, Settings, Storage, Valkey}
  alias Thirstr.Accounts.Account
  alias Thirstr.Profiles.Fields

  @views_per_hour 300
  @taps_per_day 100

  # ------------------------------------------------------------------ lookup

  @doc "Loads a target profile if the viewer may see it at all (not blocked, active)."
  def target(%Account{} = viewer, profile_id) do
    with {:ok, _} <- Ecto.UUID.cast(profile_id),
         %{rows: [row]} <-
           Repo.query!(
             """
             SELECT p.id::text, p.kind, p.display_name, p.age, p.gender, p.gender_other, p.fields,
                    p.visibility_map, a.id::text, a.verified_at, a.inserted_at, a.settings, a.status,
                    p.seeded, p.public_updated_at, p.show_in
             FROM profiles p JOIN accounts a ON a.id = p.account_id
             WHERE p.id = $1
               AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.account_from = $2 AND b.account_to = a.id)
                                                        OR (b.account_from = a.id AND b.account_to = $2))
             """,
             [dump(profile_id), dump(viewer.id)]
           ),
         [
           id,
           kind,
           name,
           age,
           g,
           go,
           fields,
           vis,
           aid,
           vat,
           ins,
           settings,
           status,
           seeded,
           upd,
           show_in
         ] =
           Enum.map(row, &Thirstr.Explore.utc_any/1),
         true <- status == "active" or aid == viewer.id do
      {:ok,
       %{
         id: id,
         kind: kind,
         display_name: name,
         age: age,
         gender: g,
         gender_other: go,
         fields: fields,
         vis: vis,
         account_id: aid,
         verified_at: vat,
         inserted_at: ins,
         settings: Map.merge(Settings.defaults(), settings || %{}),
         seeded: seeded,
         show_in: show_in || ["hookup"],
         updated_at: upd
       }}
    else
      _ -> {:error, :not_found}
    end
  end

  # ------------------------------------------------------------------ profile view (S-20)

  @doc """
  GET /profiles/:id?mode — viewer-filtered (AC-06.1) through the viewer's lens (F-06 R-06.1b):
  Friends/Sport show only `main_ok` photos and no hookup/health fields; 404 when the profile
  isn't shown in that mode (AC-06.4). D-09 cap 300 views/hour.
  """
  def view(%Account{} = viewer, profile_id, mode \\ "hookup", point \\ nil) do
    lens = if mode in Fields.lenses(), do: mode, else: "hookup"

    with {:ok, _} <- limit(viewer, "views", @views_per_hour, 3600),
         {:ok, t} <- target(viewer, profile_id),
         true <- t.account_id == viewer.id or lens in t.show_in or {:error, :not_found} do
      audience = if Account.verified?(viewer), do: :verified, else: :stranger
      {fields, _} = Fields.visible(t.fields || %{}, t.vis || %{}, audience)
      fields = Fields.lens(fields, lens)

      photos =
        Repo.query!(
          """
          SELECT storage_key FROM photos WHERE profile_id = $1 AND status IN ('ok_main','ok_public')
            AND ($2 = 'hookup' OR (classifier_score->>'main_ok')::boolean IS TRUE)
          ORDER BY slot
          """,
          [dump(t.id), lens]
        ).rows
        |> List.flatten()
        |> Enum.map(&Storage.presigned_get/1)

      mine = own_profile_ids(viewer)
      vp = if point, do: Map.take(point, [:lat, :lng, :res]), else: Location.viewer_point(viewer)
      # F-20 R-20.7: the trip shows only to viewers in (or looking around) the trip city.
      trip = if t.account_id != viewer.id, do: Thirstr.Trips.for_profile(vp, t.id)

      {:ok,
       %{
         id: t.id,
         kind: t.kind,
         mode: lens,
         display_name: t.display_name,
         age: t.age,
         gender: t.gender,
         gender_other: t.gender_other,
         fields: fields,
         photos: photos,
         verified: not is_nil(t.verified_at),
         verified_since: t.verified_at && Calendar.strftime(t.verified_at, "%Y-%m"),
         member_since: Calendar.strftime(t.inserted_at, "%Y-%m"),
         now: now_of(t.id),
         online: online?(viewer, t),
         distance:
           if(trip && not trip.here, do: nil, else: distance_to(viewer, t, vp, not is_nil(point))),
         trip: trip,
         tapped: tapped?(mine, t.id),
         tapped_me: tapped_me?(mine, t.id),
         vouches: Thirstr.Trust.vouch_count(t.id),
         vouched: Thirstr.Trust.vouched?(viewer, t.id),
         can_vouch: t.account_id != viewer.id and Thirstr.Trust.can_vouch?(viewer, t.id),
         badges: Thirstr.Trust.badges(t),
         linked_accounts:
           Thirstr.Linked.visible(t.id, viewer, audience, t.account_id == viewer.id),
         updated_at: t.updated_at,
         # F-21 R-21.9: ring on the profile photo
         moments: Thirstr.Moments.summary(viewer, t.id, lens),
         self: t.account_id == viewer.id
       }}
    end
  end

  # F-07 R-07.33 (#115): same rule as Explore (R-17.5, symmetric): both sides show online status,
  # last request within 5 min (auth plug writes `seen:<account>`).
  @online_s 300
  defp online?(viewer, t) do
    t.account_id != viewer.id and Settings.get(viewer, "online_visible") != false and
      (t.settings || %{})["online_visible"] != false and
      case Valkey.command!(["GET", "seen:" <> t.account_id]) do
        nil -> false
        v -> System.system_time(:second) - String.to_integer(v) < @online_s
      end
  end

  defp distance_to(viewer, t, vp, remote?) do
    with %{} = vp <- vp,
         %{rows: [[level, lat, lng, r5, dres]]} <-
           Repo.query!(
             """
             SELECT lc.level, (h3_cell_to_lat_lng(d))[1], (h3_cell_to_lat_lng(d))[0], lc.cell_r5::h3index::text, lc.display_res
             FROM location_cells lc,
             LATERAL (SELECT (CASE lc.display_res WHEN 10 THEN lc.cell_r10 WHEN 9 THEN lc.cell_r9 WHEN 8 THEN lc.cell_r8
                       WHEN 7 THEN lc.cell_r7 ELSE lc.cell_r5 END)::h3index d) x
             WHERE lc.profile_id = $1
             """,
             [dump(t.id)]
           ) do
      # F-20 R-20.16: no Exact pins from afar
      pin = unless remote?, do: Location.pins([t.id])[t.id]
      dist = haversine(vp, pin || %{lat: lat, lng: lng})

      Thirstr.Explore.distance(
        %{
          settings: t.settings,
          level: level,
          pin: pin,
          dist_m: dist,
          cell_r5: r5,
          display_res: dres
        },
        %{verified: Account.verified?(viewer), brake: Location.spoof_brake?(viewer)}
      )
    else
      _ -> nil
    end
  end

  defp haversine(%{lat: la1, lng: lo1}, %{lat: la2, lng: lo2}) do
    dlat = (la2 - la1) * :math.pi() / 180
    dlng = (lo2 - lo1) * :math.pi() / 180

    a =
      :math.sin(dlat / 2) ** 2 +
        :math.cos(la1 * :math.pi() / 180) * :math.cos(la2 * :math.pi() / 180) *
          :math.sin(dlng / 2) ** 2

    2 * 6_371_000 * :math.asin(:math.sqrt(a))
  end

  def own_profile_ids(%Account{id: id}) do
    Repo.query!("SELECT id FROM profiles WHERE account_id = $1", [dump(id)]).rows
    |> List.flatten()
  end

  defp tapped?(mine, tid),
    do:
      Repo.query!(
        "SELECT 1 FROM taps WHERE from_profile_id = ANY($1) AND to_profile_id = $2 AND created_at > now() - interval '7 days'",
        [mine, dump(tid)]
      ).num_rows > 0

  defp tapped_me?(mine, tid),
    do:
      Repo.query!(
        "SELECT 1 FROM taps WHERE to_profile_id = ANY($1) AND from_profile_id = $2 AND created_at > now() - interval '7 days'",
        [mine, dump(tid)]
      ).num_rows > 0

  # ------------------------------------------------------------------ taps

  @doc "POST /profiles/:id/tap — verified only (D-10), 100/day, expires 7 d. Returns mutual."
  def tap(%Account{} = a, profile_id) do
    with :ok <- require_verified(a),
         {:ok, t} <- target(a, profile_id),
         true <- t.account_id != a.id || {:error, {:conflict, "That's you"}},
         {:ok, _} <- limit(a, "taps", taps_limit(a), 86_400),
         %{} = from <- sender_profile(a, t.kind) do
      if a.status == "quarantined" do
        {:ok, %{mutual: false}}
      else
        Repo.query!(
          """
          INSERT INTO taps (from_profile_id, to_profile_id, created_at) VALUES ($1, $2, now())
          ON CONFLICT (from_profile_id, to_profile_id) DO UPDATE SET created_at = now(), seen = false
          """,
          [dump(from.id), dump(t.id)]
        )

        mutual =
          Repo.query!(
            "SELECT 1 FROM taps WHERE from_profile_id = $1 AND to_profile_id = $2 AND created_at > now() - interval '7 days'",
            [dump(t.id), dump(from.id)]
          ).num_rows > 0

        Thirstr.Notify.event(t.account_id, (mutual && "tap.mutual") || "tap.new", %{
          profile_id: t.id
        })

        {:ok, %{mutual: mutual}}
      end
    else
      nil -> {:error, {:conflict, "Create your #{profile_label(profile_id)} profile first"}}
      e -> e
    end
  end

  defp profile_label(_), do: "matching"

  defp sender_profile(a, kind), do: Profiles.get_by_kind(a, kind)

  defp taps_limit(a), do: if(Account.new?(a), do: div(@taps_per_day, 2), else: @taps_per_day)

  @doc "GET /taps — received in the last 7 days, newest first."
  def taps(%Account{} = a) do
    Repo.query!(
      """
      SELECT p.id::text, p.display_name, p.age, a2.verified_at IS NOT NULL, COALESCE(ph.thumb_key, ph.storage_key), t.created_at, t.seen,
             EXISTS (SELECT 1 FROM taps r WHERE r.from_profile_id = t.to_profile_id AND r.to_profile_id = t.from_profile_id
                     AND r.created_at > now() - interval '7 days'), mine.kind
      FROM taps t
      JOIN profiles mine ON mine.id = t.to_profile_id
      JOIN profiles p ON p.id = t.from_profile_id
      JOIN accounts a2 ON a2.id = p.account_id
      LEFT JOIN photos ph ON ph.id = p.photo_ids[1]
      WHERE mine.account_id = $1 AND t.created_at > now() - interval '7 days' AND a2.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.account_from = $1 AND b.account_to = a2.id)
                                                 OR (b.account_from = a2.id AND b.account_to = $1))
      ORDER BY t.created_at DESC LIMIT 200
      """,
      [dump(a.id)]
    ).rows
    |> Enum.map(fn [id, name, age, ver, key, at, seen, mutual, kind] ->
      %{
        profile: %{
          id: id,
          display_name: name,
          age: age,
          verified: ver,
          photo: key && Storage.presigned_get(key)
        },
        at: Thirstr.Explore.utc(at),
        seen: seen,
        mutual: mutual,
        kind: kind
      }
    end)
  end

  def mark_taps_seen(%Account{} = a) do
    Repo.query!(
      "UPDATE taps SET seen = true WHERE to_profile_id IN (SELECT id FROM profiles WHERE account_id = $1)",
      [dump(a.id)]
    )

    :ok
  end

  # ------------------------------------------------------------------ blocks & hides

  @doc "Account-level block, both directions (data-model.md). Removes taps both ways."
  def block(%Account{} = a, profile_id) do
    with {:ok, t} <- target_any(profile_id),
         true <- t.account_id != a.id || {:error, {:conflict, "That's you"}} do
      Repo.query!(
        "INSERT INTO blocks (account_from, account_to, created_at) VALUES ($1, $2, now()) ON CONFLICT DO NOTHING",
        [dump(a.id), dump(t.account_id)]
      )

      Repo.query!(
        """
        DELETE FROM taps WHERE
          (from_profile_id IN (SELECT id FROM profiles WHERE account_id = $1) AND to_profile_id IN (SELECT id FROM profiles WHERE account_id = $2))
          OR (from_profile_id IN (SELECT id FROM profiles WHERE account_id = $2) AND to_profile_id IN (SELECT id FROM profiles WHERE account_id = $1))
        """,
        [dump(a.id), dump(t.account_id)]
      )

      # snapshot for the "Blocked" list (device shows it; server keeps name only)
      Valkey.put_term("blockname:#{a.id}:#{t.id}", t.display_name, 365 * 86_400)
      :ok
    end
  end

  def unblock(%Account{} = a, profile_id) do
    with {:ok, t} <- target_any(profile_id) do
      Repo.query!("DELETE FROM blocks WHERE account_from = $1 AND account_to = $2", [
        dump(a.id),
        dump(t.account_id)
      ])

      :ok
    end
  end

  @doc "GET /me/blocks — the profile you blocked (id + name only)."
  def blocks(%Account{} = a) do
    Repo.query!(
      """
      SELECT p.id::text, p.display_name, p.age, COALESCE(ph.thumb_key, ph.storage_key), b.created_at FROM blocks b
      JOIN profiles p ON p.account_id = b.account_to AND p.kind = 'now'
      LEFT JOIN photos ph ON ph.id = p.photo_ids[1]
      WHERE b.account_from = $1 ORDER BY b.created_at DESC
      """,
      [dump(a.id)]
    ).rows
    |> Enum.map(&listed/1)
  end

  @doc "GET /me/hidden (#111): profiles hidden from my Explore, newest first."
  def hidden(%Account{} = a) do
    Repo.query!(
      """
      SELECT p.id::text, p.display_name, p.age, COALESCE(ph.thumb_key, ph.storage_key), h.created_at FROM profile_hides h
      JOIN profiles p ON p.id = h.profile_id
      JOIN accounts a2 ON a2.id = p.account_id AND a2.status = 'active'
      LEFT JOIN photos ph ON ph.id = p.photo_ids[1]
      WHERE h.account_id = $1 ORDER BY h.created_at DESC LIMIT 500
      """,
      [dump(a.id)]
    ).rows
    |> Enum.map(&listed/1)
  end

  defp listed([id, name, age, key, at]) do
    %{
      profile_id: id,
      display_name: name,
      age: age,
      photo: key && Storage.presigned_get(key),
      at: Thirstr.Explore.utc(at)
    }
  end

  def hide(%Account{} = a, profile_id) do
    with {:ok, t} <- target(a, profile_id) do
      Repo.query!(
        "INSERT INTO profile_hides (account_id, profile_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [dump(a.id), dump(t.id)]
      )

      :ok
    end
  end

  def unhide(%Account{} = a, profile_id) do
    case Ecto.UUID.cast(profile_id) do
      {:ok, _} ->
        Repo.query!("DELETE FROM profile_hides WHERE account_id = $1 AND profile_id = $2", [
          dump(a.id),
          dump(profile_id)
        ])

        :ok

      _ ->
        {:error, :not_found}
    end
  end

  defp target_any(profile_id) do
    with {:ok, _} <- Ecto.UUID.cast(profile_id),
         %{rows: [[id, aid, name]]} <-
           Repo.query!(
             "SELECT id::text, account_id::text, display_name FROM profiles WHERE id = $1",
             [dump(profile_id)]
           ) do
      {:ok, %{id: id, account_id: aid, display_name: name}}
    else
      _ -> {:error, :not_found}
    end
  end

  @doc "True if either account blocked the other."
  def blocked?(account_a, account_b) do
    Repo.query!(
      "SELECT 1 FROM blocks WHERE (account_from = $1 AND account_to = $2) OR (account_from = $2 AND account_to = $1)",
      [dump(account_a), dump(account_b)]
    ).num_rows > 0
  end

  # ------------------------------------------------------------------ Now (F-09)

  @now_statuses ~w(now hosting can_travel door_open)
  @now_ttls [3600, 7200, 10_800, 21_600]

  @doc "PUT /me/now — verified only (AC-09.2), text 80, TTL 1/2/3/6 h. Hookup (Now) profile."
  def set_now(%Account{} = a, params) do
    status = params["status"]
    text = params["text"]
    ttl = params["ttl_s"]

    cond do
      not Account.verified?(a) ->
        {:error, {:not_verified, "Verify to post a Now status"}}

      status not in @now_statuses ->
        {:error, {:validation, %{status: ["invalid"]}}}

      ttl not in @now_ttls ->
        {:error, {:validation, %{ttl_s: ["1, 2, 3 or 6 hours"]}}}

      is_binary(text) and String.length(text) > 80 ->
        {:error, {:validation, %{text: ["max 80 characters"]}}}

      is_binary(text) and
          (Thirstr.Moderation.Text.contact_details?(text) or Thirstr.Moderation.Text.link?(text)) ->
        {:error, {:validation, %{text: ["no links or contact details"]}}}

      true ->
        case Profiles.get_by_kind(a, "now") do
          nil ->
            {:error, :basics_required}

          p ->
            Repo.query!(
              """
              INSERT INTO now_status (profile_id, status, text, created_at, expires_at)
              VALUES ($1, $2, $3, now(), now() + make_interval(secs => $4))
              ON CONFLICT (profile_id) DO UPDATE SET status = EXCLUDED.status, text = EXCLUDED.text,
                created_at = now(), expires_at = EXCLUDED.expires_at
              """,
              [dump(p.id), status, blank_nil(text), ttl]
            )

            {:ok, now_of(p.id)}
        end
    end
  end

  def end_now(%Account{} = a) do
    Repo.query!(
      "DELETE FROM now_status WHERE profile_id IN (SELECT id FROM profiles WHERE account_id = $1)",
      [dump(a.id)]
    )

    :ok
  end

  def now_of(profile_id) do
    case Repo.query!(
           "SELECT status, text, created_at, expires_at FROM now_status WHERE profile_id = $1 AND expires_at > now()",
           [dump(profile_id)]
         ).rows do
      [[s, t, c, e]] ->
        %{status: s, text: t, since: Thirstr.Explore.utc(c), expires_at: Thirstr.Explore.utc(e)}

      _ ->
        nil
    end
  end

  defp blank_nil(""), do: nil
  defp blank_nil(t) when is_binary(t), do: String.trim(t)
  defp blank_nil(_), do: nil

  # ------------------------------------------------------------------ helpers

  def require_verified(%Account{} = a),
    do: if(Account.verified?(a), do: :ok, else: {:error, {:not_verified, "Verify to do this"}})

  def limit(%Account{id: id}, bucket, n, window) do
    case Valkey.hit(
           "rl:#{id}:#{bucket}",
           n * Application.get_env(:thirstr, :rate_limit_multiplier, 1),
           window
         ) do
      {:ok, c} -> {:ok, c}
      {:error, :rate_limited, retry} -> {:error, {:rate_limited, retry}}
    end
  end

  defp dump(uuid), do: Ecto.UUID.dump!(uuid)
end
