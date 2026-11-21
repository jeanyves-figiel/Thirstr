#!/usr/bin/env bash
# Chaos experiments on STAGING ONLY (EN-15 #174). Runbook: docs/runbooks/game-day.md.
# Usage: chaos.sh <api-kill|api-stop|valkey-down|db-restart|disk-fill|all> [duration_s]
# Env: FLY_TOKEN (Fly API token), BASE (default https://staging.thirstr.fun), OUT (report dir).
# Every fault is undone in a trap, also on error or cancel. Prod app names are refused.
set -euo pipefail

EXP="${1:?experiment}"
DURATION="${2:-120}"
BASE="${BASE:-https://staging.thirstr.fun}"
OUT="${OUT:-$(mktemp -d)}"
API_APP=thirstr-api-staging
DB_APP=thirstr-db-staging
VALKEY_APP=thirstr-valkey-staging
MACHINES=https://api.machines.dev/v1
# Tests only: a local mock of the Machines API (scripts/chaos/test.sh).
[[ "${MACHINES_MOCK:-}" == http://127.0.0.1:* ]] && MACHINES="$MACHINES_MOCK"
HERE="$(cd "$(dirname "$0")" && pwd)"

nap() { if [[ -n "${CHAOS_FAST:-}" ]]; then sleep 5; else sleep "$1"; fi; }  # CHAOS_FAST: tests only
die() { echo "::error::$*" >&2; exit 1; }

# --- Guards -------------------------------------------------------------------------
for v in "$EXP" "$BASE" "$API_APP" "$DB_APP" "$VALKEY_APP"; do
  [[ "$v" != *prod* ]] || die "refusing: '$v' mentions prod (chaos is staging-only)"
done
for a in "$API_APP" "$DB_APP" "$VALKEY_APP"; do [[ "$a" == thirstr-*-staging ]] || die "unexpected app $a"; done
[[ "$BASE" == "https://staging.thirstr.fun" || "$BASE" == http://localhost* ]] || die "BASE must be staging"
[[ "$DURATION" =~ ^[0-9]+$ && "$DURATION" -ge 10 && "$DURATION" -le 600 ]] || die "duration must be 10..600 s"
[[ -n "${FLY_TOKEN:-}" ]] || die "FLY_TOKEN missing"
mkdir -p "$OUT"

fly() { # fly <METHOD> <path> [json]
  local m="$1" p="$2" d="${3:-}"
  [[ "$p" != *prod* ]] || die "refusing Fly call on $p"
  if [[ -n "$d" ]]; then
    curl -fsS -X "$m" -H "Authorization: Bearer $FLY_TOKEN" -H 'content-type: application/json' -d "$d" "$MACHINES$p"
  else
    curl -fsS -X "$m" -H "Authorization: Bearer $FLY_TOKEN" "$MACHINES$p"
  fi
}
machine_id() { # first app-group machine of an app
  fly GET "/apps/$1/machines" | jq -r '[.[] | select((.config.metadata.fly_process_group // "app") == "app") | select(.state != "destroyed")][0].id // empty'
}
state() { fly GET "/apps/$1/machines/$2" | jq -r .state; }
wait_state() { # app id state timeout_s
  local t=0
  until [[ "$(state "$1" "$2")" == "$3" ]]; do
    sleep 2; t=$((t + 2)); [[ $t -lt $4 ]] || { echo "::warning::$1/$2 not $3 after $4 s"; return 1; }
  done
}
ensure_started() { # app id: start again if not running (restore)
  local s; s="$(state "$1" "$2" || echo unknown)"
  if [[ "$s" != "started" ]]; then
    echo "restore: starting $1/$2 (was $s)"
    fly POST "/apps/$1/machines/$2/start" >/dev/null || true
    wait_state "$1" "$2" started 120 || true
  fi
}
exec_on() { # app id cmd → stdout
  fly POST "/apps/$1/machines/$2/exec" "$(jq -nc --arg c "$3" '{command: ["sh", "-c", $c], timeout: 60}')" | jq -r '.stdout // ""'
}

# --- Probe ----------------------------------------------------------------------------
PROBE_PID=""
probe_start() { # $1 = log file
  ( while :; do
      for ep in /v1/health /v1/config /v1/welcome; do
        r=$(curl -s -o /dev/null -m 5 -w '%{http_code} %{time_total}' "$BASE$ep" || echo "000 5")
        echo "$(date +%s.%N) $ep $r"
      done
      sleep 1
    done ) >"$1" 2>/dev/null &
  PROBE_PID=$!
}
probe_stop() { [[ -n "$PROBE_PID" ]] && kill "$PROBE_PID" 2>/dev/null || true; PROBE_PID=""; }

RESTORE=()
restore_all() {
  probe_stop
  local r
  for r in "${RESTORE[@]+"${RESTORE[@]}"}"; do eval "$r" || true; done
  RESTORE=()
}
trap restore_all EXIT INT TERM

marker() { echo "$(date +%s.%N) MARK $1" >>"$LOG"; }

# --- Experiments ------------------------------------------------------------------------
run_one() {
  local exp="$1"
  LOG="$OUT/$exp.log"; : >"$LOG"
  echo "::group::$exp"
  probe_start "$LOG.probe"
  nap 15; marker fault
  case "$exp" in
    api-kill)
      local id; id="$(machine_id $API_APP)"; [[ -n "$id" ]] || die "no API machine"
      RESTORE+=("ensure_started $API_APP $id")
      fly POST "/apps/$API_APP/machines/$id/signal" '{"signal":"SIGKILL"}' >/dev/null
      echo "SIGKILL sent to $API_APP/$id"
      nap 90 ;;
    api-stop)
      local id; id="$(machine_id $API_APP)"; [[ -n "$id" ]] || die "no API machine"
      RESTORE+=("ensure_started $API_APP $id")
      fly POST "/apps/$API_APP/machines/$id/stop" '{"signal":"SIGTERM","timeout":"35s"}' >/dev/null
      wait_state $API_APP "$id" stopped 60 || true
      marker stopped; echo "API stopped; probe traffic should auto-start it"
      nap 60 ;;
    valkey-down)
      local id; id="$(machine_id $VALKEY_APP)"; [[ -n "$id" ]] || die "no Valkey machine"
      RESTORE+=("ensure_started $VALKEY_APP $id")
      fly POST "/apps/$VALKEY_APP/machines/$id/stop" >/dev/null
      wait_state $VALKEY_APP "$id" stopped 60 || true
      nap "$DURATION"
      marker restore; ensure_started $VALKEY_APP "$id"
      nap 30 ;;
    db-restart)
      local id; id="$(machine_id $DB_APP)"; [[ -n "$id" ]] || die "no DB machine"
      RESTORE+=("ensure_started $DB_APP $id")
      fly POST "/apps/$DB_APP/machines/$id/stop" '{"signal":"SIGINT","timeout":"60s"}' >/dev/null  # SIGINT = Postgres fast shutdown
      wait_state $DB_APP "$id" stopped 90 || true
      nap 20
      marker restore; ensure_started $DB_APP "$id"
      nap 60 ;;
    disk-fill)
      local id; id="$(machine_id $API_APP)"; [[ -n "$id" ]] || die "no API machine"
      RESTORE+=("exec_on $API_APP $id 'rm -f /tmp/chaos.fill' >/dev/null")
      exec_on $API_APP "$id" 'set -e; read -r total used <<EOF
$(df -Pk / | awk "NR==2{print \$2, \$3}")
EOF
n=$(( total * 95 / 100 - used )); [ "$n" -gt 0 ] || n=0
fallocate -l "${n}K" /tmp/chaos.fill 2>/dev/null || dd if=/dev/zero of=/tmp/chaos.fill bs=1M count=$(( n / 1024 )) 2>/dev/null
df -Ph /'
      nap "$DURATION"
      marker restore; exec_on $API_APP "$id" 'rm -f /tmp/chaos.fill; df -Ph /'
      nap 20 ;;
    *) die "unknown experiment $exp" ;;
  esac
  restore_all
  cat "$LOG.probe" >>"$LOG"; rm -f "$LOG.probe"
  python3 "$HERE/report.py" "$exp" "$LOG" | tee -a "$OUT/summary.md"
  echo "::endgroup::"
}

ALL=(api-stop api-kill valkey-down db-restart disk-fill)
echo "# Chaos run on staging $(date -u +%FT%TZ), duration ${DURATION}s" >"$OUT/summary.md"
if [[ "$EXP" == all ]]; then
  for e in "${ALL[@]}"; do run_one "$e"; nap 120; done
else
  run_one "$EXP"
fi
! grep -q '| FAIL' "$OUT/summary.md" || die "at least one experiment failed (see summary)"
