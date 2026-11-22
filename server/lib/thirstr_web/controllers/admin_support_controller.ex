defmodule ThirstrWeb.AdminSupportController do
  @moduledoc """
  A-12 Support inbox (F-22, #178): requests oldest-target first, thread, reply (free text or a
  saved reply with `{ref}` / `{article:id}`), mark waiting / solved, saved replies per language,
  held feedback, help article votes. Every view and reply is audited (R-AD.4).

  There is deliberately no control here that changes sign-in methods, devices, recovery phrase or
  account ownership (R-22.20, AC-22.4).
  """
  use ThirstrWeb, :controller
  import ThirstrWeb.AdminController, only: [page: 3, nav: 0, e: 1, audit: 4]
  alias Thirstr.{Feedback, Help, Storage, Support}

  # R-22.13 targets in hours
  @target %{"safety" => 24, "account" => 48}
  @langs ~w(en fr de)

  def index(conn, p) do
    status = if p["status"] in ~w(open waiting solved), do: p["status"], else: "open"
    audit(conn.assigns.admin, "view_support", nil, status)
    now = DateTime.utc_now()

    rows =
      Support.inbox(status)
      |> Enum.map(fn [id, ref, topic, lang, st, created, _upd, last, from] ->
        due = DateTime.add(created, Map.get(@target, topic, 72) * 3600, :second)
        left = DateTime.diff(due, now, :hour)
        {left, id, ref, topic, lang, st, last, from}
      end)
      |> Enum.sort_by(&elem(&1, 0))
      |> Enum.map_join("", fn {left, id, ref, topic, lang, _st, last, from} ->
        cls = if left < 0, do: ~s( class="danger"), else: ""

        """
        <tr><td><a href="/admin/support/#{id}">#{e(ref)}</a></td><td>#{e(topic)}</td><td>#{e(lang)}</td>
        <td#{cls}>#{left} h</td><td>#{if from == "member", do: "member", else: "us"}</td>
        <td class="muted">#{e(String.slice(last || "", 0, 90))}</td></tr>
        """
      end)

    tabs =
      Enum.map_join(~w(open waiting solved), " · ", fn s ->
        if s == status, do: "<b>#{s}</b>", else: ~s(<a href="/admin/support?status=#{s}">#{s}</a>)
      end)

    page(conn, "Support", """
    #{nav()}<h1>A-12 Support inbox</h1>
    <p>#{tabs} · <a href="/admin/support/macros">Saved replies</a> · <a href="/admin/support/feedback">Feedback &amp; help votes</a></p>
    <table><tr><th>Ref</th><th>Topic</th><th>Lang</th><th>Target</th><th>Last</th><th></th></tr>#{rows}</table>
    #{if rows == "", do: ~s(<p class="muted">Nothing here.</p>), else: ""}
    <p class="muted">Recovery requests: answer with the "Recovery ladder" saved reply. Nobody here can move an account (R-22.20).</p>
    """)
  end

  def show(conn, %{"id" => id}) do
    case Support.get(id) do
      {:ok, r} ->
        audit(conn.assigns.admin, "view_support_request", id, nil)
        msgs = Support.messages(id, &Storage.presigned_get(&1, 600))

        thread =
          Enum.map_join(msgs, "", fn m ->
            imgs =
              Enum.map_join(m.attachments, "", fn u ->
                ~s{<span class="ph"><img src="#{e(u)}" alt="screenshot" onclick="this.classList.toggle('show')"></span>}
              end)

            """
            <div class="card"#{if m.from == "support", do: ~s( style="border-left:3px solid #ff7a59"), else: ""}>
            <p class="muted">#{if m.from == "support", do: "Thirstr support", else: "Member"} · #{e(m.at)}</p>
            <p style="white-space:pre-wrap">#{e(m.body)}</p><div class="photos">#{imgs}</div></div>
            """
          end)

        details =
          (r.app_details || %{})
          |> Enum.map_join("", fn {k, v} ->
            "<tr><td>#{e(k)}</td><td>#{e(inspect(v))}</td></tr>"
          end)

        macros =
          Support.macros()
          |> Enum.filter(fn [_, _, l, _] -> l == r.lang end)
          |> Enum.map_join("", fn [mid, title, _, body] ->
            ~s(<option value="#{mid}" data-body="#{e(Support.fill(body, r.ref))}">#{e(title)}</option>)
          end)

        page(conn, r.ref, """
        #{nav()}<h1>#{e(r.ref)} · #{e(r.topic)} · #{e(r.lang)} · #{e(r.status)}</h1>
        <p class="muted">#{if r.account_id, do: "Member account", else: "Signed out"}#{if r.reply_email, do: " · email copy on", else: ""} · opened #{e(r.created_at)}</p>
        #{thread}
        <form method="post" action="/admin/support/#{id}/reply" class="card">
          <input type="hidden" name="_csrf_token" value="#{get_csrf_token()}">
          <p><select id="macro" name="macro_id"><option value="">Saved reply…</option>#{macros}</select></p>
          <textarea id="body" name="body" rows="8" style="width:100%;font:inherit;background:#2c2650;color:#f3f0ff;border-radius:8px" required></textarea>
          <p><button name="status" value="waiting">Send · waiting for member</button>
             <button name="status" value="solved">Send · solved</button></p>
        </form>
        <form method="post" action="/admin/support/#{id}/status">
          <input type="hidden" name="_csrf_token" value="#{get_csrf_token()}">
          <button name="status" value="solved">Mark solved</button> <button name="status" value="open">Reopen</button>
        </form>
        <h2>App details</h2><table>#{details}</table>
        <script>document.getElementById('macro').onchange=function(){var o=this.selectedOptions[0];if(o&&o.dataset.body)document.getElementById('body').value=o.dataset.body}</script>
        """)

      _ ->
        send_resp(conn, 404, "")
    end
  end

  def reply(conn, %{"id" => id, "body" => body} = p) do
    status = if p["status"] == "solved", do: "solved", else: "waiting"

    macro =
      with m when is_binary(m) and m != "" <- p["macro_id"], {n, ""} <- Integer.parse(m), do: n

    case Support.answer(id, body, status, if(is_integer(macro), do: macro)) do
      :ok ->
        audit(conn.assigns.admin, "support_reply", id, if(is_integer(macro), do: "macro"))
        redirect(conn, to: "/admin/support/#{id}")

      _ ->
        page(conn, "Error", "#{nav()}<p class=\"danger\">Reply failed (1–4000 characters).</p>")
    end
  end

  def status(conn, %{"id" => id, "status" => s}) when s in ~w(open waiting solved) do
    case Support.get(id) do
      {:ok, _} ->
        Support.set_status(id, s)
        audit(conn.assigns.admin, "support_status", id, s)
        redirect(conn, to: "/admin/support/#{id}")

      _ ->
        send_resp(conn, 404, "")
    end
  end

  def status(conn, _), do: send_resp(conn, 422, "")

  def macros(conn, _) do
    list =
      Enum.map_join(Support.macros(), "", fn [id, title, lang, body] ->
        """
        <div class="card"><p><b>#{e(title)}</b> · #{e(lang)}</p><p style="white-space:pre-wrap" class="muted">#{e(body)}</p>
        <form method="post" action="/admin/support/macros/#{id}/delete"><input type="hidden" name="_csrf_token" value="#{get_csrf_token()}"><button>Delete</button></form></div>
        """
      end)

    langs = Enum.map_join(@langs, "", &~s(<option>#{&1}</option>))

    page(conn, "Saved replies", """
    #{nav()}<h1>Saved replies</h1>
    <p class="muted">Placeholders: <code>{ref}</code>, <code>{article:lost-phone}</code> (opens the article in the app). Same title in en/fr/de.</p>
    <form method="post" action="/admin/support/macros" class="card">
      <input type="hidden" name="_csrf_token" value="#{get_csrf_token()}">
      <p><input name="title" placeholder="Title" required maxlength="80"> <select name="lang">#{langs}</select></p>
      <textarea name="body" rows="6" style="width:100%;font:inherit;background:#2c2650;color:#f3f0ff;border-radius:8px" required></textarea>
      <p><button>Save</button></p>
    </form>
    #{list}
    """)
  end

  def put_macro(conn, %{"title" => t, "lang" => l, "body" => b}) do
    case Support.put_macro(t, l, b) do
      :ok ->
        audit(conn.assigns.admin, "support_macro_save", nil, l)
        redirect(conn, to: "/admin/support/macros")

      _ ->
        send_resp(conn, 422, "Title and text are required")
    end
  end

  def put_macro(conn, _), do: send_resp(conn, 422, "")

  def delete_macro(conn, %{"id" => id}) do
    case Integer.parse(id) do
      {n, ""} ->
        Support.delete_macro(n)
        audit(conn.assigns.admin, "support_macro_delete", id, nil)
        redirect(conn, to: "/admin/support/macros")

      _ ->
        send_resp(conn, 404, "")
    end
  end

  def feedback(conn, _) do
    audit(conn.assigns.admin, "view_feedback", nil, nil)

    held =
      Enum.map_join(Feedback.held(), "", fn [id, kind, part, text, day] ->
        """
        <div class="card"><p class="muted">#{e(kind)} · #{e(part || "—")} · #{e(day)}</p><p>#{e(text)}</p>
        <form method="post" action="/admin/support/feedback/#{id}"><input type="hidden" name="_csrf_token" value="#{get_csrf_token()}">
        <button name="do" value="send">Send to GitHub</button> <button name="do" value="delete">Delete</button></form></div>
        """
      end)

    votes =
      Enum.map_join(Help.stats(), "", fn [a, up, down] ->
        "<tr><td>#{e(a)}</td><td>#{up}</td><td>#{down}</td></tr>"
      end)

    notes =
      Enum.map_join(Help.notes(), "", fn [a, l, r, n, at] ->
        "<tr><td>#{e(a)}</td><td>#{e(l)}</td><td>#{e(r)}</td><td>#{e(n)}</td><td class=\"muted\">#{e(at)}</td></tr>"
      end)

    page(conn, "Feedback", """
    #{nav()}<h1>Feedback &amp; help</h1>
    <h2>Held feedback (not sent to GitHub)</h2>#{if held == "", do: ~s(<p class="muted">None.</p>), else: held}
    <h2>Help votes, last 30 days</h2><table><tr><th>Article</th><th>👍</th><th>👎</th></tr>#{votes}</table>
    <h2>👎 notes (scrubbed, 90 days)</h2><table>#{notes}</table>
    """)
  end

  def feedback_action(conn, %{"id" => id, "do" => d}) when d in ~w(send delete) do
    case Ecto.UUID.cast(id) do
      {:ok, _} ->
        Feedback.release(id, if(d == "send", do: :send, else: :delete))
        audit(conn.assigns.admin, "feedback_" <> d, id, nil)
        redirect(conn, to: "/admin/support/feedback")

      _ ->
        send_resp(conn, 404, "")
    end
  end

  def feedback_action(conn, _), do: send_resp(conn, 422, "")
end
