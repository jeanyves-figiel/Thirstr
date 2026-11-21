defmodule ThirstrWeb.AccountDataTest do
  use ThirstrWeb.ConnCase, async: false

  # B4d: export, linked devices, linked accounts, share links.
  setup %{conn: conn} do
    {:ok, u: onboarded(conn), c: conn}
  end

  defp authed(u), do: recycle_authed(u.c)

  test "export returns the archive JSON for my own data only", %{u: u, conn: conn} do
    other = onboarded(conn)
    body = authed(u) |> get("/v1/account/export") |> json_response(200)
    assert body["format"] == "thirstr-export/1"
    assert body["account"]["id"]
    assert [%{"id" => pid}] = body["data"]["profiles"]
    assert pid == u.pid
    refute Enum.any?(body["data"]["photos"], &(&1["profile_id"] == other.pid))
    assert [%{"url" => "http" <> _}] = body["data"]["photos"]
  end

  test "device link: claim → confirm → session for a second device", %{u: u, c: c} do
    %{"code" => code} = authed(u) |> post("/v1/devices/link") |> json_response(200)

    assert %{"state" => "pending"} =
             authed(u) |> get("/v1/devices/link/#{code}") |> json_response(200)

    %{"claim" => claim} =
      c
      |> recycle()
      |> post("/v1/auth/device-link", %{code: code, platform: "ios"})
      |> json_response(202)

    # a second claim on the same code fails
    assert c |> recycle() |> post("/v1/auth/device-link", %{code: code}) |> json_response(404)

    assert c
           |> recycle()
           |> post("/v1/auth/device-link", %{code: code, claim: claim})
           |> json_response(202)

    assert %{"state" => "claimed", "platform" => "ios"} =
             authed(u) |> get("/v1/devices/link/#{code}") |> json_response(200)

    authed(u) |> post("/v1/devices/link/#{code}/confirm") |> response(204)

    s =
      c
      |> recycle()
      |> post("/v1/auth/device-link", %{code: code, claim: claim})
      |> json_response(200)

    assert is_binary(s["access_token"])

    assert c
           |> recycle()
           |> post("/v1/auth/device-link", %{code: code, claim: claim})
           |> json_response(404)

    devs = (authed(u) |> get("/v1/me/devices") |> json_response(200))["devices"]
    assert length(devs) == 2
    new = Enum.find(devs, &(not &1["current"]))
    authed(u) |> delete("/v1/me/devices/#{new["id"]}") |> response(204)
    assert length((authed(u) |> get("/v1/me/devices") |> json_response(200))["devices"]) == 1
  end

  test "linked accounts: bluesky bio code proves, visibility filters the profile view", %{
    u: u,
    conn: conn
  } do
    r =
      authed(u)
      |> post("/v1/me/linked-accounts", %{
        profile_id: u.pid,
        platform: "bluesky",
        handle: "@Max.bsky.social"
      })
      |> json_response(201)

    assert r["proof_method"] == "bio_code"
    Application.put_env(:thirstr, :bluesky_bio, fn "max.bsky.social" -> "hi " <> r["code"] end)
    on_exit(fn -> Application.delete_env(:thirstr, :bluesky_bio) end)

    assert %{"verified" => true} =
             authed(u) |> post("/v1/me/linked-accounts/#{r["id"]}/verify") |> json_response(200)

    authed(u)
    |> post("/v1/me/linked-accounts", %{
      profile_id: u.pid,
      platform: "x",
      handle: "maxx",
      visibility: "everyone"
    })
    |> json_response(201)

    viewer = onboarded(conn)

    seen =
      (recycle_authed(viewer.c)
       |> get("/v1/profiles/#{u.pid}")
       |> json_response(200))["linked_accounts"]

    # bluesky is "My chats" by default → hidden from a stranger; x is everyone
    assert [%{"platform" => "x", "verified" => false, "url" => "https://x.com/maxx"}] = seen

    authed(u)
    |> patch("/v1/me/linked-accounts/#{r["id"]}", %{visibility: "verified"})
    |> response(204)

    seen =
      (recycle_authed(viewer.c)
       |> get("/v1/profiles/#{u.pid}")
       |> json_response(200))["linked_accounts"]

    assert Enum.any?(seen, &(&1["platform"] == "bluesky" and &1["verified"]))

    assert recycle_authed(viewer.c)
           |> delete("/v1/me/linked-accounts/#{r["id"]}")
           |> json_response(404)
  end

  test "share link: page, rotate, resolve, turn off", %{u: u, c: c} do
    %{"slug" => s1, "url" => url} =
      authed(u) |> post("/v1/me/profiles/#{u.pid}/share") |> json_response(200)

    assert url =~ "/p/" <> s1
    page = c |> recycle() |> get("/p/#{s1}")
    assert html_response(page, 200) =~ "Chat me safely on Thirstr"
    refute page.resp_body =~ "<script"
    assert %{"profile_id" => pid} = authed(u) |> get("/v1/share/#{s1}") |> json_response(200)
    assert pid == u.pid

    %{"slug" => s2} = authed(u) |> post("/v1/me/profiles/#{u.pid}/share") |> json_response(200)
    assert s2 != s1
    assert c |> recycle() |> get("/p/#{s1}") |> html_response(404)
    authed(u) |> delete("/v1/me/profiles/#{u.pid}/share") |> response(204)
    assert c |> recycle() |> get("/p/#{s2}") |> html_response(404)

    assert %{"share" => nil} =
             authed(u) |> get("/v1/me/profiles/#{u.pid}/share") |> json_response(200)
  end
end
