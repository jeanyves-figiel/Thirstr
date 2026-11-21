defmodule ThirstrWeb.MemberPlacesTest do
  use ThirstrWeb.ConnCase, async: false

  alias Thirstr.Repo

  # #191 F-12 R-12.11: members add a place where they are and are checked in; live at once,
  # the team reviews after the fact (A-07b).
  setup %{conn: conn} do
    {:ok, host: onboarded(conn), guest: onboarded(conn, basics: [display_name: "Ben"])}
  end

  defp req(u, method, path, body \\ nil) do
    c = recycle_authed(u.c)

    case method do
      :get -> get(c, path)
      :post -> post(c, path, body || %{})
      :delete -> delete(c, path)
    end
  end

  @at %{lat: 47.37701, lng: 8.54183}
  defp add(u, name, extra \\ %{}),
    do:
      req(u, :post, "/v1/venues", Map.merge(%{name: name, kind: "bar"} |> Map.merge(@at), extra))

  @tag ac: "AC-12.3"
  test "added place is live for everyone and the creator is checked in", %{host: h, guest: g} do
    here = add(h, "  Café   Hinterhof ") |> json_response(200)
    assert here["venue"]["name"] == "Café Hinterhof"
    assert %{"member" => true, "mine" => true, "removable" => true} = here["venue"]
    id = here["venue"]["id"]

    assert [[47.37701, 8.54183, "member", false]] =
             Repo.query!(
               "SELECT lat, lng, added_by, hidden FROM venues WHERE id = $1",
               [Ecto.UUID.dump!(id)]
             ).rows

    %{"venues" => vs} = req(g, :get, "/v1/venues/nearby") |> json_response(200)
    assert %{"member" => true, "here" => "a_few"} = Enum.find(vs, &(&1["id"] == id))

    %{"places" => ps} =
      req(g, :get, "/v1/places?bbox=8.50,47.35,8.58,47.40") |> json_response(200)

    assert %{"source" => "member"} = Enum.find(ps, &(&1["id"] == id))

    # others check in without any review; the creator is never exposed
    there = req(g, :post, "/v1/venues/#{id}/checkin", %{}) |> json_response(200)
    assert %{"member" => true, "mine" => false, "removable" => false} = there["venue"]
    assert there["venue"] |> Map.keys() |> Enum.sort() == ~w(id kind member mine name removable)
  end

  test "similar name within 75 m offers the existing place", %{host: h, guest: g} do
    id = add(h, "Café Hinterhof") |> json_response(200) |> get_in(["venue", "id"])

    assert %{"error" => %{"code" => "place_exists", "existing" => %{"id" => ^id}}} =
             add(g, "cafe hinterhof", %{kind: "club", lat: 47.37741}) |> json_response(409)

    # a different name at the same spot is fine
    assert add(g, "Heldenbar") |> json_response(200)
  end

  test "must be there, valid fields, verified, 3 a day", %{host: h} do
    assert add(h, "Far away", %{lat: 47.45}) |> json_response(422)
    assert add(h, "X") |> json_response(422)
    assert add(h, "Call 0791234567") |> json_response(422)
    assert add(h, "Spot", %{kind: "home"}) |> json_response(422)
    assert add(h, "Spot", %{lat: nil}) |> json_response(422)

    for n <- ~w(Alpha Bravo Charlie), do: add(h, n) |> json_response(200)
    assert %{"error" => %{"fields" => %{"name" => [msg]}}} = add(h, "Delta") |> json_response(422)
    assert msg =~ "3 places a day"

    Repo.query!(
      "UPDATE accounts SET safe_mode = 'on' WHERE id = (SELECT account_id FROM profiles WHERE id = $1)",
      [Ecto.UUID.dump!(h.pid)]
    )

    Repo.query!("DELETE FROM venues")
    assert add(h, "Echo") |> json_response(422)
  end

  test "creator removes it only while nobody else is checked in", %{host: h, guest: g} do
    id = add(h, "Café Hinterhof") |> json_response(200) |> get_in(["venue", "id"])
    req(g, :post, "/v1/venues/#{id}/checkin", %{}) |> json_response(200)

    assert req(g, :delete, "/v1/venues/#{id}") |> json_response(403)
    assert req(h, :delete, "/v1/venues/#{id}") |> json_response(409)

    req(g, :post, "/v1/venues/checkout") |> response(204)
    assert req(h, :delete, "/v1/venues/#{id}") |> response(204)
    assert Repo.query!("SELECT count(*) FROM venues").rows == [[0]]
  end

  test "hidden by the team: not listed, no check-in", %{host: h, guest: g} do
    id = add(h, "Café Hinterhof") |> json_response(200) |> get_in(["venue", "id"])
    :ok = Thirstr.Places.set_hidden(id, true)

    %{"venues" => vs} = req(g, :get, "/v1/venues/nearby") |> json_response(200)
    refute Enum.any?(vs, &(&1["id"] == id))
    assert req(g, :post, "/v1/venues/#{id}/checkin", %{}) |> json_response(404)
    assert [[_, "Café Hinterhof" | _]] = Thirstr.Places.member_places()
  end
end
