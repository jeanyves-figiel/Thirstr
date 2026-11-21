defmodule ThirstrWeb.PlacesTest do
  use ThirstrWeb.ConnCase, async: false

  alias Thirstr.Places.OsmImport
  alias Thirstr.Repo

  # #113: merged Explore map (F-04 R-04.18/R-04.19) and place layers (R-04.20, F-12 R-12.9,
  # F-10 R-10.10/R-10.11).
  setup %{conn: conn} do
    {:ok, viewer: onboarded(conn), other: onboarded(conn, cell: zurich_ring(2))}
  end

  defp get_json(u, path), do: u.c |> recycle_authed() |> get(path) |> json_response(200)

  defp lenses!(u, show_in) do
    u.c
    |> recycle_authed()
    |> patch("/v1/me/profiles/#{u.pid}", %{show_in: show_in})
    |> json_response(200)
  end

  @zurich "8.50,47.35,8.58,47.40"

  defp venue!(name, kind, lat, lng, extra \\ %{}) do
    %{rows: [[id]]} =
      Repo.query!(
        """
        INSERT INTO venues (id, name, kind, lat, lng, ext_id, hidden, cell_r9, cell_r5, created_at)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6,
                h3_lat_lng_to_cell(point($4, $3), 9)::bigint, h3_lat_lng_to_cell(point($4, $3), 5)::bigint, now())
        RETURNING id::text
        """,
        [name, kind, lat, lng, extra[:ext], extra[:hidden] || false]
      )

    id
  end

  describe "merged map (R-04.18, R-04.19)" do
    @tag ac: "AC-04.11"
    test "intents select by show_in overlap and cards carry ordered intents", %{
      viewer: v,
      other: o
    } do
      lenses!(o, ["sport", "friends"])

      all = get_json(v, "/v1/explore/grid?intents=hookup,friends,sport")
      card = Enum.find(all["items"], &(&1["id"] == o.pid))
      assert card["intents"] == ["friends", "sport"]

      refute o.pid in ids(get_json(v, "/v1/explore/grid?intents=hookup")["items"])
      assert o.pid in ids(get_json(v, "/v1/explore/grid?intents=sport")["items"])

      map = get_json(v, "/v1/explore/map?intents=hookup,friends,sport&bbox=" <> @zurich)
      people = map["avatars"] ++ map["pins"]
      assert Enum.count(people, &(&1["id"] == o.pid)) == 1
      assert Enum.find(people, &(&1["id"] == o.pid))["intents"] == ["friends", "sport"]
    end

    test "summary gives per-intent counts and the union total", %{viewer: v, other: o} do
      lenses!(o, ["friends"])
      s = get_json(v, "/v1/explore/summary?intents=hookup,friends")
      assert s["counts"]["friends"] >= 1
      assert s["total"] >= s["counts"]["friends"]
      assert get_json(v, "/v1/explore/summary?intents=sport")["now"] == 0
    end

    test "legacy mode calls still work and carry intents", %{viewer: v, other: o} do
      card =
        Enum.find(get_json(v, "/v1/explore/grid?mode=hookup")["items"], &(&1["id"] == o.pid))

      assert card["intents"] == ["hookup"]
    end

    test "bad intents fall back to the mode", %{viewer: v} do
      assert %{"items" => _} = get_json(v, "/v1/explore/grid?intents=nope&mode=hookup")
    end
  end

  describe "places (R-04.20)" do
    @tag ac: "AC-04.12"
    test "venues and official parties in the viewport, by kind; hidden never", %{viewer: v} do
      club = venue!("Club Test", "club", 47.378, 8.54)
      gym = venue!("Gym Test", "gym", 47.379, 8.545)
      _hidden = venue!("Gone Bar", "bar", 47.377, 8.541, %{hidden: true})
      _far = venue!("Far Club", "club", 46.2, 6.14)

      Repo.query!(
        "INSERT INTO events (id, venue_id, title, starts_at, ends_at, created_at) VALUES (gen_random_uuid(), $1, 'Glitter', now() + interval '2 hours', now() + interval '8 hours', now())",
        [Ecto.UUID.dump!(club)]
      )

      %{"places" => ps} = get_json(v, "/v1/places?bbox=#{@zurich}")
      names = Enum.map(ps, & &1["name"])
      assert "Club Test" in names
      assert "Glitter" in names
      refute "Gym Test" in names
      refute "Gone Bar" in names
      refute "Far Club" in names

      ev = Enum.find(ps, &(&1["name"] == "Glitter"))

      assert ev["type"] == "event" and ev["kind"] == "official" and
               ev["venue_name"] == "Club Test"

      %{"places" => gyms} = get_json(v, "/v1/places?bbox=#{@zurich}&kinds=gyms")
      assert Enum.map(gyms, & &1["id"]) == [gym]
    end

    test "hosted parties only at their r8 centroid, never invite-only", %{
      viewer: v,
      other: o
    } do
      o.c
      |> recycle_authed()
      |> post("/v1/parties", %{
        title: "Loft party",
        starts_at: DateTime.utc_now() |> DateTime.add(3600) |> DateTime.to_iso8601(),
        ends_at: DateTime.utc_now() |> DateTime.add(4 * 3600) |> DateTime.to_iso8601(),
        capacity: 6,
        rules: []
      })
      |> json_response(201)

      %{"places" => ps} = get_json(v, "/v1/places?bbox=#{@zurich}&kinds=parties")
      p = Enum.find(ps, &(&1["name"] == "Loft party"))
      assert p["type"] == "party" and p["kind"] == "hosted"

      %{rows: [[lat, lng]]} =
        Repo.query!(
          "SELECT (h3_cell_to_lat_lng(cell_r8::h3index))[1], (h3_cell_to_lat_lng(cell_r8::h3index))[0] FROM parties LIMIT 1"
        )

      assert_in_delta p["lat"], lat, 1.0e-9
      assert_in_delta p["lng"], lng, 1.0e-9
      refute Jason.encode!(p) =~ "address"

      Repo.query!("UPDATE parties SET audience = 'invite'")
      %{"places" => ps} = get_json(v, "/v1/places?bbox=#{@zurich}&kinds=parties")
      refute Enum.any?(ps, &(&1["name"] == "Loft party"))
    end

    test "Safe Mode and huge viewports get nothing", %{viewer: v} do
      venue!("Club Safe", "club", 47.378, 8.54)
      assert %{"places" => []} = get_json(v, "/v1/places?bbox=5,45,11,48")

      v.c
      |> recycle_authed()
      |> put("/v1/me/safe_mode", %{setting: "on", active: true})
      |> json_response(200)

      assert %{"places" => []} = get_json(v, "/v1/places?bbox=#{@zurich}")
    end
  end

  describe "OSM import (R-12.9)" do
    @gay ~s({"elements":[
      {"type":"node","id":1,"lat":47.37,"lon":8.53,"tags":{"amenity":"nightclub","lgbtq":"primary","name":"Heaven"}},
      {"type":"way","id":2,"center":{"lat":47.38,"lon":8.52},"tags":{"leisure":"sauna","gay":"yes","name":"Steam","opening_hours":"Mo-Su 12:00-02:00"}},
      {"type":"node","id":3,"lat":47.39,"lon":8.51,"tags":{"amenity":"bar","lgbtq":"only"}}
    ]})
    @gyms ~s({"elements":[{"type":"node","id":9,"lat":47.36,"lon":8.55,"tags":{"leisure":"fitness_centre","name":"Iron"}}]})

    test "parses, upserts by ext_id, removes vanished; queries carry no user data" do
      old = Application.get_env(:thirstr, :places)
      on_exit(fn -> Application.put_env(:thirstr, :places, old) end)
      Application.put_env(:thirstr, :places, gym_regions: ["CH"])
      seen = :ets.new(:q, [:bag, :public])

      fetch = fn gay, gyms ->
        fn q ->
          :ets.insert(seen, {:q, q})
          {:ok, if(q =~ "fitness_centre", do: gyms, else: gay)}
        end
      end

      assert %{added: 3, updated: 0, removed: 0} = OsmImport.run(fetch.(@gay, @gyms))
      kinds = Repo.query!("SELECT name, kind, hours_text FROM venues ORDER BY name").rows
      assert ["Heaven", "club", nil] in kinds
      assert ["Steam", "sauna", "Mo-Su 12:00-02:00"] in kinds
      assert ["Iron", "gym", nil] in kinds

      gone =
        ~s({"elements":[{"type":"node","id":1,"lat":47.37,"lon":8.53,"tags":{"amenity":"nightclub","lgbtq":"primary","name":"Heaven 2"}}]})

      assert %{added: 0, updated: 2, removed: 1} = OsmImport.run(fetch.(gone, @gyms))
      names = Repo.query!("SELECT name FROM venues").rows |> List.flatten()
      assert "Heaven 2" in names
      refute "Steam" in names

      # failed query → nothing of that scope removed
      assert %{removed: 0, error: e} = OsmImport.run(fn _ -> {:error, :down} end)
      assert e
      assert "Iron" in (Repo.query!("SELECT name FROM venues").rows |> List.flatten())

      qs = :ets.lookup(seen, :q) |> Enum.map(&elem(&1, 1))
      assert Enum.all?(qs, &(not (&1 =~ ~r/around|poly|\d+\.\d{3,}/)))
    end
  end
end
