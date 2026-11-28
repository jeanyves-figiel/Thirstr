# Database integrity & maintenance (DB-01 … DB-11)

Status: built (DB-01…DB-11; DB-09 run per env) · 2026-11-28 · Issues #333 (DB-01…08), #334 (DB-09), #335 (DB-10), #336 (DB-11). Scope: `infra/postgres/`, `server/`, `scripts/ops/`, `infra/alerts/`. Related: SR-01 backups (#141), EN-01 standby (#160, deferred to open beta), EN-17 DR drill (#176), [`scale-out-1m.md`](scale-out-1m.md) (partitioning).

Goal: no duplicate rows, no silent corruption, no unbounded growth, and every failure is seen within minutes, without manual DBA work as the data grows.

## 1. What already exists (audit 2026-11-28)

| Risk | Protection | Where |
|---|---|---|
| Duplicate rows | 27 unique indexes; composite primary keys on every join table (`party_requests`, `activity_rsvps`, `club_members`, `moment_views`, `help_votes`, `media_blob_grants` …); 39 `ON CONFLICT` upserts | `server/priv/repo/migrations/` |
| Duplicate chat sends | `client_id` idempotency per device, 7 d (R-07.18) | `Thirstr.Chat.send/2`, `mls_send_keys` |
| Duplicate jobs | Oban `unique:` on every cron worker and `PushWake`; Lifeline rescues orphans | `server/lib/thirstr/jobs/`, `config/config.exs` |
| Orphans | 74 foreign keys with explicit `on_delete` | migrations |
| Data loss | pgBackRest WAL archive (≤ 5 min) + daily diff / weekly full, AES-256, Tigris, 5 fulls kept | `infra/postgres/`, [`db-backups.md`](../runbooks/db-backups.md) |
| Bad restore | DR drill restores into another EU region + migration dry run | `scripts/ops/restore-drill.sh`, `dr-drill.yml` |
| Breaking migrations | expand/contract lint in CI; canary migration dry run | `scripts/check-migrations.py`, `canary.sh` |
| Growth | retention sweeps (1 / 15 min), overdue-retention probe + alert, Oban pruner 1 h, DB size alert | `ExpirySweep`, `Minutely`, `Thirstr.Retention`, `rules.json` |
| Replication | none: one DB machine per env. HA standby EN-01 (#160) waits for open beta (owner, 2026-11-21) | — |

## 2. Gaps → requirements

| ID | Gap | Requirement |
|---|---|---|
| DB-01 | Stock Postgres config (128 MB buffers, default autovacuum, no slow-query log) | Entrypoint sizes memory from the machine (shared_buffers 25 %, effective_cache_size 70 %, maintenance_work_mem 6 %), tunes autovacuum (naptime 20 s, scale factors 0.05 / 0.02, cost limit 1000, 3 workers), WAL (`wal_compression=zstd`, `checkpoint_timeout 15 min`, `max_wal_size 1 GB`), logging (`log_min_duration_statement 500 ms`, `log_lock_waits`, `log_autovacuum_min_duration 10 s`, `log_temp_files 8 MB`), `track_io_timing`. Applies in every env (DEV, CI, Fly). Override any value with `PG_<NAME>` env. |
| DB-02 | Hot tables churn with default vacuum thresholds | Per-table storage params (migration): `location_cells`, `mls_messages`, `oban_jobs`, `now_status`, `taps`, `mls_send_keys`, `refresh_tokens`, `spent_tokens`: `autovacuum_vacuum_scale_factor 0.01`, `autovacuum_analyze_scale_factor 0.02`, `autovacuum_vacuum_insert_scale_factor 0.05`, `autovacuum_vacuum_cost_limit 2000`; `fillfactor 85` on `location_cells` (HOT updates every minute). |
| DB-03 | No timeouts: a leaked transaction blocks vacuum, a runaway query holds a pool slot forever | Server: `idle_in_transaction_session_timeout 5 min`. App connections: `statement_timeout 60 s`. Migrations (`Thirstr.Release.migrate`): `statement_timeout 0`, `lock_timeout 10 s` (a blocked DDL fails fast instead of queueing every query behind it; the deploy retries). Maintenance job: its own connection with `statement_timeout 0`. |
| DB-04 | No query stats, no corruption tools | `shared_preload_libraries = pg_stat_statements` (`track = top`, max 5000); extensions `pg_stat_statements`, `amcheck`, `pgstattuple` (migration). |
| DB-05 | No routine maintenance | `Thirstr.Jobs.DbMaintenance`, daily 04:40 UTC, `maintenance` queue, unique 1 h. (a) **amcheck** `bt_index_check` on every valid B-tree index; Sundays with `heapallindexed` (index ↔ heap match). Any failure → status `amcheck` not ok, index names only in detail. (b) **Vacuum on pressure**: tables > 10 000 rows with dead/total > 20 % and no vacuum in 6 h → `VACUUM (ANALYZE)`, max 5 per run. (c) **Reindex**: B-tree indexes > 64 MB with `pgstatindex` leaf density < 50 % → `REINDEX INDEX CONCURRENTLY`, max 2 per run. (d) **Invalid indexes**: leftovers of a failed concurrent reindex (`*_ccnew*`, `*_ccold*`) are dropped `CONCURRENTLY`; other invalid indexes are only reported. Each step's result goes to `db_maint_status`. |
| DB-06 | Only DB size is alerted | `Thirstr.DbHealth` polled every 60 s exports `thirstr_db_health_*`: `xid_age`, `longest_xact_s`, `connections_ratio`, `dead_ratio{table}` (tables > 10 000 rows), `invalid_indexes`, `checksum_failures`, `checksums_on`, `archive_age_s`, `archive_failing`, and `thirstr_db_maint_age_s{key}` / `thirstr_db_maint_ok{key}` for `backup`, `verify`, `amcheck`, `maintenance`. Alerts in §3. |
| DB-07 | Backups are never verified end to end | `backup-loop.sh` runs `pgbackrest verify` weekly (checksums of every backup file + WAL continuity) and writes `backup` / `verify` rows to `db_maint_status` after each run (ok, time, short detail). |
| DB-08 | Drill quarterly (ops.md says monthly), only counts accounts | `dr-drill.yml` monthly (1st, 04:17 UTC, prod). Drill also runs `bt_index_check(heapallindexed)` on every index of the restored copy and fails on corruption (`amcheck` field in the result). |
| DB-09 | Page checksums off (PG16 default); volume never grows | Image sets `POSTGRES_INITDB_ARGS=--data-checksums` (new clusters, DEV, CI). Existing clusters: `scripts/ops/db-hardening.sh <env>` (workflow `db-hardening.yml`, manual): boots the DB machine with init = sleep on the new image, `pg_checksums --enable` on the cleanly stopped cluster (skipped when already on), then normal boot with mount auto-extend (at 80 % add 2 GB, cap 50 GB). DB down ≈ 1–2 min. **Prod run needs the owner's OK.** |
| DB-10 | Only chat is idempotent; a retried create can be stored twice | `Idempotency-Key` header on POST creates (parties, Tonight plans, trips, activity posts, support requests, reports): `ThirstrWeb.Plugs.Idempotency` (allow-listed routes, answers holding no secret) stores (account, key) → path, body hash, status, answer for 24 h in `idempotency_keys`; same key + same request → stored answer (`idempotent-replayed: true`); other request → 422 `idempotency_mismatch`; running → 409; claim without answer > 2 min taken over; 5xx not kept. App: fresh key on every POST, a lost create (network drop / timeout) is resent once with the same key (`src/api/idempotency.ts`). Swept by ExpirySweep, retention probe `idempotency_24h`. Contract: api.md › Idempotency. |
| DB-11 | No `CHECK` constraints; raw SQL writes bypass changesets | Migration `db_check_constraints`: `accounts.status`, `accounts.onboarding_step`, `devices.platform`, `location_cells.level`, `photos.status`, `support_requests.status`, `linked_accounts.platform` (value lists = the code that writes them), `reports.severity` 1–6, `parties.capacity` > 0, `activity_posts.capacity` > 0, `mls_expired.count` ≥ 0, `client_errors.count` ≥ 1. `NOT VALID` then `VALIDATE` (no write lock); a violating existing row fails the promote migration dry run against restored prod before prod. A new value = new migration widening the list. Next candidates once their writers are consolidated: `parties.status`, `party_requests.state`, `reports.state`, `moderation_actions.action`. |

## 3. Alerts (infra/alerts/rules.json, runbook docs/runbooks/alerts.md)

| id | Fires when | sev |
|---|---|---|
| `db-corruption` | `checksum_failures > 0` or amcheck status not ok | 1 |
| `db-archive-failing` | WAL archive failing, or last archived WAL > 15 min old | 1 |
| `db-backup-old` | last good base backup > 30 h, or last verify > 8 d / not ok | 2 |
| `db-xid-age` | oldest database XID age > 500 M (wraparound at 2.1 B) | 2 |
| `db-long-xact` | a transaction open > 10 min | 2 |
| `db-connections` | connections > 80 % of `max_connections` | 2 |
| `db-maintenance-stale` | DbMaintenance not ok or not run for 30 h | 3 |
| `db-dead-tuples` | a table > 10 000 rows with > 20 % dead tuples for 2 h | 3 |

## 4. Replication

No replica until EN-01 (#160, open beta). Until then: RPO ≤ 5 min via WAL archive (alert `db-archive-failing`), RTO measured monthly by the drill. When EN-01 lands, add `replication_lag_s` and `replica_up` to `DbHealth` with sev 1 alerts.

## 5. Growth

`db-filling` (size) stays. Volume auto-extend (DB-09) removes the hard stop. Partitioning per [`scale-out-1m.md`](scale-out-1m.md) §2–3 when its triggers fire (dead tuples > 20 % for a day on `mls_messages`, or TTL tables > 1M rows) — the `dead_ratio` metric and `db-dead-tuples` alert are those triggers.

## 6. Uniqueness and integrity with more than one database (growth path)

Short answer: unique indexes stay correct at every stage below, because each stage keeps **one writer per row**. What changes is *where* a rule can be enforced; the design moves global rules to the right place before the split, never after.

| Stage | Trigger ([scale-out-1m.md](scale-out-1m.md) §6) | Writes | How uniqueness / no-duplicates hold |
|---|---|---|---|
| 0 · now | — | one primary | every unique index and FK is enforced by Postgres |
| 1 · HA standby + read replicas (EN-01 #160) | open beta | **still one primary**; replicas are read-only copies via WAL | unchanged: replicas replay the primary's WAL byte for byte, they cannot take a conflicting write. Integrity work: route reads that follow a write to the primary for 5 s (read-your-writes, `Thirstr.Repo.Replica` only for Explore/places), alert on `replication_lag_s` > 10 s and on a replica that stopped replaying, failover promotes exactly one standby (fencing: old primary's machine stopped before promote). |
| 2 · partitioned tables (scale-out §2–3) | dead rows > 20 %/day, TTL tables > 1M rows | one primary | Postgres enforces a unique index on a partitioned table only if it **includes the partition key**. Rule for every conversion: the partition key is a prefix of every unique key. `mls_messages` → PK `(to_device_id, id)`, hash on `to_device_id` ✔. `taps` unique `(from_profile_id, to_profile_id)` → hash-partition on `from_profile_id`, not by time ✔. TTL tables without a natural unique key (`client_errors`, `admin_audit`) → range on `created_at` ✔. A table whose unique key can't contain the partition key is not partitioned. |
| 3 · split by domain (separate DB clusters) | one cluster's CPU/IO > 60 % after stage 1–2 | one primary **per domain**: core (accounts, profiles, moderation), chat queue (`mls_*`, devices' key packages), location/Explore (`location_cells`, places) | uniques never span domains: every unique key already lives in one domain (account keys in core, `client_id` per device in chat). Cross-domain references use UUIDs without FKs; integrity then comes from (a) delete fan-out through an outbox table in core, consumed idempotently by each domain (Oban, unique per event), (b) a nightly reconciliation job per domain that removes orphans and alerts if any were found. |
| 4 · sharding by account (≫ 1M MAU, if ever) | a single domain primary saturated | one primary per shard, shard key `account_id` (Citus or app routing) | per-account uniques include the shard key ✔. **Globally unique values** (`email_hash`, `auth_oidc_hash`, passkey `credential_id`, `plus_entitlements.original_id_hash`, share slugs, report refs) move to a small **directory** DB: claim the value there first (unique index, one primary), then write the shard row; a claim with no shard row after 10 min is released by a sweep. No multi-primary / multi-region writes for the same row, ever: conflict resolution would let two rows win. |

Preparation now (cheap, avoids rewrites later):
- IDs are UUIDs generated without coordination ✔ (no sequence to share between databases). Stay on random v4 for ids the app sees: v7 would expose account / profile creation time (privacy first). Internal append-only tables may use `bigserial` per shard or v7.
- Every new unique key that is per account must start with the account or profile id; a new *global* unique value must be listed in this section (future directory).
- Every new cross-table reference used for deletion must have an FK now (so stage 3 knows what needs the outbox).
- Idempotency keys (DB-10) are per account, so they shard with the account.
