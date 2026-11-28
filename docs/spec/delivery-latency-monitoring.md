# Message delivery & latency monitoring (EN-23)

Status: specified 2026-11-28 · Issue: [#343](https://github.com/jeanyves-figiel/Thirstr/issues/343) · Builds on SR-07 ([`monitoring.md`](../runbooks/monitoring.md)), EN-04 ([`slos.md`](slos.md)), EN-05 (crash reports), EN-06 (on-call, [`alerts.md`](../runbooks/alerts.md)), privacy rules [`metrics.md`](metrics.md) (R-MX.1–5).
Not here: database alerts (DB-01…DB-09, [`db-integrity.md`](db-integrity.md)).

Goal (owner, 2026-11-28): **know within minutes when a message is late, lost, duplicated or stuck, and when the app feels slow, before a member tells us**. Enterprise level, no new vendor, no new spend, content-free.

## 1. Audit (what exists on 2026-11-28)

| Area | Exists | Gap |
|---|---|---|
| API latency | `phoenix_router_dispatch_stop_duration{route,status}` histogram; alert `api-slow` (p95 > 500 ms, all routes) | no per-route-group view; no client-side view (network + device time) |
| Message relay | SLO-3 = `/v1/mls/messages` request time (send **and** pull) | measures the HTTP call, not delivery; pull and send mixed |
| Delivery time | `chat_delivery_stats` (DB, per day, 6 buckets) insert → ack; console `/admin/delivery` table | not in Prometheus → no alert, no burn rate; online and offline recipients mixed; daily only |
| Lost messages | `mls_expired` rows (swept unread after 30 d); alert `chat-backlog-old` (> 25 d) | no count of losses; no signal for messages a device skipped |
| Duplicates | server idempotency (`client_id`, `mls_send_keys`); client `seen` set | neither is counted |
| Stuck messages | backlog count / oldest age (offline devices dominate) | can't tell "device offline" from "device online but not receiving" |
| Websocket | `phoenix_socket_connected_count{result}` | no live socket gauge, join time, disconnects, env-vs-pull fallback share |
| Push | `thirstr_push_send_count{platform,outcome}`; alerts `push-failing`, `push-queue-stuck` | no provider latency; no "push sent → device woke" time; dead tokens not counted |
| End-to-end probe | status page: socket handshake only; Testbot is staging-only and manual | **no synthetic message ever travels sender → server → recipient** |
| Client experience | crash-free sessions (EN-05) | **no RUM**: app start, Explore/map load, send tap → ✓, reconnect, outbox give-ups |
| SLO burn alerts | specified (slos.md § 3) for Grafana | **not implemented**: `rules.json` only has threshold rules; weekly report only |
| Dashboard | Costs page, Delivery table | no health page that answers "is chat OK right now?" |

## 2. Requirements

### OB-1 Server delivery metrics (Prometheus, content-free)
All counters/histograms carry only the labels listed; no ids, pairs, groups or sizes per user (AC-MX.1).

| Metric | Labels | Meaning |
|---|---|---|
| `thirstr_chat_send_count` | `result` = `stored` \| `repeat` \| `dropped` \| `limited` \| `rejected` | send requests by outcome (`repeat` = idempotent duplicate, `dropped` = blocked/gone recipient, `limited` = rate limit) |
| `thirstr_chat_envelope_count` | `kind` = `app` \| `handshake`, `path` = `socket` \| `pull_hint` | envelopes stored; `path` = pushed on the live socket or announced only (too big / no env socket) |
| `thirstr_chat_delivery_duration_ms` | `path` = `socket` \| `rest`, `recipient` = `online` \| `offline` | insert → device ack, buckets 100, 250, 500, 1000, 2500, 5000, 15 000, 60 000, 600 000, 3 600 000, 86 400 000. `online` = the target device had a live `env` socket when the message was stored |
| `thirstr_chat_skipped_count` | — | on ack: rows for the same device with a smaller id, older than 5 min, still unacked (device processed later messages but not these) |
| `thirstr_chat_expired_count` | `kind` | envelopes deleted unread by the 30-day sweep (= lost) |
| `thirstr_chat_stuck_online` | — (gauge, 60 s) | unacked envelopes older than 2 min whose device has a live socket now (should be 0) |
| `thirstr_socket_live` | — (gauge, 30 s) | live `user:me` sockets on the node |
| `thirstr_socket_join_duration_ms` | `env` | channel join time |
| `thirstr_socket_close_count` | `reason` = `normal` \| `timeout` \| `error` \| `shutdown` | disconnects |
| `thirstr_push_send_duration_ms` | `platform`, `outcome` | provider call time (APNs / FCM) |
| `thirstr_push_send_count` | add `outcome` = `gone` | token rejected by provider (forgotten) |
| `thirstr_push_wake_duration_ms` | `platform` | push accepted by provider → that device's next pull or socket join (Valkey key `pw:<device>` with send time, TTL 15 min, deleted on use; never logged) |
| `thirstr_push_wake_count` | `platform`, `result` = `woke` \| `none` | `none` counted when the key is found expired by the next push to the same device |

- `online` is cheap: the device topic subscriber is tracked in a node-local ETS set on `user:me` join/terminate with `env: true` (cluster lookup via `:pg`). No DB write.
- `chat_delivery_stats` (daily DB table, R-07.24) stays as the long-term record (Prometheus keeps 15 days on Fly).

### OB-2 Synthetic end-to-end chat probe
- Two **probe accounts** per environment (`probe_a`, `probe_b`), flag `accounts.probe = true`: verified, onboarded, Hidden, never in Explore, search, counts, KPIs, Testbot lists or moderation queues; may message only each other (server enforces; any other target = 403). Allowed in prod (unlike Testbot). Created by `mix thirstr.probe.ensure` / release task; sessions bound to a `PROBE_KEY` secret (≥ 32 bytes) like Testbot's service key.
- Runner: `scripts/ops/chat-probe.mjs` (Node 22, reuses `apps/testbot` MLS client, keys kept in the Actions cache, encrypted with `PROBE_STATE_KEY`). Every 5 min inside `oncall.yml` (no extra workflow minutes beyond ~30 s/run) for **prod and staging**:
  1. B connects the socket (`env: true`). A sends one real MLS app message (payload = random 16-byte nonce, nothing else).
  2. Measure: send HTTP time, **send → B receives on socket**, B acks, B replies, **round trip**.
  3. Pull path: B (second probe device, offline) pulls via REST and acks → pull path checked.
  4. Duplicate check: A resends with the same `client_id` → must return `repeat` and B must not receive a second envelope within 10 s.
  5. Push path: B's probe device has an FCM token for a dry run: server sends with `validate_only: true` (FCM accepts it, nothing is shown) → provider reachability + auth. APNs has no dry run: covered by `push-failing` + OB-1 wake metrics.
- Results POSTed to `POST /v1/ops/probe` (HMAC with `PROBE_KEY`) → `thirstr_probe_duration_ms{env_check, step}` and `thirstr_probe_result_count{step, result}`; also the job summary and the console page. Failure of the POST itself is treated by the rule as a failed probe.
- Status page: the **Chat** component uses the probe result (send → receive) instead of the bare socket handshake; tile "Message delivery p95" uses OB-1 online delivery.

### OB-3 Client RUM (real user monitoring), privacy first
- No SDK. App module `src/app/perf.ts` keeps **fixed-bucket histograms on the phone** and sends one batch per day (or on app background after ≥ 6 h) to `POST /v1/client/perf`: anonymous like EN-05 (no account token, no device or install id), body ≤ 2 KB, gzip; Wi-Fi or with Data saver off any network; never wakes the phone for it.
- Batch: `{platform, build, net: wifi|cell|other, metrics: {name: [counts per bucket]}}`. Bucket edges fixed in code (ms): 50, 100, 250, 500, 1000, 2500, 5000, 10 000, 30 000. Counters: plain counts.
- Metrics (allowlist; server drops anything else):

| Name | What |
|---|---|
| `app_start` | cold start → first screen interactive |
| `explore_first` | Explore opened → first tiles/pins painted |
| `map_tiles` | map region change → tiles shown |
| `profile_open` | tap profile → photo painted |
| `send_ack` | tap Send → server 200 (✓) |
| `send_delivered` | tap Send → delivered receipt (✓✓) |
| `chat_open` | push tap → thread visible |
| `socket_connect` | socket connect → joined |
| `api_<group>` | request time per route group (`auth`, `explore`, `chat`, `profile`, `media`, `other`) |
| counters | `socket_reconnects`, `outbox_retry`, `outbox_gave_up` ("Not sent"), `dup_dropped` (seen set hit), `decrypt_pending`, `decrypt_gave_up`, `expired_notices`, `offline_minutes` |

- Server-timing: API responses add `server-timing: app;dur=<ms>` so the app can split `api_*` into server vs network time (`api_<group>_net` = client time − server time).
- Server folds batches into Prometheus counters (`thirstr_client_perf_bucket{name,platform,net,le}`, `thirstr_client_perf_count{name,platform}`); raw batches are not stored. Rate limit 24 batches per IP per day. Batches from builds < `min_build` dropped.
- Opt-out: Settings › Privacy › "Share anonymous performance stats" (default on; **off and hidden in Safe Mode**, R-MX.2, AC-MX.2). Dashboard hides any cell with n < 20 (R-MX.3).

### OB-4 New SLOs (add to slos.md § 2)
| ID | SLO | SLI | Objective (28 d) |
|---|---|---|---|
| SLO-7 | Messages arrive fast when the recipient is online | `delivery_duration{recipient="online"}` ≤ 1 s / all online | 99 % |
| SLO-8 | Chat works end to end | probe runs with all steps ok / runs (prod) | 99.5 % (≈ 40 failed of 8 064) |
| SLO-9 | No message lost or skipped | `skipped_count + stuck_online` events | 0 per day; any breach = incident |
| SLO-10 | App feels fast | `send_ack` ≤ 1 s and `explore_first` ≤ 2.5 s (RUM, all networks) | 95 % each |

SLO-3 is narrowed to `POST /v1/mls/messages` (send only); pull moves to SLO-7.

### OB-5 Burn-rate alerting, implemented
- `oncall.py` gets rule type `burn`: `{slo, good_query, total_query, objective, windows: [[long, short, factor], …], min_total}`; fires when both windows exceed `factor × (1 − objective)` and the long window has ≥ `min_total` events. One rule per SLO and severity, from slos.md § 3: fast (1 h / 5 m × 14.4) and slow (6 h / 30 m × 6) page; drain (3 d / 6 h × 1) = sev 3 (job summary + weekly review).
- Paging in closed beta: SLO-1, SLO-8, SLO-9 page (sev 1). SLO-3/4/7/10 sev 2 (normal push, quiet hours). Until the store app points at prod (slos.md "Which app"), staging copies of SLO-7/8/9 run at sev 2.
- New threshold rules: `probe-failing` (2 consecutive failed probe runs, sev 1), `messages-skipped` (> 0 in 15 min, sev 2), `messages-stuck-online` (> 0 for 10 min, sev 1), `push-wake-low` (woke share < 80 % over 6 h with ≥ 20 pushes, sev 2), `socket-flapping` (reconnects per live socket > 1/min over 10 min, sev 2), `traffic-cliff` (sends in the last hour < 20 % of same hour last week with ≥ 50 then, sev 2: silent failure).
- Each rule gets a section in `alerts.md` (CI-checked) and the console page links to it.

### OB-6 Console page A-12 "Health" (`/admin/health`, replaces `/admin/delivery`)
Mockup first (high design bar). Server queries Fly Prometheus with the read-only token already used by Costs (`FLY_COST_TOKEN`), cached 60 s; falls back to `chat_delivery_stats` when Prometheus is unreachable (banner).
- Top: overall state (OK / degraded / incident) + last probe (time, send → receive ms, all steps).
- Tiles: online delivery p95 (SLO-7), probe success 24 h, messages lost/skipped 24 h, duplicates caught 24 h, push wake p95, live sockets, API p95.
- SLO table: objective, 28-day value, budget left bar, burn now (1 h), status.
- Charts (24 h / 7 d / 28 d): delivery time percentiles online/offline; probe steps; API p95 per route group; push sent/ok/retry/gone + wake time; client RUM per metric and platform (n ≥ 20).
- Firing alerts with runbook links; deploy markers on every chart (from promote runs).
- env switch prod / staging. Inline SVG charts, no chart library, no inline script (CSP `'self'`).

### OB-7 Other things to cover (owner asked "anything else")
1. **Deploy markers + auto-rollback signal**: canary (EN-12) also gates on probe success and online delivery p95, not only 5xx.
2. **Traffic-cliff / silent-failure detection** (OB-5) — a broken app build that never sends is invisible to error rates.
3. **Media path**: upload/download success and time for Tigris (`thirstr_media_upload_*`, RUM `photo_upload`, `photo_load`), since photos are half of chat.
4. **Rate-limit false positives**: `thirstr_rate_limit_hit_count{bucket}` (429 per limit name) so a too-tight limit doesn't look like "messages not going out".
5. **Dependency latency**: Valkey command time, APNs/FCM/SES/Tigris call time and errors, each with a sev 2 rule.
6. **Request correlation**: `x-request-id` returned and logged; app attaches it to error reports (no account id) to match a member's report to server logs.
7. **Logs retention**: Fly keeps logs short; spec a no-spend option (Fly log shipper to Tigris, 14 days, EU) — owner decision, not built here.
8. **Probe from outside GitHub**: GitHub runners are not in Asia/Americas consumer networks; when open beta goes worldwide, add a second probe location (decision later, likely cost).
9. **Game day**: add "kill the API machine mid-send" and "block APNs" drills to `game-day.md` to prove OB-5 alerts fire and nothing is lost.
10. **Privacy CI**: extend `metrics_test.exs` lint to every new metric and `/v1/client/perf` payload (AC-MX.1).

## 3. Delivery plan (PRs)
1. **PR A (server + alerts)**: OB-1, OB-4 docs, OB-5 burn engine + rules + runbooks, OB-7.1/2/4/6. No UI.
2. **PR B (probe)**: OB-2 probe accounts, runner, endpoint, status page Chat component.
3. **PR C (app)**: OB-3 RUM + Settings toggle + `server-timing`. Needs TestFlight check.
4. **PR D (console)**: OB-6 after mockup approval.
5. Follow-ups: OB-7.3/5/7/8/9 as separate issues.

## 4. Acceptance
- AC-OB.1 Killing delivery (e.g. flag that drops socket broadcasts on staging) pages within 10 min via probe and SLO-7 fast burn.
- AC-OB.2 A resend with the same `client_id` is counted as `repeat` and never delivered twice (probe step 4, every run).
- AC-OB.3 No new metric label or payload field holds an account, profile, device, group or install id, IP, coordinates or content (CI test).
- AC-OB.4 Safe Mode build sends zero `/v1/client/perf` batches (test).
- AC-OB.5 RUM costs ≤ 2 KB/day/phone and no extra wake-ups (measured on device, noted in PR C).
- AC-OB.6 Console Health page loads < 1 s with Prometheus cached, works at 360 px, both themes per v3.
