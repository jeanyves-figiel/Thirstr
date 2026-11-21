#!/bin/bash
# Wraps the official entrypoint. With a backup bucket configured (Fly secrets on thirstr-db-<env>):
# WAL archiving to pgBackRest (RPO ≤ archive_timeout) + backup-loop.sh for base backups.
set -euo pipefail

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
