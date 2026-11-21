# Scale-out design for 1M users (EN-03, #162)

Status: design · 2026-11-21 · Docs only, no infra spend (owner decision on #162: "plan now, spend later"). Builds on [`scalability-and-reliability.md`](scalability-and-reliability.md) and [`enterprise-readiness.md`](enterprise-readiness.md) › A. Numbers marked *est.* are estimates; final sizing comes from the SR-12 load runs (#152, [`docs/runbooks/capacity.md`](../runbooks/capacity.md)). Each build step below ships as its own issue when its trigger fires; prod changes need the owner's OK per change.

## 1. Load model at 1M MAU

| | Value | Basis |
|---|---|---|
| DAU | 300k | 30 % of MAU *est.* |
| Peak concurrent (sockets) | 30k typical, **100k design** | 10 % of DAU (capacity.md); testing.md target 100k |
| Chat sends | 18M/day, peak **2k/s**, design **20k/s** | 60 sends per DAU *est.*, peak = 5 × mean; testing.md target |
| `mls_messages` rows | ≈ 2 per send (recipient devices + own other devices) → 36M inserts **and** ≈ 36M deletes/day | queue rows are deleted on ack (R-07.21), the rest after 30 d |
| Location writes | ≤ 1 per active profile per 5 min → 100k active ≈ **330/s** | F-05, app throttle |
| Explore reads | design **5k grid req/s** | testing.md |
| DB size | 50–150 GB *est.* (no media; media lives in Tigris) | profiles, social graph, audit, queue |

The database is the only stateful scaling limit: API nodes are stateless and scale out behind Fly's proxy; Valkey holds only rebuildable state.

## 2. `mls_messages`: hash partitions by device

**Problem.** The table is a queue: every row is inserted, read once or twice and deleted. 36M dead tuples a day on one heap and two indexes means constant autovacuum, index bloat on `(to_device_id, id)` and `created_at`, and a single vacuum that can't keep up at peak.

**Why not time partitions.** Daily range partitions make the 30 d retention a `DROP`, but every hot query (`pull`, `ack`) filters by `to_device_id`, not time, so each would probe ~31 partitions. Retention deletes are a tiny share (most rows go on ack), so time partitioning optimises the wrong path.

**Design.**
- `PARTITION BY HASH (to_device_id)`, **16 partitions** (`mls_messages_p00…p15`). `pull` and `ack` always carry `to_device_id` → pruned to one partition. 16 heaps vacuum in parallel (`autovacuum_max_workers` ≥ 6), each 1/16 of the churn.
- Primary key `(to_device_id, id)`; index `(to_device_id, id)` is the PK; `created_at` index kept per partition for the retention sweep (BRIN is enough: rows arrive in time order).
- Per-partition storage params: `fillfactor 90`, `autovacuum_vacuum_scale_factor 0.01`, `autovacuum_vacuum_cost_limit 2000`, `autovacuum_vacuum_insert_scale_factor 0.05`.
- 16 is fixed for the life of the table (re-hashing = rebuild). At 20k msg/s each partition sees ~2.5k writes/s, well inside one heap's range. Move to 64 only if a partition's vacuum lag exceeds 5 min under load.
- `id` stays a global `bigserial` (one sequence, `CACHE 100` per session) so cursors (`id > ?`) keep working.

**Migration (expand-only, CI lint).**
1. Create `mls_queue` (partitioned, same columns). Release N: writes go to both tables; `pull` reads both (`UNION ALL`, de-duplicated by id); `ack` deletes from both.
2. Release N+1: writes go to `mls_queue` only. Old rows drain by ack and the 30 d sweep.
3. After 30 d: `pull`/`ack` read `mls_queue` only; release N+2 drops `mls_messages` (contract step, its own migration after the drain is verified empty).
No backfill copy, no lock on the live table.

**Trigger.** Start when the SR-07 metric `pg_stat_user_tables.n_dead_tup` for `mls_messages` stays > 20 % of live rows for a day, or at 10k DAU, whichever comes first.

## 3. Other high-churn tables

| Table | Churn | Plan | Trigger |
|---|---|---|---|
| `location_cells` | UPDATE per location write + per-minute k-anon refresh | SR-08 (#148): update only changed rows; then hot set (§4) | done first (SR-08) |
| `oban_jobs` | one push job per message per device | Oban pruner `max_age 10 min` for `completed`; `fillfactor 80`; push batching per device (SR-02) cuts rows ~3× | > 5M rows/day |
| `refresh_tokens`, `spent_tokens` | insert per refresh / attest, delete on expiry | **monthly range partitions on `created_at`**; retention = `DROP PARTITION` | > 1M rows |
| `taps` (7 d), `moment_views`, `franking_tags` (90 d), `client_errors`, `admin_audit` | append, delete by age | same: range partitions by `created_at` (daily for `taps`, monthly for the rest); sweep becomes `DROP` | > 1M rows or sweep > 10 s |
| `chat_delivery_stats`, `mls_expired` | small aggregates | no change | — |

Partitions are created **in-house** by an Oban cron job (`PartitionKeeper`, creates the next 3 periods, drops expired ones) instead of the `pg_partman` extension, so the same image runs on Fly, on a self-run Postgres or on Hetzner without extension packaging. Each conversion uses the same expand / dual-write / drain / contract steps as §2.

## 4. Hot location set (Explore)

**Today.** Every grid/map first page runs the candidate query on `location_cells` (r5 ring → r7/r9 distance, visibility, Hidden rules, blocks) against Postgres (SR-09 #149 removes the per-page re-run and N+1).

**Design, in two stages.**
1. **ETS read cache per API node (no new infra).** Key `{r5_cell, viewer_class}` → candidate list (profile id, r7/r9 cells, display level, flags) for that r5 cell, TTL 10 s, max 50k entries (LRU). A location write publishes `loc:changed r5` over Phoenix PubSub; every node drops that key. Per-viewer filters (blocks, hides, "not seen by hidden", age range) still run in Elixir on the cached list, so privacy rules never depend on a stale cache longer than 10 s. Expected: > 90 % of grid reads served without a DB round trip in dense cities.
2. **Valkey hot set (when writes, not reads, are the limit).** Active profiles (location written in the last 30 min) live in Valkey: `loc:p:<id>` hash (cells, level, flags, `updated_at`) and `loc:r5:<cell>` sorted set (member id, score `updated_at`). Location writes go to Valkey first; Postgres gets a write-behind upsert at most once per profile per 5 min (and immediately on level change, Hidden, or delete). Explore reads Valkey for the active set and Postgres only for the long tail. Requires Valkey HA first (SR-11 #151, EN-02 replica): if Valkey is down, Explore falls back to Postgres reads (slower, correct).

Privacy is unchanged: only H3 cells, never coordinates (F-05); Valkey is RAM-only, so the hot set is gone on restart and rebuilt from Postgres.

**Triggers.** Stage 1 when grid p95 > 200 ms at the SLO load or DB CPU > 60 % from Explore. Stage 2 when location writes > 1k/s sustained or `location_cells` vacuum lag > 5 min.

## 5. Connection pooling (PgBouncer)

**Rule.** Direct connections = API machines × `POOL_SIZE` (10) + Oban/maintenance + admin. Add PgBouncer when that sum passes **80 % of `max_connections`** (with `max_connections 300`: 24 API machines). Until then direct Postgrex connections are faster (no extra hop, named prepared statements).

**Design.**
- PgBouncer in **transaction mode**, one per region, on a Fly machine next to the DB primary (`default_pool_size` = DB cores × 2, `max_client_conn` 5 000).
- Repo config for that mode: `prepare: :unnamed`, no session-level `SET`; long transactions stay < 1 s (Ecto default).
- **Oban** needs session features: switch the notifier to `Oban.Notifiers.PG` (we already cluster over `dns_cluster`), so no `LISTEN/NOTIFY` through the pooler; Oban's own repo connections may go direct (small fixed pool).
- Migrations and `Release.migrate` connect **direct** (DDL, advisory locks).
- Read replica (EN-01 #160) gets its own pooler; Explore and places reads route to it via a second Ecto repo (`Thirstr.Repo.Replica`), writes stay on the primary.

## 6. Database hardware and the exit path (#23)

| At | Shape *est.* | Where |
|---|---|---|
| Closed beta (now) | 1 Postgres 16 + h3 machine, small volume, PITR backups (SR-01) | Fly, `fra` |
| Open beta, 10k MAU | dedicated CPU, 4 vCPU / 8 GB, 50 GB volume, sync standby (EN-01, deferred to open beta) | Fly |
| Launch, 100k MAU | 8 vCPU / 32 GB, 200 GB NVMe, sync standby + async replica `ams` | Fly or Hetzner (decision point A) |
| 1M MAU | 16–32 cores / 64–128 GB, 1–2 TB NVMe, Patroni 3-node (primary + sync + async), PgBouncer | **decision point B** |

**Options at 1M.**
1. **Stay on Fly**, self-run Postgres on performance machines with Patroni (Fly Managed Postgres only if it supports the `h3` extension). Simplest ops continuity; volumes are network-attached and the largest machine shapes are limited, so this is the expensive option for a DB of this size.
2. **Hetzner dedicated servers in the EU** (Falkenstein / Nürnberg / Helsinki), 3 servers with local NVMe, Patroni + etcd, WAL archived to EU object storage. Lowest cost per core/GB and local NVMe IOPS; German provider (no US CLOUD Act exposure, a #23 criterion). Needs our own failover, monitoring and patching.
3. Managed EU Postgres from another provider: only if it supports `h3`, PITR and synchronous replicas in the EU.

**Rule: the API moves with the DB.** Ecto is chatty (several queries per request); a cross-provider hop of a few ms per query would break the 300 ms grid p95. So option 2 means moving API + Valkey + DB together (same image digest, the #23 exit-path dry run), not just the DB.

**Recommendation.** Keep Fly through open beta and launch. At decision point A (100k MAU or when the DB needs > 32 GB RAM), run the #23 exit-path dry run on Hetzner staging and compare measured cost and p95. Choose at decision point B with those numbers; prefer Hetzner if it is ≥ 40 % cheaper at equal p95, given the jurisdiction benefit. No spend until the owner approves at each point.

## 7. Order of work

| # | Step | Trigger | Depends on |
|---|---|---|---|
| 1 | SR-08 k-anon refresh, SR-09 Explore query, SR-07 metrics | now (open issues) | — |
| 2 | SR-12 load runs on a seeded env; fill §1 with measured numbers | before open beta | 1 |
| 3 | `mls_queue` hash partitions (§2) | dead tuples > 20 % for a day, or 10k DAU | 2 |
| 4 | ETS Explore cache (§4 stage 1) | grid p95 > 200 ms or Explore DB CPU > 60 % | 1 |
| 5 | Range partitions for TTL tables + `PartitionKeeper` (§3) | > 1M rows or sweep > 10 s | — |
| 6 | Oban notifier → PG; Replica repo; PgBouncer (§5) | connections > 80 % of max, or replica live (EN-01) | EN-01 |
| 7 | Valkey hot set (§4 stage 2) | location writes > 1k/s | SR-11, EN-02 |
| 8 | DB hardware decision A / B (§6) | 100k MAU / 1M MAU | #23 dry run |

Every trigger is an alert on the SR-07 dashboards (`docs/runbooks/monitoring.md`), so the work starts from data, not a calendar.
