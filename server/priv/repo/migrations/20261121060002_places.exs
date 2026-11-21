defmodule Thirstr.Repo.Migrations.Places do
  use Ecto.Migration

  # #113 place layers (F-04 R-04.20, F-12 R-12.9/R-12.10, F-10 R-10.10).
  # Venues are public businesses: their coordinates are stored. User locations never are.
  def change do
    alter table(:venues) do
      add :lat, :float
      add :lng, :float
      # osm:node/123 for imported venues, null for team/partner
      add :ext_id, :string
      add :hours_text, :string, size: 255
      add :hidden, :boolean, null: false, default: false
      add :updated_at, :utc_datetime_usec
    end

    create unique_index(:venues, [:ext_id])

    # Official parties (R-10.10): nightlife listings at a catalogue venue.
    create table(:events, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :venue_id, references(:venues, type: :binary_id, on_delete: :delete_all), null: false
      add :title, :string, size: 60, null: false
      add :starts_at, :utc_datetime_usec, null: false
      add :ends_at, :utc_datetime_usec, null: false
      add :url, :string, size: 500
      # team | partner
      add :added_by, :string, null: false, default: "team"
      add :created_at, :utc_datetime_usec, null: false
    end

    create index(:events, [:ends_at])

    # Last OSM import summary (admin console A-07b).
    create table(:place_imports) do
      add :started_at, :utc_datetime_usec, null: false
      add :finished_at, :utc_datetime_usec
      add :added, :integer, null: false, default: 0
      add :updated, :integer, null: false, default: 0
      add :removed, :integer, null: false, default: 0
      add :error, :string, size: 500
    end
  end
end
