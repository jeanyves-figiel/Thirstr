defmodule ThirstrWeb.SharePageController do
  @moduledoc """
  I-02 public profile share page `/p/{slug}` (R-I02.2–R-I02.4b): server-rendered, no scripts, cookies,
  analytics or third-party requests. Shows the display name and, when the owner allows it, a ≤ 32 px
  preview made on their phone, inlined as a `data:` URI and blurred by CSS. The real photo, its storage
  key, a signed URL and the profile id never appear in the HTML. Every dead link (unknown, off, renewed,
  paused, suspended, quarantined, banned, deleted) gets the same 404 body.
  """
  use ThirstrWeb, :controller

  @style ".card{max-width:420px;margin:32px auto;text-align:center}.ph{width:240px;height:300px;margin:8px auto 22px;border-radius:36px;overflow:hidden;background:#4B3A8C}.ph img{width:100%;height:100%;object-fit:cover;filter:blur(14px);transform:scale(1.2)}.card h1{margin:0 0 6px}.lead{color:#C2BDE3;margin:0 0 22px}.stores{display:flex;gap:10px;justify-content:center;margin-top:14px;flex-wrap:wrap}.foot{margin-top:28px;font-size:12px;color:#8A86B0}"
  @style_hash "sha256-" <> Base.encode64(:crypto.hash(:sha256, @style))

  @csp "default-src 'none'; style-src 'self' '#{@style_hash}'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

  # Every interpolated value in render_page/2 goes through Plug.HTML.html_escape/1 or Base.encode64/1.
  # sobelow_skip ["XSS.SendResp"]
  def page(conn, %{"slug" => slug}) do
    {status, html} =
      case Thirstr.Linked.page(slug) do
        nil -> {404, render_page(nil, nil)}
        p -> {200, render_page(p, slug)}
      end

    conn
    |> put_resp_header("content-security-policy", @csp)
    |> put_resp_header("referrer-policy", "no-referrer")
    |> put_resp_header("x-robots-tag", "noindex, nofollow")
    |> put_resp_header("cache-control", "no-store")
    |> put_resp_content_type("text/html")
    |> send_resp(status, html)
  end

  defp e(s), do: s |> to_string() |> Plug.HTML.html_escape()

  defp render_page(nil, _slug) do
    page_html(
      ~s(<div class="card"><h1>This link isn’t active</h1><p class="lead">It was turned off or replaced.</p>) <>
        ~s(<a class="btn" href="/">Get Thirstr</a></div>)
    )
  end

  defp render_page(%{name: name, preview: preview}, slug) do
    img =
      if preview,
        do:
          ~s(<div class="ph"><img src="data:image/jpeg;base64,#{Base.encode64(preview)}" alt=""></div>),
        else: ""

    page_html(
      ~s(<div class="card">#{img}<h1>#{e(name)}</h1><p class="lead">Chat me safely on Thirstr.</p>) <>
        ~s(<a class="btn coral" href="thirstr://p/#{e(slug)}">Open in Thirstr</a>) <>
        ~s(<div class="stores"><span class="store">App Store <small>soon</small></span><span class="store">Google Play <small>soon</small></span></div>) <>
        ~s(<p class="foot">No trackers, cookies or ads.</p></div>)
    )
  end

  # R-I02.4a: link previews get the title and site name only (no name, description or image).
  defp page_html(body) do
    """
    <!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>A Thirstr profile</title><meta property="og:title" content="A Thirstr profile"><meta property="og:site_name" content="Thirstr">
    <meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><meta name="theme-color" content="#17142E">
    <link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/site.css"><style>#{@style}</style>
    </head><body><div class="wrap"><header class="top"><span class="logo">thirst<span class="r">r</span><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span></span></header>
    <main id="main">#{body}</main></div></body></html>
    """
  end
end
