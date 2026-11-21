defmodule Thirstr.Repo.Migrations.TravelPlans do
  use Ecto.Migration

  # F-20 travel plans (#188): trips, creation log for the 6 / 30 d limit, and a worldwide city
  # catalogue (GeoNames ≥ 15 000 inhabitants, CC BY 4.0) so any trip city can be picked.
  def up do
    alter table(:cities) do
      add :population, :integer, null: false, default: 0
      add :search_key, :string
    end

    create table(:trips, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :account_id, references(:accounts, type: :binary_id, on_delete: :delete_all),
        null: false

      add :city_id, references(:cities, on_delete: :delete_all), null: false
      add :first_day, :date, null: false
      add :last_day, :date, null: false
      # nil = browse only; 0 = from the first day; 3 / 7 / 14 days before
      add :show_days, :smallint
      add :say_from, :boolean, null: false, default: false
      timestamps(inserted_at: :created_at, type: :utc_datetime_usec)
    end

    create index(:trips, [:account_id])
    create index(:trips, [:city_id, :last_day])

    create table(:trip_creates, primary_key: false) do
      add :account_id, references(:accounts, type: :binary_id, on_delete: :delete_all),
        null: false

      add :at, :utc_datetime_usec, null: false
    end

    create index(:trip_creates, [:account_id, :at])

    flush()

    Thirstr.Cities.load!(repo())

    create index(:cities, ["search_key text_pattern_ops"])
    create index(:cities, [:cell_r5])
  end

  def down do
    drop table(:trip_creates)
    drop table(:trips)
    drop index(:cities, ["search_key text_pattern_ops"])
    drop index(:cities, [:cell_r5])

    alter table(:cities) do
      remove :population
      remove :search_key
    end
  end
end
