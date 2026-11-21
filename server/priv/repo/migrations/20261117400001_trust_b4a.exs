defmodule Thirstr.Repo.Migrations.TrustB4a do
  use Ecto.Migration

  # B4a: reports + franking (F-15 R-15.9), vouches (F-18), admin audit log (admin-console.md).
  def change do
    create table(:reports, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :reporter_account, references(:accounts, type: :binary_id, on_delete: :nilify_all)

      add :target_account, references(:accounts, type: :binary_id, on_delete: :delete_all),
        null: false

      add :target_profile, :binary_id
      # spam_bot | scam | underage | harassment | non_consensual | hate | impersonation | other
      add :reason, :string, null: false
      # profile | chat | photo | party
      add :context, :string, null: false, default: "profile"
      add :note, :string, size: 500

      # [{text, at}] — only messages whose franking tag verified (R-07.11); never other chat data
      add :franked, :map
      add :severity, :integer, null: false
      # open | actioned | dismissed
      add :state, :string, null: false, default: "open"
      add :action, :string
      add :created_at, :utc_datetime_usec, null: false
      add :resolved_at, :utc_datetime_usec
    end

    create index(:reports, [:state, :severity, :created_at])
    create index(:reports, [:target_account, :created_at])

    create unique_index(:reports, [:reporter_account, :target_account, :reason],
             where: "state = 'open'",
             name: :reports_open_once
           )

    create table(:vouches, primary_key: false) do
      add :from_account, references(:accounts, type: :binary_id, on_delete: :delete_all),
        null: false

      add :to_profile, references(:profiles, type: :binary_id, on_delete: :delete_all),
        null: false

      add :created_at, :utc_datetime_usec, null: false
    end

    create unique_index(:vouches, [:from_account, :to_profile])
    create index(:vouches, [:to_profile])

    # Append-only (R-AD.4): who, what, hashed object id, reason, time.
    create table(:admin_audit, primary_key: false) do
      add :id, :bigserial, primary_key: true
      add :actor, :string, null: false
      add :action, :string, null: false
      add :object_hash, :string
      add :reason, :string
      add :at, :utc_datetime_usec, null: false
    end

    alter table(:moderation_actions) do
      add :ends_at, :utc_datetime_usec
      add :report_id, :binary_id
      add :seen, :boolean, null: false, default: false
    end

    # F-18 R-18.2/3/4: decayed, reciprocal-discounted, capped vouch count.
    execute(
      """
      CREATE FUNCTION vouch_count(p uuid) RETURNS int LANGUAGE sql STABLE AS $$
        SELECT least(20, floor(coalesce(sum(
          CASE WHEN v.created_at > now() - interval '6 months' THEN 1.0
               ELSE greatest(0.0, 1.0 - extract(epoch FROM now() - v.created_at - interval '6 months') / (86400.0 * 182))
          END
          * CASE WHEN EXISTS (SELECT 1 FROM vouches w JOIN profiles wp ON wp.id = w.to_profile
                              WHERE wp.account_id = v.from_account
                                AND w.from_account = (SELECT account_id FROM profiles WHERE id = v.to_profile))
                 THEN 0.5 ELSE 1.0 END), 0)))::int
        FROM vouches v JOIN accounts va ON va.id = v.from_account
        WHERE v.to_profile = p AND va.status IN ('active', 'paused')
      $$
      """,
      "DROP FUNCTION vouch_count(uuid)"
    )

    execute(
      "CREATE RULE admin_audit_no_update AS ON UPDATE TO admin_audit DO INSTEAD NOTHING",
      "DROP RULE admin_audit_no_update ON admin_audit"
    )

    execute(
      "CREATE RULE admin_audit_no_delete AS ON DELETE TO admin_audit DO INSTEAD NOTHING",
      "DROP RULE admin_audit_no_delete ON admin_audit"
    )
  end
end
