defmodule ThirstrWeb.PasskeyTest do
  use ThirstrWeb.ConnCase, async: false
  alias ThirstrWeb.SoftAuthenticator, as: SA

  @origin "https://localhost:7443"

  @tag ac: "AC-01.1"
  test "register with passkey → straight to Basics; then log in", %{conn: conn} do
    auth = SA.new()
    opts = conn |> post("/v1/auth/passkey/register/options") |> json_response(200)
    assert opts["publicKey"]["authenticatorSelection"]["residentKey"] == "required"
    # random user handle: nothing identifying is sent to the authenticator
    assert opts["publicKey"]["user"]["name"] == "Thirstr"

    body =
      conn
      |> recycle()
      |> post(
        "/v1/auth/passkey/register",
        SA.create(auth, opts, @origin) |> Map.put("age_confirmed", true)
      )
      |> json_response(201)

    assert body["account"]["onboarding_step"] == "basics"

    lopts = conn |> recycle() |> post("/v1/auth/passkey/login/options") |> json_response(200)

    assert conn
           |> recycle()
           |> post("/v1/auth/passkey/login", SA.get(auth, lopts, @origin))
           |> json_response(200)
  end

  test "challenge is single use and origin-bound", %{conn: conn} do
    auth = SA.new()
    opts = conn |> post("/v1/auth/passkey/register/options") |> json_response(200)
    att = SA.create(auth, opts, "https://evil.example") |> Map.put("age_confirmed", true)
    assert conn |> recycle() |> post("/v1/auth/passkey/register", att) |> json_response(401)
    # replay with the right origin fails too: challenge already consumed
    att = SA.create(auth, opts, @origin) |> Map.put("age_confirmed", true)
    assert conn |> recycle() |> post("/v1/auth/passkey/register", att) |> json_response(401)
  end

  test "signed-in OIDC account can add a passkey", %{conn: conn} do
    {c, _} = sign_up(conn)
    auth = SA.new()
    opts = conn |> recycle() |> post("/v1/auth/passkey/register/options") |> json_response(200)
    assert c |> post("/v1/auth/passkey/register", SA.create(auth, opts, @origin)) |> response(204)
    lopts = conn |> recycle() |> post("/v1/auth/passkey/login/options") |> json_response(200)

    assert conn
           |> recycle()
           |> post("/v1/auth/passkey/login", SA.get(auth, lopts, @origin))
           |> json_response(200)

    assert Thirstr.Repo.aggregate(Thirstr.Accounts.Account, :count) == 1
  end

  test "unknown credential is rejected", %{conn: conn} do
    lopts = conn |> post("/v1/auth/passkey/login/options") |> json_response(200)

    assert conn
           |> recycle()
           |> post("/v1/auth/passkey/login", SA.get(SA.new(), lopts, @origin))
           |> json_response(401)
  end
end
