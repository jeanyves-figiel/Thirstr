defmodule Thirstr.Repo.Migrations.AccountRecovery do
  use Ecto.Migration

  # F-01 R-01.7 (#25): recovery phrase public key + sealed backup (ciphertext only).
  def change do
    create table(:account_recovery, primary_key: false) do
      add :account_id, references(:accounts, type: :binary_id, on_delete: :delete_all),
        primary_key: true

      add :public_key, :binary, null: false
      add :vault, :binary
      add :vault_updated_at, :utc_datetime_usec
      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:account_recovery, [:public_key])
  end
end
