defmodule Thirstr.Jobs.ExpirySweep do
  @moduledoc "Retention sweeps (data-model.md › Retention). Seeded DEV profiles are exempt."
  use Oban.Worker, queue: :maintenance

  import Ecto.Query

  @impl true
  def perform(_job) do
    Thirstr.Repo.delete_all(
      from lc in "location_cells",
        join: p in "profiles",
        on: p.id == lc.profile_id,
        where: lc.updated_at < ago(24, "hour") and p.seeded == false
    )

    # taps expire after 7 days (data-model.md)
    Thirstr.Repo.query!("DELETE FROM taps WHERE created_at < now() - interval '7 days'")
    # ciphertext queue 30 d, franking tags 90 d, expired media blobs (R-07.12, R-08.10)
    Thirstr.Chat.sweep()
    # SR-04: revoked devices not resumed within 7 d (their queued ciphertext goes with them)
    Thirstr.Accounts.purge_revoked_devices()
    Thirstr.Verification.sweep()
    # F-20 R-20.4: trips end at 12:00 UTC the day after their last day
    Thirstr.Trips.sweep()
    # F-21 R-21.22: Moments and their files are gone at expiry
    Thirstr.Moments.sweep()
    Thirstr.Linked.recheck()
    # EN-05: app error groups 30 d after last seen
    Thirstr.ClientErrors.sweep()
    # F-01 R-01.15: unfinished chat-backup uploads, idle backups
    Thirstr.ChatBackup.sweep()
    # F-01 R-01.14: history transfers idle 2 h or finished
    Thirstr.Transfer.sweep()
    # F-22 (#178): solved requests 90 d, feedback 30 d, help notes 90 d, security events 1 y
    Thirstr.Support.sweep()
    Thirstr.Feedback.sweep()
    Thirstr.Help.sweep()
    Thirstr.RecoveryClaims.sweep()
    :ok
  end
end
