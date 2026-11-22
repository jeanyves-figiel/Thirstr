defmodule ThirstrWeb.AdminUI do
  @moduledoc """
  Console v3 shell (admin-console.md R-AD.17, mockup approved 2026-11-22): one layout for every
  console page. Grouped left rail with live counts (red when something is past its target time),
  environment badge (amber STAGING, red PROD), session corner; on a phone the rail becomes a
  scrollable tab strip. Pop tokens, Bricolage Grotesque served by the API itself (CSP `'self'`,
  no third-party font host). Pages before sign-in (login, enrolment) get a centred card.
  """
  import Plug.Conn
  import Phoenix.Controller, only: [get_csrf_token: 0]
  require Logger

  @fonts %{
    "bricolage-400.woff2" => "bricolage-grotesque-latin-400-normal.woff2",
    "bricolage-800.woff2" => "bricolage-grotesque-latin-800-normal.woff2"
  }

  @icons %{
    queue: ~s(<path d="M4 6h16M4 12h16M4 18h10"/>),
    cases: ~s(<path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"/>),
    photos:
      ~s(<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 16l5-5 4 4 3-3 6 6"/>),
    linked:
      ~s(<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>),
    quarantine: ~s(<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>),
    appeals: ~s(<path d="M4 12a8 8 0 0114-5.3M20 12a8 8 0 01-14 5.3M18 3v4h-4M6 21v-4h4"/>),
    support: ~s(<path d="M4 5h16v11H8l-4 4z"/>),
    costs: ~s(<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>),
    delivery: ~s(<path d="M3 12h4l3-8 4 16 3-8h4"/>),
    places:
      ~s(<path d="M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>),
    me: ~s(<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>),
    audit: ~s(<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5"/>)
  }

  # {group, [{key, label, short label, path}]}
  @groups [
    {"Moderation",
     [
       {:queue, "Queue", "Queue", "/admin"},
       {:cases, "Hash hits &amp; cases", "Cases", "/admin/cases"},
       {:photos, "Photo review", "Photos", "/admin/photos"},
       {:linked, "Linked accounts", "Linked", "/admin/linked"},
       {:quarantine, "Quarantine", "Quarantine", "/admin/quarantine"},
       {:appeals, "Appeals", "Appeals", "/admin/appeals"}
     ]},
    {"Members", [{:support, "Support inbox", "Support", "/admin/support"}]},
    {"Platform",
     [
       {:costs, "Costs &amp; capacity", "Costs", "/admin/costs"},
       {:delivery, "Message delivery", "Delivery", "/admin/delivery"},
       {:places, "Places", "Places", "/admin/places"}
     ]},
    {"You",
     [{:me, "My day", "My day", "/admin/me"}, {:audit, "Audit log", "Audit", "/admin/audit"}]}
  ]

  @session_s 8 * 3600

  # ------------------------------------------------------------------ fonts

  @doc "Console fonts (OFL), served same-origin so the CSP stays `'self'`."
  # The file name comes from the fixed @fonts map, never from the request.
  # sobelow_skip ["Traversal.SendFile"]
  def font(conn, %{"file" => f}) do
    case @fonts[f] do
      nil ->
        send_resp(conn, 404, "")

      file ->
        conn
        |> put_resp_content_type("font/woff2", nil)
        |> put_resp_header("cache-control", "public, max-age=31536000, immutable")
        |> send_file(200, Path.join(:code.priv_dir(:thirstr), "admin/" <> file))
    end
  end

  # ------------------------------------------------------------------ building blocks

  @doc "Page header: title, one muted line, actions (HTML) on the right."
  def head(title, sub \\ "", actions \\ "") do
    ~s(<div class="phd"><div><h1>#{title}</h1>#{if sub != "", do: ~s(<div class="sub">#{sub}</div>), else: ""}</div>#{if actions != "", do: ~s(<div class="act">#{actions}</div>), else: ""}</div>)
  end

  @doc "Empty state: bold line, muted text."
  def empty(title, text \\ ""),
    do: ~s(<div class="empty"><b>#{title}</b>#{text}</div>)

  # ------------------------------------------------------------------ page

  # All dynamic values are escaped by callers before they reach `body`.
  # sobelow_skip ["XSS.SendResp"]
  @doc false
  def page(conn, title, body) do
    admin = conn.assigns[:admin]

    inner =
      if admin,
        do: shell(conn, admin, body),
        else:
          ~s(<main class="solo"><div class="brand"><div class="logo">tr…</div><b>Console</b>#{env_badge()}</div>#{body}</main>)

    conn
    |> put_resp_content_type("text/html")
    |> put_resp_header("cache-control", "no-store")
    |> put_resp_header("x-frame-options", "DENY")
    |> put_resp_header("referrer-policy", "no-referrer")
    |> send_resp(conn.status || 200, """
    <!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="robots" content="noindex"><title>#{esc(title)} · Thirstr console</title>
    <style>#{css()}</style></head><body>#{inner}#{scripts(body)}</body></html>
    """)
  end

  defp shell(conn, admin, body) do
    c = counts(admin)
    path = conn.request_path
    active = active(path)

    left =
      max(0, @session_s - (System.system_time(:second) - (get_session(conn, :admin_at) || 0)))

    name = c.name || "Owner"

    rail =
      Enum.map_join(@groups, "", fn {g, links} ->
        ~s(<div class="grp"><h4>#{g}</h4>) <>
          Enum.map_join(links, "", fn {k, label, _, href} ->
            ~s(<a class="nav#{if k == active, do: " on"}" href="#{href}"#{if k == active, do: ~s( aria-current="page"), else: ""}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">#{@icons[k]}</svg>#{label}#{badge(c, k)}</a>)
          end) <> "</div>"
      end)

    strip =
      @groups
      |> Enum.flat_map(&elem(&1, 1))
      |> Enum.map_join("", fn {k, _, short, href} ->
        n = Map.get(c.n, k, 0)

        ~s(<a#{if k == active, do: ~s( class="on" aria-current="page"), else: ""} href="#{href}">#{short}#{if n > 0, do: " #{n}", else: ""}</a>)
      end)

    signout =
      ~s(<form method="post" action="/admin/logout"><input type="hidden" name="_csrf_token" value="#{get_csrf_token()}"><button class="link">Sign out</button></form>)

    """
    <div class="shell">
    <aside class="rail" aria-label="Console navigation">
    <div class="brand"><div class="logo">tr…</div><b>Console</b>#{env_badge()}</div>
    #{rail}
    <div class="me"><div class="av">#{esc(initials(name))}</div><div class="who"><b>#{esc(name)}</b><small>Passkey · #{hm(left)} left</small></div>#{signout}</div>
    </aside>
    <div class="main">
    <header class="top"><div class="brand"><div class="logo">tr…</div><b>Console</b>#{env_badge()}#{signout}</div><nav class="strip" aria-label="Console navigation">#{strip}</nav></header>
    <main class="pane">#{body}</main>
    </div></div>
    """
  end

  defp badge(c, k) do
    n = Map.get(c.n, k, 0)

    cond do
      k in c.hot and n > 0 -> ~s(<span class="n hot">#{n}</span>)
      n > 0 and k in [:photos, :linked] -> ~s(<span class="n warn">#{n}</span>)
      n > 0 -> ~s(<span class="n">#{n}</span>)
      true -> ""
    end
  end

  defp active(path) do
    cond do
      path in ["/admin", "/admin/"] or String.starts_with?(path, "/admin/reports") -> :queue
      String.starts_with?(path, "/admin/me") -> :me
      true -> Enum.find_value(@groups, fn {_, ls} -> find_link(ls, path) end)
    end
  end

  defp find_link(ls, path) do
    Enum.find_value(ls, fn {k, _, _, href} ->
      if href != "/admin" and String.starts_with?(path, href), do: k
    end)
  end

  # One round trip for every rail count; a failure only hides the counts.
  # sobelow_skip ["SQL.Query"]
  defp counts(admin) do
    [[cases, cases_late, reports, reports_late, photos, linked, quar, appeals, support, name]] =
      Thirstr.Repo.query!(
        """
        SELECT
          (SELECT count(*) FROM csam_cases WHERE state = 'open'),
          (SELECT count(*) FROM csam_cases WHERE state = 'open' AND created_at < now() - interval '1 hour'),
          (SELECT count(*) FROM reports WHERE state = 'open'),
          (SELECT count(*) FROM reports WHERE state = 'open' AND created_at < now() -
             CASE WHEN severity <= 2 THEN interval '1 hour' WHEN severity = 3 THEN interval '12 hours' ELSE interval '48 hours' END),
          (SELECT count(*) FROM photos WHERE review_state = 'queued'),
          (SELECT count(*) FROM linked_accounts WHERE manual_pending_at IS NOT NULL),
          (SELECT count(*) FROM accounts WHERE status = 'quarantined'),
          (SELECT count(*) FROM moderation_actions WHERE appeal_state = 'open') +
            (SELECT count(*) FROM reports WHERE notifier_review_state = 'open'),
          (SELECT count(*) FROM support_requests WHERE status = 'open'),
          (SELECT display_name FROM profiles WHERE account_id::text = $1 ORDER BY inserted_at LIMIT 1)
        """,
        [admin]
      ).rows

    %{
      n: %{
        queue: cases + reports + photos + appeals + quar,
        cases: cases,
        photos: photos,
        linked: linked,
        quarantine: quar,
        appeals: appeals,
        support: support
      },
      hot: if(cases_late + reports_late > 0, do: [:queue, :cases], else: []),
      name: name
    }
  rescue
    e ->
      Logger.warning("console counts: #{Exception.message(e) |> String.slice(0, 200)}")
      %{n: %{}, hot: [], name: nil}
  end

  defp env_badge do
    case System.get_env("DEPLOY_ENV") do
      e when e in ["prod", "production"] -> ~s(<span class="env prod">PROD</span>)
      "staging" -> ~s(<span class="env">STAGING</span>)
      _ -> ~s(<span class="env dev">DEV</span>)
    end
  end

  defp initials(name) do
    case String.split(name, ~r/\s+/, trim: true) do
      [one] -> one |> String.slice(0, 2) |> String.upcase()
      words -> words |> Enum.map_join(&String.first/1) |> String.slice(0, 2) |> String.upcase()
    end
  end

  defp hm(s), do: "#{div(s, 3600)} h #{String.pad_leading("#{rem(div(s, 60), 60)}", 2, "0")}"

  defp esc(s), do: s |> to_string() |> Plug.HTML.html_escape()

  # Reviewer tools only where a page has photo tiles; j/k only where it has a work list.
  defp scripts(body) do
    tools = if String.contains?(body, ~s(class="ph")), do: photo_tools(), else: ""
    keys = if String.contains?(body, "data-href="), do: keyboard(), else: ""
    if tools <> keys == "", do: "", else: "<script>#{tools}#{keys}</script>"
  end

  defp photo_tools do
    """
    // F-15 R-15.52: reviewer tools. Reveal is written to the audit log.
    const toolsCsrf = #{Jason.encode!(get_csrf_token())};
    document.querySelectorAll('.ph').forEach(ph => {
      const im = ph.querySelector('.img'); if (!im) return;
      const rev = ph.querySelector('[data-t=reveal]');
      let to;
      const off = () => { if (rev.getAttribute('aria-pressed') !== 'true') im.classList.add('blur'); };
      const peek = ph.querySelector('[data-t=peek]');
      peek.addEventListener('pointerdown', () => { im.classList.remove('blur'); clearTimeout(to); to = setTimeout(off, 3000); });
      ['pointerup', 'pointerleave'].forEach(ev => peek.addEventListener(ev, off));
      rev.addEventListener('click', () => {
        const on = rev.getAttribute('aria-pressed') !== 'true';
        rev.setAttribute('aria-pressed', on); im.classList.toggle('blur', !on);
        if (on) fetch('/admin/reveal', {method: 'POST', headers: {'content-type': 'application/json', 'x-csrf-token': toolsCsrf}, body: JSON.stringify({id: im.dataset.id})});
      });
      const g = ph.querySelector('[data-t=gray]');
      g.addEventListener('click', () => { const on = g.getAttribute('aria-pressed') !== 'true'; g.setAttribute('aria-pressed', on); im.classList.toggle('color', !on); });
    });
    """
  end

  defp keyboard do
    """
    // A-01 keyboard: j/k move, Enter opens, b takes a break.
    const rows = [...document.querySelectorAll('[data-href]')]; let i = 0;
    const sel = () => rows.forEach((r, n) => r.classList.toggle('sel', n === i));
    if (rows.length) { sel(); document.addEventListener('keydown', ev => {
      if (ev.target.matches('input,textarea,select') || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (ev.key === 'j') { i = Math.min(i + 1, rows.length - 1); sel(); rows[i].scrollIntoView({block: 'nearest'}); }
      if (ev.key === 'k') { i = Math.max(i - 1, 0); sel(); rows[i].scrollIntoView({block: 'nearest'}); }
      if (ev.key === 'Enter') location.href = rows[i].dataset.href;
      if (ev.key === 'b') location.href = '/admin/pause';
    }); }
    """
  end

  # ------------------------------------------------------------------ styles

  @doc false
  def css do
    """
    @font-face{font-family:"Bricolage Grotesque";font-weight:400 600;font-display:swap;src:url(/admin/assets/bricolage-400.woff2) format("woff2")}
    @font-face{font-family:"Bricolage Grotesque";font-weight:700 800;font-display:swap;src:url(/admin/assets/bricolage-800.woff2) format("woff2")}
    :root{--page:#0F0D22;--ink:#17142E;--raised:#211D42;--raised2:#2A2552;--line:#332D63;--line2:#3F3878;
    --fg:#FFFFFF;--fg2:#C2BDE3;--muted:#8A86B0;--coral:#FF6B5B;--violet:#9B7BFF;--lime:#C6F432;--teal:#3DD6C3;
    --sun:#FFC93C;--danger:#FF4D6D;--blue:#6E8BFF;--t0:#FF2E63;--t1:#FF4D6D;--t2:#FFC93C;--t3:#9B7BFF;--t4:#6E8BFF;--t5:#6F6A96;
    --display:"Bricolage Grotesque",ui-rounded,system-ui,-apple-system,"Segoe UI",sans-serif;
    --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;color-scheme:dark}
    *{box-sizing:border-box}
    body{margin:0;background:var(--page);color:var(--fg);font:14px/1.45 var(--display);-webkit-font-smoothing:antialiased}
    a{color:var(--coral);text-underline-offset:2px}
    a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline:2px solid var(--teal);outline-offset:2px}
    code,.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
    code{font-size:12.5px;background:var(--raised2);padding:1px 5px;border-radius:5px}
    .muted{color:var(--muted)}.danger{color:var(--danger)}.sm{font-size:12.5px}
    /* shell */
    .shell{display:grid;grid-template-columns:236px minmax(0,1fr);min-height:100vh}
    .rail{background:var(--ink);border-right:1px solid var(--line);padding:18px 12px;display:flex;flex-direction:column;gap:18px;position:sticky;top:0;height:100vh;overflow:auto}
    .brand{display:flex;align-items:center;gap:10px;padding:0 8px}
    .logo{width:34px;height:34px;border-radius:10px;background:var(--coral);color:var(--ink);display:grid;place-items:center;font-weight:800;font-size:15px;letter-spacing:-.5px;flex:none}
    .brand b{font-size:16px;font-weight:800;letter-spacing:-.3px}
    .env{margin-left:auto;font:700 10px/1 var(--mono);letter-spacing:.08em;padding:4px 6px;border-radius:6px;background:rgba(255,201,60,.14);color:var(--sun);border:1px solid rgba(255,201,60,.35)}
    .env.prod{background:rgba(255,46,99,.16);color:var(--t0);border-color:rgba(255,46,99,.5)}
    .env.dev{background:rgba(61,214,195,.12);color:var(--teal);border-color:rgba(61,214,195,.35)}
    .grp{display:flex;flex-direction:column;gap:2px}
    .grp h4{margin:0 0 4px;padding:0 10px;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:700}
    .nav{display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:10px;color:var(--fg2);text-decoration:none;font-weight:500}
    .nav:hover{background:var(--raised)}.nav.on{background:var(--raised2);color:var(--fg);font-weight:700}
    .nav svg{flex:none;opacity:.85}
    .nav .n{margin-left:auto;font:700 11px/1 var(--mono);padding:3px 6px;border-radius:999px;background:var(--raised2);color:var(--fg2)}
    .nav .n.hot{background:var(--t0);color:#fff}.nav .n.warn{background:rgba(255,201,60,.18);color:var(--sun)}
    .me{margin-top:auto;display:flex;align-items:center;gap:10px;padding:10px;border-radius:12px;background:var(--raised)}
    .me .who{min-width:0}.me .who b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .av{width:30px;height:30px;border-radius:50%;background:var(--violet);display:grid;place-items:center;font-weight:800;font-size:12px;color:var(--ink);flex:none}
    .me small{display:block;color:var(--muted);font-size:11.5px}.me form{margin-left:auto}
    button.link{background:none;border:0;padding:0;color:var(--muted);font:500 12px var(--display);cursor:pointer}
    button.link:hover{color:var(--fg)}
    .top{display:none}
    .main{min-width:0}
    .pane{padding:22px 28px 64px;display:flex;flex-direction:column;gap:18px;min-width:0;max-width:1200px}
    @media (max-width:860px){
      .shell{grid-template-columns:1fr}.rail{display:none}
      .top{display:flex;flex-direction:column;gap:10px;background:var(--ink);border-bottom:1px solid var(--line);padding-block:12px 0;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));position:sticky;top:0;z-index:5}
      .top .brand{padding:0}.top .brand form{margin-left:10px}
      .strip{display:flex;gap:4px;overflow-x:auto;padding-bottom:10px;scrollbar-width:none}
      .strip a{white-space:nowrap;padding:6px 11px;border-radius:999px;color:var(--fg2);text-decoration:none;font-weight:600;font-size:13px;background:var(--raised)}
      .strip a.on{background:var(--fg);color:var(--ink)}
      .pane{padding-block:18px 48px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
    }
    .solo{max-width:420px;margin:12vh auto 0;padding:24px max(16px,env(safe-area-inset-left,0px));display:flex;flex-direction:column;gap:14px}
    .solo .brand{padding:0;margin-bottom:8px}.solo h1{font-size:24px}
    /* type + generic elements (older pages inherit the look) */
    h1{margin:0;font-size:28px;font-weight:800;letter-spacing:-.7px;line-height:1.1;text-wrap:balance}
    h2{margin:6px 0 0;font-size:15px;font-weight:800;letter-spacing:-.2px}
    h3{margin:0;font-size:14px;font-weight:700}
    p{margin:0}
    .pane>p,.pane>form,.pane>ul{max-width:78ch}
    ul{margin:0;padding-left:18px}
    .phd{display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap}
    .phd .sub{color:var(--muted);font-size:13px;margin-top:6px}
    .phd .act{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap}
    button,.btn{font:600 13px/1 var(--display);padding:9px 14px;border-radius:999px;border:1px solid var(--line2);background:var(--raised);color:var(--fg);cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap}
    button:hover,.btn:hover{background:var(--raised2)}
    .btn.pri,button.pri,button.primary,#go{background:var(--coral);border-color:var(--coral);color:var(--ink)}
    .btn.ok,button.ok{background:var(--teal);border-color:var(--teal);color:var(--ink)}
    .btn.dan,button.danger,button.dan{background:transparent;border-color:var(--danger);color:var(--danger)}
    .btn.ghost{background:transparent}
    button[aria-pressed="true"]{border-color:var(--teal);color:var(--teal)}
    input,select,textarea{font:inherit;font-size:13px;color:var(--fg);background:var(--raised);border:1px solid var(--line2);border-radius:10px;padding:8px 10px;max-width:100%}
    input[type=checkbox],input[type=radio]{accent-color:var(--teal);width:auto}
    textarea{width:100%;min-height:72px;resize:vertical}
    label{color:var(--fg2)}
    form{margin:0}
    form>p{margin:8px 0}
    details>summary{cursor:pointer;color:var(--coral);font-weight:600;list-style:none}
    details>summary::-webkit-details-marker{display:none}
    .card{background:var(--ink);border:1px solid var(--line);border-radius:16px;padding:16px;min-width:0;display:flex;flex-direction:column;gap:10px}
    .card>h2{margin:0;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    .card>h2 .r,.card h2 .r{margin-left:auto;font:500 12px var(--display);color:var(--muted)}
    .card>form{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
    .chip{font:600 11px/1 var(--display);padding:4px 8px;border-radius:999px;background:var(--raised2);color:var(--fg2);white-space:nowrap;display:inline-flex;align-items:center;gap:4px;text-decoration:none;border:0}
    .chip.v{background:rgba(61,214,195,.12);color:var(--teal)}.chip.r{background:rgba(255,77,109,.14);color:var(--danger)}
    .chip.y{background:rgba(255,201,60,.14);color:var(--sun)}.chip.p{background:rgba(155,123,255,.16);color:var(--violet)}
    .sev{display:inline-block;width:4px;height:16px;border-radius:2px;vertical-align:middle;margin-right:6px}
    .note{font-size:13px;color:var(--fg2);background:var(--raised);border-radius:12px;padding:10px 12px}
    .note b{color:var(--fg)}
    .note.warn,p.warn,.warn{background:rgba(255,201,60,.1);color:var(--sun);border:0;border-radius:12px;padding:10px 12px}
    .note.warn b,p.warn b{color:var(--sun)}
    .banner{background:rgba(255,46,99,.12);border:1px solid rgba(255,46,99,.45);border-radius:12px;padding:10px 14px;color:var(--fg)}
    .empty{padding:40px 16px;text-align:center;color:var(--muted)}
    .empty b{display:block;color:var(--fg);font-size:16px;margin-bottom:4px}
    .kbd{font:500 11px/1 var(--mono);border:1px solid var(--line2);border-bottom-width:2px;border-radius:5px;padding:2px 5px;color:var(--fg2)}
    .pri .kbd{color:var(--ink);border-color:rgba(0,0,0,.3)}
    .hint{margin-left:auto;color:var(--muted);font-size:12px;display:flex;gap:6px;align-items:center}
    @media (max-width:860px){.hint{display:none}}
    .scroll,.tbl{overflow-x:auto}
    table{border-collapse:collapse;width:100%;font-size:13px}
    .pane>table{background:var(--ink);border:1px solid var(--line);border-radius:16px;overflow:hidden;display:block;overflow-x:auto}
    th{color:var(--muted);font-weight:600;text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);font-size:12px;white-space:nowrap}
    td{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
    tr:last-child td{border-bottom:0}
    td.n,td.r,th.r{text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums}
    tr.sel td{background:var(--raised)}
    /* reviewer photo tiles (R-15.52) */
    .photos{display:flex;gap:10px;flex-wrap:wrap}
    .photos .ph,.card>.ph{display:inline-flex;flex-direction:column;gap:6px;width:160px;max-width:100%;align-items:stretch}
    .photos .ph label{font-size:12px}
    .img{width:100%;aspect-ratio:3/4;border-radius:12px;overflow:hidden;background:var(--page)}
    .img img{width:100%;height:100%;object-fit:cover;filter:grayscale(1)}
    .img.blur img{filter:blur(24px) grayscale(1)}.img.color img{filter:none}.img.blur.color img{filter:blur(24px)}
    .tools{display:flex;gap:4px;flex-wrap:wrap}.tools button{flex:1;font-size:11px;padding:6px 4px;border-radius:8px}
    /* A-01 queue */
    .tiers{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}
    @media (max-width:1100px){.tiers{grid-template-columns:repeat(3,minmax(0,1fr))}}
    @media (max-width:480px){.tiers{grid-template-columns:repeat(2,minmax(0,1fr))}}
    .tier{background:var(--ink);border:1px solid var(--line);border-radius:14px;padding:12px 12px 12px 16px;display:flex;flex-direction:column;gap:4px;position:relative;overflow:hidden;text-decoration:none;color:inherit}
    .tier::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--c)}
    .tier:hover{background:var(--raised)}
    .tier .k{font-size:11.5px;color:var(--muted);font-weight:600}
    .tier .v{font:700 24px/1 var(--mono)}
    .tier .s{font-size:11.5px;color:var(--muted)}.tier .s.over{color:var(--danger);font-weight:700}
    .tier.zero .v{color:var(--muted)}.tier.on{border-color:var(--c);background:var(--raised)}
    .bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
    .seg{display:flex;background:var(--ink);border:1px solid var(--line);border-radius:999px;padding:3px;overflow-x:auto;max-width:100%}
    .seg a{padding:6px 12px;border-radius:999px;color:var(--fg2);text-decoration:none;font-weight:600;font-size:12.5px;white-space:nowrap}
    .seg a.on{background:var(--raised2);color:var(--fg)}
    .seg a i{font-style:normal;font-family:var(--mono);color:var(--muted);margin-left:5px}
    .list{background:var(--ink);border:1px solid var(--line);border-radius:16px;overflow:hidden}
    .item{display:grid;grid-template-columns:6px 48px minmax(0,1fr) auto;gap:14px;align-items:center;padding:12px 14px 12px 0;border-top:1px solid var(--line);color:inherit;text-decoration:none}
    .item:first-child{border-top:0}
    .item:hover,.item.sel{background:var(--raised)}
    .item .stripe{align-self:stretch;background:var(--c);border-radius:0 3px 3px 0}
    .thumb{width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,#3a3270,#1b1738);display:grid;place-items:center;font:800 17px/1 var(--display);color:var(--fg2)}
    .thumb.t-case{background:repeating-linear-gradient(45deg,#3a1022 0 6px,#2a0b19 6px 12px);color:var(--t0)}
    .thumb.t-photo{background:linear-gradient(135deg,#1f4a48,#16233a);color:var(--teal)}
    .thumb.t-appeal{background:linear-gradient(135deg,#3b2d6e,#1d1840);color:var(--violet)}
    .what{min-width:0;display:flex;flex-direction:column;gap:5px}
    .what .t{font-weight:700;font-size:14.5px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .what .d{color:var(--fg2);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .what .m{display:flex;gap:6px;flex-wrap:wrap}
    .sla{text-align:right;display:flex;flex-direction:column;gap:5px;align-items:flex-end}
    .sla b{font:700 13px/1 var(--mono)}.sla b.over{color:var(--danger)}.sla b.soon{color:var(--sun)}
    .meter{width:84px;height:4px;border-radius:2px;background:var(--raised2);overflow:hidden;display:block}
    .meter i{display:block;height:100%;background:var(--c,var(--teal))}
    @media (max-width:560px){.item{grid-template-columns:6px 40px minmax(0,1fr)}.thumb{width:40px;height:40px}.sla{grid-column:3;flex-direction:row;align-items:center}}
    /* A-02 report detail */
    .split{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:14px;align-items:start}
    @media (max-width:1100px){.split{grid-template-columns:1fr}}
    .col{display:flex;flex-direction:column;gap:14px;min-width:0}
    .decide{position:sticky;top:16px}
    .acts{display:grid;grid-template-columns:1fr 1fr;gap:6px}
    .opt{display:flex;align-items:center;justify-content:center;padding:10px;border-radius:999px;border:1px solid var(--line2);background:var(--raised);font-weight:600;font-size:13px;color:var(--fg);cursor:pointer}
    .opt input{position:absolute;opacity:0;pointer-events:none}
    .opt:has(input:checked){background:var(--fg);color:var(--ink);border-color:var(--fg)}
    .opt:has(input:focus-visible){outline:2px solid var(--teal);outline-offset:2px}
    .opt.dan{color:var(--danger);border-color:var(--danger)}.opt.dan:has(input:checked){background:var(--danger);color:var(--ink)}
    label.f{display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--muted);font-weight:600}
    label.chk{display:flex;gap:8px;align-items:flex-start;font-size:12.5px}
    .msgs{display:flex;flex-direction:column;gap:6px}
    .bub{max-width:78%;padding:8px 12px;border-radius:14px;background:var(--raised2);font-size:13px;align-self:flex-start}
    .bub small{display:block;color:var(--muted);font-size:10.5px;margin-top:2px;font-family:var(--mono)}
    .kv{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:13px;margin:0}
    .kv dt{color:var(--muted)}.kv dd{margin:0;font-weight:600}
    @media (prefers-reduced-motion:no-preference){.item,.nav,.btn,button{transition:background .12s}}
    """
  end
end
