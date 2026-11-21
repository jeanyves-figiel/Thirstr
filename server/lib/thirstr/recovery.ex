defmodule Thirstr.Recovery do
  @moduledoc """
  F-01 R-01.7 recovery phrase + sealed backup (#25).

  The phone turns 12 BIP-39 words into an Ed25519 sign-in key and an AES vault key. We store only
  the Ed25519 public key and the vault ciphertext; we never see the words or either secret key.
  Sign-in = Ed25519 signature over `"thirstr-recovery:" <> challenge` (single use, 120 s).
  """
  import Ecto.Query
  alias Thirstr.{Accounts, Repo, Valkey}
  alias Thirstr.Accounts.{Account, Device}

  @ttl 120
  @vault_max 1_048_576
  @prefix "thirstr-recovery:"

  defmodule Key do
    @moduledoc false
    use Ecto.Schema
    @primary_key {:account_id, :binary_id, autogenerate: false}
    @timestamps_opts [type: :utc_datetime_usec]

    schema "account_recovery" do
      field :public_key, :binary
      field :vault, :binary
      field :vault_updated_at, :utc_datetime_usec
      timestamps()
    end
  end

  def status(%Account{id: id}) do
    case Repo.get(Key, id) do
      nil -> %{on: false, since: nil, backup_at: nil}
      k -> %{on: true, since: k.inserted_at, backup_at: k.vault_updated_at}
    end
  end

  @doc "Turn on or make new words: replaces the key and drops the old backup."
  def put_key(%Account{id: id} = a, %{"public_key" => pk}) do
    case unb64(pk) do
      {:ok, <<_::binary-32>> = pub} ->
        # R-01.15: the chat backup was sealed with the old words; the phone uploads a new one.
        Thirstr.ChatBackup.delete(a)

        Repo.insert!(%Key{account_id: id, public_key: pub},
          on_conflict: [
            set: [
              public_key: pub,
              vault: nil,
              vault_updated_at: nil,
              inserted_at: DateTime.utc_now(),
              updated_at: DateTime.utc_now()
            ]
          ],
          conflict_target: :account_id
        )

        {:ok, status(a)}

      {:ok, _} ->
        {:error, {:validation, %{public_key: ["must be 32 bytes"]}}}

      _ ->
        {:error, {:validation, %{public_key: ["invalid"]}}}
    end
  rescue
    Ecto.ConstraintError -> {:error, {:conflict_code, "key_in_use", "Make new words"}}
  end

  def put_key(_, _), do: {:error, {:validation, %{public_key: ["required"]}}}

  def delete(%Account{id: id} = a) do
    Thirstr.ChatBackup.delete(a)
    Repo.delete_all(from(k in Key, where: k.account_id == ^id))
    :ok
  end

  def put_vault(%Account{id: id} = a, %{"vault" => v}) do
    with {:ok, bin} <- unb64(v),
         true <- byte_size(bin) <= @vault_max || {:error, :too_big},
         {1, _} <-
           Repo.update_all(from(k in Key, where: k.account_id == ^id),
             set: [vault: bin, vault_updated_at: DateTime.utc_now()]
           ) do
      {:ok, status(a)}
    else
      {0, _} -> {:error, {:conflict_code, "recovery_off", "Turn on the recovery phrase first"}}
      {:error, :too_big} -> {:error, {:validation, %{vault: ["max 1 MB"]}}}
      _ -> {:error, {:validation, %{vault: ["invalid"]}}}
    end
  end

  def put_vault(_, _), do: {:error, {:validation, %{vault: ["required"]}}}

  def get_vault(%Account{id: id}) do
    case Repo.get(Key, id) do
      %Key{vault: v, vault_updated_at: at} when is_binary(v) ->
        {:ok, %{vault: Base.encode64(v), updated_at: at}}

      _ ->
        {:error, :not_found}
    end
  end

  # --- sign-in

  def options do
    c = :crypto.strong_rand_bytes(32)
    id = Base.url_encode64(:crypto.strong_rand_bytes(16), padding: false)
    Valkey.put_term("recov:" <> id, c, @ttl)
    {:ok, %{challenge_id: id, challenge: Base.url_encode64(c, padding: false), expires_in: @ttl}}
  end

  @doc "Verifies the signature; returns the account. Every failure is the same error."
  def verify(%{"challenge_id" => cid, "public_key" => pk, "signature" => sig})
      when is_binary(cid) do
    with c when is_binary(c) <- Valkey.take_term("recov:" <> cid),
         {:ok, <<_::binary-32>> = pub} <- unb64(pk),
         {:ok, <<_::binary-64>> = s} <- unb64(sig),
         %Key{account_id: aid} <- Repo.get_by(Key, public_key: pub),
         true <-
           :crypto.verify(:eddsa, :none, @prefix <> Base.url_encode64(c, padding: false), s, [
             pub,
             :ed25519
           ]),
         %Account{} = a <- Accounts.get_account(aid) do
      {:ok, a}
    else
      _ -> {:error, :recovery_invalid}
    end
  end

  def verify(_), do: {:error, :recovery_invalid}

  @doc "After a recovery sign-in: every other device of the account is signed out (lost or stolen)."
  def sign_out_others(%Account{id: aid}, keep_device_id) do
    Repo.delete_all(from(d in Device, where: d.account_id == ^aid and d.id != ^keep_device_id))
    :ok
  end

  defp unb64(s) when is_binary(s) do
    s = s |> String.replace("+", "-") |> String.replace("/", "_") |> String.trim_trailing("=")

    case Base.url_decode64(s, padding: false) do
      {:ok, b} -> {:ok, b}
      :error -> {:error, :malformed}
    end
  end

  defp unb64(_), do: {:error, :malformed}
end
