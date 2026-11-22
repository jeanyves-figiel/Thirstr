# Runbook: chaos experiments and game days (EN-15, #174)

**Staging only. Never prod.** Spec: `docs/spec/testing.md` › Chaos and game days. Tool: `scripts/chaos/chaos.sh`, run through Actions › **Chaos (staging)**.

## When
- Monthly game day on staging, first working Tuesday, 07:00 Zurich (before testers wake up), ~45 min.
- After any change to SR-03 (drain), SR-04 (outbox), SR-11 (Valkey fallback), DB config or Fly machine sizing: run the matching experiment once.
- Quarterly run in a load env: waits for a load env (no extra spend, 2026-11-21).

## Before
1. Tell the release orchestrator thread (or whoever owns promotions that day) and wait for "go": a promotion needs staging healthy for 30 min, and a chaos run makes the smoke red for a while.
2. No staging deploy or prod promotion running (the workflow checks and aborts too). No merge to `main` during the game day (each merge redeploys staging).
3. Grafana open (monitoring.md), Fly dashboard for `thirstr-api-staging` open.
4. Note the time; one person drives, one watches dashboards (solo: drive + watch).

## Run
Actions › Chaos (staging) › Run workflow:
- `experiment`: one of the table below, or `all` (runs them in order with 2 min rest between).
- `duration`: seconds the fault lasts where it applies (default 120, max 600).
- `confirm`: type `staging`.

| Experiment | Fault | Pass when | If it fails |
|---|---|---|---|
| `api-kill` | SIGKILL the API machine (no drain) | health back < 60 s, no 5xx after recovery | check Fly restart policy, `kill_timeout`; issue |
| `api-stop` | graceful stop (SR-03) | first request auto-starts it, back < 30 s | check `auto_start_machines`, Fly proxy logs |
| `valkey-down` | Valkey stopped for `duration` | health + welcome + config stay 200 (≤ 1 % errors) | SR-11 fallback broken: P1 issue |
| `db-restart` | Postgres stop → start | errors only while DB down; back < 60 s after start, API not restarted | pool reconnect settings (Ecto `queue_target`), issue |
| `disk-fill` | API root disk filled to 95 % for `duration` | API keeps answering; file removed after | log volume / tmp usage; issue |

The job summary shows per experiment: requests, errors, longest outage, recovery time, p95 latency, PASS/FAIL. A FAIL fails the run.

## Manual game-day checklist (not automated)
Do one per game day, in rotation, and log it below:
- **Expired APNs key**: set `APNS_KEY_P8` on staging to a revoked key, restart API, send a chat to a TestFlight phone → push fails cleanly (Oban retries, error metric + alert, no crash), messages still arrive on app open. Restore the real secret.
- **Tigris outage**: set `S3_ENDPOINT` on staging to an unroutable host (`https://192.0.2.1`), restart → photo upload shows a retry error, profiles without photo still load, chat text works. Restore.
- **Lost phone / restore**: link a second device, wipe the first, recovery phrase restore (F-01 R-01.7).
- **DB failover** (after EN-01 #160), **region split** (after EN-02 #161).
- **Backup restore drill**: `docs/runbooks/db-backups.md`.

## Safety rules
- The script only knows `thirstr-api-staging`, `thirstr-db-staging`, `thirstr-valkey-staging`; anything containing `prod` aborts before any API call.
- Every experiment restores state in a `trap` (machines started, fill file removed), also on failure or cancel. If a run is cancelled hard (runner lost), check the three apps: `curl -H "Authorization: Bearer $FLY_TOKEN" https://api.machines.dev/v1/apps/<app>/machines | jq '.[]|{id,state}'` and start any `stopped` machine (`POST …/machines/<id>/start`).
- Stopping/starting machines does not change the image or the `launch`/`update` events that `scripts/fly-live-image.sh` uses, so the 30 min promotion window is not reset; still, never run chaos while a promotion is in progress.

## After
1. Log the run in the table below (date, experiments, result, link to the run).
2. Each FAIL or surprise → GitHub issue (label `reliability`) or a runbook change, linked in the log.
3. Tell the orchestrator thread that staging is back.

## Log
| Date | Who | Experiments | Result | Follow-ups |
|---|---|---|---|---|
| — | — | — | first run pending | — |
