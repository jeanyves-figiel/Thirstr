defmodule Thirstr.Jobs.DbMaintenance do
  @moduledoc """
  DB-05 (#333, docs/spec/db-integrity.md): nightly database upkeep, 04:40 UTC.

  1. amcheck: `bt_index_check` on every valid B-tree index (Sundays with `heapallindexed`:
     every heap tuple must be in the index). Read-only, AccessShareLock. Result → status `amcheck`.
  2. Vacuum on pressure: tables ≥ 10 000 rows, dead > 20 %, no vacuum for 6 h → VACUUM (ANALYZE),
     at most 5 a run. Autovacuum normally gets there first; this catches stragglers.
  3. Reindex: B-tree indexes ≥ 64 MB with leaf density < 50 % → REINDEX INDEX CONCURRENTLY,
     at most 2 a run (no write lock).
  4. Leftovers of a failed concurrent reindex (`*_ccnew*`, `*_ccold*`, always invalid) are dropped
     CONCURRENTLY. Other invalid indexes are reported only (alert `db-corruption` / runbook).

  Runs on one checked-out connection with statement_timeout 0 and lock_timeout 5 s, reset after.
  Only identifiers from the catalogs (`oid::regclass`, always quoted by Postgres) reach SQL.
  """
  use Oban.Worker, queue: :maintenance, max_attempts: 1, unique: [period: 3600]

  require Logger
  alias Thirstr.{DbHealth, Repo}

  @vacuum_min_rows 10_000
  @vacuum_dead_ratio 0.2
  @vacuum_max 5
  @reindex_min_bytes 64 * 1024 * 1024
  @reindex_density 50.0
  @reindex_max 2

  @impl true
  def perform(%Oban.Job{args: args}) do
    full? = Map.get(args, "heapallindexed", Date.day_of_week(Date.utc_today()) == 7)
    run(heapallindexed: full?)
  end

  @doc "Runs all steps; returns a summary map (also logged and stored as status `maintenance`)."
  def run(opts \\ []) do
    Repo.checkout(
      fn ->
        Repo.query!("SET statement_timeout = 0")
        Repo.query!("SET lock_timeout = '5s'")

        try do
          amcheck = amcheck(Keyword.get(opts, :heapallindexed, false))
          vacuumed = vacuum()
          reindexed = reindex()
          dropped = drop_leftovers()

          summary = %{
            checked: amcheck.checked,
            corrupt: amcheck.corrupt,
            vacuumed: vacuumed,
            reindexed: reindexed,
            dropped: dropped
          }

          DbHealth.put_status("maintenance", true, summary_text(summary))
          Logger.info("db maintenance: #{summary_text(summary)}")
          {:ok, summary}
        rescue
          e ->
            DbHealth.put_status("maintenance", false, Exception.message(e))
            reraise e, __STACKTRACE__
        after
          Repo.query!("RESET ALL")
        end
      end,
      timeout: :infinity
    )
    |> case do
      {:ok, _} -> :ok
      other -> other
    end
  end

  defp summary_text(s) do
    "amcheck #{s.checked} indexes, #{length(s.corrupt)} corrupt; vacuumed #{inspect(s.vacuumed)}; " <>
      "reindexed #{inspect(s.reindexed)}; dropped #{inspect(s.dropped)}"
  end

  # ------------------------------------------------------------------ 1. amcheck

  defp amcheck(heapallindexed?) do
    idx =
      Repo.query!("""
      SELECT i.indexrelid
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_am am ON am.oid = c.relam
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE am.amname = 'btree' AND i.indisvalid AND i.indisready
        AND c.relpersistence <> 't'
        AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_toast'
      """).rows
      |> Enum.map(&hd/1)

    corrupt =
      for oid <- idx, reason = check_index(oid, heapallindexed?), reason != :ok, do: reason

    ok? = corrupt == []

    DbHealth.put_status(
      "amcheck",
      ok?,
      if(ok?,
        do: "#{length(idx)} indexes ok#{if heapallindexed?, do: " (heapallindexed)"}",
        else: "corrupt: " <> Enum.join(corrupt, ", ")
      )
    )

    unless ok?,
      do: Logger.error("db maintenance: amcheck found corrupt indexes #{inspect(corrupt)}")

    %{checked: length(idx), corrupt: corrupt}
  end

  defp check_index(oid, heapallindexed?) do
    Repo.query!("SELECT bt_index_check(index => $1::regclass, heapallindexed => $2)", [
      oid,
      heapallindexed?
    ])

    :ok
  rescue
    e in Postgrex.Error ->
      case e.postgres do
        # the index was dropped between listing and checking (deploy, reindex): not corruption
        %{code: :undefined_table} -> :ok
        %{code: :lock_not_available} -> :ok
        _ -> index_name(oid)
      end
  end

  defp index_name(oid) do
    case Repo.query("SELECT $1::oid::regclass::text", [oid]) do
      {:ok, %{rows: [[n]]}} -> n
      _ -> "oid #{oid}"
    end
  end

  # ------------------------------------------------------------------ 2. vacuum

  defp vacuum do
    Repo.query!(
      """
      SELECT relid::regclass::text
      FROM pg_stat_user_tables
      WHERE n_live_tup + n_dead_tup >= $1
        AND n_dead_tup::float / (n_live_tup + n_dead_tup) > $2
        AND GREATEST(COALESCE(last_vacuum, 'epoch'), COALESCE(last_autovacuum, 'epoch'))
            < now() - interval '6 hours'
      ORDER BY n_dead_tup DESC
      LIMIT $3
      """,
      [@vacuum_min_rows, @vacuum_dead_ratio, @vacuum_max]
    ).rows
    |> Enum.flat_map(fn [t] ->
      case exec("VACUUM (ANALYZE) ", t) do
        {:ok, _} -> [t]
        {:error, e} -> skip("vacuum #{t}", e)
      end
    end)
  end

  # ------------------------------------------------------------------ 3. reindex

  defp reindex do
    Repo.query!(
      """
      SELECT c.oid::regclass::text, (pgstatindex(c.oid::regclass)).avg_leaf_density
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_am am ON am.oid = c.relam
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE am.amname = 'btree' AND i.indisvalid AND n.nspname = 'public'
        AND pg_relation_size(c.oid) >= $1
      """,
      [@reindex_min_bytes]
    ).rows
    |> Enum.filter(fn [_, density] -> is_number(density) and density < @reindex_density end)
    |> Enum.sort_by(fn [_, density] -> density end)
    |> Enum.take(@reindex_max)
    |> Enum.flat_map(fn [name, _] ->
      case exec("REINDEX INDEX CONCURRENTLY ", name) do
        {:ok, _} -> [name]
        {:error, e} -> skip("reindex #{name}", e)
      end
    end)
  end

  # `rel` is always `oid::regclass::text` from the catalogs (identifier quoted by Postgres),
  # never input; `cmd` is a literal from this module.
  # sobelow_skip ["SQL.Query"]
  defp exec(cmd, rel), do: Repo.query(cmd <> rel)

  defp skip(what, e) do
    Logger.warning("db maintenance: #{what}: #{Exception.message(e)}")
    []
  end

  # ------------------------------------------------------------------ 4. leftovers

  defp drop_leftovers do
    Repo.query!("""
    SELECT c.oid::regclass::text
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT i.indisvalid AND n.nspname = 'public' AND c.relname ~ '_cc(new|old)[0-9]*$'
    """).rows
    |> Enum.flat_map(fn [name] ->
      case exec("DROP INDEX CONCURRENTLY IF EXISTS ", name) do
        {:ok, _} -> [name]
        {:error, _} -> []
      end
    end)
  end
end
