defmodule ThirstrWeb.ExploreTest do
  use ThirstrWeb.ConnCase, async: false

  # B1: F-04 Explore, F-05 Location, F-06 Profiles, F-09 Now.
  setup %{conn: conn} do
    viewer = onboarded(conn)
    other = onboarded(conn, cell: zurich_ring(2), basics: [display_name: "Theo"])
    {:ok, viewer: viewer, other: other, conn: conn}
  end

  defp grid(c, q \\ ""),
    do: c |> recycle_authed() |> get("/v1/explore/grid?mode=hookup" <> q) |> json_response(200)

  test "grid shows nearby verified profiles with a distance bucket, no coordinates (AC-04.2)", %{
    viewer: v,
    other: o
  } do
    res = grid(v.c)
    assert o.pid in ids(res["items"])
    card = Enum.find(res["items"], &(&1["id"] == o.pid))
    assert card["distance"]["kind"] == "area"
    refute Map.has_key?(card, "lat")
    # SR-10: grid cards load the card-size copy
    assert card["photo"] =~ "-t?"
    refute res |> Jason.encode!() =~ "account"
  end

  # SR-09 (#149): later pages come from page 1's cached order; visibility rules still re-applied.
  test "grid pages reuse the cached order and still drop blocked profiles", %{
    viewer: v,
    conn: conn
  } do
    _ = for k <- [1, 3], do: onboarded(conn, cell: zurich_ring(k))
    first = ids(grid(v.c)["items"])
    assert length(first) >= 3

    page2 = grid(v.c, "&cursor=1")
    assert ids(page2["items"]) == Enum.drop(first, 1)

    blocked = Enum.at(first, 1)
    v.c |> recycle_authed() |> post("/v1/profiles/#{blocked}/block") |> response(204)
    refute blocked in ids(grid(v.c, "&cursor=1")["items"])
  end

  @tag ac: "AC-04.7"
  test "grid returns a bucketed auto-fit radius (R-04.15)", %{viewer: v} do
    fit = grid(v.c)["fit_m"]
    assert fit in [500, 1_000, 2_000, 5_000, 10_000, 25_000, 50_000, 100_000]

    rows = fn ds -> Enum.map(ds, &%{dist_m: &1}) end
    assert Thirstr.Explore.fit_m([], %{verified: true}) == nil
    assert Thirstr.Explore.fit_m(rows.([120, 480]), %{verified: true}) == 500
    assert Thirstr.Explore.fit_m(rows.([120, 480]), %{verified: false}) == 2_000
    near = List.duplicate(300, 12) ++ [40_000]
    assert Thirstr.Explore.fit_m(rows.(near), %{verified: true}) == 500
    assert Thirstr.Explore.fit_m(rows.([3_100]), %{verified: true}) == 5_000
    assert Thirstr.Explore.fit_m(rows.([250_000]), %{verified: true}) == 100_000
  end

  @tag ac: "AC-04.3"
  test "Hidden users never appear", %{viewer: v, other: o} do
    o.c
    |> recycle_authed()
    |> put("/v1/me/location", %{level: "hidden", cell_r9: zurich_r9()})
    |> json_response(200)

    refute o.pid in ids(grid(v.c)["items"])

    o.c
    |> recycle_authed()
    |> put("/v1/me/location", %{level: "area", cell_r9: zurich_r9()})
    |> json_response(200)

    assert o.pid in ids(grid(v.c)["items"])

    # #114: Hidden with an end time and a level to come back as (was Incognito).
    until = DateTime.utc_now() |> DateTime.add(3600) |> DateTime.to_iso8601()

    me =
      o.c
      |> recycle_authed()
      |> put("/v1/me/location", %{
        level: "hidden",
        cell_r9: zurich_r9(),
        until: until,
        return_level: "city"
      })
      |> json_response(200)

    assert me["hidden"] == true
    assert me["hidden_return"] == "city"
    assert me["hidden_until"]
    refute o.pid in ids(grid(v.c)["items"])

    me =
      o.c
      |> recycle_authed()
      |> put("/v1/me/location", %{level: "area", cell_r9: zurich_r9()})
      |> json_response(200)

    refute me["hidden_until"]
    assert o.pid in ids(grid(v.c)["items"])
  end

  test "Hidden end time and return level are validated; Incognito is gone (#114)", %{other: o} do
    for body <- [
          %{level: "hidden", cell_r9: zurich_r9(), return_level: "exact"},
          %{level: "hidden", cell_r9: zurich_r9(), until: "2001-01-01T00:00:00Z"},
          %{
            level: "hidden",
            cell_r9: zurich_r9(),
            until: DateTime.utc_now() |> DateTime.add(72 * 3600) |> DateTime.to_iso8601()
          }
        ] do
      assert %{"error" => %{"code" => "validation"}} =
               o.c |> recycle_authed() |> put("/v1/me/location", body) |> json_response(422)
    end

    assert %{"error" => %{"code" => "validation"}} =
             o.c
             |> recycle_authed()
             |> patch("/v1/me/visibility", %{incognito: true})
             |> json_response(422)
  end

  test "hide me from hidden users (R-05.6)", %{viewer: v, other: o} do
    o.c
    |> recycle_authed()
    |> patch("/v1/me/visibility", %{hide_from_hidden: true})
    |> json_response(200)

    assert o.pid in ids(grid(v.c)["items"])

    v.c
    |> recycle_authed()
    |> put("/v1/me/location", %{level: "hidden", cell_r9: zurich_r9()})
    |> json_response(200)

    refute o.pid in ids(grid(v.c)["items"])
  end

  @tag ac: "AC-05.4"
  test "unverified cannot set Hidden or Exact", %{conn: conn} do
    u = onboarded(conn, verified: false)

    for body <- [
          %{level: "hidden", cell_r9: zurich_r9()},
          %{level: "exact", cell_r9: zurich_r9()}
        ] do
      assert %{"error" => %{"code" => "not_verified"}} =
               u.c |> recycle_authed() |> put("/v1/me/location", body) |> json_response(403)
    end
  end

  test "unverified viewer: no pins, distance ≥ 1–2 km (R-04.10)", %{conn: conn, other: o} do
    u = onboarded(conn, verified: false)
    pin_on(o)
    card = grid(u.c)["items"] |> Enum.find(&(&1["id"] == o.pid))
    assert card["distance"]["bucket"] in ~w(1_2k 2_5k 5_10k 10k_plus)
    refute card["exact"]
  end

  defp pin_on(o) do
    o.c
    |> recycle_authed()
    |> put("/v1/me/pin", %{
      lat: 47.3769,
      lng: 8.5417,
      ttl_s: 1800,
      audience: "verified",
      confirm: true
    })
    |> json_response(200)
  end

  test "exact pin visible to verified viewers with metres, removed on delete (R-05.4)", %{
    viewer: v,
    other: o
  } do
    me = pin_on(o)
    assert me["location"]["level"] == "exact"
    card = grid(v.c)["items"] |> Enum.find(&(&1["id"] == o.pid))
    assert card["exact"]
    o.c |> recycle_authed() |> delete("/v1/me/pin") |> json_response(200)
    card = grid(v.c)["items"] |> Enum.find(&(&1["id"] == o.pid))
    refute card["exact"]
  end

  test "pin requires confirm and an allowed TTL (max 4 h, D-07)", %{other: o} do
    assert o.c
           |> recycle_authed()
           |> put("/v1/me/pin", %{lat: 47.3, lng: 8.5, ttl_s: 18_000, confirm: true})
           |> json_response(422)

    assert o.c
           |> recycle_authed()
           |> put("/v1/me/pin", %{lat: 47.3, lng: 8.5, ttl_s: 1800})
           |> json_response(422)
  end

  test "map returns avatars inside cells and pins with coordinates only for allowed pins", %{
    viewer: v,
    other: o
  } do
    pin_on(o)

    res =
      v.c
      |> recycle_authed()
      |> get("/v1/explore/map?mode=hookup&bbox=8.50,47.36,8.58,47.39")
      |> json_response(200)

    assert Enum.any?(res["pins"], &(&1["id"] == o.pid))
    assert res["cells"] != []
  end

  test "zoomed in inside one cell, the map still shows the people there (#113)", %{
    viewer: v,
    other: o
  } do
    pin_on(o)

    res =
      v.c
      |> recycle_authed()
      |> get("/v1/explore/map?mode=hookup&bbox=8.5412,47.3766,8.5422,47.3772")
      |> json_response(200)

    assert Enum.any?(res["pins"], &(&1["id"] == o.pid))
    assert res["cells"] != []
  end

  test "blocks hide both ways and the profile becomes Not available", %{viewer: v, other: o} do
    v.c |> recycle_authed() |> post("/v1/profiles/#{o.pid}/block") |> response(204)
    refute o.pid in ids(grid(v.c)["items"])
    refute v.pid in ids(grid(o.c)["items"])
    assert o.c |> recycle_authed() |> get("/v1/profiles/#{v.pid}") |> json_response(404)

    assert [%{"profile_id" => _}] =
             v.c
             |> recycle_authed()
             |> get("/v1/me/blocks")
             |> json_response(200)
             |> Map.get("blocks")

    v.c |> recycle_authed() |> delete("/v1/me/blocks/#{o.pid}") |> response(204)
    assert o.pid in ids(grid(v.c)["items"])
  end

  test "hide this profile removes it from the viewer's Explore only", %{viewer: v, other: o} do
    v.c |> recycle_authed() |> post("/v1/profiles/#{o.pid}/hide") |> response(204)
    refute o.pid in ids(grid(v.c)["items"])
    assert v.pid in ids(grid(o.c)["items"])

    # #111 Settings › Hidden & blocked: list, then unhide brings it back.
    assert [%{"profile_id" => pid, "display_name" => _, "at" => _}] =
             v.c
             |> recycle_authed()
             |> get("/v1/me/hidden")
             |> json_response(200)
             |> Map.get("hidden")

    assert pid == o.pid
    v.c |> recycle_authed() |> delete("/v1/profiles/#{o.pid}/hide") |> response(204)

    assert v.c
           |> recycle_authed()
           |> get("/v1/me/hidden")
           |> json_response(200)
           |> Map.get("hidden") == []

    assert o.pid in ids(grid(v.c)["items"])
  end

  test "taps: verified only, mutual detection, inbox", %{viewer: v, other: o, conn: conn} do
    assert %{"mutual" => false} =
             v.c |> recycle_authed() |> post("/v1/profiles/#{o.pid}/tap") |> json_response(200)

    assert %{"mutual" => true} =
             o.c |> recycle_authed() |> post("/v1/profiles/#{v.pid}/tap") |> json_response(200)

    [t] = o.c |> recycle_authed() |> get("/v1/taps") |> json_response(200) |> Map.get("taps")
    assert t["profile"]["id"] == v.pid and t["mutual"]

    u = onboarded(conn, verified: false)
    assert u.c |> recycle_authed() |> post("/v1/profiles/#{o.pid}/tap") |> json_response(403)
  end

  @tag ac: "AC-15.1"
  test "quarantined account gets success on tap, recipient receives nothing", %{
    viewer: v,
    other: o
  } do
    Thirstr.Repo.query!(
      "UPDATE accounts SET status = 'quarantined' WHERE id = (SELECT account_id FROM profiles WHERE id = $1)",
      [Ecto.UUID.dump!(v.pid)]
    )

    assert v.c |> recycle_authed() |> post("/v1/profiles/#{o.pid}/tap") |> json_response(200)

    assert [] ==
             o.c |> recycle_authed() |> get("/v1/taps") |> json_response(200) |> Map.get("taps")

    refute v.pid in ids(grid(o.c)["items"])
  end

  @tag ac: "AC-06.1"
  test "strangers never get fields above their audience; health never public (AC-06.2)", %{
    viewer: v,
    other: o,
    conn: conn
  } do
    o.c
    |> recycle_authed()
    |> patch("/v1/me/profiles/#{o.pid}", %{
      fields: %{bio: "Climber, coffee", position: "vers", hosting: "can_host", prep: "on"},
      visibility_map: %{prep: "verified"}
    })
    |> json_response(200)

    assert %{"error" => %{"code" => "validation"}} =
             o.c
             |> recycle_authed()
             |> patch("/v1/me/profiles/#{o.pid}", %{visibility_map: %{hiv: "public"}})
             |> json_response(422)

    seen = v.c |> recycle_authed() |> get("/v1/profiles/#{o.pid}") |> json_response(200)
    assert seen["fields"]["position"] == "vers"
    assert seen["fields"]["prep"] == "on"

    u = onboarded(conn, verified: false)

    Thirstr.Repo.query!(
      "UPDATE accounts SET settings = '{\"hide_from_unverified\": false}' WHERE id = (SELECT account_id FROM profiles WHERE id = $1)",
      [Ecto.UUID.dump!(o.pid)]
    )

    stranger = u.c |> recycle_authed() |> get("/v1/profiles/#{o.pid}") |> json_response(200)
    assert stranger["fields"] == %{"bio" => "Climber, coffee"}
  end

  test "chats/only_me values are never stored server-side (R-06.4)", %{other: o} do
    p =
      o.c
      |> recycle_authed()
      |> patch("/v1/me/profiles/#{o.pid}", %{
        fields: %{hiv: "neg", position: "top"},
        visibility_map: %{position: "only_me"}
      })
      |> json_response(200)

    refute Map.has_key?(p["fields"], "hiv")
    refute Map.has_key?(p["fields"], "position")
  end

  test "bio: no phone/email; links blocked for new accounts (R-06.12)", %{other: o} do
    for bio <- ["call +41 79 123 45 67", "me@example.com", "see www.example.com"] do
      assert o.c
             |> recycle_authed()
             |> patch("/v1/me/profiles/#{o.pid}", %{fields: %{bio: bio}})
             |> json_response(422)
    end
  end

  defp lenses!(u, show_in) do
    u.c
    |> recycle_authed()
    |> patch("/v1/me/profiles/#{u.pid}", %{show_in: show_in})
  end

  defp spicy_photo!(u) do
    up =
      u.c
      |> recycle_authed()
      |> post("/v1/me/profiles/#{u.pid}/photos", %{slot: 1})
      |> json_response(201)

    u.c
    |> recycle_authed()
    |> post("/v1/me/profiles/#{u.pid}/photos/#{up["photo_id"]}/check")
    |> json_response(200)

    # DEV classifier passes everything; mark this one as not strict-safe (R-06.3).
    Thirstr.Repo.query!(
      "UPDATE photos SET classifier_score = classifier_score || '{\"main_ok\": false}' WHERE id = $1",
      [Ecto.UUID.dump!(up["photo_id"])]
    )
  end

  @tag ac: "AC-06.5"
  test "one profile per account; show_in comes from Here for and needs at least one lens",
       %{other: o} do
    me = o.c |> recycle_authed() |> get("/v1/me") |> json_response(200)
    assert [%{"show_in" => ["hookup"]}] = me["profiles"]

    assert o.c
           |> recycle_authed()
           |> post("/v1/me/profiles", %{kind: "sport"})
           |> response(404)

    assert %{"error" => %{"code" => "show_in_empty"}} = lenses!(o, []) |> json_response(422)
    assert lenses!(o, ["sport", "bogus"]) |> json_response(422)

    assert %{"show_in" => ["hookup", "sport"]} =
             lenses!(o, ["sport", "hookup"]) |> json_response(200)

    # sport fields are allowed on the one profile now
    assert o.c
           |> recycle_authed()
           |> patch("/v1/me/profiles/#{o.pid}", %{
             fields: %{sports: ["climbing"], position: "top"}
           })
           |> json_response(200)
  end

  @tag ac: "AC-06.4"
  test "a profile only appears in the modes it is shown in (AC-11.2)", %{viewer: v, other: o} do
    grid_in = fn mode ->
      v.c |> recycle_authed() |> get("/v1/explore/grid?mode=#{mode}") |> json_response(200)
    end

    assert o.pid in ids(grid_in.("hookup")["items"])
    refute o.pid in ids(grid_in.("sport")["items"])
    refute o.pid in ids(grid_in.("friends")["items"])

    assert v.c |> recycle_authed() |> get("/v1/profiles/#{o.pid}?mode=sport") |> response(404)

    lenses!(o, ["friends", "sport"]) |> json_response(200)
    refute o.pid in ids(grid_in.("hookup")["items"])
    assert o.pid in ids(grid_in.("sport")["items"])
    assert o.pid in ids(grid_in.("friends")["items"])
    assert v.c |> recycle_authed() |> get("/v1/profiles/#{o.pid}?mode=hookup") |> response(404)
  end

  @tag ac: "AC-06.3"
  test "Friends and Sport lenses hide spicy photos, hookup and health details", %{
    viewer: v,
    other: o
  } do
    lenses!(o, ["hookup", "friends", "sport"]) |> json_response(200)

    o.c
    |> recycle_authed()
    |> patch("/v1/me/profiles/#{o.pid}", %{
      fields: %{
        position: "top",
        hosting: "can_host",
        looking_for: ["hookup", "friends"],
        sports: ["climbing"],
        bio: "Hi there"
      }
    })
    |> json_response(200)

    spicy_photo!(o)

    view = fn mode ->
      v.c |> recycle_authed() |> get("/v1/profiles/#{o.pid}?mode=#{mode}") |> json_response(200)
    end

    h = view.("hookup")
    assert length(h["photos"]) == 2
    assert h["fields"]["position"] == "top" and h["fields"]["sports"] == ["climbing"]

    f = view.("friends")
    assert length(f["photos"]) == 1
    refute Map.has_key?(f["fields"], "position")
    refute Map.has_key?(f["fields"], "hosting")
    refute Map.has_key?(f["fields"], "sports")
    assert f["fields"]["looking_for"] == ["friends"]
    assert f["fields"]["bio"] == "Hi there"

    s = view.("sport")
    assert length(s["photos"]) == 1
    refute Map.has_key?(s["fields"], "position")
    assert s["fields"]["sports"] == ["climbing"]

    card =
      v.c
      |> recycle_authed()
      |> get("/v1/explore/grid?mode=friends")
      |> json_response(200)
      |> Map.fetch!("items")
      |> Enum.find(&(&1["id"] == o.pid))

    assert card["position"] == nil
  end

  @tag ac: "AC-09.2"
  test "Now status: verified only, shows on cards, sorted first", %{
    viewer: v,
    other: o,
    conn: conn
  } do
    assert %{"status" => "door_open"} =
             o.c
             |> recycle_authed()
             |> put("/v1/me/now", %{status: "door_open", text: "Come by", ttl_s: 3600})
             |> json_response(200)

    [first | _] = grid(v.c)["items"]
    assert first["id"] == o.pid and first["now"]["status"] == "door_open"

    u = onboarded(conn, verified: false)

    assert u.c
           |> recycle_authed()
           |> put("/v1/me/now", %{status: "now", ttl_s: 3600})
           |> json_response(403)
  end

  test "filters: age range and settings hide_from age (R-04.8, R-17.7)", %{viewer: v, other: o} do
    assert o.pid in ids(grid(v.c, "&age_min=18&age_max=40")["items"])
    refute o.pid in ids(grid(v.c, "&age_min=40")["items"])

    o.c
    |> recycle_authed()
    |> patch("/v1/me/settings", %{hide_from_age_min: 40})
    |> json_response(200)

    refute o.pid in ids(grid(v.c)["items"])
  end

  test "languages is not a filter: old clients sending it are ignored (#106)", %{
    viewer: v,
    other: o
  } do
    refute Map.has_key?(Thirstr.Explore.parse_filters(%{"languages" => "ja"}), :languages)
    assert o.pid in ids(grid(v.c, "&languages=ja")["items"])
  end

  test "Safe Mode targets are invisible to accounts younger than 7 days (F-14)", %{
    viewer: v,
    other: o
  } do
    o.c
    |> recycle_authed()
    |> put("/v1/me/safe_mode", %{setting: "auto", active: true})
    |> json_response(200)

    refute o.pid in ids(grid(v.c)["items"])

    Thirstr.Repo.query!(
      "UPDATE accounts SET inserted_at = now() - interval '30 days' WHERE id = (SELECT account_id FROM profiles WHERE id = $1)",
      [Ecto.UUID.dump!(v.pid)]
    )

    assert o.pid in ids(grid(v.c)["items"])
  end

  test "k-anonymity: sparse cells display at r7 (R-05.2)", %{other: o} do
    Thirstr.Location.refresh_k_anonymity()

    %{rows: [[res]]} =
      Thirstr.Repo.query!("SELECT display_res FROM location_cells WHERE profile_id = $1", [
        Ecto.UUID.dump!(o.pid)
      ])

    assert res == 7
  end

  test "photos: reorder keeps an accepted main first, delete works", %{other: o} do
    up =
      o.c
      |> recycle_authed()
      |> post("/v1/me/profiles/#{o.pid}/photos", %{slot: 1})
      |> json_response(201)

    p =
      o.c
      |> recycle_authed()
      |> post("/v1/me/profiles/#{o.pid}/photos/#{up["photo_id"]}/check")
      |> json_response(200)

    assert p["photo"]["status"] == "ok_public"
    me = o.c |> recycle_authed() |> get("/v1/me") |> json_response(200)
    [main, second] = Enum.map(me["profile"]["photos"], & &1["id"])

    assert o.c
           |> recycle_authed()
           |> put("/v1/me/profiles/#{o.pid}/photos/order", %{order: [second, main]})
           |> json_response(200)

    p =
      o.c
      |> recycle_authed()
      |> delete("/v1/me/profiles/#{o.pid}/photos/#{main}")
      |> json_response(200)

    assert length(p["photos"]) == 1
  end

  test "tile style served without auth", %{conn: conn} do
    style = conn |> get("/v1/tiles/style.json") |> json_response(200)
    assert style["version"] == 8
    assert hd(style["sources"]["omt"]["tiles"]) =~ "/v1/tiles/v/"
  end

  test "profile view cap returns 429 above 300/hour (D-09)", %{viewer: v, other: o} do
    Application.put_env(:thirstr, :rate_limit_multiplier, 1)
    on_exit(fn -> Application.put_env(:thirstr, :rate_limit_multiplier, 100) end)
    Thirstr.Valkey.command!(["SET", "rl:#{account_of(v.pid).id}:views", "300", "EX", "3600"])
    assert v.c |> recycle_authed() |> get("/v1/profiles/#{o.pid}") |> json_response(429)
  end

  @tag ac: "AC-04.10"
  test "summary: per-mode counts, Now count, city-level place (R-04.17)", %{viewer: v, other: o} do
    %{rows: [[r5]]} =
      Thirstr.Repo.query!("SELECT h3_lat_lng_to_cell(point(8.5417, 47.3769), 5)::text")

    Thirstr.Repo.query!(
      "INSERT INTO cities (name, country, lat, lng, cell_r5) VALUES ('Zürich', 'CH', 47.3769, 8.5417, $1::text::h3index::bigint)",
      [r5]
    )

    Thirstr.Valkey.command!(["DEL", "cityname:" <> r5])

    sum = fn q ->
      v.c |> recycle_authed() |> get("/v1/explore/summary?mode=" <> q) |> json_response(200)
    end

    res = sum.("hookup")
    assert res["place"] == "Zürich"
    assert res["counts"]["hookup"] >= 1
    assert res["now"] == 0
    assert Map.keys(res["counts"]) |> Enum.sort() == ~w(friends hookup sport)

    o.c
    |> recycle_authed()
    |> put("/v1/me/now", %{status: "now", ttl_s: 3600})
    |> json_response(200)

    assert sum.("hookup")["now"] == 1
    assert sum.("sport")["now"] == 0

    # Blocked people are never counted.
    before = sum.("hookup")["counts"]["hookup"]
    v.c |> recycle_authed() |> post("/v1/profiles/#{o.pid}/block") |> response(204)
    assert sum.("hookup")["counts"]["hookup"] == before - 1

    assert v.c |> recycle_authed() |> get("/v1/explore/summary?mode=nope") |> json_response(422)
  end

  test "profile view shows online, symmetric with the online setting (#115, R-07.33)", %{
    viewer: v,
    other: o
  } do
    # `o` made requests during onboarding, so its seen:<account> key is fresh.
    view = fn -> v.c |> recycle_authed() |> get("/v1/profiles/#{o.pid}") |> json_response(200) end
    assert view.()["online"] == true

    Thirstr.Repo.query!(
      "UPDATE accounts SET settings = COALESCE(settings, '{}'::jsonb) || '{\"online_visible\": false}' WHERE id = (SELECT account_id FROM profiles WHERE id = $1)",
      [Ecto.UUID.dump!(o.pid)]
    )

    assert view.()["online"] == false

    own = v.c |> recycle_authed() |> get("/v1/profiles/#{v.pid}") |> json_response(200)
    assert own["online"] == false
  end
end
