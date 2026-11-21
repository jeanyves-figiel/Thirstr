defmodule ThirstrWeb.SafetyTest do
  use ThirstrWeb.ConnCase, async: false

  # F-13: relays, check-in held alerts, panic, contact page API. Server sees ciphertext only.
  setup %{conn: conn} do
    Application.put_env(:thirstr, :webpush_sink, self())
    on_exit(fn -> Application.delete_env(:thirstr, :webpush_sink) end)
    {:ok, u: onboarded(conn), c: conn}
  end

  @ep "https://fcm.googleapis.com/fcm/send/abc"
  defp ct, do: Base.encode64(:crypto.strong_rand_bytes(60))
  defp authed(u), do: recycle_authed(u.c)
  defp due(min), do: DateTime.utc_now() |> DateTime.add(min * 60) |> DateTime.to_iso8601()

  defp contact(u, conn) do
    %{"id" => id, "rid" => rid} =
      authed(u) |> post("/v1/trusted/invite", %{intro: ct()}) |> json_response(201)

    r = conn |> recycle() |> get("/v1/relay/#{rid}") |> json_response(200)
    assert r["accepted"] == false and is_binary(r["intro"]) and is_binary(r["vapid_key"])

    conn
    |> recycle()
    |> post("/v1/relay/#{rid}/accept", %{push: %{endpoint: @ep, keys: %{}}})
    |> response(204)

    {id, rid}
  end

  defp inbox(conn, rid),
    do: (conn |> recycle() |> get("/v1/relay/#{rid}/messages") |> json_response(200))["messages"]

  test "invite → accept → check-in: notice now, alert held until due + 15 min, then released", %{
    u: u,
    c: c
  } do
    {id, rid} = contact(u, c)

    assert [%{"accepted" => true, "push" => true}] =
             (authed(u) |> get("/v1/trusted") |> json_response(200))["contacts"]

    env = [%{relay: id, ciphertext: ct()}]

    r =
      authed(u)
      |> post("/v1/checkin", %{due_at: due(60), notices: env, alerts: env})
      |> json_response(201)

    assert_receive {:webpush, @ep}
    assert [%{"ciphertext" => _}] = inbox(c, rid)
    assert authed(u) |> post("/v1/checkin", %{due_at: due(60), alerts: env}) |> json_response(409)

    # extend (+30 min) and refresh keep exactly one held alert
    assert %{"due_at" => _} =
             authed(u)
             |> post("/v1/checkin/#{r["token"]}/extend", %{alerts: env})
             |> json_response(200)

    authed(u) |> put("/v1/checkin/#{r["token"]}/alerts", %{alerts: env}) |> response(204)

    [[held]] =
      Thirstr.Repo.query!("SELECT count(*) FROM safety_msgs WHERE release_at IS NULL").rows

    assert held == 1

    Thirstr.Repo.query!("UPDATE checkins SET due_at = now() - interval '16 minutes'")
    Thirstr.Safety.sweep()
    assert_receive {:webpush, @ep}
    msgs = inbox(c, rid)
    assert length(msgs) == 2
    assert %{"checkin" => nil} = authed(u) |> get("/v1/checkin") |> json_response(200)

    c
    |> recycle()
    |> post("/v1/relay/#{rid}/ack", %{ids: Enum.map(msgs, & &1["id"])})
    |> response(204)

    assert inbox(c, rid) == []
  end

  test "Safe Mode country list is public, identical for everyone and cacheable (R-14.1a)", %{c: c} do
    conn = get(c, "/v1/safe-mode/countries")
    body = json_response(conn, 200)
    assert get_resp_header(conn, "cache-control") == ["public, max-age=21600"]
    assert "BF" in body["countries"] and "ZW" in body["countries"] and "TT" in body["countries"]
    assert Enum.all?(body["countries"], &Regex.match?(~r/^[A-Z]{2}$/, &1))
  end

  test "OK deletes the check-in and its held alerts (R-13.10)", %{u: u, c: c} do
    {id, rid} = contact(u, c)
    env = [%{relay: id, ciphertext: ct()}]

    %{"token" => t} =
      authed(u) |> post("/v1/checkin", %{due_at: due(60), alerts: env}) |> json_response(201)

    authed(u) |> post("/v1/checkin/#{t}/ok", %{oks: env}) |> response(204)

    assert [[0]] =
             Thirstr.Repo.query!("SELECT count(*) FROM safety_msgs WHERE release_at IS NULL").rows

    assert [%{}] = inbox(c, rid)
    assert authed(u) |> post("/v1/checkin/#{t}/ok", %{}) |> json_response(404)
  end

  test "phone lost its copy: DELETE /checkin ends it without the token (#127, R-13.21)", %{
    u: u,
    c: c,
    conn: conn
  } do
    {id, rid} = contact(u, c)
    env = [%{relay: id, ciphertext: ct()}]

    authed(u) |> post("/v1/checkin", %{due_at: due(60), alerts: env}) |> json_response(201)

    # restart is refused while the server copy runs
    assert %{"error" => %{"code" => "checkin_active"}} =
             authed(u)
             |> post("/v1/checkin", %{due_at: due(60), alerts: env})
             |> json_response(409)

    # someone else can neither end it nor send through my relay
    other = onboarded(conn)
    assert recycle_authed(other.c) |> delete("/v1/checkin", %{}) |> json_response(404)

    assert recycle_authed(other.c)
           |> delete("/v1/checkin", %{oks: env})
           |> json_response(422)

    authed(u) |> delete("/v1/checkin", %{oks: env}) |> response(204)
    assert_receive {:webpush, @ep}
    assert %{"checkin" => nil} = authed(u) |> get("/v1/checkin") |> json_response(200)

    assert [[0]] =
             Thirstr.Repo.query!("SELECT count(*) FROM safety_msgs WHERE release_at IS NULL").rows

    # held alert gone: the sweep releases nothing; inbox = ok only
    Thirstr.Safety.sweep()
    refute_receive {:webpush, @ep}, 50
    assert [%{}] = inbox(c, rid)

    assert authed(u) |> delete("/v1/checkin", %{}) |> json_response(404)
    assert authed(u) |> post("/v1/checkin", %{due_at: due(60), alerts: env}) |> json_response(201)
  end

  test "panic releases immediately; envelopes only to own accepted relays", %{
    u: u,
    c: c,
    conn: conn
  } do
    {id, rid} = contact(u, c)

    authed(u)
    |> post("/v1/checkin/panic", %{alerts: [%{relay: id, ciphertext: ct()}]})
    |> response(204)

    assert_receive {:webpush, @ep}
    assert [%{}] = inbox(c, rid)

    other = onboarded(conn)

    assert recycle_authed(other.c)
           |> post("/v1/checkin/panic", %{alerts: [%{relay: id, ciphertext: ct()}]})
           |> json_response(422)
  end

  test "limits, opt-out and push allowlist", %{u: u, c: c} do
    {id, rid} = contact(u, c)
    %{"rid" => r2} = authed(u) |> post("/v1/trusted/invite", %{intro: ct()}) |> json_response(201)

    assert c
           |> recycle()
           |> put("/v1/relay/#{r2}/push", %{push: %{endpoint: @ep}})
           |> json_response(404)

    assert c
           |> recycle()
           |> post("/v1/relay/#{r2}/accept", %{push: %{endpoint: "https://evil.example/x"}})
           |> json_response(422)

    authed(u) |> post("/v1/trusted/invite", %{intro: ct()}) |> json_response(201)

    assert %{"error" => %{"code" => "contacts_full"}} =
             authed(u) |> post("/v1/trusted/invite", %{intro: ct()}) |> json_response(409)

    c |> recycle() |> delete("/v1/relay/#{rid}") |> response(204)
    assert c |> recycle() |> get("/v1/relay/#{rid}") |> json_response(404)

    refute Enum.any?(
             (authed(u) |> get("/v1/trusted") |> json_response(200))["contacts"],
             &(&1["id"] == id)
           )
  end

  test "check-in needs an accepted contact and a sane due time", %{u: u} do
    assert authed(u) |> post("/v1/checkin", %{due_at: due(60), alerts: []}) |> json_response(422)
    assert authed(u) |> post("/v1/checkin", %{due_at: due(5), alerts: []}) |> json_response(422)
  end
end
