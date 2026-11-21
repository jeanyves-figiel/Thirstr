defmodule ThirstrWeb.AppAttestTest do
  use ThirstrWeb.ConnCase, async: false
  alias Thirstr.{AppAttest, Repo}
  alias Thirstr.Accounts.Device

  # #25 device attestation. Recorded attestations from real devices (test/fixtures/app_attest).
  @app_id "V8H6LQ9448.io.uebelacker.AppAttestExample"

  defp fixture(name) do
    d =
      File.read!(Path.expand("../fixtures/app_attest/attestation-#{name}.json", __DIR__))
      |> Jason.decode!()

    {Base.decode64!(d["attestation"]), Base.decode64!(d["keyId"]), Base.decode64!(d["challenge"])}
  end

  describe "verify_attestation (recorded)" do
    test "development and production attestations verify" do
      for {name, env} <- [{"development", :development}, {"production", :production}] do
        {att, kid, ch} = fixture(name)

        assert {:ok, %{public_key: <<4, _::binary-64>> = pub, env: ^env}} =
                 AppAttest.verify_attestation(att, kid, ch, [@app_id], ignore_expiry: true)

        assert :crypto.hash(:sha256, pub) == kid
      end
    end

    test "wrong challenge, app id or key id is refused" do
      {att, kid, ch} = fixture("development")

      assert {:error, :nonce} =
               AppAttest.verify_attestation(att, kid, ch <> "x", [@app_id], ignore_expiry: true)

      assert {:error, :app_id} =
               AppAttest.verify_attestation(att, kid, ch, ["U7VAR53G86.app.thirstr"],
                 ignore_expiry: true
               )

      assert {:error, :key_id} =
               AppAttest.verify_attestation(att, :crypto.strong_rand_bytes(32), ch, [@app_id],
                 ignore_expiry: true
               )
    end

    test "expired leaf certificates fail without the test-only override" do
      {att, kid, ch} = fixture("development")
      assert {:error, :chain} = AppAttest.verify_attestation(att, kid, ch, [@app_id])
    end

    test "garbage is malformed, not a crash" do
      assert {:error, :malformed} = AppAttest.verify_attestation("nope", "k", "c", [@app_id])
      assert {:error, :malformed} = AppAttest.verify_assertion("nope", "c", <<4>>, 0, [@app_id])
    end
  end

  # Soft authenticator: builds an assertion like the Secure Enclave does.
  defp assertion(priv, client_data, counter, app_id \\ "U7VAR53G86.app.thirstr") do
    auth = :crypto.hash(:sha256, app_id) <> <<0x40, counter::32>>
    nonce = :crypto.hash(:sha256, auth <> :crypto.hash(:sha256, client_data))
    sig = :crypto.sign(:ecdsa, :sha256, nonce, [priv, :prime256v1])

    CBOR.encode(%{
      "signature" => %CBOR.Tag{tag: :bytes, value: sig},
      "authenticatorData" => %CBOR.Tag{tag: :bytes, value: auth}
    })
  end

  describe "endpoints" do
    setup %{conn: conn} do
      Application.put_env(:thirstr, :app_attest_app_ids, ["U7VAR53G86.app.thirstr"])
      on_exit(fn -> Application.delete_env(:thirstr, :app_attest_app_ids) end)
      {:ok, u: onboarded(conn)}
    end

    defp authed(u), do: recycle_authed(u.c)

    defp device_id(u) do
      %{"devices" => ds} = authed(u) |> get("/v1/me/devices") |> json_response(200)
      Enum.find(ds, & &1["current"])["id"]
    end

    defp challenge(u) do
      %{"challenge" => c} =
        authed(u) |> post("/v1/devices/attest/challenge") |> json_response(200)

      c
    end

    test "assertion with the stored key refreshes attestation; challenge is single use; counter must grow",
         %{u: u} do
      {pub, priv} = :crypto.generate_key(:ecdh, :prime256v1)
      id = device_id(u)

      Repo.get!(Device, id)
      |> Ecto.Changeset.change(
        attest_key_id: :crypto.hash(:sha256, pub),
        attest_public_key: pub,
        attest_counter: 0
      )
      |> Repo.update!()

      assert %{"attested" => false, "has_key" => true} =
               authed(u) |> get("/v1/devices/attest") |> json_response(200)

      c = challenge(u)
      a = assertion(priv, c, 1) |> Base.encode64()

      assert %{"attested" => true} =
               authed(u)
               |> post("/v1/devices/assert", %{assertion: a, challenge: c})
               |> json_response(200)

      assert %{"attested" => true} = authed(u) |> get("/v1/devices/attest") |> json_response(200)

      # replay of the same challenge
      assert %{"error" => %{"code" => "challenge"}} =
               authed(u)
               |> post("/v1/devices/assert", %{assertion: a, challenge: c})
               |> json_response(422)

      # counter not growing
      c2 = challenge(u)
      a2 = assertion(priv, c2, 1) |> Base.encode64()

      assert %{"error" => %{"code" => "assertion_invalid"}} =
               authed(u)
               |> post("/v1/devices/assert", %{assertion: a2, challenge: c2})
               |> json_response(422)

      # signed by another key
      {_, other} = :crypto.generate_key(:ecdh, :prime256v1)
      c3 = challenge(u)
      a3 = assertion(other, c3, 5) |> Base.encode64()

      assert %{"error" => %{"code" => "assertion_invalid"}} =
               authed(u)
               |> post("/v1/devices/assert", %{assertion: a3, challenge: c3})
               |> json_response(422)
    end

    test "assert before attest is a conflict; bad attestation is refused", %{u: u} do
      c = challenge(u)

      assert %{"error" => %{"code" => "not_attested"}} =
               authed(u)
               |> post("/v1/devices/assert", %{assertion: Base.encode64("x"), challenge: c})
               |> json_response(409)

      c = challenge(u)

      assert %{"error" => %{"code" => "attestation_invalid"}} =
               authed(u)
               |> post("/v1/devices/attest", %{
                 key_id: Base.encode64(<<1, 2>>),
                 attestation: Base.encode64("junk"),
                 challenge: c
               })
               |> json_response(422)
    end
  end
end
