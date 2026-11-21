defmodule ThirstrWeb.RecoveryTest do
  use ThirstrWeb.ConnCase, async: false

  # F-01 R-01.7 (#25): recovery phrase sign-in key + sealed backup.
  setup %{conn: conn} do
    {pub, priv} = :crypto.generate_key(:eddsa, :ed25519)
    {:ok, u: onboarded(conn), c: conn, pub: pub, priv: priv}
  end

  defp authed(u), do: recycle_authed(u.c)
  defp b64(b), do: Base.url_encode64(b, padding: false)

  defp sign_in(c, pub, priv, opts \\ []) do
    %{"challenge_id" => id, "challenge" => ch} =
      c |> recycle() |> post("/v1/auth/recovery/options") |> json_response(200)

    msg = Keyword.get(opts, :msg, "thirstr-recovery:" <> ch)
    sig = :crypto.sign(:eddsa, :none, msg, [priv, :ed25519])

    c
    |> recycle()
    |> post("/v1/auth/recovery", %{
      challenge_id: id,
      public_key: b64(pub),
      signature: b64(sig),
      platform: "ios"
    })
  end

  test "turn on, back up, sign in with the words; other devices signed out",
       %{u: u, c: c} = ctx do
    assert %{"on" => false} = authed(u) |> get("/v1/me/recovery") |> json_response(200)

    assert %{"on" => true} =
             authed(u)
             |> put("/v1/me/recovery", %{public_key: b64(ctx.pub)})
             |> json_response(200)

    sealed = :crypto.strong_rand_bytes(400)

    assert %{"backup_at" => at} =
             authed(u)
             |> put("/v1/me/recovery/vault", %{vault: Base.encode64(sealed)})
             |> json_response(200)

    assert at

    body = sign_in(c, ctx.pub, ctx.priv) |> json_response(200)
    assert body["access_token"]
    assert body["account"]["profile"]["id"] == u.pid

    # the old phone is signed out
    assert authed(u) |> get("/v1/me") |> json_response(401)

    new = c |> recycle() |> put_req_header("authorization", "Bearer " <> body["access_token"])
    assert %{"vault" => v} = new |> get("/v1/me/recovery/vault") |> json_response(200)
    assert Base.decode64!(v) == sealed

    assert %{"devices" => [_]} =
             new
             |> recycle()
             |> put_req_header("authorization", "Bearer " <> body["access_token"])
             |> get("/v1/me/devices")
             |> json_response(200)
  end

  test "wrong key and wrong message fail the same way", %{u: u, c: c} = ctx do
    authed(u) |> put("/v1/me/recovery", %{public_key: b64(ctx.pub)}) |> json_response(200)
    {other_pub, other_priv} = :crypto.generate_key(:eddsa, :ed25519)

    assert %{"error" => %{"code" => "recovery_invalid"}} =
             sign_in(c, other_pub, other_priv) |> json_response(401)

    assert %{"error" => %{"code" => "recovery_invalid"}} =
             sign_in(c, ctx.pub, ctx.priv, msg: "something else") |> json_response(401)
  end

  test "make new words drops the backup; turn off deletes everything", %{u: u} = ctx do
    authed(u) |> put("/v1/me/recovery", %{public_key: b64(ctx.pub)}) |> json_response(200)
    authed(u) |> put("/v1/me/recovery/vault", %{vault: Base.encode64("x")}) |> json_response(200)
    {pub2, _} = :crypto.generate_key(:eddsa, :ed25519)
    authed(u) |> put("/v1/me/recovery", %{public_key: b64(pub2)}) |> json_response(200)
    assert authed(u) |> get("/v1/me/recovery/vault") |> json_response(404)

    assert authed(u) |> delete("/v1/me/recovery") |> response(204)
    assert %{"on" => false} = authed(u) |> get("/v1/me/recovery") |> json_response(200)

    assert %{"error" => %{"code" => "recovery_off"}} =
             authed(u)
             |> put("/v1/me/recovery/vault", %{vault: Base.encode64("x")})
             |> json_response(409)
  end

  test "bad public key and oversized backup are refused", %{u: u} = ctx do
    assert authed(u) |> put("/v1/me/recovery", %{public_key: b64("short")}) |> json_response(422)
    authed(u) |> put("/v1/me/recovery", %{public_key: b64(ctx.pub)}) |> json_response(200)

    assert authed(u)
           |> put("/v1/me/recovery/vault", %{
             vault: Base.encode64(:binary.copy(<<0>>, 1_048_577))
           })
           |> json_response(422)
  end
end
