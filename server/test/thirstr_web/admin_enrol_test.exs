defmodule ThirstrWeb.AdminEnrolTest do
  use ThirstrWeb.ConnCase, async: false
  alias ThirstrWeb.SoftAuthenticator, as: SA

  # admin-console.md R-AD.16 / AC-AD.8: one-time console passkey enrolment link.
  # Console origin = the request host (ConnTest: http://www.example.com), RP id unchanged.
  @origin "http://www.example.com"

  setup %{conn: conn} do
    u = onboarded(conn, basics: [display_name: "Owner"])
    other = onboarded(conn, basics: [display_name: "Marco"])
    admin = account_of(u.pid).id
    Application.put_env(:thirstr, :admin_account_ids, [admin])
    on_exit(fn -> Application.put_env(:thirstr, :admin_account_ids, []) end)
    {:ok, admin: admin, other: account_of(other.pid).id}
  end

  defp token(url), do: URI.parse(url).query |> URI.decode_query() |> Map.fetch!("t")

  defp page_csrf(conn, t) do
    conn = get(conn, "/admin/enrol?t=#{t}")
    html = html_response(conn, 200)
    [_, csrf] = Regex.run(~r/const csrf = "([^"]+)"/, html)
    {conn, csrf}
  end

  defp post_json(conn, path, csrf, body) do
    conn
    |> recycle()
    |> put_req_header("x-csrf-token", csrf)
    |> put_req_header("content-type", "application/json")
    |> post(path, Jason.encode!(body))
  end

  @tag ac: "AC-AD.8"
  test "link → passkey → signed in on /admin; link is single use; passkey logs in", %{
    conn: conn,
    admin: admin
  } do
    {:ok, url} = Thirstr.AdminEnrol.link(admin)
    assert url =~ "/admin/enrol?t="
    t = token(url)
    {c, csrf} = page_csrf(conn, t)

    opts = c |> post_json("/admin/enrol/options", csrf, %{}) |> json_response(200)
    assert opts["publicKey"]["authenticatorSelection"]["userVerification"] == "required"
    auth = SA.new()
    att = SA.create(auth, opts, @origin) |> Map.put("t", t)
    c2 = post_json(c, "/admin/enrol", csrf, att)
    assert json_response(c2, 200)["ok"]
    assert c2 |> recycle() |> get("/admin") |> html_response(200)

    # single use
    assert build_conn() |> get("/admin/enrol?t=#{t}") |> response(410)

    # the new passkey signs in to the console
    {c3, csrf3} =
      build_conn() |> get("/admin/login") |> then(&{&1, csrf_of(html_response(&1, 200))})

    lopts = c3 |> post_json("/admin/login/options", csrf3, %{}) |> json_response(200)

    assert c3
           |> post_json("/admin/login", csrf3, SA.get(auth, lopts, @origin))
           |> json_response(200)

    actions = Thirstr.Repo.query!("SELECT action FROM admin_audit").rows |> List.flatten()
    assert "enrol_link" in actions and "passkey_enrolled" in actions
  end

  test "only allow-listed ids get a link", %{other: other} do
    assert Thirstr.AdminEnrol.link(other) == {:error, :not_admin}
  end

  test "bad attestation consumes the token and fails", %{conn: conn, admin: admin} do
    {:ok, url} = Thirstr.AdminEnrol.link(admin)
    t = token(url)
    {c, csrf} = page_csrf(conn, t)
    opts = c |> post_json("/admin/enrol/options", csrf, %{}) |> json_response(200)
    att = SA.create(SA.new(), opts, "https://evil.example") |> Map.put("t", t)
    assert c |> post_json("/admin/enrol", csrf, att) |> response(403)
    assert build_conn() |> get("/admin/enrol?t=#{t}") |> response(410)
  end

  test "id removed from the allow-list after the link was made", %{conn: conn, admin: admin} do
    {:ok, url} = Thirstr.AdminEnrol.link(admin)
    t = token(url)
    {c, csrf} = page_csrf(conn, t)
    opts = c |> post_json("/admin/enrol/options", csrf, %{}) |> json_response(200)
    Application.put_env(:thirstr, :admin_account_ids, ["someone-else"])
    att = SA.create(SA.new(), opts, @origin) |> Map.put("t", t)
    assert c |> post_json("/admin/enrol", csrf, att) |> response(403)
  end

  test "unknown token → 410", %{conn: conn} do
    assert conn |> get("/admin/enrol?t=nope") |> response(410)
  end

  defp csrf_of(html), do: Regex.run(~r/const csrf = "([^"]+)"/, html) |> List.last()
end
