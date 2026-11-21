defmodule ThirstrWeb.Plugs.Site do
  @moduledoc """
  Public marketing site (docs/spec/website.md, W-01). Serves the static build in
  `priv/static/site` for GET/HEAD on every non-API path:

    * `www.<site_host>` → 301 to `<site_host>` (same path and query)
    * file → served; directory → its `index.html` (301 to add the trailing slash)
    * anything else → `404.html` with status 404
    * hosts other than `:site_host` get `X-Robots-Tag: noindex`

  API paths (`/v1`, `/socket`, `/.well-known`, `/admin`, `/p` share pages) and other methods pass through.
  """
  @behaviour Plug
  import Plug.Conn

  @api ~w(v1 socket .well-known admin p)
  @csp "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self' data:; " <>
         "base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  # Trusted-contact page (F-13): own scripts, service worker, same-origin relay API only.
  @csp_contact @csp <>
                 "; script-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'"

  @impl true
  def init(opts), do: opts

  @impl true
  def call(%Plug.Conn{method: method, host: "www." <> host} = conn, opts)
      when method in ~w(GET HEAD) do
    if host == Application.get_env(:thirstr, :site_host),
      do: to_apex(conn, host),
      else: site(conn, opts)
  end

  def call(conn, opts), do: site(conn, opts)

  defp to_apex(conn, host) do
    query = if conn.query_string == "", do: "", else: "?" <> conn.query_string

    conn
    |> put_resp_header("location", "https://" <> host <> conn.request_path <> query)
    |> send_resp(301, "")
    |> halt()
  end

  defp site(%Plug.Conn{path_info: [first | _]} = conn, _) when first in @api, do: conn

  defp site(%Plug.Conn{method: method} = conn, _) when method in ~w(GET HEAD) do
    if safe?(conn.path_info),
      do: serve(conn, Path.join([dir() | conn.path_info])),
      else: not_found(conn)
  end

  defp site(conn, _), do: conn

  defp serve(conn, path) do
    index = Path.join(path, "index.html")

    cond do
      File.regular?(path) ->
        send_site_file(conn, 200, path)

      File.regular?(index) and String.ends_with?(conn.request_path, "/") ->
        send_site_file(conn, 200, index)

      File.regular?(index) ->
        conn
        |> put_resp_header("location", conn.request_path <> "/")
        |> send_resp(301, "")
        |> halt()

      true ->
        not_found(conn)
    end
  end

  defp not_found(conn) do
    path = Path.join(dir(), "404.html")

    if File.regular?(path),
      do: send_site_file(conn, 404, path),
      else: conn |> send_resp(404, "") |> halt()
  end

  # Path segments come from Plug's parsed path_info and are rejected by safe?/1 if
  # they could leave the site directory (`..`, hidden files, separators, NUL).
  # Content type comes from the extension of a file in the site build (fixed set).
  # sobelow_skip ["Traversal.SendFile", "XSS.ContentType"]
  defp send_site_file(conn, status, path) do
    type = MIME.from_path(path)

    conn
    |> put_resp_content_type(type, charset(type))
    |> put_resp_header("cache-control", cache(path))
    |> put_resp_header("content-security-policy", csp(conn))
    |> put_resp_header("referrer-policy", "no-referrer")
    |> put_resp_header("x-content-type-options", "nosniff")
    |> put_resp_header("permissions-policy", "interest-cohort=()")
    |> put_resp_header("strict-transport-security", "max-age=31536000")
    |> robots()
    |> send_file(status, path)
    |> halt()
  end

  defp csp(%Plug.Conn{path_info: ["c" | _]}), do: @csp_contact
  defp csp(_), do: @csp

  defp charset("text/" <> _), do: "utf-8"
  defp charset("application/xml"), do: "utf-8"
  defp charset(_), do: nil

  defp robots(conn) do
    if conn.host == Application.get_env(:thirstr, :site_host),
      do: conn,
      else: put_resp_header(conn, "x-robots-tag", "noindex")
  end

  defp cache(path) do
    if Path.extname(path) in ~w(.html .txt .xml),
      do: "public, max-age=300",
      else: "public, max-age=86400"
  end

  defp safe?(segments) do
    Enum.all?(segments, fn s ->
      s != "" and not String.starts_with?(s, ".") and
        not String.contains?(s, ["/", "\\", <<0>>, ":"])
    end)
  end

  defp dir,
    do:
      Application.get_env(:thirstr, :site_dir) ||
        Application.app_dir(:thirstr, "priv/static/site")
end
