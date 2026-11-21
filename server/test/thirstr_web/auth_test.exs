defmodule ThirstrWeb.AuthTest do
  use ThirstrWeb.ConnCase, async: false
  import Swoosh.TestAssertions
  import Ecto.Query
  alias Thirstr.Repo

  describe "email magic link (R-01.3)" do
    @tag ac: "AC-01.3"
    test "always 202, for known and unknown addresses", %{conn: conn} do
      assert conn
             |> post("/v1/auth/email/link", %{email: "new@example.com", age_confirmed: true})
             |> response(202)

      assert conn
             |> recycle()
             |> post("/v1/auth/email/link", %{email: "not-an-email"})
             |> response(202)

      assert conn |> recycle() |> post("/v1/auth/email/link", %{}) |> response(202)
    end

    @tag ac: "AC-01.3"
    test "known vs unknown address: identical status and comparable timing", %{conn: conn} do
      token = link_token(conn, "known@example.com")
      conn |> recycle() |> post("/v1/auth/email/verify", %{token: token}) |> json_response(201)

      time = fn email ->
        {us, resp} =
          :timer.tc(fn ->
            conn |> recycle() |> post("/v1/auth/email/link", %{email: email, age_confirmed: true})
          end)

        assert resp.status == 202
        us
      end

      known = Enum.map(1..5, fn _ -> time.("known@example.com") end) |> Enum.sort() |> Enum.at(2)

      unknown =
        Enum.map(1..5, fn i -> time.("u#{i}@example.com") end) |> Enum.sort() |> Enum.at(2)

      assert abs(known - unknown) < 50_000
    end

    test "link signs up, is single use, stores only a hash", %{conn: conn} do
      token = link_token(conn, "Someone@Example.com ")

      body =
        conn |> recycle() |> post("/v1/auth/email/verify", %{token: token}) |> json_response(201)

      assert body["account"]["onboarding_step"] == "basics"

      assert conn
             |> recycle()
             |> post("/v1/auth/email/verify", %{token: token})
             |> json_response(401)

      # same address (normalised) logs into the same account
      token2 = link_token(conn, "someone@example.com")

      assert conn
             |> recycle()
             |> post("/v1/auth/email/verify", %{token: token2})
             |> json_response(200)

      assert Repo.aggregate(Thirstr.Accounts.Account, :count) == 1
    end

    test "sign-up requires the 18+ checkbox (R-01.12)", %{conn: conn} do
      conn |> post("/v1/auth/email/link", %{email: "kid@example.com"}) |> response(202)
      token = extract_token()

      assert %{"error" => %{"code" => "validation"}} =
               conn
               |> recycle()
               |> post("/v1/auth/email/verify", %{token: token})
               |> json_response(422)
    end
  end

  describe "OIDC (R-01.2)" do
    test "creates once, then logs in; only a peppered hash is stored", %{conn: conn} do
      t = Thirstr.Auth.OIDC.dev_mint("apple-sub-1")

      assert conn
             |> post("/v1/auth/oidc", %{provider: "apple", id_token: t, age_confirmed: true})
             |> json_response(201)

      t = Thirstr.Auth.OIDC.dev_mint("apple-sub-1")

      assert conn
             |> recycle()
             |> post("/v1/auth/oidc", %{provider: "apple", id_token: t})
             |> json_response(200)

      [hash] = Repo.all(from a in "accounts", select: a.auth_oidc_hash)
      assert byte_size(hash) == 32
      refute hash =~ "apple-sub-1"
    end

    test "rejects a token signed by another key", %{conn: conn} do
      jwk = JOSE.JWK.generate_key({:ec, "P-256"})

      claims = %{
        "iss" => "https://dev-oidc.thirstr.invalid",
        "aud" => "thirstr-dev",
        "sub" => "x",
        "exp" => System.system_time(:second) + 60
      }

      {_, forged} = JOSE.JWT.sign(jwk, %{"alg" => "ES256"}, claims) |> JOSE.JWS.compact()

      assert conn
             |> post("/v1/auth/oidc", %{provider: "apple", id_token: forged, age_confirmed: true})
             |> json_response(401)
    end
  end

  describe "tokens (R-01.5)" do
    test "refresh rotates; re-use of a token spent long ago revokes the device", %{conn: conn} do
      {_c, s} = sign_up(conn)
      r1 = s["refresh_token"]
      s2 = conn |> recycle() |> post("/v1/auth/refresh", %{refresh: r1}) |> json_response(200)
      assert s2["refresh_token"] != r1
      # spent 2 min ago: theft signal
      Thirstr.Repo.update_all(Thirstr.Accounts.RefreshToken,
        set: [used_at: DateTime.add(DateTime.utc_now(), -120)]
      )

      assert conn |> recycle() |> post("/v1/auth/refresh", %{refresh: r1}) |> json_response(401)
      # the whole device session is gone (device kept as revoked for a resume, SR-04)
      assert conn
             |> recycle()
             |> post("/v1/auth/refresh", %{refresh: s2["refresh_token"]})
             |> json_response(401)

      assert conn |> authed(s2["access_token"]) |> get("/v1/me") |> json_response(401)
    end

    test "SR-04: a revoked device is resumed by the same install after sign-in", %{conn: conn} do
      sub = "sub-" <> Thirstr.Ids.random_token(6)
      {_c, s} = sign_up(conn, sub)
      assert is_binary(s["device_id"]) and is_binary(s["device_secret"])
      dev = s["device_id"]
      r1 = s["refresh_token"]
      _ = conn |> recycle() |> post("/v1/auth/refresh", %{refresh: r1}) |> json_response(200)

      Thirstr.Repo.update_all(Thirstr.Accounts.RefreshToken,
        set: [used_at: DateTime.add(DateTime.utc_now(), -120)]
      )

      assert conn |> recycle() |> post("/v1/auth/refresh", %{refresh: r1}) |> json_response(401)
      # revoked, not deleted: the row (and its chat queue) is still there
      assert %{revoked_at: %DateTime{}} = Thirstr.Repo.get(Thirstr.Accounts.Device, dev)

      login = fn secret ->
        conn
        |> recycle()
        |> put_req_header("x-thirstr-device", dev)
        |> put_req_header("x-thirstr-device-secret", secret)
        |> post("/v1/auth/oidc", %{
          provider: "apple",
          id_token: Thirstr.Auth.OIDC.dev_mint(sub),
          age_confirmed: true
        })
        |> json_response(200)
      end

      # wrong secret → a new device
      other = login.("nope")
      assert other["device_id"] != dev

      # right secret → same device back, new secret, tokens work
      back = login.(s["device_secret"])
      assert back["device_id"] == dev
      assert back["device_secret"] != s["device_secret"]
      assert conn |> authed(back["access_token"]) |> get("/v1/me") |> json_response(200)
      assert %{revoked_at: nil} = Thirstr.Repo.get(Thirstr.Accounts.Device, dev)
    end

    test "SR-04: revoked devices are purged after 7 days", %{conn: conn} do
      {_c, s} = sign_up(conn)
      :ok = Thirstr.Accounts.revoke_device(s["device_id"])
      assert Thirstr.Accounts.purge_revoked_devices() == 0

      Thirstr.Repo.update_all(Thirstr.Accounts.Device,
        set: [revoked_at: DateTime.add(DateTime.utc_now(), -8 * 86_400)]
      )

      assert Thirstr.Accounts.purge_revoked_devices() == 1
      refute Thirstr.Repo.get(Thirstr.Accounts.Device, s["device_id"])
    end

    test "#116: parallel refresh with the same token is a race, not theft", %{conn: conn} do
      {_c, s} = sign_up(conn)
      r1 = s["refresh_token"]
      s2 = conn |> recycle() |> post("/v1/auth/refresh", %{refresh: r1}) |> json_response(200)
      r = conn |> recycle() |> post("/v1/auth/refresh", %{refresh: r1}) |> json_response(409)
      assert r["error"]["code"] == "refresh_race"
      # device and the winner's tokens still valid
      assert conn |> authed(s2["access_token"]) |> get("/v1/me") |> json_response(200)

      assert conn
             |> recycle()
             |> post("/v1/auth/refresh", %{refresh: s2["refresh_token"]})
             |> json_response(200)
    end

    test "log out everywhere kills access tokens immediately", %{conn: conn} do
      {c, _} = sign_up(conn)
      assert c |> get("/v1/me") |> json_response(200)
      assert c |> recycle_authed() |> post("/v1/auth/logout_all") |> response(204)
      assert c |> recycle_authed() |> get("/v1/me") |> json_response(401)
    end

    test "max 5 devices (R-01.8)", %{conn: conn} do
      for _ <- 1..5,
          do:
            conn
            |> recycle()
            |> post("/v1/auth/oidc", %{
              provider: "google",
              id_token: Thirstr.Auth.OIDC.dev_mint("five"),
              age_confirmed: true
            })

      assert %{"error" => %{"code" => "conflict"}} =
               conn
               |> recycle()
               |> post("/v1/auth/oidc", %{
                 provider: "google",
                 id_token: Thirstr.Auth.OIDC.dev_mint("five")
               })
               |> json_response(409)
    end
  end

  describe "account (R-01.9, R-01.10)" do
    test "pause and resume", %{conn: conn} do
      {c, _} = sign_up(conn)
      assert %{"status" => "paused"} = c |> post("/v1/account/pause") |> json_response(200)

      assert %{"status" => "active"} =
               c |> recycle_authed() |> post("/v1/account/resume") |> json_response(200)
    end

    @tag ac: "AC-01.4"
    test "delete requires typing DELETE and removes every server row", %{conn: conn} do
      {c, _} = sign_up(conn)
      c |> basics() |> json_response(200)
      assert c |> recycle_authed() |> delete("/v1/account") |> json_response(422)
      assert c |> recycle_authed() |> delete("/v1/account", %{confirm: "DELETE"}) |> response(202)

      for t <- ~w(accounts profiles devices refresh_tokens passkeys photos location_cells),
          do: assert(Repo.aggregate(t, :count) == 0, "#{t} not empty")

      assert c |> recycle_authed() |> get("/v1/me") |> json_response(401)
    end
  end

  @tag ac: "AC-01.2"
  test "no phone or plaintext email column exists (AC-01.2)" do
    %{rows: cols} =
      Repo.query!(
        "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'"
      )

    for [t, c] <- cols do
      refute c =~ ~r/phone|msisdn/i, "#{t}.#{c}"
      if c =~ ~r/email/i, do: assert(c == "email_hash", "#{t}.#{c}")
    end
  end

  test "RF-7 add a sign-in email to an Apple account", %{conn: conn} do
    {c, body} = sign_up(conn)
    refute body["account"]["has_email"]

    c |> post("/v1/me/email", %{email: "Later@Example.com"}) |> response(202)
    token = extract_token()

    me = conn |> recycle() |> post("/v1/auth/email/verify", %{token: token}) |> json_response(200)
    assert me["account"]["has_email"]

    # the email now signs into the same account
    again = link_token(conn, "later@example.com")

    me2 =
      conn |> recycle() |> post("/v1/auth/email/verify", %{token: again}) |> json_response(200)

    assert me2["account"]["profile"] == me["account"]["profile"]
  end

  defp link_token(conn, email) do
    conn
    |> recycle()
    |> post("/v1/auth/email/link", %{email: email, age_confirmed: true})
    |> response(202)

    extract_token()
  end

  defp extract_token do
    assert_email_sent(fn email ->
      # #26: sender is on our own domain (thirstr.app belongs to someone else).
      assert email.from == {"Thirstr", "hello@thirstr.fun"}
      send(self(), {:token, Regex.run(~r/token=([\w-]+)/, email.text_body) |> List.last()})
      true
    end)

    receive do
      {:token, t} -> t
    end
  end
end
