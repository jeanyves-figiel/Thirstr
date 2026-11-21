defmodule Thirstr.Support do
  @moduledoc """
  F-22 (#178) contact requests answered inside the app.

  The member's message and screenshots stay in our database / storage and are read in the admin
  inbox (A-12). The alert email to `support@thirstr.fun` carries only topic, ref, language, app
  details and a link (R-22.11): no message text, no member address, Reply-To never the member.
  Replies come back in the app (push + thread); a copy goes by email only when the member gave
  an address for this request (R-22.9). Requests are deleted 90 d after solved (Retention).
  """
  import Ecto.Query, only: [from: 2]
  import Swoosh.Email, except: [from: 2]
  alias Thirstr.{Mailer, Nearby, Notify, Repo, Storage, Valkey}
  alias Thirstr.Accounts.Account

  @topics ~w(account safety broken privacy other)
  @langs ~w(en fr de)
  @min 20
  @max 4000
  @max_open 3
  @max_per_day 5
  @reopen_days 14
  @detail_keys ~w(version build platform os device lang location safe_mode errors)
  @alphabet ~c"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

  def topics, do: @topics

  # ------------------------------------------------------------------ member side

  @doc "POST /support/requests. `a` is nil when signed out (reply_email required then)."
  def create(a, params, install_key) do
    topic = params["topic"]
    msg = params["message"] |> to_s() |> String.trim()
    email = params["reply_email"] |> to_s() |> String.trim() |> blank()
    lang = if params["lang"] in @langs, do: params["lang"], else: "en"
    atts = List.wrap(params["attachments"] || [])

    with :ok <- check(topic in @topics, :topic, "pick a topic"),
         :ok <- check(String.length(msg) in @min..@max, :message, "20 to 4000 characters"),
         :ok <- check(is_nil(email) or valid_email?(email), :reply_email, "not an email"),
         :ok <- check(a != nil or email != nil, :reply_email, "required when signed out"),
         :ok <- check(length(atts) <= 2, :attachments, "2 at most"),
         {:ok, keys} <- own_uploads(atts, install_key),
         :ok <- limits(a, install_key) do
      id = Ecto.UUID.generate()
      ref = new_ref()

      Repo.transaction(fn ->
        Repo.insert_all("support_requests", [
          %{
            id: Nearby.dump(id),
            ref: ref,
            account_id: a && Nearby.dump(a.id),
            topic: topic,
            lang: lang,
            reply_to_sealed: email && seal(email),
            app_details: details(params["app_details"])
          }
        ])

        Repo.insert_all("support_messages", [
          %{request_id: Nearby.dump(id), from: "member", body: msg, attachments: keys}
        ])
      end)

      alert(ref, id, topic, lang, details(params["app_details"]), :new)
      :telemetry.execute([:thirstr, :support, :request], %{count: 1}, %{topic: topic})
      {:ok, %{id: id, ref: ref}}
    end
  end

  @doc "POST /support/uploads {size, sha256} → presigned PUT for one JPEG screenshot (≤ 2 MB)."
  def upload(install_key, %{"size" => size}) when is_integer(size) and size > 0 do
    if size <= 2_000_000 do
      id = Ecto.UUID.generate()
      key = "support/" <> id <> ".jpg"
      Valkey.put_term("supup:" <> id, %{key: key, owner: install_key}, 3600)
      {:ok, url} = Storage.presigned_put(key, "image/jpeg")
      {:ok, %{id: id, upload_url: url}}
    else
      {:error, {:validation, %{size: ["2 MB at most"]}}}
    end
  end

  def upload(_, _), do: {:error, {:validation, %{size: ["required"]}}}

  def list(%Account{id: aid}) do
    Repo.query!(
      """
      SELECT r.id::text, r.ref, r.topic, r.status, r.updated_at, r.unread_member,
             (SELECT body FROM support_messages m WHERE m.request_id = r.id ORDER BY m.id DESC LIMIT 1)
      FROM support_requests r WHERE r.account_id = $1 ORDER BY r.updated_at DESC LIMIT 50
      """,
      [Nearby.dump(aid)]
    ).rows
    |> Nearby.utc()
    |> Enum.map(fn [id, ref, topic, status, at, unread, last] ->
      %{
        id: id,
        ref: ref,
        topic: topic,
        status: status,
        updated_at: at,
        unread: unread,
        last: String.slice(last || "", 0, 140)
      }
    end)
  end

  def thread(%Account{} = a, id) do
    with {:ok, r} <- own(a, id) do
      Repo.query!("UPDATE support_requests SET unread_member = false WHERE id = $1", [
        Nearby.dump(id)
      ])

      {:ok, Map.put(public(r), :messages, messages(id, &Storage.presigned_get/1))}
    end
  end

  def reply(%Account{} = a, id, %{"body" => body}) when is_binary(body) do
    body = String.trim(body)

    with :ok <- check(String.length(body) in 1..@max, :body, "1 to 4000 characters"),
         {:ok, r} <- own(a, id),
         :ok <- check(reopenable?(r), :status, "solved more than 14 days ago") do
      Repo.insert_all("support_messages", [
        %{request_id: Nearby.dump(id), from: "member", body: body, attachments: []}
      ])

      Repo.query!(
        "UPDATE support_requests SET status = 'open', solved_at = NULL, updated_at = now() WHERE id = $1",
        [Nearby.dump(id)]
      )

      alert(r.ref, id, r.topic, r.lang, nil, :reply)
      :ok
    end
  end

  def reply(_, _, _), do: {:error, {:validation, %{body: ["required"]}}}

  def solve(%Account{} = a, id) do
    with {:ok, _} <- own(a, id) do
      set_status(id, "solved")
      :ok
    end
  end

  # ------------------------------------------------------------------ support side (A-12)

  @doc "Admin inbox rows, oldest target first (R-22.13)."
  def inbox(status \\ "open") do
    Repo.query!(
      """
      SELECT r.id::text, r.ref, r.topic, r.lang, r.status, r.created_at, r.updated_at,
             (SELECT body FROM support_messages m WHERE m.request_id = r.id ORDER BY m.id DESC LIMIT 1),
             (SELECT "from" FROM support_messages m WHERE m.request_id = r.id ORDER BY m.id DESC LIMIT 1)
      FROM support_requests r WHERE r.status = $1 ORDER BY r.created_at LIMIT 200
      """,
      [status]
    ).rows
    |> Nearby.utc()
  end

  def get(id) do
    with {:ok, _} <- Ecto.UUID.cast(id),
         [row] <-
           Repo.query!(
             "SELECT id::text, ref, account_id::text, topic, lang, status, reply_to_sealed, app_details, created_at, updated_at, solved_at FROM support_requests WHERE id = $1",
             [Nearby.dump(id)]
           ).rows
           |> Nearby.utc() do
      [id, ref, acc, topic, lang, status, email, details, c, u, s] = row

      {:ok,
       %{
         id: id,
         ref: ref,
         account_id: acc,
         topic: topic,
         lang: lang,
         status: status,
         reply_email: email && unseal(email),
         app_details: details,
         created_at: c,
         updated_at: u,
         solved_at: s
       }}
    else
      _ -> {:error, :not_found}
    end
  end

  def messages(id, url_fun) do
    Repo.query!(
      "SELECT \"from\", body, attachments, created_at FROM support_messages WHERE request_id = $1 ORDER BY id",
      [Nearby.dump(id)]
    ).rows
    |> Nearby.utc()
    |> Enum.map(fn [from, body, atts, at] ->
      %{from: from, body: body, attachments: Enum.map(atts, &url!(url_fun, &1)), at: at}
    end)
  end

  defp url!(fun, key) do
    case fun.(key) do
      {:ok, u} -> u
      u when is_binary(u) -> u
      _ -> nil
    end
  end

  @doc "Support answers (A-12). Delivered in the app; email copy only if the member asked."
  def answer(id, body, status \\ "waiting", macro_id \\ nil) when status in ~w(waiting solved) do
    body = String.trim(to_s(body))

    with :ok <- check(String.length(body) in 1..@max, :body, "1 to 4000 characters"),
         {:ok, r} <- get(id) do
      Repo.insert_all("support_messages", [
        %{request_id: Nearby.dump(id), from: "support", body: body, macro_id: macro_id}
      ])

      Repo.query!(
        """
        UPDATE support_requests SET status = $2, unread_member = true, updated_at = now(),
          solved_at = CASE WHEN $2 = 'solved' THEN now() ELSE NULL END WHERE id = $1
        """,
        [Nearby.dump(id), status]
      )

      if r.account_id, do: Notify.event(r.account_id, "support.reply", %{id: id})
      if r.reply_email, do: email_copy(r, body)
      :ok
    end
  end

  def set_status(id, status) when status in ~w(open waiting solved) do
    Repo.query!(
      """
      UPDATE support_requests SET status = $2, updated_at = now(),
        solved_at = CASE WHEN $2 = 'solved' THEN now() ELSE NULL END WHERE id = $1
      """,
      [Nearby.dump(id), status]
    )

    :ok
  end

  def macros do
    Repo.query!("SELECT id, title, lang, body FROM support_macros ORDER BY title, lang", []).rows
  end

  def put_macro(title, lang, body) when lang in @langs do
    title = String.trim(to_s(title))
    body = String.trim(to_s(body))

    if title != "" and body != "" do
      Repo.query!(
        """
        INSERT INTO support_macros (title, lang, body) VALUES ($1, $2, $3)
        ON CONFLICT (title, lang) DO UPDATE SET body = EXCLUDED.body, updated_at = now()
        """,
        [String.slice(title, 0, 80), lang, String.slice(body, 0, @max)]
      )

      :ok
    else
      {:error, :validation}
    end
  end

  def delete_macro(id), do: Repo.query!("DELETE FROM support_macros WHERE id = $1", [id]) && :ok

  @doc "`{ref}` and `{article:<id>}` placeholders (R-22.14)."
  def fill(body, ref) do
    body
    |> String.replace("{ref}", ref)
    |> then(&Regex.replace(~r/\{article:([a-z0-9-]+)\}/, &1, "thirstr://help/\\1"))
  end

  @doc "Export (R-01.11): the member's requests with their messages (no screenshots)."
  def export(%Account{id: aid}) do
    Repo.query!(
      """
      SELECT r.ref, r.topic, r.status, r.created_at, m."from", m.body, m.created_at
      FROM support_requests r JOIN support_messages m ON m.request_id = r.id
      WHERE r.account_id = $1 ORDER BY r.created_at, m.id
      """,
      [Nearby.dump(aid)]
    ).rows
    |> Nearby.utc()
    |> Enum.group_by(fn [ref, t, s, c | _] -> {ref, t, s, c} end, fn [_, _, _, _, f, b, at] ->
      %{from: f, body: b, at: at}
    end)
    |> Enum.map(fn {{ref, t, s, c}, ms} ->
      %{ref: ref, topic: t, status: s, created_at: c, messages: ms}
    end)
  end

  @doc "Retention: solved > 90 d. Returns the number of requests deleted (and their screenshots)."
  def sweep do
    keys =
      Repo.query!(
        """
        SELECT coalesce(array_agg(k), '{}') FROM support_requests r
        JOIN support_messages m ON m.request_id = r.id, unnest(m.attachments) k
        WHERE r.status = 'solved' AND r.solved_at < now() - interval '90 days'
        """,
        []
      ).rows
      |> List.flatten()
      |> List.flatten()

    Storage.delete_many(keys)

    %{num_rows: n} =
      Repo.query!(
        "DELETE FROM support_requests WHERE status = 'solved' AND solved_at < now() - interval '90 days'",
        []
      )

    n
  end

  # ------------------------------------------------------------------ helpers

  defp own(%Account{id: aid}, id) do
    case get(id) do
      {:ok, %{account_id: ^aid} = r} -> {:ok, r}
      _ -> {:error, :not_found}
    end
  end

  defp public(r), do: Map.take(r, [:id, :ref, :topic, :status, :created_at, :updated_at])

  defp reopenable?(%{status: "solved", solved_at: %DateTime{} = s}),
    do: DateTime.diff(DateTime.utc_now(), s, :day) < @reopen_days

  defp reopenable?(_), do: true

  defp limits(a, install_key) do
    open =
      if a,
        do:
          Repo.one(
            from(r in "support_requests",
              where: r.account_id == ^Nearby.dump(a.id) and r.status != "solved",
              select: count()
            )
          ),
        else: 0

    key = "supreq:" <> if(a, do: a.id, else: install_key)
    limit = if a, do: @max_per_day, else: 3

    cond do
      open >= @max_open ->
        {:error, {:conflict_code, "support_limit", "You already have #{open} open requests"}}

      true ->
        case Valkey.hit(key, limit, 86_400) do
          {:ok, _} ->
            :ok

          {:error, :rate_limited, _} ->
            {:error, {:conflict_code, "support_limit", "You already have #{open} open requests"}}
        end
    end
  end

  defp own_uploads(ids, owner) do
    Enum.reduce_while(ids, {:ok, []}, fn id, {:ok, acc} ->
      case is_binary(id) && Valkey.take_term("supup:" <> id) do
        %{key: k, owner: ^owner} -> {:cont, {:ok, acc ++ [k]}}
        _ -> {:halt, {:error, {:validation, %{attachments: ["upload expired"]}}}}
      end
    end)
  end

  defp details(d) when is_map(d) do
    d
    |> Map.take(@detail_keys)
    |> Map.new(fn
      {"errors", v} when is_list(v) -> {"errors", v |> Enum.take(10) |> Enum.map(&short/1)}
      {k, v} -> {k, short(v)}
    end)
  end

  defp details(_), do: nil

  defp short(v) when is_binary(v), do: String.slice(v, 0, 60)
  defp short(v) when is_number(v) or is_boolean(v), do: v
  defp short(_), do: nil

  defp new_ref do
    "T-" <> for(_ <- 1..6, into: "", do: <<Enum.random(@alphabet)>>)
  end

  defp alert(ref, id, topic, lang, details, kind) do
    to = Application.get_env(:thirstr, :support_address, "support@thirstr.fun")
    link = Application.fetch_env!(:thirstr, :app_url) <> "/admin/support/" <> id

    subject =
      case kind do
        :new -> "[#{ref}] New #{topic} request (#{lang})"
        :reply -> "[#{ref}] Member replied"
      end

    lines =
      if is_map(details),
        do: Enum.map_join(details, "\n", fn {k, v} -> "#{k}: #{inspect(v)}" end),
        else: ""

    new()
    |> to(to)
    |> Swoosh.Email.from({"Thirstr support", sender()})
    |> subject(subject)
    |> text_body("""
    #{subject}

    Open in the console: #{link}

    #{lines}

    The message stays in the console. Reply there: the member gets it in the app.
    """)
    |> Mailer.deliver()
  rescue
    _ -> :ok
  end

  defp email_copy(r, body) do
    new()
    |> to(r.reply_email)
    |> Swoosh.Email.from({"Thirstr support", sender()})
    |> subject("Re: your Thirstr request #{r.ref}")
    |> text_body("""
    #{body}

    You can also read and answer this in the app: Settings › Help › Your requests.
    Thirstr will never ask for your recovery words, sign-in codes or a selfie by message.
    """)
    |> Mailer.deliver()
  rescue
    _ -> :ok
  end

  defp seal_key do
    base = Application.get_env(:thirstr, ThirstrWeb.Endpoint)[:secret_key_base] || ""
    :crypto.hash(:sha256, base <> "|support-reply-v1")
  end

  defp seal(plain) do
    iv = :crypto.strong_rand_bytes(12)

    {ct, tag} =
      :crypto.crypto_one_time_aead(:aes_256_gcm, seal_key(), iv, plain, "support", true)

    iv <> tag <> ct
  end

  defp unseal(<<iv::binary-12, tag::binary-16, ct::binary>>) do
    case :crypto.crypto_one_time_aead(:aes_256_gcm, seal_key(), iv, ct, "support", tag, false) do
      p when is_binary(p) -> p
      _ -> nil
    end
  end

  defp unseal(_), do: nil

  # The SES identity may send only as MAIL_FROM (hello@, runbooks/email.md); ImprovMX forwards both.
  defp sender, do: Application.get_env(:thirstr, :mail_from, "hello@thirstr.fun")

  defp valid_email?(e),
    do: String.length(e) <= 254 and Regex.match?(~r/^[^\s@]+@[^\s@]+\.[^\s@]+$/, e)

  defp check(true, _, _), do: :ok
  defp check(_, f, m), do: {:error, {:validation, %{f => [m]}}}
  defp to_s(nil), do: ""
  defp to_s(s) when is_binary(s), do: s
  defp to_s(_), do: ""
  defp blank(""), do: nil
  defp blank(s), do: s
end
