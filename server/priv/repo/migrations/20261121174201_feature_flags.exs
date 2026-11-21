defmodule Thirstr.Repo.Migrations.FeatureFlags do
  use Ecto.Migration

  # EN-13 (#172) feature flags / kill switches, EN-14 (#173) minimum app build.
  def change do
    create table(:feature_flags, primary_key: false) do
      add :name, :text, primary_key: true
      add :enabled, :boolean, null: false, default: true
      add :rules, :map, null: false, default: %{}
      add :note, :text
      add :updated_at, :utc_datetime_usec, null: false, default: fragment("now()")
    end
  end
end
