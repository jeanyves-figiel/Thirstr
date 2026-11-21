#!/usr/bin/env bash
# DR drill + migration dry run from backups only (EN-17 #176, EN-12 #171; runbook docs/runbooks/db-backups.md).
#
#   restore-drill.sh <env> <region> [--migrate-image <api image ref>] [--keep]
#
# 1. Creates a temporary encrypted volume + machine on thirstr-db-<env> in <region> (same DB image, BACKUPS=off,
#    archive_mode=off, init = sleep), restores the newest backup + WAL from Tigris with pgBackRest, starts Postgres
#    on port 5499 (never 5432, so `thirstr-db-<env>.internal:5432` traffic can't reach it), checks row counts.
# 2. --migrate-image: starts a second temporary machine from that API image and runs `/app/bin/migrate` against the
#    restored copy (random one-time role + password). Fails if any migration fails.
# 3. Always destroys both machines and the volume (trap), unless --keep.
#
# Prints one JSON line on stdout: {env, region, rto_s, restore_s, rpo_s, accounts, migrate, ...}. Progress → stderr.
# Needs FLY_API_TOKEN (or FLY_TOKEN), curl, jq, openssl. Machines API only (no flyctl).
set -euo pipefail

env="${1:?env (staging|prod)}"; region="${2:?region (fra|ams|cdg|arn)}"; shift 2
migrate_image=""; keep=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --migrate-image) migrate_image="$2"; shift 2 ;;
    --keep) keep=true; shift ;;
    *) echo "unknown arg $1" >&2; exit 2 ;;
  esac
done
case "$env" in staging|prod) ;; *) echo "env must be staging or prod" >&2; exit 2 ;; esac
case " fra ams cdg arn " in *" $region "*) ;; *) echo "region $region is not an allowed EU region (D-03)" >&2; exit 2 ;; esac

token="${FLY_API_TOKEN:-${FLY_TOKEN:?FLY_API_TOKEN or FLY_TOKEN}}"
app="thirstr-db-${env}"
api="https://api.machines.dev/v1/apps/${app}"
run_id="${GITHUB_RUN_ID:-local}-$(date +%s)"
log() { echo "[drill $(date -u +%H:%M:%S)] $*" >&2; }
fly() { # fly <method> <path> [curl args] → body; on HTTP error prints the body to stderr and fails
  local m="$1" p="$2" out; shift 2
  out=$(curl -sS --fail-with-body -X "$m" -H "Authorization: Bearer ${token}" -H 'content-type: application/json' "${api}${p}" "$@") \
    || { echo "Machines API $m $p: $out" >&2; return 1; }
  printf '%s' "$out"
}
launch() { # launch <create body> → machine json; create stopped, then start (create+launch in one call is refused for new volumes)
  local mj id
  mj=$(fly POST /machines -d "$(jq -c '. + {skip_launch:true}' <<<"$1")"); id=$(jq -r .id <<<"$mj")
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
    [[ "$(fly GET "/machines/$id" | jq -r .state)" == "stopped" ]] && break; sleep 2
  done
  fly POST "/machines/$id/start" >/dev/null
  fly GET "/machines/$id/wait?state=started&timeout=60" >/dev/null
  printf '%s' "$mj"
}

# exec with a short timeout; long work runs detached and is polled (exec calls are capped by Fly).
mexec() { # mexec <machine> <shell command> → stdout; fails on non-zero exit
  local out; out=$(fly POST "/machines/$1/exec" -d "$(jq -nc --arg c "$2" '{command:["sh","-c",$c],timeout:55}')")
  local rc; rc=$(jq -r '.exit_code // 0' <<<"$out")
  jq -r '.stdout // ""' <<<"$out"
  if [[ "$rc" != "0" ]]; then jq -r '.stderr // ""' <<<"$out" >&2; return "$rc"; fi
}
bg_wait() { # bg_wait <machine> <name> <timeout s> : waits for /tmp/<name>.rc written by a detached job
  local t=0
  while (( t < $3 )); do
    rc=$(mexec "$1" "cat /tmp/$2.rc 2>/dev/null || true")
    if [[ -n "$rc" ]]; then
      if [[ "$rc" != "0" ]]; then mexec "$1" "tail -n 60 /tmp/$2.log" >&2 || true; return 1; fi
      return 0
    fi
    sleep 10; t=$((t + 10))
  done
  log "$2 timed out after $3 s"; mexec "$1" "tail -n 60 /tmp/$2.log" >&2 || true; return 1
}

drill_id=""; mig_id=""; vol_id=""
cleanup() {
  $keep && { log "--keep: leaving machine ${drill_id} ${mig_id} volume ${vol_id}"; return; }
  # every machine of this run, also ones whose id never reached us (failed launch)
  local ids; ids=$(fly GET /machines 2>/dev/null | jq -r --arg run "$run_id" '.[] | select(.config.metadata.run == $run) | .id' || true)
  for m in $(printf '%s\n' "$mig_id" "$drill_id" $ids | sort -u); do
    [[ -n "$m" ]] && { fly DELETE "/machines/${m}?force=true" >/dev/null 2>&1 || log "WARN could not destroy machine $m"; }
  done
  if [[ -n "$vol_id" ]]; then
    for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
      fly DELETE "/volumes/${vol_id}" >/dev/null 2>&1 && { log "destroyed volume ${vol_id}"; return; }
      sleep 5
    done
    log "WARN volume ${vol_id} not destroyed; delete it by hand (db-backups.md › Restore step 6)"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# The live DB machine: image, volume size, archiver lag (= worst-case RPO right now).
live=$(fly GET /machines | jq -c '[.[] | select(.state=="started" and (.config.metadata.purpose // "") == "" and ((.config.mounts // [])|length) > 0)][0]')
[[ "$live" != "null" ]] || { log "no running DB machine on $app"; exit 1; }
live_id=$(jq -r .id <<<"$live"); image=$(jq -r .config.image <<<"$live"); size=$(jq -r '.config.mounts[0].size_gb' <<<"$live")
rpo_s=$(mexec "$live_id" "gosu postgres psql -Atc \"select coalesce(extract(epoch from now() - last_archived_time)::int, -1) from pg_stat_archiver\"" | tr -d '[:space:]')
log "live $live_id image $image volume ${size} GB; last WAL archived ${rpo_s}s ago"

t0=$(date +%s)
# +2 GB: WAL replay keeps up to max_wal_size of segments in pg_wal (1 GB staging volume filled up in the first drill).
size=$(( size + 2 ))
vol_id=$(fly POST /volumes -d "$(jq -nc --arg r "$region" --argjson s "$size" '{name:"pgdrill",region:$r,size_gb:$s,encrypted:true}')" | jq -r .id)
log "volume $vol_id ($region)"
cfg=$(jq -nc --arg img "$image" --arg vol "$vol_id" --arg run "$run_id" '{
  image:$img, init:{exec:["sleep","inf"]}, auto_destroy:false, restart:{policy:"no"},
  guest:{cpu_kind:"shared",cpus:1,memory_mb:1024},
  env:{PGDATA:"/var/lib/postgresql/data/pgdata",BACKUPS:"off"},
  mounts:[{volume:$vol,path:"/var/lib/postgresql/data"}],
  metadata:{purpose:"dr-drill",run:$run}}')
drill=$(launch "$(jq -nc --arg r "$region" --argjson c "$cfg" '{name:"drill",region:$r,config:$c}')")
drill_id=$(jq -r .id <<<"$drill"); drill_ip=$(jq -r .private_ip <<<"$drill")
log "drill machine $drill_id started"

pgb='export PGBACKREST_STANZA=thirstr PGBACKREST_PG1_PATH=$PGDATA PGBACKREST_REPO1_TYPE=s3 PGBACKREST_REPO1_PATH=/pgbackrest PGBACKREST_REPO1_S3_ENDPOINT=fly.storage.tigris.dev PGBACKREST_REPO1_S3_REGION=auto PGBACKREST_REPO1_CIPHER_TYPE=aes-256-cbc'
t1=$(date +%s)
mexec "$drill_id" "$pgb; mkdir -p \$PGDATA && chown postgres \$PGDATA && chmod 700 \$PGDATA;
  setsid sh -c 'gosu postgres pgbackrest restore > /tmp/restore.log 2>&1; echo \$? > /tmp/restore.rc' < /dev/null > /dev/null 2>&1 &" >/dev/null
bg_wait "$drill_id" restore 1800
restore_s=$(( $(date +%s) - t1 )); log "restore done in ${restore_s}s"

# Start local + 6PN on 5499 only, never archiving. Replays WAL to the end of the archive, then promotes.
# pgBackRest options must be in the environment of Postgres itself: restore_command calls archive-get.
mexec "$drill_id" "$pgb; gosu postgres sh -c 'setsid postgres -D \$PGDATA -c port=5499 -c listen_addresses=\"*\" -c archive_mode=off -c max_wal_size=256MB -c min_wal_size=64MB > /tmp/pg.log 2>&1 < /dev/null &'" >/dev/null
for i in $(seq 1 360); do
  r=$(mexec "$drill_id" "gosu postgres psql -p 5499 -h localhost -Atc 'select pg_is_in_recovery()' 2>/dev/null || true" | tr -d '[:space:]')
  [[ "$r" == "f" ]] && break
  if mexec "$drill_id" "grep -q 'database system is shut down' /tmp/pg.log" >/dev/null 2>&1; then
    mexec "$drill_id" "tail -n 30 /tmp/pg.log" >&2 || true; log "Postgres stopped during recovery"; exit 1
  fi
  (( i == 360 )) && { mexec "$drill_id" "tail -n 40 /tmp/pg.log" >&2 || true; log "Postgres did not finish recovery"; exit 1; }
  sleep 5
done
rto_s=$(( $(date +%s) - t0 ))
db=$(mexec "$drill_id" "gosu postgres psql -p 5499 -h localhost -Atc \"select datname from pg_database where datname not in ('postgres','template0','template1') order by datname limit 1\"" | tr -d '[:space:]')
accounts=$(mexec "$drill_id" "gosu postgres psql -p 5499 -h localhost -d $db -Atc 'select count(*) from accounts'" | tr -d '[:space:]')
last_msg_age=$(mexec "$drill_id" "gosu postgres psql -p 5499 -h localhost -d $db -Atc \"select coalesce(extract(epoch from now() - max(created_at))::int, -1) from mls_messages\" 2>/dev/null || echo -1" | tr -d '[:space:]')
log "usable after ${rto_s}s: db=$db accounts=$accounts newest message ${last_msg_age}s old"

migrate="skipped"; migrate_s=0
if [[ -n "$migrate_image" ]]; then
  pw=$(openssl rand -hex 24)
  mexec "$drill_id" "gosu postgres psql -p 5499 -h localhost -v ON_ERROR_STOP=1 -c \"create role drill_migrator login superuser password '$pw'\" >/dev/null &&
    echo 'host all drill_migrator fdaa::/16 scram-sha-256' >> \$PGDATA/pg_hba.conf &&
    gosu postgres psql -p 5499 -h localhost -Atc 'select pg_reload_conf()' >/dev/null" >/dev/null
  mcfg=$(jq -nc --arg img "$migrate_image" --arg url "ecto://drill_migrator:${pw}@[${drill_ip}]:5499/${db}" --arg run "$run_id" \
    --arg skb "$(openssl rand -hex 48)" --arg pep "$(openssl rand -hex 32)" '{
    image:$img, init:{exec:["sleep","inf"]}, auto_destroy:false, restart:{policy:"no"},
    guest:{cpu_kind:"shared",cpus:1,memory_mb:1024},
    env:{DATABASE_URL:$url, ECTO_IPV6:"true", SECRET_KEY_BASE:$skb, ID_PEPPER:$pep, DEPLOY_ENV:"drill", GEO_DB:"static", PHX_HOST:"drill.invalid"},
    metadata:{purpose:"migration-dry-run",run:$run}}')
  mig=$(launch "$(jq -nc --arg r "$region" --argjson c "$mcfg" '{name:"migrate-dry-run",region:$r,config:$c}')")
  mig_id=$(jq -r .id <<<"$mig")
  log "migrator $mig_id started ($migrate_image)"
  t2=$(date +%s)
  mexec "$mig_id" "setsid sh -c '/app/bin/migrate > /tmp/migrate.log 2>&1; echo \$? > /tmp/migrate.rc' < /dev/null > /dev/null 2>&1 &" >/dev/null
  if bg_wait "$mig_id" migrate 900; then migrate="ok"; else migrate="failed"; fi
  migrate_s=$(( $(date +%s) - t2 ))
  mexec "$mig_id" "grep -E 'Migrated|== Running|error' /tmp/migrate.log | tail -n 30" >&2 || true
  log "migration dry run: $migrate in ${migrate_s}s"
fi

jq -nc --arg env "$env" --arg region "$region" --arg image "$image" --arg db "$db" --arg migrate "$migrate" \
  --argjson rto "$rto_s" --argjson restore "$restore_s" --argjson rpo "${rpo_s:--1}" --argjson accounts "${accounts:-0}" \
  --argjson last "${last_msg_age:--1}" --argjson ms "$migrate_s" --arg at "$(date -u +%FT%TZ)" \
  '{at:$at, env:$env, region:$region, db_image:$image, db:$db, rto_s:$rto, restore_s:$restore, rpo_s:$rpo,
    accounts:$accounts, newest_message_age_s:$last, migrate:$migrate, migrate_s:$ms}'
[[ "$migrate" != "failed" ]]
