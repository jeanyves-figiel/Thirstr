defmodule Thirstr.Costs do
  @moduledoc """
  EN-21 (#180), admin-console.md A-11: monthly cost per vendor, cost per MAU, budget alert
  email, capacity forecast. No vendor, no spend: Fly from the Machines API with a read-only
  token (`FLY_COST_TOKEN`, R-AD.13), everything else typed in as cost items.

  Money is integer cents. Manual items are EUR; Fly rates are USD and converted with `usd_eur`.
  Only aggregates are stored or shown (AC-AD.7).
  """
  require Logger
  alias Thirstr.Repo

  @cadences ~w(once monthly yearly)
  @thresholds [80, 100]

  @defaults %{
    "budget_eur" => 0,
    "alert_email" => nil,
    "usd_eur" => 0.92,
    # USD per 30 days, list prices late 2026 (estimate, R-AD.13)
    "fly_prices" => %{
      "shared_cpu" => 1.94,
      "performance_cpu" => 31.0,
      "ram_gb" => 5.0,
      "volume_gb" => 0.15
    },
    # Capacity inputs (R-AD.15, SR-12 #152)
    "cap_per_machine" => 500,
    "cap_measured_on" => nil,
    "peak_ratio" => 0.10,
    "headroom" => 2,
    "growth_override" => nil
  }

  def cadences, do: @cadences
  def defaults, do: @defaults

  # ------------------------------------------------------------------ settings

  def settings do
    stored =
      q("SELECT key, value FROM cost_settings", [])
      |> Map.new(fn [k, v] -> {k, v["v"]} end)

    Map.merge(@defaults, stored, fn
      "fly_prices", d, s when is_map(s) -> Map.merge(d, s)
      _, d, nil -> d
      _, _, s -> s
    end)
    |> Map.update!("alert_email", &(&1 || default_alert_email()))
  end

  def put_setting(key, value) when is_map_key(@defaults, key) do
    q(
      "INSERT INTO cost_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
      [key, %{"v" => value}]
    )

    :ok
  end

  defp default_alert_email,
    do: Application.get_env(:thirstr, :cost_alert_email) || "hello@thirstr.fun"

  # ------------------------------------------------------------------ cost items

  def items do
    q(
      "SELECT id, vendor, label, amount_cents, cadence, start_month, end_month, note FROM cost_items ORDER BY end_month NULLS FIRST, vendor, start_month",
      []
    )
    |> Enum.map(fn [id, v, l, a, c, s, e, n] ->
      %{
        id: id,
        vendor: v,
        label: l,
        amount_cents: a,
        cadence: c,
        start_month: s,
        end_month: e,
        note: n
      }
    end)
  end

  def add_item(%{vendor: v, amount_cents: a, cadence: c, start_month: s} = i)
      when is_binary(v) and v != "" and is_integer(a) and a >= 0 and c in @cadences do
    [[id]] =
      q(
        "INSERT INTO cost_items (vendor, label, amount_cents, cadence, start_month, end_month, note) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
        [
          String.slice(v, 0, 60),
          i[:label],
          a,
          c,
          to_month(s),
          i[:end_month] && to_month(i.end_month),
          i[:note]
        ]
      )

    {:ok, id}
  end

  def add_item(_), do: {:error, :invalid}

  def update_item(id, %{vendor: v, amount_cents: a, cadence: c, start_month: s} = i)
      when is_binary(v) and v != "" and is_integer(a) and a >= 0 and c in @cadences do
    q(
      "UPDATE cost_items SET vendor = $2, label = $3, amount_cents = $4, cadence = $5, start_month = $6, end_month = $7, note = $8 WHERE id = $1",
      [
        id,
        String.slice(v, 0, 60),
        i[:label],
        a,
        c,
        to_month(s),
        i[:end_month] && to_month(i.end_month),
        i[:note]
      ]
    )

    :ok
  end

  def update_item(_, _), do: {:error, :invalid}

  @doc "Ends an item after `last_month` (never deletes, so past months stay right)."
  def end_item(id, last_month) do
    q("UPDATE cost_items SET end_month = $2 WHERE id = $1", [id, to_month(last_month)])
    :ok
  end

  @doc "EUR cents an item adds to `m` (first of month). AC-AD.5 cadence rules."
  def item_cents(%{cadence: c, start_month: s, end_month: e, amount_cents: a}, m) do
    active = Date.compare(s, m) != :gt and (is_nil(e) or Date.compare(e, m) != :lt)

    cond do
      not active -> 0
      c == "monthly" -> a
      c == "yearly" -> round(a / 12)
      c == "once" and s == m -> a
      true -> 0
    end
  end

  # ------------------------------------------------------------------ Fly (Machines API)

  @doc "Daily: per-app run-rate from the Machines API. Returns :ok | {:error, reason}."
  def snapshot_fly(day \\ Date.utc_today()) do
    with token when is_binary(token) and token != "" <- fly_token(),
         {:ok, apps} <- fly_get("/v1/apps?org_slug=#{URI.encode_www_form(fly_org())}", token) do
      prices = settings()["fly_prices"]

      for %{"name" => app} <- apps["apps"] || [] do
        with {:ok, machines} <- fly_get("/v1/apps/#{URI.encode(app)}/machines", token),
             {:ok, volumes} <- fly_get("/v1/apps/#{URI.encode(app)}/volumes", token) do
          {usd, detail} = app_rate(machines, volumes, prices)

          q(
            "INSERT INTO cost_fly_daily (day, app, rate_cents_month, detail) VALUES ($1, $2, $3, $4) ON CONFLICT (day, app) DO UPDATE SET rate_cents_month = EXCLUDED.rate_cents_month, detail = EXCLUDED.detail",
            [day, app, round(usd * 100), detail]
          )
        end
      end

      :ok
    else
      {:error, r} ->
        Logger.warning("cost snapshot: Fly API failed (#{inspect(r)})")
        {:error, r}

      _ ->
        {:error, :no_token}
    end
  end

  @doc "USD per 30 days for one app: started machines + volumes (R-AD.13 price rules)."
  def app_rate(machines, volumes, prices) do
    ms =
      for m <- List.wrap(machines), g = get_in(m, ["config", "guest"]) || %{} do
        %{
          "cpu_kind" => g["cpu_kind"] || "shared",
          "cpus" => g["cpus"] || 1,
          "memory_mb" => g["memory_mb"] || 256,
          "state" => m["state"]
        }
      end

    vs = for v <- List.wrap(volumes), do: %{"size_gb" => v["size_gb"] || 0}

    machine_usd =
      ms
      |> Enum.filter(&(&1["state"] == "started"))
      |> Enum.map(&machine_usd(&1, prices))
      |> Enum.sum()

    volume_usd = vs |> Enum.map(&(&1["size_gb"] * prices["volume_gb"])) |> Enum.sum()

    {machine_usd + volume_usd, %{"machines" => ms, "volumes" => vs}}
  end

  defp machine_usd(%{"cpu_kind" => "performance", "cpus" => c, "memory_mb" => mb}, p),
    do: c * p["performance_cpu"] + max(0, mb - c * 2048) / 1024 * p["ram_gb"]

  defp machine_usd(%{"cpus" => c, "memory_mb" => mb}, p),
    do: c * p["shared_cpu"] + max(0, mb - c * 256) / 1024 * p["ram_gb"]

  defp fly_token, do: Application.get_env(:thirstr, :fly_cost_token)
  defp fly_org, do: Application.get_env(:thirstr, :fly_org, "thirstr")
  def fly_configured?, do: fly_token() not in [nil, ""]

  defp fly_get(path, token) do
    base = Application.get_env(:thirstr, :fly_api_url, "https://api.machines.dev")

    case Req.get(base <> path,
           auth: {:bearer, token},
           retry: :transient,
           max_retries: 2,
           receive_timeout: 15_000
         ) do
      {:ok, %{status: 200, body: b}} -> {:ok, b}
      {:ok, %{status: s}} -> {:error, {:http, s}}
      {:error, e} -> {:error, e}
    end
  end

  # ------------------------------------------------------------------ usage (MAU)

  @doc "Daily: DAU, MAU (devices seen in 30 days) and DB size. Counts only."
  def snapshot_usage(day \\ Date.utc_today()) do
    q(
      """
      INSERT INTO usage_daily (day, dau, mau, db_bytes)
      SELECT $1::date,
             count(DISTINCT account_id) FILTER (WHERE last_seen_day >= $1::date),
             count(DISTINCT account_id) FILTER (WHERE last_seen_day > $1::date - 30),
             pg_database_size(current_database())
      FROM devices WHERE last_seen_day > $1::date - 30
      ON CONFLICT (day) DO UPDATE SET dau = EXCLUDED.dau, mau = EXCLUDED.mau, db_bytes = EXCLUDED.db_bytes
      """,
      [day]
    )

    :ok
  end

  # ------------------------------------------------------------------ month summary

  @doc """
  Summary of month `m` (any date in it) as of `today`: vendors with projected and month-to-date
  cents (EUR), total, Fly per app, MAU, cost per MAU.
  """
  def month(m, today \\ Date.utc_today())

  def month(%Date{} = m, today) do
    m = Date.beginning_of_month(m)
    dim = Date.days_in_month(m)
    current? = m == Date.beginning_of_month(today)
    elapsed = if current?, do: today.day, else: dim
    s = settings()
    fx = s["usd_eur"]

    manual =
      items()
      |> Enum.map(&{&1, item_cents(&1, m)})
      |> Enum.filter(fn {_, c} -> c > 0 end)
      |> Enum.group_by(fn {i, _} -> i.vendor end)
      |> Enum.map(fn {v, list} ->
        cents = list |> Enum.map(&elem(&1, 1)) |> Enum.sum()
        sources = list |> Enum.map(fn {i, _} -> i.cadence end) |> Enum.uniq()

        %{
          vendor: v,
          source: Enum.join(sources, "+"),
          cents: cents,
          mtd: round(cents * elapsed / dim)
        }
      end)

    fly_rows =
      q(
        "SELECT app, sum(rate_cents_month), count(*), (array_agg(rate_cents_month ORDER BY day DESC))[1], (array_agg(detail ORDER BY day DESC))[1], min(day) FROM cost_fly_daily WHERE day >= $1 AND day < $2 GROUP BY app ORDER BY app",
        [m, Date.add(m, dim)]
      )

    fly_apps =
      Enum.map(fly_rows, fn [app, sum, n, latest, detail, first] ->
        # Each recorded day costs rate/dim; days missed since the first row (job down) are
        # filled with the latest rate; the rest of the current month is projected.
        missed = max(0, elapsed - first.day + 1 - n)
        mtd_usd = (to_int(sum) + missed * latest) / dim
        proj_usd = mtd_usd + (dim - elapsed) * latest / dim

        %{
          app: app,
          detail: detail,
          rate: round(latest * fx),
          mtd: round(mtd_usd * fx),
          cents: round(proj_usd * fx)
        }
      end)

    fly =
      if fly_apps == [],
        do: [],
        else: [
          %{
            vendor: "Fly.io",
            source: "fly_api",
            cents: sum(fly_apps, :cents),
            mtd: sum(fly_apps, :mtd),
            apps: fly_apps
          }
        ]

    vendors = Enum.sort_by(fly ++ manual, & &1.cents, :desc)
    usage = usage_at(Date.add(m, dim - 1))
    total = sum(vendors, :cents)

    %{
      month: m,
      days: dim,
      elapsed: elapsed,
      current: current?,
      vendors: vendors,
      total: total,
      mtd: sum(vendors, :mtd),
      mau: usage && usage.mau,
      dau: usage && usage.dau,
      per_mau: usage && usage.mau > 0 && round(total / usage.mau)
    }
  end

  defp sum(list, k), do: list |> Enum.map(&Map.get(&1, k, 0)) |> Enum.sum()
  defp to_int(%Decimal{} = d), do: Decimal.to_integer(d)
  defp to_int(n) when is_integer(n), do: n
  defp to_int(nil), do: 0

  @doc "Latest usage row on or before `day`."
  def usage_at(day) do
    case q(
           "SELECT day, dau, mau, db_bytes FROM usage_daily WHERE day <= $1 ORDER BY day DESC LIMIT 1",
           [day]
         ) do
      [[d, dau, mau, b]] -> %{day: d, dau: dau, mau: mau, db_bytes: b}
      _ -> nil
    end
  end

  @doc "Last `n` months, oldest first."
  def history(n \\ 6, today \\ Date.utc_today()) do
    m = Date.beginning_of_month(today)
    for i <- (n - 1)..0//-1, do: month(Date.shift(m, month: -i), today)
  end

  # ------------------------------------------------------------------ capacity forecast (R-AD.15)

  @milestones [10_000, 100_000, 1_000_000]

  def forecast(today \\ Date.utc_today()) do
    i = forecast_inputs(today)
    mau = i.mau

    future =
      for n <- [3, 6, 12], mau > 0 do
        forecast_row(
          i,
          {:months, n, Date.shift(today, month: n)},
          mau * :math.pow(1 + i.growth, n)
        )
      end

    limit_api = i.running && i.running * i.cap / (i.headroom * i.peak_ratio * i.dau_ratio)
    limit_db = i.volume_gb && i.bytes_per_mau && i.volume_gb * 1.0e9 * 0.8 / i.bytes_per_mau

    %{
      now: if(mau > 0, do: forecast_row(i, :now, mau)),
      rows: future ++ Enum.map(@milestones, &forecast_row(i, {:mau, &1}, &1)),
      runway: runway(i, today, [{limit_api, :api}, {limit_db, :db}]),
      limits: %{api: limit_api && round(limit_api), db: limit_db && round(limit_db)},
      inputs: Map.drop(i, [:per_machine, :fly_other, :fixed, :variable, :fx])
    }
  end

  defp forecast_inputs(today) do
    s = settings()
    now = usage_at(today)
    mau = (now && now.mau) || 0
    {growth, growth_src} = growth(today, s)
    api_app = fly_app(:api)
    fly = latest_fly(today)
    running = fly[api_app] && started(fly[api_app])
    db = fly[fly_app(:db)]

    %{
      mau: mau,
      growth: growth,
      growth_src: growth_src,
      dau_ratio: dau_ratio(today, mau),
      peak_ratio: s["peak_ratio"],
      cap: s["cap_per_machine"],
      cap_measured_on: s["cap_measured_on"],
      headroom: s["headroom"],
      bytes_per_mau: if(now && mau > 0, do: now.db_bytes / mau),
      running: running,
      volume_gb: db && (db.detail["volumes"] || []) |> Enum.map(& &1["size_gb"]) |> Enum.sum(),
      # cents/month (USD for Fly, EUR for items)
      per_machine: if(running && running > 0, do: fly[api_app].rate / running),
      fly_other: fly |> Map.drop([api_app]) |> Map.values() |> Enum.map(& &1.rate) |> Enum.sum(),
      fixed: items_cents(today, &(&1.cadence != "monthly")),
      variable: items_cents(today, &(&1.cadence == "monthly")),
      fx: s["usd_eur"]
    }
  end

  defp forecast_row(i, label, m) do
    dau = m * i.dau_ratio
    peak = dau * i.peak_ratio
    machines = max(1, ceil(peak * i.headroom / i.cap))
    scale = if i.mau > 0, do: max(1.0, m / i.mau), else: 1.0

    cost =
      if i.per_machine,
        do: round((machines * i.per_machine + i.fly_other) * i.fx + i.fixed + i.variable * scale)

    %{
      label: label,
      mau: round(m),
      dau: round(dau),
      peak: round(peak),
      machines: machines,
      db_bytes: i.bytes_per_mau && round(i.bytes_per_mau * m),
      cost: cost
    }
  end

  # First limit hit (API machines or 80 % of the DB volume) and when, at the current growth.
  defp runway(%{mau: mau, growth: g}, today, limits) do
    case limits
         |> Enum.reject(fn {v, _} -> is_nil(v) end)
         |> Enum.min_by(&elem(&1, 0), fn -> nil end) do
      nil ->
        nil

      _ when mau == 0 ->
        nil

      {limit, by} when limit <= mau ->
        %{mau: round(limit), by: by, months: 0, date: today}

      {limit, by} when g <= 0 ->
        %{mau: round(limit), by: by, months: nil, date: nil}

      {limit, by} ->
        months = :math.log(limit / mau) / :math.log(1 + g)
        %{mau: round(limit), by: by, months: months, date: Date.add(today, round(months * 30.4))}
    end
  end

  # Monthly growth: manual override, else measured over the last 30 days (≥ 14 days of data).
  defp growth(today, s) do
    case s["growth_override"] do
      g when is_number(g) ->
        {g / 100, :manual}

      _ ->
        now = usage_at(today)

        old =
          case q(
                 "SELECT day, mau FROM usage_daily WHERE day >= $1 AND mau > 0 ORDER BY day LIMIT 1",
                 [Date.add(today, -30)]
               ) do
            [[d, m]] -> {d, m}
            _ -> nil
          end

        with %{mau: m1, day: d1} when m1 > 0 <- now,
             {d0, m0} <- old,
             span when span >= 14 <- Date.diff(d1, d0) do
          {:math.pow(m1 / m0, 30 / span) - 1, :measured}
        else
          _ -> {0.0, :none}
        end
    end
  end

  defp dau_ratio(today, mau) do
    case q("SELECT avg(dau)::float FROM usage_daily WHERE day > $1", [Date.add(today, -7)]) do
      [[avg]] when is_number(avg) and mau > 0 and avg > 0 -> min(1.0, avg / mau)
      _ -> 0.4
    end
  end

  defp fly_app(:api), do: Application.get_env(:thirstr, :fly_api_app, "thirstr-api-prod")
  defp fly_app(:db), do: Application.get_env(:thirstr, :fly_db_app, "thirstr-db-prod")

  defp latest_fly(today) do
    q(
      "SELECT DISTINCT ON (app) app, rate_cents_month, detail FROM cost_fly_daily WHERE day <= $1 ORDER BY app, day DESC",
      [today]
    )
    |> Map.new(fn [app, r, d] -> {app, %{rate: r, detail: d}} end)
  end

  defp started(%{detail: d}),
    do: (d["machines"] || []) |> Enum.count(&(&1["state"] == "started"))

  # Yearly and one-off items stay fixed whatever the MAU; monthly items scale with MAU.
  defp items_cents(today, filter) do
    m = Date.beginning_of_month(today)
    items() |> Enum.filter(filter) |> Enum.map(&item_cents(&1, m)) |> Enum.sum()
  end

  # ------------------------------------------------------------------ budget alert (R-AD.14)

  @doc "Sends at most one email per threshold per month. Returns the thresholds sent."
  def check_alerts(today \\ Date.utc_today()) do
    s = settings()
    budget = s["budget_eur"]

    if is_number(budget) and budget > 0 do
      sum = month(today, today)
      pct = sum.total / (budget * 100) * 100

      for t <- @thresholds, pct >= t, claim_alert(sum.month, t) do
        send_alert(s["alert_email"], sum, budget, pct)
        t
      end
    else
      []
    end
  end

  defp claim_alert(m, t) do
    match?(
      [[_]],
      q(
        "INSERT INTO cost_alerts (month, threshold) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING threshold",
        [m, t]
      )
    )
  end

  def alert_text(sum, budget, pct) do
    top =
      sum.vendors
      |> Enum.take(3)
      |> Enum.map_join(" · ", &"#{&1.vendor} #{eur(&1.cents)}")

    per = if sum.per_mau, do: "#{eur(sum.per_mau)} (#{sum.mau} MAU)", else: "– (no MAU yet)"

    subject =
      "Thirstr costs: #{eur(sum.total)} of #{eur(round(budget * 100))} budget (#{round(pct)} %)"

    body = """
    Projected month-end: #{eur(sum.total)} (so far #{eur(sum.mtd)}, day #{sum.elapsed} of #{sum.days})
    Top vendors: #{top}
    Cost per MAU: #{per}

    #{Application.get_env(:thirstr, :app_url, "https://api.thirstr.fun")}/admin/costs
    You get one email at 80 % and one at 100 % each month.
    """

    {subject, body}
  end

  defp send_alert(to, sum, budget, pct) do
    import Swoosh.Email
    {subject, body} = alert_text(sum, budget, pct)

    new()
    |> to(to)
    |> from({"Thirstr", Application.get_env(:thirstr, :mail_from, "hello@thirstr.fun")})
    |> subject(subject)
    |> text_body(body)
    |> Thirstr.Mailer.deliver()
    |> case do
      {:ok, _} -> :ok
      {:error, e} -> Logger.warning("cost alert email failed: #{inspect(e)}")
    end
  end

  # ------------------------------------------------------------------ helpers

  def eur(nil), do: "–"

  def eur(cents) when is_integer(cents) do
    sign = if cents < 0, do: "−", else: ""
    c = abs(cents)
    euros = c |> div(100) |> Integer.to_string() |> group()
    "#{sign}€#{euros}.#{c |> rem(100) |> Integer.to_string() |> String.pad_leading(2, "0")}"
  end

  defp group(s),
    do: s |> String.reverse() |> String.replace(~r/(\d{3})(?=\d)/, "\\1 ") |> String.reverse()

  def to_month(%Date{} = d), do: Date.beginning_of_month(d)

  def to_month(s) when is_binary(s) do
    case Date.from_iso8601(String.slice(s, 0, 7) <> "-01") do
      {:ok, d} -> d
      _ -> raise ArgumentError, "bad month #{inspect(s)}"
    end
  end

  # Every caller passes a literal SQL string; values go through params.
  # sobelow_skip ["SQL.Query"]
  defp q(sql, params), do: Repo.query!(sql, params).rows || []
end
