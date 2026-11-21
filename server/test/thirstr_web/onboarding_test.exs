defmodule ThirstrWeb.OnboardingTest do
  use ThirstrWeb.ConnCase, async: false
  alias Thirstr.Repo

  setup %{conn: conn} do
    Thirstr.Seeds.run(30)
    {c, _} = sign_up(conn)
    {:ok, c: c}
  end

  test "full flow basics → location → photo → verify later (S-03…S-06)", %{c: c, conn: conn} do
    me = c |> basics() |> json_response(200)
    assert me["onboarding_step"] == "location"
    assert me["profile"]["age"] == 24 or me["profile"]["age"] == 25
    assert me["profile"]["here_for"] == ["hookup", "tonight"]

    me =
      c
      |> recycle_authed()
      |> put("/v1/me/location", %{level: "area", cell_r9: zurich_r9()})
      |> json_response(200)

    assert me["onboarding_step"] == "photo"
    assert me["location"]["level"] == "area"
    # R-04.13: own coarse cell returned for map centring.
    assert me["location"]["cell_r5"] =~ ~r/^85[0-9a-f]{13}$/

    pid = me["profile"]["id"]

    up =
      c
      |> recycle_authed()
      |> post("/v1/me/profiles/#{pid}/photos", %{slot: 0, content_type: "image/jpeg"})
      |> json_response(201)

    assert up["put_url"] =~ "X-Amz-Signature"
    # SR-10: card-size copy uploaded next to the photo
    assert up["thumb_put_url"] =~ "-t?"

    res =
      c
      |> recycle_authed()
      |> post("/v1/me/profiles/#{pid}/photos/#{up["photo_id"]}/check")
      |> json_response(200)

    assert res["photo"]["status"] == "ok_main"
    assert res["photo"]["thumb_url"] =~ "-t?"
    assert res["account"]["onboarding_step"] == "verify"

    me = c |> recycle_authed() |> post("/v1/me/onboarding/verify_later") |> json_response(200)
    assert me["onboarding_step"] == "done"
    refute me["verified"]

    # never leaks internal ids or birthdate
    body = c |> recycle_authed() |> get("/v1/me") |> response(200)
    refute body =~ "birthdate"
    _ = conn
  end

  @tag ac: "AC-02.3"
  test "under-18 birthday deletes the account and flags the install (R-02.3)", %{c: c, conn: conn} do
    young = Date.utc_today() |> Date.add(-17 * 365) |> Date.to_iso8601()

    assert %{"error" => %{"code" => "underage"}} =
             c |> basics(%{birthdate: young}) |> json_response(403)

    assert Repo.aggregate("accounts", :count) == 30

    t = Thirstr.Auth.OIDC.dev_mint("retry")

    assert %{"error" => %{"code" => "underage"}} =
             conn
             |> recycle()
             |> put_req_header("x-thirstr-install", "test-install-0123456789")
             |> post("/v1/auth/oidc", %{provider: "apple", id_token: t, age_confirmed: true})
             |> json_response(403)
  end

  describe "required-fields.md (owner decisions 2026-11-18)" do
    test "RF-1 name max 20", %{c: c} do
      assert %{"error" => %{"fields" => %{"display_name" => _}}} =
               c |> basics(%{display_name: String.duplicate("a", 21)}) |> json_response(422)

      assert c
             |> recycle_authed()
             |> basics(%{display_name: String.duplicate("a", 20)})
             |> json_response(200)
    end

    test "RF-3 I am is optional: skipped or prefer not to say = unspecified", %{c: c} do
      me = c |> basics(%{gender: nil}) |> json_response(200)
      assert me["profile"]["gender"] == "unspecified"

      me = c |> recycle_authed() |> basics(%{gender: "unspecified"}) |> json_response(200)
      assert me["profile"]["gender"] == "unspecified"
    end

    test "RF-6 main photo later: moves on, invisible, ring counts basics (RF-12)", %{c: c} do
      me = c |> basics() |> json_response(200)
      assert me["profile"]["completeness"] == 20

      c
      |> recycle_authed()
      |> put("/v1/me/location", %{level: "area", cell_r9: zurich_r9()})
      |> json_response(200)

      me = c |> recycle_authed() |> post("/v1/me/onboarding/photo_later") |> json_response(200)
      assert me["onboarding_step"] == "verify"
      assert me["profile"]["photos"] == []

      assert %{"error" => %{"code" => "conflict"}} =
               c
               |> recycle_authed()
               |> post("/v1/me/onboarding/photo_later")
               |> json_response(409)
    end
  end

  test "basics validation (R-02.4)", %{c: c} do
    assert %{"error" => %{"fields" => f}} =
             c |> basics(%{gender: "other", display_name: ""}) |> json_response(422)

    assert Map.has_key?(f, "display_name") and Map.has_key?(f, "gender_other")
  end

  test "Hidden needs verification; City via picker (R-02.6, S-04b)", %{c: c} do
    c |> basics() |> json_response(200)

    assert c
           |> recycle_authed()
           |> put("/v1/me/location", %{level: "hidden"})
           |> json_response(403)

    assert c
           |> recycle_authed()
           |> put("/v1/me/location", %{level: "area", cell_r9: "8928308280fffff0"})
           |> json_response(422)

    %{"cities" => [city | _]} =
      c |> recycle_authed() |> get("/v1/cities?q=zur") |> json_response(200)

    assert city["name"] in ["Zurich", "Zürich"]

    me =
      c
      |> recycle_authed()
      |> put("/v1/me/location", %{level: "city", city_id: city["id"]})
      |> json_response(200)

    assert me["location"]["level"] == "city"
  end

  test "main photo rejected when too explicit (R-02.7)", %{c: c} do
    me = c |> basics() |> json_response(200)
    pid = me["profile"]["id"]

    up =
      c
      |> recycle_authed()
      |> post("/v1/me/profiles/#{pid}/photos", %{slot: 0})
      |> json_response(201)

    Repo.query!("UPDATE photos SET storage_key = storage_key || '-explicit' WHERE id = $1", [
      Ecto.UUID.dump!(up["photo_id"])
    ])

    res =
      c
      |> recycle_authed()
      |> post("/v1/me/profiles/#{pid}/photos/#{up["photo_id"]}/check")
      |> json_response(200)

    assert res["photo"]["status"] == "rejected"
    assert res["photo"]["reject_reason"] == "too_explicit"
    assert res["account"]["onboarding_step"] == "location"
  end

  test "welcome counts never expose profiles; rounding rule (R-02.2)", %{conn: conn} do
    body = conn |> get("/v1/welcome") |> json_response(200)
    assert body["city"] in ["Zurich", "Zürich"]
    assert Enum.all?(body["cells"], &(Map.keys(&1) |> Enum.sort() == ["cell", "count"]))
    assert Thirstr.Location.display_count(9) == nil
    assert Thirstr.Location.display_count(57) == 50
    assert Thirstr.Location.display_count(123) == 123
  end
end
