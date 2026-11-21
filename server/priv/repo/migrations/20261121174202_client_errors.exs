defmodule Thirstr.Repo.Migrations.ClientErrors do
  use Ecto.Migration

  # EN-05 (#164): app crash / error reports, grouped, no account or device link, 30 d.
  def change do
    create table(:client_errors, primary_key: false) do
      add :signature, :text, primary_key: true
      add :platform, :text, null: false
      add :build, :integer
      add :fatal, :boolean, null: false, default: false
      add :message, :text, null: false
      add :stack, :text
      add :count, :integer, null: false, default: 1
      add :first_seen, :utc_datetime_usec, null: false, default: fragment("now()")
      add :last_seen, :utc_datetime_usec, null: false, default: fragment("now()")
    end

    create index(:client_errors, [:last_seen])
  end
end
