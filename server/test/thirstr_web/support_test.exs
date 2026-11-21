defmodule ThirstrWeb.SupportTest do
  # F-22 (#178): contact requests answered in the app, feedback → anonymous issues, help votes,
  # recovery claims with identity checks and no admin path.
  use ThirstrWeb.ConnCase, async: false
  use Oban.Testing, repo: Thirstr.Repo
  import Swoosh.TestAssertions
  alias Thirstr.{Feedback, Repo}
  alias Thirstr.Support.Scrub

  defp member(conn) do
    {c, body} = sign_up(conn)
    c |> recycle_authed() |> basics(%{display_name: "Marc"}) |> json_response(200)
    {c, body}
  end

  defp account_id(_c),
    do: Repo.query!("SELECT id::text FROM accounts LIMIT 1").rows |> hd() |> hd()

  describe "contact (R-22.7–R-22.12)" do
    @tag ac: "AC-22.2"
    test "request stays on the server; the alert email has no message text", %{conn: conn} do
      {c, _} = member(conn)

      r =
        c
        |> recycle_authed()
        |> post("/v1/support/requests", %{
          topic: "broken",
          lang: "fr",
          message:
            "Map stays empty after I switch to Map, only on mobile data. Secret detail 4711.",
          app_details: %{"version" => "0.9.2", "platform" => "ios", "name" => "should be dropped"}
        })
        |> json_response(201)

      assert r["ref"] =~ ~r/^T-[A-Z2-9]{6}$/

      assert_email_sent(fn email ->
        [{_, to}] = email.to
        assert to == "support@thirstr.fun"
        assert email.subject =~ r["ref"]
        refute email.text_body =~ "Secret detail"
        refute email.text_body =~ "should be dropped"
        assert email.reply_to == nil
      end)

      [[details]] = Repo.query!("SELECT app_details FROM support_requests").rows
      refute Map.has_key?(details, "name")

      list = c |> recycle_authed() |> get("/v1/support/requests") |> json_response(200)
      assert [%{"ref" => ref, "status" => "open"}] = list["requests"]
      assert ref == r["ref"]
    end

    @tag ac: "AC-22.3"
    test "support reply reaches the member's thread; member answers; solve", %{conn: conn} do
      {c, _} = member(conn)

      %{"id" => id} =
        c
        |> recycle_authed()
        |> post("/v1/support/requests", %{topic: "account", message: String.duplicate("a", 30)})
        |> json_response(201)

      :ok = Thirstr.Support.answer(id, "Try {ref} please", "waiting")
      t = c |> recycle_authed() |> get("/v1/support/requests/#{id}") |> json_response(200)
      assert t["status"] == "waiting"
      assert [%{"from" => "member"}, %{"from" => "support"}] = t["messages"]

      c
      |> recycle_authed()
      |> post("/v1/support/requests/#{id}/messages", %{body: "Thanks"})
      |> response(201)

      c |> recycle_authed() |> post("/v1/support/requests/#{id}/solve") |> response(204)

      t = c |> recycle_authed() |> get("/v1/support/requests/#{id}") |> json_response(200)
      assert t["status"] == "solved"
      assert length(t["messages"]) == 3
    end

    test "someone else's request is not found", %{conn: conn} do
      {a, _} = member(conn)
      {b, _} = member(build_conn())

      %{"id" => id} =
        a
        |> recycle_authed()
        |> post("/v1/support/requests", %{topic: "other", message: String.duplicate("x", 25)})
        |> json_response(201)

      b |> recycle_authed() |> get("/v1/support/requests/#{id}") |> json_response(404)
    end

    test "signed out needs an email; validation; 3 open at most", %{conn: conn} do
      conn
      |> post("/v1/support/requests", %{topic: "account", message: String.duplicate("x", 25)})
      |> json_response(422)

      build_conn()
      |> post("/v1/support/requests", %{
        topic: "account",
        message: String.duplicate("x", 25),
        reply_email: "me@example.com"
      })
      |> json_response(201)

      {c, _} = member(build_conn())

      c
      |> recycle_authed()
      |> post("/v1/support/requests", %{topic: "nope", message: "short"})
      |> json_response(422)

      for _ <- 1..3 do
        c
        |> recycle_authed()
        |> post("/v1/support/requests", %{topic: "other", message: String.duplicate("y", 25)})
        |> json_response(201)
      end

      assert %{"error" => %{"code" => "support_limit"}} =
               c
               |> recycle_authed()
               |> post("/v1/support/requests", %{
                 topic: "other",
                 message: String.duplicate("y", 25)
               })
               |> json_response(409)
    end
  end

  describe "feedback (R-22.30–R-22.34)" do
    @tag ac: "AC-22.7"
    test "scrubbed, anonymous issue body; text queued then filed", %{conn: conn} do
      {c, _} = member(conn)
      aid = account_id(c)
      Repo.query!("UPDATE accounts SET inserted_at = now() - interval '2 days'")

      c
      |> recycle_authed()
      |> post("/v1/feedback", %{
        type: "idea",
        part: "chats",
        text: "call me on +41 79 123 45 67 or a@b.ch, I'm Marc from Zürich",
        app: %{version: "0.9.2", platform: "ios", os: "26", lang: "fr"}
      })
      |> response(202)

      [[id, text]] = Repo.query!("SELECT id::text, text_scrubbed FROM feedback").rows
      refute text =~ "123 45 67"
      refute text =~ "a@b.ch"
      refute text =~ "Marc"
      assert_enqueued(worker: Thirstr.Jobs.FeedbackIssue, args: %{id: id})

      %{title: t, body: b, labels: l} =
        Feedback.issue(%{
          kind: "idea",
          part: "chats",
          text: text,
          app: %{"version" => "0.9.2"},
          id: id,
          date: Date.utc_today()
        })

      assert t =~ "[Feedback] Idea:"
      assert "area:chats" in l
      refute b =~ aid
      refute b =~ ~r/\d{2}:\d{2}/
    end

    test "new accounts wait a day; not configured → job errors (retries)", %{conn: conn} do
      {c, _} = member(conn)

      c
      |> recycle_authed()
      |> post("/v1/feedback", %{type: "idea", text: "A good idea here"})
      |> json_response(422)

      Repo.query!("UPDATE accounts SET inserted_at = now() - interval '2 days'")

      c
      |> recycle_authed()
      |> post("/v1/feedback", %{type: "love", text: "A good idea here"})
      |> response(202)

      [[id]] = Repo.query!("SELECT id::text FROM feedback").rows
      assert {:error, :not_configured} = Feedback.file(id)
    end

    test "held words stay for the admin" do
      assert Scrub.hold?("you are a faggot")
      refute Scrub.hold?("I'd love dark mode")
    end
  end

  describe "scrubber" do
    test "removes contact data, links, handles, addresses and own names" do
      s =
        Scrub.scrub(
          "Mail jo.doe+x@gmail.com, see https://evil.example/x and thirstr.fun, @jonny, " <>
            "12 rue de Lausanne, Bahnhofstrasse 7, 47.3769, 8.5417, CH93 0076 2011 6238 5295 7 — Max said hi",
          ["Max"]
        )

      for bad <- ~w(gmail evil thirstr.fun @jonny Lausanne Bahnhofstrasse 47.3769 CH93 Max),
          do: refute(s =~ bad, "#{bad} left in: #{s}")

      assert s =~ "said hi"
    end
  end

  describe "help votes (R-22.5)" do
    test "counted without an account; note scrubbed", %{conn: conn} do
      conn
      |> post("/v1/help/votes", %{article: "hide-distance", lang: "de", helpful: true})
      |> response(204)

      build_conn()
      |> post("/v1/help/votes", %{
        article: "hide-distance",
        lang: "de",
        helpful: false,
        reason: "hard",
        note: "mail me at x@y.de"
      })
      |> response(204)

      [[up, down, reasons]] = Repo.query!("SELECT up, down, reasons FROM help_votes").rows
      assert {up, down, reasons} == {1, 1, %{"hard" => 1}}
      [[note]] = Repo.query!("SELECT note FROM help_notes").rows
      refute note =~ "x@y.de"
    end
  end

  describe "recovery claims (R-22.20–R-22.26)" do
    defp verified(c) do
      Repo.query!("UPDATE accounts SET verified_at = now()")
      c
    end

    defp claim(c) do
      c
      |> recycle_authed()
      |> post("/v1/auth/recovery/claim", %{method: "apple"})
      |> json_response(201)
    end

    defp selfie(c, id, passed) do
      %{"nonce" => n} =
        c
        |> recycle_authed()
        |> post("/v1/auth/recovery/claim/#{id}/challenge")
        |> json_response(200)

      c
      |> recycle_authed()
      |> post("/v1/auth/recovery/claim/#{id}/selfie", %{nonce: n, passed: passed})
    end

    @tag ac: "AC-22.5"
    test "selfie passes → hold → take back signs out others and removes other methods", %{
      conn: conn
    } do
      {c, _} = member(conn)
      verified(c)
      %{"id" => id, "state" => "started"} = claim(c)

      assert %{"error" => %{"code" => "recovery_check_failed"}} =
               selfie(c, id, false) |> json_response(422)

      %{"state" => "holding", "hold_ends_at" => _} = selfie(c, id, true) |> json_response(200)

      c
      |> recycle_authed()
      |> post("/v1/auth/recovery/claim/#{id}/complete")
      |> json_response(422)

      Repo.query!("UPDATE recovery_claims SET hold_ends_at = now() - interval '1 minute'")

      r =
        c
        |> recycle_authed()
        |> post("/v1/auth/recovery/claim/#{id}/complete")
        |> json_response(200)

      assert "recovery_phrase" in r["removed_methods"]

      kinds = Repo.query!("SELECT kind FROM security_events ORDER BY id").rows |> List.flatten()
      assert kinds == ~w(claim_started selfie_failed selfie_passed claim_completed)
    end

    test "3 failed selfies lock claims for 24 h; one active claim at a time", %{conn: conn} do
      {c, _} = member(conn)
      verified(c)
      %{"id" => id} = claim(c)

      c
      |> recycle_authed()
      |> post("/v1/auth/recovery/claim", %{method: "apple"})
      |> json_response(409)

      for _ <- 1..3, do: selfie(c, id, false) |> json_response(422)

      c
      |> recycle_authed()
      |> post("/v1/auth/recovery/claim", %{method: "apple"})
      |> json_response(403)
    end

    test "unverified accounts get a 72 h hold without a selfie", %{conn: conn} do
      {c, _} = member(conn)
      %{"state" => "holding", "hold_ends_at" => ends} = claim(c)
      {:ok, t, _} = DateTime.from_iso8601(ends)
      assert DateTime.diff(t, DateTime.utc_now(), :hour) in 71..72
    end

    test "a cancel from another device needs a passing selfie", %{conn: conn} do
      {c, _} = member(conn)
      verified(c)
      %{"id" => id} = claim(c)
      selfie(c, id, true) |> json_response(200)

      # same account, second device: insert a session for it via a fresh sign-in of the same sub
      [[sub_hash]] = Repo.query!("SELECT auth_oidc_hash FROM accounts").rows
      assert is_binary(sub_hash)

      assert {:error, {:unprocessable, "recovery_check_failed", _}} =
               Thirstr.RecoveryClaims.cancel_from_other(
                 Repo.get!(Thirstr.Accounts.Account, account_id(c)),
                 Ecto.UUID.generate(),
                 id,
                 %{"nonce" => "x", "passed" => false}
               )
    end

    @tag ac: "AC-22.4"
    test "no admin route can change sign-in, devices, recovery or ownership" do
      admin_routes =
        ThirstrWeb.Router.__routes__()
        |> Enum.filter(&String.starts_with?(&1.path, "/admin"))
        |> Enum.map(&(&1.path <> " " <> to_string(&1.plug_opts)))

      for r <- admin_routes,
          do: refute(r =~ ~r/passkey|device|recovery|claim|email|oidc|sign_?in_method|owner/i, r)
    end
  end
end
