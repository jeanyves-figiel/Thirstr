defmodule ThirstrWeb.LinkedAccountsTest do
  # I-01 (#17): proofs, one per platform, store-review flag, lens + Safe Mode filters, reports.
  use ThirstrWeb.ConnCase, async: false
  alias Thirstr.{Flags, Linked, Repo}

  setup %{conn: conn} do
    :ets.delete(:thirstr_flags, :rows)

    on_exit(fn ->
      :ets.delete(:thirstr_flags, :rows)

      for k <- [:bluesky_profile, :creator_page, :x_oembed],
          do: Application.delete_env(:thirstr, k)
    end)

    {:ok, u: onboarded(conn), conn: conn}
  end

  defp authed(u), do: recycle_authed(u.c)

  defp build(conn, n),
    do:
      conn
      |> put_req_header("x-thirstr-platform", "ios")
      |> put_req_header("x-thirstr-build", to_string(n))

  defp add(u, platform, handle, vis \\ "everyone"),
    do:
      authed(u)
      |> post("/v1/me/linked-accounts", %{
        profile_id: u.pid,
        platform: platform,
        handle: handle,
        visibility: vis
      })

  defp seen(viewer, pid, extra \\ & &1),
    do:
      (recycle_authed(viewer.c)
       |> extra.()
       |> get("/v1/profiles/#{pid}")
       |> json_response(200))[
        "linked_accounts"
      ]

  test "profile URL is parsed into the handle; one link per platform", %{u: u} do
    r = add(u, "bluesky", "https://bsky.app/profile/Max.bsky.social") |> json_response(201)
    assert r["proof_method"] == "bio_code"

    assert [%{"handle" => "max.bsky.social", "state" => "unproven", "code" => "thirstr-" <> _}] =
             (authed(u)
              |> get("/v1/me/profiles/#{u.pid}/linked-accounts")
              |> json_response(200))[
               "linked"
             ]

    assert add(u, "bluesky", "other.bsky.social") |> json_response(409)
    assert Linked.normalize_handle("onlyfans", "https://onlyfans.com/NicoGym") == "nicogym"
  end

  test "Bluesky: code in display name proves and stores the DID; DID can't be proven twice", %{
    u: u,
    conn: conn
  } do
    r = add(u, "bluesky", "max.bsky.social") |> json_response(201)

    Application.put_env(:thirstr, :bluesky_profile, fn _ ->
      %{"did" => "did:plc:abc", "handle" => "Max.bsky.social", "displayName" => r["code"]}
    end)

    assert %{"state" => "proven"} =
             authed(u) |> post("/v1/me/linked-accounts/#{r["id"]}/verify") |> json_response(200)

    assert [["did:plc:abc"]] =
             Repo.query!("SELECT platform_user_id FROM linked_accounts").rows

    other = onboarded(conn)
    r2 = add(other, "bluesky", "max2.bsky.social") |> json_response(201)

    Application.put_env(:thirstr, :bluesky_profile, fn _ ->
      %{"did" => "did:plc:abc", "handle" => "max.bsky.social", "description" => r2["code"]}
    end)

    assert %{"error" => %{"code" => "taken"}} =
             recycle_authed(other.c)
             |> post("/v1/me/linked-accounts/#{r2["id"]}/verify")
             |> json_response(409)
  end

  test "OnlyFans: code on the page proves; unreadable page goes to the hand-check queue", %{u: u} do
    r = add(u, "onlyfans", "nicogym") |> json_response(201)
    assert r["proof_method"] == "bio_code"

    Application.put_env(:thirstr, :creator_page, fn "onlyfans", "nicogym" -> {:status, 403} end)

    assert %{"state" => "manual_pending"} =
             authed(u) |> post("/v1/me/linked-accounts/#{r["id"]}/verify") |> json_response(200)

    assert [%{id: id, platform: "onlyfans"}] = Linked.manual_queue()
    assert {:ok, %{state: "proven"}} = Linked.manual_decision(id, "approve")
    assert Linked.manual_queue() == []

    j = add(u, "jff", "nicogym") |> json_response(201)

    Application.put_env(:thirstr, :creator_page, fn "jff", _ ->
      {:ok, "<p>bio: hi " <> j["code"] <> "</p>"}
    end)

    assert %{"state" => "proven"} =
             authed(u) |> post("/v1/me/linked-accounts/#{j["id"]}/verify") |> json_response(200)
  end

  test "X: code in a public post, read via oEmbed", %{u: u} do
    x = add(u, "x", "https://x.com/MaxRuns") |> json_response(201)
    assert x["proof_method"] == "post_code"
    code = x["code"]

    Application.put_env(:thirstr, :x_oembed, fn
      "https://x.com/MaxRuns/status/111" ->
        %{"author_url" => "https://twitter.com/MaxRuns", "html" => "<p>proof " <> code <> "</p>"}

      _ ->
        %{"author_url" => "https://twitter.com/MaxRuns", "html" => "<p>hello</p>"}
    end)

    v = fn url ->
      authed(u) |> post("/v1/me/linked-accounts/#{x["id"]}/verify", %{post_url: url})
    end

    assert v.("https://example.com/MaxRuns/status/111") |> json_response(422)

    assert %{"error" => %{"code" => "x_wrong_author"}} =
             v.("https://x.com/someone/status/111") |> json_response(422)

    assert %{"state" => "unproven"} = v.("https://x.com/MaxRuns/status/222") |> json_response(200)

    assert %{"state" => "proven"} =
             v.("https://twitter.com/MaxRuns/status/111?s=20") |> json_response(200)

    assert [["maxruns", "post_code", "handle:maxruns"]] =
             Repo.query!(
               "SELECT handle, proof, platform_user_id FROM linked_accounts WHERE platform = 'x'"
             ).rows
  end

  test "store-review build and Safe Mode hide OnlyFans", %{
    u: u,
    conn: conn
  } do
    add(u, "onlyfans", "nicogym") |> json_response(201)
    add(u, "bluesky", "max.bsky.social") |> json_response(201)
    viewer = onboarded(conn)

    assert ["bluesky", "onlyfans"] =
             seen(viewer, u.pid) |> Enum.map(& &1["platform"]) |> Enum.sort()

    Flags.set("adult_links", true, %{"off_builds" => %{"ios" => [512]}})
    assert ["bluesky"] = seen(viewer, u.pid, &build(&1, 512)) |> Enum.map(& &1["platform"])
    assert 2 == length(seen(viewer, u.pid, &build(&1, 513)))

    cfg = build_conn() |> build(512) |> get("/v1/config") |> json_response(200)
    assert cfg["flags"]["adult_links"] == false

    assert %{"error" => %{"code" => "unavailable"}} =
             authed(u)
             |> build(512)
             |> post("/v1/me/linked-accounts", %{
               profile_id: u.pid,
               platform: "jff",
               handle: "nico"
             })
             |> json_response(422)

    Repo.query!("UPDATE accounts SET safe_mode = 'on' WHERE id = $1", [
      Ecto.UUID.dump!(account_of(u.pid).id)
    ])

    assert ["bluesky"] = seen(viewer, u.pid) |> Enum.map(& &1["platform"])
  end

  test "two impersonation reports take the ✓ off and hide the chip", %{u: u, conn: conn} do
    add(u, "x", "maxruns") |> json_response(201)
    [a, b] = [onboarded(conn), onboarded(conn)]

    for r <- [a, b] do
      recycle_authed(r.c)
      |> post("/v1/reports", %{
        profile_id: u.pid,
        reason: "impersonation",
        context: "profile",
        note: "linked:x"
      })
      |> json_response(201)
    end

    assert [] == seen(a, u.pid)
  end
end
