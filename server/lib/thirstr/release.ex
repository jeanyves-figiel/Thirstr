defmodule Thirstr.Release do
  @moduledoc "Release tasks: `bin/thirstr eval 'Thirstr.Release.migrate()'` (Fly release_command)."
  @app :thirstr

  def migrate do
    load_app()
    migration_timeouts()

    for repo <- repos(),
        do: {:ok, _, _} = Ecto.Migrator.with_repo(repo, &Ecto.Migrator.run(&1, :up, all: true))
  end

  @doc "Synthetic data for staging/load only; refuses to run on prod (fly.toml sets DEPLOY_ENV=prod)."
  def seed(count \\ 5000) do
    if System.get_env("DEPLOY_ENV") in ~w(prod production),
      do: raise("refusing to seed production")

    load_app()

    for repo <- repos(),
        do: {:ok, _, _} = Ecto.Migrator.with_repo(repo, fn _ -> Thirstr.Seeds.run(count) end)
  end

  def rollback(repo, version) do
    load_app()
    {:ok, _, _} = Ecto.Migrator.with_repo(repo, &Ecto.Migrator.run(&1, :down, to: version))
  end

  # DB-03 (#333): DDL may run long (no statement_timeout) but must not queue behind a long lock
  # and stall every query behind it (lock_timeout 10 s: the migration fails, the deploy retries).
  defp migration_timeouts do
    for repo <- repos() do
      cfg = Application.get_env(@app, repo, [])
      params = Keyword.merge(cfg[:parameters] || [], statement_timeout: "0", lock_timeout: "10s")
      Application.put_env(@app, repo, Keyword.put(cfg, :parameters, params))
    end
  end

  defp repos, do: Application.fetch_env!(@app, :ecto_repos)
  defp load_app, do: Application.load(@app)
end
