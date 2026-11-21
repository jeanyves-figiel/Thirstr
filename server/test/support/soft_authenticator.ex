defmodule ThirstrWeb.SoftAuthenticator do
  @moduledoc "Software WebAuthn authenticator (ES256, attestation none) for tests."

  def new do
    {pub, priv} = :crypto.generate_key(:ecdh, :prime256v1)
    %{pub: pub, priv: priv, cred_id: :crypto.strong_rand_bytes(32), count: 0}
  end

  def create(auth, options, origin) do
    pk = options["publicKey"]

    cdj =
      Jason.encode!(%{
        type: "webauthn.create",
        challenge: pk["challenge"],
        origin: origin,
        crossOrigin: false
      })

    <<4, x::binary-32, y::binary-32>> = auth.pub
    cose = %{1 => 2, 3 => -7, -1 => 1, -2 => bytes(x), -3 => bytes(y)}

    auth_data =
      :crypto.hash(:sha256, pk["rp"]["id"]) <>
        <<0x45>> <>
        <<0::32>> <>
        <<0::128>> <>
        <<byte_size(auth.cred_id)::16>> <> auth.cred_id <> CBOR.encode(cose)

    att = CBOR.encode(%{"fmt" => "none", "attStmt" => %{}, "authData" => bytes(auth_data)})

    %{
      "challenge_id" => options["challenge_id"],
      "attestation_object" => b64(att),
      "client_data_json" => b64(cdj)
    }
  end

  def get(auth, options, origin, count \\ 1) do
    pk = options["publicKey"]

    cdj =
      Jason.encode!(%{
        type: "webauthn.get",
        challenge: pk["challenge"],
        origin: origin,
        crossOrigin: false
      })

    auth_data = :crypto.hash(:sha256, pk["rpId"]) <> <<0x05>> <> <<count::32>>

    sig =
      :crypto.sign(:ecdsa, :sha256, auth_data <> :crypto.hash(:sha256, cdj), [
        auth.priv,
        :prime256v1
      ])

    %{
      "challenge_id" => options["challenge_id"],
      "credential_id" => b64(auth.cred_id),
      "authenticator_data" => b64(auth_data),
      "signature" => b64(sig),
      "client_data_json" => b64(cdj)
    }
  end

  defp bytes(b), do: %CBOR.Tag{tag: :bytes, value: b}
  defp b64(b), do: Base.url_encode64(b, padding: false)
end
