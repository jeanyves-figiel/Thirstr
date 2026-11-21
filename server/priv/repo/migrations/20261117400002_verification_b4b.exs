defmodule Thirstr.Repo.Migrations.VerificationB4b do
  use Ecto.Migration

  # F-03 R-03.4: blind-signature issuer key (generated once, shared by all nodes) and spent tokens.
  def change do
    create table(:server_keys, primary_key: false) do
      add :name, :string, primary_key: true
      add :der, :binary, null: false
      add :created_at, :utc_datetime_usec, null: false
    end

    # sha256(token) only: proves single use without linking to the issuance (AC-03.3).
    create table(:spent_tokens, primary_key: false) do
      add :hash, :binary, primary_key: true
      add :created_at, :utc_datetime_usec, null: false
    end
  end
end
