defmodule Thirstr.Repo.Migrations.HideTimestamps do
  use Ecto.Migration

  # #111 Settings › Hidden & blocked lists hides newest first.
  def change do
    alter table(:profile_hides) do
      add :created_at, :utc_datetime_usec, null: false, default: fragment("now()")
    end
  end
end
