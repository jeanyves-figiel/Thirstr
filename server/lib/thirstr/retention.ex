defmodule Thirstr.Retention do
  @moduledoc """
  EN-17 (#176): proof that retention rules (data-model.md › Retention) actually delete.

  For each rule: how many rows are past their deadline plus a grace longer than the sweep
  period (ExpirySweep every 15 min, Minutely every minute). Should always be 0. Exported as
  `thirstr_retention_overdue{rule}` (counts only, no ids); alert in docs/runbooks/monitoring.md.
  Counts are capped at 10 000 rows so a broken sweep can't make the probe itself expensive.
  """
  alias Thirstr.Repo

  @cap 10_000

  # {rule, table, overdue condition}; grace = rule + 1 h (+1 d for day-scale rules)
  @rules [
    {"ciphertext_30d", "mls_messages", "created_at < now() - interval '31 days'"},
    {"location_24h", "location_cells lc JOIN profiles p ON p.id = lc.profile_id",
     "lc.updated_at < now() - interval '25 hours' AND NOT p.seeded"},
    {"taps_7d", "taps", "created_at < now() - interval '7 days 1 hour'"},
    {"tonight_expiry", "tonight_plans", "expires_at < now() - interval '2 hours'"},
    {"activity_expiry", "activity_posts", "expires_at < now() - interval '2 hours'"},
    {"now_expiry", "now_status", "expires_at < now() - interval '1 hour'"},
    {"moments_expiry", "moments", "expires_at < now() - interval '1 hour'"},
    {"safety_released_24h", "safety_msgs", "release_at < now() - interval '25 hours'"},
    {"franking_90d", "franking_tags", "created_at < now() - interval '91 days'"},
    {"client_errors_30d", "client_errors", "last_seen < now() - interval '31 days'"},
    {"backup_segments_24h", "chat_backup_segments",
     "NOT committed AND created_at < now() - interval '25 hours'"},
    {"chat_backup_idle", "chat_backups", "updated_at < now() - interval '211 days'"},
    {"transfer_2h", "device_transfers", "updated_at < now() - interval '2 hours 20 minutes'"},
    {"csam_evidence_1y", "csam_cases",
     "evidence_key IS NOT NULL AND state <> 'open' AND hold_until < now() - interval '1 hour'"},
    # F-22 (#178)
    {"support_solved_90d", "support_requests",
     "status = 'solved' AND solved_at < now() - interval '91 days'"},
    {"feedback_30d", "feedback", "created_on < current_date - 31"},
    {"help_notes_90d", "help_notes", "created_at < now() - interval '91 days'"},
    {"security_events_1y", "security_events", "at < now() - interval '1 year 1 day'"}
  ]

  @queries for {rule, from, where} <- @rules,
               do:
                 {rule,
                  "SELECT count(*) FROM (SELECT 1 FROM #{from} WHERE #{where} LIMIT #{@cap}) x"}

  def rules, do: Enum.map(@rules, &elem(&1, 0))

  @doc "[{rule, overdue_count}]"
  def overdue, do: for({rule, sql} <- @queries, do: {rule, count(sql)})

  # Only the compile-time @queries above reach this; no runtime input.
  # sobelow_skip ["SQL.Query"]
  defp count(sql), do: hd(hd(Repo.query!(sql).rows))

  @doc false
  def measure do
    for {rule, n} <- overdue(),
        do: :telemetry.execute([:thirstr, :retention], %{overdue: n}, %{rule: rule})

    :ok
  rescue
    _ -> :ok
  end
end
