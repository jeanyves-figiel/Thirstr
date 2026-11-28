defmodule Thirstr.Repo.Migrations.IdempotencyKeys do
  use Ecto.Migration

  # DB-10 (#335): Idempotency-Key claims + stored answers, 24 h (ThirstrWeb.Plugs.Idempotency).
  def change do
    create table(:idempotency_keys, primary_key: false) do
      add :account_id, references(:accounts, type: :binary_id, on_delete: :delete_all),
        primary_key: true

      add :key, :text, primary_key: true
      add :path, :text, null: false
      add :req_hash, :binary, null: false
      add :status, :integer
      add :body, :binary
      add :created_at, :utc_datetime_usec, null: false
    end

    create index(:idempotency_keys, [:created_at])
  end
end
