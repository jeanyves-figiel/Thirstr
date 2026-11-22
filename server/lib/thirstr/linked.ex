defmodule Thirstr.Linked do
  @moduledoc """
  I-01 linked accounts and I-02 profile share links (beta-build-plan.md › B4d).

  Bluesky handles are proven with a one-time code in the public bio, read from the public
  AppView; other platforms are shown as plain links without ✓ in beta.
  """
  alias Thirstr.Accounts.Account
  alias Thirstr.Repo

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

  @alphabet "abcdefghijkmnpqrstuvwxyz23456789"
  @preview_max 2048
  @preview_side 32

  @doc "R-I02.1: 10 chars from a 32-letter alphabet, CSPRNG (32 divides 256, so no bias)."
  def new_slug do
    for <<b <- :crypto.strong_rand_bytes(10)>>, into: "", do: String.at(@alphabet, rem(b, 32))
  end

  @doc "Creates or renews the link. Renew keeps show_photo and drops the old preview."
  def share(%Account{} = a, profile_id) do
    with :ok <- own(a, profile_id) do
      q!(
        "INSERT INTO profile_shares (slug, profile_id, created_at) VALUES ($1, $2, now()) ON CONFLICT (profile_id) DO UPDATE SET slug = EXCLUDED.slug, created_at = now(), preview = NULL, preview_photo_id = NULL",
        [new_slug(), uuid(profile_id)]
      )

      {:ok, current_share(profile_id)}
    end
  end

  def unshare(%Account{} = a, profile_id) do
    with :ok <- own(a, profile_id) do
      q!("DELETE FROM profile_shares WHERE profile_id = $1", [uuid(profile_id)])
      :ok
    end
  end

  @doc "R-I02.2: name only, or name + blurred photo."
  def set_show_photo(%Account{} = a, profile_id, show) when is_boolean(show) do
    with :ok <- own(a, profile_id),
         [_] <-
           q!("UPDATE profile_shares SET show_photo = $2 WHERE profile_id = $1 RETURNING 1", [
             uuid(profile_id),
             show
           ]) do
      {:ok, current_share(profile_id)}
    else
      [] -> {:error, :not_found}
      e -> e
    end
  end

  def set_show_photo(_, _, _),
    do: {:error, {:unprocessable, "validation", "show_photo must be true or false"}}

  @doc """
  R-I02.2: the phone sends a tiny JPEG of its approved main photo (≤ 2 KB, ≤ 32 px each side).
  Only that goes on the public page, never the photo itself or a link to it.
  """
  def put_preview(%Account{} = a, profile_id, photo_id, b64)
      when is_binary(photo_id) and is_binary(b64) do
    with :ok <- own(a, profile_id),
         {:ok, jpeg} <- decode_preview(b64),
         {:ok, _} <- Ecto.UUID.cast(photo_id),
         [[1]] <-
           q!(
             "SELECT 1 FROM photos WHERE id = $1 AND profile_id = $2 AND status = 'ok_main'",
             [uuid(photo_id), uuid(profile_id)]
           ),
         [_] <-
           q!(
             "UPDATE profile_shares SET preview = $3, preview_photo_id = $2 WHERE profile_id = $1 RETURNING 1",
             [uuid(profile_id), uuid(photo_id), jpeg]
           ) do
      :ok
    else
      {:error, _} = e -> e
      _ -> {:error, :not_found}
    end
  end

  def put_preview(_, _, _, _), do: bad_preview()

  defp decode_preview(b64) do
    with true <- byte_size(b64) <= div(@preview_max * 4, 3) + 4,
         {:ok, bin} <- Base.decode64(b64, ignore: :whitespace),
         true <- byte_size(bin) <= @preview_max,
         {:ok, w, h} <- jpeg_size(bin),
         true <- w in 1..@preview_side and h in 1..@preview_side do
      {:ok, bin}
    else
      _ -> bad_preview()
    end
  end

  defp bad_preview,
    do: {:error, {:unprocessable, "validation", "Preview must be a JPEG up to 32 px and 2 KB"}}

  @doc "Width and height from a JPEG's first SOF marker (baseline or progressive)."
  def jpeg_size(<<0xFF, 0xD8, rest::binary>>), do: scan_jpeg(rest)
  def jpeg_size(_), do: :error

  defp scan_jpeg(<<0xFF, m, _len::16, _p, h::16, w::16, _::binary>>) when m in 0xC0..0xC3,
    do: {:ok, w, h}

  defp scan_jpeg(<<0xFF, 0xFF, rest::binary>>), do: scan_jpeg(<<0xFF, rest::binary>>)

  defp scan_jpeg(<<0xFF, m, len::16, rest::binary>>)
       when m not in [0xD8, 0xD9, 0xDA] and len >= 2 do
    case rest do
      <<_::binary-size(len - 2), more::binary>> -> scan_jpeg(more)
      _ -> :error
    end
  end

  defp scan_jpeg(_), do: :error

  def current_share(profile_id) do
    case q!(
           """
           SELECT slug, show_photo,
                  COALESCE(preview IS NOT NULL AND preview_photo_id = (SELECT ph.id FROM photos ph WHERE ph.profile_id = $1 AND ph.status = 'ok_main' ORDER BY ph.slot LIMIT 1), false)
           FROM profile_shares WHERE profile_id = $1
           """,
           [uuid(profile_id)]
         ) do
      [[s, show, has]] ->
        %{
          slug: s,
          url: site() <> "/p/" <> s,
          short: short_host() <> "/p/" <> s,
          show_photo: show,
          has_preview: has
        }

      [] ->
        nil
    end
  end

  @doc """
  Public page data: only active accounts (paused / suspended / quarantined / banned / deleted → nil).
  The preview shows only while it still comes from the approved main photo.
  """
  def page(slug) when is_binary(slug) and byte_size(slug) == 10 do
    case q!(
           """
           SELECT p.id, p.display_name,
                  CASE WHEN s.show_photo AND s.preview_photo_id = (SELECT ph.id FROM photos ph WHERE ph.profile_id = p.id AND ph.status = 'ok_main' ORDER BY ph.slot LIMIT 1)
                       THEN s.preview END
           FROM profile_shares s JOIN profiles p ON p.id = s.profile_id JOIN accounts a ON a.id = p.account_id
           WHERE s.slug = $1 AND a.status = 'active'
           """,
           [slug]
         ) do
      [[id, name, preview]] -> %{profile_id: cast(id), name: name, preview: preview}
      [] -> nil
    end
  end

  def page(_), do: nil

  @doc "R-I02.3: in-app open. Blocked either way, own-only or dead → the same not_found."
  def resolve(%Account{} = viewer, slug) do
    with %{profile_id: id} <- page(slug),
         [[owner]] <- q!("SELECT account_id FROM profiles WHERE id = $1", [uuid(id)]),
         owner = cast(owner),
         false <- owner != viewer.id and Thirstr.Social.blocked?(viewer.id, owner) do
      {:ok, %{profile_id: id, own: owner == viewer.id}}
    else
      _ -> {:error, :not_found}
    end
  end

  defp short_host do
    case Application.get_env(:thirstr, :site_host) do
      nil -> ThirstrWeb.Endpoint.url() |> String.replace(~r{^https?://}, "")
      h -> h
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
