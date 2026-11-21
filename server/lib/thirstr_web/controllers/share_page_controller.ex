defmodule ThirstrWeb.SharePageController do
  @moduledoc """
  I-02 public profile share page `/p/{slug}`: server-rendered, no scripts, cookies or analytics
  (AC-I02.1). Main photo blurred, display name, call to action. Unknown or inactive → 404.
  """
  use ThirstrWeb, :controller

  # Every interpolated value in render_page/2 goes through Plug.HTML.html_escape/1.
  # sobelow_skip ["XSS.SendResp"]
  def page(conn, %{"slug" => slug}) do
    case Thirstr.Linked.page(slug) do
      nil ->
        conn
        |> headers()
        |> put_resp_content_type("text/html")
        |> send_resp(404, render_page(nil, slug))

      p ->
        conn
        |> headers()
        |> put_resp_content_type("text/html")
        |> send_resp(200, render_page(p, slug))
    end
  end

  defp headers(conn) do
    put_resp_header(conn, "cache-control", "no-store")
  end

  defp e(s), do: s |> to_string() |> Plug.HTML.html_escape()

  defp render_page(p, slug) do
    body =
      case p do
        nil ->
          ~s(<div class="card"><h1>Link not active</h1><p>This profile link was turned off.</p></div>)

        %{name: name, photo: photo} ->
          img =
            if photo,
              do: ~s(<div class="ph"><img src="#{e(photo)}" alt=""></div>),
              else: ""

          ~s(<div class="card">#{img}<h1>#{e(name)}</h1><p>Chat me safely on Thirstr.</p>) <>
            ~s(<a class="btn coral" href="thirstr://p/#{e(slug)}">Open in Thirstr</a>) <>
            ~s(<div class="stores"><span class="store">App Store <small>soon</small></span><span class="store">Google Play <small>soon</small></span></div></div>)
      end

    """
    <!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Thirstr</title><meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><meta name="theme-color" content="#17142E">
    <link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/site.css">
    <style>.card{max-width:420px;margin:32px auto;text-align:center}.ph{width:220px;height:280px;margin:0 auto 20px;border-radius:32px;overflow:hidden}.ph img{width:100%;height:100%;object-fit:cover;filter:blur(18px);transform:scale(1.15)}.stores{display:flex;gap:10px;justify-content:center;margin-top:20px;flex-wrap:wrap}</style>
    </head><body><div class="wrap"><header class="top"><span class="logo">thirst<span class="r">r</span><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span></span></header>
    <main id="main">#{body}</main></div></body></html>
    """
  end
end
