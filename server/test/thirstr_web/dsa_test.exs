defmodule ThirstrWeb.DsaTest do
  # F-15 R-15.23–R-15.36 (#170): DSA notices, statement of reasons, reviews, misuse, web form.
  use ThirstrWeb.ConnCase, async: false

  setup %{conn: conn} do
    alice = onboarded(conn, basics: [display_name: "Alice"])
    bob = onboarded(conn, basics: [display_name: "Bob"])
    {:ok, alice: alice, bob: bob}
  end

  defp req(u, method, path, body \\ nil) do
    c = recycle_authed(u.c)

    case method do
      :get -> get(c, path)
      :post -> post(c, path, body || %{})
    end
  end

  defp report_id(ref) do
    [[id]] = Thirstr.Repo.query!("SELECT id::text FROM reports WHERE ref = $1", [ref]).rows
    id
  end

  @illegal %{
    reason: "other",
    illegal: true,
    legal_type: "intimate_images",
    country: "de",
    explanation: "He posted a private photo of me as his public photo.",
    good_faith: true
  }

  @tag ac: "AC-15.6"
  test "illegal report needs explanation and good faith", %{alice: a, bob: b} do
    base = Map.put(@illegal, :profile_id, b.pid)

    assert %{"error" => %{"fields" => %{"explanation" => _}}} =
             req(a, :post, "/v1/reports", %{base | explanation: "too short"})
             |> json_response(422)

    assert %{"error" => %{"fields" => %{"good_faith" => _}}} =
             req(a, :post, "/v1/reports", %{base | good_faith: false}) |> json_response(422)

    assert %{"ref" => "R-" <> _ = ref} = req(a, :post, "/v1/reports", base) |> json_response(201)

    assert [[true, "intimate_images", "DE", 2]] =
             Thirstr.Repo.query!(
               "SELECT illegal, legal_type, country, severity FROM reports WHERE ref = $1",
               [ref]
             ).rows
  end

  @tag ac: "AC-15.8"
  test "notifier sees the outcome without a name and can ask for one review", %{alice: a, bob: b} do
    %{"ref" => ref} =
      req(a, :post, "/v1/reports", %{profile_id: b.pid, reason: "spam_bot"}) |> json_response(201)

    id = report_id(ref)
    :ok = Thirstr.Reports.decide(id, "no_action")

    body = req(a, :get, "/v1/me/reports") |> json_response(200)

    assert [%{"ref" => ^ref, "decision" => "no_action", "review_until" => _, "seen" => false} = r] =
             body["reports"]

    refute Jason.encode!(body) =~ "Bob"
    refute Map.has_key?(r, "profile_id")

    assert req(a, :post, "/v1/me/reports/#{id}/review", %{text: "He is a bot"}) |> response(204)
    assert req(a, :post, "/v1/me/reports/#{id}/review", %{text: "again"}) |> json_response(409)

    :ok = Thirstr.Reports.decide_review(id, "overturned", "admin", "Looked again: bot.")

    assert [%{"review" => "overturned", "review_reason" => "Looked again: bot."}] =
             (req(a, :get, "/v1/me/reports") |> json_response(200))["reports"]

    assert [["open"]] =
             Thirstr.Repo.query!("SELECT state FROM reports WHERE id = $1", [Ecto.UUID.dump!(id)]).rows
  end

  test "a review is only possible on no action", %{alice: a, bob: b} do
    %{"ref" => ref} =
      req(a, :post, "/v1/reports", %{profile_id: b.pid, reason: "harassment"})
      |> json_response(201)

    id = report_id(ref)
    :ok = Thirstr.Reports.decide(id, "suspended")
    assert req(a, :post, "/v1/me/reports/#{id}/review", %{text: "x"}) |> json_response(409)
  end

  @tag ac: "AC-15.7"
  test "every visible action carries a statement of reasons", %{alice: a, bob: b} do
    %{"ref" => ref} =
      req(a, :post, "/v1/reports", %{profile_id: b.pid, reason: "harassment"})
      |> json_response(201)

    aid = account_of(b.pid).id

    {:ok, action} =
      Thirstr.Moderation.enforce(aid, "suspend", "harassment", "admin",
        days: 7,
        report_id: report_id(ref),
        facts: "Repeated insults after being asked to stop.",
        ground: "tos"
      )

    assert [n] = (req(b, :get, "/v1/me/notices") |> json_response(200))["notices"]

    assert %{
             "id" => ^action,
             "ground" => "tos",
             "facts" => "Repeated insults after being asked to stop.",
             "detected_by" => "report",
             "decided_by" => "person",
             "appeal_until" => until
           } = n

    {:ok, until, _} = DateTime.from_iso8601(until)
    assert DateTime.diff(until, DateTime.utc_now(), :day) in 182..183

    assert req(b, :post, "/v1/me/notices/#{action}/appeal", %{text: "Context missing"})
           |> response(204)

    :ok = Thirstr.Moderation.decide_appeal(action, "overturned", "owner", "Messages were banter.")

    assert [
             %{
               "appeal" => "overturned",
               "appeal_reason" => "Messages were banter.",
               "reviewed_by_other" => true
             }
           ] =
             (req(b, :get, "/v1/me/notices") |> json_response(200))["notices"]
  end

  test "appeal window closes after 6 months", %{bob: b} do
    {:ok, action} = Thirstr.Moderation.enforce(account_of(b.pid).id, "warn", "spam_bot", "admin")
    Thirstr.Repo.query!("UPDATE moderation_actions SET appeal_until = now() - interval '1 day'")
    assert req(b, :post, "/v1/me/notices/#{action}/appeal", %{text: "late"}) |> json_response(409)
  end

  @tag ac: "R-15.34"
  test "misuse: clearly unfounded reports lead to a warning", %{conn: conn, alice: a} do
    for i <- 1..5 do
      t = onboarded(conn, basics: [display_name: "T#{i}"])

      %{"ref" => ref} =
        req(a, :post, "/v1/reports", %{profile_id: t.pid, reason: "other"}) |> json_response(201)

      :ok = Thirstr.Reports.decide(report_id(ref), "no_action", unfounded: i <= 3)
    end

    assert [%{"action" => "warn", "reason" => "report_misuse", "decided_by" => "auto"}] =
             (req(a, :get, "/v1/me/notices") |> json_response(200))["notices"]
  end

  describe "web form (R-15.25)" do
    setup %{bob: b} do
      slug = "AbCdEfGh12"

      Thirstr.Repo.query!(
        "INSERT INTO profile_shares (slug, profile_id, created_at) VALUES ($1, $2, now())",
        [slug, Ecto.UUID.dump!(b.pid)]
      )

      Application.put_env(:thirstr, :report_form_min_age_s, 0)
      on_exit(fn -> Application.delete_env(:thirstr, :report_form_min_age_s) end)
      {:ok, slug: slug}
    end

    @tag ac: "AC-15.9"
    test "form has no scripts and posts to itself", %{conn: conn} do
      conn = get(conn, "/report")
      html = html_response(conn, 200)
      refute html =~ "<script"
      [csp] = get_resp_header(conn, "content-security-policy")
      assert csp =~ "default-src 'none'"
      refute csp =~ "script-src"
      assert html =~ ~s(action="/report?lang=en")
    end

    test "valid notice stores a sealed contact and returns a reference", %{conn: conn, slug: slug} do
      conn =
        post(conn, "/report", %{
          "t" => ThirstrWeb.ReportPageController.token(),
          "link" => "https://thirstr.fun/p/#{slug}",
          "legal_type" => "fraud",
          "explanation" => "This profile asks people for money for fake meetups.",
          "name" => "Sam",
          "email" => "sam@example.org",
          "good_faith" => "on"
        })

      assert html_response(conn, 201) =~ "R-"

      [[channel, reporter, enc, reason]] =
        Thirstr.Repo.query!(
          "SELECT channel, reporter_account, notifier_contact_enc, reason FROM reports"
        ).rows

      assert {channel, reporter, reason} == {"web", nil, "scam"}
      refute enc =~ "sam@example.org"
      assert %{"email" => "sam@example.org"} = Thirstr.Reports.Web.open(enc)
    end

    test "csam notice can be anonymous; others need a name and email", %{conn: conn, slug: slug} do
      base = %{
        "link" => "thirstr.fun/p/#{slug}",
        "explanation" => "The person in the main photo looks like a child.",
        "good_faith" => "on"
      }

      r =
        post(
          conn,
          "/report",
          Map.merge(base, %{
            "t" => ThirstrWeb.ReportPageController.token(),
            "legal_type" => "threats"
          })
        )

      assert html_response(r, 422) =~ "add your name"

      r =
        post(
          build_conn(),
          "/report",
          Map.merge(base, %{
            "t" => ThirstrWeb.ReportPageController.token(),
            "legal_type" => "csam"
          })
        )

      assert html_response(r, 201)

      assert [[1]] =
               Thirstr.Repo.query!("SELECT severity FROM reports WHERE legal_type = 'csam'").rows
    end

    test "honeypot and missing token are refused", %{conn: conn, slug: slug} do
      r = post(conn, "/report", %{"link" => "thirstr.fun/p/#{slug}", "website" => "x"})
      assert html_response(r, 422)
      assert [[0]] = Thirstr.Repo.query!("SELECT count(*) FROM reports").rows
    end
  end
end
