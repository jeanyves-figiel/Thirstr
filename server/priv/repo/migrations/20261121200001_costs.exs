defmodule Thirstr.Repo.Migrations.Costs do
  use Ecto.Migration

  # EN-21 (#180) admin A-11 Costs & capacity. Aggregates only: no account ids anywhere.
  def change do
    create table(:cost_items) do
      add :vendor, :text, null: false
      add :label, :text
      add :amount_cents, :integer, null: false
      add :cadence, :text, null: false
      add :start_month, :date, null: false
      add :end_month, :date
      add :note, :text
      add :created_at, :utc_datetime_usec, null: false, default: fragment("now()")
    end

    create table(:cost_fly_daily, primary_key: false) do
      add :day, :date, primary_key: true
      add :app, :text, primary_key: true
      add :rate_cents_month, :integer, null: false
      add :detail, :map, null: false, default: %{}
    end

    create table(:usage_daily, primary_key: false) do
      add :day, :date, primary_key: true
      add :dau, :integer, null: false
      add :mau, :integer, null: false
      add :db_bytes, :bigint, null: false
    end

    create table(:cost_settings, primary_key: false) do
      add :key, :text, primary_key: true
      add :value, :map, null: false
    end

    create table(:cost_alerts, primary_key: false) do
      add :month, :date, primary_key: true
      add :threshold, :integer, primary_key: true
      add :sent_at, :utc_datetime_usec, null: false, default: fragment("now()")
    end
  end
end
