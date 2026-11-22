defmodule ThirstrWeb.PhotoAfterReviewTest do
  use ThirstrWeb.ConnCase, async: false
  alias Thirstr.Repo

  # F-15 R-15.56 (#325): photos go live when the AI passes them; borderline is reviewed after.
  setup %{conn: conn} do
    owner = onboarded(conn, basics: [display_name: "Owner"])
    u = onboarded(conn, basics: [display_name: "Marco"])
    admin = account_of(owner.pid).id
    Application.put_env(:thirstr, :admin_account_ids, [admin])
    on_exit(fn -> Application.put_env(:thirstr, :admin_account_ids, []) end)
    {:ok, c: build_conn() |> get("/admin/dev_login?account_id=#{admin}"), u: u}
  end

  defp upload(u, slot, suffix) do
    id =
      u.c
      |> recycle_authed()
      |> post("/v1/me/profiles/#{u.pid}/photos", %{slot: slot})
      |> json_response(201)
      |> Map.fetch!("photo_id")

    Repo.query!("UPDATE photos SET storage_key = storage_key || $2 WHERE id = $1", [
      Ecto.UUID.dump!(id),
      suffix
    ])

    u.c |> recycle_authed() |> post("/v1/me/profiles/#{u.pid}/photos/#{id}/check")
    id
  end

  defp row(id) do
    [r] =
      Repo.query!(
        "SELECT status, review_state, classifier_score->>'main_ok' FROM photos WHERE id = $1",
        [Ecto.UUID.dump!(id)]
      ).rows

    r
  end

  defp csrf(html), do: Regex.run(~r/name="_csrf_token" value="([^"]+)"/, html) |> List.last()

  defp audits(action) do
    [[n]] = Repo.query!("SELECT count(*) FROM admin_audit WHERE action = $1", [action]).rows
    n
  end

  test "borderline goes live at once, not main_ok; Keep takes it off the list", %{c: c, u: u} do
    id = upload(u, 0, "-borderline")
    assert ["ok_main", "after", "false"] = row(id)

    html = c |> recycle() |> get("/admin/photos") |> html_response(200)
    assert html =~ "Live, AI unsure"
    assert html =~ ~s(action="/admin/photos/#{id}")
    queue = c |> recycle() |> get("/admin") |> html_response(200)
    assert queue =~ "live, AI unsure"

    c
    |> recycle()
    |> post("/admin/photos/#{id}", %{_csrf_token: csrf(html), decision: "keep"})
    |> redirected_to()

    assert ["ok_main", "done", "false"] = row(id)
    assert audits("photo_keep") == 1
  end

  test "Remove on a live photo sends a statement of reasons", %{c: c, u: u} do
    id = upload(u, 0, "-borderline")
    assert ["ok_main", "after", "false"] = row(id)
    html = c |> recycle() |> get("/admin/photos") |> html_response(200)

    assert c
           |> recycle()
           |> post("/admin/photos/#{id}", %{
             _csrf_token: csrf(html),
             decision: "remove",
             reason: "other",
             facts: ""
           })
           |> response(422)

    c
    |> recycle()
    |> post("/admin/photos/#{id}", %{
      _csrf_token: csrf(html),
      decision: "remove",
      reason: "other",
      facts: "Too explicit for the main photo."
    })
    |> redirected_to()

    assert ["rejected", "done", _] = row(id)

    assert [["remove_photo", "Too explicit for the main photo."]] =
             Repo.query!("SELECT action, facts FROM moderation_actions").rows

    assert audits("photo_remove") == 1
  end

  test "no AI verdict: hidden, retried, a person decides only after 6 h", %{u: u} do
    id = upload(u, 1, "-noverdict")
    assert ["pending", nil, "false"] = row(id)

    Thirstr.Profiles.retry_hash_checks()
    assert ["pending", nil, _] = row(id)

    Repo.query!("UPDATE photos SET inserted_at = now() - interval '7 hours' WHERE id = $1", [
      Ecto.UUID.dump!(id)
    ])

    Thirstr.Profiles.retry_hash_checks()
    assert ["pending", "queued", _] = row(id)
  end

  test "daily sample marks random live photos once", %{c: c, u: u} do
    ids = for slot <- [0, 1, 2], do: upload(u, slot, "")
    assert Enum.all?(ids, &(Enum.at(row(&1), 1) == nil))

    [[live]] =
      Repo.query!(
        "SELECT count(*) FROM photos WHERE status IN ('ok_main', 'ok_public') AND review_state IS NULL"
      ).rows

    assert live >= 3
    assert Thirstr.Profiles.sample_live_photos(2) == 2
    assert Thirstr.Profiles.sample_live_photos(100) == live - 2
    assert Thirstr.Profiles.sample_live_photos(100) == 0

    html = c |> recycle() |> get("/admin/photos") |> html_response(200)
    assert html =~ "Daily sample"
    assert length(Regex.scan(~r/value="keep"/, html)) == live
  end
end
