defmodule ThirstrWeb.PasskeyManageTest do
  use ThirstrWeb.ConnCase, async: false
  alias ThirstrWeb.SoftAuthenticator, as: SA

  # F-01 R-01.16 / AC-01.9: passkeys in Settings › Account.
  @origin "https://localhost:7443"
  @icloud Ecto.UUID.dump!("fbfc3007-154e-4ecc-8c0b-6e020557d7bd")

  defp add(c, auth) do
    opts =
      c |> recycle_authed() |> post("/v1/auth/passkey/register/options") |> json_response(200)

    c |> recycle_authed() |> post("/v1/auth/passkey/register", SA.create(auth, opts, @origin))
  end

  @tag ac: "AC-01.9"
  test "Apple account adds a passkey, sees it, signs in with it, removes it", %{conn: conn} do
    {c, _} = sign_up(conn)
    me = c |> recycle_authed() |> get("/v1/me") |> json_response(200)
    assert me["oidc_provider"] == "apple" and me["passkey_count"] == 0

    opts =
      c |> recycle_authed() |> post("/v1/auth/passkey/register/options") |> json_response(200)

    assert opts["publicKey"]["authenticatorSelection"]["userVerification"] == "required"

    auth = SA.new() |> Map.put(:aaguid, @icloud)
    assert add(c, auth) |> response(204)

    [pk] =
      c |> recycle_authed() |> get("/v1/me/passkeys") |> json_response(200) |> Map.get("passkeys")

    assert pk["provider"] == "iCloud Keychain" and pk["last_used_at"] == nil
    refute Map.has_key?(pk, "credential_id")

    lopts = build_conn() |> post("/v1/auth/passkey/login/options") |> json_response(200)

    assert build_conn()
           |> post("/v1/auth/passkey/login", SA.get(auth, lopts, @origin))
           |> json_response(200)

    [pk] =
      c |> recycle_authed() |> get("/v1/me/passkeys") |> json_response(200) |> Map.get("passkeys")

    assert pk["last_used_at"]

    # Apple still works → removing the only passkey is fine
    assert c |> recycle_authed() |> delete("/v1/me/passkeys/#{pk["id"]}") |> response(204)

    assert c |> recycle_authed() |> get("/v1/me/passkeys") |> json_response(200) == %{
             "passkeys" => []
           }

    kinds = Thirstr.Repo.query!("SELECT kind FROM security_events").rows |> List.flatten()
    assert "passkey_added" in kinds and "passkey_removed" in kinds
  end

  test "the last way back in can't be removed", %{conn: conn} do
    auth = SA.new()
    opts = conn |> post("/v1/auth/passkey/register/options") |> json_response(200)

    body =
      conn
      |> recycle()
      |> post(
        "/v1/auth/passkey/register",
        SA.create(auth, opts, @origin) |> Map.put("age_confirmed", true)
      )
      |> json_response(201)

    c = authed(conn, body["access_token"])

    [pk] =
      c |> recycle_authed() |> get("/v1/me/passkeys") |> json_response(200) |> Map.get("passkeys")

    assert pk["provider"] == "Passkey"

    r = c |> recycle_authed() |> delete("/v1/me/passkeys/#{pk["id"]}") |> json_response(409)
    assert r["error"]["code"] == "last_method"

    # a second passkey makes the first removable
    assert add(c, SA.new()) |> response(204)
    assert c |> recycle_authed() |> delete("/v1/me/passkeys/#{pk["id"]}") |> response(204)
  end

  test "at most 10 passkeys; others' passkeys are not found", %{conn: conn} do
    {c, _} = sign_up(conn)

    # only account so far (the API never exposes account ids)
    a = Thirstr.Repo.one!(Thirstr.Accounts.Account)

    for _ <- 1..10,
        do: {:ok, _} = Thirstr.Accounts.add_passkey(a, :crypto.strong_rand_bytes(32), %{}, 0)

    assert (add(c, SA.new()) |> json_response(409))["error"]["code"] == "passkey_limit"

    {other, _} = sign_up(build_conn())

    [pk | _] =
      c |> recycle_authed() |> get("/v1/me/passkeys") |> json_response(200) |> Map.get("passkeys")

    assert other |> recycle_authed() |> delete("/v1/me/passkeys/#{pk["id"]}") |> response(404)
  end
end
