defmodule Thirstr.Repo.Migrations.DbCheckConstraints do
  use Ecto.Migration

  # DB-11 (#336, docs/spec/db-integrity.md): the database refuses values the app never writes, so a
  # raw-SQL bug can't store garbage. Added NOT VALID (no table scan under the ALTER lock), then
  # VALIDATE (scan under SHARE UPDATE EXCLUSIVE: reads and writes continue). Expand-only. Each list
  # matches the code that writes the column (named per constraint); adding a value = new migration.
  @checks [
    # Thirstr.Accounts.Account @statuses / @steps
    {:accounts, :accounts_status_check,
     "status IN ('active','paused','quarantined','suspended','banned','deleted')"},
    {:accounts, :accounts_onboarding_step_check,
     "onboarding_step IN ('basics','location','photo','verify','done')"},
    # Thirstr.Accounts.Device.platforms/0
    {:devices, :devices_platform_check, "platform IN ('ios','android','web')"},
    # Thirstr.Location: Hidden deletes the row, so only visible levels are stored
    {:location_cells, :location_cells_level_check, "level IN ('city','area','exact')"},
    # Thirstr.Profiles.check_photo / Moderation
    {:photos, :photos_status_check, "status IN ('pending','ok_main','ok_public','rejected')"},
    # Thirstr.Support.set_status/2
    {:support_requests, :support_requests_status_check, "status IN ('open','waiting','solved')"},
    # Thirstr.Linked @platforms
    {:linked_accounts, :linked_accounts_platform_check,
     "platform IN ('x','bluesky','onlyfans','jff','instagram')"},
    # F-15 severity scale 1–6
    {:reports, :reports_severity_check, "severity BETWEEN 1 AND 6"},
    {:parties, :parties_capacity_check, "capacity > 0"},
    {:activity_posts, :activity_posts_capacity_check, "capacity IS NULL OR capacity > 0"},
    {:mls_expired, :mls_expired_count_check, "count >= 0"},
    {:client_errors, :client_errors_count_check, "count >= 1"}
  ]

  def up do
    for {t, name, expr} <- @checks do
      execute "ALTER TABLE #{t} ADD CONSTRAINT #{name} CHECK (#{expr}) NOT VALID"
      execute "ALTER TABLE #{t} VALIDATE CONSTRAINT #{name}"
    end
  end

  def down do
    for {t, name, _} <- @checks,
        do: execute("ALTER TABLE #{t} DROP CONSTRAINT IF EXISTS #{name}")
  end
end
