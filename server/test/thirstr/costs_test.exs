defmodule Thirstr.CostsTest do
  use Thirstr.DataCase, async: false
  import Swoosh.TestAssertions
  alias Thirstr.{Costs, Repo}

  @today ~D[2026-11-21]
  @prices Costs.defaults()["fly_prices"]

  defp fly_day!(day, app, cents, machines \\ []),
    do:
      Repo.query!(
        "INSERT INTO cost_fly_daily (day, app, rate_cents_month, detail) VALUES ($1, $2, $3, $4)",
        [day, app, cents, %{"machines" => machines, "volumes" => [%{"size_gb" => 10}]}]
      )

  defp usage!(day, dau, mau, bytes \\ 400_000_000),
    do: Repo.query!("INSERT INTO usage_daily VALUES ($1, $2, $3, $4)", [day, dau, mau, bytes])

  defp item!(vendor, cents, cadence, start, finish \\ nil) do
    {:ok, id} =
      Costs.add_item(%{
        vendor: vendor,
        amount_cents: cents,
        cadence: cadence,
        start_month: start,
        end_month: finish
      })

    id
  end

  test "Fly rate: started machines only, shared vs performance, extra RAM, volumes" do
    machines = [
      %{
        "state" => "started",
        "config" => %{"guest" => %{"cpu_kind" => "shared", "cpus" => 1, "memory_mb" => 512}}
      },
      %{
        "state" => "stopped",
        "config" => %{"guest" => %{"cpu_kind" => "shared", "cpus" => 1, "memory_mb" => 512}}
      },
      %{
        "state" => "started",
        "config" => %{"guest" => %{"cpu_kind" => "performance", "cpus" => 1, "memory_mb" => 2048}}
      }
    ]

    {usd, detail} = Costs.app_rate(machines, [%{"size_gb" => 10}], @prices)
    assert_in_delta usd, 1.94 + 1.25 + 31.0 + 1.5, 0.001
    assert length(detail["machines"]) == 3
    refute inspect(detail) =~ "id"
  end

  test "cadence rules: monthly, yearly ÷ 12, once in its month, ended items" do
    item!("Tigris", 460, "monthly", "2026-09")
    item!("Apple", 9900, "yearly", "2026-11")
    item!("Google Play", 2300, "once", "2026-09")
    item!("Old", 1000, "monthly", "2026-01", "2026-10")

    vendors = fn m -> Costs.month(m, @today).vendors |> Map.new(&{&1.vendor, &1.cents}) end

    assert vendors.(~D[2026-11-01]) == %{"Tigris" => 460, "Apple" => 825}
    assert vendors.(~D[2026-10-01]) == %{"Tigris" => 460, "Old" => 1000}
    assert vendors.(~D[2026-09-01]) == %{"Tigris" => 460, "Google Play" => 2300, "Old" => 1000}
  end

  # AC-AD.5: total = manual items + Fly month to date (+ projection for the current month)
  test "month total adds Fly API days and projects the rest of the month" do
    item!("SES", 225, "monthly", "2026-11")
    Costs.put_setting("usd_eur", 1.0)

    for d <- 1..21, do: fly_day!(Date.new!(2026, 11, d), "thirstr-api-prod", 3000)

    s = Costs.month(@today, @today)
    [fly] = Enum.filter(s.vendors, &(&1.vendor == "Fly.io"))
    assert fly.mtd == 2100
    assert fly.cents == 3000
    assert s.total == 3225
    assert s.mtd == 2100 + round(225 * 21 / 30)

    # past month: only recorded days count, no projection
    fly_day!(~D[2026-10-31], "thirstr-api-prod", 3100)
    assert Costs.month(~D[2026-10-01], @today).total == 100
  end

  test "cost per MAU uses the month's last usage row" do
    item!("SES", 1000, "monthly", "2026-11")
    usage!(~D[2026-11-20], 40, 100)
    s = Costs.month(@today, @today)
    assert s.mau == 100
    assert s.per_mau == 10
  end

  test "usage snapshot counts accounts, never stores ids" do
    assert :ok = Costs.snapshot_usage(@today)
    [[cols]] = Repo.query!("SELECT row_to_json(u)::text FROM usage_daily u").rows
    assert cols =~ "mau"
    refute cols =~ "account"
  end

  # AC-AD.6: once at 80 %, once at 100 %, not again the same month
  test "budget alert emails once per threshold per month" do
    Costs.put_setting("budget_eur", 100)
    Costs.put_setting("alert_email", "owner@example.test")
    assert Costs.check_alerts(@today) == []

    item!("Fly", 8500, "monthly", "2026-11")
    assert Costs.check_alerts(@today) == [80]
    assert_email_sent(fn e -> assert e.subject =~ "€85.00 of €100.00 budget (85 %)" end)
    assert Costs.check_alerts(@today) == []

    item!("Extra", 2000, "monthly", "2026-11")
    assert Costs.check_alerts(@today) == [100]
    assert Costs.check_alerts(@today) == []
    assert Costs.check_alerts(~D[2026-12-02]) == [80, 100]
  end

  test "budget 0 means no alerts" do
    item!("Fly", 999_999, "monthly", "2026-11")
    assert Costs.check_alerts(@today) == []
    assert_no_email_sent()
  end

  test "forecast: machines needed, runway from the first limit, milestones" do
    Costs.put_setting("usd_eur", 1.0)
    started = %{"state" => "started", "cpu_kind" => "shared", "cpus" => 1, "memory_mb" => 512}
    fly_day!(@today, "thirstr-api-prod", 640, [started, started])
    fly_day!(@today, "thirstr-db-prod", 1000)
    usage!(Date.add(@today, -30), 20, 100)
    usage!(@today, 40, 200, 200 * 2_000_000)

    f = Costs.forecast(@today)
    assert_in_delta f.inputs.growth, 1.0, 0.001
    assert f.inputs.running == 2
    assert f.inputs.dau_ratio == 0.2

    # API: 2 × 500 / (2 × 0.1 × 0.2) = 25 000 MAU; DB: 10 GB × 0.8 / 2 MB = 4 000 MAU → DB first
    assert f.limits == %{api: 25_000, db: 4000}
    assert f.runway.by == :db
    assert_in_delta f.runway.months, :math.log(20) / :math.log(2), 0.01

    m100k = Enum.find(f.rows, &(&1.label == {:mau, 100_000}))
    assert m100k.peak == 2000
    assert m100k.machines == 8
    assert m100k.cost == 8 * 320 + 1000
  end

  test "Fly snapshot without a token does nothing" do
    assert {:error, :no_token} = Costs.snapshot_fly(@today)
  end

  # R-AD.18 (#326): SES counted per recipient, Tigris from bucket size, presets once
  test "SES recipients counted from Swoosh telemetry only when metering is on" do
    email = %Swoosh.Email{
      to: [{"", "a@x.test"}, {"", "b@x.test"}],
      cc: [],
      bcc: [{"", "c@x.test"}]
    }

    Costs.handle_mail_event([:swoosh, :deliver, :stop], %{}, %{email: email}, nil)
    assert Repo.query!("SELECT count(*) FROM cost_metered_daily").rows == [[0]]

    Application.put_env(:thirstr, :meter_ses, true)
    on_exit(fn -> Application.delete_env(:thirstr, :meter_ses) end)
    Costs.handle_mail_event([:swoosh, :deliver, :stop], %{}, %{email: email}, nil)
    Costs.handle_mail_event([:swoosh, :deliver, :stop], %{}, %{email: email, error: :x}, nil)
    Costs.handle_mail_event([:swoosh, :deliver_many, :stop], %{}, %{emails: [email, email]}, nil)

    assert [[9]] =
             Repo.query!("SELECT units FROM cost_metered_daily WHERE vendor = 'Amazon SES'").rows
  end

  test "SES month: count × list price, projected over the month" do
    Costs.put_setting("usd_eur", 1.0)
    Costs.count_sent(21_000, ~D[2026-11-10])
    [ses] = Costs.month(@today, @today).vendors
    assert ses.vendor == "Amazon SES"
    # 21 000 emails × $0.10 / 1000 = $2.10 so far, day 21 of 30 → $3.00
    assert ses.mtd == 210
    assert ses.cents == 300
    assert Costs.month(~D[2026-10-01], @today).vendors == []
  end

  test "Tigris run-rate from bucket bytes; a typed-in item replaces the estimate" do
    Costs.put_setting("usd_eur", 1.0)
    Application.put_env(:thirstr, :fake_bucket_bytes, 50_000_000_000)
    on_exit(fn -> Application.delete_env(:thirstr, :fake_bucket_bytes) end)
    for d <- 1..21, do: :ok = Costs.snapshot_storage(Date.new!(2026, 11, d))

    [t] = Costs.month(@today, @today).vendors
    # 50 GB × $0.02 = $1.00 per 30 days
    assert {t.vendor, t.cents, t.mtd} == {"Tigris", 100, 70}
    assert t.units =~ "50.0 GB"

    item!("Tigris", 460, "monthly", "2026-11")
    assert [%{source: "monthly", cents: 460}] = Costs.month(@today, @today).vendors
  end

  test "presets added once, never again after an edit or removal" do
    assert :ok = Costs.seed_presets(@today)

    assert Enum.map(Costs.items(), & &1.vendor) |> Enum.sort() ==
             ["Apple Developer", "Domain thirstr.fun", "Google Play"]

    Repo.query!("DELETE FROM cost_items WHERE vendor = 'Google Play'")
    assert :ok = Costs.seed_presets(@today)
    assert length(Costs.items()) == 2
  end

  test "euro format" do
    assert Costs.eur(123_456) == "€1 234.56"
    assert Costs.eur(5) == "€0.05"
  end
end
