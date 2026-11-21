defmodule ThirstrWeb.ReportPageController do
  @moduledoc """
  F-15 R-15.25 `thirstr.fun/report`: DSA Art. 16 notice form for people without the app.
  Server-rendered, no scripts, no cookies, no third-party requests. Bots are kept out by a
  signed form token (must be ≥ 3 s and ≤ 1 h old), a honeypot field and 5 posts per hashed
  IP per day (router). en / fr / de by `?lang=` or Accept-Language.
  """
  use ThirstrWeb, :controller
  alias Thirstr.Reports.Web

  @style ".card{max-width:620px;margin:24px auto;display:flex;flex-direction:column;gap:14px}.card h1{margin:0}.lead{color:#C2BDE3;margin:0;line-height:1.5}label{display:flex;flex-direction:column;gap:6px;font-weight:700;font-size:14px}input,select,textarea{font:inherit;font-weight:400;background:#262248;color:#fff;border:1px solid #39346A;border-radius:12px;padding:10px 12px}textarea{min-height:110px}.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:560px){.row{grid-template-columns:1fr}}.chk{flex-direction:row;align-items:flex-start;gap:10px;font-weight:400}.chk input{margin-top:3px}.err{color:#FF4D6D;font-weight:400;font-size:13px}.hp{position:absolute;left:-9999px}.ok{background:#262248;border-radius:18px;padding:18px}.ref{color:#3DD6C3;font-weight:800}button{font:inherit;font-weight:800;border:0;border-radius:999px;padding:12px 22px;background:#FF4D6D;color:#17142E;align-self:flex-start;cursor:pointer}.foot{font-size:12px;color:#8A86B0}"
  @style_hash "sha256-" <> Base.encode64(:crypto.hash(:sha256, @style))
  @csp "default-src 'none'; style-src 'self' '#{@style_hash}'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"

  @t %{
    "en" => %{
      title: "Report illegal content on Thirstr",
      lead:
        "Use this form if you don't have the app. Members can report from any profile or chat. For child sexual abuse you can stay anonymous.",
      link: "Link to the profile (thirstr.fun/p/…)",
      type: "Type",
      types: [
        csam: "Child sexual abuse",
        intimate_images: "Intimate images shared without consent",
        threats: "Threats or violence",
        hate_speech: "Hate speech",
        fraud: "Fraud or scam",
        impersonation: "Impersonation",
        ip: "Copyright or trademark",
        other: "Something else"
      ],
      country: "Your country (2 letters, e.g. DE)",
      expl: "What's illegal about it? (20–1 000 characters)",
      name: "Your name",
      email: "Your email",
      gf: "I believe this report is accurate and complete.",
      send: "Send report",
      done: "Report received",
      done_lead: "Your reference is",
      done_more:
        "If you gave an email, we sent a confirmation and we'll tell you what we decide.",
      foot:
        "We use your name and email only to answer this report. They're never shown to the person you report.",
      again: "Something went wrong. Please try again."
    },
    "fr" => %{
      title: "Signaler un contenu illicite sur Thirstr",
      lead:
        "Utilise ce formulaire si tu n'as pas l'app. Les membres peuvent signaler depuis un profil ou une discussion. Pour les abus sexuels sur mineurs, tu peux rester anonyme.",
      link: "Lien du profil (thirstr.fun/p/…)",
      type: "Type",
      types: [
        csam: "Abus sexuels sur mineurs",
        intimate_images: "Images intimes partagées sans accord",
        threats: "Menaces ou violence",
        hate_speech: "Discours de haine",
        fraud: "Fraude ou arnaque",
        impersonation: "Usurpation d'identité",
        ip: "Droit d'auteur ou marque",
        other: "Autre chose"
      ],
      country: "Ton pays (2 lettres, ex. FR)",
      expl: "Qu'est-ce qui est illicite ? (20 à 1 000 caractères)",
      name: "Ton nom",
      email: "Ton e-mail",
      gf: "Je crois que ce signalement est exact et complet.",
      send: "Envoyer le signalement",
      done: "Signalement reçu",
      done_lead: "Ta référence est",
      done_more:
        "Si tu as donné un e-mail, on t'a envoyé une confirmation et on te dira ce qu'on décide.",
      foot:
        "Ton nom et ton e-mail servent seulement à répondre à ce signalement. La personne signalée ne les voit jamais.",
      again: "Un problème est survenu. Réessaie."
    },
    "de" => %{
      title: "Illegale Inhalte auf Thirstr melden",
      lead:
        "Nutze dieses Formular, wenn du die App nicht hast. Mitglieder melden direkt im Profil oder Chat. Bei sexuellem Missbrauch von Kindern kannst du anonym bleiben.",
      link: "Link zum Profil (thirstr.fun/p/…)",
      type: "Art",
      types: [
        csam: "Sexueller Missbrauch von Kindern",
        intimate_images: "Intime Bilder ohne Einwilligung geteilt",
        threats: "Drohungen oder Gewalt",
        hate_speech: "Hassrede",
        fraud: "Betrug",
        impersonation: "Identitätsmissbrauch",
        ip: "Urheber- oder Markenrecht",
        other: "Etwas anderes"
      ],
      country: "Dein Land (2 Buchstaben, z. B. DE)",
      expl: "Was daran ist illegal? (20–1 000 Zeichen)",
      name: "Dein Name",
      email: "Deine E-Mail",
      gf: "Ich versichere, dass diese Meldung richtig und vollständig ist.",
      send: "Meldung senden",
      done: "Meldung erhalten",
      done_lead: "Deine Referenz ist",
      done_more:
        "Wenn du eine E-Mail angegeben hast, bekommst du eine Bestätigung und später unsere Entscheidung.",
      foot:
        "Name und E-Mail nutzen wir nur für diese Meldung. Die gemeldete Person sieht sie nie.",
      again: "Etwas ist schiefgelaufen. Bitte versuche es nochmal."
    }
  }

  # sobelow_skip ["XSS.SendResp"]
  def form(conn, params), do: send_html(conn, 200, form_html(lang(conn, params), params, %{}))

  # sobelow_skip ["XSS.SendResp"]
  def submit(conn, params) do
    l = lang(conn, params)

    cond do
      (params["website"] || "") != "" or not fresh?(params["t"]) ->
        send_html(conn, 422, form_html(l, params, %{form: [@t[l].again]}))

      true ->
        case Web.create(params) do
          {:ok, ref} -> send_html(conn, 201, done_html(l, ref))
          {:error, {:validation, errs}} -> send_html(conn, 422, form_html(l, params, errs))
        end
    end
  end

  defp fresh?(t) when is_binary(t) do
    case Phoenix.Token.verify(ThirstrWeb.Endpoint, "report-form", t, max_age: 3600) do
      {:ok, at} -> System.system_time(:second) - at >= min_age()
      _ -> false
    end
  end

  defp fresh?(_), do: false

  defp min_age, do: Application.get_env(:thirstr, :report_form_min_age_s, 3)

  def token,
    do: Phoenix.Token.sign(ThirstrWeb.Endpoint, "report-form", System.system_time(:second))

  defp lang(conn, params) do
    cond do
      params["lang"] in ~w(en fr de) ->
        params["lang"]

      true ->
        al = conn |> get_req_header("accept-language") |> List.first("") |> String.downcase()

        cond do
          String.starts_with?(al, "fr") -> "fr"
          String.starts_with?(al, "de") -> "de"
          true -> "en"
        end
    end
  end

  defp e(s), do: s |> to_string() |> Plug.HTML.html_escape()

  defp errs(errs, k),
    do: for(m <- Map.get(errs, k, []), into: "", do: ~s(<span class="err">#{e(m)}</span>))

  defp form_html(l, p, errs) do
    t = @t[l]

    opts =
      for {k, label} <- t.types, into: "" do
        sel = if p["legal_type"] == to_string(k), do: " selected", else: ""
        ~s(<option value="#{k}"#{sel}>#{e(label)}</option>)
      end

    page(l, t.title, """
    <form class="card" method="post" action="/report?lang=#{l}">
      <h1>#{e(t.title)}</h1><p class="lead">#{e(t.lead)}</p>#{errs(errs, :form)}
      <input type="hidden" name="t" value="#{e(token())}">
      <label class="hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
      <div class="row"><label>#{e(t.link)}<input name="link" required value="#{e(p["link"] || "")}">#{errs(errs, :link)}</label>
      <label>#{e(t.type)}<select name="legal_type">#{opts}</select>#{errs(errs, :legal_type)}</label></div>
      <label>#{e(t.expl)}<textarea name="explanation" minlength="20" maxlength="1000" required>#{e(p["explanation"] || "")}</textarea>#{errs(errs, :explanation)}</label>
      <div class="row"><label>#{e(t.name)}<input name="name" autocomplete="name" value="#{e(p["name"] || "")}">#{errs(errs, :name)}</label>
      <label>#{e(t.email)}<input name="email" type="email" autocomplete="email" value="#{e(p["email"] || "")}">#{errs(errs, :email)}</label></div>
      <label>#{e(t.country)}<input name="country" maxlength="2" value="#{e(p["country"] || "")}"></label>
      <label class="chk"><input type="checkbox" name="good_faith" required>#{e(t.gf)}</label>#{errs(errs, :good_faith)}
      <button type="submit">#{e(t.send)}</button>
      <p class="foot">#{e(t.foot)}</p>
    </form>
    """)
  end

  defp done_html(l, ref) do
    t = @t[l]

    page(l, t.done, """
    <div class="card"><div class="ok"><h1>#{e(t.done)}</h1>
    <p class="lead">#{e(t.done_lead)} <span class="ref">#{e(ref)}</span>.</p><p class="lead">#{e(t.done_more)}</p></div></div>
    """)
  end

  defp page(l, title, body) do
    """
    <!doctype html><html lang="#{l}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>#{e(title)}</title><meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><meta name="theme-color" content="#17142E">
    <link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/site.css"><style>#{@style}</style>
    </head><body><div class="wrap"><header class="top"><a class="logo" href="/">thirst<span class="r">r</span></a></header>
    <main id="main">#{body}</main></div></body></html>
    """
  end

  # Every interpolated value in the page goes through e/1 (Plug.HTML.html_escape/1).
  # sobelow_skip ["XSS.SendResp"]
  defp send_html(conn, status, html) do
    conn
    |> put_resp_header("content-security-policy", @csp)
    |> put_resp_header("referrer-policy", "no-referrer")
    |> put_resp_header("cache-control", "no-store")
    |> put_resp_content_type("text/html")
    |> send_resp(status, html)
  end
end
