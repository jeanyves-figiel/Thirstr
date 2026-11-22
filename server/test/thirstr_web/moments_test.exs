defmodule ThirstrWeb.MomentsTest do
  use ThirstrWeb.ConnCase, async: false
  import Phoenix.ChannelTest, except: [connect: 2, push: 3]
  require Phoenix.ChannelTest

  # F-21 Moments (#212): temporary photos, audience per Moment, rings on cards, Seen by (D-21b C).

  setup %{conn: conn} do
    poster = onboarded(conn, basics: [display_name: "Marco"])
    viewer = onboarded(conn, cell: zurich_ring(1), basics: [display_name: "Luca"])
    {:ok, poster: poster, viewer: viewer, conn: conn}
  end

  defp req(c), do: recycle_authed(c)

  defp share(c, attrs \\ %{}) do
    up = c |> req() |> post("/v1/moments/uploads", %{content_type: "image/jpeg"})
    up = json_response(up, 201)

    c
    |> req()
    |> post("/v1/moments/#{up["moment_id"]}/publish", Map.merge(%{ttl_s: 86_400}, attrs))
  end

  defp share!(c, attrs \\ %{}), do: share(c, attrs) |> json_response(200)

  defp moments_of(c, pid, mode \\ "hookup"),
    do: c |> req() |> get("/v1/profiles/#{pid}/moments?mode=#{mode}")

  defp grid_card(c, pid) do
    c
    |> req()
    |> get("/v1/explore/grid?intents=hookup,friends,sport")
    |> json_response(200)
    |> Map.get("items")
    |> Enum.find(&(&1["id"] == pid))
  end

  test "share, see, ring on the card, seen after viewing", %{poster: p, viewer: v} do
    m = share!(p.c, %{caption: "Ready for tonight", caption_style: "pop"})
    assert m["status"] == "live"
    assert m["expires_at"]

    card = grid_card(v.c, p.pid)
    assert card["moments"]["live"] == 1
    assert card["moments"]["unseen"] == true

    list = moments_of(v.c, p.pid) |> json_response(200) |> Map.get("moments")
    assert [%{"caption" => "Ready for tonight", "caption_style" => "pop", "seen" => false}] = list

    v.c
    |> req()
    |> post("/v1/moments/views", %{ids: [hd(list)["id"]]})
    |> json_response(200)

    assert grid_card(v.c, p.pid)["moments"]["unseen"] == false

    prof = v.c |> req() |> get("/v1/profiles/#{p.pid}") |> json_response(200)
    assert prof["moments"] == %{"live" => 1, "unseen" => false}
  end

  @tag ac: "AC-21.2"
  test "favorites audience: only listed people; others get the same 404", %{
    poster: p,
    viewer: v,
    conn: conn
  } do
    other = onboarded(conn, cell: zurich_ring(2))
    share!(p.c, %{audience: "favorites", audience_ids: [v.pid]})

    assert moments_of(v.c, p.pid) |> json_response(200) |> Map.get("moments") |> length() == 1
    assert moments_of(other.c, p.pid) |> json_response(404)
    assert grid_card(other.c, p.pid)["moments"] == nil
    # no Moment at all looks the same
    assert moments_of(other.c, other.pid) |> json_response(404)
  end

  # #247 R-07.44: friends are resolved on the phone like favorites; only ids reach the server.
  test "friends audience: only listed people", %{poster: p, viewer: v, conn: conn} do
    other = onboarded(conn, cell: zurich_ring(2))
    share!(p.c, %{audience: "friends", audience_ids: [v.pid]})

    assert moments_of(v.c, p.pid) |> json_response(200) |> Map.get("moments") |> length() == 1
    assert moments_of(other.c, p.pid) |> json_response(404)
  end

  @tag ac: "AC-21.3"
  test "blocking removes access at once", %{poster: p, viewer: v} do
    share!(p.c)
    assert moments_of(v.c, p.pid) |> json_response(200)
    p.c |> req() |> post("/v1/profiles/#{v.pid}/block") |> response(204)
    assert moments_of(v.c, p.pid) |> json_response(404)
  end

  @tag ac: "AC-21.5"
  test "a Moment that fails main_ok never shows in Friends or Sport", %{poster: p, viewer: v} do
    m = share!(p.c, %{intents: ["hookup", "friends"]})

    Thirstr.Repo.query!("UPDATE moments SET main_ok = false WHERE id = $1", [
      Ecto.UUID.dump!(m["id"])
    ])

    assert moments_of(v.c, p.pid, "friends") |> json_response(404)
    assert moments_of(v.c, p.pid, "hookup") |> json_response(200)
  end

  test "sport lens doesn't see a Hookup-only Moment", %{poster: p, viewer: v} do
    share!(p.c, %{intents: ["hookup"]})
    assert moments_of(v.c, p.pid, "sport") |> json_response(404)
  end

  test "explicit photos are refused and deleted", %{poster: p} do
    up =
      p.c
      |> req()
      |> post("/v1/moments/uploads", %{content_type: "image/jpeg"})
      |> json_response(201)

    Thirstr.Repo.query!(
      "UPDATE moments SET storage_key = storage_key || '-explicit' WHERE id = $1",
      [Ecto.UUID.dump!(up["moment_id"])]
    )

    res =
      p.c
      |> req()
      |> post("/v1/moments/#{up["moment_id"]}/publish", %{ttl_s: 3600})
      |> json_response(200)

    assert res["status"] == "rejected"

    assert p.c |> req() |> get("/v1/moments/mine") |> json_response(200) |> Map.get("moments") ==
             []
  end

  @tag ac: "AC-21.6"
  test "limits: options, verified only, 10 live", %{poster: p, conn: conn} do
    assert share(p.c, %{ttl_s: 7200}) |> json_response(422)
    assert share(p.c, %{audience: "chats"}) |> json_response(422)
    assert share(p.c, %{caption: String.duplicate("a", 81)}) |> json_response(422)
    assert share(p.c, %{intents: ["party"]}) |> json_response(422)

    unverified = onboarded(conn, cell: zurich_ring(3), verified: false)

    assert unverified.c
           |> req()
           |> post("/v1/moments/uploads", %{content_type: "image/jpeg"})
           |> json_response(403)

    for _ <- 1..10, do: share!(p.c)

    assert p.c
           |> req()
           |> post("/v1/moments/uploads", %{content_type: "image/jpeg"})
           |> json_response(409)
  end

  test "Seen by: names unless the viewer watches quietly (D-21b C)", %{
    poster: p,
    viewer: v,
    conn: conn
  } do
    quiet = onboarded(conn, cell: zurich_ring(2), basics: [display_name: "Kenji"])
    quiet.c |> req() |> patch("/v1/me/settings", %{moments_quiet: true}) |> json_response(200)

    m = share!(p.c)

    for x <- [v, quiet],
        do: x.c |> req() |> post("/v1/moments/views", %{ids: [m["id"]]}) |> json_response(200)

    v.c |> req() |> post("/v1/moments/#{m["id"]}/tap") |> json_response(200)
    v.c |> req() |> post("/v1/moments/#{m["id"]}/screenshot") |> response(204)

    [mine] = p.c |> req() |> get("/v1/moments/mine") |> json_response(200) |> Map.get("moments")
    assert mine["seen_count"] == 2
    assert mine["tap_count"] == 1
    assert mine["quiet_count"] == 1
    assert mine["screenshots"] == 1
    assert [%{"display_name" => "Luca", "tapped" => true, "screenshot" => true}] = mine["viewers"]

    # reciprocal: a quiet poster sees counts only
    p.c |> req() |> patch("/v1/me/settings", %{moments_quiet: true}) |> json_response(200)
    [mine] = p.c |> req() |> get("/v1/moments/mine") |> json_response(200) |> Map.get("moments")
    assert mine["viewers"] == []
    assert mine["seen_count"] == 2
  end

  test "mute hides the ring, delete is instant", %{poster: p, viewer: v} do
    m = share!(p.c)
    v.c |> req() |> put("/v1/moments/mutes/#{p.pid}") |> response(204)
    assert grid_card(v.c, p.pid)["moments"] == nil
    v.c |> req() |> delete("/v1/moments/mutes/#{p.pid}") |> response(204)
    assert grid_card(v.c, p.pid)["moments"]["live"] == 1

    p.c |> req() |> delete("/v1/moments/#{m["id"]}") |> response(204)
    assert moments_of(v.c, p.pid) |> json_response(404)
  end

  @tag ac: "AC-21.4"
  test "sweep deletes expired Moments with their views", %{poster: p, viewer: v} do
    m = share!(p.c)
    v.c |> req() |> post("/v1/moments/views", %{ids: [m["id"]]}) |> json_response(200)

    Thirstr.Repo.query!(
      "UPDATE moments SET expires_at = now() - interval '1 minute' WHERE id = $1",
      [Ecto.UUID.dump!(m["id"])]
    )

    assert moments_of(v.c, p.pid) |> json_response(404)
    assert Thirstr.Moments.sweep() == 1
    assert %{rows: [[0]]} = Thirstr.Repo.query!("SELECT count(*) FROM moment_views")
  end

  test "hidden posters can't share with everyone", %{poster: p} do
    Thirstr.Repo.query!("UPDATE accounts SET hidden = true WHERE id = $1", [
      Ecto.UUID.dump!(account_of(p.pid).id)
    ])

    assert share(p.c) |> json_response(422)
  end

  # #221 R-21.24: borderline Moments stay hidden until the owner approves them in Admin A-03.
  test "review queue: borderline hidden, approve makes it live, reject deletes", %{
    poster: p,
    viewer: v
  } do
    # The permissive public rules rarely land in review, so set the state the classifier would.
    borderline = fn ->
      id = share!(p.c)["id"]

      Thirstr.Repo.query!(
        "UPDATE moments SET status = 'review', thumb_key = NULL WHERE id = $1",
        [Ecto.UUID.dump!(id)]
      )

      id
    end

    a = borderline.()
    b = borderline.()
    assert moments_of(v.c, p.pid) |> json_response(404)
    assert Enum.map(Thirstr.Moments.review_queue(), & &1.id) |> Enum.sort() == Enum.sort([a, b])

    assert :ok = Thirstr.Moments.review(a, "approve")
    assert :ok = Thirstr.Moments.review(b, "reject")
    assert {:error, :not_found} = Thirstr.Moments.review(b, "approve")
    assert Thirstr.Moments.review_queue() == []

    assert [%{"id" => ^a}] =
             moments_of(v.c, p.pid) |> json_response(200) |> Map.get("moments")
  end

  # #221 R-21.9: live rings over the socket, only for watched profiles the viewer may see.
  test "socket: moments.watch pushes ring changes, never for hidden Moments", %{
    poster: p,
    viewer: v,
    conn: conn
  } do
    [auth] = Plug.Conn.get_req_header(v.c, "authorization")
    token = String.replace_prefix(auth, "Bearer ", "")
    {:ok, socket} = Phoenix.ChannelTest.connect(ThirstrWeb.UserSocket, %{"token" => token})
    {:ok, _, ch} = subscribe_and_join(socket, ThirstrWeb.UserChannel, "user:me")

    ref =
      Phoenix.ChannelTest.push(ch, "moments.watch", %{"ids" => [p.pid], "intents" => ["hookup"]})

    assert_reply ref, :ok

    m = share!(p.c)
    pid = p.pid
    assert_push "moments.ring", %{profile_id: ^pid, moments: %{live: 1, unseen: true}}

    p.c |> req() |> delete("/v1/moments/#{m["id"]}") |> response(204)
    assert_push "moments.ring", %{profile_id: ^pid, moments: nil}

    # favorites-only Moment for someone else: no event at all for this viewer
    other = onboarded(conn, cell: zurich_ring(2))
    share!(p.c, %{audience: "favorites", audience_ids: [other.pid]})
    refute_push "moments.ring", _, 200
  end
end
