defmodule ThirstrWeb.IdempotencyTest do
  use ThirstrWeb.ConnCase, async: false
  alias Thirstr.Repo

  # DB-10 (#335): a repeated create with the same Idempotency-Key is stored once.
  defp city_id do
    %{rows: [[id]]} =
      Repo.query!("SELECT id FROM cities WHERE name = 'Berlin' AND country = 'DE' LIMIT 1")

    id
  end

  defp day(n), do: Date.utc_today() |> Date.add(n) |> Date.to_iso8601()
  defp trip(n), do: %{city_id: city_id(), first_day: day(n), last_day: day(n + 2), show_days: 7}

  defp post_trip(c, key, attrs) do
    c = recycle_authed(c)
    c = if key, do: put_req_header(c, "idempotency-key", key), else: c
    post(c, "/v1/trips", attrs)
  end

  defp trips_count do
    %{rows: [[n]]} = Repo.query!("SELECT count(*) FROM trips")
    n
  end

  setup %{conn: conn}, do: {:ok, me: onboarded(conn, basics: [display_name: "Jean"])}

  test "same key + same body: stored once, same answer replayed", %{me: me} do
    first = post_trip(me.c, "key-aaaaaaaa", trip(5))
    assert first.status == 201
    again = post_trip(me.c, "key-aaaaaaaa", trip(5))
    assert again.status == 201
    assert again.resp_body == first.resp_body
    assert get_resp_header(again, "idempotent-replayed") == ["true"]
    assert trips_count() == 1
  end

  test "same key + other body: 422, nothing stored", %{me: me} do
    assert post_trip(me.c, "key-bbbbbbbb", trip(5)).status == 201
    res = post_trip(me.c, "key-bbbbbbbb", trip(9))
    assert json_response(res, 422)["error"]["code"] == "idempotency_mismatch"
    assert trips_count() == 1
  end

  test "no key, or a malformed key, changes nothing", %{me: me} do
    assert post_trip(me.c, nil, trip(5)).status == 201
    # a malformed key is ignored: the controller answers (here: same city already planned)
    res = post_trip(me.c, "short", trip(5))
    refute (json_response(res, res.status)["error"]["code"] || "") =~ "idempotency"
    assert trips_count() == 1
    %{rows: [[0]]} = Repo.query!("SELECT count(*) FROM idempotency_keys")
  end

  test "an error answer is replayed, a claim with no answer is taken over after 2 min", %{me: me} do
    bad = post_trip(me.c, "key-cccccccc", %{city_id: city_id()})
    assert bad.status == 422
    assert post_trip(me.c, "key-cccccccc", %{city_id: city_id()}).resp_body == bad.resp_body

    Repo.query!(
      "UPDATE idempotency_keys SET status = NULL, body = NULL, created_at = now() - interval '3 minutes' WHERE key = 'key-cccccccc'"
    )

    assert post_trip(me.c, "key-cccccccc", %{city_id: city_id()}).status == 422
  end

  test "in-progress claim answers 409", %{me: me} do
    assert post_trip(me.c, "key-dddddddd", trip(5)).status == 201
    Repo.query!("UPDATE idempotency_keys SET status = NULL WHERE key = 'key-dddddddd'")
    res = post_trip(me.c, "key-dddddddd", trip(5))
    assert json_response(res, 409)["error"]["code"] == "idempotency_in_progress"
  end

  test "sweep removes keys after 24 h", %{me: me} do
    assert post_trip(me.c, "key-eeeeeeee", trip(5)).status == 201
    Repo.query!("UPDATE idempotency_keys SET created_at = now() - interval '25 hours'")
    ThirstrWeb.Plugs.Idempotency.sweep()
    %{rows: [[0]]} = Repo.query!("SELECT count(*) FROM idempotency_keys")
  end
end
