defmodule Thirstr.Linked do
  @moduledoc """
  I-01 linked accounts and I-02 profile share links (beta-build-plan.md › B4d).

  Bluesky handles are proven with a one-time code in the public bio, read from the public
  AppView; other platforms are shown as plain links without ✓ in beta.
  """
  alias Thirstr.{Repo, Storage}
  alias Thirstr.Accounts.Account

  @platforms ~w(x bluesky onlyfans jff instagram)
  @visibility ~w(everyone verified chats)
  @max_per_profile 5
  @recheck_days 90

  # ------------------------------------------------------------------ linked accounts

  def list(%Account{} = a, profile_id) do
    with :ok <- own(a, profile_id) do
      rows =
        q!(
          "SELECT id, platform, handle, visibility, verified_at IS NOT NULL, code FROM linked_accounts WHERE profile_id = $1 ORDER BY created_at",
          [uuid(profile_id)]
        )

      {:ok,
       %{
         linked:
           Enum.map(rows, fn [id, p, h, v, ok, code] ->
             %{
               id: cast(id),
               platform: p,
               handle: h,
               visibility: v,
               verified: ok,
               code: if(p == "bluesky" and not ok, do: code)
             }
           end)
       }}
    end
  end

  def add(%Account{} = a, %{"profile_id" => pid, "platform" => p, "handle" => h} = params)
      when p in @platforms and is_binary(h) do
    vis = params["visibility"] || "chats"
    handle = h |> String.trim() |> String.trim_leading("@") |> String.downcase()

    with :ok <- own(a, pid),
         true <- vis in @visibility || {:error, {:validation, %{visibility: ["invalid"]}}},
         true <-
           Regex.match?(~r/^[a-z0-9._-]{1,64}$/, handle) ||
             {:error, {:validation, %{handle: ["invalid"]}}},
         [[n]] = q!("SELECT count(*) FROM linked_accounts WHERE profile_id = $1", [uuid(pid)]),
         true <-
           n < @max_per_profile || {:error, {:conflict, "Up to 5 linked accounts per profile."}} do
      id = Ecto.UUID.generate()

      code =
        "thirstr-" <>
          (:crypto.strong_rand_bytes(4) |> Base.encode32(case: :lower, padding: false))

      case Repo.query(
             "INSERT INTO linked_accounts (id, profile_id, platform, handle, code, visibility, created_at) VALUES ($1, $2, $3, $4, $5, $6, now())",
             [uuid(id), uuid(pid), p, handle, code, vis]
           ) do
        {:ok, _} ->
          proof = if p == "bluesky", do: "bio_code", else: "none"
          {:ok, %{id: id, proof_method: proof, code: if(proof == "bio_code", do: code)}}

        {:error, _} ->
          {:error, :conflict}
      end
    end
  end

  def add(_, _),
    do: {:error, {:validation, %{platform: ["x, bluesky, onlyfans, jff or instagram"]}}}

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

  def verify(%Account{} = a, id) do
    mine(a, id, fn ->
      [[p, h, code]] =
        q!("SELECT platform, handle, code FROM linked_accounts WHERE id = $1", [uuid(id)])

      ok = p == "bluesky" and bio_has?(h, code)

      q!(
        "UPDATE linked_accounts SET verified_at = CASE WHEN $2 THEN coalesce(verified_at, now()) ELSE NULL END, checked_at = now() WHERE id = $1",
        [uuid(id), ok]
      )

      {:ok, %{verified: ok}}
    end)
  end

  @doc "R-I01.8: re-check proven Bluesky links every 90 days (daily sweep)."
  def recheck do
    for [id, h, code] <-
          q!(
            "SELECT id, handle, code FROM linked_accounts WHERE platform = 'bluesky' AND verified_at IS NOT NULL AND checked_at < now() - make_interval(days => $1) LIMIT 200",
            [@recheck_days]
          ) do
      ok = bio_has?(h, code)

      q!(
        "UPDATE linked_accounts SET verified_at = CASE WHEN $2 THEN verified_at ELSE NULL END, checked_at = now() WHERE id = $1",
        [id, ok]
      )
    end

    :ok
  end

  @doc "Profile view: links the viewer may see (R-I01.7)."
  def visible(profile_id, %Account{} = viewer, audience, self?) do
    rows =
      q!(
        """
        SELECT l.platform, l.handle, l.verified_at IS NOT NULL, l.visibility,
               EXISTS (SELECT 1 FROM contacts c JOIN profiles v ON v.account_id = $2
                       WHERE (c.profile_a = l.profile_id AND c.profile_b = v.id)
                          OR (c.profile_b = l.profile_id AND c.profile_a = v.id))
        FROM linked_accounts l WHERE l.profile_id = $1 ORDER BY l.created_at
        """,
        [uuid(profile_id), uuid(viewer.id)]
      )

    for [p, h, ok, vis, chat] <- rows,
        self? or vis == "everyone" or (vis == "verified" and audience == :verified) or
          (vis == "chats" and chat),
        do: %{platform: p, handle: h, verified: ok, url: url(p, h)}
  end

  def url("x", h), do: "https://x.com/" <> h
  def url("bluesky", h), do: "https://bsky.app/profile/" <> h
  def url("onlyfans", h), do: "https://onlyfans.com/" <> h
  def url("jff", h), do: "https://justfor.fans/" <> h
  def url("instagram", h), do: "https://instagram.com/" <> h

  defp bio_has?(handle, code) do
    case Application.get_env(:thirstr, :bluesky_bio) do
      f when is_function(f, 1) ->
        String.contains?(f.(handle) || "", code)

      _ ->
        case Req.get("https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile",
               params: [actor: handle],
               retry: false,
               receive_timeout: 8000
             ) do
          {:ok, %{status: 200, body: %{"description" => d}}} when is_binary(d) ->
            String.contains?(d, code)

          _ ->
            false
        end
    end
  end

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
