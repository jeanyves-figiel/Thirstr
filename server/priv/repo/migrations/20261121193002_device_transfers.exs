defmodule Thirstr.Repo.Migrations.DeviceTransfers do
  use Ecto.Migration

  # F-01 R-01.14 (#146): phone-to-phone chat history transfer. Ciphertext chunks only.
  def change do
    create table(:device_transfers, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :account_id, references(:accounts, type: :binary_id, on_delete: :delete_all),
        null: false

      add :from_device, :binary_id, null: false
      add :to_device, :binary_id, null: false
      add :state, :text, null: false, default: "sending"
      add :estimate, :bigint, null: false, default: 0
      add :bytes, :bigint, null: false, default: 0
      add :sent, :integer, null: false, default: 0
      add :acked, :integer, null: false, default: 0
      add :total, :integer
      add :updated_at, :utc_datetime_usec, null: false
      add :created_at, :utc_datetime_usec, null: false
    end

    create index(:device_transfers, [:account_id])
    create index(:device_transfers, [:to_device])
    create index(:device_transfers, [:updated_at])

    create table(:device_transfer_chunks, primary_key: false) do
      add :transfer_id, references(:device_transfers, type: :binary_id, on_delete: :delete_all),
        primary_key: true

      add :n, :integer, primary_key: true
      add :size, :integer, null: false
      add :ready, :boolean, null: false, default: false
    end
  end
end
