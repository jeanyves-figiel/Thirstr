defmodule ThirstrWeb.AdminController do
  @moduledoc """
  Admin & moderation console (admin-console.md), beta form: server-rendered pages in the API app,
  owner-only passkey login (R-AD.12), every view and action written to `admin_audit` (R-AD.4).

  Screens: A-02 report detail, A-03 photo review, A-04 quarantine, A-05 appeals,
  A-10 audit log. Never shown: location, email, device ids, IPs, chats not attached by a reporter
  (R-AD.6, AC-AD.3).
  """
  use ThirstrWeb, :controller
  import Ecto.Query
  alias Thirstr.{Moderation, Nearby, Repo, Storage}
  alias Thirstr.Auth.Passkeys
  alias Thirstr.Profiles.Photo

  @idle_s 30 * 60
  @session_s 8 * 3600
  @actions ~w(dismiss warn remove_photo suspend ban release)
  # Report outcome shown to the notifier (R-15.27) per console action.
  @decision_of %{
    "dismiss" => "no_action",
    "warn" => "warned",
    "remove_photo" => "removed",
    "suspend" => "suspended",
    "ban" => "banned",
    "release" => "no_action"
  }
  @reason_codes ~w(spam_bot scam underage harassment non_consensual hate impersonation creator_undeclared other no_violation)

  # ------------------------------------------------------------------ plugs

  def enabled(conn, _) do
    if admins() == [], do: conn |> send_resp(404, "") |> halt(), else: conn
  end

  def require_admin(conn, _) do
    now = System.system_time(:second)
    id = get_session(conn, :admin_id)
    at = get_session(conn, :admin_at) || 0
    seen = get_session(conn, :admin_seen) || 0

    if id in admins() and now - at < @session_s and now - seen < @idle_s do
      conn |> put_session(:admin_seen, now) |> assign(:admin, id)
    else
      conn |> clear_session() |> redirect(to: "/admin/login") |> halt()
    end
  end

  defp admins, do: Application.get_env(:thirstr, :admin_account_ids, [])

  # ------------------------------------------------------------------ login (passkey, R-AD.12)

  def login_page(conn, _) do
    page(conn, "Sign in", """
    <h1>Thirstr console</h1>
    <p class="muted">Owner passkey only.</p>
    <button id="go">Sign in with passkey</button>
    <p id="err" class="danger"></p>
    <script>
    const b64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
    const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0));
    const csrf = #{Jason.encode!(get_csrf_token())};
    const post = (u, body) => fetch(u, {method: 'POST', headers: {'content-type': 'application/json', 'x-csrf-token': csrf}, body: JSON.stringify(body)});
    document.getElementById('go').onclick = async () => {
      try {
        const o = await (await post('/admin/login/options', {})).json();
        const pk = o.publicKey;
        const c = await navigator.credentials.get({publicKey: {...pk, challenge: unb64(pk.challenge)}});
        const r = await post('/admin/login', {challenge_id: o.challenge_id, credential_id: b64(c.rawId),
          authenticator_data: b64(c.response.authenticatorData), signature: b64(c.response.signature),
          client_data_json: b64(c.response.clientDataJSON)});
        if (r.ok) location.href = '/admin'; else document.getElementById('err').textContent = 'Not allowed';
      } catch (e) { document.getElementById('err').textContent = String(e); }
    };
    </script>
    """)
  end

  def login_options(conn, _), do: json(conn, Passkeys.authentication_options(origin(conn)))

  def login(conn, params) do
    with {:ok, a} <- Passkeys.verify_authentication(params),
         true <- a.id in admins() do
      start_session(conn, a.id)
      |> json(%{ok: true})
    else
      _ ->
        audit("console", "login_failed", nil, nil)
        conn |> put_status(403) |> json(%{error: %{code: "forbidden"}})
    end
  end

  # ------------------------------------------------------------------ enrolment (R-AD.16)

  @doc "R-AD.16a: one-time console passkey enrolment page."
  def enrol_page(conn, params) do
    if Thirstr.AdminEnrol.valid?(params["t"]) do
      page(conn, "Create console passkey", """
      <h1>Thirstr console</h1>
      <p class="muted">One-time link. Create a passkey for this console on this device (iCloud Keychain, password manager or security key).</p>
      <button id="go">Create console passkey</button>
      <p id="err" class="danger"></p>
      <script>
      const b64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
      const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0));
      const csrf = #{Jason.encode!(get_csrf_token())};
      const token = #{Jason.encode!(params["t"])};
      const post = (u, body) => fetch(u, {method: 'POST', headers: {'content-type': 'application/json', 'x-csrf-token': csrf}, body: JSON.stringify(body)});
      document.getElementById('go').onclick = async () => {
        try {
          const o = await (await post('/admin/enrol/options', {})).json();
          const pk = o.publicKey;
          const c = await navigator.credentials.create({publicKey: {...pk, challenge: unb64(pk.challenge), user: {...pk.user, id: unb64(pk.user.id)}}});
          const r = await post('/admin/enrol', {t: token, challenge_id: o.challenge_id,
            attestation_object: b64(c.response.attestationObject), client_data_json: b64(c.response.clientDataJSON)});
          if (r.ok) location.href = '/admin'; else document.getElementById('err').textContent = 'Link expired or not allowed';
        } catch (e) { document.getElementById('err').textContent = String(e); }
      };
      </script>
      """)
    else
      conn
      |> put_status(410)
      |> page(
        "Link expired",
        ~s(<h1>Link expired or used</h1><p class="muted">Create a new one over fly ssh.</p>)
      )
    end
  end

  def enrol_options(conn, _),
    do: json(conn, Passkeys.registration_options(origin: origin(conn), uv: "required"))

  @doc "R-AD.16b–c: consume the token, store the passkey, start the console session."
  def enrol(conn, params) do
    with {:ok, id} <- Thirstr.AdminEnrol.take(params["t"]),
         {:ok, cred_id, cose, count, aaguid} <- Passkeys.verify_registration(params),
         %Thirstr.Accounts.Account{} = a <- Repo.get(Thirstr.Accounts.Account, id),
         {:ok, _} <- Thirstr.Accounts.add_passkey(a, cred_id, cose, count, aaguid) do
      audit(id, "passkey_enrolled", id, nil)
      conn |> start_session(id) |> json(%{ok: true})
    else
      err ->
        audit("console", "enrol_failed", nil, inspect(elem_or(err)))
        status = if err == {:error, :gone}, do: 410, else: 403
        conn |> put_status(status) |> json(%{error: %{code: "forbidden"}})
    end
  end

  defp elem_or({:error, r}), do: r
  defp elem_or(_), do: :invalid

  @doc "DEV/test only (dev_routes): sign in as an admin account without a passkey."
  def dev_login(conn, %{"account_id" => id}) do
    if id in admins(),
      do: conn |> start_session(id) |> redirect(to: "/admin"),
      else: send_resp(conn, 403, "")
  end

  defp start_session(conn, id) do
    now = System.system_time(:second)
    audit(id, "login", nil, nil)

    conn
    |> configure_session(renew: true)
    |> put_session(:admin_id, id)
    |> put_session(:admin_at, now)
    |> put_session(:admin_seen, now)
  end

  def logout(conn, _) do
    audit(conn.assigns.admin, "logout", nil, nil)
    conn |> clear_session() |> redirect(to: "/admin/login")
  end

  # Browser origin of this console (scheme://host[:port]); RP id stays the app's domain.
  defp origin(conn) do
    port =
      if conn.port in [80, 443] or forwarded?(conn), do: "", else: ":#{conn.port}"

    "#{conn.scheme}://#{conn.host}#{port}"
  end

  defp forwarded?(conn), do: get_req_header(conn, "x-forwarded-proto") != []

  # A-01 queue: ThirstrWeb.ModController.queue/2 (#179).

  # R-AD.8 severity SLAs: 1–2 ≤ 1 h, 3 ≤ 12 h, others ≤ 48 h.
  @doc false
  def sla(sev, at) do
    limit = if(sev <= 2, do: 3600, else: if(sev == 3, do: 12 * 3600, else: 48 * 3600))
    left = limit - DateTime.diff(DateTime.utc_now(), at)

    if left < 0,
      do: ~s(<span class="danger">overdue #{div(-left, 60)} min</span>),
      else: "#{div(left, 60)} min left"
  end

  defp sla_left(sev, at) do
    limit = if(sev <= 2, do: 3600, else: if(sev == 3, do: 12 * 3600, else: 48 * 3600))
    limit - DateTime.diff(DateTime.utc_now(), at)
  end

  # ------------------------------------------------------------------ A-02 report detail

  def report(conn, %{"id" => id}) do
    with {:ok, _} <- Ecto.UUID.cast(id),
         [
           [
             rid,
             reason,
             ctx,
             note,
             franked,
             state,
             at,
             pid,
             aid,
             sev,
             illegal,
             ltype,
             cc,
             expl,
             chan
           ]
         ] <-
           q(
             """
             SELECT r.id::text, r.reason, r.context, r.note, r.franked, r.state, r.created_at,
                    r.target_profile::text, r.target_account::text, r.severity,
                    r.illegal, r.legal_type, r.country, r.explanation, r.channel
             FROM reports r WHERE r.id = $1
             """,
             [Nearby.dump(id)]
           ) do
      audit(conn.assigns.admin, "view_report", rid, nil)
      conn = ThirstrWeb.ModController.track(conn, ThirstrWeb.ModController.report_tier(sev))

      tier = ThirstrWeb.ModController.report_tier(sev)
      left = sla_left(sev, at)

      msgs =
        Enum.map_join((franked || %{})["messages"] || [], "", fn m ->
          ~s(<div class="bub"><span>#{e(m["text"] || "(media)")}</span><small>#{e(m["t"])} · #{fmt_ms(m["at"])}</small></div>)
        end)

      sla_txt =
        cond do
          state != "open" -> e(state)
          left < 0 -> ~s(<span class="danger"><b>#{div(-left, 60)} min past target</b></span>)
          true -> "#{div(left, 60)} min left"
        end

      page(conn, "Report", """
      #{ThirstrWeb.AdminUI.head(e(String.capitalize(String.replace(reason || "report", "_", " "))), "Report · tier #{tier} · #{e(ctx)} · #{sla_txt} · #{Calendar.strftime(at, "%d %b %H:%M")} UTC", ~s(<a class="btn ghost" href="/admin">‹ Queue</a>))}
      <div class="split"><div class="col">
      #{if illegal, do: ~s{<div class="banner"><b>Illegal content notice</b> (DSA Art. 16) · #{e(ltype)} · #{e(cc || "—")} · via #{e(chan)}<br>#{e(expl || "")}</div>}, else: ""}
      #{if note, do: ~s(<div class="card"><h2>Reporter note</h2><p>#{e(note)}</p></div>), else: ""}
      <div class="card"><h2>Messages the reporter attached <span class="r">franking verified</span></h2>
      #{if msgs == "", do: ~s(<p class="muted">None attached.</p>), else: ~s(<div class="msgs">#{msgs}</div>)}</div>
      #{profile_snapshot(pid, aid)}
      </div>
      #{action_form("/admin/reports/#{rid}/action", pid)}
      </div>
      """)
    else
      _ -> send_resp(conn, 404, "")
    end
  end

  def report_action(conn, %{"id" => id, "action" => action, "reason" => reason} = p)
      when action in @actions and reason in @reason_codes do
    facts = String.trim(p["facts"] || "")

    case open_report_target(id) do
      _ when action != "dismiss" and facts == "" ->
        send_resp(conn, 422, "Write the facts: they go into the notice the person gets (R-15.28)")

      nil ->
        send_resp(conn, 404, "")

      aid ->
        apply_report_action(conn, id, aid, action, reason, p)
    end
  end

  def report_action(conn, _), do: send_resp(conn, 422, "Pick an action and a reason code")

  defp open_report_target(id) do
    with {:ok, _} <- Ecto.UUID.cast(id),
         [[aid]] <-
           q("SELECT target_account::text FROM reports WHERE id = $1 AND state = 'open'", [
             Nearby.dump(id)
           ]) do
      aid
    else
      _ -> nil
    end
  end

  defp apply_report_action(conn, id, aid, action, reason, p) do
    result =
      if action == "dismiss",
        do: {:ok, nil},
        else:
          Moderation.enforce(aid, action, reason, "admin",
            report_id: id,
            days: p["days"],
            photo_id: p["photo_id"],
            facts: p["facts"],
            ground: p["ground"],
            law_ref: p["law_ref"]
          )

    case result do
      {:ok, _} ->
        state = if action == "dismiss", do: "dismissed", else: "actioned"

        # Dismiss closes this report; an enforcement closes every open report on the account.
        closed =
          q(
            "UPDATE reports SET state = $2, action = $3, resolved_at = now() WHERE target_account = (SELECT target_account FROM reports WHERE id = $1) AND state = 'open' AND (id = $1 OR $3 <> 'dismiss') RETURNING id::text",
            [Nearby.dump(id), state, action]
          )

        # R-15.27: every notifier learns the outcome; R-15.34 misuse check on "no action".
        Enum.each(closed, fn [rid] ->
          Thirstr.Reports.decide(rid, @decision_of[action], unfounded: p["unfounded"] == "yes")
        end)

        audit(conn.assigns.admin, "report_" <> action, id, reason)
        redirect(conn, to: "/admin")

      _ ->
        page(conn, "Error", "<p class=\"danger\">Action failed (photo missing?).</p>")
    end
  end

  defp profile_snapshot(nil, _), do: ""

  defp profile_snapshot(pid, aid) do
    [[name, age, kind, bio, vat, ins, status]] =
      q(
        """
        SELECT p.display_name, p.age, p.kind, p.fields->>'bio', a.verified_at IS NOT NULL, a.inserted_at, a.status
        FROM profiles p JOIN accounts a ON a.id = p.account_id WHERE p.id = $1
        """,
        [Nearby.dump(pid)]
      )

    photos =
      Repo.all(
        from(ph in Photo,
          where: ph.profile_id == ^pid and ph.status in ["ok_main", "ok_public", "pending"],
          order_by: ph.slot
        )
      )

    prior =
      q(
        "SELECT action, count(*) FROM moderation_actions WHERE target_account = $1 GROUP BY action",
        [Nearby.dump(aid)]
      )
      |> Enum.map_join(", ", fn [a, n] -> "#{a} × #{n}" end)

    """
    <div class="card"><h2>Public profile <span class="r">as members see it</span></h2>
    <dl class="kv"><dt>Name</dt><dd>#{e(name)}, #{age} · #{e(kind)}</dd>
    <dt>Account</dt><dd>#{DateTime.diff(DateTime.utc_now(), ins, :day)} d · #{if vat, do: "verified", else: "unverified"} · #{e(status)}</dd>
    <dt>Trust</dt><dd>#{Thirstr.Trust.vouch_count(pid)} vouches</dd>
    <dt>Earlier</dt><dd>#{if prior == "", do: "no actions", else: e(prior)}</dd></dl>
    #{if bio, do: ~s(<p class="muted">#{e(bio)}</p>), else: ""}</div>
    <div class="card"><h2>Photos <span class="r">blurred and grey by default · reveal is logged</span></h2>
    <div class="photos">#{Enum.map_join(photos, "", &photo_tile/1)}</div></div>
    """
  end

  # R-AD.7 / F-15 R-15.52 (#179): blurred + grayscale by default, the card-size copy when it
  # exists (≤ 480 px), hold to peek (3 s), Reveal (audited), Grayscale toggle. Script in page/3.
  @doc false
  def photo_tile(ph) do
    key = ph.thumb_key || ph.storage_key
    hash = if ph.hash_state, do: " · hash #{e(ph.hash_state)}", else: ""

    ~s{<div class="ph"><label><input type="radio" name="photo_id" form="act" value="#{ph.id}"> pick</label><div class="img blur" data-id="#{ph.id}"><img alt="" src="#{e(Storage.presigned_get(key))}"></div><div class="tools"><button type="button" data-t="peek">Hold to peek</button><button type="button" data-t="reveal" aria-pressed="false">Reveal</button><button type="button" data-t="gray" aria-pressed="true">Grayscale</button></div><span class="muted">slot #{ph.slot} · #{e(ph.status)}#{hash}</span></div>}
  end

  @action_labels %{
    "dismiss" => "Dismiss",
    "warn" => "Warn",
    "remove_photo" => "Remove photo",
    "suspend" => "Suspend",
    "ban" => "Ban",
    "release" => "Release"
  }

  defp action_form(path, _pid) do
    acts =
      Enum.map_join(@actions, "", fn a ->
        ~s(<label class="opt#{if a == "ban", do: " dan", else: ""}"><input type="radio" name="action" value="#{a}"#{if a == "dismiss", do: " checked", else: ""}>#{@action_labels[a]}</label>)
      end)

    reasons =
      Enum.map_join(
        @reason_codes,
        "",
        &~s(<option value="#{&1}">#{String.replace(&1, "_", " ")}</option>)
      )

    """
    <form id="act" class="card decide" method="post" action="#{path}"><h2>Decision</h2>
      <input type="hidden" name="_csrf_token" value="#{get_csrf_token()}">
      <div class="acts">#{acts}</div>
      <label class="f">Reason code<select name="reason">#{reasons}</select></label>
      <label class="f">Suspension days<input name="days" type="number" min="1" max="30" value="3"></label>
      <label class="f">Facts, sent to the member (required for any action, 300 max)<textarea name="facts" maxlength="300" rows="3"></textarea></label>
      <label class="f">Ground<select name="ground"><option value="tos">Breaks our rules</option><option value="law">Illegal</option></select></label>
      <input name="law_ref" placeholder="Law and country, if illegal" maxlength="200">
      <label class="chk"><input type="checkbox" name="unfounded" value="yes"> Dismiss as manifestly unfounded (counts toward report misuse, R-15.34)</label>
      <button class="pri">Apply decision</button>
      <span class="muted sm">Remove photo: pick a photo on the left. Every action sends the member a statement of reasons with appeal (R-AD.9); the reporter gets the outcome.</span>
    </form>
    """
  end

  # ------------------------------------------------------------------ A-03 photo review

  def photos(conn, _) do
    audit(conn.assigns.admin, "view_photos", nil, nil)

    list =
      Repo.all(
        from(ph in Photo,
          where: ph.review_state == "queued",
          order_by: ph.inserted_at,
          limit: 100
        )
      )
      |> Enum.map_join("", fn ph ->
        """
        <div class="card">#{photo_tile(ph)}
          <p class="muted">#{e(Jason.encode!(Map.take(ph.classifier_score || %{}, ["labels", "main_ok", "score"])))}</p>
          <form method="post" action="/admin/photos/#{ph.id}">
            <input type="hidden" name="_csrf_token" value="#{get_csrf_token()}">
            <button name="decision" value="approve">Approve</button>
            <button name="decision" value="reject">Reject</button>
          </form>
          <form method="post" action="/admin/photos/#{ph.id}/escalate">
            <input type="hidden" name="_csrf_token" value="#{get_csrf_token()}">
            <button class="danger">Escalate as CSAM</button>
          </form></div>
        """
      end)

    moments =
      Thirstr.Moments.review_queue()
      |> Enum.map_join("", fn m ->
        """
        <div class="card"><label class="ph"><img src="#{e(m.url)}" onclick="this.classList.toggle('show')"><span>Moment · #{if m.main_ok, do: "main ok", else: "not main ok"} · expires #{e(Calendar.strftime(m.expires_at, "%H:%M"))} UTC</span></label>
          #{if m.caption, do: ~s(<p class="muted">“#{e(m.caption)}”</p>), else: ""}
          <form method="post" action="/admin/moments/#{m.id}">
            <input type="hidden" name="_csrf_token" value="#{get_csrf_token()}">
            <button name="decision" value="approve">Approve</button>
            <button name="decision" value="reject">Reject</button>
          </form></div>
        """
      end)

    page(conn, "Photos", """
    <h1>Photo review</h1>
    #{if list == "", do: ~s(<p class="muted">Nothing queued.</p>), else: list}
    <h2>Moments (borderline, hidden until decided or expired)</h2>
    #{if moments == "", do: ~s(<p class="muted">Nothing queued.</p>), else: moments}
    """)
  end

  def moment_decision(conn, %{"id" => id, "decision" => d}) when d in ~w(approve reject) do
    case Thirstr.Moments.review(id, d) do
      :ok ->
        audit(conn.assigns.admin, "moment_" <> d, id, nil)
        redirect(conn, to: "/admin/photos")

      _ ->
        send_resp(conn, 404, "")
    end
  end

  def photo_decision(conn, %{"id" => id, "decision" => d}) when d in ~w(approve reject) do
    case Repo.get(Photo, id) do
      %Photo{} = ph ->
        status =
          if d == "reject",
            do: "rejected",
            else: if(ph.slot == 0, do: "ok_main", else: "ok_public")

        ph = ph |> Ecto.Changeset.change(status: status, review_state: "done") |> Repo.update!()

        if status != "rejected",
          do: Thirstr.Profiles.replace_slot(Repo.preload(ph, :profile).profile, ph)

        Thirstr.Profiles.refresh_photo_ids(ph.profile_id)
        audit(conn.assigns.admin, "photo_" <> d, id, nil)
        redirect(conn, to: "/admin/photos")

      nil ->
        send_resp(conn, 404, "")
    end
  end

  # ------------------------------------------------------------------ A-03b linked accounts (I-01 R-I01.17)

  def linked(conn, _) do
    audit(conn.assigns.admin, "view_linked", nil, nil)

    list =
      Thirstr.Linked.manual_queue()
      |> Enum.map_join("", fn l ->
        """
        <div class="card"><p><b>#{e(l.platform)}</b> @#{e(l.handle)}: code <code>#{e(l.code)}</code></p>
          <p class="muted">Open <code>#{e(l.url)}</code> in a clean private window and look for the code in the bio.</p>
          <form method="post" action="/admin/linked/#{l.id}">
            <input type="hidden" name="_csrf_token" value="#{get_csrf_token()}">
            <button name="decision" value="approve">Code found: approve</button>
            <button name="decision" value="reject">Not found: reject</button>
          </form></div>
        """
      end)

    page(conn, "Linked accounts", """
    <h1>Linked accounts: check by hand</h1>
    #{if list == "", do: ~s(<p class="muted">Nothing waiting.</p>), else: list}
    """)
  end

  def linked_decision(conn, %{"id" => id, "decision" => d}) when d in ~w(approve reject) do
    case Thirstr.Linked.manual_decision(id, d) do
      {:error, :not_found} ->
        send_resp(conn, 404, "")

      _ ->
        audit(conn.assigns.admin, "linked_" <> d, id, nil)
        redirect(conn, to: "/admin/linked")
    end
  end

  def linked_decision(conn, _), do: send_resp(conn, 422, "")

  # ------------------------------------------------------------------ A-04 quarantine

  def quarantine(conn, _) do
    audit(conn.assigns.admin, "view_quarantine", nil, nil)

    rows =
      q(
        """
        SELECT a.id::text, a.status, (SELECT display_name FROM profiles WHERE account_id = a.id ORDER BY inserted_at LIMIT 1),
               (SELECT string_agg(m.reason, ', ') FROM moderation_actions m WHERE m.target_account = a.id AND m.action = 'quarantine')
        FROM accounts a WHERE a.status IN ('quarantined', 'suspended') ORDER BY a.updated_at DESC LIMIT 200
        """,
        []
      )

    list =
      Enum.map_join(rows, "", fn [id, st, name, why] ->
        """
        <tr><td>#{e(name || "—")}</td><td>#{e(st)}</td><td>#{e(why || "")}</td><td>
        <form method="post" action="/admin/accounts/#{id}/action">
          <input type="hidden" name="_csrf_token" value="#{get_csrf_token()}">
          <select name="reason">#{Enum.map_join(@reason_codes, "", &"<option>#{&1}</option>")}</select>
          <button name="action" value="release">Release</button>
          <button name="action" value="ban">Ban</button>
        </form></td></tr>
        """
      end)

    page(conn, "Quarantine", """
    <h1>Quarantine &amp; suspensions</h1>
    <table><tr><th>Profile</th><th>Status</th><th>Signals</th><th></th></tr>#{list}</table>
    """)
  end

  def account_action(conn, %{"id" => id, "action" => a, "reason" => r})
      when a in ~w(release ban) and r in @reason_codes do
    with {:ok, _} <- Ecto.UUID.cast(id), {:ok, _} <- Moderation.enforce(id, a, r, "admin") do
      audit(conn.assigns.admin, "account_" <> a, id, r)
      redirect(conn, to: "/admin/quarantine")
    else
      _ -> send_resp(conn, 404, "")
    end
  end

  def account_action(conn, _), do: send_resp(conn, 422, "")

  # A-05 appeals: ThirstrWeb.ModController (#288).

  # ------------------------------------------------------------------ A-10 audit log

  def audit_log(conn, _) do
    rows =
      q(
        "SELECT actor, action, object_hash, reason, at FROM admin_audit ORDER BY id DESC LIMIT 300",
        []
      )

    list =
      Enum.map_join(rows, "", fn [actor, act, obj, reason, at] ->
        "<tr><td>#{DateTime.to_iso8601(at)}</td><td>#{e(short(actor))}</td><td>#{e(act)}</td><td>#{e(obj || "")}</td><td>#{e(reason || "")}</td></tr>"
      end)

    page(conn, "Audit", """
    <h1>Audit log</h1>
    <table><tr><th>Time</th><th>Actor</th><th>Action</th><th>Object</th><th>Reason</th></tr>#{list}</table>
    """)
  end

  # ------------------------------------------------------------------ places (A-07b, #113)

  def places(conn, params) do
    audit(conn.assigns.admin, "view_places", nil, nil)
    %{counts: counts, last: last, events: events} = Thirstr.Places.admin_summary()
    found = Thirstr.Places.search(params["q"])
    members = Thirstr.Places.member_places()
    csrf = ~s(<input type="hidden" name="_csrf_token" value="#{get_csrf_token()}">)

    count_rows =
      Enum.map_join(counts, "", fn [src, kind, n, hidden] ->
        "<tr><td>#{e(src)}</td><td>#{e(kind)}</td><td>#{n}</td><td>#{hidden}</td></tr>"
      end)

    last_txt =
      case last do
        nil ->
          "Never imported."

        [st, fin, a, u, r, err] ->
          "Started #{e(st && DateTime.to_iso8601(st))}, finished #{e((fin && DateTime.to_iso8601(fin)) || "running")}: +#{a} added, #{u} updated, #{r} removed. #{e(err || "")}"
      end

    event_rows =
      Enum.map_join(events, "", fn [id, title, st, en, venue] ->
        """
        <tr><td>#{e(title)}</td><td>#{e(venue)}</td><td>#{e(DateTime.to_iso8601(st))} → #{e(DateTime.to_iso8601(en))}</td>
        <td><form method="post" action="/admin/places/events/#{e(id)}/remove">#{csrf}<button>Remove</button></form></td></tr>
        """
      end)

    found_rows =
      Enum.map_join(found, "", fn [id, name, kind, hidden, city] ->
        """
        <tr><td>#{e(name)}</td><td>#{e(kind)}</td><td>#{e(city)}</td>
        <td><form method="post" action="/admin/places/venues/#{e(id)}/#{if hidden, do: "unhide", else: "hide"}">#{csrf}<button>#{if hidden, do: "Unhide", else: "Hide"}</button></form></td>
        <td><form method="post" action="/admin/places/events">#{csrf}<input type="hidden" name="venue_id" value="#{e(id)}">
          <input name="title" maxlength="60" placeholder="Party title" required>
          <input type="datetime-local" name="starts_at" required> <input type="datetime-local" name="ends_at" required>
          <input name="url" placeholder="https://… (optional)"> <button>Add official party</button></form></td></tr>
        """
      end)

    member_rows =
      Enum.map_join(members, "", fn [id, name, kind, hidden, at, lat, lng, city, here] ->
        """
        <tr><td>#{e(name)}</td><td>#{e(kind)}</td><td>#{e(city)}</td><td>#{e(DateTime.to_iso8601(Thirstr.Explore.utc_any(at)))}</td><td>#{here}</td>
        <td><a href="https://www.openstreetmap.org/?mlat=#{lat}&amp;mlon=#{lng}#map=19/#{lat}/#{lng}" target="_blank" rel="noopener noreferrer">Map</a></td>
        <td><form method="post" action="/admin/places/venues/#{e(id)}/#{if hidden, do: "unhide", else: "hide"}">#{csrf}<button>#{if hidden, do: "Unhide", else: "Hide"}</button></form></td>
        <td><form method="post" action="/admin/places/venues/#{e(id)}/delete" onsubmit="return confirm('Delete this place for everyone?')">#{csrf}<button class="danger">Delete</button></form></td></tr>
        """
      end)

    page(conn, "Places", """
    <h1>Places</h1>
    <h2>Catalogue</h2><table><tr><th>Source</th><th>Kind</th><th>Venues</th><th>Hidden</th></tr>#{count_rows}</table>
    <h2>Added by members</h2>
    <p class="muted">Live as soon as they are added, no review before (F-12 R-12.11). Hide it if it is wrong, delete it if it is a home or private address. The creator is never shown in the app.</p>
    <table><tr><th>Name</th><th>Kind</th><th>Near</th><th>Added (UTC)</th><th>Here</th><th></th><th></th><th></th></tr>#{member_rows}</table>
    <h2>OpenStreetMap import</h2><p>#{last_txt}</p>
    <p class="muted">Gay venues worldwide by tag, gyms for the configured countries. Only tags and countries are sent, never anything about users (F-12 R-12.9).</p>
    <form method="post" action="/admin/places/import">#{csrf}<button>Import now</button></form>
    <h2>Upcoming official parties</h2><table><tr><th>Title</th><th>Venue</th><th>When (UTC)</th><th></th></tr>#{event_rows}</table>
    <h2>Find a venue</h2><form method="get" action="/admin/places"><input name="q" value="#{e(params["q"])}" placeholder="Venue name"> <button>Search</button></form>
    <p class="muted">Times are UTC. A party shows on the map from 12 h before it starts until it ends.</p>
    <table>#{found_rows}</table>
    """)
  end

  def places_import(conn, _) do
    audit(conn.assigns.admin, "places_import", nil, nil)
    %{} |> Thirstr.Jobs.PlaceImport.new() |> Oban.insert!()
    redirect(conn, to: "/admin/places")
  end

  def venue_hidden(conn, %{"id" => id, "action" => "delete"}) do
    audit(conn.assigns.admin, "venue_delete", id, nil)
    Thirstr.Places.delete_venue(id)
    redirect(conn, to: "/admin/places")
  end

  def venue_hidden(conn, %{"id" => id, "action" => act}) when act in ~w(hide unhide) do
    audit(conn.assigns.admin, "venue_" <> act, id, nil)
    Thirstr.Places.set_hidden(id, act == "hide")
    redirect(conn, to: "/admin/places")
  end

  def add_event(conn, params) do
    case Thirstr.Places.add_event(params) do
      :ok ->
        audit(conn.assigns.admin, "event_add", params["venue_id"], nil)
        redirect(conn, to: "/admin/places")

      _ ->
        page(
          conn,
          "Places",
          "<p class=\"danger\">Check title (1–60), times (end after start, max 24 h) and link (https).</p><a href=\"/admin/places\">Back</a>"
        )
    end
  end

  def remove_event(conn, %{"id" => id}) do
    audit(conn.assigns.admin, "event_remove", id, nil)
    Thirstr.Places.remove_event(id)
    redirect(conn, to: "/admin/places")
  end

  # ------------------------------------------------------------------ delivery latency (R-07.24)

  def delivery(conn, _) do
    labels =
      Enum.map(Thirstr.Chat.latency_buckets(), &"≤ #{lat_ms(&1)}") ++ ["slower"]

    keys = Thirstr.Chat.latency_buckets() ++ [0]

    rows =
      Thirstr.Chat.delivery_stats()
      |> Enum.group_by(fn [day, _, _] -> day end, fn [_, b, n] -> {b, n} end)
      |> Enum.sort_by(fn {day, _} -> day end, {:desc, Date})
      |> Enum.map_join("", fn {day, counts} ->
        m = Map.new(counts)
        total = m |> Map.values() |> Enum.sum()
        cells = Enum.map_join(keys, "", &"<td>#{Map.get(m, &1, 0)}</td>")

        "<tr><td>#{Date.to_iso8601(day)}</td><td>#{total}</td>#{cells}<td>#{p95(m, keys, total)}</td></tr>"
      end)

    head = Enum.map_join(labels, "", &"<th>#{e(&1)}</th>")

    page(conn, "Delivery", """
    <h1>Chat delivery latency</h1>
    <p>Server stored → recipient device acked, per message, aggregated per day (R-07.24). Target p95 ≤ 500 ms online (AC-07.2); offline recipients land in the slow buckets by design.</p>
    <table><tr><th>Day</th><th>Messages</th>#{head}<th>p95 ≤</th></tr>#{rows}</table>
    """)
  end

  defp lat_ms(ms) when ms >= 60_000, do: "#{div(ms, 60_000)} min"
  defp lat_ms(ms) when ms >= 1000, do: "#{div(ms, 1000)} s"
  defp lat_ms(ms), do: "#{ms} ms"

  defp p95(_m, _keys, 0), do: "–"

  defp p95(m, keys, total) do
    target = total * 0.95

    Enum.reduce_while(keys, 0, fn k, acc ->
      acc = acc + Map.get(m, k, 0)
      if acc >= target, do: {:halt, if(k == 0, do: "slower", else: lat_ms(k))}, else: {:cont, acc}
    end)
  end

  # ------------------------------------------------------------------ helpers

  @doc "Append-only audit entry; object ids are stored hashed (R-AD.4)."
  def audit(actor, action, object_id, reason) do
    q(
      "INSERT INTO admin_audit (actor, action, object_hash, reason, at) VALUES ($1, $2, $3, $4, now())",
      [actor, action, object_id && hash(object_id), reason]
    )

    :ok
  end

  defp hash(id),
    do: :crypto.hash(:sha256, id) |> Base.encode16(case: :lower) |> binary_part(0, 16)

  defp short(s) when is_binary(s), do: String.slice(s, 0, 8)
  defp short(_), do: ""

  # Every caller passes a literal SQL string; values go through params.
  # sobelow_skip ["SQL.Query"]
  @doc false
  def q(sql, params), do: (Repo.query!(sql, params).rows || []) |> Nearby.utc()

  @doc false
  def e(nil), do: ""
  def e(s), do: s |> to_string() |> Plug.HTML.html_escape()

  defp fmt_ms(n) when is_integer(n),
    do: n |> DateTime.from_unix!(:millisecond) |> DateTime.to_iso8601()

  defp fmt_ms(_), do: ""

  @doc "Console v3 shell (R-AD.17): see `ThirstrWeb.AdminUI`."
  def page(conn, title, body), do: ThirstrWeb.AdminUI.page(conn, title, body)

  @doc "Console fonts, same-origin (R-AD.17)."
  def font(conn, params), do: ThirstrWeb.AdminUI.font(conn, params)
end
