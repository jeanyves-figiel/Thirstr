defmodule ThirstrWeb.ProbeTest do
  # EN-23 OB-2 (#343): synthetic chat probe accounts and report.
  use ThirstrWeb.ConnCase, async: false

  @key String.duplicate("k", 40)

  setup do
    Application.put_env(:thirstr, :probe_key, @key)
    on_exit(fn -> Application.delete_env(:thirstr, :probe_key) end)
  end

  def forward(event, m, meta, pid), do: send(pid, {:tm, event, m, meta})

  defp session(conn, handle, extra \\ %{}) do
    conn
    |> put_req_header("x-probe-key", @key)
    |> post("/v1/probe/session", Map.put(extra, "handle", handle))
  end

  defp as(conn, token),
    do: conn |> recycle() |> put_req_header("authorization", "Bearer " <> token)

  @tag ac: "EN-23 OB-2"
  test "wrong or missing key → 404", %{conn: conn} do
    assert conn |> post("/v1/probe/session", %{handle: "probe_a"}) |> response(404)

    assert conn
           |> put_req_header("x-probe-key", "nope")
           |> post("/v1/probe/report", %{ok: true})
           |> response(404)
  end

  @tag ac: "EN-23 OB-2"
  test "fresh devices each run; probes reach only each other", %{conn: conn} do
    a = session(conn, "probe_a") |> json_response(200)
    b = session(conn, "probe_b", %{"devices" => 2}) |> json_response(200)
    assert length(b["sessions"]) == 2
    [%{"access_token" => _}] = a["sessions"]
    [%{"access_token" => tb, "device_id" => db} | _] = b["sessions"]

    # again: same profile, old devices gone
    a2 = session(conn, "probe_a") |> json_response(200)
    assert a2["profile_id"] == a["profile_id"]
    [%{"access_token" => ta}] = a2["sessions"]

    as(conn, tb)
    |> post("/v1/mls/keypackages", %{
      profile_id: b["profile_id"],
      key_packages: [Base.encode64("kp")]
    })
    |> json_response(200)

    assert %{"key_packages" => [_]} =
             as(conn, ta)
             |> post("/v1/mls/keypackages/claim", %{
               from_profile_id: a["profile_id"],
               to_profile_id: b["profile_id"]
             })
             |> json_response(200)

    # a member can't reach a probe, and a probe can't reach a member
    u = onboarded(conn)

    assert u.c
           |> recycle_authed()
           |> post("/v1/mls/keypackages/claim", %{
             from_profile_id: u.pid,
             to_profile_id: b["profile_id"]
           })
           |> json_response(409)

    assert as(conn, ta)
           |> post("/v1/mls/keypackages/claim", %{
             from_profile_id: a["profile_id"],
             to_profile_id: u.pid
           })
           |> json_response(409)

    %{rows: [[udev]]} =
      Thirstr.Repo.query!(
        "SELECT d.id::text FROM devices d JOIN profiles p ON p.account_id = d.account_id WHERE p.id = $1 LIMIT 1",
        [Ecto.UUID.dump!(u.pid)]
      )

    res =
      as(conn, ta)
      |> post("/v1/mls/messages", %{
        from_profile_id: a["profile_id"],
        group_id: Base.encode64("g"),
        envelopes: [
          %{
            to_profile_id: u.pid,
            to_device_id: udev,
            kind: "app",
            ciphertext: Base.encode64("x")
          },
          %{
            to_profile_id: b["profile_id"],
            to_device_id: db,
            kind: "app",
            ciphertext: Base.encode64("y")
          }
        ]
      })
      |> json_response(200)

    assert res["delivered"] == [b["profile_id"]] and res["undelivered"] == [u.pid]
  end

  @tag ac: "EN-23 OB-2"
  test "report becomes probe metrics", %{conn: conn} do
    id = "probe-#{System.unique_integer()}"

    :telemetry.attach_many(
      id,
      [[:thirstr, :probe, :run], [:thirstr, :probe, :step]],
      &__MODULE__.forward/4,
      self()
    )

    on_exit(fn -> :telemetry.detach(id) end)

    conn
    |> put_req_header("x-probe-key", @key)
    |> post("/v1/probe/report", %{
      ok: false,
      failed: "socket",
      steps: %{send: 118, socket: nil, bogus: 5}
    })
    |> response(204)

    assert_receive {:tm, [:thirstr, :probe, :step], %{duration_ms: 118}, %{step: "send"}}
    refute_receive {:tm, [:thirstr, :probe, :step], _, %{step: "bogus"}}
    assert_receive {:tm, [:thirstr, :probe, :run], _, %{result: "fail", failed: "socket"}}
  end
end
