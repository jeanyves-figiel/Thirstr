defmodule ThirstrWeb.ModController do
  @moduledoc """
  Moderation at scale (#179, #286, #287): A-01 one prioritised queue, A-12 hash hits & CSAM cases,
  A-13 legal filings, A-14 my moderation day, wellbeing pause (F-15 R-15.44–53, admin-console.md).
  Same rules as `AdminController`: owner session, every view and action audited, never location,
  email, device ids or IPs (R-AD.6).
  """
  use ThirstrWeb, :controller
  import ThirstrWeb.AdminController, only: [audit: 4, e: 1, nav: 0, page: 3, q: 2]
  alias Thirstr.{Moderation, Nearby, Repo, Storage}
  alias Thirstr.Profiles.Photo

  # R-15.51 tiers: 0 CSAM · 1 minor/violence/non-consensual · 2 scam · 3 harassment/hate ·
  # 4 spam/impersonation · 5 other. Report severity (1–6, Reports) maps onto them.
  @report_tier %{1 => 1, 2 => 1, 3 => 2, 4 => 3, 5 => 4, 6 => 5}
  @tier_names %{
    0 => "CSAM",
    1 => "Minor / violence",
    2 => "Scam",
    3 => "Harassment / hate",
    4 => "Spam",
    5 => "Other"
  }
  @types ~w(report photo case appeal quarantine)
  @authorities ~w(ncmec fedpol hotline art18_police europol)
  @break_s 2 * 3600
  @limit_s 4 * 3600

  # ------------------------------------------------------------------ A-01 queue

  def queue(conn, params) do
    conn = track(conn, nil)
    audit(conn.assigns.admin, "view_queue", nil, nil)
    type = if params["type"] in @types, do: params["type"]
    items = items() |> Enum.sort_by(&{&1.tier, &1.due})
    shown = if type, do: Enum.filter(items, &(&1.type == type)), else: items

    tiers =
      Enum.map_join(0..5, "", fn t ->
        n = Enum.count(items, &(&1.tier == t))

        ~s(<span class="chip"><i class="sev" style="background:#{tier_color(t)}"></i>#{t} #{@tier_names[t]} <b>#{n}</b></span> )
      end)

    filters =
      Enum.map_join([nil | @types], " ", fn t ->
        n = if t, do: Enum.count(items, &(&1.type == t)), else: length(items)
        label = if t, do: t, else: "all"
        href = if t, do: "/admin?type=#{t}", else: "/admin"
        style = if t == type, do: ~s( style="color:#f3f0ff;border-color:#f3f0ff"), else: ""
        ~s(<a class="chip" href="#{href}"#{style}>#{label} #{n}</a>)
      end)

    rows =
      Enum.map_join(shown, "", fn i ->
        """
        <tr data-href="#{i.href}"><td><i class="sev" style="background:#{tier_color(i.tier)}"></i>#{i.tier}</td>
        <td>#{e(i.type)}</td><td><a href="#{i.href}">#{e(i.name || "—")}</a></td><td>#{i.why}</td>
        <td>#{i.open}</td><td>#{due(i.due)}</td></tr>
        """
      end)

    page(conn, "Queue", """
    #{nav()}
    <h1>A-01 Queue</h1>
    #{wellbeing_banner(conn.assigns.admin)}
    <p>#{tiers}</p>
    <p>#{filters} <span class="muted">j / k move · Enter opens</span></p>
    <table><tr><th>Tier</th><th>Type</th><th>Profile</th><th>Why</th><th>Open on account</th><th>SLA</th></tr>#{rows}</table>
    #{if shown == [], do: ~s(<p class="muted">Queue empty.</p>), else: ""}
    """)
  end

  @doc "Every open item, one shape: tier, type, name, why (HTML, escaped), open count, due, href."
  def items do
    open_by_account =
      q(
        "SELECT target_account::text, count(*) FROM reports WHERE state = 'open' GROUP BY 1",
        []
      )
      |> Map.new(fn [a, n] -> {a, n} end)

    cases =
      q(
        """
        SELECT c.id::text, c.source, c.provider, c.created_at, c.target_account::text, p.display_name
        FROM csam_cases c LEFT JOIN LATERAL (SELECT display_name FROM profiles WHERE account_id = c.target_account ORDER BY inserted_at LIMIT 1) p ON true
        WHERE c.state = 'open'
        """,
        []
      )
      |> Enum.map(fn [id, src, prov, at, aid, name] ->
        %{
          tier: 0,
          type: "case",
          name: name,
          why: "#{e(src)} · #{e(prov || "")} " <> chip("auto-hidden"),
          open: Map.get(open_by_account, aid, 0) + 1,
          due: DateTime.add(at, 3600, :second),
          href: "/admin/cases/#{id}"
        }
      end)

    reports =
      q(
        """
        SELECT r.id::text, r.reason, r.severity, r.context, r.created_at, p.display_name,
               (r.franked IS NOT NULL), r.target_account::text
        FROM reports r LEFT JOIN profiles p ON p.id = r.target_profile
        WHERE r.state = 'open' LIMIT 500
        """,
        []
      )
      |> Enum.map(fn [id, reason, sev, ctx, at, name, fr, aid] ->
        tier = Map.get(@report_tier, sev, 5)

        %{
          tier: tier,
          type: "report",
          name: name,
          why: "#{e(reason)} · #{e(ctx)}#{if fr, do: " · 🔏", else: ""}",
          open: Map.get(open_by_account, aid, 1),
          due: DateTime.add(at, sla_s(tier), :second),
          href: "/admin/reports/#{id}"
        }
      end)

    photos =
      q(
        """
        SELECT ph.id::text, ph.slot, ph.hash_state, ph.inserted_at, p.display_name,
               (ph.classifier_score->>'explicit')
        FROM photos ph JOIN profiles p ON p.id = ph.profile_id
        WHERE ph.review_state = 'queued' LIMIT 500
        """,
        []
      )
      |> Enum.map(fn [_id, slot, hs, at, name, score] ->
        retry = hs == "retry"

        %{
          tier: if(retry, do: 4, else: 3),
          type: "photo",
          name: name,
          why:
            if(retry,
              do: "hash check failed 30 min " <> chip("retry"),
              else: "classifier #{e(score || "?")} · slot #{slot} · hash #{e(hs || "—")}"
            ),
          open: 1,
          due: DateTime.add(at, 12 * 3600, :second),
          href: "/admin/photos"
        }
      end)

    appeals =
      q(
        """
        SELECT m.id::text, m.action, m.reason, m.created_at,
               (SELECT display_name FROM profiles WHERE account_id = m.target_account ORDER BY inserted_at LIMIT 1)
        FROM moderation_actions m WHERE m.appeal_state = 'open' LIMIT 500
        """,
        []
      )
      |> Enum.map(fn [_id, act, reason, at, name] ->
        tier =
          if reason in Thirstr.Reports.reasons(),
            do: Map.get(@report_tier, Thirstr.Reports.severity(reason), 5),
            else: 5

        %{
          tier: tier,
          type: "appeal",
          name: name,
          why: "#{e(act)} (#{e(reason)}) " <> chip("appeal"),
          open: 1,
          due: DateTime.add(at, 72 * 3600, :second),
          href: "/admin/appeals"
        }
      end)

    quarantine =
      q(
        """
        SELECT a.updated_at, (SELECT display_name FROM profiles WHERE account_id = a.id ORDER BY inserted_at LIMIT 1),
               (SELECT string_agg(m.reason, ', ') FROM moderation_actions m WHERE m.target_account = a.id AND m.action = 'quarantine')
        FROM accounts a WHERE a.status = 'quarantined' LIMIT 500
        """,
        []
      )
      |> Enum.reject(fn [_, _, why] -> why && String.contains?(why, "csam_hash") end)
      |> Enum.map(fn [at, name, why] ->
        %{
          tier: 4,
          type: "quarantine",
          name: name,
          why: "shadow quarantine · #{e(why || "")}",
          open: 1,
          due: DateTime.add(at, 24 * 3600, :second),
          href: "/admin/quarantine"
        }
      end)

    cases ++ reports ++ photos ++ appeals ++ quarantine
  end

  # R-AD.8: tiers 0–1 ≤ 1 h, scam ≤ 12 h, others ≤ 48 h.
  defp sla_s(t) when t <= 1, do: 3600
  defp sla_s(2), do: 12 * 3600
  defp sla_s(_), do: 48 * 3600

  defp due(at) do
    left = DateTime.diff(at, DateTime.utc_now())

    cond do
      left < 0 -> ~s(<span class="danger">overdue #{fmt_s(-left)}</span>)
      true -> "#{fmt_s(left)} left"
    end
  end

  defp fmt_s(s) when s >= 3600, do: "#{div(s, 3600)} h #{rem(div(s, 60), 60)}"
  defp fmt_s(s), do: "#{div(s, 60)} min"

  defp chip(t), do: ~s(<span class="chip">#{e(t)}</span>)

  defp tier_color(0), do: "#ff2e63"
  defp tier_color(1), do: "#ff5470"
  defp tier_color(2), do: "#ffb547"
  defp tier_color(3), do: "#a78bfa"
  defp tier_color(4), do: "#6e8bff"
  defp tier_color(_), do: "#7a7399"

  # ------------------------------------------------------------------ A-12 cases

  def cases(conn, _) do
    conn = track(conn, nil)
    audit(conn.assigns.admin, "view_cases", nil, nil)

    rows =
      q(
        """
        SELECT c.id::text, c.state, c.source, c.provider, c.created_at,
               (SELECT display_name FROM profiles WHERE account_id = c.target_account ORDER BY inserted_at LIMIT 1),
               (SELECT count(*) FROM csam_filings f WHERE f.case_id = c.id)
        FROM csam_cases c ORDER BY (c.state = 'open') DESC, c.created_at DESC LIMIT 200
        """,
        []
      )
      |> Enum.map_join("", fn [id, st, src, prov, at, name, filed] ->
        """
        <tr data-href="/admin/cases/#{id}"><td><a href="/admin/cases/#{id}">#{short_ref(id)}</a></td><td>#{e(st)}</td>
        <td>#{e(src)} · #{e(prov || "")}</td><td>#{e(name || "—")}</td><td>#{DateTime.to_iso8601(at)}</td><td>#{filed}</td></tr>
        """
      end)

    page(conn, "Cases", """
    #{nav()}<h1>A-12 Hash hits &amp; CSAM cases</h1>
    <p class="muted">Provider: #{e(Thirstr.Moderation.HashMatch.provider_name())}. PhotoDNA calls this month: #{month_calls()}.</p>
    <table><tr><th>Case</th><th>State</th><th>Source</th><th>Profile</th><th>Opened</th><th>Filings</th></tr>#{rows}</table>
    """)
  end

  defp month_calls do
    [[n]] =
      q(
        "SELECT count(*) FROM photos WHERE hash_provider = 'photodna' AND hash_checked_at >= date_trunc('month', now())",
        []
      )

    n
  end

  def case_detail(conn, %{"id" => id}) do
    case load_case(id) do
      nil ->
        send_resp(conn, 404, "")

      c ->
        conn = track(conn, 0)
        audit(conn.assigns.admin, "view_case", id, nil)
        page(conn, "Case", case_page(c, nil))
    end
  end

  defp load_case(id) do
    with {:ok, _} <- Ecto.UUID.cast(id),
         [[cid, st, src, prov, ref, aid, key, snap, at, hold, by, dat, sha]] <-
           q(
             """
             SELECT id::text, state, source, provider, match_ref, target_account::text, evidence_key,
                    snapshot, created_at, hold_until, decided_by, decided_at, sha256
             FROM csam_cases WHERE id = $1
             """,
             [Nearby.dump(id)]
           ) do
      %{
        id: cid,
        state: st,
        source: src,
        provider: prov,
        ref: ref,
        account: aid,
        key: key,
        snapshot: snap || %{},
        at: at,
        hold: hold,
        by: by,
        decided_at: dat,
        sha: sha
      }
    else
      _ -> nil
    end
  end

  defp case_page(c, shown_url) do
    csrf = ~s(<input type="hidden" name="_csrf_token" value="#{get_csrf_token()}">)
    snap = c.snapshot

    image =
      if shown_url,
        do:
          ~s(<div class="img" style="filter:none"><img alt="" style="filter:none" src="#{e(shown_url)}"></div><p class="muted">Shown once. Reload to hide.</p>),
        else: """
        <div class="img blur"><span class="muted" style="display:block;padding:12px">Hidden by default</span></div>
        <form method="post" action="/admin/cases/#{c.id}/view">#{csrf}
          <input name="reason" placeholder="Reason to view (required)" required maxlength="200">
          <label><input type="checkbox" name="confirm" value="yes" required> I need to see it; this view is logged</label>
          <button>View once</button></form>
        <p class="muted">A provider match is a known image: you usually don't need to look.</p>
        """

    decision =
      if c.state == "open",
        do: """
        <form method="post" action="/admin/cases/#{c.id}/decision">#{csrf}
          <button name="decision" value="confirm" style="background:#ff5470;color:#fff">Confirm: ban + report</button>
          <button name="decision" value="false_positive">False positive</button>
        </form>
        <p class="muted">Confirm bans the account, blocks this exact image and opens the legal report (below). False positive sends the photo to a person in A-03 and lifts the quarantine.</p>
        """,
        else:
          ~s(<p>Decided <b>#{e(c.state)}</b> by #{e(short_ref(c.by))} · #{c.decided_at && DateTime.to_iso8601(c.decided_at)}</p>)

    """
    #{nav()}<h1>A-12 Case #{short_ref(c.id)}</h1>
    #{if c.state == "open", do: ~s(<p class="banner"><b>Known-image match.</b> Never published. Account quarantined; the uploader only saw "This photo can't be used".</p>), else: ""}
    <div style="display:flex;gap:16px;flex-wrap:wrap">
      <div class="card">#{image}</div>
      <div class="card" style="flex:1;min-width:260px">
        <p>Source <b>#{e(c.source)}</b> · provider #{e(c.provider || "—")} · match #{e(c.ref || "—")}</p>
        <p>SHA-256 <code>#{e(sha_hex(c.sha))}</code></p>
        <p>Opened #{DateTime.to_iso8601(c.at)} · SLA #{ThirstrWeb.AdminController.sla(1, c.at)}</p>
        <p>Profile at upload: <b>#{e(snap["display_name"] || "—")}</b>, #{e(snap["age"] || "")} · slot #{e(snap["slot"] || "—")}</p>
        <p>Evidence kept until #{Date.to_iso8601(DateTime.to_date(c.hold))}</p>
        #{decision}
      </div>
    </div>
    #{if c.state == "confirmed", do: legal_section(c, csrf), else: ""}
    """
  end

  # ------------------------------------------------------------------ A-13 legal filings

  defp legal_section(c, csrf) do
    filed =
      q(
        "SELECT authority, country, external_ref, filed_at FROM csam_filings WHERE case_id = $1 ORDER BY filed_at",
        [Nearby.dump(c.id)]
      )

    done = MapSet.new(filed, fn [a | _] -> a end)

    rows =
      Enum.map_join(filed, "", fn [a, cc, ref, at] ->
        "<tr><td>#{e(a)}</td><td>#{e(cc || "")}</td><td>#{e(ref || "")}</td><td>#{DateTime.to_iso8601(at)}</td></tr>"
      end)

    steps =
      [
        {"ncmec", "NCMEC CyberTipline", "File as ESP from the pack, paste the report id."},
        {"fedpol", "fedpol (Switzerland)",
         "Operator's national authority, cybercrime reporting form."},
        {"hotline", "Country hotline (INHOPE)",
         "From the user's IP country when known: e.g. jugendschutz.net DE, Point de Contact FR, IWF UK."},
        {"art18_police", "Threat to life or safety?",
         "DSA Art. 18: police of the member state concerned (or Europol)."}
      ]
      |> Enum.map_join("", fn {a, title, hint} ->
        """
        <div class="card"><b>#{if MapSet.member?(done, a), do: "✓ ", else: ""}#{title}</b> <span class="muted">#{hint}</span>
        <form method="post" action="/admin/cases/#{c.id}/filings" style="margin-top:6px">#{csrf}
          <input type="hidden" name="authority" value="#{a}">
          <input name="country" placeholder="CC" maxlength="2" style="width:3em">
          <input name="external_ref" placeholder="Reference" maxlength="100">
          <button>Mark filed</button></form></div>
        """
      end)

    """
    <h2>A-13 Legal report</h2>
    <p><a href="/admin/cases/#{c.id}/pack">Download report pack (JSON)</a> <span class="muted">· every download is logged</span></p>
    #{steps}
    <table><tr><th>Filed with</th><th>Country</th><th>Reference</th><th>When</th></tr>#{rows}</table>
    """
  end

  def add_filing(conn, %{"id" => id, "authority" => a} = p) when a in @authorities do
    case load_case(id) do
      %{state: "confirmed"} = c -> file_case(conn, c, a, p)
      _ -> send_resp(conn, 404, "")
    end
  end

  def add_filing(conn, _), do: send_resp(conn, 422, "Unknown authority")

  defp file_case(conn, c, a, p) do
    id = c.id

    q(
      "INSERT INTO csam_filings (case_id, authority, country, external_ref, filed_by) VALUES ($1, $2, $3, $4, $5)",
      [
        Nearby.dump(c.id),
        a,
        blank(String.upcase(String.slice(p["country"] || "", 0, 2))),
        blank(String.slice(p["external_ref"] || "", 0, 100)),
        conn.assigns.admin
      ]
    )

    audit(conn.assigns.admin, "case_filed_" <> a, id, nil)
    redirect(conn, to: "/admin/cases/#{id}")
  end

  @doc "Report pack (R-15.48): what the authorities need, nothing more. No IPs exist to include."
  def pack(conn, %{"id" => id}) do
    case load_case(id) do
      %{state: "confirmed"} = c -> send_pack(conn, c)
      _ -> send_resp(conn, 404, "")
    end
  end

  defp send_pack(conn, c) do
    audit(conn.assigns.admin, "case_pack", c.id, nil)

    [[signup, last]] =
      q(
        "SELECT a.inserted_at, (SELECT max(r.inserted_at) FROM refresh_tokens r WHERE r.account_id = a.id) FROM accounts a WHERE a.id = $1",
        [Nearby.dump(c.account)]
      )

    body = %{
      case: c.id,
      service: "Thirstr (thirstr.fun)",
      detected_by: c.source,
      provider: c.provider,
      match_ref: c.ref,
      sha256: sha_hex(c.sha),
      uploaded_at: c.at,
      confirmed_at: c.decided_at,
      account: %{id: c.account, signed_up_at: signup, last_sign_in_at: last},
      public_profile_at_upload: c.snapshot,
      evidence_kept_until: c.hold,
      note: "The image is preserved and available to law enforcement on request."
    }

    conn
    |> put_resp_header(
      "content-disposition",
      ~s(attachment; filename="case-#{short_ref(c.id)}.json")
    )
    |> put_resp_header("cache-control", "no-store")
    |> json(body)
  end

  # ------------------------------------------------------------------ decisions

  def case_decision(conn, %{"id" => id, "decision" => d})
      when d in ~w(confirm false_positive) do
    case Repo.query!(
           "UPDATE csam_cases SET state = $2, decided_by = $3, decided_at = now() WHERE id = $1 AND state = 'open' RETURNING target_account::text, photo_id::text, sha256",
           [
             Nearby.dump(id),
             if(d == "confirm", do: "confirmed", else: "false_positive"),
             conn.assigns.admin
           ]
         ).rows do
      [[aid, photo_id, sha]] ->
        apply_decision(d, id, aid, photo_id, sha, conn.assigns.admin)
        audit(conn.assigns.admin, "case_" <> d, id, nil)
        conn |> track(nil) |> redirect(to: "/admin/pause?next=/admin/cases/#{id}")

      _ ->
        send_resp(conn, 404, "")
    end
  end

  def case_decision(conn, _), do: send_resp(conn, 422, "")

  defp apply_decision("confirm", id, aid, _photo_id, sha, _actor) do
    {:ok, _} = Moderation.enforce(aid, "ban", "csam", "admin")

    if sha,
      do:
        q(
          "INSERT INTO hash_blocklist (sha256, case_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
          [sha, Nearby.dump(id)]
        )
  end

  defp apply_decision("false_positive", _id, aid, photo_id, _sha, _actor) do
    Moderation.enforce(aid, "release", "csam_false_positive", "admin")

    if photo_id do
      q(
        "UPDATE photos SET status = 'pending', review_state = 'queued', hash_state = 'no_match', reject_reason = NULL WHERE id = $1",
        [Nearby.dump(photo_id)]
      )
    end
  end

  @doc "R-15.52: viewing a case image needs a reason and a second confirm; one audit entry each."
  def case_view(conn, %{"id" => id, "reason" => reason, "confirm" => "yes"})
      when byte_size(reason) > 3 do
    case load_case(id) do
      %{key: key} = c when is_binary(key) ->
        audit(conn.assigns.admin, "case_image_view", id, String.slice(reason, 0, 200))
        page(conn, "Case", case_page(c, Storage.presigned_get(key, 60)))

      _ ->
        send_resp(conn, 404, "")
    end
  end

  def case_view(conn, _), do: send_resp(conn, 422, "Add a reason and tick the confirm box")

  @doc "R-15.45: a person escalates a photo in A-03 as child sexual abuse material."
  def escalate_photo(conn, %{"id" => id}) do
    with {:ok, _} <- Ecto.UUID.cast(id),
         %Photo{} = ph <- Repo.get(Photo, id) |> Repo.preload(profile: :account) do
      ph
      |> Ecto.Changeset.change(
        status: "rejected",
        reject_reason: "unusable",
        review_state: "hash_hit"
      )
      |> Repo.update!()

      Thirstr.Profiles.refresh_photo_ids(ph.profile_id)

      {:ok, sha} =
        case Storage.get(ph.storage_key) do
          {:ok, bytes} -> {:ok, :crypto.hash(:sha256, bytes)}
          _ -> {:ok, nil}
        end

      {:ok, cid} =
        Thirstr.Moderation.HashMatch.open_case(
          ph.profile.account,
          %{
            photo_id: ph.id,
            key: ph.storage_key,
            source: "classifier",
            snapshot: Thirstr.Profiles.snapshot(ph.profile, ph.slot)
          },
          %{"provider" => "staff", "sha256" => sha}
        )

      audit(conn.assigns.admin, "photo_escalate_csam", id, nil)
      redirect(conn, to: "/admin/cases/#{cid}")
    else
      _ -> send_resp(conn, 404, "")
    end
  end

  @doc "Reveal button (R-15.52): the reveal is written to the audit log."
  def reveal(conn, %{"id" => id}) when is_binary(id) do
    audit(conn.assigns.admin, "image_reveal", String.slice(id, 0, 64), nil)
    send_resp(conn, 204, "")
  end

  def reveal(conn, _), do: send_resp(conn, 422, "")

  # ------------------------------------------------------------------ wellbeing (R-15.53)

  def pause(conn, params) do
    next =
      case params["next"] do
        "/admin" <> _ = n -> n
        _ -> "/admin"
      end

    page(conn, "Pause", """
    <div class="card" style="text-align:center;padding:40px 16px">
      <h1>Short pause</h1>
      <p class="muted">You just finished a tier 0 case. The console opens again in a minute.</p>
      <p id="t" style="font-size:28px">60</p>
      <p><a href="https://www.inhope.org/EN" rel="noreferrer">Support resources for content reviewers</a></p>
      <p><a id="go" href="#{e(next)}" hidden>Continue</a></p>
    </div>
    <script>
    let n = 60; const t = document.getElementById('t');
    const iv = setInterval(() => { n -= 1; t.textContent = n; if (n <= 0) { clearInterval(iv); document.getElementById('go').hidden = false; } }, 1000);
    </script>
    """)
  end

  def my_day(conn, _) do
    conn = track(conn, nil)
    me = conn.assigns.admin
    by_tier = today(me)
    severe = Map.get(by_tier, 0, 0) + Map.get(by_tier, 1, 0)

    [[items]] =
      q(
        "SELECT count(*) FROM admin_audit WHERE actor = $1 AND at >= date_trunc('day', now()) AND action NOT LIKE 'view_%'",
        [me]
      )

    page(conn, "My day", """
    #{nav()}<h1>A-14 My moderation day</h1>
    #{wellbeing_banner(me)}
    <table><tr><th>Decisions today</th><td>#{items}</td></tr>
    <tr><th>Time on tiers 0–1</th><td>#{fmt_s(severe)} of #{div(@limit_s, 3600)} h</td></tr>
    #{Enum.map_join(0..5, "", fn t -> "<tr><th>Tier #{t} · #{@tier_names[t]}</th><td>#{fmt_s(Map.get(by_tier, t, 0))}</td></tr>" end)}
    </table>
    <p class="muted">Break reminder at 2 h on tiers 0–1, limit 4 h a day. Only you can see this page.</p>
    """)
  end

  defp today(me) do
    q("SELECT tier, seconds FROM mod_time WHERE moderator = $1 AND day = current_date", [me])
    |> Map.new(fn [t, s] -> {t, s} end)
  end

  defp wellbeing_banner(me) do
    by_tier = today(me)
    s = Map.get(by_tier, 0, 0) + Map.get(by_tier, 1, 0)

    cond do
      # Beta: the owner is the only moderator, so the 4 h limit warns instead of locking (D-12).
      s >= @limit_s ->
        ~s(<p class="warn"><b>Over 4 h on tiers 0–1 today.</b> With other moderators these tiers would lock until tomorrow. Take a break.</p>)

      s >= @break_s ->
        ~s(<p class="warn"><b>2 h on tiers 0–1 today.</b> Time for a break.</p>)

      true ->
        ""
    end
  end

  @doc """
  Wellbeing timer: time since the previous console page counts toward that page's tier when it
  was 0–1 (capped at 5 min per page). `tier` = tier of the page being opened, nil for none.
  """
  def track(conn, tier) do
    now = System.system_time(:second)

    case get_session(conn, :mod_tier) do
      [t, at] when t in [0, 1] ->
        secs = min(max(now - at, 0), 300)

        q(
          """
          INSERT INTO mod_time (moderator, day, tier, seconds) VALUES ($1, current_date, $2, $3)
          ON CONFLICT (moderator, day, tier) DO UPDATE SET seconds = mod_time.seconds + EXCLUDED.seconds
          """,
          [conn.assigns.admin, t, secs]
        )

      _ ->
        :ok
    end

    put_session(conn, :mod_tier, if(tier, do: [tier, now]))
  end

  @doc "Tier of a report severity (for `track/2` from the report page)."
  def report_tier(sev), do: Map.get(@report_tier, sev, 5)

  defp sha_hex(nil), do: "—"
  defp sha_hex(b), do: Base.encode16(b, case: :lower)

  defp short_ref(nil), do: "—"
  defp short_ref(id), do: id |> String.slice(0, 8) |> String.upcase()

  defp blank(""), do: nil
  defp blank(s), do: s
end
