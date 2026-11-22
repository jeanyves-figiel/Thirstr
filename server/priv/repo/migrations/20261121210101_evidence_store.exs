defmodule Thirstr.Repo.Migrations.EvidenceStore do
  use Ecto.Migration

  # F-15 R-15.47 (#287): evidence sealed per case (AES-256-GCM data key wrapped by the evidence key).
  def change do
    alter table(:csam_cases) do
      add :evidence_dek, :binary
      add :evidence_deleted_at, :utc_datetime_usec
    end

    create index(:csam_cases, [:hold_until], where: "evidence_key IS NOT NULL")
  end
end
