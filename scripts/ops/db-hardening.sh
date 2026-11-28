#!/usr/bin/env bash
# DB-09 (#334, docs/spec/db-integrity.md): bring a live DB machine up to the hardened setup.
#
#   db-hardening.sh <env> [--image <db image ref>] [--dry-run]
#
# 1. Moves the machine to <image> (default registry.fly.io/thirstr-db-<env>:pg16-h3 = newest infra-images build:
#    tuned config, pg_stat_statements, DB-01/03/04/07).
# 2. If page checksums are off: boots the machine with init = sleep (Postgres cleanly stopped by stop_config SIGINT),
#    runs `pg_checksums --enable` (rewrites every page once; ~10–30 s per GB), boots normally again.
#    An interrupted pg_checksums leaves the cluster as it was and can simply be re-run.
# 3. Volume auto-extend: at 80 % used add 2 GB, up to 50 GB (no more "disk full" stop).
#
# Downtime: the DB is down from step 2's first restart until the last boot (~1–2 min for 3 GB). Prod: owner OK first.
# Prints one JSON line: {env, machine, image, checksums_before, checksums, shared_buffers, autoextend, down_s}.
# Needs FLY_API_TOKEN (or FLY_TOKEN), curl, jq. Machines API only.
set -euo pipefail

env="${1:?env (staging|prod)}"; shift
image=""; dry=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --image) image="$2"; shift 2 ;;
    --dry-run) dry=true; shift ;;
    *) echo "unknown arg $1" >&2; exit 2 ;;
  esac
done
case "$env" in staging|prod) ;; *) echo "env must be staging or prod" >&2; exit 2 ;; esac
image="${image:-registry.fly.io/thirstr-db-${env}:pg16-h3}"

token="${FLY_API_TOKEN:-${FLY_TOKEN:?FLY_API_TOKEN or FLY_TOKEN}}"
app="thirstr-db-${env}"
api="https://api.machines.dev/v1/apps/${app}"
log() { echo "[harden $(date -u +%H:%M:%S)] $*" >&2; }
fly() {
  local m="$1" p="$2" out; shift 2
  out=$(curl -sS --fail-with-body -X "$m" -H "Authorization: Bearer ${token}" -H 'content-type: application/json' "${api}${p}" "$@") \
    || { echo "Machines API $m $p: $out" >&2; return 1; }
  printf '%s' "$out"
}
mexec() {
  local out; out=$(fly POST "/machines/$1/exec" -d "$(jq -nc --arg c "$2" '{command:["sh","-c",$c],timeout:55}')")
  local rc; rc=$(jq -r '.exit_code // 0' <<<"$out")
  jq -r '.stdout // ""' <<<"$out"
  if [[ "$rc" != "0" ]]; then jq -r '.stderr // ""' <<<"$out" >&2; return "$rc"; fi
}
bg_wait() {
  local t=0 rc
  while (( t < $3 )); do
    rc=$(mexec "$1" "cat /tmp/$2.rc 2>/dev/null || true")
    if [[ -n "$rc" ]]; then
      [[ "$rc" == "0" ]] && return 0
      mexec "$1" "tail -n 40 /tmp/$2.log" >&2 || true; return 1
    fi
    sleep 5; t=$((t + 5))
  done
  log "$2 timed out after $3 s"; return 1
}
# update <config json>: applies the config, waits until started
update() {
  local cur; cur=$(fly GET "/machines/$id" | jq -r .instance_id)
  fly POST "/machines/$id" -d "$(jq -nc --argjson c "$1" '{config:$c}')" >/dev/null
  for _ in $(seq 1 60); do
    [[ "$(fly GET "/machines/$id" | jq -r .instance_id)" != "$cur" ]] && break; sleep 2
  done
  fly GET "/machines/$id/wait?state=started&timeout=60" >/dev/null
}
pg_ready() {
  for _ in $(seq 1 60); do
    mexec "$id" "pg_isready -q -h /var/run/postgresql" >/dev/null 2>&1 && return 0; sleep 3
  done
  return 1
}
q() { mexec "$id" "gosu postgres psql -X -Atc \"$1\"" | tr -d '[:space:]'; }

live=$(fly GET /machines | jq -c '[.[] | select(.state=="started" and (.config.metadata.purpose // "") == "" and ((.config.mounts // [])|length) > 0)][0]')
[[ "$live" != "null" ]] || { log "no running DB machine on $app"; exit 1; }
id=$(jq -r .id <<<"$live"); cfg=$(jq -c .config <<<"$live")
before=$(q "show data_checksums")
log "machine $id image $(jq -r .image <<<"$cfg") checksums=$before → image $image"
final=$(jq -c --arg img "$image" 'del(.init) | .image = $img
  | .mounts[0] += {extend_threshold_percent: 80, add_size_gb: 2, size_gb_limit: 50}' <<<"$cfg")
if $dry; then
  jq -nc --arg env "$env" --arg id "$id" --arg img "$image" --arg b "$before" --argjson c "$final" \
    '{env:$env, machine:$id, image:$img, checksums_before:$b, dry_run:true, final_mounts:$c.mounts}'
  exit 0
fi

t0=$(date +%s)
restore_boot() { log "restoring normal boot"; update "$final" || true; }
if [[ "$before" != "on" ]]; then
  trap restore_boot ERR
  log "boot with init=sleep (DB down from here)"
  update "$(jq -c '.init = {exec: ["sleep", "inf"]}' <<<"$final")"
  state=$(mexec "$id" "gosu postgres pg_controldata \$PGDATA | sed -n 's/^Database cluster state: *//p'")
  [[ "$state" == "shut down" ]] || { log "cluster state '$state' (not cleanly shut down): not touching it"; false; }
  mexec "$id" "setsid sh -c 'gosu postgres pg_checksums --enable --progress -D \$PGDATA > /tmp/cks.log 2>&1; echo \$? > /tmp/cks.rc' < /dev/null > /dev/null 2>&1 &" >/dev/null
  bg_wait "$id" cks 1800
  mexec "$id" "tail -n 5 /tmp/cks.log" >&2 || true
  trap - ERR
fi
log "normal boot on $image"
update "$final"
pg_ready || { log "Postgres not ready after boot"; exit 1; }
down_s=$(( $(date +%s) - t0 ))
after=$(q "show data_checksums"); sb=$(q "show shared_buffers"); pss=$(q "show shared_preload_libraries")
log "up after ${down_s}s: checksums=$after shared_buffers=$sb preload=$pss"
jq -nc --arg env "$env" --arg id "$id" --arg img "$image" --arg b "$before" --arg a "$after" --arg sb "$sb" \
  --argjson d "$down_s" '{env:$env, machine:$id, image:$img, checksums_before:$b, checksums:$a, shared_buffers:$sb,
  autoextend:"80% +2GB max 50GB", down_s:$d}'
[[ "$after" == "on" ]]
