defmodule Thirstr.Repo.Migrations.PlusEntitlements do
  use Ecto.Migration

  # F-23 (#7, D-25): store / lifetime / grant entitlements and the per-account purchase token
  # (StoreKit appAccountToken, Play obfuscatedAccountId: never the account id, R-23.40). Expand-only.
  def change do
    alter table(:accounts) do
      add :plus_token, :uuid
    end

    create unique_index(:accounts, [:plus_token])

    create table(:plus_entitlements, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :account_id, references(:accounts, type: :binary_id, on_delete: :delete_all),
        null: false

      # ios | android | grant
      add :store, :text, null: false
      # plus.monthly | plus.yearly | plus.lifetime | plus.grant
      add :product, :text, null: false
      # SHA-256 of the original transaction id / purchase token (R-23.43)
      add :original_id_hash, :binary
      # active | grace | expired | refunded | revoked
      add :state, :text, null: false
      # nil for lifetime
      add :period_end, :utc_datetime_usec
      # storefront country, for tax only
      add :storefront, :text
      add :granted_by, :text
      add :reason, :text
      timestamps(type: :utc_datetime_usec)
    end

    create index(:plus_entitlements, [:account_id, :state])
    create unique_index(:plus_entitlements, [:store, :original_id_hash])
  end
end
