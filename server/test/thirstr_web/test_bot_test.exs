defmodule ThirstrWeb.TestBotTest do
  use ThirstrWeb.ConnCase, async: false
  import Ecto.Query

  # testing.md › Chat test bot (#109)
  @key "test-bot-key-0123456789abcdef"

  setup do
    prev = Application.get_env(:thirstr, :testbot_key)
    on_exit(fn -> Application.put_env(:thirstr, :testbot_key, prev) end)
    :ok
  end

  @testbot %{
    handle: "testbot",
    name: "Testbot 🤖",
    seeded: true,
    server_location: %{lat: 47.3914, lng: 8.4887},
    fields: %{bio: "Write help."}
  }

  defp session(conn, key, persona \\ @testbot) do
    conn
    |> put_req_header("x-testbot-key", key)
    |> post("/v1/testbot/session", persona)
  end

  test "off without a key: 404", %{conn: conn} do
    Application.put_env(:thirstr, :testbot_key, nil)
    assert conn |> session(@key) |> json_response(404)
  end

  test "wrong key: 404", %{conn: conn} do
    Application.put_env(:thirstr, :testbot_key, @key)
    assert conn |> session("nope-nope-nope-nope-nope-nope") |> json_response(404)
  end

  test "never on in production", %{conn: conn} do
    Application.put_env(:thirstr, :testbot_key, @key)
    System.put_env("DEPLOY_ENV", "prod")
    on_exit(fn -> System.delete_env("DEPLOY_ENV") end)
    assert conn |> session(@key) |> json_response(404)
  end

  test "session: verified bot near Altstetten, visible in Explore, one device", %{conn: conn} do
    Application.put_env(:thirstr, :testbot_key, @key)
    s1 = conn |> session(@key) |> json_response(200)
    s2 = build_conn() |> session(@key) |> json_response(200)
    assert s1["profile_id"] == s2["profile_id"]

    %{rows: [[n_acc, n_dev]]} =
      Thirstr.Repo.query!("""
      SELECT (SELECT count(*) FROM accounts WHERE test_bot),
             (SELECT count(*) FROM devices d JOIN accounts a ON a.id = d.account_id WHERE a.test_bot)
      """)

    assert {n_acc, n_dev} == {1, 1}

    # the bot's own session works; the old one is gone
    bot = authed(build_conn(), s2["access_token"])
    me = bot |> get("/v1/me") |> json_response(200)
    assert me["verified"]
    assert me["profile"]["display_name"] =~ "Testbot"
    assert authed(build_conn(), s1["access_token"]) |> get("/v1/me") |> json_response(401)

    # a tester in Zurich sees it and can open its profile
    u = onboarded(build_conn())
    grid = u.c |> recycle_authed() |> get("/v1/explore/grid?mode=hookup") |> json_response(200)
    assert Enum.any?(grid["items"] || grid["profiles"] || [], &(&1["id"] == s2["profile_id"]))

    bot_pid = s2["profile_id"]
    view = u.c |> recycle_authed() |> get("/v1/profiles/#{bot_pid}") |> json_response(200)
    assert view["verified"]
  end

  test "several bots by handle; persona applied; bio always says test account", %{conn: conn} do
    Application.put_env(:thirstr, :testbot_key, @key)

    luca = %{
      handle: "luca",
      name: "Luca 🤖",
      age: 29,
      gender: "man",
      show_in: ["hookup", "nope"],
      here_for: ["hookup", "tonight"],
      settings: %{read_receipts: false, evil: true},
      fields: %{bio: "Ciao!", languages: ["it", "xx"], position: "vers", secret: "x"}
    }

    s = conn |> session(@key, luca) |> json_response(200)
    t = build_conn() |> session(@key) |> json_response(200)
    refute s["profile_id"] == t["profile_id"]

    me = authed(build_conn(), s["access_token"]) |> get("/v1/me") |> json_response(200)
    assert me["profile"]["display_name"] == "Luca 🤖"

    %{rows: [[show_in, fields, settings, handle]]} =
      Thirstr.Repo.query!(
        """
        SELECT p.show_in, p.fields, a.settings, a.test_bot_handle
        FROM profiles p JOIN accounts a ON a.id = p.account_id WHERE p.id = $1
        """,
        [Ecto.UUID.dump!(s["profile_id"])]
      )

    assert show_in == ["hookup"]
    assert handle == "luca"
    assert fields["bio"] =~ ~r/^TEST ACCOUNT/
    assert fields["languages"] == ["it"]
    assert fields["position"] == "vers"
    refute Map.has_key?(fields, "secret")
    assert settings["read_receipts"] == false
    refute Map.has_key?(settings, "evil")

    # persona update without a new session keeps the device
    keep = Map.put(luca, :new_session, false)
    again = build_conn() |> session(@key, keep) |> json_response(200)
    assert again == %{"profile_id" => s["profile_id"]}
    assert authed(build_conn(), s["access_token"]) |> get("/v1/me") |> json_response(200)

    # lost refresh token: resume keeps the same device (chats survive)
    aid = Thirstr.Repo.get!(Thirstr.Profiles.Profile, s["profile_id"]).account_id
    q = from(d in Thirstr.Accounts.Device, where: d.account_id == ^aid)
    devices = fn -> Thirstr.Repo.all(q) end
    [dev] = devices.()
    Thirstr.Accounts.revoke_device(dev.id)
    r = build_conn() |> session(@key, Map.put(luca, :resume, true)) |> json_response(200)
    assert r["profile_id"] == s["profile_id"]
    assert authed(build_conn(), r["access_token"]) |> get("/v1/me") |> json_response(200)
    assert [%{id: id, revoked_at: nil}] = devices.()
    assert id == dev.id

    assert build_conn() |> session(@key, %{handle: "Bad Handle!"}) |> json_response(422)
  end
end
