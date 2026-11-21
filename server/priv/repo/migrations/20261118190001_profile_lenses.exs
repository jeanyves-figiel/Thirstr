defmodule Thirstr.Repo.Migrations.ProfileLenses do
  @moduledoc """
  F-06 R-06.1 / R-06.1d (decision D-15, #96): one profile per account, shown through lenses.
  Adds `show_in`, merges extra Sport/Friends profiles into the main one, deletes them.
  Photos of deleted profiles stay in storage until the orphan sweep (beta only, a handful).
  """
  use Ecto.Migration

  @sport_keys ~w(sports sport_level gym schedule sport_intent clubs_visible)

  def up do
    alter table(:profiles) do
      add :show_in, {:array, :string}, null: false, default: ["hookup"]
    end

    flush()

    keys = "ARRAY[" <> Enum.map_join(@sport_keys, ",", &"'#{&1}'") <> "]"

    # Initial lenses from Here for, plus any extra profile the account had.
    execute("""
    UPDATE profiles n SET show_in = COALESCE(NULLIF(ARRAY(
      SELECT l FROM unnest(ARRAY['hookup','friends','sport']) WITH ORDINALITY AS u(l, o)
      WHERE (l = 'hookup' AND n.here_for::text[] && ARRAY['hookup','tonight','chat'])
         OR (l = 'friends' AND ('friends' = ANY(n.here_for)
              OR EXISTS (SELECT 1 FROM profiles x WHERE x.account_id = n.account_id AND x.kind = 'friends')))
         OR (l = 'sport' AND ('sport' = ANY(n.here_for)
              OR EXISTS (SELECT 1 FROM profiles x WHERE x.account_id = n.account_id AND x.kind = 'sport')))
      ORDER BY o), '{}'), ARRAY['hookup'])
    WHERE n.kind = 'now'
    """)

    # Sport fields (and their visibility) move to the main profile where it has none.
    execute("""
    UPDATE profiles n SET
      fields = COALESCE((SELECT jsonb_object_agg(k, v) FROM jsonb_each(s.fields) e(k, v)
                         WHERE k = ANY(#{keys})), '{}'::jsonb) || n.fields,
      visibility_map = COALESCE((SELECT jsonb_object_agg(k, v) FROM jsonb_each(s.visibility_map) e(k, v)
                                 WHERE k = ANY(#{keys})), '{}'::jsonb) || n.visibility_map
    FROM profiles s
    WHERE s.account_id = n.account_id AND s.kind = 'sport' AND n.kind = 'now'
    """)

    # Activity posts and RSVPs of a Sport profile move to the main profile.
    execute("""
    UPDATE activity_posts ap SET profile_id = n.id
    FROM profiles s JOIN profiles n ON n.account_id = s.account_id AND n.kind = 'now'
    WHERE ap.profile_id = s.id AND s.kind <> 'now'
    """)

    execute("DELETE FROM profiles WHERE kind <> 'now'")

    create unique_index(:profiles, [:account_id], name: :profiles_one_per_account)
  end

  def down do
    drop index(:profiles, [:account_id], name: :profiles_one_per_account)

    alter table(:profiles) do
      remove :show_in
    end
  end
end
