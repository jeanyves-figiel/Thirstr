defmodule ThirstrWeb.ModConsoleTest do
  use ThirstrWeb.ConnCase, async: false

  # F-15 R-15.44–53 (#179, #286, #287): one queue, CSAM cases, legal filings, reviewer tools, wellbeing.
  alias Thirstr.Repo

  setup %{conn: conn} do
    admin_u = onboarded(conn, basics: [display_name: "Owner"])
    bad = onboarded(conn, basics: [display_name: "Marco"])
    admin = account_of(admin_u.pid).id
    Application.put_env(:thirstr, :admin_account_ids, [admin])
    on_exit(fn -> Application.put_env(:thirstr, :admin_account_ids, []) end)
    {:ok, admin: admin, bad: bad, reporter: admin_u}
  end

  defp admin_conn(id), do: build_conn() |> get("/admin/dev_login?account_id=#{id}")

  defp csrf(html), do: Regex.run(~r/name="_csrf_token" value="([^"]+)"/, html) |> List.last()

  defp hash_hit(u) do
    up =
      u.c
      |> recycle_authed()
      |> post("/v1/me/profiles/#{u.pid}/photos", %{slot: 1})
      |> json_response(201)

    Repo.query!("UPDATE photos SET storage_key = storage_key || '-hashhit' WHERE id = $1", [
      Ecto.UUID.dump!(up["photo_id"])
    ])

    u.c
    |> recycle_authed()
    |> post("/v1/me/profiles/#{u.pid}/photos/#{up["photo_id"]}/check")
    |> json_response(200)

    [[id]] = Repo.query!("SELECT id::text FROM csam_cases").rows
    id
  end

  defp status(u), do: account_of(u.pid).status

  @tag ac: "AC-15.17"
  test "a tier-0 case is listed above an older harassment report", %{
    admin: admin,
    bad: bad,
    reporter: r
  } do
    r.c
    |> recycle_authed()
    |> post("/v1/reports", %{profile_id: bad.pid, reason: "harassment"})
    |> json_response(201)

    Repo.query!("UPDATE reports SET created_at = now() - interval '2 hours'")
    cid = hash_hit(bad)

    html = admin_conn(admin) |> recycle() |> get("/admin") |> html_response(200)
    {case_at, _} = :binary.match(html, "/admin/cases/#{cid}")
    {report_at, _} = :binary.match(html, "/admin/reports/")
    assert case_at < report_at
  end

  test "confirm: ban, blocklist, pack, filings; every step audited", %{admin: admin, bad: bad} do
    cid = hash_hit(bad)
    c = admin_conn(admin)
    html = c |> recycle() |> get("/admin/cases/#{cid}") |> html_response(200)
    assert html =~ "Known-image match"
    # R-15.52: the image is never in the page until a reasoned, confirmed view.
    refute html =~ "-hashhit"

    c
    |> recycle()
    |> post("/admin/cases/#{cid}/decision", %{_csrf_token: csrf(html), decision: "confirm"})
    |> redirected_to()
    |> Kernel.=~("/admin/pause")
    |> assert()

    assert status(bad) == "banned"
    assert [[1]] = Repo.query!("SELECT count(*) FROM hash_blocklist").rows

    html = c |> recycle() |> get("/admin/cases/#{cid}") |> html_response(200)
    assert html =~ "A-13 Legal report"

    c
    |> recycle()
    |> post("/admin/cases/#{cid}/filings", %{
      _csrf_token: csrf(html),
      authority: "ncmec",
      external_ref: "CT-123"
    })
    |> redirected_to()

    pack = c |> recycle() |> get("/admin/cases/#{cid}/pack") |> json_response(200)
    assert pack["case"] == cid
    assert pack["public_profile_at_upload"]["display_name"] == "Marco"
    refute Map.has_key?(pack["account"], "email")

    actions = Repo.query!("SELECT action FROM admin_audit").rows |> List.flatten()
    assert "case_confirm" in actions and "case_filed_ncmec" in actions and "case_pack" in actions
  end

  @tag ac: "AC-15.16"
  test "viewing a case image needs a reason and a confirm, and is audited", %{
    admin: admin,
    bad: bad
  } do
    cid = hash_hit(bad)
    c = admin_conn(admin)
    html = c |> recycle() |> get("/admin/cases/#{cid}") |> html_response(200)

    assert c
           |> recycle()
           |> post("/admin/cases/#{cid}/view", %{_csrf_token: csrf(html), reason: "check"})
           |> response(422)

    html2 =
      c
      |> recycle()
      |> post("/admin/cases/#{cid}/view", %{
        _csrf_token: csrf(html),
        reason: "verify match",
        confirm: "yes"
      })
      |> html_response(200)

    assert html2 =~ "-hashhit"

    assert [["verify match"]] =
             Repo.query!("SELECT reason FROM admin_audit WHERE action = 'case_image_view'").rows
  end

  test "false positive releases the account and sends the photo to a person", %{
    admin: admin,
    bad: bad
  } do
    cid = hash_hit(bad)
    assert status(bad) == "quarantined"
    c = admin_conn(admin)
    html = c |> recycle() |> get("/admin/cases/#{cid}") |> html_response(200)

    c
    |> recycle()
    |> post("/admin/cases/#{cid}/decision", %{_csrf_token: csrf(html), decision: "false_positive"})
    |> redirected_to()

    assert status(bad) == "active"

    assert [["pending", "queued"]] =
             Repo.query!("SELECT status, review_state FROM photos WHERE slot = 1").rows
  end

  @tag ac: "AC-15.18"
  test "review photos render blurred with the tools", %{admin: admin, bad: bad} do
    up =
      bad.c
      |> recycle_authed()
      |> post("/v1/me/profiles/#{bad.pid}/photos", %{slot: 0})
      |> json_response(201)

    Repo.query!("UPDATE photos SET storage_key = storage_key || '-borderline' WHERE id = $1", [
      Ecto.UUID.dump!(up["photo_id"])
    ])

    bad.c
    |> recycle_authed()
    |> post("/v1/me/profiles/#{bad.pid}/photos/#{up["photo_id"]}/check")

    c = admin_conn(admin)
    html = c |> recycle() |> get("/admin/photos") |> html_response(200)
    assert html =~ ~s(class="img blur")
    assert html =~ "Hold to peek" and html =~ "Escalate as CSAM"

    # Escalate opens a case and quarantines (R-15.45).
    c
    |> recycle()
    |> post("/admin/photos/#{up["photo_id"]}/escalate", %{_csrf_token: csrf(html)})
    |> redirected_to()

    assert [["classifier"]] = Repo.query!("SELECT source FROM csam_cases").rows
    assert status(bad) == "quarantined"
  end

  test "wellbeing: time on tier 0 pages is counted and the banner shows at 2 h", %{
    admin: admin,
    bad: bad
  } do
    cid = hash_hit(bad)
    c = admin_conn(admin)
    c = c |> recycle() |> get("/admin/cases/#{cid}")
    c |> recycle() |> get("/admin/me") |> html_response(200)
    assert [[0]] = Repo.query!("SELECT tier FROM mod_time").rows

    Repo.query!("UPDATE mod_time SET seconds = 7300")
    html = admin_conn(admin) |> recycle() |> get("/admin") |> html_response(200)
    assert html =~ "Time for a break"
  end
end
