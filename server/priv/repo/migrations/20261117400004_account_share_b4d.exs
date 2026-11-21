defmodule Thirstr.Repo.Migrations.AccountShareB4d do
  use Ecto.Migration

  # I-01 linked accounts, I-02 profile share links.
  def change do
    create table(:linked_accounts, primary_key: false) do
      add :id, :uuid, primary_key: true
      add :profile_id, references(:profiles, type: :uuid, on_delete: :delete_all), null: false
      add :platform, :string, null: false
      add :handle, :string, size: 64, null: false
      add :code, :string, null: false
      add :verified_at, :utc_datetime_usec
      add :checked_at, :utc_datetime_usec
      add :visibility, :string, null: false, default: "chats"
      add :created_at, :utc_datetime_usec, null: false
    end

    create unique_index(:linked_accounts, [:profile_id, :platform, :handle])

    create table(:profile_shares, primary_key: false) do
      add :slug, :string, size: 10, primary_key: true
      add :profile_id, references(:profiles, type: :uuid, on_delete: :delete_all), null: false
      add :created_at, :utc_datetime_usec, null: false
    end

    create unique_index(:profile_shares, [:profile_id])
  end
end
