# Runbook: capacity & machine sizing (SR-12, #152)

How to size API / DB machines from measurements, not guesses. Tool: `infra/load/` (k6).

## Method
1. Load env mirrors prod sizes (API `shared-cpu-1x` 512 MB × 2, DB as prod), seeded with 100k profiles.
2. Step the rates ×2 (grid, chat, sockets) until p95 or errors break the thresholds; keep each step 10 min.
3. Read Grafana (monitoring.md) at the break: API CPU/memory, BEAM run queue, DB CPU, pool queue time (`thirstr_repo_query_queue_time`), Oban backlog.
4. First bottleneck → fix or resize → repeat. Size prod for 2× the expected peak (enterprise-readiness.md §1: peak concurrent = 10 % of DAU).

## Rules of thumb (to confirm with runs)
- API memory: each socket ≈ 40–60 KB in the BEAM → 100k sockets ≈ 5–6 GB across nodes; set `soft_limit` from measured memory, not 8 000.
- DB pool: `POOL_SIZE × API machines` < 80 % of Postgres `max_connections`; PgBouncer once it isn't.
- Grid page 1 is the heaviest read (candidate query); later pages are id lookups (SR-09).

## Run log
| Date | Env | API | DB | Grid req/s | Msg/s | Sockets | Grid p95 | Send p95 | Errors | First bottleneck |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-11-21 | DEV container (smoke, k6 on same host) | 1 dev node | local pg16 | 10 | 10 | 20 | 209 ms (page 2: 90 ms) | 78 ms | 0 % | — (script check only, not a capacity number) |
