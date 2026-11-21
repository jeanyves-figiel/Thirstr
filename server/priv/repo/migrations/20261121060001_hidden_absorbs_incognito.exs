defmodule Thirstr.Repo.Migrations.HiddenAbsorbsIncognito do
  use Ecto.Migration

  # #114 (F-05 R-05.7): Incognito merged into Hidden. Hidden gets an optional end time and
  # the level to come back as. Incognito accounts become Hidden "until I switch", coming
  # back as their previous City/Area level (Exact → Area). The column stays (unused) until
  # old app builds are gone.
  def up do
    alter table(:accounts) do
      add :hidden_until, :utc_datetime
      add :hidden_return, :string
    end

    flush()

    execute("""
    UPDATE accounts a SET hidden = true, incognito = false,
      hidden_return = COALESCE((
        SELECT CASE WHEN lc.level = 'city' THEN 'city' ELSE 'area' END
        FROM location_cells lc JOIN profiles p ON p.id = lc.profile_id
        WHERE p.account_id = a.id LIMIT 1), 'area')
    WHERE a.incognito
    """)

    execute("""
    DELETE FROM location_cells WHERE profile_id IN (
      SELECT p.id FROM profiles p JOIN accounts a ON a.id = p.account_id WHERE a.hidden)
    """)
  end

  def down do
    alter table(:accounts) do
      remove :hidden_until
      remove :hidden_return
    end
  end
end
