defmodule Thirstr.Repo.Migrations.TestBotHandles do
  use Ecto.Migration

  # testing.md › Chat test bots (#200): several bots, one account each, keyed by handle.
  def up do
    alter table(:accounts) do
      add :test_bot_handle, :string
    end

    create unique_index(:accounts, [:test_bot_handle], where: "test_bot_handle IS NOT NULL")
    execute "UPDATE accounts SET test_bot_handle = 'testbot' WHERE test_bot"
  end

  def down do
    drop index(:accounts, [:test_bot_handle])

    alter table(:accounts) do
      remove :test_bot_handle
    end
  end
end
