# Scalability, message reliability & on-device cache (review 2026-11-21)

Status: findings + plan · 2026-11-21 · Scope: server (`server/`), app (`apps/mobile/`), infra (`infra/fly/`). Each recommendation is a GitHub issue (SR-xx). Prod infra changes need the owner's OK (ops.md › Trunk model).

## Summary
| Area | Verdict |
|---|---|
| Message delivery in transit | **Solid.** Outbox, `client_id` idempotency, ack-after-durable-write, pending-undecryptable retry (R-07.16–R-07.24). No lost or duplicate messages on bad networks. |
| Messages waiting for an offline phone | **At risk.** Single Postgres machine, no off-machine backup (SR-01); device revocation deletes the queue (SR-04); push wakes not retried (SR-02). |
| History kept over time | **At risk.** History lives only on the phone (by E2EE design). Chat photos vanish after 30 d (SR-05); new/lost phone = no history (SR-06). |
| Scale | **OK for the closed beta** (low thousands of active users, estimate, not measured). First bottlenecks: per-minute k-anonymity rewrite (SR-08), Explore query per page (SR-09), full-size photos re-downloaded every time (SR-10), small machines (SR-12). |
| Visibility | **Blind.** No metrics or alerts (SR-07). |
| Phone cache encryption | **Chat: encrypted** (SQLCipher, key in Keychain, this-device-only). **Leaks:** "Only me" profile fields, Safe Mode state, filters in plain AsyncStorage (SR-14); photos in OS cache (SR-10). |

## 1. Scalability

### Current setup
- API: `thirstr-api-prod`, 2 × `shared-cpu-1x` 512 MB, `fra` only, clustered via `dns_cluster` over 6PN (`server/rel/env.sh.eex`), Phoenix PubSub (pg) across nodes, `soft_limit 8000` connections.
- DB: one Postgres 16 + h3 machine, 3 GB volume, no replica (`docs/runbooks/fly.md`). Ecto `POOL_SIZE` default 10 per node.
- Valkey: one RAM-only machine (rate limits, push throttle).
- Oban on Postgres: queues `default 10`, `maintenance 2`, `push 5`; Cron (Minutely, ExpirySweep, weekly PlaceImport); Lifeline `rescue_after 45 min` (#133).
- Realtime: `user:me` (content-free events), `party:*`, `venue:*`. No Phoenix Presence.

### Findings
| # | Component | Finding | Effect at scale | Issue |
|---|---|---|---|---|
| S1 | DB | `refresh_k_anonymity` UPDATEs every visible `location_cells` row every minute, changed or not | 100k users ≈ 100k writes/min: WAL, bloat, vacuum; first DB limit | SR-08 #148 |
| S2 | Explore | Grid re-runs the 1 500-row candidate query (distance per row, up to 14 r5 rings) for every page, sorts in Elixir | Heavy query per scroll in dense cities | SR-09 #149 |
| S3 | Nearby | `Nearby.cell/2`, `dist_m/2` = one SQL round trip each; called per item in Tonight/parties/activities/venues | N+1 queries, pool pressure | SR-09 #149 |
| S4 | Photos | No thumbnails; presigned GET URL changes on every response → phone cache never hits | Every grid open re-downloads full photos; bandwidth + slow UI | SR-10 #150 |
| S5 | Machines | 512 MB shared CPU with 8 000-connection soft limit; capacity never measured | OOM/latency before Fly scales; no data to size | SR-12 #152 |
| S6 | Chat path | Each message = send POST + recipient GET pull + POST ack + Delivered receipt POST | ~4 HTTP calls/message/device | SR-13 #153 |
| S7 | Valkey | Rate limiter raises on Valkey error inside chat send | Valkey restart = sends fail until back | SR-11 #151 |
| S8 | Oban | Fine at current volume. Push queue concurrency 5/node, each APNs call sequential; no HTTP/2 pool | Push latency at bursts | SR-02 #142 |
| S9 | Region | `fra` only; DB in one region | Region outage = full outage (DR: cold standby planned) | #27 |
| S10 | Places | Weekly OSM import into `venues`/`events`, viewport bbox reads, r5 index. OK | — | — |
| S11 | Realtime | PubSub broadcast per account topic, no Presence; scales to tens of nodes | OK | — |

### Plan (scale)
1. Measure first: metrics (SR-07) + k6 on a separate EU load env with 100k seeded profiles (SR-12). Targets from testing.md: 100k sockets, 5k grid req/s, 20k msg/s; SLOs from ops.md (grid p95 < 300 ms, message p95 < 500 ms).
2. Fix the known hot spots: SR-08 (one-line `IS DISTINCT FROM` first), SR-09, SR-10.
3. Size from data: API likely `performance-1x` 2 GB with a realistic `soft_limit` and autoscale; dedicated-CPU DB with more disk; read replica for Explore reads; PgBouncer only when node count × pool nears `max_connections`.
4. Multi-region inside the EU (#27): API in `fra` + `ams`, DB primary `fra` + replica `ams` (DR and reads). Writes stay in `fra` (~10 ms from `ams`).
5. Later: SR-13 socket delivery, SR-11 Valkey HA.

## 2. Message reliability

### What already works (keep)
- **Outbox** (R-07.17): every outgoing message/receipt goes to the encrypted on-device outbox first; retries 1 s → 60 s with jitter, survives app kill, drains on reconnect/foreground/push; "Not sent, tap to retry" after 24 h.
- **Idempotent send** (R-07.18): encrypted once, retries resend the same ciphertext with `client_id`; server `mls_send_keys` returns the first result. All envelopes in one transaction (R-07.22); events after commit.
- **Durable before ack** (R-07.20): app writes rows, pending list and `seen` ids, then acks; the server deletes only acked ids; re-deliveries after a kill are skipped.
- **Undecryptable kept** (R-07.19): up to 24 h, retried after each welcome/commit, then notice + 1:1 resync.
- **Server queue for offline phones**: ciphertext kept per recipient device until ack, max 30 d; expired counts reported once (`mls_expired`).
- **Push**: content-free wake per account, throttled 20 s (R-16.5).
- **Auth**: refresh race fixed (#116, PR 117).

### Gaps
| # | Finding | Risk | Issue |
|---|---|---|---|
| R1 | One DB machine, no PITR, no off-machine backup | Host/volume loss = all queued messages + accounts lost | SR-01 #141 (child of #27) |
| R2 | `PushWake` ignores APNs errors (never retried); an `android` device row crashes the job for the whole account; no FCM | Offline user not woken → message waits until app opened | SR-02 #142 |
| R3 | No `kill_timeout` (Fly 5 s) vs Oban grace 15 s; killed jobs wait for Lifeline 45 min | Push delayed 45 min after a deploy | SR-03 #143 |
| R4 | `mls_messages` cascade on device delete (incl. refresh reuse > 60 s) | Queued messages silently gone | SR-04 #144 |
| R5 | Chat media blobs expire ≤ 30 d; app keeps decrypted media only in memory | Photos in kept chats break after 30 d | SR-05 #145 |
| R6 | History only on phone; key is this-device-only; device link copies no history | New/lost phone = chats gone | SR-06 #146 |
| R7 | No metrics/alerts | Problems found by users, not by us | SR-07 #147 |
| R8 | Valkey error = chat send 500 | Stalls (outbox recovers) | SR-11 #151 |

### Plan (reliability), in order
1. SR-01 backups/PITR + restore drill (prod change: owner OK).
2. SR-07 metrics + alerts (backlog age, push failures, disk, backup age).
3. SR-02 push retries + Android-safe + FCM; SR-03 graceful deploys.
4. SR-04 keep queue on revocation; SR-05 keep chat media on device.
5. SR-06 history transfer + encrypted backup (spec first: F-01, F-07).

## 3. Cache on the phone

### Today
| Data | Where | Encrypted |
|---|---|---|
| Messages, conversations, MLS group state + key packages, outbox, pending, translations, notes, favorites, contacts, album grants, safety contacts | SQLCipher DB `thirstr.db` (`apps/mobile/src/chat/kv.ts`), key 32 B random in Keychain `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`; `useSQLCipher: true` in `app.json` | Yes (not verified at runtime, SR-14) |
| Access/refresh tokens | Keychain (`expo-secure-store`) | Yes |
| "My chats"/"Only me" profile fields (R-06.6) | AsyncStorage `thirstr.localFields.<pid>` | **No** |
| Safe Mode previous level, criminalizing-country list, Explore filters/intents/layers, UI flags, install id | AsyncStorage | **No** |
| Decrypted chat photos | In-memory `Map` of data URIs (unbounded, lost on restart) | n/a (not on disk) |
| Profile photos | OS URL cache via RN `Image`, keyed by changing presigned URL | No (and rarely hit) |
| Map tiles | MapLibre ambient cache | No (public data) |
| Profiles, Explore results, Tonight | Not cached | — |

### Plan (phone)
1. SR-14: move sensitive AsyncStorage data into the encrypted store; assert `PRAGMA cipher_version`; iOS data protection.
2. SR-05: encrypted on-disk cache for chat media (per-file key in SQLCipher).
3. SR-10: thumbnails + stable URLs + encrypted, size-capped image cache keyed by photo id.
4. SR-15: proper indexed tables and paging (today `LIKE` prefix reads scan the whole table).
5. SR-16: Explore snapshot + recent profiles offline; cap/clear map tile cache on panic wipe and Safe Mode.

Rule for every cache: inside the encrypted store or an AES-GCM file whose key is in it; wiped by sign-out and panic wipe (R-13.13); size-capped; no data beyond what the API already shows.

## Prioritized backlog
| P | ID | Issue | Effort |
|---|---|---|---|
| P0 | SR-01 Postgres backups, PITR, restore drill | #141 | ✔ staging + prod 2026-11-21 (drill passed on staging, [runbook](../runbooks/db-backups.md)) |
| P0 | SR-07 Metrics + alerts | #147 | ✔ 2026-11-21 |
| P0 | SR-02 Push retries, Android-safe, FCM | #142 | ✔ 2026-11-21 |
| P0 | SR-03 Graceful deploys | #143 | ✔ 2026-11-21 |
| P0 | SR-04 Keep queue on device revocation | #144 | ✔ 2026-11-21 |
| P0 | SR-05 Chat photos kept on phone (encrypted) | #145 | ✔ 2026-11-21 |
| P1 | SR-14 Sensitive data out of AsyncStorage; verify SQLCipher | #154 | ✔ 2026-11-21 |
| P1 | SR-08 k-anonymity job writes only changes | #148 | ✔ 2026-11-21 |
| P1 | SR-15 Phone chat store indexes + paging | #155 | ◐ indexed reads, memory cap (12 chats), list windowing done; first paint of an uncached chat reads only its newest 50 rows, sorted in SQLite (2026-11-21); on-device timing of a 20k-message chat pending; per-chat SQL table with time index open (needed only for chats ≫ 10k messages) |
| P1 | SR-10 Thumbnails + photo cache | #150 | ✔ 2026-11-21 (stable URLs, 480 px thumbnails) |
| P1 | SR-09 Explore caching + no N+1 H3 | #149 | ✔ 2026-11-21 (page order cache 2 min, memoized H3 centroids) |
| P1 | SR-11 Valkey failure fallback | #151 | ✔ 2026-11-21 |
| P1 | SR-12 k6 load test + machine sizing | #152 | ◐ kit + runbook done (`infra/load/`, `runbooks/capacity.md`); load env + runs need owner OK |
| P1 | SR-06 History transfer + encrypted backup | #146 | L (spec first) |
| P2 | SR-13 Ciphertext over socket ✔ | #153 | M |
| P2 | SR-16 Offline caches (Explore, profiles, tiles) ✔ | #156 | M |
| — | Second EU region, KMS pepper, Tigris placement | #27 | — |

Follow-on: enterprise-level plan, roadmap and costs in [`enterprise-readiness.md`](enterprise-readiness.md) (EN-01 … EN-22, #160–#181).
