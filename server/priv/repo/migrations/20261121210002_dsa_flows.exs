defmodule Thirstr.Repo.Migrations.DsaFlows do
  use Ecto.Migration

  # F-15 R-15.23–R-15.36 (#170): DSA notices (Art. 16), statement of reasons (Art. 17),
  # reviews for affected users and notifiers (Art. 20), misuse (Art. 23).
  def change do
    alter table(:reports) do
      add :illegal, :boolean, null: false, default: false
      # csam | intimate_images | threats | hate_speech | fraud | impersonation | ip | other
      add :legal_type, :string
      add :country, :string, size: 2
      add :explanation, :text
      add :good_faith, :boolean, null: false, default: false
      # app | web
      add :channel, :string, null: false, default: "app"
      add :ref, :string
      # removed | restricted | suspended | banned | warned | no_action
      add :decision, :string
      add :decided_at, :utc_datetime_usec
      add :automated, :boolean, null: false, default: false
      # open | upheld | overturned (R-15.32)
      add :notifier_review_state, :string
      add :notifier_review_text, :text
      add :notifier_review_reason, :text
      add :notifier_review_at, :utc_datetime_usec
      add :notifier_seen, :boolean, null: false, default: true
      # web notices only: AES-256-GCM sealed {name, email}; deleted with the report
      add :notifier_contact_enc, :binary
      # R-15.34: judged manifestly unfounded by a moderator
      add :unfounded, :boolean, null: false, default: false
    end

    create unique_index(:reports, [:ref])
    create index(:reports, [:reporter_account, :created_at])

    alter table(:moderation_actions) do
      # tos | law
      add :ground, :string, null: false, default: "tos"
      add :law_ref, :string
      add :facts, :string, size: 300
      # auto | report | staff
      add :detected_by, :string, null: false, default: "staff"
      # person | auto
      add :decided_by, :string, null: false, default: "person"
      add :appeal_until, :utc_datetime_usec
      add :appeal_reason, :string, size: 300
      add :appeal_decided_at, :utc_datetime_usec
      add :appeal_actor, :string
      add :reviewed_by_other, :boolean
    end

    execute(
      "UPDATE moderation_actions SET appeal_until = created_at + interval '6 months' WHERE appeal_until IS NULL",
      ""
    )
  end
end
