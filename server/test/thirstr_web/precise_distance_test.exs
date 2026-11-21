defmodule ThirstrWeb.PreciseDistanceTest do
  use ThirstrWeb.ConnCase, async: false

  # #197: opt-in "Show closer distance" (F-05 R-05.13–R-05.16), nearest-first grid and rounded
  # distances (F-04 R-04.4, R-04.6).
  alias Thirstr.Explore

  setup %{conn: conn} do
    viewer = onboarded(conn)
    {:ok, viewer: viewer, conn: conn}
  end

  defp grid(c),
    do: c |> recycle_authed() |> get("/v1/explore/grid?mode=hookup") |> json_response(200)

  defp r10_in(r9, n \\ 0) do
    %{rows: rows} =
      Thirstr.Repo.query!("SELECT c::text FROM h3_cell_to_children($1::text::h3index, 10) c", [r9])

    rows |> Enum.at(n) |> hd()
  end

  defp loc(c, body),
    do: c |> recycle_authed() |> put("/v1/me/location", body)

  defp display_res(pid) do
    %{rows: [[res]]} =
      Thirstr.Repo.query!("SELECT display_res FROM location_cells WHERE profile_id = $1", [
        Ecto.UUID.dump!(pid)
      ])

    res
  end

  test "rounding steps follow the cell size, rounded down, with floors (R-04.6)" do
    assert Explore.rounded(47.0, :pin) == {40, false}
    assert Explore.rounded(4.0, :pin) == {10, true}
    assert Explore.rounded(183.0, 10) == {150, false}
    assert Explore.rounded(60.0, 10) == {100, true}
    assert Explore.rounded(1_349.0, 10) == {1_300, false}
    assert Explore.rounded(468.0, 9) == {400, false}
    assert Explore.rounded(150.0, 9) == {200, true}
    assert Explore.rounded(1_740.0, 9) == {1_500, false}
    assert Explore.rounded(14_900.0, 9) == {14_000, false}
    assert Explore.rounded(700.0, 8) == {1_000, true}
    assert Explore.rounded(3_700.0, 7) == {3_000, false}
  end

  test "precise needs an r10 cell inside the r9 cell and is remembered (R-05.13)", %{conn: conn} do
    o = onboarded(conn, cell: zurich_ring(1))
    r9 = zurich_ring(1)
    other_r10 = r10_in(zurich_ring(3))

    assert loc(o.c, %{level: "area", cell_r9: r9, precise: true, cell_r10: other_r10})
           |> json_response(422)

    me =
      loc(o.c, %{level: "area", cell_r9: r9, precise: true, cell_r10: r10_in(r9)})
      |> json_response(200)

    assert me["location"]["precise"] == true

    # periodic sync without the flag keeps it
    loc(o.c, %{level: "area", cell_r9: r9, cell_r10: r10_in(r9, 1)}) |> json_response(200)

    %{rows: [[p, c10]]} =
      Thirstr.Repo.query!(
        "SELECT precise, cell_r10 IS NOT NULL FROM location_cells WHERE profile_id = $1",
        [
          Ecto.UUID.dump!(o.pid)
        ]
      )

    assert p and c10

    # City clears the cell but keeps the choice
    me = o.c |> recycle_authed() |> get("/v1/me") |> json_response(200)
    assert me["location"]["precise"]
  end

  test "precise shows at r10 only with >= 3 visible in the r9 cell (R-05.14, AC-05.1b)", %{
    viewer: v,
    conn: conn
  } do
    r9 = zurich_ring(2)
    o = onboarded(conn, cell: r9)

    loc(o.c, %{level: "area", cell_r9: r9, precise: true, cell_r10: r10_in(r9)})
    |> json_response(200)

    Thirstr.Location.refresh_k_anonymity()
    assert display_res(o.pid) in [7, 8, 9]

    _ = for _ <- 1..2, do: onboarded(conn, cell: r9)
    Thirstr.Location.refresh_k_anonymity()
    assert display_res(o.pid) == 10

    card = grid(v.c)["items"] |> Enum.find(&(&1["id"] == o.pid))
    assert card["distance"]["precise"]
    assert rem(card["distance"]["m"], 50) == 0
  end

  test "explicit precise is refused in Safe Mode (R-05.10)", %{conn: conn} do
    o = onboarded(conn, cell: zurich_ring(1))
    o.c |> recycle_authed() |> put("/v1/me/safe_mode", %{setting: "on"}) |> json_response(200)
    r9 = zurich_ring(1)

    assert loc(o.c, %{level: "area", cell_r9: r9, precise: true, cell_r10: r10_in(r9)})
           |> json_response(403)
  end

  test "grid is nearest first, Now and pins no longer jump ahead (R-04.4)", %{
    viewer: v,
    conn: conn
  } do
    near = onboarded(conn, cell: zurich_ring(1))
    far = onboarded(conn, cell: zurich_ring(6))

    far.c
    |> recycle_authed()
    |> put("/v1/me/now", %{status: "door_open", ttl_s: 3600})
    |> json_response(200)

    order = grid(v.c)["items"] |> Enum.map(& &1["id"])
    assert Enum.find_index(order, &(&1 == near.pid)) < Enum.find_index(order, &(&1 == far.pid))

    ms = grid(v.c)["items"] |> Enum.map(& &1["distance"]["m"]) |> Enum.reject(&is_nil/1)
    assert ms == Enum.sort(ms)
  end

  test "owner range choice and the spoof brake give buckets only (R-05.16)", %{
    viewer: v,
    conn: conn
  } do
    o = onboarded(conn, cell: zurich_ring(1))
    card = grid(v.c)["items"] |> Enum.find(&(&1["id"] == o.pid))
    assert is_integer(card["distance"]["m"]) and card["distance"]["bucket"]

    o.c
    |> recycle_authed()
    |> patch("/v1/me/settings", %{show_distance: "range"})
    |> json_response(200)

    card = grid(v.c)["items"] |> Enum.find(&(&1["id"] == o.pid))
    refute Map.has_key?(card["distance"], "m")
    assert card["distance"]["bucket"]

    o.c
    |> recycle_authed()
    |> patch("/v1/me/settings", %{show_distance: "exact"})
    |> json_response(200)

    acct = account_of(v.pid)
    refute Thirstr.Location.spoof_brake?(acct)

    for k <- 0..21 do
      Thirstr.Valkey.command!([
        "SADD",
        "vcells:#{acct.id}:#{div(System.system_time(:second), 3600)}",
        "c#{k}"
      ])
    end

    assert Thirstr.Location.spoof_brake?(acct)
    card = grid(v.c)["items"] |> Enum.find(&(&1["id"] == o.pid))
    refute Map.has_key?(card["distance"], "m")
  end
end
