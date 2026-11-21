defmodule Thirstr.Repo.Migrations.Moments do
  use Ecto.Migration

  # F-21 Moments (#212): temporary photos. Everything here is hard-deleted at expiry
  # (ExpirySweep, R-21.22); views and audience rows go with their Moment.
  def change do
    create table(:moments, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :account_id, references(:accounts, type: :binary_id, on_delete: :delete_all),
        null: false

      add :profile_id, references(:profiles, type: :binary_id, on_delete: :delete_all),
        null: false

      add :storage_key, :string, null: false
      add :thumb_key, :string
      add :caption, :string
      add :caption_style, :string, null: false, default: "clean"

      # everyone | chats | favorites (chats / favorites resolved on the phone into moment_audience, R-21.6)
      add :audience, :string, null: false, default: "everyone"
      add :intents, {:array, :string}, null: false, default: ["hookup"]
      add :main_ok, :boolean, null: false, default: false
      # uploading | live | review | rejected | hidden
      add :status, :string, null: false, default: "uploading"
      add :reject_reason, :string
      add :ttl_s, :integer, null: false, default: 86_400
      add :expires_at, :utc_datetime_usec
      timestamps(inserted_at: :created_at, updated_at: false, type: :utc_datetime_usec)
    end

    create index(:moments, [:profile_id, :status, :expires_at])
    create index(:moments, [:account_id, :created_at])
    create index(:moments, [:expires_at])

    create table(:moment_audience, primary_key: false) do
      add :moment_id, references(:moments, type: :binary_id, on_delete: :delete_all),
        null: false,
        primary_key: true

      add :profile_id, references(:profiles, type: :binary_id, on_delete: :delete_all),
        null: false,
        primary_key: true
    end

    create table(:moment_views, primary_key: false) do
      add :moment_id, references(:moments, type: :binary_id, on_delete: :delete_all),
        null: false,
        primary_key: true

      add :viewer_profile_id, references(:profiles, type: :binary_id, on_delete: :delete_all),
        null: false,
        primary_key: true

      add :at, :utc_datetime_usec, null: false
      add :tapped, :boolean, null: false, default: false
      add :screenshot, :boolean, null: false, default: false
    end

    create index(:moment_views, [:viewer_profile_id])

    # R-21.12 viewer mutes a poster's Moments (the poster is never told)
    create table(:moment_mutes, primary_key: false) do
      add :account_id, references(:accounts, type: :binary_id, on_delete: :delete_all),
        null: false,
        primary_key: true

      add :profile_id, references(:profiles, type: :binary_id, on_delete: :delete_all),
        null: false,
        primary_key: true

      add :created_at, :utc_datetime_usec, null: false, default: fragment("now()")
    end
  end
end
