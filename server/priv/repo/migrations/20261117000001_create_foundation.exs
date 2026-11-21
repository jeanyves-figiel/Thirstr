defmodule Thirstr.Repo.Migrations.CreateFoundation do
  use Ecto.Migration

  # Data model: docs/spec/data-model.md (F-01, F-02, F-05 subset).
  def change do
    execute "CREATE EXTENSION IF NOT EXISTS h3", "DROP EXTENSION IF EXISTS h3"

    create table(:accounts, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :status, :string, null: false, default: "active"
      add :safe_mode, :string, null: false, default: "auto"
      add :auth_oidc_hash, :binary
      add :email_hash, :binary
      add :age_confirmed_at, :utc_datetime_usec
      # R-02.3; kept as date only to compute age bracket, never exposed
      add :birthdate, :date
      add :onboarding_step, :string, null: false, default: "basics"
      add :verified_at, :utc_datetime_usec
      add :verification_epoch, :integer, null: false, default: 0
      add :paused_at, :utc_datetime_usec
      add :settings, :map, null: false, default: %{}
      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:accounts, [:auth_oidc_hash])
    create unique_index(:accounts, [:email_hash])

    create table(:passkeys, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :account_id, references(:accounts, type: :binary_id, on_delete: :delete_all),
        null: false

      add :credential_id, :binary, null: false
      add :cose_key, :binary, null: false
      add :sign_count, :bigint, null: false, default: 0
      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:passkeys, [:credential_id])
    create index(:passkeys, [:account_id])

    create table(:devices, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :account_id, references(:accounts, type: :binary_id, on_delete: :delete_all),
        null: false

      add :platform, :string, null: false
      add :attestation_ok, :boolean, null: false, default: false
      add :last_seen_day, :date
      timestamps(type: :utc_datetime_usec)
    end

    create index(:devices, [:account_id])

    create table(:refresh_tokens, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :account_id, references(:accounts, type: :binary_id, on_delete: :delete_all),
        null: false

      add :device_id, references(:devices, type: :binary_id, on_delete: :delete_all), null: false
      add :token_hash, :binary, null: false
      add :expires_at, :utc_datetime_usec, null: false
      add :used_at, :utc_datetime_usec
      timestamps(type: :utc_datetime_usec, updated_at: false)
    end

    create unique_index(:refresh_tokens, [:token_hash])
    create index(:refresh_tokens, [:account_id])

    create table(:profiles, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :account_id, references(:accounts, type: :binary_id, on_delete: :delete_all),
        null: false

      add :kind, :string, null: false, default: "now"
      add :display_name, :string, null: false
      add :age, :integer
      add :gender, :string, null: false
      add :gender_other, :string
      add :here_for, {:array, :string}, null: false, default: []
      add :visibility_map, :map, null: false, default: %{}
      add :photo_ids, {:array, :binary_id}, null: false, default: []
      add :completeness, :integer, null: false, default: 0
      add :seeded, :boolean, null: false, default: false
      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:profiles, [:account_id, :kind])

    create table(:photos, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :profile_id, references(:profiles, type: :binary_id, on_delete: :delete_all),
        null: false

      add :slot, :integer, null: false
      add :storage_key, :string, null: false
      add :status, :string, null: false, default: "pending"
      add :classifier_score, :map, null: false, default: %{}
      add :reject_reason, :string
      timestamps(type: :utc_datetime_usec, updated_at: false)
    end

    create index(:photos, [:profile_id])

    # H3 cells stored as bigint (h3index::bigint) so Postgrex can decode them; use ::h3index in SQL.
    create table(:location_cells, primary_key: false) do
      add :profile_id, references(:profiles, type: :binary_id, on_delete: :delete_all),
        primary_key: true

      add :level, :string, null: false
      add :cell_r9, :bigint
      add :cell_r8, :bigint
      add :cell_r7, :bigint
      add :cell_r5, :bigint, null: false
      add :hide_from_hidden, :boolean, null: false, default: false
      add :updated_at, :utc_datetime_usec, null: false
    end

    create index(:location_cells, [:cell_r5])
    create index(:location_cells, [:cell_r7])
    create index(:location_cells, [:cell_r9])

    # City picker (S-04b) and welcome-count fallback; seeded, public data.
    create table(:cities, primary_key: false) do
      add :id, :serial, primary_key: true
      add :name, :string, null: false
      add :country, :string, null: false
      add :lat, :float, null: false
      add :lng, :float, null: false
      add :cell_r5, :bigint, null: false
    end

    create index(:cities, ["lower(name) text_pattern_ops"])
  end
end
