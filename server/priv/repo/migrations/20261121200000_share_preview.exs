defmodule Thirstr.Repo.Migrations.SharePreview do
  use Ecto.Migration

  # I-02 R-I02.2 (#8): name-only switch + a ≤ 2 KB preview made on the owner's phone.
  def change do
    alter table(:profile_shares) do
      add :show_photo, :boolean, null: false, default: true
      add :preview, :binary
      add :preview_photo_id, :uuid
    end
  end
end
