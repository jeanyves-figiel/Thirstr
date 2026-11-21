defmodule Thirstr.Repo.Migrations.ModerationConsole do
  use Ecto.Migration

  # F-15 R-15.48, R-15.53 (#179, #286, #287): where a confirmed case was filed; moderator time per tier.
  def change do
    create table(:csam_filings) do
      add :case_id, :uuid, null: false
      add :authority, :text, null: false
      add :country, :text
      add :external_ref, :text
      add :filed_by, :text, null: false
      add :filed_at, :utc_datetime_usec, null: false, default: fragment("now()")
    end

    create index(:csam_filings, [:case_id])

    create table(:mod_time, primary_key: false) do
      add :moderator, :text, null: false, primary_key: true
      add :day, :date, null: false, primary_key: true
      add :tier, :integer, null: false, primary_key: true
      add :seconds, :integer, null: false, default: 0
    end
  end
end
