defmodule ThirstrWeb.TrustTest do
  use ThirstrWeb.ConnCase, async: false

  # B4a: F-15 reports + franking + quarantine, R-15.14 enforcement + appeals, F-18 vouches,
  # admin console (admin-console.md).
  setup %{conn: conn} do
    alice = onboarded(conn, basics: [display_name: "Alice"])
    bob = onboarded(conn, basics: [display_name: "Bob"])
    {:ok, alice: Map.put(alice, :dev, device_of(alice)), bob: Map.put(bob, :dev, device_of(bob))}
  end

  defp device_of(%{pid: pid}) do
    %{rows: [[d]]} =
      Thirstr.Repo.query!(
        "SELECT d.id::text FROM devices d JOIN profiles p ON p.account_id = d.account_id WHERE p.id = $1 LIMIT 1",
        [Ecto.UUID.dump!(pid)]
      )

    d
  end

  defp req(u, method, path, body \\ nil) do
    c = recycle_authed(u.c)

    case method do
      :get -> get(c, path)
      :post -> post(c, path, body || %{})
      :delete -> delete(c, path)
    end
  end

  # Sends one franked app message from → to and returns the plaintext + franking key.
  defp franked_msg(from, to, text) do
    fk = :crypto.strong_rand_bytes(32)
    plain = Jason.encode!(%{t: "text", text: text, v: 1, id: "m1", at: 1_763_000_000_000})
    tag = :crypto.mac(:hmac, :sha256, fk, plain)

    req(from, :post, "/v1/mls/messages", %{
      from_profile_id: from.pid,
      group_id: Base.encode64("g"),
      franking_tag: Base.encode64(tag),
      envelopes: [
        %{
          to_profile_id: to.pid,
          to_device_id: to.dev,
          kind: "app",
          ciphertext: Base.encode64("ct")
        }
      ]
    })
    |> json_response(200)

    %{plain: Base.encode64(plain), fk: Base.encode64(fk)}
  end

  defp status(u), do: account_of(u.pid).status

  describe "reports (F-15 R-15.9, R-07.11)" do
    test "franked message kept only when the tag matches", %{alice: a, bob: b} do
      good = franked_msg(b, a, "send money or else")
      forged = %{good | plain: Base.encode64(~s({"t":"text","text":"forged"}))}

      assert %{"attached" => 1} =
               req(a, :post, "/v1/reports", %{
                 profile_id: b.pid,
                 reason: "scam",
                 context: "chat",
                 note: "extortion",
                 messages: [good, forged]
               })
               |> json_response(201)

      [[franked]] = Thirstr.Repo.query!("SELECT franked FROM reports").rows
      assert [%{"text" => "send money or else", "t" => "text"}] = franked["messages"]
    end

    test "a Tonight plan can be reported (#210)", %{alice: a, bob: b} do
      assert %{"attached" => 0} =
               req(a, :post, "/v1/reports", %{
                 profile_id: b.pid,
                 reason: "spam_bot",
                 context: "tonight"
               })
               |> json_response(201)

      assert [["tonight"]] = Thirstr.Repo.query!("SELECT context FROM reports").rows
    end

    test "can't attach a message sent to someone else", %{conn: conn, alice: a, bob: b} do
      c = onboarded(conn, basics: [display_name: "Carl"])
      c = Map.put(c, :dev, device_of(c))
      msg = franked_msg(b, c, "hi carl")

      assert %{"attached" => 0} =
               req(a, :post, "/v1/reports", %{
                 profile_id: b.pid,
                 reason: "spam_bot",
                 messages: [msg]
               })
               |> json_response(201)
    end

    test "validation: reason, self", %{alice: a, bob: b} do
      assert req(a, :post, "/v1/reports", %{profile_id: b.pid, reason: "nope"})
             |> json_response(422)

      assert req(a, :post, "/v1/reports", %{profile_id: a.pid, reason: "other"})
             |> json_response(422)
    end

    @tag ac: "R-15.13"
    test "two independent severe reports hide the account (shadow quarantine)", %{
      conn: conn,
      alice: a,
      bob: b
    } do
      c = onboarded(conn, basics: [display_name: "Carl"])
      req(a, :post, "/v1/reports", %{profile_id: b.pid, reason: "underage"}) |> json_response(201)
      assert status(b) == "active"
      req(c, :post, "/v1/reports", %{profile_id: b.pid, reason: "underage"}) |> json_response(201)
      assert status(b) == "quarantined"
      # R-15.6: the account itself still sees a normal status
      assert %{"status" => "active"} = req(b, :get, "/v1/me") |> json_response(200)
      # and drops out of others' view
      assert req(a, :get, "/v1/profiles/#{b.pid}") |> json_response(404)
    end

    @tag ac: "R-15.7"
    test "3 verified bot reports in 24 h quarantine", %{conn: conn, alice: a, bob: b} do
      c = onboarded(conn, basics: [display_name: "Carl"])
      d = onboarded(conn, basics: [display_name: "Dan"])

      for u <- [a, c, d],
          do:
            req(u, :post, "/v1/reports", %{profile_id: b.pid, reason: "spam_bot"})
            |> json_response(201)

      assert status(b) == "quarantined"
    end

    @tag ac: "AC-15.1"
    test "quarantined sender gets 200, recipient receives nothing", %{alice: a, bob: b} do
      Thirstr.Moderation.auto_quarantine(account_of(b.pid), "test")
      franked_msg(b, a, "hello")
      assert %{"messages" => []} = req(a, :get, "/v1/mls/messages") |> json_response(200)
    end
  end

  describe "enforcement, notices, appeals (R-15.14, R-AD.9)" do
    test "suspend: read-only, notice, one appeal, overturn restores", %{alice: a, bob: b} do
      aid = account_of(b.pid).id
      {:ok, action} = Thirstr.Moderation.enforce(aid, "suspend", "harassment", "admin", days: 3)
      assert status(b) == "suspended"

      assert %{"error" => %{"code" => "suspended"}} =
               req(b, :post, "/v1/profiles/#{a.pid}/tap") |> json_response(403)

      assert req(b, :get, "/v1/me") |> json_response(200)

      assert %{"notices" => [%{"action" => "suspend", "reason" => "harassment", "ends_at" => _}]} =
               req(b, :get, "/v1/me/notices") |> json_response(200)

      assert req(b, :post, "/v1/me/notices/#{action}/appeal", %{text: "Wasn't me"})
             |> response(204)

      assert req(b, :post, "/v1/me/notices/#{action}/appeal", %{text: "again"})
             |> json_response(409)

      :ok = Thirstr.Moderation.decide_appeal(action, "overturned", "admin")
      assert status(b) == "active"
    end

    test "quarantine is never listed as a notice", %{bob: b} do
      Thirstr.Moderation.auto_quarantine(account_of(b.pid), "test")
      assert %{"notices" => []} = req(b, :get, "/v1/me/notices") |> json_response(200)
    end

    test "suspension lifts when it ends", %{bob: b} do
      aid = account_of(b.pid).id
      Thirstr.Moderation.enforce(aid, "suspend", "other", "admin", days: 1)
      Thirstr.Repo.query!("UPDATE moderation_actions SET ends_at = now() - interval '1 minute'")
      Thirstr.Moderation.sweep()
      assert status(b) == "active"
    end
  end

  describe "vouches (F-18)" do
    defp chat_both_ways(a, b, n) do
      {x, y} = if a.pid < b.pid, do: {a.pid, b.pid}, else: {b.pid, a.pid}

      Thirstr.Repo.query!(
        "INSERT INTO contacts (profile_a, profile_b, a_sent, b_sent, created_at, updated_at) VALUES ($1, $2, $3, $3, now(), now())",
        [Ecto.UUID.dump!(x), Ecto.UUID.dump!(y), n]
      )
    end

    defp age_account(u, days) do
      Thirstr.Repo.query!(
        "UPDATE accounts SET inserted_at = now() - make_interval(days => $2) WHERE id = (SELECT account_id FROM profiles WHERE id = $1)",
        [Ecto.UUID.dump!(u.pid), days]
      )
    end

    @tag ac: "AC-18.1"
    test "account < 30 d gets 403", %{alice: a, bob: b} do
      chat_both_ways(a, b, 10)
      assert req(a, :post, "/v1/profiles/#{b.pid}/vouch") |> json_response(403)
    end

    test "needs ≥ 10 messages each way; counted anonymously; withdraw", %{alice: a, bob: b} do
      age_account(a, 40)
      chat_both_ways(a, b, 3)
      assert req(a, :post, "/v1/profiles/#{b.pid}/vouch") |> json_response(403)

      Thirstr.Repo.query!("UPDATE contacts SET a_sent = 10, b_sent = 12")

      assert %{"can_vouch" => true, "vouches" => 0} =
               req(a, :get, "/v1/profiles/#{b.pid}") |> json_response(200)

      assert %{"vouched" => true} =
               req(a, :post, "/v1/profiles/#{b.pid}/vouch") |> json_response(200)

      assert %{"vouches" => 1, "vouched" => true} =
               req(a, :get, "/v1/profiles/#{b.pid}") |> json_response(200)

      assert %{"vouches" => 1, "can_vouch" => false} =
               req(b, :get, "/v1/profiles/#{b.pid}") |> json_response(200)

      assert %{"vouched" => false} =
               req(a, :delete, "/v1/profiles/#{b.pid}/vouch") |> json_response(200)

      assert %{"vouches" => 0} = req(a, :get, "/v1/profiles/#{b.pid}") |> json_response(200)
    end

    test "decay: weight 0 after 12 months", %{alice: a, bob: b} do
      age_account(a, 400)
      chat_both_ways(a, b, 10)
      req(a, :post, "/v1/profiles/#{b.pid}/vouch") |> json_response(200)
      Thirstr.Repo.query!("UPDATE vouches SET created_at = now() - interval '13 months'")
      assert Thirstr.Trust.vouch_count(b.pid) == 0
      Thirstr.Repo.query!("UPDATE vouches SET created_at = now() - interval '3 months'")
      assert Thirstr.Trust.vouch_count(b.pid) == 1
    end
  end

  describe "admin console (admin-console.md)" do
    setup %{alice: a} do
      admin = account_of(a.pid).id
      Application.put_env(:thirstr, :admin_account_ids, [admin])
      on_exit(fn -> Application.put_env(:thirstr, :admin_account_ids, []) end)
      {:ok, admin: admin}
    end

    defp admin_conn(id) do
      c = build_conn() |> get("/admin/dev_login?account_id=#{id}")
      assert redirected_to(c) == "/admin"
      c
    end

    test "off when no admin configured", %{conn: conn} do
      Application.put_env(:thirstr, :admin_account_ids, [])
      assert conn |> get("/admin/login") |> response(404)
    end

    @tag ac: "AC-AD.1"
    test "pages need an admin session", %{conn: conn, bob: b} do
      assert conn |> get("/admin") |> redirected_to() == "/admin/login"

      assert build_conn()
             |> get("/admin/dev_login?account_id=#{account_of(b.pid).id}")
             |> response(403)
    end

    @tag ac: "AC-AD.2"
    test "report → suspend: one audit entry per action, report closed, user notified", %{
      admin: admin,
      alice: a,
      bob: b
    } do
      msg = franked_msg(b, a, "pay me")

      req(a, :post, "/v1/reports", %{profile_id: b.pid, reason: "scam", messages: [msg]})
      |> json_response(201)

      [[rid]] = Thirstr.Repo.query!("SELECT id::text FROM reports").rows
      c = admin_conn(admin)
      html = c |> recycle() |> get("/admin") |> html_response(200)
      assert html =~ "Bob" and html =~ "scam"

      html = c |> recycle() |> get("/admin/reports/#{rid}") |> html_response(200)
      assert html =~ "pay me"
      # AC-AD.3: no location, email or IP fields
      refute html =~ ~r/\b(cell_r\d|lat|lng|email|e-mail|remote_ip)\b/i

      csrf = Regex.run(~r/name="_csrf_token" value="([^"]+)"/, html) |> List.last()
      before = audit_count()

      c
      |> recycle()
      |> post("/admin/reports/#{rid}/action", %{
        _csrf_token: csrf,
        action: "suspend",
        reason: "scam",
        days: "7"
      })
      |> redirected_to()

      assert audit_count() == before + 1
      assert status(b) == "suspended"
      assert [["actioned"]] = Thirstr.Repo.query!("SELECT state FROM reports").rows

      assert %{"notices" => [%{"action" => "suspend"}]} =
               req(b, :get, "/v1/me/notices") |> json_response(200)
    end

    test "audit log is append-only", %{admin: admin} do
      admin_conn(admin)
      Thirstr.Repo.query!("DELETE FROM admin_audit")
      Thirstr.Repo.query!("UPDATE admin_audit SET action = 'x'")
      assert [["login"]] = Thirstr.Repo.query!("SELECT action FROM admin_audit").rows
    end

    defp audit_count do
      [[n]] = Thirstr.Repo.query!("SELECT count(*) FROM admin_audit").rows
      n
    end
  end
end
