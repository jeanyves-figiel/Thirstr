defmodule Thirstr.Repo.Migrations.ChatReliability do
  use Ecto.Migration

  # F-07 R-07.18 (idempotent send), R-07.22 (expired counts), R-07.24 (delivery latency).
  def change do
    # (sender device, client_id) → first result; repeats store and push nothing. Swept after 7 d.
    create table(:mls_send_keys, primary_key: false) do
      add :device_id, :binary_id, primary_key: true
      add :client_id, :string, primary_key: true
      add :result, :map
      add :created_at, :utc_datetime_usec, null: false
    end

    create index(:mls_send_keys, [:created_at])

    # Swept-unread app messages per recipient device and group (count only, no ids/pairs).
    create table(:mls_expired, primary_key: false) do
      add :to_device_id, references(:devices, type: :binary_id, on_delete: :delete_all),
        null: false

      add :group_id, :binary, null: false
      add :count, :integer, null: false
      add :created_at, :utc_datetime_usec, null: false
    end

    create index(:mls_expired, [:to_device_id])

    # Aggregate insert → ack latency histogram per day (no ids, no pairs).
    create table(:chat_delivery_stats, primary_key: false) do
      add :day, :date, primary_key: true
      add :bucket, :integer, primary_key: true
      add :n, :bigint, null: false, default: 0
    end
  end
end
