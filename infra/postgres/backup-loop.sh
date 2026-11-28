#!/bin/bash
# Base backups for pgBackRest (SR-01, #141). Runs beside Postgres on the DB machine.
# Every 10 min: if the newest backup is older than BACKUP_EVERY_H (default 24 h), take one:
# full when there is none or the newest full is older than 7 d, else differential.
# Weekly (DB-07, #333): `pgbackrest verify` (every backup file's checksum + WAL continuity).
# Status line `backup-loop: …` goes to the machine log (fly logs); each result is also written to
# db_maint_status (keys backup / verify) so the API exports it and on-call alerts on it (db-backup-old).
set -uo pipefail
as_pg() { gosu postgres "$@"; }
log() { echo "backup-loop: $*"; }
every=$(( ${BACKUP_EVERY_H:-24} * 3600 ))
full_every=$(( 7 * 86400 ))
verify_every=$(( ${VERIFY_EVERY_H:-168} * 3600 ))
last_verify=0
db="${POSTGRES_DB:-postgres}"
# status <key> <true|false> <detail> [epoch] → upsert into db_maint_status (table from migration DbIntegrity; ignored before it exists)
status() {
  as_pg psql -q -X -d "$db" -v ON_ERROR_STOP=1 -v k="$1" -v ok="$2" -v d="${3:0:200}" -v at="${4:-$(date +%s)}" >/dev/null 2>&1 <<'SQL' || true
INSERT INTO db_maint_status (key, ok, at, detail) VALUES (:'k', :'ok'::boolean, to_timestamp(:'at'::bigint), :'d')
ON CONFLICT (key) DO UPDATE SET ok = EXCLUDED.ok, at = EXCLUDED.at, detail = EXCLUDED.detail;
SQL
}

until as_pg pg_isready -q -h /var/run/postgresql; do sleep 5; done
sleep 20
as_pg pgbackrest stanza-create >/dev/null 2>&1 || as_pg pgbackrest stanza-upgrade || log "stanza-create failed"
as_pg pgbackrest check && log "archive check ok" || log "archive check FAILED"

while true; do
  info=$(as_pg pgbackrest info --output=json 2>/dev/null || echo '[]')
  now=$(date +%s)
  last=$(jq -r '[.[0].backup[]?.timestamp.stop] | max // 0' <<<"$info")
  last_full=$(jq -r '[.[0].backup[]? | select(.type=="full") | .timestamp.stop] | max // 0' <<<"$info")
  if [ $(( now - last )) -ge "$every" ]; then
    type=diff
    [ $(( now - last_full )) -ge "$full_every" ] && type=full
    log "starting $type backup"
    if as_pg pgbackrest backup --type="$type"; then log "$type backup ok"; status backup true "$type"
    else log "$type backup FAILED"; status backup false "$type failed"; fi
  elif [ "$last" != "0" ]; then
    # time = the newest good backup in the repo, so the age alert (db-backup-old) tracks the repo, not this loop
    status backup true "newest in repo" "$last"
  fi
  if [ $(( now - last_verify )) -ge "$verify_every" ]; then
    log "starting verify"
    if out=$(as_pg pgbackrest verify 2>&1); then log "verify ok"; status verify true "ok"
    else log "verify FAILED: $(tail -n 3 <<<"$out" | tr '\n' ' ')"; status verify false "$(tail -n 1 <<<"$out")"; fi
    last_verify=$now
  fi
  sleep 600
done
