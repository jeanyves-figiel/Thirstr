defmodule ThirstrWeb.TravelTest do
  use ThirstrWeb.ConnCase, async: false

  # F-20 travel plans (#188).
  defp city_id(name, cc) do
    %{rows: [[id]]} =
      Thirstr.Repo.query!("SELECT id FROM cities WHERE name = $1 AND country = $2 LIMIT 1", [
        name,
        cc
      ])

    id
  end

  defp r9(lat, lng) do
    %{rows: [[c]]} =
      Thirstr.Repo.query!("SELECT h3_lat_lng_to_cell(point($1::float8, $2::float8), 9)::text", [
        lng,
        lat
      ])

    c
  end

  defp berlin_r9, do: r9(52.5200, 13.4050)
  defp day(n), do: Date.utc_today() |> Date.add(n) |> Date.to_iso8601()

  defp post_trip(c, attrs),
    do: c |> recycle_authed() |> post("/v1/trips", attrs)

  defp trip!(c, attrs) do
    c
    |> post_trip(
      Map.merge(
        %{city_id: city_id("Berlin", "DE"), first_day: day(5), last_day: day(9), show_days: 7},
        attrs
      )
    )
    |> json_response(201)
  end

  defp grid(c, q \\ ""),
    do:
      c
      |> recycle_authed()
      |> get("/v1/explore/grid?intents=hookup,friends,sport" <> q)
      |> json_response(200)

  setup %{conn: conn} do
    traveller = onboarded(conn, basics: [display_name: "Jean"])
    local = onboarded(conn, cell: berlin_r9(), basics: [display_name: "Lukas"])
    {:ok, traveller: traveller, local: local, conn: conn}
  end

  test "city search is accent-insensitive and ranks big cities first", %{conn: conn} do
    res = conn |> get("/v1/cities?q=zur") |> json_response(200)
    assert hd(res["cities"])["name"] in ["Zurich", "Zürich"]
    res = conn |> get("/v1/cities?q=sao pa") |> json_response(200)
    assert hd(res["cities"])["name"] == "São Paulo"
  end

  @tag ac: "AC-20.1"
  test "trip limits", %{traveller: t, conn: conn} do
    berlin = city_id("Berlin", "DE")
    base = %{city_id: berlin, first_day: day(5), last_day: day(9)}

    assert post_trip(t.c, %{base | first_day: day(181), last_day: day(182)}) |> json_response(422)
    assert post_trip(t.c, %{base | last_day: day(35)}) |> json_response(422)
    assert post_trip(t.c, Map.put(base, :show_days, 21)) |> json_response(422)
    assert post_trip(t.c, %{base | first_day: day(-1)}) |> json_response(422)

    for k <- 0..2, do: trip!(t.c, %{first_day: day(20 + k * 40), last_day: day(22 + k * 40)})
    assert post_trip(t.c, Map.put(base, :show_days, nil)) |> json_response(422)

    # shown windows can't overlap
    [first | _] =
      t.c |> recycle_authed() |> get("/v1/trips") |> json_response(200) |> Map.get("trips")

    t.c
    |> recycle_authed()
    |> patch("/v1/trips/#{first["id"]}", %{first_day: day(61), last_day: day(62)})
    |> json_response(409)

    # unverified: browse only
    u = onboarded(conn, verified: false)

    assert %{"error" => %{"code" => "not_verified"}} =
             post_trip(u.c, Map.put(base, :show_days, 7)) |> json_response(403)

    assert post_trip(u.c, Map.put(base, :show_days, nil)) |> json_response(201)
  end

  test "creating more than 6 trips in 30 days is rate limited", %{traveller: t} do
    for _ <- 1..3 do
      %{"id" => id} = trip!(t.c, %{show_days: nil})
      t.c |> recycle_authed() |> delete("/v1/trips/#{id}") |> response(204)
    end

    for _ <- 1..3 do
      %{"id" => id} = trip!(t.c, %{show_days: nil})
      t.c |> recycle_authed() |> delete("/v1/trips/#{id}") |> response(204)
    end

    assert post_trip(t.c, %{city_id: city_id("Berlin", "DE"), first_day: day(5), last_day: day(9)})
           |> json_response(429)
  end

  @tag ac: "AC-20.2"
  test "a shown trip lists the traveller as a tagged visitor in the trip city", %{
    traveller: t,
    local: l,
    conn: conn
  } do
    trip!(t.c, %{first_day: day(10), last_day: day(12), show_days: 14})

    vis = l.c |> recycle_authed() |> get("/v1/explore/visitors") |> json_response(200)
    assert vis["count"] == 1
    [card] = vis["items"]
    assert card["id"] == t.pid
    assert card["visitor"] == true
    assert card["distance"] == nil
    assert card["trip"]["city"] == "Berlin"
    assert card["trip"]["here"] == false
    assert card["trip"]["from"] == nil

    # AC-20.3: interleaved into the grid at position 2, never as a map pin
    _ = for k <- 1..3, do: onboarded(conn, cell: r9(52.5210 + k / 1000, 13.4050))
    items = grid(l.c)["items"]
    assert Enum.at(items, 1)["id"] == t.pid
    assert Enum.at(items, 1)["visitor"] == true
    refute grid(l.c, "&visitors=false")["items"] |> Enum.any?(&(&1["id"] == t.pid))

    # profile shows the trip to Berlin viewers, not to people elsewhere (AC-20.6)
    p = l.c |> recycle_authed() |> get("/v1/profiles/#{t.pid}") |> json_response(200)
    assert p["trip"]["city"] == "Berlin"
    assert p["distance"] == nil

    zurich = onboarded(conn)
    p = zurich.c |> recycle_authed() |> get("/v1/profiles/#{t.pid}") |> json_response(200)
    assert p["trip"] == nil

    # not yet shown (more than show_days before) → not listed
    Thirstr.Repo.query!("UPDATE trips SET show_days = 3")

    assert (l.c |> recycle_authed() |> get("/v1/explore/visitors") |> json_response(200))["count"] ==
             0
  end

  test "say_from adds the home city", %{traveller: t, local: l} do
    trip!(t.c, %{show_days: 14, say_from: true})

    [card] =
      (l.c |> recycle_authed() |> get("/v1/explore/visitors") |> json_response(200))["items"]

    assert card["trip"]["from"] in ["Zurich", "Zürich"]
  end

  test "a traveller already in town ranks like locals with the trip marked here", %{
    traveller: t,
    local: l
  } do
    trip!(t.c, %{first_day: day(0), last_day: day(3), show_days: 0})

    t.c
    |> recycle_authed()
    |> put("/v1/me/location", %{level: "area", cell_r9: r9(52.5205, 13.4060)})
    |> json_response(200)

    assert (l.c |> recycle_authed() |> get("/v1/explore/visitors") |> json_response(200))["count"] ==
             0

    card = Enum.find(grid(l.c)["items"], &(&1["id"] == t.pid))
    assert card["visitor"] == false
    assert card["trip"]["here"] == true
    assert card["distance"]["kind"] == "area"
  end

  @tag ac: "AC-20.4"
  test "look around uses the trip city's centre, own trips only, no pins", %{
    traveller: t,
    local: l
  } do
    %{"id" => trip_id} = trip!(t.c, %{show_days: nil})

    items = grid(t.c, "&trip_id=#{trip_id}")["items"]
    card = Enum.find(items, &(&1["id"] == l.pid))
    assert card["distance"]["kind"] == "area"
    refute card["exact"]

    sum =
      t.c
      |> recycle_authed()
      |> get("/v1/explore/summary?intents=hookup&trip_id=#{trip_id}")
      |> json_response(200)

    assert sum["place"] == "Berlin"

    l.c |> recycle_authed() |> get("/v1/explore/grid?trip_id=#{trip_id}") |> json_response(404)
  end

  @tag ac: "AC-20.5"
  test "locals who opt out or are in Safe Mode are hidden from afar", %{traveller: t, local: l} do
    %{"id" => trip_id} = trip!(t.c, %{show_days: nil})

    l.c
    |> recycle_authed()
    |> patch("/v1/me/settings", %{show_to_remote: false})
    |> json_response(200)

    refute l.pid in ids(grid(t.c, "&trip_id=#{trip_id}")["items"])

    l.c
    |> recycle_authed()
    |> patch("/v1/me/settings", %{show_to_remote: true})
    |> json_response(200)

    assert l.pid in ids(grid(t.c, "&trip_id=#{trip_id}")["items"])

    Thirstr.Repo.query!("UPDATE accounts SET safe_mode = 'on' WHERE id = $1", [
      Ecto.UUID.dump!(account_of(l.pid).id)
    ])

    refute l.pid in ids(grid(t.c, "&trip_id=#{trip_id}")["items"])
  end

  test "showing early in a Safe Mode country needs a second confirm", %{traveller: t} do
    cairo = city_id("Cairo", "EG")
    attrs = %{city_id: cairo, first_day: day(5), last_day: day(9), show_days: 7}
    assert post_trip(t.c, attrs) |> json_response(422)
    trip = post_trip(t.c, Map.put(attrs, :safe_mode_ack, true)) |> json_response(201)
    assert trip["safe_mode_country"] == true
  end

  @tag ac: "AC-20.7"
  test "trips end the day after their last day", %{traveller: t, local: l} do
    trip!(t.c, %{first_day: day(0), last_day: day(1), show_days: 0})

    Thirstr.Repo.query!(
      "UPDATE trips SET first_day = current_date - 3, last_day = current_date - 2"
    )

    Thirstr.Trips.sweep()
    assert (t.c |> recycle_authed() |> get("/v1/trips") |> json_response(200))["trips"] == []

    assert (l.c |> recycle_authed() |> get("/v1/explore/visitors") |> json_response(200))["count"] ==
             0
  end

  @tag ac: "AC-20.8"
  test "at most 20 new chats a day with people far away", %{traveller: t} do
    a = account_of(t.pid)
    n = 20 * Application.get_env(:thirstr, :rate_limit_multiplier, 1)
    for _ <- 1..n, do: assert({:ok, _} = Thirstr.Social.limit(a, "fc_far", 20, 86_400))
    assert {:error, {:rate_limited, _}} = Thirstr.Social.limit(a, "fc_far", 20, 86_400)
  end
end
