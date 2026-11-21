defmodule Thirstr.Repo.Migrations.MemberPlaces do
  use Ecto.Migration

  # #191 F-12 R-12.11: members add a place where they are (added_by = 'member'). The creator is
  # kept for abuse handling and the daily limit only; it is never shown to anyone.
  def change do
    alter table(:venues) do
      add :created_by, references(:accounts, type: :binary_id, on_delete: :nilify_all)
    end

    create index(:venues, [:created_by, :created_at], where: "created_by IS NOT NULL")
    create index(:venues, [:created_at], where: "added_by = 'member'", name: :venues_member_idx)
    # viewport (GET /places) and the duplicate guard both filter on coordinates
    create index(:venues, [:lat, :lng])
  end
end
