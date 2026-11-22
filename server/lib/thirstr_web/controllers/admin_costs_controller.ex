defmodule ThirstrWeb.AdminCostsController do
  @moduledoc """
  A-11 Costs & capacity (admin-console.md, EN-21 #180). Owner-only like every console page;
  every view and change is audited (R-AD.4). Aggregates only (AC-AD.7). Chart is server-rendered
  SVG, no scripts.
  """
  use ThirstrWeb, :controller
  alias Thirstr.Costs
  import ThirstrWeb.AdminController, only: [audit: 4, page: 3, e: 1]
  alias ThirstrWeb.AdminUI

  @colors ~w(#a78bfa #ff7a59 #3dd6c6 #c6f56b #ffb547 #7a74a8 #f472b6 #60a5fa)

  def index(conn, params) do
    audit(conn.assigns.admin, "view_costs", nil, nil)
    today = Date.utc_today()
    sel = month_param(params["m"], today)
    s = Costs.settings()
    sum = Costs.month(sel, today)
    prev = Costs.month(Date.shift(sel, month: -1), today)
    hist = Costs.history(6, today)
    f = Costs.forecast(today)
    color = vendor_colors(hist)
    csrf = ~s|<input type="hidden" name="_csrf_token" value="#{get_csrf_token()}">|

    page(conn, "Costs", """
    <style>#{css()}</style>
    #{AdminUI.head("Costs &amp; capacity", "#{Calendar.strftime(sel, "%B %Y")} · #{source_line(sum, s)}", month_nav(sel, today))}
    #{setup_note(sum, s)}
    #{budget(sum, s)}
    #{kpis(sum, prev)}
    <div class="cols"><div class="card"><h2>By vendor <span class="r">#{if sum.current, do: "projected month-end", else: "month total"}</span></h2>#{vendor_table(sum, prev, color)}</div>
    <div class="card chart"><h2>Last 6 months <span class="r">EUR · line = cost per MAU</span></h2>#{chart(hist, color)}</div></div>
    #{forecast(f, today)}
    <div class="card" id="items"><h2>Cost items <span class="r">typed in · applied per month</span></h2>#{items(csrf, today)}</div>
    #{settings_form(s, csrf, f)}
    """)
  end

  defp month_nav(sel, today) do
    m0 = Date.beginning_of_month(today)
    prev = Date.shift(sel, month: -1)
    next = Date.shift(sel, month: 1)
    ym = &String.slice(Date.to_iso8601(&1), 0, 7)
    oldest = Date.shift(m0, month: -11)

    p =
      if Date.compare(prev, oldest) != :lt,
        do:
          ~s(<a class="btn ghost" href="/admin/costs?m=#{ym.(prev)}">‹ #{Calendar.strftime(prev, "%b")}</a>),
        else: ""

    n =
      if Date.compare(next, m0) != :gt,
        do:
          ~s(<a class="btn ghost" href="/admin/costs?m=#{ym.(next)}">#{Calendar.strftime(next, "%b")} ›</a>),
        else: ""

    p <> n <> ~s(<a class="btn pri" href="#add">+ Cost item</a>)
  end

  # Empty or half set-up page: say exactly what to do, in order (R-AD.13).
  defp setup_note(sum, s) do
    steps =
      [
        !Costs.fly_configured?() &&
          "Set the read-only Fly token on the API app: <code>fly tokens create readonly thirstr</code>, then <code>fly secrets set FLY_COST_TOKEN=…</code> (runbook <code>costs.md</code>, #301).",
        Costs.items() == [] &&
          ~s(Apple Developer, Google Play and the domain are preset by the nightly job; add anything else as <a href="#add">cost items</a>. Amazon SES and Tigris fill in by themselves.),
        !(is_number(s["budget_eur"]) and s["budget_eur"] > 0) &&
          ~s(Set a monthly <a href="#settings">budget</a> to get email alerts at 80 % and 100 %.)
      ]
      |> Enum.filter(& &1)

    cond do
      steps == [] ->
        ""

      sum.vendors == [] ->
        ~s(<div class="note warn"><b>Nothing to show yet.</b><ol>#{Enum.map_join(steps, "", &"<li>#{&1}</li>")}</ol></div>)

      true ->
        ~s(<div class="note"><b>To finish setting up:</b><ol>#{Enum.map_join(steps, "", &"<li>#{&1}</li>")}</ol></div>)
    end
  end

  # ------------------------------------------------------------------ actions

  def add_item(conn, p) do
    with {:ok, attrs} <- item_attrs(p), {:ok, id} <- Costs.add_item(attrs) do
      audit(conn.assigns.admin, "cost_item_add", to_string(id), attrs.vendor)
      redirect(conn, to: "/admin/costs")
    else
      _ -> send_resp(conn, 422, "Vendor, amount (EUR), cadence and start month are required")
    end
  end

  def item_action(conn, %{"id" => id, "op" => "end"} = p) do
    Costs.end_item(String.to_integer(id), p["end_month"] || Date.to_iso8601(Date.utc_today()))
    audit(conn.assigns.admin, "cost_item_end", id, p["end_month"])
    redirect(conn, to: "/admin/costs")
  end

  def item_action(conn, %{"id" => id, "op" => "update"} = p) do
    with {:ok, attrs} <- item_attrs(p), :ok <- Costs.update_item(String.to_integer(id), attrs) do
      audit(conn.assigns.admin, "cost_item_update", id, attrs.vendor)
      redirect(conn, to: "/admin/costs")
    else
      _ -> send_resp(conn, 422, "Invalid item")
    end
  end

  def item_action(conn, _), do: send_resp(conn, 422, "")

  def save_settings(conn, %{"reason" => reason} = p) when byte_size(reason) > 2 do
    num = fn k, f ->
      with v when v not in [nil, ""] <- p[k],
           {n, _} <- Float.parse(v),
           do: f.(n),
           else: (_ -> nil)
    end

    changes = [
      {"budget_eur", num.("budget_eur", &max(0, &1))},
      {"usd_eur", num.("usd_eur", &if(&1 > 0, do: &1))},
      {"cap_per_machine", num.("cap_per_machine", &if(&1 >= 1, do: round(&1)))},
      {"peak_ratio", num.("peak_pct", &if(&1 > 0 and &1 <= 100, do: &1 / 100))},
      {"growth_override", num.("growth_override", & &1)},
      {"cap_measured_on", date(p["cap_measured_on"])},
      {"alert_email", email(p["alert_email"])}
    ]

    for {k, v} <- changes, v != nil or k in ~w(growth_override cap_measured_on) do
      Costs.put_setting(k, v)
    end

    prices = Costs.settings()["fly_prices"]

    new_prices =
      for k <- Map.keys(prices), into: %{} do
        {k, num.("fly_" <> k, &if(&1 >= 0, do: &1)) || prices[k]}
      end

    Costs.put_setting("fly_prices", new_prices)
    audit(conn.assigns.admin, "cost_settings", nil, String.slice(reason, 0, 200))
    redirect(conn, to: "/admin/costs")
  end

  def save_settings(conn, _), do: send_resp(conn, 422, "A reason is required (R-AD.12)")

  defp item_attrs(p) do
    with v when is_binary(v) and v != "" <- String.trim(p["vendor"] || ""),
         {amt, _} <- Float.parse(String.replace(p["amount"] || "", ",", ".")),
         true <- amt >= 0,
         c when c in ["once", "monthly", "yearly"] <- p["cadence"],
         {:ok, start} <- Date.from_iso8601((p["start_month"] || "") <> "-01") do
      {:ok,
       %{
         vendor: v,
         label: blank(p["label"]),
         amount_cents: round(amt * 100),
         cadence: c,
         start_month: start,
         end_month: date(p["end_month"]),
         note: blank(p["note"])
       }}
    else
      _ -> :error
    end
  end

  defp blank(s) when s in [nil, ""], do: nil
  defp blank(s), do: String.slice(s, 0, 200)

  defp date(s) when is_binary(s) and s != "" do
    s = if String.length(s) == 7, do: s <> "-01", else: s

    case Date.from_iso8601(s) do
      {:ok, d} -> Date.to_iso8601(d)
      _ -> nil
    end
  end

  defp date(_), do: nil

  defp email(s) when is_binary(s) do
    s = String.trim(s)
    if Regex.match?(~r/^[^@\s]+@[^@\s]+\.[^@\s]+$/, s), do: s
  end

  defp email(_), do: nil

  defp month_param(m, today) do
    case m && Date.from_iso8601(m <> "-01") do
      {:ok, d} -> d
      _ -> Date.beginning_of_month(today)
    end
  end

  # ------------------------------------------------------------------ sections

  defp source_line(sum, s) do
    fly =
      cond do
        not Costs.fly_configured?() ->
          "Fly token not set, Fly typed in"

        sum.vendors |> Enum.any?(&(&1[:source] == "fly_api")) ->
          "Fly from API, updated daily 02:10 UTC"

        true ->
          "Fly from API, no data yet this month"
      end

    "#{fly} · SES counted, Tigris measured daily · others typed in · EUR, USD at #{s["usd_eur"]}"
  end

  defp budget(sum, s) do
    b = s["budget_eur"]

    if is_number(b) and b > 0 do
      bc = b * 100
      pct = round(sum.total / bc * 100)
      mtd = min(100, round(sum.mtd / bc * 100))
      proj = min(100, pct)

      cls =
        cond do
          pct >= 100 -> "bad"
          pct >= 80 -> "warn"
          true -> "good"
        end

      """
      <div class="card budget"><h2>Budget <b>#{Costs.eur(round(bc))}</b> <span class="pill #{cls}">#{pct} % projected</span><span class="r">alerts at 80 % and 100 % to #{e(s["alert_email"])}</span></h2>
      <div class="btrack #{cls}" role="img" aria-label="#{mtd} percent spent, #{pct} percent projected, alert at 80 percent"><i class="proj" style="width:#{proj}%"></i><i class="spent" style="width:#{mtd}%"></i><span class="mark" style="left:80%"></span></div>
      <div class="blegend"><span><i class="k-spent"></i><b class="mono">#{Costs.eur(sum.mtd)}</b> spent#{if sum.current, do: " (#{sum.elapsed} of #{sum.days} days)", else: ""}</span>#{if sum.current, do: ~s(<span><i class="k-proj"></i><b class="mono">#{Costs.eur(sum.total)}</b> projected month-end</span>), else: ""}<span><i class="k-mark"></i>alert at <b class="mono">#{Costs.eur(round(bc * 0.8))}</b></span></div></div>
      """
    else
      ~s|<div class="card budget"><h2>No budget set <span class="r">alerts off · <a href="#settings">set one</a></span></h2><div class="blegend"><span><b class="mono">#{Costs.eur(sum.total)}</b> #{if sum.current, do: "projected month-end", else: "month total"}</span></div></div>|
    end
  end

  defp kpis(sum, prev) do
    delta = sum.total - prev.total

    ratio =
      if sum.mau && sum.mau > 0 && sum.dau, do: "#{round(sum.dau / sum.mau * 100)} %", else: "–"

    """
    <div class="kpis">
    <div class="kpi"><span>Total #{if sum.current, do: "this month", else: Calendar.strftime(sum.month, "%b %Y")}</span><b>#{Costs.eur(sum.total)}</b><small class="#{if delta > 0, do: "up", else: "down"}">#{if delta >= 0, do: "▲", else: "▼"} #{Costs.eur(abs(delta))} vs #{Calendar.strftime(prev.month, "%B")}</small></div>
    <div class="kpi"><span>MAU</span><b>#{num(sum.mau)}</b><small>30-day active accounts</small></div>
    <div class="kpi"><span>Cost per MAU</span><b>#{if sum.per_mau, do: Costs.eur(sum.per_mau), else: "–"}</b><small>plan at 10k: ≈ €0.04</small></div>
    <div class="kpi"><span>DAU / MAU</span><b>#{ratio}</b><small>#{if sum.dau, do: "#{num(sum.dau)} on the last day", else: "no data yet"}</small></div>
    </div>
    """
  end

  defp vendor_table(%{vendors: []}, _, _),
    do: AdminUI.empty("No costs yet", "Add cost items below, or set the Fly token.")

  defp vendor_table(sum, prev, color) do
    pv = Map.new(prev.vendors, &{&1.vendor, &1.cents})
    top = sum.vendors |> Enum.map(& &1.cents) |> Enum.max(fn -> 1 end) |> max(1)
    prev_apps = Enum.find_value(prev.vendors, [], & &1[:apps])

    rows =
      Enum.map_join(sum.vendors, "", fn v ->
        last = Map.get(pv, v.vendor, 0)
        c = color.(v.vendor)

        apps =
          for a <- v[:apps] || [] do
            pa = Enum.find_value(prev_apps, 0, &(&1.app == a.app && &1.cents))

            ~s(<div class="vsub"><span>#{e(a.app)} · #{e(machines_txt(a.detail))}</span><span class="amt">#{Costs.eur(a.cents)}</span><span class="dl #{chg_cls(a.cents - pa)}">#{chg(a.cents - pa)}</span></div>)
          end

        ~s(<div class="vrow"><span class="nm"><i style="background:#{c}"></i><span>#{e(v.vendor)}</span> #{source_pill(v.source)}#{if v[:units], do: ~s( <span class="sm muted">#{e(v.units)}</span>), else: ""}</span><span class="bar2"><i style="width:#{max(1, round(v.cents / top * 100))}%;background:#{c}"></i></span><span class="amt">#{Costs.eur(v.cents)}</span><span class="dl #{chg_cls(v.cents - last)}" title="vs #{Calendar.strftime(prev.month, "%B")}: #{Costs.eur(last)}">#{chg(v.cents - last)}</span></div>) <>
          Enum.join(apps)
      end)

    """
    <div class="vend">#{rows}
    <div class="vrow tot"><span class="nm">Total</span><span></span><span class="amt">#{Costs.eur(sum.total)}</span><span class="dl #{chg_cls(sum.total - prev.total)}">#{chg(sum.total - prev.total)}</span></div></div>
    <div class="sm muted">Change vs #{Calendar.strftime(prev.month, "%B")} (#{Costs.eur(prev.total)}).</div>
    """
  end

  defp machines_txt(%{"machines" => ms} = d) do
    started = Enum.filter(ms, &(&1["state"] == "started"))

    m =
      started
      |> Enum.frequencies_by(&"#{&1["cpu_kind"]}-cpu-#{&1["cpus"]}x #{&1["memory_mb"]} MB")
      |> Enum.map_join(", ", fn {k, n} -> "#{n} × #{k}" end)

    vols = (d["volumes"] || []) |> Enum.map(& &1["size_gb"]) |> Enum.sum()
    Enum.join(Enum.reject([m, vols > 0 && "#{vols} GB volume"], &(&1 in [false, ""])), " + ")
  end

  defp machines_txt(_), do: ""

  defp source_pill("fly_api"), do: ~s|<span class="pill api">Fly API</span>|
  defp source_pill("metered"), do: ~s|<span class="pill api">auto</span>|

  defp source_pill(s) do
    s
    |> String.split("+")
    |> Enum.map_join(" ", fn
      "yearly" -> ~s|<span class="pill">yearly ÷ 12</span>|
      "once" -> ~s|<span class="pill">one-off</span>|
      c -> ~s|<span class="pill">#{e(c)}</span>|
    end)
  end

  defp chg(0), do: "—"
  defp chg(d) when d > 0, do: "+" <> Costs.eur(d)
  defp chg(d), do: Costs.eur(d)
  defp chg_cls(d) when d > 0, do: "up"
  defp chg_cls(d) when d < 0, do: "down"
  defp chg_cls(_), do: ""

  # Stacked bars per vendor (EUR) + cost per MAU line on its own right-hand scale.
  defp chart(hist, color) do
    if Enum.all?(hist, &(&1.total == 0)),
      do: AdminUI.empty("No history yet", "Bars appear once a month has costs."),
      else: chart_svg(hist, color)
  end

  defp chart_svg(hist, color) do
    max_total = hist |> Enum.map(& &1.total) |> Enum.max(fn -> 0 end)
    step = nice_step(max_total / 3)
    top = max(step * 3, 1)
    h = 150
    y0 = 170
    sc = fn c -> c / top * h end
    per = hist |> Enum.map(& &1.per_mau) |> Enum.filter(&is_integer/1)
    pmax = max(Enum.max(per, fn -> 0 end), 1)

    grid =
      for i <- 0..3 do
        y = y0 - i * h / 3

        ~s|<line x1="44" y1="#{y}" x2="410" y2="#{y}" class="gl"/><text x="40" y="#{y + 4}" text-anchor="end">#{eur_short(round(step * i))}</text>|
      end

    cols =
      hist
      |> Enum.with_index()
      |> Enum.map(fn {m, i} ->
        x = 58 + i * 60

        {rects, _} =
          m.vendors
          |> Enum.sort_by(& &1.vendor)
          |> Enum.map_reduce(y0, fn v, y ->
            hh = sc.(v.cents)

            {~s|<rect x="#{x}" y="#{y - hh}" width="34" height="#{hh}" style="fill:#{color.(v.vendor)}"><title>#{e(v.vendor)} #{Costs.eur(v.cents)}</title></rect>|,
             y - hh}
          end)

        label =
          ~s|<text x="#{x + 17}" y="188" text-anchor="middle">#{Calendar.strftime(m.month, "%b")}</text>|

        pt = m.per_mau && {x + 17, y0 - m.per_mau / pmax * h}
        {Enum.join(rects) <> label, pt, m}
      end)

    pts = for {_, {x, y}, _} <- cols, do: "#{x},#{Float.round(y * 1.0, 1)}"

    dots =
      for {_, {x, y}, m} <- cols do
        ~s|<circle cx="#{x}" cy="#{y}" r="3" class="dot"><title>#{Costs.eur(m.per_mau)} per MAU</title></circle>|
      end

    last =
      case List.last(cols) do
        {_, {x, y}, m} ->
          ~s|<text x="#{x}" y="#{y - 8}" text-anchor="middle" class="hl">#{Costs.eur(m.per_mau)}</text>|

        _ ->
          ""
      end

    vendors =
      hist |> Enum.flat_map(& &1.vendors) |> Enum.map(& &1.vendor) |> Enum.uniq() |> Enum.sort()

    """
    <svg viewBox="0 0 420 200" role="img" aria-label="Monthly cost per vendor, last 6 months, with cost per MAU">
    #{Enum.join(grid)}#{Enum.map_join(cols, "", &elem(&1, 0))}
    #{if length(pts) > 1, do: ~s|<polyline points="#{Enum.join(pts, " ")}" class="pl"/>|, else: ""}#{Enum.join(dots)}#{last}</svg>
    <div class="legend">#{Enum.map_join(vendors, "", &~s|<span><span class="sw" style="background:#{color.(&1)}"></span>#{e(&1)}</span>|)}<span>— cost per MAU (own scale)</span></div>
    """
  end

  defp nice_step(x) when x <= 0, do: 1000

  defp nice_step(x) do
    p = :math.pow(10, Float.floor(:math.log10(x)))
    Enum.find([1, 2, 2.5, 5, 10], &(&1 * p >= x)) * p
  end

  defp eur_short(c) when c >= 100_000, do: "€#{div(c, 100_000)}k"
  defp eur_short(c), do: "€#{div(c, 100)}"

  defp vendor_colors(hist) do
    names =
      hist |> Enum.flat_map(& &1.vendors) |> Enum.map(& &1.vendor) |> Enum.uniq() |> Enum.sort()

    map =
      names
      |> Enum.with_index()
      |> Map.new(fn {n, i} -> {n, Enum.at(@colors, rem(i, length(@colors)))} end)

    fn v -> Map.get(map, v, "#7a74a8") end
  end

  defp items(csrf, today) do
    list = Costs.items()
    cur = String.slice(Date.to_iso8601(today), 0, 7)

    rows =
      Enum.map_join(list, "", fn i ->
        ended = i.end_month && Date.compare(i.end_month, Date.beginning_of_month(today)) == :lt

        """
        <tr class="#{if ended, do: "ended"}"><td>#{e(i.vendor)}#{if i.label, do: ~s|<div class="sm muted">#{e(i.label)}</div>|}</td><td class="r">#{Costs.eur(i.amount_cents)}</td><td>#{cad(i.cadence)}</td>
        <td>#{ym(i.start_month)}#{if i.end_month, do: " → #{ym(i.end_month)}"}</td>
        <td><details><summary>Edit</summary><form method="post" action="/admin/costs/items/#{i.id}" class="add">#{csrf}<input type="hidden" name="op" value="update">
        #{item_fields(i, "e#{i.id}")}<button class="primary">Save</button></form>
        #{if i.end_month, do: "", else: ~s|<form method="post" action="/admin/costs/items/#{i.id}">#{csrf}<input type="hidden" name="op" value="end"><label class="sm muted">Last month <input type="month" name="end_month" value="#{cur}"></label> <button>End</button></form>|}
        </details></td></tr>
        """
      end)

    """
    #{if list == [], do: AdminUI.empty("No cost items yet", "Typical: Tigris, Amazon SES (monthly), Apple Developer, domain (yearly), Google Play (once)."), else: ~s|<div class="tbl"><table class="narrow"><tr><th>Vendor</th><th class="r">Amount</th><th>Every</th><th>Months</th><th></th></tr>#{rows}</table></div>|}
    <h3 id="add">Add a cost item</h3><form method="post" action="/admin/costs/items" class="add">#{csrf}#{item_fields(%{cadence: "monthly", start_month: Date.beginning_of_month(today)}, "n")}<button class="primary">Add item</button></form>
    <div class="sm muted">Amounts in EUR. Ending an item keeps past months right. Every change is in the audit log.</div>
    """
  end

  defp item_fields(i, p) do
    opts =
      Enum.map_join(Costs.cadences(), "", fn c ->
        ~s|<option value="#{c}"#{if i[:cadence] == c, do: " selected"}>#{cad(c)}</option>|
      end)

    amount =
      if i[:amount_cents],
        do: :erlang.float_to_binary(i.amount_cents / 100, decimals: 2),
        else: ""

    """
    <label for="#{p}v">Vendor<input id="#{p}v" name="vendor" maxlength="60" required value="#{e(i[:vendor])}"></label>
    <label for="#{p}a">Amount EUR<input id="#{p}a" name="amount" inputmode="decimal" required value="#{amount}"></label>
    <label for="#{p}c">Every<select id="#{p}c" name="cadence">#{opts}</select></label>
    <label for="#{p}s">From<input id="#{p}s" type="month" name="start_month" required value="#{ym(i[:start_month])}"></label>
    <label for="#{p}l">Label<input id="#{p}l" name="label" maxlength="60" value="#{e(i[:label])}"></label>
    """
  end

  defp cad("monthly"), do: "month"
  defp cad("yearly"), do: "year"
  defp cad("once"), do: "once"
  defp ym(nil), do: ""
  defp ym(d), do: String.slice(Date.to_iso8601(d), 0, 7)

  defp forecast(f, today) do
    i = f.inputs

    badge =
      if i.cap_measured_on,
        do:
          ~s|<span class="pill good">API capacity measured #{e(i.cap_measured_on)} · #{i.cap} per machine</span>|,
        else:
          ~s|<span class="pill warn">API capacity unmeasured · planning default #{i.cap} per machine</span>|

    runway = runway_html(f)
    rows = Enum.map_join(List.wrap(f.now) ++ f.rows, "", &forecast_tr(&1, i))

    """
    <div class="card"><h2>Capacity forecast #{badge}</h2>#{runway}
    <div class="tbl"><table><tr><th>When</th><th class="r">MAU</th><th class="r">Peak online</th><th class="r">API machines</th><th class="r">DB size</th><th class="r">Monthly cost</th></tr>#{rows}</table></div>
    <div class="sm muted">Inputs: DAU = <abbr title="average DAU over 7 days ÷ MAU (0.4 until measured)">#{pct(i.dau_ratio)} of MAU</abbr> ·
    peak online = <abbr title="assumed, enterprise-readiness.md §4">#{pct(i.peak_ratio)} of DAU</abbr> ·
    <abbr title="#{if i.cap_measured_on, do: "SR-12 run #{e(i.cap_measured_on)}", else: "planning default, no SR-12 run yet"}">#{i.cap} users per API machine</abbr> × #{i.headroom} headroom ·
    <abbr title="pg_database_size ÷ MAU">#{bytes(i.bytes_per_mau && round(i.bytes_per_mau))} per MAU</abbr> ·
    cost: Fly API machine price × machines, other Fly fixed, monthly items × MAU, yearly and one-off fixed. As of #{Date.to_iso8601(today)}.</div></div>
    """
  end

  defp runway_html(f) do
    i = f.inputs

    case f.runway do
      nil ->
        ~s|<p class="muted">Needs MAU and Fly data (first daily snapshot) for a runway.</p>|

      r ->
        what = if r.by == :api, do: "API machines", else: "DB disk (80 % of volume)"
        other = if r.by == :api, do: f.limits.db, else: f.limits.api

        when_txt =
          cond do
            r.months == 0 -> "now"
            is_nil(r.date) -> "no growth, sizing holds"
            true -> Calendar.strftime(r.date, "%B %Y")
          end

        cls = if r.months && r.months < 3, do: "runway bad", else: "runway"

        ~s|<div class="#{cls}">Current sizing holds until <b>≈ #{num(r.mau)} MAU (#{when_txt})</b>, first limit: #{what}.#{if other, do: " The other limit is at ≈ #{num(other)} MAU."} Growth #{growth_txt(i)}.</div>|
    end
  end

  defp forecast_tr(r, i) do
    mach_cls = if i.running && r.machines > i.running, do: "pill bad", else: ""

    db_cls =
      if i.volume_gb && r.db_bytes && r.db_bytes > i.volume_gb * 0.8e9,
        do: "pill bad",
        else: ""

    """
    <tr><td>#{row_label(r.label)}</td><td class="r">#{num(r.mau)}</td><td class="r">#{num(r.peak)}</td>
    <td class="r"><span class="#{mach_cls}">#{r.machines}</span>#{if r.label == :now and i.running, do: ~s| <span class="sm muted">(#{i.running} run)</span>|}</td>
    <td class="r"><span class="#{db_cls}">#{bytes(r.db_bytes)}</span>#{if r.label == :now and i.volume_gb, do: ~s| <span class="sm muted">/ #{i.volume_gb} GB</span>|}</td>
    <td class="r">#{if r.cost, do: Costs.eur(round(r.cost / 100) * 100) |> String.replace(".00", ""), else: "–"}</td></tr>
    """
  end

  defp growth_txt(%{growth_src: :none}), do: "unknown (under 14 days of data, set an override)"

  defp growth_txt(%{growth: g, growth_src: src}),
    do: "#{if g >= 0, do: "+"}#{round(g * 100)} %/month, #{src}"

  defp row_label(:now), do: "Now"
  defp row_label({:months, n, d}), do: "+#{n} months · #{Calendar.strftime(d, "%b %Y")}"
  defp row_label({:mau, m}), do: "#{compact(m)} MAU"

  defp compact(1_000_000), do: "1M"
  defp compact(m), do: "#{div(m, 1000)}k"

  defp settings_form(s, csrf, f) do
    p = s["fly_prices"]
    g = s["growth_override"]

    """
    <details class="card" id="settings"><summary><h2>Settings <span class="r">budget, alerts, exchange rate, capacity inputs, Fly prices</span></h2></summary>
    <form method="post" action="/admin/costs/settings" class="settings">#{csrf}
    <label for="sb">Monthly budget EUR (0 = no alerts)<input id="sb" name="budget_eur" inputmode="decimal" value="#{s["budget_eur"]}"></label>
    <label for="se">Alert email<input id="se" name="alert_email" type="email" value="#{e(s["alert_email"])}"></label>
    <label for="sf">USD → EUR<input id="sf" name="usd_eur" inputmode="decimal" value="#{s["usd_eur"]}"></label>
    <label for="sc">Users per API machine (SR-12)<input id="sc" name="cap_per_machine" inputmode="numeric" value="#{s["cap_per_machine"]}"></label>
    <label for="sd">Measured on<input id="sd" name="cap_measured_on" type="date" value="#{e(s["cap_measured_on"])}"></label>
    <label for="sp">Peak online % of DAU<input id="sp" name="peak_pct" inputmode="decimal" value="#{round(s["peak_ratio"] * 100)}"></label>
    <label for="sg">Growth override %/month<input id="sg" name="growth_override" inputmode="decimal" value="#{g}" placeholder="#{if f.inputs.growth_src == :measured, do: "measured: #{round(f.inputs.growth * 100)}", else: "none"}"></label>
    <label for="fs">Fly shared vCPU $ (incl. 256 MB)<input id="fs" name="fly_shared_cpu" inputmode="decimal" value="#{p["shared_cpu"]}"></label>
    <label for="fp">Fly performance vCPU $ (incl. 2 GB)<input id="fp" name="fly_performance_cpu" inputmode="decimal" value="#{p["performance_cpu"]}"></label>
    <label for="fr">Fly extra RAM $/GB<input id="fr" name="fly_ram_gb" inputmode="decimal" value="#{p["ram_gb"]}"></label>
    <label for="fv">Fly volume $/GB<input id="fv" name="fly_volume_gb" inputmode="decimal" value="#{p["volume_gb"]}"></label>
    <label for="sr">Reason<input id="sr" name="reason" required minlength="3" placeholder="required"></label>
    <button class="primary">Save settings</button></form>
    <div class="sm muted">Fly prices are list prices per 30 days (estimate); stopped machines count €0.</div></details>
    """
  end

  # ------------------------------------------------------------------ format

  defp num(nil), do: "–"
  defp num(n) when is_float(n), do: num(round(n))

  defp num(n),
    do:
      n
      |> Integer.to_string()
      |> String.reverse()
      |> String.replace(~r/(\d{3})(?=\d)/, "\\1 ")
      |> String.reverse()

  defp pct(x), do: "#{round(x * 100)} %"

  defp bytes(nil), do: "–"
  defp bytes(b) when b >= 1.0e12, do: "#{Float.round(b / 1.0e12, 1)} TB"
  defp bytes(b) when b >= 1.0e9, do: "#{Float.round(b / 1.0e9, 1)} GB"
  defp bytes(b) when b >= 1.0e6, do: "#{Float.round(b / 1.0e6, 1)} MB"
  defp bytes(b), do: "#{round(b / 1000)} kB"

  defp css do
    """
    .budget .btrack{position:relative;height:14px;border-radius:999px;background:var(--raised2);overflow:hidden}
    .btrack i{position:absolute;inset:0 auto 0 0;border-radius:999px}
    .btrack .spent{background:var(--c)}
    .btrack .proj{background:repeating-linear-gradient(90deg,var(--c) 0 6px,transparent 6px 10px);opacity:.45}
    .btrack .mark{position:absolute;top:0;bottom:0;width:2px;background:var(--sun)}
    .btrack.good{--c:var(--teal)}.btrack.warn{--c:var(--sun)}.btrack.bad{--c:var(--danger)}
    .blegend{display:flex;gap:16px;flex-wrap:wrap;font-size:12.5px;color:var(--fg2)}
    .blegend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px}
    .k-spent{background:var(--teal)}.k-proj{background:rgba(61,214,195,.4)}.k-mark{background:var(--sun)}
    .kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
    @media (max-width:1000px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
    .kpi{background:var(--ink);border:1px solid var(--line);border-radius:16px;padding:14px;display:flex;flex-direction:column;gap:6px;min-width:0}
    .kpi span{font-size:11.5px;color:var(--muted);font-weight:700;letter-spacing:.06em;text-transform:uppercase}
    .kpi b{font:700 26px/1 var(--mono);letter-spacing:-.5px}
    .kpi small{font-size:12px;color:var(--muted)}
    .up{color:var(--danger)}.down{color:var(--teal)}
    .cols{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:14px}
    @media (max-width:1000px){.cols{grid-template-columns:1fr}}
    .vend{display:flex;flex-direction:column;gap:10px}
    .vrow{display:grid;grid-template-columns:minmax(0,230px) minmax(0,1fr) 84px 72px;gap:10px;align-items:center;font-size:13px}
    .vrow .nm{display:flex;align-items:center;gap:8px;font-weight:600;min-width:0;white-space:nowrap;overflow:hidden}
    .vrow .nm>span:not(.pill){overflow:hidden;text-overflow:ellipsis}
    .vrow .nm>i{width:10px;height:10px;border-radius:3px;flex:none}
    .vrow .bar2{height:8px;border-radius:4px;background:var(--raised2);overflow:hidden}
    .vrow .bar2 i{display:block;height:100%;border-radius:4px}
    .vrow .amt,.vsub .amt{text-align:right;font:600 13px/1 var(--mono)}
    .vrow .dl,.vsub .dl{text-align:right;font:500 12px/1 var(--mono);color:var(--muted)}
    .vrow .dl.up,.vsub .dl.up{color:var(--danger)}.vrow .dl.down,.vsub .dl.down{color:var(--teal)}
    .vrow.tot{border-top:1px solid var(--line);padding-top:10px}.vrow.tot .amt{font-weight:800}
    .vsub{display:grid;grid-template-columns:minmax(0,1fr) 84px 72px;gap:10px;font-size:12px;color:var(--muted);padding-left:18px;margin-top:-4px}
    @media (max-width:560px){.vrow{grid-template-columns:minmax(0,1fr) 78px 62px}.vrow .bar2{display:none}.vsub{grid-template-columns:minmax(0,1fr) 78px 62px}}
    .pill{display:inline-block;font:600 10.5px/1 var(--display);padding:4px 7px;border-radius:999px;background:var(--raised2);color:var(--fg2);white-space:nowrap}
    .pill.api{background:rgba(155,123,255,.16);color:var(--violet)}.pill.warn{background:rgba(255,201,60,.14);color:var(--sun)}
    .pill.bad{background:rgba(255,77,109,.14);color:var(--danger)}.pill.good{background:rgba(61,214,195,.12);color:var(--teal)}
    .chart svg{width:100%;max-width:560px;height:auto;display:block;margin:0 auto}
    .chart svg text{fill:var(--muted);font:11px var(--mono)}.chart svg text.hl{fill:var(--fg)}
    .chart svg .gl{stroke:var(--line)}.chart svg .pl{fill:none;stroke:var(--teal);stroke-width:2}.chart svg .dot{fill:var(--teal)}
    .legend{display:flex;flex-wrap:wrap;gap:12px;font-size:12px;color:var(--muted)}
    .sw{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px}
    tr.subrow td{color:var(--muted);font-size:12.5px;padding-left:24px}tr.ended td{opacity:.5}
    .tbl table{min-width:560px}.tbl table.narrow{min-width:420px}
    form.add,form.settings{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;align-items:end;margin:4px 0}
    form.add label,form.settings label{display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--muted);font-weight:600}
    form.add input,form.add select,form.settings input{width:100%}
    details.card>summary{color:var(--fg)}
    details.card>summary h2{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0}
    details.card>summary h2::before{content:"▸";color:var(--muted);font-size:12px}
    details.card[open]>summary h2::before{content:"▾"}
    td details>summary{font-size:12.5px}
    .runway{background:var(--raised);border-radius:12px;padding:10px 12px;font-size:13px}.runway.bad{background:rgba(255,77,109,.12)}
    .runway b{color:var(--sun)}abbr{text-decoration:underline dotted;cursor:help}
    .note ol{margin:6px 0 0;padding-left:20px;display:flex;flex-direction:column;gap:4px}
    .note.warn ol{color:var(--fg2)}
    """
  end
end
