# Runbook: metrics & alerts (SR-07, #147)

## Where
- API machines export Prometheus metrics on the internal port `9091` (`/metrics`, 6PN only, not in `[http_service]`). Fly managed Prometheus scrapes it via `[metrics]` in `infra/fly/api-<env>.toml`.
- Dashboards + alerts: Fly managed Grafana (`fly-metrics.net`, org `personal`), data source "Prometheus on Fly". EU only.
- Content-free by design: counts, ages, durations, route templates, status codes. No ids, names, pairs or coordinates (test `metrics_test.exs`).

## Metrics
| Metric | Meaning |
|---|---|
| `phoenix_router_dispatch_stop_duration{route,status}` | API latency histogram (ms) per route template + status |
| `phoenix_router_dispatch_exception_count{route}` | crashes per route |
| `phoenix_socket_connected_count{result}` | realtime connects (ok / error) |
| `thirstr_repo_query_total_time`, `_queue_time` | DB query time; queue time = pool pressure |
| `vm_memory_total`, `vm_total_run_queue_lengths_total`, `vm_system_counts_process_count` | BEAM health |
| `oban_job_stop_count{worker,state}`, `oban_job_exception_count{worker}`, `oban_job_stop_duration{worker}` | jobs done / failed / time |
| `thirstr_oban_jobs_count{queue,state}`, `thirstr_oban_jobs_oldest_available_s{queue}` | queue depth and wait |
| `thirstr_chat_backlog_count`, `thirstr_chat_backlog_oldest_s` | ciphertext waiting for offline devices; oldest age |
| `thirstr_push_send_count{platform,outcome}` | push sends: `ok`, `retry`, `skipped` |
| `thirstr_valkey_fallback_count` | rate limits served by the per-node fallback (Valkey unreachable) |
| `thirstr_db_size_bytes` | database size (volume is 3 GB on prod) |
| `thirstr_retention_overdue{rule}` | rows past their retention deadline + grace, per rule (EN-17; should be 0, probe every 5 min, capped at 10 000) |
| `thirstr_client_session_count{platform}` | app starts (one ping per start, anonymous; EN-05) |
| `thirstr_client_error_count{platform,fatal}` | app error reports; `fatal="true"` = crash (EN-05) |

## Alert rules (Grafana → Alerting, contact point = owner email/phone)
| Alert | Rule | For | First steps |
|---|---|---|---|
| API errors | `sum(rate(phoenix_router_dispatch_stop_duration_count{status=~"5.."}[5m])) / sum(rate(phoenix_router_dispatch_stop_duration_count[5m])) > 0.02` | 5 m | `fly logs -a thirstr-api-prod`; last deploy? roll back with "Promote to production" (previous digest) |
| API slow | `histogram_quantile(0.95, sum by (le) (rate(phoenix_router_dispatch_stop_duration_bucket[5m]))) > 500` | 10 m | DB `queue_time` high → pool/DB CPU; else hot route |
| Push failing | `sum(rate(thirstr_push_send_count{outcome="retry"}[10m])) / sum(rate(thirstr_push_send_count[10m])) > 0.05` | 10 m | APNs key / FCM account valid? Apple status page |
| Jobs stuck | `max(thirstr_oban_jobs_oldest_available_s{queue="push"}) > 120` or `{queue="default"} > 600` | 5 m | machine down? `oban_jobs` executing too long → Lifeline |
| Chat backlog old | `thirstr_chat_backlog_oldest_s > 86400 * 25` | 1 h | devices offline near the 30 d sweep (normal), or pull broken (check `/mls/messages` errors) |
| Valkey down | `increase(thirstr_valkey_fallback_count[5m]) > 0` | 5 m | `thirstr-valkey-prod` machine state; restart |
| DB filling | `max(thirstr_db_size_bytes) > 2.2e9` | 30 m | extend volume (Fly volume extend, no downtime) |
| Machine memory | `max(vm_memory_total) > 400e6` (512 MB VMs) | 10 m | scale VM memory (SR-12) |
| Backups stale | DB machine log `backup-loop: … FAILED`, or no `backup ok` in 26 h | — | `docs/runbooks/db-backups.md` › Check |

| Retention overdue | `max by (rule) (thirstr_retention_overdue) > 0` | 1 h | sweep job failing? `oban_job_exception_count{worker="Thirstr.Jobs.ExpirySweep"}`; run `Thirstr.Jobs.ExpirySweep.perform(nil)` via rpc; rules in `Thirstr.Retention` |
| App crash rate | `sum(increase(thirstr_client_error_count{fatal="true"}[1h])) / sum(increase(thirstr_client_session_count[1h])) > 0.005` (crash-free < 99.5 %) | 1 h | see App crashes below; bad build → raise `min_build` or kill the feature (`flags.md`) |

Set up once per environment; staging alerts go to a muted contact point.

## SLO burn-rate alerts (EN-04, #163; spec `docs/spec/slos.md` › 3)
`ERR(W)` = `(sum(rate(phoenix_router_dispatch_stop_duration_count{app="thirstr-api-prod",status=~"5.."}[W])) or vector(0)) / sum(rate(phoenix_router_dispatch_stop_duration_count{app="thirstr-api-prod"}[W]))`. Budget `B` = 0.001 (99.9 %). Same shape for SLO-3/4 with the slow ratio (`le="500"` / `le="300"`) and `B` = 0.05, and SLO-5 with the crash ratio and `B` = 0.005.

| Alert | Rule | Guard | Contact |
|---|---|---|---|
| SLO-1 fast burn | `ERR(1h) > 14.4*B and ERR(5m) > 14.4*B` | `sum(increase(…_count[1h])) >= 100` | phone (page) |
| SLO-1 slow burn | `ERR(6h) > 6*B and ERR(30m) > 6*B` | `sum(increase(…_count[6h])) >= 100` | phone (page) |
| SLO-1 budget drain | `ERR(3d) > B and ERR(6h) > B` | `sum(increase(…_count[3d])) >= 100` | email |
| SLO-3/4/5 | same three rows with their ratio and `B` | same | email (no page in closed beta) |

These replace "API errors" above for paging once set up; keep "API errors" as the email-only early signal. The weekly review (`slo-review.md`) checks which fired.

## App crashes (EN-05, #164)
In-house, no vendor SDK. The app (`src/app/crash.ts`) reports JS errors to `POST /v1/client/errors`: platform, build, message, stack only (no account, device or install id). Fatal errors and render crashes are queued on the phone and sent on the next start; one ping per start goes to `POST /v1/client/sessions`. The server scrubs emails, URLs, ids, tokens and long numbers, groups by signature (platform + build + message + top of stack) in `client_errors`, and deletes groups idle 30 days. Rate limit 120 reports per IP per hour.

- **Crash-free sessions** = `1 - fatal reports / session pings` (Grafana, per platform and day). Targets: `docs/spec/enterprise-readiness.md`.
- **Top errors**: `fly ssh console -a thirstr-api-<env> -C '/app/bin/thirstr rpc "Thirstr.ClientErrors.recent(20) |> IO.inspect(limit: :infinity)"'`.
- Native crashes (outside JS) are not caught; App Store Connect / Play Console crash reports cover them.
