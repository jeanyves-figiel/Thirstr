defmodule ThirstrWeb.FlagsTest do
  # EN-13 (#172) flags / kill switches, EN-14 (#173) minimum build + 426.
  use ThirstrWeb.ConnCase, async: false
  alias Thirstr.Flags

  setup do
    on_exit(fn -> :ets.delete(:thirstr_flags, :rows) end)
    :ets.delete(:thirstr_flags, :rows)
    :ok
  end

  defp client(conn, platform, build),
    do:
      conn
      |> put_req_header("x-thirstr-platform", platform)
      |> put_req_header("x-thirstr-build", to_string(build))
      |> put_req_header("x-thirstr-install", "inst-123456789012345")

  test "config lists default flags; a kill switch turns one off", %{conn: conn} do
    cfg = conn |> get("/v1/config") |> json_response(200)
    assert cfg["flags"]["video_check"] == true
    assert cfg["upgrade_required"] == false

    Flags.set("video_check", false, %{}, "kill")
    cfg = build_conn() |> get("/v1/config") |> json_response(200)
    assert cfg["flags"]["video_check"] == false
    refute Flags.enabled?("unknown_flag")
  end

  test "rules: platform, min build, percent" do
    Flags.set("new_thing", true, %{"platforms" => ["ios"], "min_build" => %{"ios" => 100}})
    assert Flags.enabled?("new_thing", Flags.ctx("ios", "120", "a"))
    refute Flags.enabled?("new_thing", Flags.ctx("ios", "99", "a"))
    refute Flags.enabled?("new_thing", Flags.ctx("android", "120", "a"))

    Flags.set("half", true, %{"percent" => 50})
    on = Enum.count(1..400, &Flags.enabled?("half", Flags.ctx("ios", "1", "inst-#{&1}")))
    assert on in 150..250

    assert Flags.enabled?("half", Flags.ctx("ios", "1", "inst-7")) ==
             Flags.enabled?("half", Flags.ctx("ios", "1", "inst-7"))
  end

  test "builds below the minimum get 426 except on config/health; no build header passes", %{
    conn: conn
  } do
    Flags.set("min_build", true, %{"ios" => 150})

    res = conn |> client("ios", 149) |> get("/v1/welcome")
    assert json_response(res, 426)["error"]["code"] == "upgrade_required"

    assert build_conn()
           |> client("ios", 149)
           |> get("/v1/config")
           |> json_response(200)
           |> Map.get("upgrade_required")

    assert build_conn() |> client("ios", 149) |> get("/v1/health") |> json_response(200)
    assert build_conn() |> client("ios", 150) |> get("/v1/welcome") |> json_response(200)
    assert build_conn() |> client("android", 1) |> get("/v1/welcome") |> json_response(200)
    assert build_conn() |> get("/v1/welcome") |> json_response(200)
  end
end
