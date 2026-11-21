# SLOs, error budgets & status page (EN-04, #163)

Status: specified 2026-11-21 · Targets come from [`enterprise-readiness.md`](enterprise-readiness.md) › 1. Metrics from SR-07 ([`docs/runbooks/monitoring.md`](../runbooks/monitoring.md)). Runbooks: [`slo-review.md`](../runbooks/slo-review.md), [`status-page.md`](../runbooks/status-page.md).

## 1. Principles
- An SLO is a promise about what people feel (can I sign in, does my message arrive, does the map load), measured from metrics we already have. No new vendor, no new spend.
- Objectives are measured from today at **open-beta level** (the first column with numbers). In closed beta the error budget is advisory: burning it pauses risky releases (§4) but nobody is paged at night for a slow burn.
- All SLIs are content-free (counts and durations per route template), like every SR-07 metric.

## 2. SLOs (rolling 28 days unless said)
| ID | SLO | SLI (good / valid) | Objective | Budget / 28 d |
|---|---|---|---|---|
| SLO-1 | API available | requests not answered 5xx / all requests (`phoenix_router_dispatch_stop_duration_count`) | 99.9 % | 0.1 % of requests (≈ 40 min of full outage) |
| SLO-2 | API reachable from outside | successful external probes / all probes (status page prober, §5, every 5 min from GitHub) | 99.9 % | ≈ 8 failed probes |
| SLO-3 | Messages delivered fast | message relay requests (`route="/v1/mls/messages"`: send + pull) answered < 500 ms / all | 95 % (p95 < 500 ms) | 5 % slow |
| SLO-4 | Map and grid load fast | Explore reads (`/v1/explore/{grid,map,tray,summary}`) answered < 300 ms / all | 95 % (p95 < 300 ms) | 5 % slow |
| SLO-5 | App doesn't crash | sessions without a fatal report / sessions (`thirstr_client_session_count`, `thirstr_client_error_count{fatal="true"}`, EN-05) | 99.5 % | 0.5 % of sessions |
| SLO-6 | Nothing kept too long | retention probes at 0 (`thirstr_retention_overdue`, EN-17) | 100 % of 5-min probes over 1 h | none: any breach is an incident |

Not SLOs (alerts only, monitoring.md): push retries, job queues, backups, DB size, memory.

PromQL (recording form; `[28d]` for the report, `[1h]`/`[5m]`/`[6h]`/`[30m]`/`[3d]` for burn rates):
```promql
# SLO-1 error ratio
sum(rate(phoenix_router_dispatch_stop_duration_count{app="thirstr-api-prod",status=~"5.."}[W]))
  / sum(rate(phoenix_router_dispatch_stop_duration_count{app="thirstr-api-prod"}[W]))
# SLO-3 slow ratio (bucket le="500" = good)
1 - sum(rate(phoenix_router_dispatch_stop_duration_bucket{app="thirstr-api-prod",route="/v1/mls/messages",le="500"}[W]))
      / sum(rate(phoenix_router_dispatch_stop_duration_count{app="thirstr-api-prod",route="/v1/mls/messages"}[W]))
# SLO-4 slow ratio (le="300")
1 - sum(rate(phoenix_router_dispatch_stop_duration_bucket{app="thirstr-api-prod",route=~"/v1/explore/(grid|map|tray|summary)",le="300"}[W]))
      / sum(rate(phoenix_router_dispatch_stop_duration_count{app="thirstr-api-prod",route=~"/v1/explore/(grid|map|tray|summary)"}[W]))
# SLO-5 crash ratio
sum(increase(thirstr_client_error_count{fatal="true"}[W])) / sum(increase(thirstr_client_session_count[W]))
```
Latency buckets (ms, `ThirstrWeb.Telemetry`): 5, 10, 25, 50, 100, 250, **300**, **500**, 1000, 2500, 5000, 10000; 300 and 500 are the SLO thresholds. Windows from before the `300` bucket (2026-11-21) fall back to `le="250"` (stricter).

**Which app:** the SLOs and alerts are defined on `thirstr-api-prod`. During the closed beta the TestFlight app talks to **staging**, so prod only sees probes and smoke tests; the weekly report shows both `prod` and `staging` (staging = where testers really are) until the store app points at prod.

## 3. Burn-rate alerts (Grafana, monitoring.md)
Multi-window, multi-burn-rate (Google SRE workbook). `B` = budget ratio (1 − objective).

| Severity | Condition (both windows) | Budget used if it lasts | Action |
|---|---|---|---|
| Page | error ratio > 14.4 × B over 1 h **and** 5 m | 2 % in 1 h | phone push to owner; incident-response.md |
| Page | > 6 × B over 6 h **and** 30 m | 5 % in 6 h | phone push |
| Ticket | > 1 × B over 3 d **and** 6 h | 10 % in 3 d | email; review at the weekly SLO review |

Low traffic guard: alerts need ≥ 100 requests in the long window (closed beta has a few hundred requests an hour), so one failed request at 03:00 never pages.

## 4. Error budget policy
- Budget left > 50 %: ship normally.
- 0–50 % left: risky changes (migrations marked contract, new realtime paths, infra) wait for the weekly review; fixes and flags ship.
- Exhausted: only fixes for the SLO in question and security fixes are promoted to prod until the 28-day window is back above 0. Canary (EN-12) stays on.
- An incident that burned > 20 % of a budget gets a post-mortem (`docs/incidents/`, incident-response.md).

## 5. Weekly SLO review
- Workflow `slo-report.yml`, Mondays 07:00 UTC (+ manual): queries Fly Prometheus (read-only token, same `FLY_TOKEN`), plus the status prober history, and posts a comment on the pinned GitHub issue **"SLO weekly review"** (label `slo`): per SLO the 7-day and 28-day value, objective, budget left, trend arrow, and the incidents of the week. Also written to the run summary.
- Owner reads it, ticks the actions (budget policy in §4), closes nothing: the issue is the log.

## 6. Public status page `status.thirstr.fun`
Mockup approved for build: [status page mockup](https://claude.ai/artifact/FWvUNrAiMp5mZPoXQpMwAo). Hosting: **GitHub Pages** of this public repo (owner choice 2026-11-21: free, no new account, independent of Fly).

### 6.1 Independence
- Static files only, on GitHub Pages; probes run on GitHub Actions runners. Nothing on Fly is needed to show "Thirstr is down".
- Data lives on the branch `status-data` (never `main`, so status updates never redeploy staging or reset the prod promotion window).

### 6.2 Components and how each is probed (every 5 min, `status.yml`)
| Component (page label) | External probe (from GitHub) | Degraded when | Down when |
|---|---|---|---|
| Sign-in and accounts | `POST /v1/auth/refresh` with a dummy token (router, rate limit, sessions table; never sends mail) | > 2 s | not 401/422 / timeout 10 s |
| Chat | `GET /v1/health` + `wss://api.thirstr.fun/socket/websocket?vsn=2.0.0` handshake without token: 101 or 403 (socket route answered) | > 2 s | other status / timeout |
| Explore and map | `GET /v1/welcome` (public counts, `"cells"` present) | > 2 s | error / timeout |
| Photos and albums | `HEAD` on the photo storage front door (Tigris S3 endpoint, any answer < 500) | > 3 s | ≥ 500 / timeout |
| Notifications | not probeable from outside: Prometheus `thirstr_push_send_count` retry share over 15 min, only with the optional read-only repo secret `FLY_PROM_TOKEN`; without it the row is hidden | retry share > 5 % | > 50 % |
| Website | `GET https://thirstr.fun/` 200 | > 3 s | error |

- Two consecutive failures before a component turns red (one blip ≠ outage); one success turns it back.
- Per-day bar = worst state that lasted ≥ 10 min that day; percentage = good probes / probes (90 days). Days before the first probe = "No data yet".
- "This month" tiles: availability from SLO-2 (external), message and map p95 from SLO-3/4 via Prometheus (hidden when Prometheus is unreachable).

### 6.3 Incidents and maintenance
- An incident = a GitHub issue in this repo with label `incident` (only collaborators can label, so the public can't post on the status page). Title = incident title, labels `sev-1..4`, `affects:<component>`, state label `investigating` / `identified` / `monitoring`; closing the issue = resolved.
- Timeline = issue comments **by collaborators** that start with `Update:` (others are ignored), newest first. Issue body is not shown (internal notes go there).
- Maintenance = issue with label `maintenance` and a first line `When: 2026-11-23T02:00Z/2026-11-23T02:15Z`.
- `status.yml` runs on `issues` and `issue_comment` events too, so a new update is live within ~1 min.
- The prober opens an `incident` issue itself (state `investigating`, `affects:` set) when a component is down for 2 probes and none is open; owner edits the wording.

### 6.4 Page
- Pop brand, one dark theme, en / fr / de (browser language, switch top right; only fixed UI strings are translated, incident text is what the owner wrote).
- No cookies, no analytics, no external fonts or scripts at runtime (fonts self-hosted in the Pages artifact). Atom feed `feed.xml` of incidents.
- Shows times in the viewer's time zone. Works at 320 px. Contrast as in `design-system.md`; the overall state is an `aria-live` region.
- Files: `status/index.html` (page, plain HTML/CSS/JS, no build step), `status/probe.mjs` (Node 22, no deps) writes `state.json`, `daily.json` (120 days), `status.json`, `feed.xml` on `status-data`; Pages artifact = page + fonts + `status.json` + `feed.xml`. Publishing starts when repo variable `STATUS_PAGE=on` (after the owner enables Pages).

### 6.5 DNS (owner, once)
GoDaddy: `status` CNAME `jeanyves-figiel.github.io`. Repo Settings › Pages: source "GitHub Actions", custom domain `status.thirstr.fun`, Enforce HTTPS.
