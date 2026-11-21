defmodule ThirstrWeb.VerificationTest do
  use ThirstrWeb.ConnCase, async: false

  # F-03: challenge → on-device liveness → blind issuance → redeem.
  setup %{conn: conn} do
    {:ok, u: onboarded(conn, verified: false)}
  end

  defp req(u, path, body \\ %{}), do: u.c |> recycle_authed() |> post(path, body)
  defp d64(s), do: Base.url_decode64!(s, padding: false)
  defp e64(b), do: Base.url_encode64(b, padding: false)

  # Client side of Chaum RSA-FDH: blind, unblind.
  defp blind(token, key) do
    n = d64(key["n"]) |> :binary.decode_unsigned()
    e = key["e"]
    r = :crypto.strong_rand_bytes(32) |> :binary.decode_unsigned()
    m = Thirstr.Verification.fdh(token, d64(key["n"]))
    blinded = rem(m * pow(r, e, n), n)
    {e64(:binary.encode_unsigned(blinded)), r, n}
  end

  defp unblind(sig, r, n) do
    s = d64(sig) |> :binary.decode_unsigned()
    rem(s * inverse(r, n), n) |> :binary.encode_unsigned() |> e64()
  end

  defp pow(b, e, m), do: :crypto.mod_pow(b, e, m) |> :binary.decode_unsigned()

  defp inverse(a, m) do
    {g, x, _} = egcd(a, m)
    1 = g
    rem(rem(x, m) + m, m)
  end

  defp egcd(0, b), do: {b, 0, 1}

  defp egcd(a, b) do
    {g, x, y} = egcd(rem(b, a), a)
    {g, y - div(b, a) * x, x}
  end

  test "full flow verifies the account; token is single use (AC-03.3)", %{u: u} do
    %{"nonce" => nonce, "steps" => steps, "key" => key} =
      req(u, "/v1/verification/challenge") |> json_response(200)

    assert length(steps) == 3
    refute "blink" in steps
    token = :crypto.strong_rand_bytes(32)
    {blinded, r, n} = blind(token, key)

    %{"signature" => sig} =
      req(u, "/v1/verification/attest", %{nonce: nonce, passed: true, blinded: blinded})
      |> json_response(200)

    signature = unblind(sig, r, n)
    # nonce is single use
    assert req(u, "/v1/verification/attest", %{nonce: nonce, passed: true, blinded: blinded})
           |> json_response(422)

    assert %{"verified" => true} =
             req(u, "/v1/verification/redeem", %{token: e64(token), signature: signature})
             |> json_response(200)

    assert req(u, "/v1/verification/redeem", %{token: e64(token), signature: signature})
           |> json_response(422)
  end

  test "forged signature is rejected", %{u: u} do
    token = :crypto.strong_rand_bytes(32)

    assert req(u, "/v1/verification/redeem", %{
             token: e64(token),
             signature: e64(:crypto.strong_rand_bytes(384))
           })
           |> json_response(422)
  end

  test "3 failed attempts → 24 h cooldown (R-03.10)", %{u: u} do
    for left <- [2, 1, 0] do
      %{"nonce" => n} = req(u, "/v1/verification/challenge") |> json_response(200)

      assert %{"passed" => false, "attempts_left" => ^left} =
               req(u, "/v1/verification/attest", %{nonce: n, passed: false}) |> json_response(200)
    end

    assert req(u, "/v1/verification/challenge") |> json_response(403)
  end

  test "credential lapses after 12 months (R-03.7)", %{u: u} do
    verify!(u.pid)
    Thirstr.Repo.query!("UPDATE accounts SET verified_at = now() - interval '13 months'")
    Thirstr.Verification.sweep()
    refute account_of(u.pid).verified_at
  end
end
