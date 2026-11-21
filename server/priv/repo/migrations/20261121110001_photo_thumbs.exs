defmodule Thirstr.Repo.Migrations.PhotoThumbs do
  use Ecto.Migration

  # SR-10 (#150): small card-size copy of each public photo (grid, lists).
  def change do
    alter table(:photos) do
      add :thumb_key, :text
    end
  end
end
