defmodule Thirstr.Repo.Migrations.Support do
  use Ecto.Migration

  # F-22 (#178): help & support. Requests + thread, saved replies, anonymous help votes,
  # feedback queue (text deleted once the GitHub issue exists), recovery claims + security events.
  def change do
    create table(:support_requests, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :ref, :text, null: false
      add :account_id, references(:accounts, type: :binary_id, on_delete: :delete_all)
      add :topic, :text, null: false
      add :lang, :text, null: false, default: "en"
      add :status, :text, null: false, default: "open"
      add :reply_email, :text
      add :app_details, :map
      add :unread_member, :boolean, null: false, default: false
      add :created_at, :utc_datetime_usec, null: false, default: fragment("now()")
      add :updated_at, :utc_datetime_usec, null: false, default: fragment("now()")
      add :solved_at, :utc_datetime_usec
    end

    create unique_index(:support_requests, [:ref])
    create index(:support_requests, [:account_id])
    create index(:support_requests, [:status, :created_at])
    create index(:support_requests, [:solved_at])

    create table(:support_messages) do
      add :request_id,
          references(:support_requests, type: :binary_id, on_delete: :delete_all),
          null: false

      add :from, :text, null: false
      add :body, :text, null: false
      add :attachments, {:array, :text}, null: false, default: []
      add :macro_id, :bigint
      add :created_at, :utc_datetime_usec, null: false, default: fragment("now()")
    end

    create index(:support_messages, [:request_id, :id])

    create table(:support_macros) do
      add :title, :text, null: false
      add :lang, :text, null: false
      add :body, :text, null: false
      add :updated_at, :utc_datetime_usec, null: false, default: fragment("now()")
    end

    create unique_index(:support_macros, [:title, :lang])

    create table(:help_votes, primary_key: false) do
      add :article, :text, primary_key: true
      add :lang, :text, primary_key: true
      add :day, :date, primary_key: true
      add :up, :integer, null: false, default: 0
      add :down, :integer, null: false, default: 0
      add :reasons, :map, null: false, default: %{}
    end

    create table(:help_notes) do
      add :article, :text, null: false
      add :lang, :text, null: false
      add :reason, :text
      add :note, :text, null: false
      add :created_at, :utc_datetime_usec, null: false, default: fragment("now()")
    end

    create index(:help_notes, [:created_at])

    create table(:feedback, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :created_on, :date, null: false, default: fragment("current_date")
      add :kind, :text, null: false
      add :part, :text
      add :text_scrubbed, :text
      add :text_hash, :binary, null: false
      add :app, :map
      add :state, :text, null: false, default: "queued"
      add :issue_number, :integer
      add :created_at, :utc_datetime_usec, null: false, default: fragment("now()")
    end

    create index(:feedback, [:text_hash, :created_on])
    create index(:feedback, [:state])

    create table(:recovery_claims, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :account_id, references(:accounts, type: :binary_id, on_delete: :delete_all),
        null: false

      add :device_id, :binary_id, null: false
      add :install_hash, :binary
      add :method, :text, null: false
      add :state, :text, null: false, default: "started"
      add :attempts, :integer, null: false, default: 0
      add :hold_ends_at, :utc_datetime_usec
      add :created_at, :utc_datetime_usec, null: false, default: fragment("now()")
      add :ended_at, :utc_datetime_usec
    end

    create index(:recovery_claims, [:account_id, :created_at])

    create unique_index(:recovery_claims, [:account_id],
             where: "state IN ('started','selfie_passed','holding','ready','conflict')",
             name: :recovery_claims_one_active
           )

    create table(:security_events) do
      add :account_id, :binary_id, null: false
      add :kind, :text, null: false
      add :install_hash, :binary
      add :at, :utc_datetime_usec, null: false, default: fragment("now()")
    end

    create index(:security_events, [:account_id, :at])
    create index(:security_events, [:at])

    execute(
      "CREATE RULE security_events_no_update AS ON UPDATE TO security_events DO INSTEAD NOTHING",
      "DROP RULE IF EXISTS security_events_no_update ON security_events"
    )
  end
end
