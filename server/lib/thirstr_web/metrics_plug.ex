defmodule ThirstrWeb.MetricsPlug do
  @moduledoc "SR-07: Prometheus text exposition on the internal metrics port (6PN only, never public)."
  @behaviour Plug
  import Plug.Conn

  @impl true
  def init(opts), do: opts

  @impl true
  def call(%Plug.Conn{request_path: "/metrics"} = conn, _opts) do
    conn
    |> put_resp_content_type("text/plain; version=0.0.4")
    |> send_resp(200, TelemetryMetricsPrometheus.Core.scrape())
  end

  def call(conn, _opts), do: send_resp(conn, 404, "")
end
