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

  @tiny "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAAUABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCnRRRXSbBRRRQB/9k="
  @big "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCABAAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCnRRRXSbBRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFAH/2Q=="

  defp main_photo(pid) do
    %{rows: [[id]]} =
      Thirstr.Repo.query!(
        "SELECT id::text FROM photos WHERE profile_id = $1 AND status = 'ok_main' ORDER BY slot LIMIT 1",
        [Ecto.UUID.dump!(pid)]
      )

    id
  end

  test "share link: page, renew, resolve, turn off", %{u: u, c: c} do
    %{"slug" => s1, "url" => url, "short" => short, "show_photo" => true, "has_preview" => false} =
      authed(u) |> post("/v1/me/profiles/#{u.pid}/share") |> json_response(200)

    assert s1 =~ ~r/^[a-km-np-z2-9]{10}$/
    assert url =~ "/p/" <> s1
    refute short =~ "://"
    page = c |> recycle() |> get("/p/#{s1}")
    assert html_response(page, 200) =~ "Chat me safely on Thirstr"
    refute page.resp_body =~ "<script"
    assert [csp] = get_resp_header(page, "content-security-policy")
    assert csp =~ "default-src 'none'"
    assert csp =~ "img-src 'self' data:;"
    refute csp =~ "unsafe-inline"
    assert ["no-referrer"] = get_resp_header(page, "referrer-policy")

    assert %{"profile_id" => pid, "own" => true} =
             authed(u) |> get("/v1/share/#{s1}") |> json_response(200)

    assert pid == u.pid

    %{"slug" => s2} = authed(u) |> post("/v1/me/profiles/#{u.pid}/share") |> json_response(200)
    assert s2 != s1
    dead = c |> recycle() |> get("/p/#{s1}") |> html_response(404)
    authed(u) |> delete("/v1/me/profiles/#{u.pid}/share") |> response(204)
    assert c |> recycle() |> get("/p/#{s2}") |> html_response(404) == dead
    assert c |> recycle() |> get("/p/nonexisten") |> html_response(404) == dead

    assert %{"share" => nil} =
             authed(u) |> get("/v1/me/profiles/#{u.pid}/share") |> json_response(200)
  end

  test "share page never leaks the photo, its URL or the profile id", %{u: u, c: c} do
    %{"slug" => s} = authed(u) |> post("/v1/me/profiles/#{u.pid}/share") |> json_response(200)
    html = c |> recycle() |> get("/p/#{s}") |> html_response(200)
    refute html =~ "<img"
    refute html =~ u.pid
    refute html =~ "X-Amz"
    refute html =~ "og:image"

    photo = main_photo(u.pid)

    authed(u)
    |> put("/v1/me/profiles/#{u.pid}/share/preview", %{photo_id: photo, jpeg_b64: @big})
    |> json_response(422)

    authed(u)
    |> put("/v1/me/profiles/#{u.pid}/share/preview", %{photo_id: photo, jpeg_b64: "aGVsbG8="})
    |> json_response(422)

    authed(u)
    |> put("/v1/me/profiles/#{u.pid}/share/preview", %{photo_id: photo, jpeg_b64: @tiny})
    |> response(204)

    html = c |> recycle() |> get("/p/#{s}") |> html_response(200)
    assert html =~ ~s(src="data:image/jpeg;base64,)
    refute html =~ "X-Amz"
    refute html =~ u.pid

    assert %{"show_photo" => false} =
             authed(u)
             |> patch("/v1/me/profiles/#{u.pid}/share", %{show_photo: false})
             |> json_response(200)

    refute c |> recycle() |> get("/p/#{s}") |> html_response(200) =~ "<img"

    authed(u)
    |> patch("/v1/me/profiles/#{u.pid}/share", %{show_photo: true})
    |> json_response(200)

    assert c |> recycle() |> get("/p/#{s}") |> html_response(200) =~ "<img"

    # main photo replaced → stale preview disappears
    Thirstr.Repo.query!("UPDATE photos SET status = 'ok_public' WHERE id = $1", [
      Ecto.UUID.dump!(photo)
    ])

    refute c |> recycle() |> get("/p/#{s}") |> html_response(200) =~ "<img"
  end

  test "share link: dead for paused accounts, hidden from blocked viewers", %{
    u: u,
    c: c,
    conn: conn
  } do
    other = onboarded(conn)
    %{"slug" => s} = authed(u) |> post("/v1/me/profiles/#{u.pid}/share") |> json_response(200)

    assert %{"own" => false} =
             other.c |> recycle_authed() |> get("/v1/share/#{s}") |> json_response(200)

    other.c |> recycle_authed() |> post("/v1/profiles/#{u.pid}/block") |> response(204)
    other.c |> recycle_authed() |> get("/v1/share/#{s}") |> json_response(404)
    authed(u) |> get("/v1/share/#{s}") |> json_response(200)

    Thirstr.Repo.query!(
      "UPDATE accounts SET status = 'paused' WHERE id = (SELECT account_id FROM profiles WHERE id = $1)",
      [Ecto.UUID.dump!(u.pid)]
    )

    assert c |> recycle() |> get("/p/#{s}") |> html_response(404) =~ "isn’t active"
  end

  test "share slugs come from the CSPRNG alphabet" do
    slugs = for _ <- 1..200, do: Thirstr.Linked.new_slug()
    assert Enum.all?(slugs, &(&1 =~ ~r/^[a-km-np-z2-9]{10}$/))
    assert length(Enum.uniq(slugs)) == 200
  end
end
