defmodule Thirstr.AppAttest do
  @moduledoc """
  iOS App Attest verification (#25, security.md › Device attestation, I-03). Pure functions, no I/O.

  `verify_attestation/4` follows Apple's "Validating apps that connect to your server" steps 1–9:
  certificate chain to the Apple App Attestation Root CA, nonce extension, key id = SHA-256 of the
  public key, RP id = SHA-256 of `<TeamID>.<bundle id>`, counter 0, aaguid by environment.
  `verify_assertion/5` checks a later assertion with the stored public key and a growing counter.
  """

  @root_path Path.expand("../../priv/certs/apple_app_attestation_root_ca.pem", __DIR__)
  @external_resource @root_path
  @root_pem File.read!(@root_path)
  @nonce_oid {1, 2, 840, 113_635, 100, 8, 2}
  @aaguid_prod "appattest" <> <<0::56>>
  @aaguid_dev "appattestdevelop"

  defp root_der do
    [{:Certificate, der, _}] = :public_key.pem_decode(@root_pem)
    der
  end

  @doc """
  `attestation`, `key_id`: raw binaries. `challenge`: the raw challenge the server issued (the app
  hashes it as clientDataHash). `app_ids`: accepted `<TeamID>.<bundle id>` strings.
  Options: `ignore_expiry: true` (tests with recorded attestations only).
  Returns `{:ok, %{public_key: <<4, x::32, y::32>>, env: :production | :development}}`.
  """
  def verify_attestation(attestation, key_id, challenge, app_ids, opts \\ []) do
    with {:ok,
          %{
            "fmt" => "apple-appattest",
            "attStmt" => %{"x5c" => [leaf | inter]},
            "authData" => auth
          },
          ""} <-
           safe_decode(attestation),
         leaf = bytes(leaf),
         chain = Enum.map(inter, &bytes/1),
         auth = bytes(auth),
         :ok <- validate_chain(leaf, chain, opts),
         nonce = :crypto.hash(:sha256, auth <> :crypto.hash(:sha256, challenge)),
         :ok <- check_nonce(leaf, nonce),
         {:ok, pub} <- leaf_public_key(leaf),
         true <- :crypto.hash(:sha256, pub) == key_id || {:error, :key_id},
         <<rp::binary-32, _flags, counter::32, aaguid::binary-16, len::16, cred::binary-size(len),
           _::binary>> <-
           auth,
         true <- Enum.any?(app_ids, &(:crypto.hash(:sha256, &1) == rp)) || {:error, :app_id},
         true <- counter == 0 || {:error, :counter},
         {:ok, env} <- env(aaguid),
         true <- cred == key_id || {:error, :credential_id} do
      {:ok, %{public_key: pub, env: env}}
    else
      {:error, _} = e -> e
      _ -> {:error, :malformed}
    end
  end

  @doc "Assertion over `client_data` (raw). Returns `{:ok, new_counter}`."
  def verify_assertion(assertion, client_data, public_key, last_counter, app_ids) do
    with {:ok, %{"signature" => sig, "authenticatorData" => auth}, ""} <- safe_decode(assertion),
         sig = bytes(sig),
         auth = bytes(auth),
         <<rp::binary-32, _flags, counter::32, _::binary>> <- auth,
         nonce = :crypto.hash(:sha256, auth <> :crypto.hash(:sha256, client_data)),
         true <-
           :crypto.verify(:ecdsa, :sha256, nonce, sig, [public_key, :prime256v1]) ||
             {:error, :signature},
         true <- Enum.any?(app_ids, &(:crypto.hash(:sha256, &1) == rp)) || {:error, :app_id},
         true <- counter > last_counter || {:error, :counter} do
      {:ok, counter}
    else
      {:error, _} = e -> e
      _ -> {:error, :malformed}
    end
  end

  defp safe_decode(bin) do
    case CBOR.decode(bin) do
      {:ok, _, _} = ok -> ok
      _ -> {:error, :malformed}
    end
  rescue
    _ -> {:error, :malformed}
  end

  defp bytes(%CBOR.Tag{tag: :bytes, value: v}), do: v
  defp bytes(v) when is_binary(v), do: v

  defp env(@aaguid_prod), do: {:ok, :production}
  defp env(@aaguid_dev), do: {:ok, :development}
  defp env(_), do: {:error, :aaguid}

  defp validate_chain(leaf, chain, opts) do
    verify_fun =
      if opts[:ignore_expiry] do
        {fn
           _, {:bad_cert, :cert_expired}, s -> {:valid, s}
           _, {:bad_cert, _} = r, _ -> {:fail, r}
           _, {:extension, _}, s -> {:unknown, s}
           _, :valid, s -> {:valid, s}
           _, :valid_peer, s -> {:valid, s}
         end, nil}
      else
        {fn
           _, {:bad_cert, _} = r, _ -> {:fail, r}
           _, {:extension, _}, s -> {:unknown, s}
           _, :valid, s -> {:valid, s}
           _, :valid_peer, s -> {:valid, s}
         end, nil}
      end

    case :public_key.pkix_path_validation(root_der(), Enum.reverse(chain) ++ [leaf],
           verify_fun: verify_fun
         ) do
      {:ok, _} -> :ok
      {:error, _} -> {:error, :chain}
    end
  end

  defp check_nonce(leaf, nonce) do
    {:OTPCertificate, tbs, _, _} = :public_key.pkix_decode_cert(leaf, :otp)
    exts = elem(tbs, 10)

    case Enum.find(List.wrap(exts), &(elem(&1, 1) == @nonce_oid)) do
      # SEQUENCE { [1] EXPLICIT OCTET STRING (32) nonce }
      {:Extension, _, _, <<0x30, 0x24, 0xA1, 0x22, 0x04, 0x20, ^nonce::binary-32>>} -> :ok
      _ -> {:error, :nonce}
    end
  end

  defp leaf_public_key(leaf) do
    {:OTPCertificate, tbs, _, _} = :public_key.pkix_decode_cert(leaf, :otp)

    case elem(tbs, 7) do
      {:OTPSubjectPublicKeyInfo, _, {:ECPoint, <<4, _::binary-64>> = pt}} -> {:ok, pt}
      _ -> {:error, :public_key}
    end
  end
end
