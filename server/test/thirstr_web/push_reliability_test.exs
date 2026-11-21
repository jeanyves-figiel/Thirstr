defmodule ThirstrWeb.PushReliabilityTest do
  # SR-02 (#142) push retries / Android-safe, SR-11 (#151) Valkey fallback.
  use ThirstrWeb.ConnCase, async: false
  use Oban.Testing, repo: Thirstr.Repo

  alias Thirstr.{Push, Repo}

  setup %{conn: conn} do
    u = onboarded(conn)
    acc = account_of(u.pid)

    prev = {Application.get_env(:thirstr, :apns), Application.get_env(:thirstr, :push_req)}
    Application.put_env(:thirstr, :apns, mock_url: "http://push.test/apns")
    Application.put_env(:thirstr, :push_req, plug: {Req.Test, Push})

    on_exit(fn ->
      Application.put_env(:thirstr, :apns, elem(prev, 0))
      Application.put_env(:thirstr, :push_req, elem(prev, 1))
    end)

    {:ok, acc: acc}
  end

  defp token!(acc, platform, token) do
    Repo.query!(
      "UPDATE devices SET push_token = $1, push_platform = $2 WHERE account_id = $3",
      [token, platform, Ecto.UUID.dump!(acc.id)]
    )
  end

  defp stub(status), do: Req.Test.stub(Push, &Plug.Conn.send_resp(&1, status, "{}"))

  test "APNs 5xx / 429 → job returns an error so Oban retries; 200 → ok", %{acc: acc} do
    token!(acc, "ios", String.duplicate("ab", 32))

    stub(503)

    assert {:error, :retry} =
             perform_job(Thirstr.Jobs.PushWake, %{account_id: acc.id, event: "message.new"})

    stub(429)
    assert {:error, :retry} = Push.deliver(acc.id, "message.new")
    stub(200)
    assert :ok = perform_job(Thirstr.Jobs.PushWake, %{account_id: acc.id, event: "message.new"})
  end

  test "network error is retried", %{acc: acc} do
    token!(acc, "ios", String.duplicate("ab", 32))
    Req.Test.stub(Push, &Req.Test.transport_error(&1, :econnrefused))
    assert {:error, :retry} = Push.deliver(acc.id, "message.new")
  end

  test "an Android device without FCM config is skipped, never crashes", %{acc: acc} do
    token!(acc, "android", String.duplicate("cd", 32))
    assert :ok = Push.deliver(acc.id, "message.new")
  end

  test "FCM payload is content-free (AC-16.1)" do
    m = Push.fcm_message("tok", false)["message"]
    assert m["notification"] == %{"title" => "Thirstr", "body" => "New activity"}
    assert Map.keys(m["data"]) == ["t"]
    assert Push.fcm_message("tok", true)["message"]["notification"]["title"] == "Reminder"
  end

  test "backoff: 5 s, 15 s, 45 s, 2 min" do
    assert Enum.map(1..5, &Thirstr.Jobs.PushWake.backoff(%Oban.Job{attempt: &1})) ==
             [5, 15, 45, 120, 120]
  end

  test "SR-11: rate limits and push wakes keep working while Valkey is down", %{acc: acc} do
    :ok = Supervisor.terminate_child(Thirstr.Supervisor, Thirstr.Valkey)

    try do
      assert {:ok, 1} = Thirstr.Valkey.hit("rl:test:" <> acc.id, 2, 60)
      assert {:ok, 2} = Thirstr.Valkey.hit("rl:test:" <> acc.id, 2, 60)
      assert {:error, :rate_limited, _} = Thirstr.Valkey.hit("rl:test:" <> acc.id, 2, 60)
      assert :ok = Push.maybe_wake(acc.id, "message.new")
      assert_enqueued(worker: Thirstr.Jobs.PushWake, args: %{account_id: acc.id})
    after
      {:ok, _} = Supervisor.restart_child(Thirstr.Supervisor, Thirstr.Valkey)
    end
  end
end
