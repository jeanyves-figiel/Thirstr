defmodule ThirstrWeb.SceneTest do
  use ThirstrWeb.ConnCase, async: false

  # B3: F-09 Tonight, F-10 parties, F-11 activities & clubs, F-12 venues.
  setup %{conn: conn} do
    {:ok, host: onboarded(conn), guest: onboarded(conn, basics: [display_name: "Ben"])}
  end

  defp req(u, method, path, body \\ nil) do
    c = recycle_authed(u.c)

    case method do
      :get -> get(c, path)
      :post -> post(c, path, body || %{})
      :patch -> patch(c, path, body || %{})
      :delete -> delete(c, path)
    end
  end

  defp iso(dt), do: DateTime.to_iso8601(dt)
  defp in_h(h), do: DateTime.add(DateTime.utc_now(), round(h * 3600), :second)

  defp plan(u, extra \\ %{}) do
    req(
      u,
      :post,
      "/v1/tonight",
      Map.merge(
        %{
          text: "Hosting, chill vibes",
          tag: "hosting",
          window_start: iso(in_h(0)),
          window_end: iso(in_h(2)),
          tz_offset_min: 0
        },
        extra
      )
    )
  end

  defp party(u, extra \\ %{}) do
    req(
      u,
      :post,
      "/v1/parties",
      Map.merge(
        %{
          title: "Sauna night",
          starts_at: iso(in_h(1)),
          ends_at: iso(in_h(4)),
          capacity: 2,
          rules: ["safer", "No perfume"]
        },
        extra
      )
    )
  end

  describe "Tonight (F-09)" do
    test "post, list nearby, mine, delete", %{host: h, guest: g} do
      assert %{"id" => id} = plan(h) |> json_response(201)
      %{"plans" => [p]} = req(g, :get, "/v1/tonight") |> json_response(200)
      assert p["id"] == id and p["profile"]["id"] == h.pid and p["distance"]["kind"] == "area"
      refute Map.has_key?(p, "cell_r8")
      assert %{"plans" => [], "mine" => [_]} = req(h, :get, "/v1/tonight") |> json_response(200)
      assert req(h, :delete, "/v1/tonight/#{id}") |> response(204)
      assert %{"plans" => []} = req(g, :get, "/v1/tonight") |> json_response(200)
    end

    @tag ac: "AC-09.2"
    test "unverified cannot post (403)", %{conn: conn} do
      u = onboarded(conn, verified: false)
      assert %{"error" => %{"code" => "not_verified"}} = plan(u) |> json_response(403)
    end

    test "max 2 active plans; no contact details", %{host: h} do
      plan(h) |> json_response(201)
      plan(h) |> json_response(201)
      assert plan(h) |> json_response(422)
      assert plan(h, %{text: "text me +41 79 123 45 67"}) |> json_response(422)
    end

    @tag ac: "AC-09.1"
    test "expired plans are gone from the API", %{host: h, guest: g} do
      %{"id" => id} = plan(h) |> json_response(201)

      Thirstr.Repo.query!(
        "UPDATE tonight_plans SET expires_at = now() - interval '1 second' WHERE id = $1",
        [Ecto.UUID.dump!(id)]
      )

      assert %{"plans" => []} = req(g, :get, "/v1/tonight") |> json_response(200)
    end

    test "expiry = 06:00 local or window end + 1 h, whichever first" do
      ws = ~U[2026-11-17 22:00:00Z]

      e1 = Thirstr.Tonight.expiry(ws, ~U[2026-11-18 02:00:00Z], 60)
      e2 = Thirstr.Tonight.expiry(ws, ~U[2026-11-18 08:00:00Z], 60)
      assert DateTime.compare(e1, ~U[2026-11-18 03:00:00Z]) == :eq
      assert DateTime.compare(e2, ~U[2026-11-18 05:00:00Z]) == :eq
    end

    test "chats audience: only chat partners see it", %{host: h, guest: g} do
      plan(h, %{audience: "chats"}) |> json_response(201)
      assert %{"plans" => []} = req(g, :get, "/v1/tonight") |> json_response(200)
      {a, b} = if h.pid < g.pid, do: {h.pid, g.pid}, else: {g.pid, h.pid}

      Thirstr.Repo.query!(
        "INSERT INTO contacts (profile_a, profile_b, a_sent, b_sent, created_at, updated_at) VALUES ($1, $2, 1, 1, now(), now())",
        [Ecto.UUID.dump!(a), Ecto.UUID.dump!(b)]
      )

      assert %{"plans" => [_]} = req(g, :get, "/v1/tonight") |> json_response(200)
    end
  end

  describe "Parties (F-10)" do
    @tag ac: "AC-10.1"
    test "create, discover, request, accept; no address or coordinates anywhere", %{
      host: h,
      guest: g
    } do
      p = party(h) |> json_response(201)
      assert p["my_state"] == "host" and p["status"] == "open"
      %{"parties" => [seen]} = req(g, :get, "/v1/parties") |> json_response(200)
      body = Jason.encode!(seen)
      refute body =~ "lat" or body =~ "lng" or body =~ "address"
      assert seen["my_state"] == nil and seen["invite_code"] == nil

      r = req(g, :post, "/v1/parties/#{p["id"]}/request") |> json_response(200)
      assert r["my_state"] == "pending"
      %{"requests" => [rq]} = req(h, :get, "/v1/parties/#{p["id"]}") |> json_response(200)
      assert rq["profile"]["id"] == g.pid

      a = req(h, :post, "/v1/parties/#{p["id"]}/requests/#{g.pid}/accept") |> json_response(200)
      assert a["seats_taken"] == 1

      assert %{"my_state" => "accepted"} =
               req(g, :get, "/v1/parties/#{p["id"]}") |> json_response(200)

      assert Thirstr.Groups.together?("party:" <> p["id"], h.pid, g.pid)
    end

    @tag ac: "AC-10.2"
    test "capacity is never exceeded", %{conn: conn, host: h, guest: g} do
      p = party(h, %{capacity: 2}) |> json_response(201)
      others = for i <- 1..2, do: onboarded(conn, basics: [display_name: "G#{i}"])

      for u <- [g | others],
          do: req(u, :post, "/v1/parties/#{p["id"]}/request") |> json_response(200)

      results =
        [g | others]
        |> Enum.map(fn u ->
          Task.async(fn ->
            req(h, :post, "/v1/parties/#{p["id"]}/requests/#{u.pid}/accept").status
          end)
        end)
        |> Enum.map(&Task.await/1)

      assert Enum.count(results, &(&1 == 200)) == 2

      [[n, status]] =
        Thirstr.Repo.query!(
          "SELECT (SELECT count(*) FROM party_requests WHERE party_id = $1 AND state = 'accepted'), status FROM parties WHERE id = $1",
          [Ecto.UUID.dump!(p["id"])]
        ).rows

      assert n == 2 and status == "full"
    end

    test "decline shows 'not this time'; one live party; invite-only needs the code", %{
      host: h,
      guest: g
    } do
      p = party(h) |> json_response(201)
      assert party(h) |> json_response(422)
      req(g, :post, "/v1/parties/#{p["id"]}/request") |> json_response(200)
      req(h, :post, "/v1/parties/#{p["id"]}/requests/#{g.pid}/decline") |> json_response(200)

      assert %{"my_state" => "not_this_time"} =
               req(g, :get, "/v1/parties/#{p["id"]}") |> json_response(200)

      req(h, :patch, "/v1/parties/#{p["id"]}", %{status: "cancelled"}) |> json_response(200)
      inv = party(h, %{audience: "invite"}) |> json_response(201)
      assert inv["invite_code"]
      assert %{"parties" => []} = req(g, :get, "/v1/parties") |> json_response(200)
      assert req(g, :get, "/v1/parties/#{inv["id"]}") |> json_response(404)

      assert req(g, :get, "/v1/parties/#{inv["id"]}?code=#{inv["invite_code"]}")
             |> json_response(200)
    end

    test "Safe Mode cannot host; two reports hide a party", %{conn: conn, host: h, guest: g} do
      Thirstr.Repo.query!(
        "UPDATE accounts SET safe_mode = 'on' WHERE id = (SELECT account_id FROM profiles WHERE id = $1)",
        [Ecto.UUID.dump!(g.pid)]
      )

      assert party(g) |> json_response(422)
      p = party(h) |> json_response(201)
      third = onboarded(conn, basics: [display_name: "Rep"])
      req(third, :post, "/v1/parties/#{p["id"]}/report", %{reason: "fake"}) |> response(204)
      req(g, :post, "/v1/parties/#{p["id"]}/report", %{reason: "fake"}) |> response(204)
      assert %{"parties" => []} = req(third, :get, "/v1/parties") |> json_response(200)
    end
  end

  describe "Activities & clubs (F-11)" do
    defp sport!(u, show_in \\ ["hookup", "sport"]) do
      req(u, :patch, "/v1/me/profiles/#{u.pid}", %{show_in: show_in}) |> json_response(200)
    end

    test "post needs Sport turned on; RSVP joins the group chat", %{host: h, guest: g} do
      body = %{
        sport: "climbing",
        title: "Bouldering session",
        starts_at: iso(in_h(3)),
        capacity: 4,
        mode: "sport"
      }

      assert %{"error" => %{"code" => "sport_off"}} =
               req(h, :post, "/v1/activities", body) |> json_response(409)

      sport!(h)
      sport!(g)
      %{"id" => id} = req(h, :post, "/v1/activities", body) |> json_response(201)
      %{"posts" => [post]} = req(g, :get, "/v1/activities?sports=climbing") |> json_response(200)
      assert post["id"] == id and post["joined"] == 0

      assert %{"posts" => []} =
               req(g, :get, "/v1/activities?sports=running") |> json_response(200)

      req(g, :post, "/v1/activities/#{id}/rsvp", %{join: true}) |> response(204)
      %{"members" => ms} = req(h, :get, "/v1/activities/#{id}/members") |> json_response(200)
      assert length(ms) == 2
    end

    @tag ac: "AC-11.2"
    test "Sport feed only shows people shown in Sport", %{host: h, guest: g} do
      sport!(h)
      sport!(g)

      req(h, :post, "/v1/activities", %{
        sport: "running",
        title: "Lake run",
        starts_at: iso(in_h(2))
      })
      |> json_response(201)

      %{"posts" => [p]} = req(g, :get, "/v1/activities") |> json_response(200)
      assert p["host"]["id"] == h.pid

      sport!(h, ["hookup"])
      assert %{"posts" => []} = req(g, :get, "/v1/activities") |> json_response(200)
    end

    test "clubs: 30-day rule, open join, request + approve", %{host: h, guest: g} do
      sport!(h)
      sport!(g)

      body = %{
        name: "Queer Climbers ZH",
        sport: "climbing",
        description: "Weekly",
        join_policy: "request"
      }

      assert req(h, :post, "/v1/clubs", body) |> json_response(422)

      Thirstr.Repo.query!(
        "UPDATE accounts SET inserted_at = now() - interval '40 days' WHERE id = (SELECT account_id FROM profiles WHERE id = $1)",
        [Ecto.UUID.dump!(h.pid)]
      )

      club = req(h, :post, "/v1/clubs", body) |> json_response(201)
      assert club["my_role"] == "admin"

      assert %{"my_state" => "requested"} =
               req(g, :post, "/v1/clubs/#{club["id"]}/join") |> json_response(200)

      [gs] =
        Thirstr.Repo.query!(
          "SELECT profile_id::text FROM club_members WHERE club_id = $1 AND role = 'member'",
          [Ecto.UUID.dump!(club["id"])]
        ).rows
        |> List.flatten()

      req(h, :post, "/v1/clubs/#{club["id"]}/members/#{gs}/approve") |> json_response(200)

      assert %{"my_state" => "member", "member_list" => [_, _]} =
               req(g, :get, "/v1/clubs/#{club["id"]}") |> json_response(200)
    end
  end

  describe "Venues (F-12)" do
    defp venue!(kind \\ "sauna") do
      id = Ecto.UUID.generate()

      Thirstr.Repo.query!(
        """
        INSERT INTO venues (id, name, kind, cell_r9, cell_r5, geofence_radius_m, created_at)
        VALUES ($1, 'Steam ZH', $2, h3_lat_lng_to_cell(point(8.5417, 47.3769), 9)::bigint,
                h3_lat_lng_to_cell(point(8.5417, 47.3769), 5)::bigint, 80, now())
        """,
        [Ecto.UUID.dump!(id), kind]
      )

      id
    end

    @tag ac: "AC-12.1"
    test "here needs a check-in; only visible people see each other", %{host: h, guest: g} do
      v = venue!()
      %{"venues" => [vv]} = req(g, :get, "/v1/venues/nearby") |> json_response(200)
      assert vv["id"] == v and vv["here"] == "0"
      assert req(g, :get, "/v1/venues/#{v}/here") |> json_response(403)

      req(h, :post, "/v1/venues/#{v}/checkin", %{visible: true, zone: "steam room"})
      |> json_response(200)

      here = req(g, :post, "/v1/venues/#{v}/checkin", %{visible: true}) |> json_response(200)
      assert [%{"zone" => "steam room"}] = here["people"]
      assert here["stats"]["total"] == "a_few"

      req(h, :patch, "/v1/venues/#{v}/checkin", %{visible: false}) |> json_response(200)
      assert %{"people" => []} = req(g, :get, "/v1/venues/#{v}/here") |> json_response(200)
      assert %{"people" => []} = req(h, :get, "/v1/venues/#{v}/here") |> json_response(200)
    end

    @tag ac: "AC-12.2"
    test "check-out deletes the row; no history", %{host: h} do
      v = venue!()
      req(h, :post, "/v1/venues/#{v}/checkin", %{}) |> json_response(200)
      req(h, :post, "/v1/venues/checkout") |> response(204)
      assert Thirstr.Repo.query!("SELECT count(*) FROM venue_checkins").rows == [[0]]
    end

    test "gyms only in Sport mode; Safe Mode cannot check in", %{host: h} do
      venue!("gym")
      assert %{"venues" => []} = req(h, :get, "/v1/venues/nearby") |> json_response(200)

      assert %{"venues" => [_]} =
               req(h, :get, "/v1/venues/nearby?mode=sport") |> json_response(200)

      v = venue!()

      Thirstr.Repo.query!(
        "UPDATE accounts SET safe_mode = 'on' WHERE id = (SELECT account_id FROM profiles WHERE id = $1)",
        [Ecto.UUID.dump!(h.pid)]
      )

      assert req(h, :post, "/v1/venues/#{v}/checkin", %{}) |> json_response(422)
    end
  end
end
