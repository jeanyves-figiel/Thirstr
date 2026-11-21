defmodule Thirstr.Repo.Migrations.DeviceResume do
  use Ecto.Migration

  # SR-04 (#144): a revoked device keeps its row (and the chat messages queued for it) for 7 d,
  # so the same install can resume it after signing in again. resume_hash = hash of a secret the
  # device keeps in its Keychain.
  def change do
    alter table(:devices) do
      add :revoked_at, :utc_datetime_usec
      add :resume_hash, :binary
    end

    create index(:devices, [:revoked_at], where: "revoked_at IS NOT NULL")
  end
end
