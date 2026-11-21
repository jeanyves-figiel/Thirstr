# Runbook: alerts (EN-06, #165)

One section per alert in `infra/alerts/rules.json`. Every push links straight to its section here. CI fails if a rule has no section.

Before anything: open `docs/runbooks/incident-response.md` › First 15 minutes if users are affected. SEV1 = act now, any hour. SEV2 = within 1 h in waking hours. SEV3 = never pushed, job summary only.

Common commands (`-a thirstr-api-prod` unless noted):
- Logs: `fly logs -a thirstr-api-prod`
- Machines: `fly status -a thirstr-api-prod`
- Remote shell: `fly ssh console -a thirstr-api-prod -C '/app/bin/thirstr rpc "<expr>"'`
- Roll back: run **Promote to production** with the previous image digest (`docs/runbooks/fly.md`).
- Kill switch: `docs/runbooks/flags.md`.
- Dashboards: Fly Grafana (`fly-metrics.net`, org `personal`), metrics in `docs/runbooks/monitoring.md`.

## api-down
**Meaning:** `https://api.thirstr.fun/health` (does `SELECT 1`) failed or did not return 200 for 4 min, checked from GitHub (outside Fly). App and site are down for everyone.
1. `fly status -a thirstr-api-prod`: machine stopped or crash-looping? `fly logs` for the boot error.
2. DB: `fly status -a thirstr-db-prod`. Health fails if Postgres is down; restart the DB machine.
3. Just deployed? Roll back to the previous digest.
4. Fly itself: https://status.flyio.net. Nothing to do but post on the status page (`incident` issue) and wait.
5. DNS / certificate: `dig api.thirstr.fun`, `fly certs show api.thirstr.fun`.

## api-errors
**Meaning:** more than 2 % of API requests returned 5xx for 5 min (only counted above 3 requests/min).
1. `fly logs` for the crashing route; `phoenix_router_dispatch_exception_count` by route in Grafana.
2. After a deploy → roll back. One feature → kill switch.
3. DB errors (`DBConnection`, timeouts) → see [api-slow](#api-slow).

## push-queue-stuck
**Meaning:** the oldest push job has waited over 2 min for 5 min. Messages, SOS and date check-in alerts reach phones late. SEV1 because safety alerts depend on it.
1. Machines up? (`fly status`). Oban runs on every API machine.
2. `thirstr_oban_jobs_count{queue="push"}` growing? A job stuck in `executing` → Oban Lifeline rescues after its timeout; restart the machine to free it now.
3. Push provider down? See [push-failing](#push-failing).
4. Tell users in the status page if safety alerts were late; log as an incident.

## api-slow
**Meaning:** p95 latency above 500 ms for 10 min.
1. `thirstr_repo_query_queue_time` high → DB pool or DB CPU (`fly status -a thirstr-db-prod`, machine metrics). Scale DB VM (`docs/runbooks/capacity.md`).
2. One hot route (Grafana by `route`) → recent change? roll back or flag off.
3. BEAM run queue high → scale API VM / add a machine.

## push-failing
**Meaning:** over 5 % of push sends are retrying for 10 min.
1. APNs: key valid? https://developer.apple.com/system-status/. FCM: service account valid? https://status.firebase.google.com.
2. `fly logs | grep -i push` for the error code (403 = credentials, 429 = rate, 5xx = provider).
3. Rotated credentials: set the Fly secret again (`docs/runbooks/fly.md` › Secrets).

## jobs-stuck
**Meaning:** a non-push Oban queue has a job waiting over 10 min.
1. Which queue: `thirstr_oban_jobs_oldest_available_s` by `queue`.
2. `fly ssh console … rpc "Oban.check_queue(queue: :default)"`; restart the machine if a worker is wedged.
3. Failing job? `oban_job_exception_count{worker}`, fix and redeploy; jobs retry on their own.

## valkey-down
**Meaning:** rate limits fell back to the per-node limiter (Valkey unreachable) in the last 5 min. Service works; limits are looser.
1. `fly status -a thirstr-valkey-prod`; restart the machine.
2. Volume full? `fly volumes list -a thirstr-valkey-prod`.

## db-filling
**Meaning:** database over 2.2 GB on a 3 GB volume.
1. Extend the volume, no downtime: `fly volumes extend <id> -s 6 -a thirstr-db-prod`.
2. Look for a table growing too fast (`docs/runbooks/capacity.md`); retention sweeps running? ([retention-overdue](#retention-overdue)).

## machine-memory
**Meaning:** an API machine uses over 400 MB of its 512 MB for 10 min. OOM restart likely.
1. Leak or load? Process count and run queue in Grafana.
2. Scale memory: `fly scale memory 1024 -a thirstr-api-prod` (`docs/runbooks/capacity.md`). Record it.

## retention-overdue
**Meaning:** rows are kept past their retention deadline + grace for 1 h. Privacy promise at risk (privacy above all).
1. Sweep failing? `oban_job_exception_count{worker="Thirstr.Jobs.ExpirySweep"}`, `fly logs | grep ExpirySweep`.
2. Run it now: `fly ssh console … rpc "Thirstr.Jobs.ExpirySweep.perform(nil)"`.
3. Rules in `Thirstr.Retention`. If data stayed longer than promised, record it in `docs/incidents/`.

## app-crash-rate
**Meaning:** crash-free sessions under 99.5 % over the last hour (only above 50 sessions/hour).
1. Top crashes: `docs/runbooks/monitoring.md` › App crashes.
2. One build → raise `min_build` (forced update). One feature → kill switch (`flags.md`).
3. Server change broke old builds → roll back the API.

## tls-expiring
**Meaning:** the certificate of `api.thirstr.fun` or `thirstr.fun` expires in under 14 days (Fly renews at 30), or the TLS check failed.
1. `fly certs show <host> -a thirstr-api-prod`: renewal error? Usually DNS changed at GoDaddy.
2. Fix DNS (`docs/runbooks/fly.md` › Domain), then `fly certs check <host>`.

## metrics-unreachable
**Meaning:** Fly Prometheus queries failed for 15 min. Every metric alert is blind; only [api-down](#api-down) and [tls-expiring](#tls-expiring) still work.
1. Token expired or revoked? Make a new read-only token and update the `FLY_METRICS_TOKEN` secret (`docs/runbooks/on-call.md` › Setup).
2. Fly metrics outage: https://status.flyio.net. Watch the app by hand until back.

## chat-backlog-old
**Meaning (SEV3, not pushed):** ciphertext has waited 25 days for an offline device; the 30-day sweep will drop it. Normal for phones left off. If many: chat pull broken (check `/mls/messages` errors).
