defmodule Thirstr.Repo.Migrations.ProbeAccounts do
  use Ecto.Migration

  # EN-23 OB-2 (#343): synthetic chat probe accounts (two per environment). Expand-only.
  def change do
    alter table(:accounts) do
      add :probe, :boolean, null: false, default: false
    end
  end
end
