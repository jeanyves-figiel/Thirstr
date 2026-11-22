defmodule Thirstr.Repo.Migrations.ReviewAfterPublish do
  use Ecto.Migration

  # F-15 R-15.56 (#325): borderline photos and Moments go live, reviewed after. Expand-only.
  def change do
    alter table(:moments) do
      add :after_review, :boolean, null: false, default: false
    end

    create index(:photos, [:review_state], where: "review_state IS NOT NULL")
  end
end
