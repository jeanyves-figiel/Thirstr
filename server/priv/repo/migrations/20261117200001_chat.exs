defmodule Thirstr.Repo.Migrations.Chat do
  use Ecto.Migration

  # B2 (beta-build-plan.md): MLS delivery service (F-07), E2EE media blobs (F-08), push (F-16).
  # The server only ever stores ciphertext (AC-07.1).
  def change do
    # One MLS identity per (profile, device): profiles stay unlinkable (R-06.1).
    create table(:mls_key_packages) do
      add :profile_id, references(:profiles, type: :binary_id, on_delete: :delete_all),
        null: false

      add :device_id, references(:devices, type: :binary_id, on_delete: :delete_all), null: false
      add :key_package, :binary, null: false
      add :last_resort, :boolean, null: false, default: false
      add :created_at, :utc_datetime_usec, null: false
    end

    create index(:mls_key_packages, [:profile_id, :device_id, :last_resort])

    # Queue of ciphertext per recipient device; deleted on ack or after 30 d (R-07.12).
    create table(:mls_messages) do
      add :to_profile_id, references(:profiles, type: :binary_id, on_delete: :delete_all),
        null: false

      add :to_device_id, references(:devices, type: :binary_id, on_delete: :delete_all),
        null: false

      add :from_profile_id, references(:profiles, type: :binary_id, on_delete: :delete_all),
        null: false

      add :group_id, :binary, null: false
      # welcome | commit | app
      add :kind, :string, null: false
      add :key_package_id, :bigint
      add :ciphertext, :binary, null: false
      add :created_at, :utc_datetime_usec, null: false
    end

    create index(:mls_messages, [:to_device_id, :id])
    create index(:mls_messages, [:created_at])

    # R-07.11 franking commitments, kept for reports (F-15); no content.
    create table(:franking_tags, primary_key: false) do
      add :tag, :binary, primary_key: true
      add :from_profile_id, :binary_id, null: false
      add :to_profile_id, :binary_id, null: false
      add :created_at, :utc_datetime_usec, null: false
    end

    create index(:franking_tags, [:created_at])

    # F-08 E2EE blobs (ciphertext only). Deleted at expiry or 30 d (R-08.10).
    create table(:media_blobs, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :account_id, references(:accounts, type: :binary_id, on_delete: :delete_all),
        null: false

      add :storage_key, :string, null: false
      add :size, :integer, null: false
      add :expires_at, :utc_datetime_usec, null: false
      add :created_at, :utc_datetime_usec, null: false
    end

    create index(:media_blobs, [:expires_at])

    # F-16 push: APNs device token per device (content-free wake-ups).
    alter table(:devices) do
      add :push_token, :string
      add :push_platform, :string
    end
  end
end
