defmodule ThirstrWeb.SiteTest do
  # W-01 (docs/spec/website.md): marketing site plug.
  use ThirstrWeb.ConnCase, async: false

  setup do
    dir = Path.join(System.tmp_dir!(), "thirstr-site-#{System.unique_integer([:positive])}")
    File.mkdir_p!(Path.join(dir, "fr"))
    File.write!(Path.join(dir, "index.html"), "<p>home en</p>")
    File.write!(Path.join(dir, "fr/index.html"), "<p>home fr</p>")
    File.write!(Path.join(dir, "404.html"), "<p>not found</p>")
    File.write!(Path.join(dir, "site.css"), "body{}")
    File.write!(Path.join(dir, ".secret"), "no")

    prev = {Application.get_env(:thirstr, :site_dir), Application.get_env(:thirstr, :site_host)}
    Application.put_env(:thirstr, :site_dir, dir)
    Application.put_env(:thirstr, :site_host, "thirstr.fun")

    on_exit(fn ->
      {d, h} = prev
      Application.put_env(:thirstr, :site_dir, d)
      Application.put_env(:thirstr, :site_host, h)
      File.rm_rf!(dir)
    end)
  end

  defp on(conn, host), do: %{conn | host: host}

  test "home on canonical host, indexable, with security headers", %{conn: conn} do
    conn = conn |> on("thirstr.fun") |> get("/")
    assert html_response(conn, 200) =~ "home en"
    assert get_resp_header(conn, "x-robots-tag") == []
    assert [csp] = get_resp_header(conn, "content-security-policy")
    assert csp =~ "default-src 'none'"
    assert get_resp_header(conn, "referrer-policy") == ["no-referrer"]
  end

  test "language directory: trailing slash redirect, then index", %{conn: conn} do
    assert redirected_to(conn |> on("thirstr.fun") |> get("/fr"), 301) == "/fr/"
    assert html_response(build_conn() |> on("thirstr.fun") |> get("/fr/"), 200) =~ "home fr"
  end

  test "assets get their content type", %{conn: conn} do
    conn = conn |> on("thirstr.fun") |> get("/site.css")
    assert response(conn, 200) == "body{}"
    assert [type] = get_resp_header(conn, "content-type")
    assert type =~ "text/css"
  end

  test "www redirects to apex keeping path and query", %{conn: conn} do
    conn = conn |> on("www.thirstr.fun") |> get("/fr/?a=1")
    assert redirected_to(conn, 301) == "https://thirstr.fun/fr/?a=1"
  end

  test "non-canonical hosts serve the site with noindex", %{conn: conn} do
    conn = conn |> on("staging.thirstr.fun") |> get("/")
    assert html_response(conn, 200) =~ "home en"
    assert get_resp_header(conn, "x-robots-tag") == ["noindex"]
  end

  test "unknown, hidden and traversal paths get the 404 page", %{conn: conn} do
    for path <- ["/nope", "/.secret", "/fr/../.secret", "/%2e%2e/etc/passwd"] do
      assert response(conn |> recycle() |> on("thirstr.fun") |> get(path), 404) =~ "not found"
    end
  end

  test "API paths are untouched", %{conn: conn} do
    assert json_response(conn |> on("thirstr.fun") |> get("/v1/health"), 200)
  end

  test "non-GET on site paths falls through to the router", %{conn: conn} do
    conn = conn |> on("thirstr.fun") |> post("/")
    assert conn.status == 404
    refute conn.resp_body =~ "not found"
  end
end
