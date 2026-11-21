defmodule Thirstr.Repo.Migrations.PreciseDistance do
  use Ecto.Migration

  # #197 F-05 R-05.13: opt-in "Show closer distance" on Area. The device also sends its H3 r10
  # cell (~65 m edge); display_res 10 when precise and the r9 cell has >= 3 visible profiles.
  def change do
    alter table(:location_cells) do
      add :cell_r10, :bigint
      add :precise, :boolean, null: false, default: false
    end
  end
end
