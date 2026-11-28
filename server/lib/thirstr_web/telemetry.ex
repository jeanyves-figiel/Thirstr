defmodule ThirstrWeb.Telemetry do
  use Supervisor
  import Telemetry.Metrics

  def start_link(arg) do
    Supervisor.start_link(__MODULE__, arg, name: __MODULE__)
  end

  @impl true
  def init(_arg) do
    # SR-07 (#147): Prometheus metrics on an internal port (Fly [metrics] scrapes it; never
    # public). Content-free: counts, ages and durations only, no ids or pairs.
    children =
      [
        {:telemetry_poller, measurements: periodic_measurements(), period: 30_000},
        # EN-17: retention probes, every 5 min
        Supervisor.child_spec(
          {:telemetry_poller,
           measurements: [{Thirstr.Retention, :measure, []}],
           period: 300_000,
           name: :thirstr_retention_poller},
          id: :thirstr_retention_poller
        ),
        # DB-06 (#333): Postgres health gauges, every 60 s
        # EN-23 OB-1 (#343): live sockets + messages stuck for online devices, every 60 s
        Supervisor.child_spec(
          {:telemetry_poller,
           measurements: [{Thirstr.Delivery, :measure, []}],
           period: 60_000,
           name: :thirstr_delivery_poller},
          id: :thirstr_delivery_poller
        ),
        Supervisor.child_spec(
          {:telemetry_poller,
           measurements: [{Thirstr.DbHealth, :measure, []}],
           period: 60_000,
           name: :thirstr_db_health_poller},
          id: :thirstr_db_health_poller
        ),
        {TelemetryMetricsPrometheus.Core, metrics: prometheus_metrics()}
      ] ++ metrics_server()

    Supervisor.init(children, strategy: :one_for_one)
  end

  def metrics do
    [
      # Phoenix Metrics
      summary("phoenix.endpoint.start.system_time",
        unit: {:native, :millisecond}
      ),
      summary("phoenix.endpoint.stop.duration",
        unit: {:native, :millisecond}
      ),
      summary("phoenix.router_dispatch.start.system_time",
        tags: [:route],
        unit: {:native, :millisecond}
      ),
      summary("phoenix.router_dispatch.exception.duration",
        tags: [:route],
        unit: {:native, :millisecond}
      ),
      summary("phoenix.router_dispatch.stop.duration",
        tags: [:route],
        unit: {:native, :millisecond}
      ),
      summary("phoenix.socket_connected.duration",
        unit: {:native, :millisecond}
      ),
      summary("phoenix.channel_joined.duration",
        unit: {:native, :millisecond}
      ),
      summary("phoenix.channel_handled_in.duration",
        tags: [:event],
        unit: {:native, :millisecond}
      ),

      # Database Metrics
      summary("thirstr.repo.query.total_time",
        unit: {:native, :millisecond},
        description: "The sum of the other measurements"
      ),
      summary("thirstr.repo.query.decode_time",
        unit: {:native, :millisecond},
        description: "The time spent decoding the data received from the database"
      ),
      summary("thirstr.repo.query.query_time",
        unit: {:native, :millisecond},
        description: "The time spent executing the query"
      ),
      summary("thirstr.repo.query.queue_time",
        unit: {:native, :millisecond},
        description: "The time spent waiting for a database connection"
      ),
      summary("thirstr.repo.query.idle_time",
        unit: {:native, :millisecond},
        description:
          "The time the connection spent waiting before being checked out for the query"
      ),

      # VM Metrics
      summary("vm.memory.total", unit: {:byte, :kilobyte}),
      summary("vm.total_run_queue_lengths.total"),
      summary("vm.total_run_queue_lengths.cpu"),
      summary("vm.total_run_queue_lengths.io")
    ]
  end

  defp metrics_server do
    case Application.get_env(:thirstr, :metrics_port) do
      nil ->
        []

      port ->
        [
          {Bandit,
           plug: ThirstrWeb.MetricsPlug,
           port: port,
           ip: {0, 0, 0, 0, 0, 0, 0, 0},
           thousand_island_options: [num_acceptors: 2]}
        ]
    end
  end

  # 300 and 500 are SLO thresholds (docs/spec/slos.md › SLO-3/4).
  @ms_buckets [5, 10, 25, 50, 100, 250, 300, 500, 1000, 2500, 5000, 10_000]
  # EN-23: 1000 = SLO-7 threshold (online delivery); long tail = offline recipients.
  @delivery_buckets [
    100,
    250,
    500,
    1000,
    2500,
    5000,
    15_000,
    60_000,
    600_000,
    3_600_000,
    86_400_000
  ]
  @wake_buckets [1000, 2500, 5000, 10_000, 30_000, 60_000, 300_000, 900_000]

  @doc "Metrics exported to Prometheus (SR-07). Alert rules: docs/runbooks/monitoring.md."
  def prometheus_metrics do
    [
      distribution("phoenix.router_dispatch.stop.duration",
        tags: [:route, :status],
        tag_values: &route_status/1,
        unit: {:native, :millisecond},
        reporter_options: [buckets: @ms_buckets]
      ),
      counter("phoenix.router_dispatch.exception.count", tags: [:route]),
      counter("phoenix.socket_connected.count", tags: [:result], tag_values: &socket_result/1),
      distribution("thirstr.repo.query.total_time",
        unit: {:native, :millisecond},
        reporter_options: [buckets: @ms_buckets]
      ),
      distribution("thirstr.repo.query.queue_time",
        unit: {:native, :millisecond},
        reporter_options: [buckets: @ms_buckets]
      ),
      last_value("vm.memory.total", unit: :byte),
      last_value("vm.total_run_queue_lengths.total"),
      last_value("vm.system_counts.process_count"),
      counter("oban.job.stop.count", tags: [:worker, :state], tag_values: &oban_tags/1),
      counter("oban.job.exception.count", tags: [:worker], tag_values: &oban_tags/1),
      distribution("oban.job.stop.duration",
        tags: [:worker],
        tag_values: &oban_tags/1,
        unit: {:native, :millisecond},
        reporter_options: [buckets: @ms_buckets]
      ),
      last_value("thirstr.oban.jobs.count", tags: [:queue, :state]),
      last_value("thirstr.oban.jobs.oldest_available_s", tags: [:queue]),
      last_value("thirstr.chat.backlog.count"),
      last_value("thirstr.chat.backlog.oldest_s"),
      counter("thirstr.push.send.count", tags: [:platform, :outcome]),
      counter("thirstr.client.error.count", tags: [:platform, :fatal]),
      counter("thirstr.client.session.count", tags: [:platform]),
      counter("thirstr.valkey.fallback.count"),
      last_value("thirstr.db.size_bytes"),
      last_value("thirstr.retention.overdue", tags: [:rule]),
      # DB-06 (#333): docs/spec/db-integrity.md › 3
      last_value("thirstr.db_health.xid_age"),
      last_value("thirstr.db_health.longest_xact_s"),
      last_value("thirstr.db_health.connections_ratio"),
      last_value("thirstr.db_health.invalid_indexes"),
      last_value("thirstr.db_health.checksum_failures"),
      last_value("thirstr.db_health.checksums_on"),
      last_value("thirstr.db_health.archive_age_s"),
      last_value("thirstr.db_health.archive_failing"),
      last_value("thirstr.db_health.dead_ratio", tags: [:table]),
      last_value("thirstr.db_maint.age_s", tags: [:key]),
      last_value("thirstr.db_maint.ok", tags: [:key]),
      # EN-23 OB-1 (#343): docs/spec/delivery-latency-monitoring.md › OB-1
      counter("thirstr.chat.send.count", tags: [:result]),
      sum("thirstr.chat.envelope.count", tags: [:kind, :path]),
      distribution("thirstr.chat.delivery.duration_ms",
        tags: [:path, :recipient],
        reporter_options: [buckets: @delivery_buckets]
      ),
      sum("thirstr.chat.skipped.count"),
      sum("thirstr.chat.expired.count", tags: [:kind]),
      last_value("thirstr.chat.stuck_online"),
      last_value("thirstr.socket.live"),
      distribution("thirstr.socket.join.duration_ms",
        tags: [:env],
        reporter_options: [buckets: @ms_buckets]
      ),
      counter("thirstr.socket.close.count", tags: [:reason]),
      distribution("thirstr.push.provider.duration_ms",
        tags: [:platform, :outcome],
        reporter_options: [buckets: @ms_buckets]
      ),
      distribution("thirstr.push.wake.duration_ms",
        tags: [:platform],
        reporter_options: [buckets: @wake_buckets]
      ),
      counter("thirstr.push.wake_result.count", tags: [:platform, :result])
    ]
  end

  defp socket_result(m), do: %{result: m[:result]}

  defp route_status(%{conn: conn} = m), do: %{route: m[:route] || "?", status: conn.status}
  defp route_status(m), do: %{route: m[:route] || "?", status: nil}

  defp oban_tags(%{job: job} = m),
    do: %{worker: inspect(job.worker) |> String.trim("\""), state: m[:state]}

  defp oban_tags(m), do: m

  defp periodic_measurements do
    [
      :memory,
      :total_run_queue_lengths,
      :system_counts,
      {__MODULE__, :measure_backlog, []}
    ]
  end

  @doc false
  def measure_backlog do
    alias Thirstr.Repo

    %{rows: [[n, oldest]]} =
      Repo.query!(
        "SELECT count(*), COALESCE(EXTRACT(EPOCH FROM now() - min(created_at)), 0)::bigint FROM mls_messages"
      )

    :telemetry.execute([:thirstr, :chat, :backlog], %{count: n, oldest_s: oldest}, %{})

    Repo.query!("""
    SELECT queue, state, count(*),
           COALESCE(EXTRACT(EPOCH FROM now() - min(scheduled_at) FILTER (WHERE state = 'available')), 0)::bigint
    FROM oban_jobs WHERE state IN ('available', 'scheduled', 'retryable', 'executing')
    GROUP BY queue, state
    """).rows
    |> Enum.each(fn [q, st, c, age] ->
      :telemetry.execute([:thirstr, :oban, :jobs], %{count: c}, %{queue: q, state: st})

      if st == "available",
        do: :telemetry.execute([:thirstr, :oban, :jobs], %{oldest_available_s: age}, %{queue: q})
    end)

    %{rows: [[size]]} = Repo.query!("SELECT pg_database_size(current_database())")
    :telemetry.execute([:thirstr, :db], %{size_bytes: size}, %{})
  rescue
    _ -> :ok
  end
end
