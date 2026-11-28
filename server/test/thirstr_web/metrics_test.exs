defmodule ThirstrWeb.MetricsTest do
  # SR-07 (#147): content-free Prometheus metrics.
  use ThirstrWeb.ConnCase, async: false

  test "scrape exposes backlog, Oban and push metrics, nothing identifying", %{conn: conn} do
    u = onboarded(conn)
    ThirstrWeb.Telemetry.measure_backlog()
    :telemetry.execute([:thirstr, :push, :send], %{count: 1}, %{platform: "ios", outcome: :ok})
    # EN-23 OB-1
    Thirstr.Delivery.send_result("stored")
    Thirstr.Delivery.delivered("socket", true, 420)
    Thirstr.Delivery.measure()

    resp =
      Plug.Test.conn(:get, "/metrics") |> ThirstrWeb.MetricsPlug.call([])

    assert resp.status == 200
    assert resp.resp_body =~ "thirstr_chat_backlog_count"
    assert resp.resp_body =~ "thirstr_db_size_bytes"
    assert resp.resp_body =~ ~s(thirstr_push_send_count{outcome="ok",platform="ios"})
    refute resp.resp_body =~ u.pid
    refute resp.resp_body =~ ~r/\w_id="/
    assert resp.resp_body =~ ~s(thirstr_chat_send_count{result="stored"})

    assert resp.resp_body =~
             ~s(thirstr_chat_delivery_duration_ms_bucket{path="socket",recipient="online",le="500"})

    assert resp.resp_body =~ "thirstr_chat_stuck_online"
    assert (Plug.Test.conn(:get, "/") |> ThirstrWeb.MetricsPlug.call([])).status == 404
  end
end
