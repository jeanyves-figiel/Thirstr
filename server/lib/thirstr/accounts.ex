defmodule Thirstr.Accounts do
  @moduledoc """
  F-01 Auth & account: account lifecycle, devices and sessions.
  Spec: docs/spec/features/F01-auth.md.
  """
  import Ecto.Query
  alias Ecto.Multi
  alias Thirstr.{Ids, Repo, Valkey}
  alias Thirstr.Accounts.{Account, Device, Passkey, RefreshToken}

  @type session :: %{
          access_token: String.t(),
          refresh_token: String.t(),
          expires_in: pos_integer(),
          account: Account.t()
        }

  # ---------------------------------------------------------------- accounts

  def get_account(id), do: Repo.get(Account, id)

  @doc "Creates an account. R-01.12: the 18+ checkbox is mandatory on sign-up."
  def create_account(attrs, opts \\ []) do
    if opts[:age_confirmed] == true do
      %Account{age_confirmed_at: DateTime.utc_now()}
      |> Account.changeset(attrs)
      |> Repo.insert()
    else
      {:error, :age_confirmation_required}
    end
  end

  def find_or_create_by(field, hash, opts) when field in [:email_hash, :auth_oidc_hash] do
    case Repo.get_by(Account, [{field, hash}]) do
      %Account{status: s} when s in ~w(banned deleted) -> {:error, :forbidden}
      %Account{} = a -> {:ok, a, :existing}
      nil -> with {:ok, a} <- create_account(%{field => hash}, opts), do: {:ok, a, :created}
    end
  end

  @doc "R-01.16: remember which OIDC provider the account signs in with (shown in Settings)."
  def note_oidc_provider(%Account{oidc_provider: p} = a, p), do: a

  def note_oidc_provider(%Account{} = a, p) when p in ~w(apple google),
    do: a |> Ecto.Changeset.change(oidc_provider: p) |> Repo.update!()

  def note_oidc_provider(a, _), do: a

  @doc """
  RF-7: attach a confirmed sign-in email. If another account already uses it, nothing
  changes (no enumeration); the link still signs the owner back into their own account.
  """
  def attach_email(account_id, hash) do
    case Repo.get(Account, account_id) do
      %Account{status: s} when s in ~w(banned deleted) ->
        {:error, :forbidden}

      %Account{} = a ->
        if Repo.get_by(Account, email_hash: hash) do
          {:ok, a, :existing}
        else
          with {:ok, a} <- a |> Ecto.Changeset.change(email_hash: hash) |> Repo.update(),
               do: {:ok, a, :existing}
        end

      nil ->
        {:error, :unauthorized}
    end
  end

  @doc "R-01.9: profiles hidden everywhere, chats kept."
  def pause(%Account{} = a),
    do:
      a |> Account.changeset(%{status: "paused", paused_at: DateTime.utc_now()}) |> Repo.update()

  def resume(%Account{status: "paused"} = a),
    do: a |> Account.changeset(%{status: "active", paused_at: nil}) |> Repo.update()

  def resume(%Account{} = a), do: {:ok, a}

  @doc """
  R-01.10: hard delete. Rows cascade immediately; public photo objects are
  removed by a job (AC-01.4: all server data gone ≤ 24 h).
  """
  def delete_account(%Account{} = a) do
    keys =
      from(ph in Thirstr.Profiles.Photo,
        join: p in assoc(ph, :profile),
        where: p.account_id == ^a.id,
        select: ph.storage_key
      )
      |> Repo.all()
      |> Enum.flat_map(&[&1, Thirstr.Profiles.thumb_of(&1)])
      # F-21 R-21.23: Moments files go too
      |> Kernel.++(Thirstr.Moments.keys_of(a.id))
      # F-01 R-01.15: chat backup segments
      |> Kernel.++(Thirstr.ChatBackup.keys_of(a.id))
      |> Kernel.++(Thirstr.Transfer.keys_of(a.id))

    Multi.new()
    |> Multi.delete(:account, a)
    |> Oban.insert(:purge, Thirstr.Jobs.PurgeObjects.new(%{"keys" => keys}))
    |> Repo.transaction()
    |> case do
      {:ok, _} -> :ok
      {:error, _, reason, _} -> {:error, reason}
    end
  end

  # ---------------------------------------------------------------- passkeys

  @max_passkeys 10

  def add_passkey(%Account{} = a, credential_id, cose_key, sign_count, aaguid \\ nil) do
    %Passkey{
      account_id: a.id,
      credential_id: credential_id,
      cose_key: :erlang.term_to_binary(cose_key),
      sign_count: sign_count,
      aaguid: aaguid
    }
    |> Repo.insert(on_conflict: :nothing)
    |> case do
      {:ok, %Passkey{id: nil}} -> {:error, :conflict}
      other -> other
    end
  end

  def get_passkey(credential_id) do
    Passkey |> Repo.get_by(credential_id: credential_id) |> Repo.preload(:account)
  end

  # Input is server-written (own DB / RAM store), decoded with :safe.
  # sobelow_skip ["Misc.BinToTerm"]
  def passkey_cose_key(%Passkey{cose_key: bin}), do: :erlang.binary_to_term(bin, [:safe])

  def touch_passkey(%Passkey{} = pk, sign_count) do
    Repo.update_all(from(p in Passkey, where: p.id == ^pk.id),
      set: [sign_count: sign_count, last_used_at: DateTime.utc_now()]
    )
  end

  @doc "R-01.16: a signed-in account adds a passkey (max #{@max_passkeys}); security event."
  def add_own_passkey(%Account{} = a, credential_id, cose_key, sign_count, aaguid) do
    if passkey_count(a) >= @max_passkeys do
      {:error, {:conflict_code, "passkey_limit", "You can have up to #{@max_passkeys} passkeys."}}
    else
      with {:ok, pk} <- add_passkey(a, credential_id, cose_key, sign_count, aaguid) do
        security_event(a, "passkey_added")
        {:ok, pk}
      end
    end
  end

  def passkey_count(%Account{id: id}),
    do: Repo.aggregate(from(p in Passkey, where: p.account_id == ^id), :count)

  @doc "R-01.16: the account's passkeys, newest first. Provider from the AAGUID; no device data."
  def list_passkeys(%Account{id: id}) do
    from(p in Passkey, where: p.account_id == ^id, order_by: [desc: p.inserted_at])
    |> Repo.all()
    |> Enum.map(fn p ->
      %{
        id: p.id,
        provider: Thirstr.Auth.Aaguid.name(p.aaguid),
        added_at: p.inserted_at,
        last_used_at: p.last_used_at
      }
    end)
  end

  @doc "R-01.16: remove a passkey unless it is the account's last way back in."
  def remove_passkey(%Account{} = a, id) do
    with {:ok, _} <- Ecto.UUID.cast(id),
         %Passkey{} = pk <- Repo.get_by(Passkey, id: id, account_id: a.id) do
      if passkey_count(a) <= 1 and not other_way_in?(a) do
        {:error, {:conflict_code, "last_method", "Add an email or another passkey first."}}
      else
        Repo.delete!(pk)
        security_event(a, "passkey_removed")
        :ok
      end
    else
      _ -> {:error, :not_found}
    end
  end

  defp other_way_in?(%Account{} = a),
    do: not is_nil(a.auth_oidc_hash) or not is_nil(a.email_hash) or Thirstr.Recovery.status(a).on

  defp security_event(%Account{id: id}, kind) do
    Repo.insert_all("security_events", [%{account_id: Ecto.UUID.dump!(id), kind: kind}])
  end

  # ---------------------------------------------------------------- sessions

  @resume_days 7

  @doc """
  Registers a device (R-01.8 max 5) and issues tokens.

  SR-04 (#144): `resume` = %{"device_id" => id, "secret" => s} from the install's Keychain.
  After a full sign-in, a device of this account revoked less than 7 d ago with a matching
  secret is resumed instead of replaced, so the chat messages queued for it are not lost.
  """
  def start_session(%Account{} = a, platform, resume \\ nil) when is_binary(platform) do
    platform = if platform in Device.platforms(), do: platform, else: "web"

    case resumable(a, resume) do
      %Device{} = d ->
        secret = Ids.random_token()

        {1, _} =
          Repo.update_all(from(x in Device, where: x.id == ^d.id),
            set: [
              revoked_at: nil,
              resume_hash: Ids.hash("device", secret),
              last_seen_day: Date.utc_today()
            ]
          )

        {:ok, issue_tokens(a, d) |> Map.merge(%{device_id: d.id, device_secret: secret})}

      nil ->
        new_device(a, platform)
    end
  end

  defp new_device(a, platform) do
    max = auth_cfg(:max_devices)

    count =
      Repo.aggregate(
        from(d in Device, where: d.account_id == ^a.id and is_nil(d.revoked_at)),
        :count
      )

    if count >= max do
      {:error, :too_many_devices}
    else
      secret = Ids.random_token()

      device =
        Repo.insert!(%Device{
          account_id: a.id,
          platform: platform,
          last_seen_day: Date.utc_today(),
          resume_hash: Ids.hash("device", secret)
        })

      {:ok, issue_tokens(a, device) |> Map.merge(%{device_id: device.id, device_secret: secret})}
    end
  end

  defp resumable(%Account{id: aid}, %{"device_id" => id, "secret" => secret})
       when is_binary(id) and is_binary(secret) do
    with {:ok, id} <- Ecto.UUID.cast(id),
         %Device{revoked_at: %DateTime{} = at, resume_hash: h} = d when is_binary(h) <-
           Repo.get_by(Device, id: id, account_id: aid),
         true <- DateTime.diff(DateTime.utc_now(), at, :day) < @resume_days,
         true <- Plug.Crypto.secure_compare(h, Ids.hash("device", secret)) do
      d
    else
      _ -> nil
    end
  end

  defp resumable(_, _), do: nil

  @doc "SR-04: revoke without deleting: tokens gone, queued messages kept for a resume (7 d)."
  def revoke_device(device_id) do
    Repo.delete_all(from(r in RefreshToken, where: r.device_id == ^device_id))

    Repo.update_all(from(d in Device, where: d.id == ^device_id and is_nil(d.revoked_at)),
      set: [revoked_at: DateTime.utc_now()]
    )

    :ok
  end

  @doc "Retention: revoked devices not resumed within 7 d are deleted (with their queue)."
  def purge_revoked_devices do
    cutoff = DateTime.add(DateTime.utc_now(), -@resume_days * 86_400, :second)
    {n, _} = Repo.delete_all(from(d in Device, where: d.revoked_at < ^cutoff))
    n
  end

  @doc """
  Test bots (testing.md › Chat test bots): fresh tokens for a device the bot already has, so its
  queue, key packages and chats survive a lost refresh token.
  """
  def reissue_tokens(%Account{} = a, %Device{} = d) do
    Repo.update_all(from(x in Device, where: x.id == ^d.id),
      set: [revoked_at: nil, last_seen_day: Date.utc_today()]
    )

    {:ok, issue_tokens(a, d)}
  end

  @refresh_race_s 60

  @doc "R-01.5: rotate on use. Re-use of a spent token revokes the device (theft signal)."
  def refresh(token) when is_binary(token) do
    hash = Ids.hash("refresh", token)
    now = DateTime.utc_now()

    case Repo.get_by(RefreshToken, token_hash: hash) |> Repo.preload([:account, :device]) do
      nil ->
        {:error, :unauthorized}

      # #116: a token spent seconds ago is a client refresh race (parallel 401s), not theft.
      %RefreshToken{used_at: used} = rt when not is_nil(used) ->
        if DateTime.diff(now, used) < @refresh_race_s do
          {:error, :refresh_race}
        else
          revoke_device(rt.device_id)
          {:error, :unauthorized}
        end

      %RefreshToken{expires_at: exp} = rt ->
        cond do
          DateTime.compare(exp, now) == :lt ->
            {:error, :unauthorized}

          rt.account.status in ~w(banned deleted) ->
            {:error, :forbidden}

          true ->
            case Repo.update_all(
                   from(r in RefreshToken, where: r.id == ^rt.id and is_nil(r.used_at)),
                   set: [used_at: now]
                 ) do
              {1, _} ->
                Repo.update_all(from(d in Device, where: d.id == ^rt.device_id),
                  set: [last_seen_day: Date.utc_today()]
                )

                {:ok, issue_tokens(rt.account, rt.device)}

              # a parallel request spent it between our read and write
              {0, _} ->
                {:error, :refresh_race}
            end
        end
    end
  end

  @doc "Log out everywhere (R-01.5): devices + refresh tokens deleted, access tokens fail device check."
  def logout_all(%Account{} = a) do
    Repo.delete_all(from(d in Device, where: d.account_id == ^a.id))
    :ok
  end

  def logout_device(device_id) do
    Repo.delete_all(from(d in Device, where: d.id == ^device_id))
    :ok
  end

  @doc "Validates an access token; returns {account, device_id}."
  def authenticate_access(token) do
    with {:ok, {account_id, device_id}} <-
           Phoenix.Token.verify(ThirstrWeb.Endpoint, "access", token,
             max_age: auth_cfg(:access_ttl_s)
           ),
         %Account{} = a <- Repo.get(Account, account_id),
         true <-
           Repo.exists?(from(d in Device, where: d.id == ^device_id and is_nil(d.revoked_at))) do
      {:ok, a, device_id}
    else
      _ -> {:error, :unauthorized}
    end
  end

  defp issue_tokens(%Account{} = a, %Device{} = d) do
    refresh = Ids.random_token()
    ttl = auth_cfg(:refresh_ttl_s)

    Repo.insert!(%RefreshToken{
      account_id: a.id,
      device_id: d.id,
      token_hash: Ids.hash("refresh", refresh),
      expires_at: DateTime.add(DateTime.utc_now(), ttl, :second)
    })

    %{
      access_token: Phoenix.Token.sign(ThirstrWeb.Endpoint, "access", {a.id, d.id}),
      refresh_token: refresh,
      expires_in: auth_cfg(:access_ttl_s),
      account: a
    }
  end

  # ---------------------------------------------------------------- device flags

  @doc "R-02.3: device flagged 30 d after an under-18 birthday."
  def flag_underage_device(device_key) do
    Valkey.command!([
      "SET",
      "underage:" <> device_key,
      "1",
      "EX",
      Integer.to_string(auth_cfg(:underage_flag_ttl_s))
    ])

    :ok
  end

  def underage_flagged?(nil), do: false
  def underage_flagged?(device_key), do: Valkey.exists?("underage:" <> device_key)

  def auth_cfg(key), do: Application.fetch_env!(:thirstr, :auth)[key]
end
