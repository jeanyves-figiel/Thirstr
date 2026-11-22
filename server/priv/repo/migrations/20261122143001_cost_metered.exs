defmodule Thirstr.Repo.Migrations.CostMetered do
  use Ecto.Migration

  # EN-21 (#180, #326): vendors read automatically besides Fly. Amazon SES = emails counted as
  # they are sent; Tigris = bucket bytes measured daily. Aggregates only, no ids.
  def change do
    create table(:cost_metered_daily, primary_key: false) do
      add :day, :date, primary_key: true
      add :vendor, :text, primary_key: true
      # SES: recipients sent that day; Tigris: bytes stored
      add :units, :bigint, null: false, default: 0
      # Tigris: USD cents per 30 days at that size (run-rate, like cost_fly_daily)
      add :rate_cents_month, :integer
    end
  end
end
