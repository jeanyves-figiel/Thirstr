defmodule ThirstrWeb.Plugs.Idempotency do
  @moduledoc """
  DB-10 (#335, docs/spec/db-integrity.md, api.md › Idempotency): `Idempotency-Key` on creates.

  A signed-in request to an allow-listed POST route that carries `Idempotency-Key` (8–64 of
  `[A-Za-z0-9_-]`) is claimed once per account and key for 24 h:
  - first time: runs; the answer (status < 500, body ≤ 64 KB) is stored. A 5xx or bigger answer
    frees the key, so the retry runs again.
  - same key, same route and body: the stored answer is sent again (`idempotent-replayed: true`),
    nothing is stored twice.
  - same key, other route or body: 422 `idempotency_mismatch`.
  - same key while the first is still running: 409 `idempotency_in_progress` (retry later); a claim
    left without an answer for 2 min (machine restart) is taken over.

  Only routes whose answer holds no secret are listed (never auth, tokens, passkeys, recovery).
  Without the header, or for another route, the plug does nothing. Stored rows are swept after
  24 h (`sweep/0`, ExpirySweep; retention probe `idempotency_24h`).
  """
  import Plug.Conn
  alias Thirstr.Repo

  @max_body 65_536
  @key ~r/\A[A-Za-z0-9_-]{8,64}\z/

  # POST creates whose repeat would store a duplicate (parties, plans, trips, posts, reports …)
  @routes [
    ~r{\A/v1/tonight\z},
    ~r{\A/v1/trips\z},
    ~r{\A/v1/parties\z},
    ~r{\A/v1/parties/[^/]+/(request|report)\z},
    ~r{\A/v1/activities\z},
    ~r{\A/v1/activities/[^/]+/rsvp\z},
    ~r{\A/v1/clubs\z},
    ~r{\A/v1/clubs/[^/]+/join\z},
    ~r{\A/v1/reports\z},
    ~r{\A/v1/support/requests\z},
    ~r{\A/v1/support/requests/[^/]+/messages\z},
    ~r{\A/v1/feedback\z},
    ~r{\A/v1/moments/[^/]+/publish\z},
    ~r{\A/v1/profiles/[^/]+/vouch\z},
    ~r{\A/v1/me/profiles/[^/]+/photos\z}
  ]

  def init(opts), do: opts

  def call(%Plug.Conn{method: "POST", assigns: %{account: %{id: account_id}}} = conn, _opts) do
    with [key] <- get_req_header(conn, "idempotency-key"),
         true <- Regex.match?(@key, key),
         true <- Enum.any?(@routes, &Regex.match?(&1, conn.request_path)) do
      claim(conn, account_id, key)
    else
      _ -> conn
    end
  end

  def call(conn, _opts), do: conn

  @doc false
  def routes, do: @routes

  defp claim(conn, account_id, key) do
    hash = request_hash(conn)

    %{num_rows: n} =
      Repo.query!(
        """
        INSERT INTO idempotency_keys (account_id, key, path, req_hash, created_at)
        VALUES ($1, $2, $3, $4, now()) ON CONFLICT DO NOTHING
        """,
        [dump(account_id), key, conn.request_path, hash]
      )

    if n == 1,
      do: register_before_send(conn, &store(&1, account_id, key)),
      else: replay(conn, account_id, key, hash)
  end

  defp replay(conn, account_id, key, hash) do
    case Repo.query!(
           """
           SELECT path, req_hash, status, body, created_at < now() - interval '2 minutes'
           FROM idempotency_keys
           WHERE account_id = $1 AND key = $2 AND created_at > now() - interval '24 hours'
           """,
           [dump(account_id), key]
         ).rows do
      [[path, ^hash, status, body, _]] when path == conn.request_path and is_integer(status) ->
        conn
        |> put_resp_content_type("application/json")
        |> put_resp_header("idempotent-replayed", "true")
        |> send_resp(status, body || "")
        |> halt()

      [[path, ^hash, nil, _, false]] when path == conn.request_path ->
        error(conn, 409, "idempotency_in_progress", "This request is still being processed")

      [[path, ^hash, nil, _, true]] when path == conn.request_path ->
        # the first attempt died without an answer (machine restart): run it again
        take_over(conn, account_id, key)

      [_] ->
        error(
          conn,
          422,
          "idempotency_mismatch",
          "This Idempotency-Key was used for another request"
        )

      # an expired row from yesterday not swept yet
      [] ->
        take_over(conn, account_id, key)
    end
  end

  defp take_over(conn, account_id, key) do
    Repo.query!("DELETE FROM idempotency_keys WHERE account_id = $1 AND key = $2", [
      dump(account_id),
      key
    ])

    claim(conn, account_id, key)
  end

  defp store(conn, account_id, key) do
    body = IO.iodata_to_binary(conn.resp_body || "")

    if conn.status < 500 and byte_size(body) <= @max_body do
      Repo.query!(
        "UPDATE idempotency_keys SET status = $3, body = $4 WHERE account_id = $1 AND key = $2",
        [dump(account_id), key, conn.status, body]
      )
    else
      Repo.query!("DELETE FROM idempotency_keys WHERE account_id = $1 AND key = $2", [
        dump(account_id),
        key
      ])
    end

    conn
  rescue
    # never fail the answer itself because the key could not be saved
    _ -> conn
  end

  defp error(conn, status, code, message) do
    conn
    |> put_status(status)
    |> Phoenix.Controller.json(%{error: %{code: code, message: message}})
    |> halt()
  end

  defp request_hash(conn) do
    :crypto.hash(
      :sha256,
      :erlang.term_to_binary({conn.request_path, conn.body_params}, [:deterministic])
    )
  end

  defp dump(id), do: Ecto.UUID.dump!(id)

  @doc "Retention: keys and stored answers 24 h (ExpirySweep)."
  def sweep,
    do: Repo.query!("DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours'")
end
