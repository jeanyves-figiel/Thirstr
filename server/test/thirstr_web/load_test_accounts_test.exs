defmodule ThirstrWeb.LoadTestAccountsTest do
  # SR-12 (#152): load accounts are verified, located and can chat; never on staging/prod.
  use ThirstrWeb.ConnCase, async: false

  test "users/1 returns working sessions; refused when DEPLOY_ENV is staging or prod", %{
    conn: conn
  } do
    [u, v] = Thirstr.LoadTest.users(2) |> Jason.decode!()
    assert u["pid"] && u["device"] && v["pid"]

    res =
      conn
      |> put_req_header("authorization", "Bearer " <> u["token"])
      |> get("/v1/explore/grid?mode=hookup")
      |> json_response(200)

    assert is_list(res["items"])

    body = %{
      from_profile_id: u["pid"],
      client_id: "loadtest-0001",
      group_id: Base.encode64(:crypto.strong_rand_bytes(32)),
      envelopes: [
        %{
          to_profile_id: v["pid"],
          to_device_id: v["device"],
          kind: "app",
          ciphertext: Base.encode64("x")
        }
      ]
    }

    conn
    |> recycle()
    |> put_req_header("authorization", "Bearer " <> u["token"])
    |> post("/v1/mls/messages", body)
    |> json_response(200)

    for env <- ~w(staging prod production) do
      System.put_env("DEPLOY_ENV", env)
      refute Thirstr.LoadTest.allowed?()
      assert_raise RuntimeError, fn -> Thirstr.LoadTest.users(1) end
    end
  after
    System.delete_env("DEPLOY_ENV")
  end
end
