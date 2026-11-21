defmodule ThirstrWeb.AdminCostsTest do
  use ThirstrWeb.ConnCase, async: false
  alias Thirstr.Repo

  # A-11 Costs & capacity (admin-console.md, EN-21 #180)
  setup %{conn: conn} do
    a = onboarded(conn, basics: [display_name: "Alice"])
    admin = account_of(a.pid).id
    Application.put_env(:thirstr, :admin_account_ids, [admin])
    on_exit(fn -> Application.put_env(:thirstr, :admin_account_ids, []) end)
    c = build_conn() |> get("/admin/dev_login?account_id=#{admin}")
    {:ok, c: c}
  end

  defp csrf(html), do: Regex.run(~r/name="_csrf_token" value="([^"]+)"/, html) |> List.last()

  defp audits(action) do
    [[n]] = Repo.query!("SELECT count(*) FROM admin_audit WHERE action = $1", [action]).rows
    n
  end

  test "needs an admin session" do
    assert build_conn() |> get("/admin/costs") |> redirected_to() == "/admin/login"
  end

  @tag ac: "AC-AD.7"
  test "empty page, add item, settings, Fly data, forecast; all audited, no personal data", %{
    c: c
  } do
    html = c |> recycle() |> get("/admin/costs") |> html_response(200)
    assert html =~ "Costs &amp; capacity"
    assert html =~ "Fly token not set"
    assert html =~ "No budget set"
    assert audits("view_costs") == 1
    t = csrf(html)
    m = String.slice(Date.to_iso8601(Date.utc_today()), 0, 7)

    c
    |> recycle()
    |> post("/admin/costs/items", %{
      _csrf_token: t,
      vendor: "Apple Developer",
      amount: "99",
      cadence: "yearly",
      start_month: m
    })
    |> redirected_to()

    assert c
           |> recycle()
           |> post("/admin/costs/items", %{_csrf_token: t, vendor: "", amount: "x"})
           |> response(422)

    assert c
           |> recycle()
           |> post("/admin/costs/settings", %{_csrf_token: t, budget_eur: "100"})
           |> response(422)

    c
    |> recycle()
    |> post("/admin/costs/settings", %{
      _csrf_token: t,
      budget_eur: "100",
      usd_eur: "1",
      alert_email: "owner@example.test",
      reason: "beta budget"
    })
    |> redirected_to()

    assert audits("cost_item_add") == 1
    assert audits("cost_settings") == 1

    today = Date.utc_today()
    started = %{"state" => "started", "cpu_kind" => "shared", "cpus" => 1, "memory_mb" => 512}

    Repo.query!("INSERT INTO cost_fly_daily VALUES ($1, 'thirstr-api-prod', 640, $2)", [
      today,
      %{"machines" => [started, started], "volumes" => []}
    ])

    Repo.query!("INSERT INTO usage_daily VALUES ($1, 4, 10, 20000000)", [today])

    html = c |> recycle() |> get("/admin/costs") |> html_response(200)
    assert html =~ "Apple Developer"
    assert html =~ "€8.25"
    assert html =~ "thirstr-api-prod · 2 × shared-cpu-1x 512 MB"
    assert html =~ "Budget <b>€100.00</b>"
    assert html =~ "Capacity forecast"
    assert html =~ "1M MAU"
    refute html =~ ~r/\b(cell_r\d|lat|lng|remote_ip|account_id)\b/i

    [[id]] = Repo.query!("SELECT id FROM cost_items").rows

    c
    |> recycle()
    |> post("/admin/costs/items/#{id}", %{_csrf_token: t, op: "end", end_month: m})
    |> redirected_to()

    assert [[%Date{}]] = Repo.query!("SELECT end_month FROM cost_items").rows
    assert audits("cost_item_end") == 1
  end
end
