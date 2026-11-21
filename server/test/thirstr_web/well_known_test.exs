defmodule ThirstrWeb.WellKnownTest do
  use ThirstrWeb.ConnCase, async: false

  setup do
    prev = Application.get_env(:thirstr, :apple_app_ids)
    on_exit(fn -> Application.put_env(:thirstr, :apple_app_ids, prev) end)
  end

  test "AASA is 404 until a team is configured", %{conn: conn} do
    Application.put_env(:thirstr, :apple_app_ids, [])
    assert conn |> get("/.well-known/apple-app-site-association") |> response(404)
  end

  test "AASA lists webcredentials app ids", %{conn: conn} do
    Application.put_env(:thirstr, :apple_app_ids, ["ABCDE12345.app.thirstr"])
    body = conn |> get("/.well-known/apple-app-site-association") |> json_response(200)
    assert body["webcredentials"] == %{"apps" => ["ABCDE12345.app.thirstr"]}
    assert [%{"components" => [%{"/" => "/p/*"}]}] = body["applinks"]["details"]
  end
end
