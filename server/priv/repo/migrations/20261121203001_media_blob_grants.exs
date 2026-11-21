defmodule Thirstr.Repo.Migrations.MediaBlobGrants do
  use Ecto.Migration

  # #271 (F-08 R-08.18): chat / album blobs are fetchable only by their uploader and the
  # accounts a message carrying them was delivered to. `scoped` = uploaded by an app that
  # declares those recipients; older builds upload unscoped blobs (old behaviour) until they age out.
  def change do
    alter table(:media_blobs) do
      add :scoped, :boolean, null: false, default: false
    end

    create table(:media_blob_grants, primary_key: false) do
      add :blob_id, references(:media_blobs, type: :binary_id, on_delete: :delete_all),
        null: false,
        primary_key: true

      add :account_id, references(:accounts, type: :binary_id, on_delete: :delete_all),
        null: false,
        primary_key: true

      add :created_at, :utc_datetime_usec, null: false
    end

    create index(:media_blob_grants, [:account_id])
  end
end
