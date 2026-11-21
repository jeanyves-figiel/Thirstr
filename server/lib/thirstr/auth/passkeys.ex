defmodule Thirstr.Auth.Passkeys do
  @moduledoc """
  WebAuthn ceremonies (F-01 R-01.1) using Wax. Challenges live in Valkey for 120 s,
  single use. Attestation "none": we do not collect authenticator make/model.
  """
  alias Thirstr.{Accounts, Ids, Valkey}

  @ttl 120

  def registration_options do
    cfg = cfg()

    challenge =
      Wax.new_registration_challenge(
        origin: cfg[:origin],
        rp_id: cfg[:rp_id],
        attestation: "none",
        user_verification: "preferred",
        timeout: @ttl
      )

    id = store(challenge)
    # Random, unlinkable user handle: we never send a name to the authenticator.
    user_handle = :crypto.strong_rand_bytes(16)

    %{
      challenge_id: id,
      publicKey: %{
        challenge: b64(challenge.bytes),
        rp: %{id: cfg[:rp_id], name: cfg[:rp_name]},
        user: %{id: b64(user_handle), name: "Thirstr", displayName: "Thirstr"},
        pubKeyCredParams: [%{type: "public-key", alg: -7}, %{type: "public-key", alg: -257}],
        authenticatorSelection: %{residentKey: "required", userVerification: "preferred"},
        attestation: "none",
        timeout: @ttl * 1000
      }
    }
  end

  @doc "Verifies an attestation. Returns {:ok, credential_id, cose_key, sign_count}."
  def verify_registration(%{
        "challenge_id" => cid,
        "attestation_object" => ao,
        "client_data_json" => cdj
      }) do
    with %Wax.Challenge{} = ch <- take(cid),
         {:ok, ao} <- unb64(ao),
         {:ok, cdj} <- unb64(cdj),
         {:ok, {auth_data, _att}} <- Wax.register(ao, cdj, ch) do
      acd = auth_data.attested_credential_data
      {:ok, acd.credential_id, acd.credential_public_key, auth_data.sign_count}
    else
      _ -> {:error, :unauthorized}
    end
  end

  def verify_registration(_), do: {:error, :validation}

  @doc "`origin` overrides the app origin (admin console on the API host, same RP id)."
  def authentication_options(origin \\ nil) do
    cfg = cfg()

    challenge =
      Wax.new_authentication_challenge(
        origin: origin || cfg[:origin],
        rp_id: cfg[:rp_id],
        user_verification: "preferred",
        timeout: @ttl
      )

    %{
      challenge_id: store(challenge),
      publicKey: %{
        challenge: b64(challenge.bytes),
        rpId: cfg[:rp_id],
        allowCredentials: [],
        userVerification: "preferred",
        timeout: @ttl * 1000
      }
    }
  end

  def verify_authentication(%{
        "challenge_id" => cid,
        "credential_id" => cred,
        "authenticator_data" => ad,
        "signature" => sig,
        "client_data_json" => cdj
      }) do
    with %Wax.Challenge{} = ch <- take(cid),
         {:ok, cred} <- unb64(cred),
         {:ok, ad} <- unb64(ad),
         {:ok, sig} <- unb64(sig),
         {:ok, cdj} <- unb64(cdj),
         %Accounts.Passkey{} = pk <- Accounts.get_passkey(cred),
         {:ok, auth_data} <-
           Wax.authenticate(cred, ad, sig, cdj, ch, [{cred, Accounts.passkey_cose_key(pk)}]),
         :ok <- check_counter(pk, auth_data.sign_count) do
      Accounts.touch_passkey(pk, auth_data.sign_count)
      {:ok, pk.account}
    else
      _ -> {:error, :unauthorized}
    end
  end

  def verify_authentication(_), do: {:error, :validation}

  # Cloned-authenticator signal; synced passkeys report 0 and are allowed.
  defp check_counter(_pk, 0), do: :ok
  defp check_counter(%{sign_count: old}, new) when new > old, do: :ok
  defp check_counter(_, _), do: {:error, :counter}

  defp store(challenge) do
    id = Ids.random_token(16)
    Valkey.put_term("wa:" <> id, challenge, @ttl)
    id
  end

  defp take(id) when is_binary(id), do: Valkey.take_term("wa:" <> id)
  defp take(_), do: nil

  defp b64(bin), do: Base.url_encode64(bin, padding: false)

  defp unb64(s) when is_binary(s) do
    case Base.url_decode64(s, padding: false) do
      {:ok, _} = ok -> ok
      :error -> Base.decode64(s)
    end
  end

  defp unb64(_), do: :error

  defp cfg, do: Application.fetch_env!(:thirstr, :webauthn)
end
