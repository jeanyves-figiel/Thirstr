defmodule ThirstrWeb.AdminCostsController do
  @moduledoc """
  A-11 Costs & capacity (admin-console.md, EN-21 #180). Owner-only like every console page;
  every view and change is audited (R-AD.4). Aggregates only (AC-AD.7). Chart is server-rendered
  SVG, no scripts.
  """
  use ThirstrWeb, :controller
  alias Thirstr.Costs
  import ThirstrWeb.AdminController, only: [audit: 4, page: 3, nav: 0, e: 1]

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
    #{nav()}
    <div class="head"><div><h1>Costs &amp; capacity</h1><div class="muted sm">#{source_line(sum, s)}</div></div>
    <form method="get" action="/admin/costs"><label class="sm muted">Month <select name="m" onchange="this.form.submit()">#{month_options(sel, today)}</select></label> <noscript><button>Show</button></noscript></form></div>
    #{budget(sum, s)}
    #{kpis(sum, prev)}
    <h2>By vendor</h2>#{vendor_table(sum, prev, color)}
    <div class="grid2"><div class="card"><h2>Last 6 months</h2>#{chart(hist, color)}</div>
    <div class="card"><h2>Cost items</h2>#{items(csrf, today)}</div></div>
    #{forecast(f, today)}
    #{settings_form(s, csrf, f)}
    """)
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
          "Fly token not set (runbook costs.md), Fly typed in"

        sum.vendors |> Enum.any?(&(&1[:source] == "fly_api")) ->
          "Fly from API, updated daily 02:10 UTC"

        true ->
          "Fly from API, no data yet this month"
      end

    "#{fly} · other vendors typed in · EUR, USD at #{s["usd_eur"]}"
  end

  defp month_options(sel, today) do
    m0 = Date.beginning_of_month(today)

    Enum.map_join(0..11, "", fn i ->
      m = Date.shift(m0, month: -i)
      v = String.slice(Date.to_iso8601(m), 0, 7)

      ~s|<option value="#{v}"#{if m == sel, do: " selected"}>#{Calendar.strftime(m, "%B %Y")}</option>|
    end)
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
      <div class="budget"><div class="brow"><span><b class="big">#{Costs.eur(sum.total)}</b> #{if sum.current, do: "projected month-end · <b>#{Costs.eur(sum.mtd)}</b> so far (#{sum.elapsed} of #{sum.days} days)", else: "month total"}</span>
      <span>Budget <b>#{Costs.eur(round(bc))}</b> · <span class="pill #{cls}">#{pct} %</span></span></div>
      <div class="bbar #{cls}" role="img" aria-label="#{mtd} percent spent, #{pct} percent projected, alert at 80 percent"><i class="proj" style="width:#{proj}%"></i><i class="mtd" style="width:#{mtd}%"></i><span class="tick" style="left:80%"></span></div>
      <div class="brow sm muted"><span>Solid: spent · striped: projected</span><span>Email alert at 80 % and 100 % → #{e(s["alert_email"])}</span></div></div>
      """
    else
      ~s|<div class="budget"><div class="brow"><span><b class="big">#{Costs.eur(sum.total)}</b> #{if sum.current, do: "projected month-end", else: "month total"}</span><span class="muted">No budget set, alerts off (Settings below)</span></div></div>|
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
    do:
      ~s|<p class="muted">Nothing yet. Add cost items below, or set the Fly token (runbook costs.md).</p>|

  defp vendor_table(sum, prev, color) do
    pv = Map.new(prev.vendors, &{&1.vendor, &1.cents})

    rows =
      Enum.map_join(sum.vendors, "", fn v ->
        last = Map.get(pv, v.vendor, 0)

        apps =
          for a <- v[:apps] || [] do
            prev_app =
              prev.vendors
              |> Enum.find_value([], & &1[:apps])
              |> Enum.find_value(0, &(&1.app == a.app && &1.cents))

            "<tr class=\"subrow\"><td>#{e(a.app)} · #{e(machines_txt(a.detail))}</td><td></td><td class=\"r\">#{Costs.eur(a.cents)}</td><td class=\"r\">#{Costs.eur(prev_app)}</td><td class=\"r #{chg_cls(a.cents - prev_app)}\">#{chg(a.cents - prev_app)}</td></tr>"
          end

        "<tr><td><span class=\"sw\" style=\"background:#{color.(v.vendor)}\"></span>#{e(v.vendor)}</td><td>#{source_pill(v.source)}</td><td class=\"r\">#{Costs.eur(v.cents)}</td><td class=\"r\">#{Costs.eur(last)}</td><td class=\"r #{chg_cls(v.cents - last)}\">#{chg(v.cents - last)}</td></tr>" <>
          Enum.join(apps)
      end)

    """
    <div class="tbl"><table><tr><th>Vendor</th><th>Source</th><th class="r">#{Calendar.strftime(sum.month, "%B")}</th><th class="r">#{Calendar.strftime(prev.month, "%B")}</th><th class="r">Change</th></tr>
    #{rows}<tr><td><b>Total</b></td><td></td><td class="r"><b>#{Costs.eur(sum.total)}</b></td><td class="r"><b>#{Costs.eur(prev.total)}</b></td><td class="r #{chg_cls(sum.total - prev.total)}"><b>#{chg(sum.total - prev.total)}</b></td></tr></table></div>
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
    #{if list == [], do: ~s|<p class="muted">No items yet. Typical: Tigris, Amazon SES (monthly), Apple Developer, domain (yearly), Google Play (once).</p>|, else: ~s|<div class="tbl"><table class="narrow"><tr><th>Vendor</th><th class="r">Amount</th><th>Every</th><th>Months</th><th></th></tr>#{rows}</table></div>|}
    <form method="post" action="/admin/costs/items" class="add">#{csrf}#{item_fields(%{cadence: "monthly", start_month: Date.beginning_of_month(today)}, "n")}<button class="primary">Add item</button></form>
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
    <section><div class="head"><h2>Capacity forecast</h2>#{badge}</div>#{runway}
    <div class="tbl"><table><tr><th>When</th><th class="r">MAU</th><th class="r">Peak online</th><th class="r">API machines</th><th class="r">DB size</th><th class="r">Monthly cost</th></tr>#{rows}</table></div>
    <div class="sm muted">Inputs: DAU = <abbr title="average DAU over 7 days ÷ MAU (0.4 until measured)">#{pct(i.dau_ratio)} of MAU</abbr> ·
    peak online = <abbr title="assumed, enterprise-readiness.md §4">#{pct(i.peak_ratio)} of DAU</abbr> ·
    <abbr title="#{if i.cap_measured_on, do: "SR-12 run #{e(i.cap_measured_on)}", else: "planning default, no SR-12 run yet"}">#{i.cap} users per API machine</abbr> × #{i.headroom} headroom ·
    <abbr title="pg_database_size ÷ MAU">#{bytes(i.bytes_per_mau && round(i.bytes_per_mau))} per MAU</abbr> ·
    cost: Fly API machine price × machines, other Fly fixed, monthly items × MAU, yearly and one-off fixed. As of #{Date.to_iso8601(today)}.</div></section>
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
    <section><h2>Settings</h2>
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
    <div class="sm muted">Fly prices are list prices per 30 days (estimate); stopped machines count €0.</div></section>
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
    .sm{font-size:13px}.big{font-size:20px}h1{margin:0}h2{margin:20px 0 8px}
    .head{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between}
    .budget{background:#1f1a3d;border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:8px;margin:16px 0}
    .brow{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px}
    .bbar{position:relative;height:12px;border-radius:6px;background:#2c2650;overflow:hidden}
    .bbar i{position:absolute;inset:0 auto 0 0;border-radius:6px}.bbar .mtd{background:var(--c)}
    .bbar .proj{background:repeating-linear-gradient(135deg,var(--c) 0 4px,transparent 4px 8px);opacity:.6}
    .bbar.good{--c:#58d68d}.bbar.warn{--c:#ffb547}.bbar.bad{--c:#ff5470}
    .bbar .tick{position:absolute;top:0;bottom:0;width:2px;background:#ffb547}
    .kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
    @media(max-width:700px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
    .kpi{background:#1f1a3d;border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:2px;min-width:0}
    .kpi b{font-size:24px;font-variant-numeric:tabular-nums}.kpi span{font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#9a93c0}.kpi small{color:#9a93c0;font-size:12px}
    .tbl{overflow-x:auto}.tbl table{min-width:560px}.tbl table.narrow{min-width:420px}
    th{font-size:12px;color:#9a93c0;font-weight:500;text-transform:uppercase;letter-spacing:.04em}
    .r{text-align:right;font-variant-numeric:tabular-nums}
    .pill{display:inline-block;font-size:11px;padding:1px 8px;border-radius:999px;border:1px solid #463e7a;color:#9a93c0;white-space:nowrap}
    .pill.api{border-color:#3dd6c6;color:#3dd6c6}.pill.warn{border-color:#ffb547;color:#ffb547}.pill.bad{border-color:#ff5470;color:#ff5470}.pill.good{border-color:#58d68d;color:#58d68d}
    .up{color:#ffb547}.down{color:#58d68d}
    .sw{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px}
    tr.subrow td{color:#9a93c0;font-size:13px;padding-left:24px}tr.ended td{opacity:.5}
    .grid2{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:16px;margin-top:8px}
    @media(max-width:820px){.grid2{grid-template-columns:minmax(0,1fr)}}
    .card h2{margin-top:0}svg text{fill:#9a93c0;font:11px system-ui,sans-serif}svg text.hl{fill:#f3f0ff}
    svg .gl{stroke:#2c2650}svg .pl{fill:none;stroke:#f3f0ff;stroke-width:2}svg .dot{fill:#f3f0ff}
    .legend{display:flex;flex-wrap:wrap;gap:12px;font-size:12px;color:#9a93c0}
    form.add,form.settings{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;align-items:end;margin:8px 0}
    form label{display:flex;flex-direction:column;gap:2px;font-size:12px;color:#9a93c0}
    form label input,form label select{width:100%;box-sizing:border-box}
    button.primary{background:#ff7a59;border-color:#ff7a59;color:#1a0f0b;font-weight:600}
    .runway{border:1px solid #463e7a;border-radius:12px;padding:12px;margin-bottom:8px}.runway.bad{border-color:#ff5470;background:#2b1a22}
    .runway b{color:#ffb547}abbr{text-decoration:underline dotted;cursor:help}
    summary{cursor:pointer;color:#ff7a59}
    """
  end
end
