defmodule Thirstr.DbIntegrityTest do
  use Thirstr.DataCase, async: false
  alias Thirstr.{DbHealth, Repo}
  alias Thirstr.Jobs.DbMaintenance

  # DB-01…DB-08 (#333, docs/spec/db-integrity.md)

  test "health gauges read from the catalogs" do
    h = DbHealth.health()
    assert is_integer(h.xid_age) and h.xid_age > 0
    assert h.longest_xact_s >= 0
    assert h.connections_ratio > 0 and h.connections_ratio <= 1
    assert h.invalid_indexes == 0
    assert h.checksum_failures == 0
    # CI and DEV clusters are created by the image with --data-checksums (DB-09)
    assert h.checksums_on in [0, 1]
    assert h.archive_failing in [0, 1]
    assert is_list(DbHealth.dead_ratios())
  end

  test "maintenance status: nothing exported until written, then age + ok" do
    assert DbHealth.maint_status() == []
    :ok = DbHealth.put_status("verify", false, "repo damaged")
    assert [{"verify", age, 0}] = DbHealth.maint_status()
    assert age >= 0
    :ok = DbHealth.put_status("verify", true, "ok")
    assert [{"verify", _, 1}] = DbHealth.maint_status()
  end

  test "telemetry: health, dead ratios and maintenance status" do
    ref =
      :telemetry_test.attach_event_handlers(self(), [
        [:thirstr, :db_health],
        [:thirstr, :db_maint]
      ])

    :ok = DbHealth.put_status("amcheck", true, "ok")
    :ok = DbHealth.measure()
    assert_received {[:thirstr, :db_health], ^ref, %{xid_age: _, archive_age_s: _}, %{}}
    assert_received {[:thirstr, :db_maint], ^ref, %{age_s: _, ok: 1}, %{key: "amcheck"}}
  end

  test "extensions for maintenance are installed" do
    %{rows: rows} =
      Repo.query!(
        "SELECT extname FROM pg_extension WHERE extname IN ('amcheck', 'pgstattuple', 'pg_stat_statements')"
      )

    assert rows |> List.flatten() |> Enum.sort() == ~w(amcheck pg_stat_statements pgstattuple)
  end

  test "churn tables carry their autovacuum settings" do
    %{rows: [[opts]]} =
      Repo.query!("SELECT reloptions FROM pg_class WHERE relname = 'location_cells'")

    assert "autovacuum_vacuum_scale_factor=0.01" in opts
    assert "fillfactor=85" in opts
  end

  test "nightly run checks every index, records ok, restores session settings" do
    assert :ok = DbMaintenance.run(heapallindexed: true)

    %{rows: [[ok, detail]]} =
      Repo.query!("SELECT ok, detail FROM db_maint_status WHERE key = 'amcheck'")

    assert ok
    assert detail =~ ~r/^\d+ indexes ok \(heapallindexed\)$/

    %{rows: [[mok]]} = Repo.query!("SELECT ok FROM db_maint_status WHERE key = 'maintenance'")
    assert mok

    # RESET ALL: the pooled connection is back to its startup statement_timeout
    %{rows: [[st]]} = Repo.query!("SHOW statement_timeout")
    refute st == "0"
  end

  test "Oban worker runs" do
    assert :ok = perform_job(DbMaintenance, %{"heapallindexed" => false})
  end

  defp perform_job(worker, args), do: worker.perform(%Oban.Job{args: args})
end
