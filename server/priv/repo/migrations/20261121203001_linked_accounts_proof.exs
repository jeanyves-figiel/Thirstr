defmodule Thirstr.Repo.Migrations.LinkedAccountsProof do
  use Ecto.Migration

  # I-01 (#17): proof method, platform account key (Bluesky DID / X handle), hand-check queue,
  # impersonation hiding.
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
  end
end
