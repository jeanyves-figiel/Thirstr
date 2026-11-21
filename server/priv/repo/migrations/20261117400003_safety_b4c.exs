defmodule Thirstr.Repo.Migrations.SafetyB4c do
  use Ecto.Migration

  # F-13 (beta): trusted-contact relays, ciphertext mailbox, meet check-ins. No plaintext.
  def change do
    create table(:safety_relays, primary_key: false) do
      add :id, :uuid, primary_key: true
      add :account_id, references(:accounts, type: :uuid, on_delete: :delete_all), null: false
      add :rid_hash, :binary, null: false
      add :intro, :binary, null: false
      add :accepted_at, :utc_datetime_usec
      add :push, :map
      add :created_at, :utc_datetime_usec, null: false
    end

    create unique_index(:safety_relays, [:rid_hash])
    create index(:safety_relays, [:account_id])

    create table(:checkins, primary_key: false) do
      add :id, :uuid, primary_key: true
      add :account_id, references(:accounts, type: :uuid, on_delete: :delete_all), null: false
      add :token_hash, :binary, null: false
      add :due_at, :utc_datetime_usec, null: false
      add :extensions, :integer, null: false, default: 0
      add :due_pushed, :boolean, null: false, default: false
      add :created_at, :utc_datetime_usec, null: false
    end

    create unique_index(:checkins, [:account_id])
    create unique_index(:checkins, [:token_hash])
    create index(:checkins, [:due_at])

    create table(:safety_msgs) do
      add :relay_id, references(:safety_relays, type: :uuid, on_delete: :delete_all), null: false
      add :checkin_id, references(:checkins, type: :uuid, on_delete: :delete_all)
      add :kind, :string, null: false
      add :ciphertext, :binary, null: false
      add :release_at, :utc_datetime_usec
      add :created_at, :utc_datetime_usec, null: false
    end

    create index(:safety_msgs, [:relay_id, :release_at])
    create index(:safety_msgs, [:checkin_id])
  end
end
