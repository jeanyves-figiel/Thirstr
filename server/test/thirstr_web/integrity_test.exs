defmodule ThirstrWeb.IntegrityTest do
  use ThirstrWeb.ConnCase, async: false
  alias Thirstr.{PlayIntegrity, Repo}
  alias Thirstr.Accounts.Device

  # #168 Play Integrity + #270 verification needs device proof.

  defmodule StubDecoder do
    # The "token" is the JSON payload Google would return; lets tests drive every verdict.
    def decode(token, _package), do: Jason.decode(token)
  end

  @app_id "U7VAR53G86.app.thirstr"

  defp payload(hash, opts \\ []) do
    %{
      "requestDetails" => %{
        "requestPackageName" => opts[:package] || "app.thirstr",
        "requestHash" => hash,
        "timestampMillis" => to_string(opts[:ts] || System.system_time(:millisecond))
      },
      "appIntegrity" => %{
        "appRecognitionVerdict" => opts[:app] || "PLAY_RECOGNIZED",
        "packageName" => opts[:package] || "app.thirstr",
        "certificateSha256Digest" => ["abc"]
      },
      "deviceIntegrity" => %{
        "deviceRecognitionVerdict" => opts[:device] || ["MEETS_DEVICE_INTEGRITY"]
      }
    }
  end

  describe "PlayIntegrity.check/4" do
    test "accepts a good verdict, refuses each bad field" do
      now = System.system_time(:millisecond)
      assert :ok = PlayIntegrity.check(payload("h"), "h", now)
      assert {:error, :request_hash} = PlayIntegrity.check(payload("h"), "x", now)
      assert {:error, :package} = PlayIntegrity.check(payload("h", package: "evil"), "h", now)
      assert {:error, :app} = PlayIntegrity.check(payload("h", app: "UNEVALUATED"), "h", now)

      assert {:error, :app} =
               PlayIntegrity.check(payload("h", app: "UNRECOGNIZED_VERSION"), "h", now)

      assert :ok =
               PlayIntegrity.check(payload("h", app: "UNRECOGNIZED_VERSION"), "h", now,
                 allow_unrecognized: true
               )

      assert {:error, :device} =
               PlayIntegrity.check(payload("h", device: ["MEETS_BASIC_INTEGRITY"]), "h", now)

      assert {:error, :device} = PlayIntegrity.check(payload("h", device: []), "h", now)
      assert {:error, :stale} = PlayIntegrity.check(payload("h", ts: now - 600_000), "h", now)

      assert {:error, :certificate} =
               PlayIntegrity.check(payload("h"), "h", now, cert_digests: ["zzz"])

      assert :ok = PlayIntegrity.check(payload("h"), "h", now, cert_digests: ["abc"])
    end
  end

  describe "endpoints" do
    setup %{conn: conn} do
      Application.put_env(:thirstr, :app_attest_app_ids, [@app_id])
      Application.put_env(:thirstr, :play_integrity_decoder, StubDecoder)
      Application.put_env(:thirstr, :verification_requires_attest, true)

      on_exit(fn ->
        Application.delete_env(:thirstr, :app_attest_app_ids)
        Application.delete_env(:thirstr, :play_integrity_decoder)
        Application.delete_env(:thirstr, :verification_requires_attest)
      end)

      {:ok, u: onboarded(conn, verified: false)}
    end

    defp authed(u), do: recycle_authed(u.c)

    defp device_id(u) do
      %{"devices" => ds} = authed(u) |> get("/v1/me/devices") |> json_response(200)
      Enum.find(ds, & &1["current"])["id"]
    end

    defp b64(b), do: Base.url_encode64(b, padding: false)

    # Soft Secure Enclave: assertion over client data with counter.
    defp assertion(priv, client_data, counter) do
      auth = :crypto.hash(:sha256, @app_id) <> <<0x40, counter::32>>
      nonce = :crypto.hash(:sha256, auth <> :crypto.hash(:sha256, client_data))
      sig = :crypto.sign(:ecdsa, :sha256, nonce, [priv, :prime256v1])

      CBOR.encode(%{
        "signature" => %CBOR.Tag{tag: :bytes, value: sig},
        "authenticatorData" => %CBOR.Tag{tag: :bytes, value: auth}
      })
      |> Base.encode64()
    end

    defp with_key(u) do
      {pub, priv} = :crypto.generate_key(:ecdh, :prime256v1)

      Repo.get!(Device, device_id(u))
      |> Ecto.Changeset.change(
        attest_key_id: :crypto.hash(:sha256, pub),
        attest_public_key: pub,
        attest_counter: 0
      )
      |> Repo.update!()

      priv
    end

    defp vchallenge(u) do
      %{"nonce" => n} = authed(u) |> post("/v1/verification/challenge") |> json_response(200)
      n
    end

    defp blinded, do: b64(:crypto.strong_rand_bytes(64))

    test "Android attest with a Play Integrity token bound to the challenge", %{u: u} do
      %{"challenge" => c} =
        authed(u) |> post("/v1/devices/attest/challenge") |> json_response(200)

      assert %{"attested" => true} =
               authed(u)
               |> post("/v1/devices/attest", %{
                 platform: "android",
                 token: Jason.encode!(payload(c)),
                 challenge: c
               })
               |> json_response(200)

      assert %{"attested" => true} = authed(u) |> get("/v1/devices/attest") |> json_response(200)

      %{"challenge" => c2} =
        authed(u) |> post("/v1/devices/attest/challenge") |> json_response(200)

      assert %{"error" => %{"code" => "attestation_invalid"}} =
               authed(u)
               |> post("/v1/devices/attest", %{
                 platform: "android",
                 token: Jason.encode!(payload("other")),
                 challenge: c2
               })
               |> json_response(422)
    end

    test "#270: passed without device proof gets no signature", %{u: u} do
      n = vchallenge(u)

      assert %{"error" => %{"code" => "attestation_required"}} =
               authed(u)
               |> post("/v1/verification/attest", %{nonce: n, passed: true, blinded: blinded()})
               |> json_response(422)

      # a failed result needs no proof and still counts toward the cooldown
      n = vchallenge(u)

      assert %{"passed" => false} =
               authed(u)
               |> post("/v1/verification/attest", %{nonce: n, passed: false})
               |> json_response(200)
    end

    test "#270: App Attest assertion over nonce.blinded is accepted once; wrong data refused", %{
      u: u
    } do
      priv = with_key(u)
      n = vchallenge(u)
      bl = blinded()

      # signed over different data (proof replayed from another request)
      assert %{"error" => %{"code" => "attestation_required"}} =
               authed(u)
               |> post("/v1/verification/attest", %{
                 nonce: n,
                 passed: true,
                 blinded: bl,
                 assertion: assertion(priv, "other", 1)
               })
               |> json_response(422)

      n = vchallenge(u)

      assert %{"signature" => s} =
               authed(u)
               |> post("/v1/verification/attest", %{
                 nonce: n,
                 passed: true,
                 blinded: bl,
                 assertion: assertion(priv, n <> "." <> bl, 2)
               })
               |> json_response(200)

      assert is_binary(s)
    end

    test "#270: Play Integrity token with request hash of nonce.blinded is accepted", %{u: u} do
      n = vchallenge(u)
      bl = blinded()
      hash = b64(:crypto.hash(:sha256, n <> "." <> bl))

      assert %{"signature" => _} =
               authed(u)
               |> post("/v1/verification/attest", %{
                 nonce: n,
                 passed: true,
                 blinded: bl,
                 integrity_token: Jason.encode!(payload(hash))
               })
               |> json_response(200)
    end
  end
end
