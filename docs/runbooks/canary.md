# Runbook: canary promotes + migration dry run (EN-12, #171)

Workflow "Promote to production" (`promote-prod.yml`). Scripts `scripts/ops/canary.sh`, `scripts/ops/restore-drill.sh`.

## What a promote does now
1. **verify** (unchanged): the digest is live on staging ≥ 30 min, staging smoke green.
2. **dry-run** (input `dry_run`, default on): restores the newest prod backup into a temporary machine in `fra` (port 5499, never archiving, destroyed after) and runs the new image's `/app/bin/migrate` against it. A failing migration stops the promote before prod is touched. ~3–6 min, a few cents.
3. **deploy**:
   - remembers the current prod image;
   - **canary** (input `canary_minutes`, default 10): runs the migrations once (one-off machine; expand-only, so the old image keeps working), moves **one** of the prod machines to the new image, smoke-tests it pinned with `fly-force-instance-id`, then for N minutes checks every 30 s: health on the canary (≤ 1 failure), no restart; at the end compares the canary with the old machines in Fly Prometheus: 5xx share ≤ max(2 %, old + 1 pt), p95 ≤ max(500 ms, 2 × old), 0 crashed requests. Real-traffic gates need ≥ 30 requests on the canary; below that (closed beta: prod sees little traffic) only the synthetic gates decide.
   - gate failed → the canary goes back to the previous image, run fails (red), nothing else changed; the table in the run summary says why;
   - gate passed → normal rolling `flyctl deploy` of the rest, smoke, and the existing auto-rollback if that smoke fails.

## Inputs
| Input | Default | When to change |
|---|---|---|
| `canary_minutes` | 10 | `0` only for an emergency rollback to a known-good digest (no canary, no wait). Up to 30 for risky changes. |
| `dry_run` | on | off only if backups are broken (and say so in `reason`) |

Thresholds: env `CANARY_MAX_5XX`, `CANARY_MAX_P95_MS`, `CANARY_MIN_REQUESTS`, `CANARY_MAX_PROBE_FAIL` (defaults in the script).

## When it fails
- **Dry run failed**: read the migrate log lines in the job output. Fix the migration on main; staging redeploys and the 30-min clock starts again. Prod untouched.
- **Canary gate failed**: prod is back on the old image on all machines (check: `scripts/fly-live-image.sh thirstr-api-prod` returns one digest). Migrations already ran (expand-only, safe). Read the summary table; reproduce on staging.
- **Canary rollback itself failed** (warning in the log): `flyctl machine update <canary id> --app thirstr-api-prod --image <previous image> --yes`, or re-run the promote with the previous digest and `canary_minutes=0`.
- Fewer than 2 machines running: the canary is skipped with a warning and the promote is a plain rolling deploy.

## Timing
A promote now takes ~20–25 min (dry run ~5, canary 10, rest ~3). Plan merge freezes with that in mind (release thread).
