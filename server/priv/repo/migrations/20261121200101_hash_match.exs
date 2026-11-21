defmodule Thirstr.Repo.Migrations.HashMatch do
  use Ecto.Migration

  # F-15 R-15.40–46 (#179, #285): known-CSAM hash match before publish, cases, exact-bytes blocklist.
  def change do
    for t <- [:photos, :moments] do
      alter table(t) do
        add :hash_state, :text
        add :hash_checked_at, :utc_datetime_usec
        add :hash_provider, :text
      end
    end

    create index(:photos, [:hash_state], where: "hash_state IN ('retry', 'unchecked')")
    create index(:moments, [:hash_state], where: "hash_state IN ('retry', 'unchecked')")

    create table(:csam_cases, primary_key: false) do
      add :id, :uuid, primary_key: true
      add :state, :text, null: false, default: "open"
      add :source, :text, null: false
      add :provider, :text
      add :match_ref, :text
      add :target_account, :uuid, null: false
      add :photo_id, :uuid
      add :moment_id, :uuid
      add :report_id, :uuid
      add :sha256, :binary
      add :evidence_key, :text
      add :snapshot, :map
      add :decided_by, :text
      add :decided_at, :utc_datetime_usec
      add :hold_until, :utc_datetime_usec, null: false
      add :created_at, :utc_datetime_usec, null: false, default: fragment("now()")
    end

    create index(:csam_cases, [:state, :created_at])
    create index(:csam_cases, [:target_account])

    create table(:hash_blocklist, primary_key: false) do
      add :sha256, :binary, primary_key: true
      add :case_id, :uuid
      add :created_at, :utc_datetime_usec, null: false, default: fragment("now()")
    end
  end
end
