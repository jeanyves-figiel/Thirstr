defmodule Thirstr.Repo.Migrations.SocialB3 do
  use Ecto.Migration

  # B3 (beta-build-plan.md): Tonight plans (F-09), parties (F-10), activities & clubs (F-11),
  # venues & check-in (F-12). Locations are H3 cells only, never coordinates (AC-10.1).
  def change do
    create table(:tonight_plans, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :profile_id, references(:profiles, type: :binary_id, on_delete: :delete_all),
        null: false

      add :window_start, :utc_datetime_usec, null: false
      add :window_end, :utc_datetime_usec, null: false
      add :text, :string, size: 140, null: false
      # hosting | can_travel | drinks_first | party | other
      add :tag, :string, null: false
      # verified | chats
      add :audience, :string, null: false, default: "verified"
      add :cell_r8, :bigint, null: false
      add :cell_r5, :bigint, null: false
      add :expires_at, :utc_datetime_usec, null: false
      add :created_at, :utc_datetime_usec, null: false
    end

    create index(:tonight_plans, [:cell_r5, :expires_at])
    create index(:tonight_plans, [:profile_id])

    create table(:parties, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :host_profile_id, references(:profiles, type: :binary_id, on_delete: :delete_all),
        null: false

      add :cohost_profile_id, references(:profiles, type: :binary_id, on_delete: :nilify_all)
      add :title, :string, size: 40, null: false
      add :starts_at, :utc_datetime_usec, null: false
      add :ends_at, :utc_datetime_usec, null: false
      add :capacity, :integer, null: false
      add :rules, {:array, :string}, null: false, default: []
      # verified | chats | invite
      add :audience, :string, null: false, default: "verified"
      add :cell_r8, :bigint, null: false
      add :cell_r5, :bigint, null: false
      # open | full | cancelled | ended
      add :status, :string, null: false, default: "open"
      add :hidden, :boolean, null: false, default: false
      add :invite_code, :string
      add :created_at, :utc_datetime_usec, null: false
    end

    create index(:parties, [:cell_r5, :ends_at])
    create index(:parties, [:host_profile_id])

    create table(:party_requests, primary_key: false) do
      add :party_id, references(:parties, type: :binary_id, on_delete: :delete_all),
        primary_key: true

      add :profile_id, references(:profiles, type: :binary_id, on_delete: :delete_all),
        primary_key: true

      # pending | accepted | declined | left | removed
      add :state, :string, null: false, default: "pending"
      add :rating, :smallint
      add :created_at, :utc_datetime_usec, null: false
    end

    create table(:party_reports, primary_key: false) do
      add :party_id, references(:parties, type: :binary_id, on_delete: :delete_all),
        primary_key: true

      add :account_id, references(:accounts, type: :binary_id, on_delete: :delete_all),
        primary_key: true

      add :reason, :string
      add :created_at, :utc_datetime_usec, null: false
    end

    create table(:venues, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :name, :string, null: false
      # sauna | bar | club | gym | other
      add :kind, :string, null: false
      add :cell_r9, :bigint, null: false
      add :cell_r5, :bigint, null: false
      add :geofence_radius_m, :integer, null: false, default: 80
      # {"mon": [[18, 26]], ...} local hours; null = always open
      add :hours, :map
      add :tz_offset_min, :integer, null: false, default: 60
      # team | partner
      add :added_by, :string, null: false, default: "team"
      add :created_at, :utc_datetime_usec, null: false
    end

    create index(:venues, [:cell_r5])

    # Current check-ins only; rows are deleted at check-out (AC-12.2).
    create table(:venue_checkins, primary_key: false) do
      add :venue_id, references(:venues, type: :binary_id, on_delete: :delete_all), null: false

      add :profile_id, references(:profiles, type: :binary_id, on_delete: :delete_all),
        primary_key: true

      add :visible, :boolean, null: false, default: true
      add :zone, :string, size: 40
      add :checked_in_at, :utc_datetime_usec, null: false
      add :auto_out_at, :utc_datetime_usec, null: false
    end

    create index(:venue_checkins, [:venue_id])

    create table(:clubs, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :name, :string, size: 60, null: false
      add :sport, :string, null: false
      add :description, :string, size: 500
      add :cell_r5, :bigint, null: false
      # open | request
      add :join_policy, :string, null: false, default: "open"
      add :verified_club, :boolean, null: false, default: false
      add :created_at, :utc_datetime_usec, null: false
    end

    create index(:clubs, [:cell_r5])

    create table(:club_members, primary_key: false) do
      add :club_id, references(:clubs, type: :binary_id, on_delete: :delete_all),
        primary_key: true

      add :profile_id, references(:profiles, type: :binary_id, on_delete: :delete_all),
        primary_key: true

      # member | admin
      add :role, :string, null: false, default: "member"
      # requested | member
      add :state, :string, null: false, default: "member"
      add :created_at, :utc_datetime_usec, null: false
    end

    create table(:activity_posts, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :profile_id, references(:profiles, type: :binary_id, on_delete: :delete_all),
        null: false

      add :club_id, references(:clubs, type: :binary_id, on_delete: :delete_all)
      add :venue_id, references(:venues, type: :binary_id, on_delete: :nilify_all)
      add :sport, :string, null: false
      add :title, :string, size: 80, null: false
      add :place_text, :string, size: 80
      add :starts_at, :utc_datetime_usec, null: false
      add :capacity, :integer
      # verified | everyone
      add :audience, :string, null: false, default: "verified"
      # just_sport | open_to_more
      add :intent, :string, null: false, default: "just_sport"
      add :cell_r8, :bigint, null: false
      add :cell_r5, :bigint, null: false
      add :expires_at, :utc_datetime_usec, null: false
      add :created_at, :utc_datetime_usec, null: false
    end

    create index(:activity_posts, [:cell_r5, :expires_at])

    create table(:activity_rsvps, primary_key: false) do
      add :post_id, references(:activity_posts, type: :binary_id, on_delete: :delete_all),
        primary_key: true

      add :profile_id, references(:profiles, type: :binary_id, on_delete: :delete_all),
        primary_key: true

      # joined | removed
      add :state, :string, null: false, default: "joined"
      add :created_at, :utc_datetime_usec, null: false
    end
  end
end
