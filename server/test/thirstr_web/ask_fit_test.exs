defmodule ThirstrWeb.AskFitTest do
  # F-24 Ask, Fit & Picks (#338, D-27): Interests field, interests filter, Fit inputs on cards
  # for Plus viewers only, "Count me in others' Fit" opt-out. Scores live on the phone only.
  use ThirstrWeb.ConnCase, async: false
  alias Thirstr.Flags

  setup %{conn: conn} do
    :ets.delete(:thirstr_flags, :rows)
    on_exit(fn -> :ets.delete(:thirstr_flags, :rows) end)
    viewer = onboarded(conn)
    other = onboarded(conn, cell: zurich_ring(2), basics: [display_name: "Luca"])
    {:ok, viewer: viewer, other: other, conn: conn}
  end

  defp patch_fields(u, fields, vis \\ %{}),
    do:
      u.c
      |> recycle_authed()
      |> patch("/v1/me/profiles/#{u.pid}", %{fields: fields, visibility_map: vis})

  defp grid(c, q \\ ""),
    do: c |> recycle_authed() |> get("/v1/explore/grid?mode=hookup" <> q) |> json_response(200)

  defp card(res, pid), do: Enum.find(res["items"], &(&1["id"] == pid))

  test "profile options list interests in groups, max 12, unknown ids rejected", %{other: o} do
    opts = o.c |> recycle_authed() |> get("/v1/profile-options") |> json_response(200)
    assert "techno" in opts["options"]["interests"]
    assert %{"id" => "music", "interests" => ["techno" | _]} = hd(opts["interest_groups"])
    assert opts["defaults"]["interests"]["visibility"] == "public"
    assert opts["defaults"]["interests"]["lenses"] == ["hookup", "friends", "sport"]

    assert %{"error" => %{"code" => "validation"}} =
             patch_fields(o, %{interests: ["techno", "not_a_tag"]}) |> json_response(422)

    too_many = Enum.take(opts["options"]["interests"], 13)

    assert %{"error" => %{"code" => "validation"}} =
             patch_fields(o, %{interests: too_many}) |> json_response(422)

    p = patch_fields(o, %{interests: ["techno", "cooking"]}) |> json_response(200)
    assert p["fields"]["interests"] == ["techno", "cooking"]
  end

  test "Plus viewer gets Fit inputs on grid cards, never a score; pins carry none", %{
    viewer: v,
    other: o
  } do
    patch_fields(o, %{
      interests: ["techno", "cooking"],
      position: "vers_bottom",
      hosting: "can_host"
    })
    |> json_response(200)

    # closed beta: everyone is Plus (R-23.1)
    c = card(grid(v.c), o.pid)
    assert c["match"]["interests"] == ["techno", "cooking"]
    assert c["match"]["position"] == "vers_bottom"
    assert c["match"]["hosting"] == "can_host"
    refute Map.has_key?(c["match"], "hiv")
    refute Map.has_key?(c, "fit")
    refute Map.has_key?(c, "score")

    # Friends lens: no hookup fields in the match inputs (R-06.1b)
    f =
      v.c
      |> recycle_authed()
      |> get("/v1/explore/grid?mode=hookup&intents=friends")
      |> json_response(200)

    case card(f, o.pid) do
      nil -> :ok
      fc -> refute Map.has_key?(fc["match"] || %{}, "position")
    end
  end

  test "Free viewer gets no Fit inputs (Plus feature, D-27)", %{viewer: v, other: o} do
    patch_fields(o, %{interests: ["techno"]}) |> json_response(200)
    Flags.set("plus_billing", true, %{}, "test")
    refute Map.has_key?(card(grid(v.c), o.pid), "match")
  end

  test "Count me in others' Fit off: no Fit inputs on his card (R-24.15)", %{viewer: v, other: o} do
    patch_fields(o, %{interests: ["techno"]}) |> json_response(200)

    o.c
    |> recycle_authed()
    |> patch("/v1/me/settings", %{fit_visible: false})
    |> json_response(200)

    refute Map.has_key?(card(grid(v.c), o.pid), "match")
    seen = v.c |> recycle_authed() |> get("/v1/profiles/#{o.pid}") |> json_response(200)
    assert seen["fit_ok"] == false
  end

  test "interests is a free filter and respects visibility", %{viewer: v, other: o, conn: conn} do
    patch_fields(o, %{interests: ["techno", "cooking"]}) |> json_response(200)
    assert o.pid in ids(grid(v.c, "&interests=techno,opera")["items"])
    refute o.pid in ids(grid(v.c, "&interests=opera")["items"])

    Flags.set("plus_billing", true, %{}, "test")
    assert o.pid in ids(grid(v.c, "&interests=techno")["items"])

    # verified-only value: an unverified viewer can't find him by it
    patch_fields(o, %{}, %{interests: "verified"}) |> json_response(200)

    Thirstr.Repo.query!(
      "UPDATE accounts SET settings = '{\"hide_from_unverified\": false}' WHERE id = (SELECT account_id FROM profiles WHERE id = $1)",
      [Ecto.UUID.dump!(o.pid)]
    )

    u = onboarded(conn, verified: false)
    refute o.pid in ids(grid(u.c, "&interests=techno&verified_only=false")["items"])
  end
end
