defmodule Thirstr.Repo.Migrations.ExploreProfiles do
  use Ecto.Migration

  # B1 (docs/spec/beta-build-plan.md): F-04, F-05, F-06, F-09 Now, F-17 visibility subset.
  def change do
    alter table(:accounts) do
      # R-05.7 incognito (verified only); level kept for when it ends.
      add :incognito, :boolean, null: false, default: false
      # Hidden level is account-wide (F-05); own queries use a RAM cell, not indexed.
      add :hidden, :boolean, null: false, default: false

      # F-14: effective Safe Mode as reported by the device (country detection stays on device, R-14.3)
      add :safe_mode_active, :boolean, null: false, default: false
    end

    alter table(:profiles) do
      # F-06 field catalogue (concept/profile-and-settings.md §1). Only public/verified values
      # are stored (R-06.4); chats/only_me values stay on device.
      add :fields, :map, null: false, default: %{}
      # updated_at shown to others is fuzzed ±10 min (AC-06.3)
      add :public_updated_at, :utc_datetime_usec
    end

    create index(:profiles, [:fields], using: :gin)

    alter table(:photos) do
      add :review_state, :string
    end

    # R-05.2 k-anonymity: resolution the profile is displayed at (9, 8 or 7), set by a job.
    alter table(:location_cells) do
      add :display_res, :smallint, null: false, default: 7
    end

    create index(:location_cells, [:cell_r8])

    create table(:taps, primary_key: false) do
      add :from_profile_id, references(:profiles, type: :binary_id, on_delete: :delete_all),
        null: false

      add :to_profile_id, references(:profiles, type: :binary_id, on_delete: :delete_all),
        null: false

      add :seen, :boolean, null: false, default: false
      add :created_at, :utc_datetime_usec, null: false
    end

    create unique_index(:taps, [:from_profile_id, :to_profile_id])
    create index(:taps, [:to_profile_id, :created_at])

    # Account-level, both directions (data-model.md › blocks).
    create table(:blocks, primary_key: false) do
      add :account_from, references(:accounts, type: :binary_id, on_delete: :delete_all),
        null: false

      add :account_to, references(:accounts, type: :binary_id, on_delete: :delete_all),
        null: false

      add :created_at, :utc_datetime_usec, null: false
    end

    create unique_index(:blocks, [:account_from, :account_to])
    create index(:blocks, [:account_to])

    # "Hide this profile" from Explore (F-04 long-press), viewer side only.
    create table(:profile_hides, primary_key: false) do
      add :account_id, references(:accounts, type: :binary_id, on_delete: :delete_all),
        null: false

      add :profile_id, references(:profiles, type: :binary_id, on_delete: :delete_all),
        null: false
    end

    create unique_index(:profile_hides, [:account_id, :profile_id])

    # Profiles that have exchanged messages (audience "my chats", vouch eligibility).
    create table(:contacts, primary_key: false) do
      add :profile_a, references(:profiles, type: :binary_id, on_delete: :delete_all), null: false

      add :profile_b, references(:profiles, type: :binary_id, on_delete: :delete_all), null: false

      add :a_sent, :integer, null: false, default: 0
      add :b_sent, :integer, null: false, default: 0
      add :created_at, :utc_datetime_usec, null: false
      add :updated_at, :utc_datetime_usec, null: false
    end

    create unique_index(:contacts, [:profile_a, :profile_b])
    create index(:contacts, [:profile_b])

    # F-15 R-15.14: every action has a reason code + appeal state
    create table(:moderation_actions, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :target_account, references(:accounts, type: :binary_id, on_delete: :delete_all),
        null: false

      add :action, :string, null: false
      add :reason, :string, null: false
      add :actor, :string, null: false
      add :appeal_state, :string
      add :appeal_text, :string
      add :created_at, :utc_datetime_usec, null: false
    end

    create index(:moderation_actions, [:target_account])

    # F-09 Now status
    create table(:now_status, primary_key: false) do
      add :profile_id, references(:profiles, type: :binary_id, on_delete: :delete_all),
        primary_key: true

      add :status, :string, null: false
      add :text, :string
      add :created_at, :utc_datetime_usec, null: false
      add :expires_at, :utc_datetime_usec, null: false
    end
  end
end
