defmodule Thirstr.Repo.Migrations.DeviceAppAttest do
  use Ecto.Migration

  # #25 security.md › Device attestation: iOS App Attest key per device (public key only).
  def change do
    alter table(:devices) do
      add :attest_key_id, :binary
      add :attest_public_key, :binary
      add :attest_counter, :bigint
      add :attest_env, :string
      add :attested_at, :utc_datetime_usec
    end
  end
end
