defmodule Thirstr.Repo.Migrations.TestBot do
  use Ecto.Migration

  # T-BOT (testing.md › Chat test bot): marks the staging-only automated test account.
  def change do
    alter table(:accounts) do
      add :test_bot, :boolean, null: false, default: false
    end
  end
end
