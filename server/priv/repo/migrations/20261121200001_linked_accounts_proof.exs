defmodule Thirstr.Repo.Migrations.LinkedAccountsProof do
  use Ecto.Migration

  # I-01 (#17): proof method, platform account id (Bluesky DID / X id), hand-check queue,
  # impersonation hiding; X OAuth PKCE state (10 min).
  def change do
    alter table(:linked_accounts) do
      add :proof, :string
      add :platform_user_id, :string, size: 128
      add :manual_pending_at, :utc_datetime_usec
      add :hidden_at, :utc_datetime_usec
    end

    create unique_index(:linked_accounts, [:platform, :platform_user_id],
             where: "verified_at IS NOT NULL AND platform_user_id IS NOT NULL",
             name: :linked_accounts_proven_once
           )

    create table(:x_oauth_pending, primary_key: false) do
      add :state, :string, size: 64, primary_key: true

      add :account_id, references(:accounts, type: :binary_id, on_delete: :delete_all),
        null: false

      add :profile_id, references(:profiles, type: :uuid, on_delete: :delete_all), null: false
      add :verifier, :string, size: 128, null: false
      add :visibility, :string, null: false
      add :created_at, :utc_datetime_usec, null: false
    end
  end
end
