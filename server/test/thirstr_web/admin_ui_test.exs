defmodule ThirstrWeb.AdminUITest do
  use ThirstrWeb.ConnCase, async: false

  # R-AD.17 console v3 shell (admin-console.md)
  setup %{conn: conn} do
    a = onboarded(conn, basics: [display_name: "Jean Yves"])
    bad = onboarded(conn, basics: [display_name: "Marco"])
    admin = account_of(a.pid).id
    Application.put_env(:thirstr, :admin_account_ids, [admin])
    on_exit(fn -> Application.put_env(:thirstr, :admin_account_ids, []) end)
    {:ok, c: build_conn() |> get("/admin/dev_login?account_id=#{admin}"), a: a, bad: bad}
  end

  test "rail groups, active link, live red count, env badge, session corner", %{
    c: c,
    a: a,
    bad: bad
  } do
    a.c
    |> recycle_authed()
    |> post("/v1/reports", %{profile_id: bad.pid, reason: "underage"})
    |> json_response(201)

    Thirstr.Repo.query!("UPDATE reports SET created_at = now() - interval '2 hours'")
    html = c |> recycle() |> get("/admin") |> html_response(200)

    for g <- ~w(Moderation Members Platform You), do: assert(html =~ "<h4>#{g}</h4>")
    assert html =~ ~s(class="nav on" href="/admin" aria-current="page")
    assert html =~ ~s(<span class="n hot">1</span>)
    assert html =~ ~s(<span class="env dev">DEV</span>)
    assert html =~ "<b>Jean Yves</b>" and html =~ ~s(<div class="av">JY</div>)
    assert html =~ "1 past target"
    assert html =~ ~s(data-href="/admin/reports/)

    costs = c |> recycle() |> get("/admin/costs") |> html_response(200)
    assert costs =~ ~s(class="nav on" href="/admin/costs")
    assert costs =~ "Nothing to show yet."
    refute costs =~ "onchange"
    refute costs =~ "toolsCsrf"
  end

  test "empty queue says all clear; tier filter", %{c: c} do
    html = c |> recycle() |> get("/admin?tier=0") |> html_response(200)
    assert html =~ "All clear"
  end

  test "fonts are served same-origin, unknown files 404", %{c: c} do
    r = c |> recycle() |> get("/admin/assets/bricolage-800.woff2")
    assert r.status == 200
    assert get_resp_header(r, "content-type") |> hd() =~ "font/woff2"
    assert c |> recycle() |> get("/admin/assets/../../mix.exs") |> response(404)
  end

  test "login page is a centred card without the rail" do
    html = build_conn() |> get("/admin/login") |> html_response(200)
    assert html =~ ~s(<main class="solo">)
    refute html =~ "<h4>Moderation</h4>"
  end
end
