#!/bin/bash
# Wraps the official entrypoint. With a backup bucket configured (Fly secrets on thirstr-db-<env>):
# WAL archiving to pgBackRest (RPO ≤ archive_timeout) + backup-loop.sh for base backups.
set -euo pipefail

# DB-01/03/04 (#333, docs/spec/db-integrity.md): tuning sized from this machine's RAM, applied in every env.
# Any value can be overridden with PG_<NAME> (e.g. PG_SHARED_BUFFERS=512MB); PG_TUNING=off skips all of it.
if [ "${1:-}" = "postgres" ] && [ "${PG_TUNING:-on}" != "off" ]; then
  mem_kb=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)
  mem_mb=$(( ${mem_kb:-1048576} / 1024 ))
  lim=$(cat /sys/fs/cgroup/memory.max 2>/dev/null || echo max)
  [ "$lim" != "max" ] && [ "$lim" -gt 0 ] 2>/dev/null && [ $(( lim / 1048576 )) -lt "$mem_mb" ] && mem_mb=$(( lim / 1048576 ))
  pick() { local n="PG_$(echo "$1" | tr '[:lower:]' '[:upper:]')"; echo "${!n:-$2}"; }
  set -- "$@" \
    -c "shared_buffers=$(pick shared_buffers "$(( mem_mb / 4 ))MB")" \
    -c "effective_cache_size=$(pick effective_cache_size "$(( mem_mb * 7 / 10 ))MB")" \
    -c "maintenance_work_mem=$(pick maintenance_work_mem "$(( mem_mb * 6 / 100 < 64 ? 64 : mem_mb * 6 / 100 ))MB")" \
    -c "work_mem=$(pick work_mem 4MB)" \
    -c "max_connections=$(pick max_connections 100)" \
    -c "random_page_cost=$(pick random_page_cost 1.1)" \
    -c "effective_io_concurrency=$(pick effective_io_concurrency 200)" \
    -c "wal_compression=$(pick wal_compression zstd)" \
    -c "checkpoint_timeout=$(pick checkpoint_timeout 15min)" \
    -c "checkpoint_completion_target=0.9" \
    -c "max_wal_size=$(pick max_wal_size 1GB)" \
    -c "min_wal_size=$(pick min_wal_size 128MB)" \
    -c "autovacuum_max_workers=$(pick autovacuum_max_workers 3)" \
    -c "autovacuum_naptime=$(pick autovacuum_naptime 20s)" \
    -c "autovacuum_vacuum_scale_factor=$(pick autovacuum_vacuum_scale_factor 0.05)" \
    -c "autovacuum_analyze_scale_factor=$(pick autovacuum_analyze_scale_factor 0.02)" \
    -c "autovacuum_vacuum_insert_scale_factor=$(pick autovacuum_vacuum_insert_scale_factor 0.1)" \
    -c "autovacuum_vacuum_cost_limit=$(pick autovacuum_vacuum_cost_limit 1000)" \
    -c "idle_in_transaction_session_timeout=$(pick idle_in_transaction_session_timeout 5min)" \
    -c "shared_preload_libraries=$(pick shared_preload_libraries pg_stat_statements)" \
    -c "pg_stat_statements.max=5000" \
    -c "pg_stat_statements.track=top" \
    -c "track_io_timing=on" \
    -c "log_min_duration_statement=$(pick log_min_duration_statement 500ms)" \
    -c "log_lock_waits=on" \
    -c "log_temp_files=8MB" \
    -c "log_autovacuum_min_duration=$(pick log_autovacuum_min_duration 10s)" \
    -c "log_checkpoints=on"
fi

# BACKUPS=off: restore drills / copies must never write into the live repo.
if [ "${1:-}" = "postgres" ] && [ -n "${PGBACKREST_REPO1_S3_BUCKET:-}" ] && [ "${BACKUPS:-on}" != "off" ]; then
  export PGBACKREST_STANZA="${PGBACKREST_STANZA:-thirstr}"
  export PGBACKREST_PG1_PATH="${PGDATA:-/var/lib/postgresql/data}"
  export PGBACKREST_REPO1_TYPE=s3
  export PGBACKREST_REPO1_PATH="${PGBACKREST_REPO1_PATH:-/pgbackrest}"
  export PGBACKREST_REPO1_S3_ENDPOINT="${PGBACKREST_REPO1_S3_ENDPOINT:-fly.storage.tigris.dev}"
  export PGBACKREST_REPO1_S3_REGION="${PGBACKREST_REPO1_S3_REGION:-auto}"
  export PGBACKREST_REPO1_CIPHER_TYPE=aes-256-cbc
  # Weekly full + daily diff; 5 fulls kept ≈ 5 weeks of point-in-time restore (ops.md: ≥ 30 d).
  export PGBACKREST_REPO1_RETENTION_FULL="${PGBACKREST_REPO1_RETENTION_FULL:-5}"
  export PGBACKREST_COMPRESS_TYPE=zst
  export PGBACKREST_START_FAST=y
  export PGBACKREST_LOG_LEVEL_FILE=off
  export PGBACKREST_LOG_LEVEL_CONSOLE=info
  : "${PGBACKREST_REPO1_CIPHER_PASS:?backups need PGBACKREST_REPO1_CIPHER_PASS}"

  set -- "$@" \
    -c archive_mode=on \
    -c "archive_command=pgbackrest archive-push %p" \
    -c "archive_timeout=${ARCHIVE_TIMEOUT:-300}" \
    -c wal_level=replica

  backup-loop.sh &
fi

exec docker-entrypoint.sh "$@"
