defmodule Thirstr.DbHealth do
  @moduledoc """
  DB-06 (#333, docs/spec/db-integrity.md › 3): Postgres health gauges for on-call alerts.

  Polled every 60 s (ThirstrWeb.Telemetry). Counts, ages and ratios only, never row data. Every
  query is a catalog / stats view read, cheap at any size. Exported as `thirstr_db_health_*`
  and `thirstr_db_maint_*`; alert rules in infra/alerts/rules.json (`db-*`).
  """
  alias Thirstr.Repo

  @maint_keys ~w(backup verify amcheck maintenance)
  # tables smaller than this are not worth a dead-tuple gauge (vacuum is instant)
  @min_rows 10_000

  @doc false
  def measure do
    :telemetry.execute([:thirstr, :db_health], health(), %{})

    for {table, ratio} <- dead_ratios(),
        do: :telemetry.execute([:thirstr, :db_health], %{dead_ratio: ratio}, %{table: table})

    for {key, age, ok} <- maint_status() do
      :telemetry.execute([:thirstr, :db_maint], %{age_s: age, ok: ok}, %{key: key})
    end

    :ok
  rescue
    _ -> :ok
  end

  @doc "Single-row gauges."
  def health do
    %{rows: [[xid, xact, conns, maxc, invalid, cks_fail, cks_on, arch_age, arch_failing]]} =
      Repo.query!("""
      SELECT
        (SELECT max(age(datfrozenxid)) FROM pg_database)::bigint,
        COALESCE((SELECT EXTRACT(EPOCH FROM max(now() - xact_start)) FROM pg_stat_activity
                  WHERE xact_start IS NOT NULL AND backend_type = 'client backend'
                    AND pid <> pg_backend_pid()), 0)::bigint,
        (SELECT count(*) FROM pg_stat_activity WHERE backend_type = 'client backend')::bigint,
        current_setting('max_connections')::bigint,
        (SELECT count(*) FROM pg_index WHERE NOT indisvalid)::bigint,
        COALESCE((SELECT sum(checksum_failures) FROM pg_stat_database), 0)::bigint,
        (current_setting('data_checksums') = 'on')::int,
        COALESCE((SELECT EXTRACT(EPOCH FROM now() - last_archived_time) FROM pg_stat_archiver), -1)::bigint,
        (SELECT (current_setting('archive_mode') <> 'off'
                 AND last_failed_time IS NOT NULL
                 AND (last_archived_time IS NULL OR last_failed_time > last_archived_time))::int
           FROM pg_stat_archiver)
      """)

    %{
      xid_age: xid,
      longest_xact_s: xact,
      connections_ratio: Float.round(conns / max(maxc, 1), 3),
      invalid_indexes: invalid,
      checksum_failures: cks_fail,
      checksums_on: cks_on,
      # -1 when archiving is off (DEV, CI, restore copies): rules only fire on prod
      archive_age_s: arch_age,
      archive_failing: arch_failing
    }
  end

  @doc "[{table, dead / (live + dead)}] for tables above #{@min_rows} rows."
  def dead_ratios do
    Repo.query!(
      """
      SELECT relname, round(n_dead_tup::numeric / (n_live_tup + n_dead_tup), 3)::float
      FROM pg_stat_user_tables
      WHERE n_live_tup + n_dead_tup >= $1
      """,
      [@min_rows]
    ).rows
    |> Enum.map(fn [t, r] -> {t, r} end)
  end

  @doc "[{key, age_s, ok 0|1}] for the keys written so far (a key never written exports nothing)."
  def maint_status do
    Repo.query!(
      "SELECT key, EXTRACT(EPOCH FROM now() - at)::bigint, ok::int FROM db_maint_status WHERE key = ANY($1)",
      [@maint_keys]
    ).rows
    |> Enum.map(fn [k, age, ok] -> {k, age, ok} end)
  end

  @doc "Upsert one status row (DbMaintenance, tests). detail: short, no user data."
  def put_status(key, ok?, detail) when key in @maint_keys and is_boolean(ok?) do
    Repo.query!(
      """
      INSERT INTO db_maint_status (key, ok, at, detail) VALUES ($1, $2, now(), $3)
      ON CONFLICT (key) DO UPDATE SET ok = EXCLUDED.ok, at = EXCLUDED.at, detail = EXCLUDED.detail
      """,
      [key, ok?, detail && String.slice(detail, 0, 500)]
    )

    :ok
  end
end
