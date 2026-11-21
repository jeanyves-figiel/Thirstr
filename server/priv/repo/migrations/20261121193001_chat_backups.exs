defmodule Thirstr.Repo.Migrations.ChatBackups do
  use Ecto.Migration

  # F-01 R-01.15 (#146): opt-in chat backup. Ciphertext only (key from the recovery phrase).
  def change do
    create table(:chat_backups, primary_key: false) do
      add :account_id, references(:accounts, type: :binary_id, on_delete: :delete_all),
        primary_key: true

      add :manifest, :binary, null: false
      add :bytes, :bigint, null: false, default: 0
      add :segments, :integer, null: false, default: 0
      timestamps(type: :utc_datetime_usec)
    end

    create table(:chat_backup_segments, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :account_id, references(:accounts, type: :binary_id, on_delete: :delete_all),
        null: false

      add :storage_key, :text, null: false
      add :size, :integer, null: false
      add :sha256, :binary, null: false
      add :committed, :boolean, null: false, default: false
      add :created_at, :utc_datetime_usec, null: false
    end

    create index(:chat_backup_segments, [:account_id])
    create index(:chat_backup_segments, [:created_at], where: "NOT committed")
  end
end
