defmodule Thirstr.Repo.Migrations.PasskeyManagement do
  use Ecto.Migration

  # F-01 R-01.16: provider name from the AAGUID, last use, and which OIDC provider signed in.
  # Expand-only.
  def change do
    alter table(:passkeys) do
      add :aaguid, :binary
      add :last_used_at, :utc_datetime_usec
    end

    alter table(:accounts) do
      add :oidc_provider, :text
    end
  end
end
