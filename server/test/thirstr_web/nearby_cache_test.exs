defmodule ThirstrWeb.NearbyCacheTest do
  # SR-09 (#149): distances come from memoized centroids, not one SQL round trip per item.
  use ThirstrWeb.ConnCase, async: false
  alias Thirstr.{Nearby, Repo}

  test "memoized distance matches h3_great_circle_distance; warm is one query for many cells" do
    ctx = %{point: %{lat: 48.8566, lng: 2.3522}}

    cells =
      for {lat, lng} <- [{48.861, 2.351}, {48.80, 2.40}, {52.52, 13.40}],
          do: Nearby.cell(%{lat: lat, lng: lng}, 9)

    sql =
      for c <- cells do
        [[d]] =
          Repo.query!(
            "SELECT h3_great_circle_distance(h3_cell_to_lat_lng($1::bigint::h3index), point(2.3522, 48.8566), 'm')",
            [c]
          ).rows

        d
      end

    :ets.delete_all_objects(:thirstr_h3_centroids)
    ref = :telemetry_test.attach_event_handlers(self(), [[:thirstr, :repo, :query]])
    Nearby.warm(cells)
    got = Enum.map(cells, &Nearby.dist_m(ctx, &1))
    :telemetry.detach(ref)

    assert_received {[:thirstr, :repo, :query], ^ref, _, _}
    refute_received {[:thirstr, :repo, :query], ^ref, _, _}
    Enum.zip(got, sql) |> Enum.each(fn {a, b} -> assert_in_delta a, b, 0.5 end)
  end
end
