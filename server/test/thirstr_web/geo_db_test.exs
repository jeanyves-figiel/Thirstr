defmodule ThirstrWeb.GeoDbTest do
  @moduledoc "Offline IP → city (R-02.2, #26): build + pread lookup, IP never leaves the box."
  use ThirstrWeb.ConnCase, async: false
  alias Thirstr.Geo.{GeoDb, GeoDbBuilder}

  @csv """
  0.0.0.0,0.255.255.255,ZZ,ZZ,,,0,0
  1.0.0.0,1.0.0.255,OC,AU,Queensland,South Brisbane,-27.4,153.0
  1.0.1.0,1.0.1.255,OC,AU,Queensland,South Brisbane,-27.4,153.0
  2.0.0.0,2.0.0.255,EU,CH,Zurich,Zürich,47.3,8.5
  5.0.0.0,5.0.0.255,NA,US,District of Columbia,"Washington, D.C.",38.9,-77.0
  2001:db8::,2001:db8:0:0:ffff:ffff:ffff:ffff,EU,DE,Berlin,Berlin,52.5,13.4
  2001:db8:0:1::,2001:db8:0:1:ffff:ffff:ffff:ffff,EU,DE,Berlin,Berlin,52.5,13.4
  2a02::,2a02::ffff:ffff:ffff:ffff,EU,FR,Ile-de-France,Paris,48.8,2.3
  """

  setup do
    path = Path.join(System.tmp_dir!(), "geo-#{System.unique_integer([:positive])}.tgeo")

    counts =
      @csv
      |> String.split("\n", trim: true)
      |> Enum.map(&GeoDbBuilder.parse_line/1)
      |> GeoDbBuilder.build(path)

    on_exit(fn -> File.rm(path) end)
    %{path: path, counts: counts}
  end

  test "builds a compact file: merges same-city neighbours, fills gaps", %{counts: c} do
    # v4: 0 unknown, 1.0.0.0 Brisbane (2 ranges merged), 1.0.2.0 gap, 2.0.0.0 Zürich, gap,
    # 5.0.0.0 DC, trailing gap. v6 (/64): 0, Berlin (2 merged), gap, Paris, trailing gap.
    assert c == %{v4: 7, v6: 5, cities: 5}
  end

  test "looks up IPv4, IPv4-mapped IPv6 and IPv6 /64", %{path: p} do
    assert GeoDb.lookup(p, {1, 0, 1, 7}) == {:ok, %{city: "South Brisbane", country: "AU"}}
    assert GeoDb.lookup(p, {2, 0, 0, 1}) == {:ok, %{city: "Zürich", country: "CH"}}
    assert GeoDb.lookup(p, {5, 0, 0, 255}) == {:ok, %{city: "Washington, D.C.", country: "US"}}

    assert GeoDb.lookup(p, {0, 0, 0, 0, 0, 0xFFFF, 0x0200, 0x0009}) ==
             {:ok, %{city: "Zürich", country: "CH"}}

    assert GeoDb.lookup(p, {0x2001, 0xDB8, 0, 1, 0, 0, 0, 5}) ==
             {:ok, %{city: "Berlin", country: "DE"}}

    assert GeoDb.lookup(p, {0x2A02, 0, 0, 0, 1, 2, 3, 4}) ==
             {:ok, %{city: "Paris", country: "FR"}}
  end

  test "unknown for gaps, no-city ranges, past the end, bad input", %{path: p} do
    assert GeoDb.lookup(p, {0, 1, 2, 3}) == :unknown
    assert GeoDb.lookup(p, {1, 0, 2, 0}) == :unknown
    assert GeoDb.lookup(p, {9, 9, 9, 9}) == :unknown
    assert GeoDb.lookup(p, {0x2A03, 0, 0, 0, 0, 0, 0, 1}) == :unknown
    assert GeoDb.lookup(p, :bogus) == :unknown
    assert GeoDb.lookup("/nonexistent.tgeo", {1, 0, 0, 1}) == :unknown
    assert GeoDb.lookup(nil, {1, 0, 0, 1}) == :unknown
  end

  test "Welcome uses the client IP Fly reports, not a spoofable X-Forwarded-For", %{
    conn: conn,
    path: p
  } do
    prev = Application.get_env(:thirstr, :ip_geo)
    Application.put_env(:thirstr, :ip_geo, GeoDb)
    Application.put_env(:thirstr, :geo_db_path, p)

    on_exit(fn ->
      Application.put_env(:thirstr, :ip_geo, prev)
      Application.delete_env(:thirstr, :geo_db_path)
    end)

    body =
      conn
      |> put_req_header("fly-client-ip", "2.0.0.7")
      |> put_req_header("x-forwarded-for", "1.0.0.1")
      |> get("/v1/welcome")
      |> json_response(200)

    assert body["city"] in ["Zurich", "Zürich"]
  end
end
