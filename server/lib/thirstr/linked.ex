defmodule Thirstr.Linked do
  @moduledoc """
  I-01 linked accounts (#17) and I-02 profile share links (beta-build-plan.md › B4d).

  Proof (R-I01.17): Bluesky = one-time code in the public bio or display name, read from the
  public AppView, account kept by DID; X = OAuth 2.0 + PKCE, the server reads `/2/users/me` once and
  revokes the token (only id + username kept); OnlyFans / JustFor.Fans = code in the public bio,
  read from the fixed public profile URL, unreadable pages go to the hand-check queue (admin
  console). Instagram is a plain link. The server only ever fetches these fixed profile URLs, never
  a link someone shares in a chat (R-I01.31).
  """
  alias Thirstr.{Flags, Repo, Storage}
  alias Thirstr.Accounts.Account

  @platforms ~w(x bluesky onlyfans jff instagram)
  @adult ~w(onlyfans jff)
  @visibility ~w(everyone verified chats)
  @max_per_profile 5
  @recheck_days 90
  @handle ~r/^[a-z0-9._-]{1,64}$/
  @x_scopes "users.read tweet.read"
  @x_off {:unavailable, "Sign in with X isn't set up yet"}
  @taken {:conflict_code, "taken", "This account is already proven on Thirstr."}

  def platforms, do: @platforms
  def adult?(p), do: p in @adult

  # ------------------------------------------------------------------ linked accounts

  def list(%Account{} = a, profile_id) do
    with :ok <- own(a, profile_id) do
      rows =
        q!(
          """
          SELECT id, platform, handle, visibility, verified_at IS NOT NULL, code, proof,
                 manual_pending_at IS NOT NULL, hidden_at IS NOT NULL
          FROM linked_accounts WHERE profile_id = $1 ORDER BY created_at
          """,
          [uuid(profile_id)]
        )

      {:ok,
       %{
         linked:
           Enum.map(rows, fn [id, p, h, v, ok, code, proof, manual, hidden] ->
             proof = proof || proof_method(p)

             %{
               id: cast(id),
               platform: p,
               handle: h,
               visibility: v,
               verified: ok,
               proof: proof,
               state: state(ok, manual),
               hidden: hidden,
               code: if(proof == "bio_code" and not ok, do: code)
             }
           end)
       }}
    end
  end

  defp state(true, _), do: "proven"
  defp state(false, true), do: "manual_pending"
  defp state(false, false), do: "unproven"

  def proof_method("bluesky"), do: "bio_code"
  def proof_method("x"), do: "oauth"
  def proof_method(p) when p in @adult, do: "bio_code"
  def proof_method(_), do: "none"

  @doc "R-I01.15: add a link. `ctx` is the request's client context (R-I01.30 store-review flag)."
  def add(a, params, ctx \\ %{})

  def add(%Account{} = a, %{"profile_id" => pid, "platform" => p, "handle" => h} = params, ctx)
      when p in @platforms and is_binary(h) do
    vis = params["visibility"] || "chats"
    handle = normalize_handle(p, h)

    with :ok <- own(a, pid),
         :ok <- adult_ok(a, p, ctx),
         true <- vis in @visibility || {:error, {:validation, %{visibility: ["invalid"]}}},
         true <-
           Regex.match?(@handle, handle) || {:error, {:validation, %{handle: ["invalid"]}}},
         [[n, same]] =
           q!(
             "SELECT count(*), count(*) FILTER (WHERE platform = $2) FROM linked_accounts WHERE profile_id = $1",
             [uuid(pid), p]
           ),
         true <-
           n < @max_per_profile || {:error, {:conflict, "Up to 5 linked accounts per profile."}},
         true <- same == 0 || {:error, {:conflict, "You already linked this platform."}} do
      id = Ecto.UUID.generate()
      code = new_code()
      proof = proof_method(p)

      case Repo.query(
             "INSERT INTO linked_accounts (id, profile_id, platform, handle, code, visibility, proof, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, now())",
             [uuid(id), uuid(pid), p, handle, code, vis, proof]
           ) do
        {:ok, _} ->
          {:ok, %{id: id, proof_method: proof, code: if(proof == "bio_code", do: code)}}

        {:error, _} ->
          {:error, :conflict}
      end
    end
  end

  def add(_, _, _),
    do: {:error, {:validation, %{platform: ["x, bluesky, onlyfans, jff or instagram"]}}}

  @doc "A pasted profile URL becomes the handle (R-I01.15): `https://bsky.app/profile/max.bsky.social` → `max.bsky.social`."
  def normalize_handle(p, h) do
    h = h |> String.trim() |> String.downcase()

    h =
      case URI.parse(h) do
        %URI{host: host, path: path} when is_binary(host) and is_binary(path) ->
          segs = String.split(path, "/", trim: true)

          case {p, segs} do
            {"bluesky", ["profile", handle | _]} -> handle
            {_, [handle | _]} -> handle
            _ -> h
          end

        _ ->
          h
      end

    String.trim_leading(h, "@")
  end

  defp new_code,
    do:
      "thirstr-" <> (:crypto.strong_rand_bytes(4) |> Base.encode32(case: :lower, padding: false))

  # R-I01.28 / R-I01.30: no OnlyFans / JustFor.Fans in Safe Mode or on a build under store review.
  defp adult_ok(%Account{} = a, p, ctx) when p in @adult do
    if Account.safe_mode_on?(a) or not Flags.enabled?("adult_links", ctx),
      do: {:error, {:unprocessable, "unavailable", "Not available here"}},
      else: :ok
  end

  defp adult_ok(_, _, _), do: :ok

  def update(%Account{} = a, id, %{"visibility" => v}) when v in @visibility do
    mine(a, id, fn ->
      q!("UPDATE linked_accounts SET visibility = $2 WHERE id = $1", [uuid(id), v])
      :ok
    end)
  end

  def update(_, _, _), do: {:error, {:validation, %{visibility: ["invalid"]}}}

  def remove(%Account{} = a, id) do
    mine(a, id, fn ->
      q!("DELETE FROM linked_accounts WHERE id = $1", [uuid(id)])
      :ok
    end)
  end

  @doc "POST /me/linked-accounts/:id/verify (R-I01.17–20). Limit 10/h per account."
  def verify(%Account{} = a, id) do
    mine(a, id, fn ->
      with {:ok, _} <- limit_ok(Thirstr.Valkey.hit("lnkv:#{a.id}", 10, 3600)) do
        [[p, h, code, ok]] =
          q!(
            "SELECT platform, handle, code, verified_at IS NOT NULL FROM linked_accounts WHERE id = $1",
            [uuid(id)]
          )

        if ok, do: {:ok, %{verified: true, state: "proven"}}, else: check(id, p, h, code)
      end
    end)
  end

  defp limit_ok({:ok, n}), do: {:ok, n}
  defp limit_ok({:error, :rate_limited, retry}), do: {:error, {:rate_limited, retry}}

  defp check(id, "bluesky", h, code) do
    case bluesky_profile(h) do
      %{"did" => did} = prof when is_binary(did) ->
        text = "#{prof["description"]} #{prof["displayName"]}"

        if String.contains?(text, code),
          do: prove(id, did, prof["handle"]),
          else: not_found(id)

      _ ->
        not_found(id)
    end
  end

  defp check(id, p, h, code) when p in @adult do
    case page_has?(p, h, code) do
      true ->
        prove(id, h, nil)

      _ ->
        # R-I01.17: bot walls and JS-only pages can't be read → checked by hand (24 h).
        q!(
          "UPDATE linked_accounts SET manual_pending_at = coalesce(manual_pending_at, now()), checked_at = now() WHERE id = $1",
          [uuid(id)]
        )

        {:ok, %{verified: false, state: "manual_pending"}}
    end
  end

  defp check(_id, _p, _h, _code), do: {:ok, %{verified: false, state: "unproven"}}

  defp not_found(id) do
    q!("UPDATE linked_accounts SET checked_at = now() WHERE id = $1", [uuid(id)])
    {:ok, %{verified: false, state: "unproven"}}
  end

  # R-I01.20: one platform account can be proven by one Thirstr profile only.
  defp prove(id, platform_user_id, new_handle) do
    case Repo.query(
           """
           UPDATE linked_accounts
              SET verified_at = now(), checked_at = now(), platform_user_id = $2, manual_pending_at = NULL,
                  handle = coalesce($3, handle)
            WHERE id = $1
           """,
           [uuid(id), platform_user_id, new_handle && String.downcase(new_handle)]
         ) do
      {:ok, _} -> {:ok, %{verified: true, state: "proven"}}
      {:error, %{postgres: %{code: :unique_violation}}} -> {:error, @taken}
    end
  end

  # ------------------------------------------------------------------ X OAuth (R-I01.17)

  @doc "POST /me/linked-accounts/x/start → {authorize_url, state}."
  def x_start(%Account{} = a, %{"profile_id" => pid} = params) do
    vis = params["visibility"] || "chats"

    with :ok <- own(a, pid),
         true <- vis in @visibility || {:error, {:validation, %{visibility: ["invalid"]}}},
         %{client_id: cid, redirect_uri: redirect} <- x_conf() || {:error, @x_off} do
      state = rand(24)
      verifier = rand(48)
      challenge = :crypto.hash(:sha256, verifier) |> Base.url_encode64(padding: false)

      q!(
        "DELETE FROM x_oauth_pending WHERE created_at < now() - interval '10 minutes' OR account_id = $1",
        [uuid(a.id)]
      )

      q!(
        "INSERT INTO x_oauth_pending (state, account_id, profile_id, verifier, visibility, created_at) VALUES ($1, $2, $3, $4, $5, now())",
        [state, uuid(a.id), uuid(pid), verifier, vis]
      )

      query =
        URI.encode_query(%{
          "response_type" => "code",
          "client_id" => cid,
          "redirect_uri" => redirect,
          "scope" => @x_scopes,
          "state" => state,
          "code_challenge" => challenge,
          "code_challenge_method" => "S256"
        })

      {:ok, %{authorize_url: "https://x.com/i/oauth2/authorize?" <> query, state: state}}
    end
  end

  def x_start(_, _), do: {:error, {:validation, %{profile_id: ["required"]}}}

  @doc "POST /me/linked-accounts/x/finish {state, code}: exchange, read id + username, revoke (AC-I01.2)."
  def x_finish(%Account{} = a, %{"state" => state, "code" => code})
      when is_binary(state) and is_binary(code) do
    case q!(
           "DELETE FROM x_oauth_pending WHERE state = $1 AND account_id = $2 AND created_at > now() - interval '10 minutes' RETURNING profile_id, verifier, visibility",
           [state, uuid(a.id)]
         ) do
      [[pid, verifier, vis]] ->
        with %{} = conf <- x_conf() || {:error, @x_off},
             {:ok, %{id: xid, username: name}} <- x_identity(conf, code, verifier) do
          link_x(cast(pid), xid, String.downcase(name), vis)
        end

      [] ->
        {:error, :not_found}
    end
  end

  def x_finish(_, _), do: {:error, {:validation, %{code: ["required"]}}}

  defp link_x(pid, xid, name, vis) do
    id = Ecto.UUID.generate()

    Repo.transaction(fn ->
      q!("DELETE FROM linked_accounts WHERE profile_id = $1 AND platform = 'x'", [uuid(pid)])

      case Repo.query(
             """
             INSERT INTO linked_accounts (id, profile_id, platform, handle, code, visibility, proof, platform_user_id,
                                          verified_at, checked_at, created_at)
             VALUES ($1, $2, 'x', $3, $4, $5, 'oauth', $6, now(), now(), now())
             """,
             [uuid(id), uuid(pid), name, new_code(), vis, xid]
           ) do
        {:ok, _} -> %{id: id, verified: true, state: "proven"}
        {:error, _} -> Repo.rollback(@taken)
      end
    end)
  end

  defp x_conf do
    case System.get_env("X_CLIENT_ID") do
      cid when is_binary(cid) and cid != "" ->
        %{
          client_id: cid,
          secret: System.get_env("X_CLIENT_SECRET"),
          redirect_uri: System.get_env("X_REDIRECT_URI", "app.thirstr://oauth/x")
        }

      _ ->
        Application.get_env(:thirstr, :x_conf)
    end
  end

  defp x_identity(conf, code, verifier) do
    case Application.get_env(:thirstr, :x_identity) do
      f when is_function(f, 2) -> f.(code, verifier)
      _ -> x_identity_live(conf, code, verifier)
    end
  end

  defp x_identity_live(conf, code, verifier) do
    auth = if conf.secret, do: [auth: {:basic, "#{conf.client_id}:#{conf.secret}"}], else: []

    token =
      Req.post(
        "https://api.x.com/2/oauth2/token",
        [
          form: [
            code: code,
            grant_type: "authorization_code",
            client_id: conf.client_id,
            redirect_uri: conf.redirect_uri,
            code_verifier: verifier
          ],
          retry: false,
          receive_timeout: 8000
        ] ++ auth
      )

    case token do
      {:ok, %{status: 200, body: %{"access_token" => tok}}} -> x_me_and_revoke(conf, tok, auth)
      _ -> {:error, {:unprocessable, "x_denied", "X sign-in didn't finish"}}
    end
  end

  defp x_me_and_revoke(conf, tok, auth) do
    me =
      Req.get("https://api.x.com/2/users/me",
        auth: {:bearer, tok},
        retry: false,
        receive_timeout: 8000
      )

    # The token is never stored or logged; revoke it whatever /users/me answered.
    Req.post(
      "https://api.x.com/2/oauth2/revoke",
      [
        form: [token: tok, token_type_hint: "access_token", client_id: conf.client_id],
        retry: false,
        receive_timeout: 8000
      ] ++ auth
    )

    case me do
      {:ok, %{status: 200, body: %{"data" => %{"id" => id, "username" => name}}}} ->
        {:ok, %{id: id, username: name}}

      _ ->
        {:error, {:unprocessable, "x_failed", "X didn't answer. Try again."}}
    end
  end

  defp rand(n), do: :crypto.strong_rand_bytes(n) |> Base.url_encode64(padding: false)

  # ------------------------------------------------------------------ re-check + hand check

  @doc "R-I01.19: daily sweep, proven links older than 90 days (≤ 200 per run)."
  def recheck do
    for [id, p, h, did] <-
          q!(
            """
            SELECT id, platform, handle, platform_user_id FROM linked_accounts
            WHERE verified_at IS NOT NULL AND platform IN ('bluesky', 'onlyfans', 'jff')
              AND checked_at < now() - make_interval(days => $1) LIMIT 200
            """,
            [@recheck_days]
          ) do
      recheck_one(id, p, h, did)
    end

    :ok
  end

  defp recheck_one(id, "bluesky", h, did) do
    case bluesky_profile(did || h) do
      %{"handle" => new} when is_binary(new) ->
        q!(
          "UPDATE linked_accounts SET handle = $2, checked_at = now() WHERE id = $1",
          [id, String.downcase(new)]
        )

      _ ->
        q!(
          "UPDATE linked_accounts SET verified_at = NULL, checked_at = now() WHERE id = $1",
          [id]
        )
    end
  end

  defp recheck_one(id, p, h, _) do
    # A bot wall never silently drops the ✓: the link goes to the hand-check queue instead.
    if page_exists?(p, h),
      do: q!("UPDATE linked_accounts SET checked_at = now() WHERE id = $1", [id]),
      else:
        q!(
          "UPDATE linked_accounts SET manual_pending_at = now(), checked_at = now() WHERE id = $1",
          [id]
        )
  end

  @doc "Admin console A-03b: links waiting for a hand check (oldest first)."
  def manual_queue do
    q!(
      "SELECT id, platform, handle, code, manual_pending_at FROM linked_accounts WHERE manual_pending_at IS NOT NULL ORDER BY manual_pending_at LIMIT 100",
      []
    )
    |> Enum.map(fn [id, p, h, code, at] ->
      %{id: cast(id), platform: p, handle: h, code: code, at: at, url: url(p, h)}
    end)
  end

  def manual_decision(id, "approve") do
    with {:ok, _} <- Ecto.UUID.cast(id),
         [[h]] <- q!("SELECT handle FROM linked_accounts WHERE id = $1", [uuid(id)]) do
      prove(id, h, nil)
    else
      _ -> {:error, :not_found}
    end
  end

  def manual_decision(id, "reject") do
    with {:ok, _} <- Ecto.UUID.cast(id) do
      q!(
        "UPDATE linked_accounts SET manual_pending_at = NULL, verified_at = NULL WHERE id = $1",
        [uuid(id)]
      )

      :ok
    end
  end

  @doc "R-I01.24: ≥ 2 independent impersonation reports on a linked account → ✓ off, chip hidden."
  def impersonation_reported(target_profile, platform) when platform in @platforms do
    [[n]] =
      q!(
        """
        SELECT count(DISTINCT reporter_account) FROM reports
        WHERE target_profile = $1 AND reason = 'impersonation' AND state = 'open' AND note LIKE $2
        """,
        [uuid(target_profile), "linked:#{platform}%"]
      )

    if n >= 2,
      do:
        q!(
          "UPDATE linked_accounts SET verified_at = NULL, hidden_at = coalesce(hidden_at, now()) WHERE profile_id = $1 AND platform = $2",
          [uuid(target_profile), platform]
        )

    :ok
  end

  def impersonation_reported(_, _), do: :ok

  # ------------------------------------------------------------------ profile view

  @doc """
  Profile view: links the viewer may see (R-I01.16). Hidden after reports, OnlyFans / JustFor.Fans
  only in the Hookup lens and never while the owner is in Safe Mode (R-I01.28–29).
  """
  def visible(profile_id, %Account{} = viewer, audience, self?, lens \\ "hookup") do
    rows =
      q!(
        """
        SELECT l.platform, l.handle, l.verified_at IS NOT NULL, l.visibility,
               EXISTS (SELECT 1 FROM contacts c JOIN profiles v ON v.account_id = $2
                       WHERE (c.profile_a = l.profile_id AND c.profile_b = v.id)
                          OR (c.profile_b = l.profile_id AND c.profile_a = v.id)),
               (a.safe_mode = 'on' OR a.safe_mode_active)
        FROM linked_accounts l JOIN profiles p ON p.id = l.profile_id JOIN accounts a ON a.id = p.account_id
        WHERE l.profile_id = $1 AND l.hidden_at IS NULL ORDER BY l.created_at
        """,
        [uuid(profile_id), uuid(viewer.id)]
      )

    for [p, h, ok, vis, chat, safe] <- rows,
        self? or vis == "everyone" or (vis == "verified" and audience == :verified) or
          (vis == "chats" and chat),
        p not in @adult or (lens == "hookup" and not safe),
        do: %{platform: p, handle: h, verified: ok, url: url(p, h)}
  end

  @doc "R-I01.30: the build under store review gets no OnlyFans / JustFor.Fans."
  def for_client(links, ctx) when is_list(links) do
    if Flags.enabled?("adult_links", ctx),
      do: links,
      else: Enum.reject(links, &(&1.platform in @adult))
  end

  def for_client(links, _), do: links

  def url("x", h), do: "https://x.com/" <> h
  def url("bluesky", h), do: "https://bsky.app/profile/" <> h
  def url("onlyfans", h), do: "https://onlyfans.com/" <> h
  def url("jff", h), do: "https://justfor.fans/" <> h
  def url("instagram", h), do: "https://instagram.com/" <> h

  # ------------------------------------------------------------------ fixed-host fetches (R-I01.31)

  defp bluesky_profile(actor) do
    cond do
      f = Application.get_env(:thirstr, :bluesky_profile) ->
        f.(actor)

      f = Application.get_env(:thirstr, :bluesky_bio) ->
        case f.(actor) do
          d when is_binary(d) -> %{"did" => "did:plc:test-" <> actor, "description" => d}
          _ -> nil
        end

      true ->
        case Req.get("https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile",
               params: [actor: actor],
               retry: false,
               redirect: false,
               receive_timeout: 8000
             ) do
          {:ok, %{status: 200, body: %{"did" => _} = body}} -> body
          _ -> nil
        end
    end
  end

  defp page(p, h) do
    case Application.get_env(:thirstr, :creator_page) do
      f when is_function(f, 2) ->
        f.(p, h)

      _ ->
        if Regex.match?(@handle, h) do
          case Req.get(url(p, h),
                 retry: false,
                 redirect: false,
                 receive_timeout: 8000,
                 max_retries: 0,
                 headers: [{"user-agent", "Mozilla/5.0 (compatible; Thirstr-Proof)"}]
               ) do
            {:ok, %{status: 200, body: b}} when is_binary(b) ->
              {:ok, binary_part(b, 0, min(byte_size(b), 1_000_000))}

            {:ok, %{status: s}} ->
              {:status, s}

            _ ->
              :error
          end
        else
          :error
        end
    end
  end

  defp page_has?(p, h, code) do
    case page(p, h) do
      {:ok, body} -> String.contains?(body, code)
      _ -> false
    end
  end

  defp page_exists?(p, h), do: match?({:ok, _}, page(p, h))

  # ------------------------------------------------------------------ share links (I-02)

  @alphabet ~c"abcdefghijkmnpqrstuvwxyz23456789"

  def share(%Account{} = a, profile_id) do
    with :ok <- own(a, profile_id) do
      slug = for _ <- 1..10, into: "", do: <<Enum.random(@alphabet)>>

      q!(
        "INSERT INTO profile_shares (slug, profile_id, created_at) VALUES ($1, $2, now()) ON CONFLICT (profile_id) DO UPDATE SET slug = EXCLUDED.slug, created_at = now()",
        [slug, uuid(profile_id)]
      )

      {:ok, %{slug: slug, url: site() <> "/p/" <> slug}}
    end
  end

  def unshare(%Account{} = a, profile_id) do
    with :ok <- own(a, profile_id) do
      q!("DELETE FROM profile_shares WHERE profile_id = $1", [uuid(profile_id)])
      :ok
    end
  end

  def current_share(profile_id) do
    case q!("SELECT slug FROM profile_shares WHERE profile_id = $1", [uuid(profile_id)]) do
      [[s]] -> %{slug: s, url: site() <> "/p/" <> s}
      [] -> nil
    end
  end

  @doc "Public page data: only active, visible profiles (paused/banned/quarantined → nil)."
  def page(slug) when is_binary(slug) and byte_size(slug) == 10 do
    case q!(
           """
           SELECT p.id, p.display_name,
                  (SELECT storage_key FROM photos ph WHERE ph.profile_id = p.id AND ph.status = 'ok_main' ORDER BY slot LIMIT 1)
           FROM profile_shares s JOIN profiles p ON p.id = s.profile_id JOIN accounts a ON a.id = p.account_id
           WHERE s.slug = $1 AND a.status = 'active'
           """,
           [slug]
         ) do
      [[id, name, key]] ->
        %{profile_id: cast(id), name: name, photo: key && Storage.presigned_get(key)}

      [] ->
        nil
    end
  end

  def page(_), do: nil

  def resolve(slug) do
    case page(slug) do
      %{profile_id: id} -> {:ok, %{profile_id: id}}
      nil -> {:error, :not_found}
    end
  end

  defp site do
    case Application.get_env(:thirstr, :site_host) do
      nil -> ThirstrWeb.Endpoint.url()
      h -> "https://" <> h
    end
  end

  # ------------------------------------------------------------------ helpers

  defp own(%Account{} = a, pid) do
    with {:ok, _} <- Ecto.UUID.cast(pid),
         [[1]] <-
           q!("SELECT 1 FROM profiles WHERE id = $1 AND account_id = $2", [uuid(pid), uuid(a.id)]) do
      :ok
    else
      _ -> {:error, :not_found}
    end
  end

  defp mine(%Account{} = a, id, fun) do
    with {:ok, _} <- Ecto.UUID.cast(id),
         [[1]] <-
           q!(
             "SELECT 1 FROM linked_accounts l JOIN profiles p ON p.id = l.profile_id WHERE l.id = $1 AND p.account_id = $2",
             [uuid(id), uuid(a.id)]
           ) do
      fun.()
    else
      _ -> {:error, :not_found}
    end
  end

  defp uuid(id), do: Ecto.UUID.dump!(id)
  defp cast(bin), do: Ecto.UUID.cast!(bin)

  # Every caller passes a literal SQL string; values always go through parameters.
  # sobelow_skip ["SQL.Query"]
  defp q!(sql, args), do: Repo.query!(sql, args).rows
end
