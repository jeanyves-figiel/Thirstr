defmodule Thirstr.Repo.Migrations.OnceBlobs do
  use Ecto.Migration

  # #159 video check (F-18 R-18.12): one-time blobs bound to their first fetcher.
  def change do
    alter table(:media_blobs) do
      add :once, :boolean, null: false, default: false
      add :fetched_by, :binary_id
      add :fetched_at, :utc_datetime_usec
    end

    create index(:media_blobs, [:fetched_at], where: "once")
  end
end
