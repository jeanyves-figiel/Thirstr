defmodule ThirstrWeb.AdminHealthTest do
  # EN-23 OB-6 (#343): console Health page (A-12).
  use ThirstrWeb.ConnCase, async: false

  setup %{conn: conn} do
    a = onboarded(conn)
    admin = account_of(a.pid).id
    Application.put_env(:thirstr, :admin_account_ids, [admin])
    on_exit(fn -> Application.put_env(:thirstr, :admin_account_ids, []) end)
    {:ok, c: build_conn() |> get("/admin/dev_login?account_id=#{admin}")}
  end

  @tag ac: "EN-23 OB-6"
  test "without metrics: banner, probe result, no script", %{c: c} do
    Application.delete_env(:thirstr, :fly_cost_token)

    Thirstr.Health.put_probe(%{
      "ok" => false,
      "failed" => "socket",
      "steps" => %{"send" => 118}
    })

    html = c |> recycle() |> get("/admin/health") |> html_response(200)
    assert html =~ ~s(class="nav on" href="/admin/health")
    assert html =~ "Fly metrics not reachable"
    assert html =~ "Chat delivery degraded"
    assert html =~ "118 ms"
    assert html =~ "step socket failed"
    refute html =~ "<script"

    # other environment: probe shown on its own console only
    other = c |> recycle() |> get("/admin/health?env=staging&range=7d") |> html_response(200)
    assert other =~ "Shown on that environment"
  end

  test "needs an admin session", %{conn: conn} do
    assert conn |> get("/admin/health") |> response(302)
  end
end
