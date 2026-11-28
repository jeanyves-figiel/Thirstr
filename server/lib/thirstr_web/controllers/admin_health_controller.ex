defmodule ThirstrWeb.AdminHealthController do
  @moduledoc """
  A-12 Health (`/admin/health`, EN-23 OB-6, #343, mockup approved 2026-11-28): is chat OK right
  now? Overall state, last chat probe step by step, key tiles, SLO budgets, online delivery time
  chart, message counts, notifications, API p95 by area and what needs attention. Data from
  `Thirstr.Health` (Fly Prometheus, cached 60 s). Server-rendered SVG, no script.
  `?env=prod|staging` reads the other environment's metrics with the same token.
  """
  use ThirstrWeb, :controller
  import ThirstrWeb.AdminUI, only: [page: 3, head: 3]
  alias Thirstr.Health

  @steps [
    {"send", "Send", "POST stored"},
    {"socket", "On socket", "B received"},
    {"ack", "Ack", "deleted"},
    {"reply", "Reply", "round trip"},
    {"pull", "Pull path", "offline device"},
    {"duplicate", "Duplicate", "same id → repeat"}
  ]

  def index(conn, params) do
    own = Application.get_env(:thirstr, :fly_api_app, "thirstr-api-prod")
    own_env = if String.ends_with?(own, "-staging"), do: "staging", else: "prod"
    env = if params["env"] in ~w(prod staging), do: params["env"], else: own_env
    app = String.replace(own, ~r/-(prod|staging)$/, "-" <> env)
    range = if params["range"] in Health.ranges(), do: params["range"], else: "24h"
    s = Health.snapshot(app, range)
    v = s.v
    probe = if env == own_env, do: Health.last_probe()

    seg = fn items, cur, key ->
      ~s|<div class="seg" aria-label="#{key}">| <>
        Enum.map_join(items, "", fn {val, label} ->
          q = URI.encode_query(Map.merge(%{"env" => env, "range" => range}, %{key => val}))

          ~s|<a#{if val == cur, do: ~s( class="on" aria-current="true"), else: ""} href="/admin/health?#{q}">#{label}</a>|
        end) <> "</div>"
    end

    actions =
      seg.([{"prod", "Prod"}, {"staging", "Staging <i>testers</i>"}], env, "env") <>
        seg.([{"24h", "24 h"}, {"7d", "7 d"}, {"28d", "28 d"}], range, "range")

    body = """
    <style>#{css()}</style>
    #{head("Health", "Message delivery, chat probe, latency and app experience. Counts only, no member data. Refreshed every 60 s.", actions)}
    #{banner(s)}
    #{state(v, probe, s)}
    #{journey(probe, env == own_env)}
    #{tiles(v, range)}
    #{slo_table(v)}
    #{chart(v, range)}
    <div class="hgrid">#{counts(v, range)}#{notif(v, range)}</div>
    #{rum()}
    <div class="hgrid">#{api(v, range)}#{attention(v, probe)}</div>
    """

    page(conn, "Health", body)
  end

  # ------------------------------------------------------------------ sections

  defp banner(%{ok: false}) do
    ~s|<div class="note warn"><span><b>Fly metrics not reachable.</b> Set <code>FLY_COST_TOKEN</code>, the read-only org token from costs.md, on this app. Probe results still show below.</span></div>|
  end

  defp banner(%{partial: true}),
    do:
      ~s|<div class="note"><span>Some metrics did not answer in time; empty tiles show "–".</span></div>|

  defp banner(_), do: ""

  defp state(v, probe, s) do
    {c, title, text} =
      cond do
        probe && probe["ok"] == false ->
          {"var(--danger)", "Chat delivery degraded",
           "The last chat probe failed at step “#{esc(probe["failed"])}”. Messages may not arrive."}

        (v[:stuck_now] || 0) > 0 ->
          {"var(--danger)", "Messages stuck",
           "#{fmt_n(v[:stuck_now])} messages are waiting over 2 min for phones that are connected."}

        burn(v, "7") > 14.4 or burn(v, "1") > 14.4 ->
          {"var(--sun)", "Burning budget fast",
           "An SLO is losing its 28-day budget over 14× too fast. See the table below."}

        not s.ok ->
          {"var(--muted)", "No metrics",
           "Only the chat probe is shown until metrics are connected."}

        true ->
          {"var(--teal)", "All good", "Messages arrive, the probe passes, nothing is stuck."}
      end

    when_ =
      case probe do
        %{"at" => at} -> "probe #{ago(at)}"
        _ -> "no probe result yet"
      end

    ~s|<section class="state" style="--c:#{c}" aria-live="polite"><span class="dot"></span><div><h2>#{title}</h2><p>#{text}</p></div><div class="when"><b>#{Calendar.strftime(s.at, "%H:%M")} UTC</b>#{when_}</div></section>|
  end

  defp journey(nil, true),
    do:
      ~s|<section class="card"><h2>Last chat probe</h2>#{ThirstrWeb.AdminUI.empty("No probe result yet", "Set <code>PROBE_KEY</code> here and the matching repo secret, on-call.md step 6. Runs every 5 min.")}</section>|

  defp journey(nil, false),
    do:
      ~s|<section class="card"><h2>Last chat probe</h2>#{ThirstrWeb.AdminUI.empty("Shown on that environment's console", "Each console keeps its own last probe run.")}</section>|

  defp journey(p, _) do
    steps = p["steps"] || %{}
    failed = p["failed"]

    cells =
      Enum.map_join(@steps, "", fn {k, name, sub} ->
        ms = steps[k]

        {cls, col, val} =
          cond do
            k == failed -> {" bad", "var(--danger)", "failed"}
            is_number(ms) -> {"", "var(--teal)", fmt_ms(ms)}
            true -> {"", "var(--line2)", "—"}
          end

        ~s|<div class="step#{cls}" style="--c:#{col}"><div class="ln"></div><div class="nm">#{name}</div><div class="ms">#{val}</div><div class="sb">#{sub}</div></div>|
      end)

    r =
      if p["ok"],
        do: "#{ago(p["at"])} · from GitHub · all steps ok",
        else: "#{ago(p["at"])} · step #{esc(failed)} failed"

    ~s|<section class="card"><h2>Last chat probe <span class="r">#{r}</span></h2><div class="journey">#{cells}</div></section>|
  end

  defp tiles(v, range) do
    p95 = v[:online_p95_1h]
    probe_all = v[:probe_all] || 0
    probe_ok = v[:probe_ok] || 0
    bad = round((v[:skipped] || 0) + (v[:stuck_max] || 0) + (v[:lost] || 0))

    [
      tile(
        "Online delivery p95",
        if(p95, do: fmt_ms(p95), else: "–"),
        "last hour · #{pct(v[:online_ok])} ≤ 1 s over #{range}",
        level(p95, 500, 1000)
      ),
      tile(
        "Probe success #{range}",
        if(probe_all > 0, do: "#{round(probe_ok)}/#{round(probe_all)}", else: "–"),
        if(probe_all > 0, do: pct(probe_ok / probe_all), else: "no runs reported"),
        if(probe_all > 0 and probe_ok < probe_all, do: "warn", else: "")
      ),
      tile(
        "Lost or stuck #{range}",
        "#{bad}",
        "skipped #{fmt_n(v[:skipped])} · stuck #{fmt_n(v[:stuck_max])} · lost #{fmt_n(v[:lost])}",
        if(bad > 0, do: "bad", else: "")
      ),
      tile(
        "API p95",
        if(v[:api_p95_1h], do: fmt_ms(v[:api_p95_1h]), else: "–"),
        "last hour · #{fmt_n(v[:api_rpm])} req/min · #{fmt_n(v[:live])} live sockets",
        level(v[:api_p95_1h], 500, nil)
      )
    ]
    |> Enum.join()
    |> then(&~s|<section class="htiles" aria-label="Key numbers">#{&1}</section>|)
  end

  defp level(nil, _, _), do: ""
  defp level(ms, _, bad) when is_number(bad) and ms > bad, do: "bad"
  defp level(ms, warn, _) when ms > warn, do: "warn"
  defp level(_, _, _), do: ""

  defp tile(k, val, sub, cls),
    do:
      ~s|<div class="htile #{cls}"><div class="k">#{k}</div><div class="v">#{val}</div><div class="s">#{sub}</div></div>|

  defp slo_table(v) do
    rows =
      Enum.map_join(Health.slo_list(), "", fn {id, name, target, obj} ->
        now = clamp(v[:"slo_#{id}_28d"])
        b = burn(v, id)
        budget = if now, do: max(0.0, 1 - (1 - now) / (1 - obj)), else: nil

        {cls, label} =
          cond do
            is_nil(now) -> {"off", "No data"}
            b > 6 or budget <= 0 -> {"bad", "Burning"}
            b > 1 or budget < 0.25 -> {"warn", "Watch"}
            true -> {"ok", "Healthy"}
          end

        col =
          %{
            "bad" => "var(--danger)",
            "warn" => "var(--sun)",
            "ok" => "var(--teal)",
            "off" => "var(--muted)"
          }[cls]

        w = if budget, do: round(budget * 100), else: 0

        ~s|<tr><td><b>#{name}</b><span class="sl">SLO-#{id}</span></td><td class="mono">#{target}</td><td class="n">#{if now, do: pct(now, 2), else: "–"}</td><td><div class="bud" style="--c:#{col}"><div class="t"><i style="width:#{w}%"></i></div><b>#{if budget, do: "#{w} %", else: "–"}</b></div></td><td class="n">#{if now, do: "#{Float.round(b, 1)}×", else: "–"}</td><td><span class="pill #{cls}">#{label}</span></td></tr>|
      end)

    ~s|<section class="card"><h2>Service levels <span class="r">28 days · budget = failures we can afford before breaking the promise</span></h2><div class="scroll"><table><thead><tr><th>Promise</th><th>Target</th><th class="rt">Now (28 d)</th><th>Budget left</th><th class="rt">Burn 1 h</th><th>State</th></tr></thead><tbody>#{rows}</tbody></table></div></section>|
  end

  # burn rate over 1 h = error ratio / budget ratio
  defp burn(v, id) do
    obj = Enum.find_value(Health.slo_list(), fn {i, _, _, o} -> if i == id, do: o end)

    case clamp(v[:"slo_#{id}_1h"]) do
      nil -> 0.0
      good -> (1 - good) / (1 - obj)
    end
  end

  defp clamp(nil), do: nil
  defp clamp(r), do: r |> max(0.0) |> min(1.0)

  defp chart(v, range) do
    series = [
      {v[:chart_p50], "var(--teal)", "p50"},
      {v[:chart_p95], "var(--violet)", "p95"},
      {v[:chart_p99], "var(--coral)", "p99"}
    ]

    pts =
      series |> Enum.flat_map(fn {s, _, _} -> s || [] end) |> Enum.reject(&is_nil(elem(&1, 1)))

    svg =
      if pts == [] do
        ThirstrWeb.AdminUI.empty(
          "No delivery samples yet",
          "Appears once phones with a live connection receive messages."
        )
      else
        draw(series, pts, range)
      end

    ~s|<section class="card chart"><h2>Delivery time, recipient online <span class="r">stored → recipient phone acked · #{range}</span></h2><div class="lg"><span><i style="background:var(--teal)"></i>p50</span><span><i style="background:var(--violet)"></i>p95</span><span><i style="background:var(--coral)"></i>p99</span><span><i style="background:var(--sun)"></i>target 1 s</span></div>#{svg}</section>|
  end

  defp draw(series, pts, range) do
    {w, h, l, r, t, b} = {900, 220, 50, 12, 10, 26}
    {t0, t1} = pts |> Enum.map(&elem(&1, 0)) |> Enum.min_max()
    t1 = max(t1, t0 + 1)
    lo = :math.log10(50)
    hi = :math.log10(30_000)

    y = fn ms ->
      t + (h - t - b) * (1 - (:math.log10(min(max(ms, 50), 30_000)) - lo) / (hi - lo))
    end

    x = fn ts -> l + (ts - t0) / (t1 - t0) * (w - l - r) end

    grid =
      Enum.map_join([100, 250, 500, 1000, 5000, 15_000], "", fn ms ->
        yy = Float.round(y.(ms), 1)

        ~s|<line x1="#{l}" x2="#{w - r}" y1="#{yy}" y2="#{yy}" stroke="var(--line)"/><text x="#{l - 6}" y="#{yy + 4}" text-anchor="end">#{fmt_ms(ms)}</text>|
      end)

    target =
      ~s|<line x1="#{l}" x2="#{w - r}" y1="#{y.(1000)}" y2="#{y.(1000)}" stroke="var(--sun)" stroke-width="1.5" stroke-dasharray="6 4"/>|

    labels =
      ~s|<text x="#{l}" y="#{h - 6}">#{stamp(t0, range)}</text><text x="#{w - r}" y="#{h - 6}" text-anchor="end">now</text>|

    lines =
      Enum.map_join(series, "", fn {s, col, _} ->
        ps = Enum.reject(s || [], &is_nil(elem(&1, 1)))

        case ps do
          [] ->
            ""

          _ ->
            d =
              ps
              |> Enum.with_index()
              |> Enum.map_join(" ", fn {{ts, ms}, i} ->
                "#{if i == 0, do: "M", else: "L"}#{Float.round(x.(ts) * 1.0, 1)} #{Float.round(y.(ms), 1)}"
              end)

            {lt, lv} = List.last(ps)

            ~s|<path d="#{d}" fill="none" stroke="#{col}" stroke-width="2"/><circle cx="#{Float.round(x.(lt) * 1.0, 1)}" cy="#{Float.round(y.(lv), 1)}" r="3.5" fill="#{col}"/>|
        end
      end)

    ~s|<svg viewBox="0 0 #{w} #{h}" role="img" aria-label="Online delivery time percentiles">#{grid}#{target}#{labels}#{lines}</svg>|
  end

  defp counts(v, range) do
    items = [
      {"Sent", v[:send_stored], ""},
      {"Duplicates caught", v[:send_repeat], ""},
      {"Dropped (blocked / gone)", v[:send_dropped], ""},
      {"Rate limited", v[:send_limited], ""},
      {"Skipped", v[:skipped], if((v[:skipped] || 0) > 0, do: "bad", else: "")},
      {"Stuck online (max)", v[:stuck_max], if((v[:stuck_max] || 0) > 0, do: "bad", else: "")},
      {"Lost (30 d sweep)", v[:lost], if((v[:lost] || 0) > 0, do: "bad", else: "")},
      {"Waiting now (offline)", v[:backlog], ""}
    ]

    cells =
      Enum.map_join(items, "", fn {k, n, cls} ->
        ~s|<div class="cnt"><div class="k">#{k}</div><div class="v #{cls}">#{fmt_n(n)}</div></div>|
      end)

    ~s|<section class="card"><h2>Messages, #{range}</h2><div class="counts">#{cells}</div><div class="note" style="margin-top:12px"><span>Skipped = a phone took later messages but not an earlier one. Stuck = waiting over 2 min while the phone is connected. Lost = deleted unread after 30 days. All three should stay at 0.</span></div></section>|
  end

  defp notif(v, range) do
    rows = [
      {"Accepted", v[:push_ok], "var(--violet)"},
      {"Retrying", v[:push_retry], "var(--sun)"},
      {"Token gone", v[:push_gone], "var(--muted)"},
      {"Turned off / unknown", v[:push_skipped], "var(--line2)"}
    ]

    bars(
      "Notifications, #{range}",
      "push → app opened p95 #{if v[:wake_p95], do: fmt_ms(v[:wake_p95]), else: "–"}",
      Enum.map(rows, fn {k, n, c} -> {k, n || 0, c, fmt_n(n)} end)
    )
  end

  defp api(v, range) do
    rows =
      Enum.map(Health.groups(), fn g ->
        ms = v[:"api_#{g}"]

        c =
          cond do
            is_nil(ms) -> "var(--line2)"
            ms > 300 -> "var(--danger)"
            ms > 200 -> "var(--sun)"
            true -> "var(--teal)"
          end

        {g, min(ms || 0, 500), c, if(ms, do: fmt_ms(ms), else: "–")}
      end)

    bars("API p95 by area", "server time, #{range}", rows, 500)
  end

  defp bars(title, right, rows, max \\ nil) do
    m = max || rows |> Enum.map(&elem(&1, 1)) |> Enum.max(fn -> 1 end) |> max(1)

    inner =
      Enum.map_join(rows, "", fn {k, n, c, label} ->
        ~s|<div class="fr" style="--c:#{c}"><span>#{k}</span><div class="b"><i style="width:#{Float.round(n / m * 100, 1)}%"></i></div><span class="n">#{label}</span></div>|
      end)

    ~s|<section class="card"><h2>#{title} <span class="r">#{right}</span></h2><div class="funnel">#{inner}</div></section>|
  end

  defp rum do
    ~s|<section class="card"><h2>In the app <span class="r">anonymous stats from phones · rows under 20 samples hidden</span></h2>#{ThirstrWeb.AdminUI.empty("Arrives with the next app build", "Send → ✓, send → ✓✓, Explore first paint, map tiles, app start and push → chat, bucketed on the phone, EN-23 OB-3.")}</section>|
  end

  defp attention(v, probe) do
    items =
      [
        probe && probe["ok"] == false &&
          {"var(--danger)", "Chat probe failing",
           "step #{esc(probe["failed"])} · #{ago(probe["at"])}", "probe-failing"},
        (v[:stuck_now] || 0) > 0 &&
          {"var(--danger)", "Messages stuck while phone connected", "#{fmt_n(v[:stuck_now])} now",
           "messages-stuck-online"},
        (v[:skipped] || 0) > 0 &&
          {"var(--sun)", "Messages skipped", "#{fmt_n(v[:skipped])} in range", "messages-skipped"}
      ] ++
        for {id, name, _, _} <- Health.slo_list(), burn(v, id) > 14.4 do
          {"var(--sun)", "SLO-#{id} fast burn: #{name}",
           "#{Float.round(burn(v, id), 1)}× budget over 1 h", "slo-#{id}-fast"}
        end

    list =
      case Enum.filter(items, & &1) do
        [] ->
          ThirstrWeb.AdminUI.empty(
            "Nothing needs attention",
            "Pages go out from the on-call runner every 5 min."
          )

        xs ->
          Enum.map_join(xs, "", fn {c, t, s, anchor} ->
            ~s|<div class="al" style="--c:#{c}"><span class="stripe"></span><div><b>#{t}</b><small>#{s}</small></div><a href="https://github.com/jeanyves-figiel/Thirstr/blob/main/docs/runbooks/alerts.md##{anchor}" rel="noopener">Runbook →</a></div>|
          end)
      end

    ~s|<section class="card"><h2>Needs attention <span class="r"><a href="https://github.com/jeanyves-figiel/Thirstr/actions/workflows/oncall.yml" rel="noopener">on-call runs</a></span></h2><div class="alerts">#{list}</div></section>|
  end

  # ------------------------------------------------------------------ format

  defp fmt_ms(ms) when ms >= 60_000, do: "#{Float.round(ms / 60_000, 1)} min"
  defp fmt_ms(ms) when ms >= 1000, do: "#{Float.round(ms / 1000, 1)} s"
  defp fmt_ms(ms), do: "#{round(ms)} ms"

  defp fmt_n(nil), do: "–"
  defp fmt_n(n), do: n |> round() |> Integer.to_string() |> group()

  defp group(s),
    do: s |> String.reverse() |> String.replace(~r/(\d{3})(?=\d)/, "\\1 ") |> String.reverse()

  defp pct(r, d \\ 1)
  defp pct(nil, _), do: "–"
  defp pct(r, d), do: "#{Float.round(r * 100.0, d)} %"

  defp ago(nil), do: "–"

  defp ago(iso) do
    case DateTime.from_iso8601(iso) do
      {:ok, t, _} ->
        s = DateTime.diff(DateTime.utc_now(), t)
        if s < 120, do: "#{s} s ago", else: "#{div(s, 60)} min ago"

      _ ->
        "–"
    end
  end

  defp stamp(ts, "24h"), do: ts |> round() |> DateTime.from_unix!() |> Calendar.strftime("%H:%M")
  defp stamp(ts, _), do: ts |> round() |> DateTime.from_unix!() |> Calendar.strftime("%d %b")

  defp esc(nil), do: ""
  defp esc(s), do: s |> to_string() |> Plug.HTML.html_escape()

  defp css do
    """
    .state{display:flex;gap:14px;align-items:center;flex-wrap:wrap;border-radius:18px;padding:16px 18px;border:1px solid var(--line);background:var(--ink);position:relative;overflow:hidden}
    .state::before{content:"";position:absolute;inset:0 auto 0 0;width:6px;background:var(--c)}
    .state .dot{width:14px;height:14px;border-radius:50%;background:var(--c);flex:none;margin-left:6px;box-shadow:0 0 0 6px rgba(255,255,255,.06)}
    .state h2{margin:0;font-size:20px;font-weight:800;letter-spacing:-.3px}
    .state p{margin:2px 0 0;color:var(--fg2);font-size:13px}
    .state .when{margin-left:auto;text-align:right;font-size:12px;color:var(--muted)}
    .state .when b{display:block;font:700 13px/1.3 var(--mono);color:var(--fg)}
    .card h2 .r{margin-left:auto;font-weight:500;font-size:12px;color:var(--muted)}
    .card h2 .r a{color:var(--teal);text-decoration:none}
    .journey{display:grid;grid-template-columns:repeat(6,minmax(0,1fr))}
    @media (max-width:760px){.journey{grid-template-columns:repeat(3,minmax(0,1fr));row-gap:14px}}
    .step{display:flex;flex-direction:column;gap:6px;padding-right:8px;min-width:0}
    .step .ln{height:4px;border-radius:2px;background:var(--c);margin-right:-8px}
    .step .nm{font-size:12px;font-weight:700;color:var(--fg2)}
    .step .ms{font:700 15px/1 var(--mono)}
    .step .sb{font-size:11px;color:var(--muted)}
    .step.bad .ms{color:var(--danger)}
    .htiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
    @media (max-width:1000px){.htiles{grid-template-columns:repeat(2,minmax(0,1fr))}}
    .htile{background:var(--ink);border:1px solid var(--line);border-radius:16px;padding:14px;display:flex;flex-direction:column;gap:6px;min-width:0}
    .htile .k{font-size:11.5px;color:var(--muted);font-weight:700;letter-spacing:.06em;text-transform:uppercase}
    .htile .v{font:700 26px/1 var(--mono);letter-spacing:-.5px}
    .htile .s{font-size:12px;color:var(--muted)}
    .htile.bad{border-color:rgba(255,77,109,.55)}.htile.bad .v{color:var(--danger)}.htile.warn .v{color:var(--sun)}
    .pill{font:700 10.5px/1 var(--mono);letter-spacing:.04em;padding:4px 7px;border-radius:999px;text-transform:uppercase;white-space:nowrap}
    .pill.ok{background:rgba(61,214,195,.14);color:var(--teal)}.pill.warn{background:rgba(255,201,60,.16);color:var(--sun)}
    .pill.bad{background:rgba(255,77,109,.18);color:var(--danger)}.pill.off{background:var(--raised2);color:var(--muted)}
    .bud{display:flex;align-items:center;gap:8px;min-width:140px}
    .bud .t{flex:1;height:8px;border-radius:4px;background:var(--raised2);overflow:hidden}
    .bud .t i{display:block;height:100%;border-radius:4px;background:var(--c)}
    .bud b{font:600 12px/1 var(--mono);width:38px;text-align:right}
    table{border-collapse:collapse;width:100%;font-size:13px}
    th{color:var(--muted);font-weight:600;text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);font-size:12px}
    th.rt{text-align:right}
    td{padding:9px 6px;border-bottom:1px solid var(--line)}
    tr:last-child td{border-bottom:0}
    td.n{text-align:right;font-family:var(--mono)}
    td .sl{display:block;font-size:11.5px;color:var(--muted)}
    .lg{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--fg2);margin-bottom:6px}
    .lg i{display:inline-block;width:14px;height:3px;border-radius:2px;margin-right:6px;vertical-align:3px}
    .chart svg{width:100%;height:auto;display:block}
    .chart text{font:11px var(--mono);fill:var(--muted)}
    .hgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
    @media (max-width:1000px){.hgrid{grid-template-columns:1fr}}
    .counts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
    @media (max-width:700px){.counts{grid-template-columns:repeat(2,minmax(0,1fr))}}
    .cnt{background:var(--raised);border-radius:12px;padding:10px 12px}
    .cnt .k{font-size:11.5px;color:var(--fg2);font-weight:600}
    .cnt .v{font:700 17px/1.2 var(--mono)}.cnt .v.bad{color:var(--danger)}
    .funnel{display:flex;flex-direction:column;gap:8px}
    .fr{display:grid;grid-template-columns:150px minmax(0,1fr) 76px;gap:10px;align-items:center;font-size:13px}
    @media (max-width:480px){.fr{grid-template-columns:110px minmax(0,1fr) 64px}}
    .fr .b{height:18px;border-radius:6px;background:var(--raised2);overflow:hidden}
    .fr .b i{display:block;height:100%;background:var(--c);border-radius:6px}
    .fr .n{text-align:right;font:600 12.5px/1 var(--mono)}
    .alerts{display:flex;flex-direction:column}
    .al{display:grid;grid-template-columns:6px minmax(0,1fr) auto;gap:12px;align-items:center;padding:10px 0;border-top:1px solid var(--line)}
    .al:first-child{border-top:0}
    .al .stripe{align-self:stretch;border-radius:3px;background:var(--c)}
    .al small{display:block;color:var(--muted);font-size:12px}
    .al a{color:var(--teal);font-size:12.5px;text-decoration:none;font-weight:600;white-space:nowrap}
    .note.warn{background:rgba(255,201,60,.1);color:var(--sun)}
    """
  end
end
