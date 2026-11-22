defmodule ThirstrWeb.AdminPlacesTest do
  use ThirstrWeb.ConnCase, async: false
  alias Thirstr.Repo

  # A-07b Places (#323): the page rendered 500 once an import or a party existed
  # (raw `timestamp` columns come back as NaiveDateTime).
  setup %{conn: conn} do
    a = onboarded(conn, basics: [display_name: "Owner"])
    admin = account_of(a.pid).id
    Application.put_env(:thirstr, :admin_account_ids, [admin])
    on_exit(fn -> Application.put_env(:thirstr, :admin_account_ids, []) end)
    {:ok, c: build_conn() |> get("/admin/dev_login?account_id=#{admin}")}
  end

  test "renders with an import, a party and a member place", %{c: c} do
    Repo.query!(
      "INSERT INTO place_imports (started_at, finished_at, added) VALUES (now() - interval '1 hour', now(), 12)"
    )

    Repo.query!("INSERT INTO place_imports (started_at) VALUES (now())")

    [[vid]] =
      Repo.query!(
        "INSERT INTO venues (id, name, kind, lat, lng, cell_r9, cell_r5, added_by, created_at) VALUES (gen_random_uuid(), 'Club Test', 'club', 47.37, 8.54, 1, 1, 'member', now()) RETURNING id::text"
      ).rows

    Repo.query!(
      "INSERT INTO events (id, venue_id, title, starts_at, ends_at, created_at) VALUES (gen_random_uuid(), $1::text::uuid, 'Foam night', now() + interval '1 day', now() + interval '1 day 4 hours', now())",
      [vid]
    )

    html = c |> recycle() |> get("/admin/places?q=Club") |> html_response(200)
    assert html =~ "Foam night"
    assert html =~ "still running"
    assert html =~ "Club Test"
    refute html =~ "onsubmit"
  end
end
