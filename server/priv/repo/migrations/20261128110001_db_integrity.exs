defmodule Thirstr.Repo.Migrations.DbIntegrity do
  use Ecto.Migration

  # DB-02 / DB-04 / DB-05 (#333, docs/spec/db-integrity.md). Expand-only: extensions, a status table,
  # per-table autovacuum storage parameters (SHARE UPDATE EXCLUSIVE lock, no rewrite).

  @churn ~w(location_cells mls_messages oban_jobs now_status taps mls_send_keys refresh_tokens spent_tokens)
  @params "autovacuum_vacuum_scale_factor = 0.01, autovacuum_analyze_scale_factor = 0.02, " <>
            "autovacuum_vacuum_insert_scale_factor = 0.05, autovacuum_vacuum_cost_limit = 2000"
  @reset "autovacuum_vacuum_scale_factor, autovacuum_analyze_scale_factor, " <>
           "autovacuum_vacuum_insert_scale_factor, autovacuum_vacuum_cost_limit"

  def change do
    # pg_stat_statements views need shared_preload_libraries (infra/postgres entrypoint); the
    # extension itself installs anywhere.
    for ext <- ~w(pg_stat_statements amcheck pgstattuple),
        do: execute("CREATE EXTENSION IF NOT EXISTS #{ext}", "DROP EXTENSION IF EXISTS #{ext}")

    # Written by infra/postgres/backup-loop.sh (backup, verify) and Thirstr.Jobs.DbMaintenance
    # (amcheck, maintenance); read by Thirstr.DbHealth for alerts. No user data.
    create table(:db_maint_status, primary_key: false) do
      add :key, :text, primary_key: true
      add :ok, :boolean, null: false
      add :at, :utc_datetime_usec, null: false
      add :detail, :text
    end

    for t <- @churn,
        do: execute("ALTER TABLE #{t} SET (#{@params})", "ALTER TABLE #{t} RESET (#{@reset})")

    # every minute rewrites display cells: leave room on each page for HOT updates
    execute "ALTER TABLE location_cells SET (fillfactor = 85)",
            "ALTER TABLE location_cells RESET (fillfactor)"
  end
end
