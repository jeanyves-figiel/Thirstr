#!/bin/bash
# Base backups for pgBackRest (SR-01, #141). Runs beside Postgres on the DB machine.
# Every 10 min: if the newest backup is older than BACKUP_EVERY_H (default 24 h), take one:
# full when there is none or the newest full is older than 7 d, else differential.
# Status line `backup-loop: …` goes to the machine log (fly logs).
set -uo pipefail
as_pg() { gosu postgres "$@"; }
log() { echo "backup-loop: $*"; }
every=$(( ${BACKUP_EVERY_H:-24} * 3600 ))
full_every=$(( 7 * 86400 ))

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
    if as_pg pgbackrest backup --type="$type"; then log "$type backup ok"; else log "$type backup FAILED"; fi
  fi
  sleep 600
done
