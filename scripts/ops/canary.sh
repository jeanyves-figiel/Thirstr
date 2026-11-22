#!/usr/bin/env bash
# Canary deploy for an API app (EN-12 #171; runbook docs/runbooks/canary.md).
#
#   canary.sh <app> <new image ref> <previous image ref> [watch minutes, default 10]
#
# 1. Runs migrations once from the new image in a one-off machine (expand-only, enforced by
#    scripts/check-migrations.py, so the old image keeps working on the new schema).
# 2. Moves ONE machine (the canary) to the new image; the other machines keep serving the old one.
# 3. Watches the canary for <minutes>: health + smoke pinned to it (fly-force-instance-id), its 5xx share,
#    p95 latency and crashes from Fly Prometheus, compared with the old machines, and its restarts.
# 4. Gate fails → canary goes back to <previous image>, exit 1. Gate passes → exit 0 (caller rolls out the rest).
#
# Needs FLY_API_TOKEN, flyctl, curl, jq. Thresholds can be overridden by env (see below).
set -euo pipefail
app="$1"; image="$2"; prev="$3"; minutes="${4:-10}"
base_url="${CANARY_BASE_URL:-https://api.thirstr.fun}"
max_5xx="${CANARY_MAX_5XX:-0.02}"          # canary 5xx share must stay ≤ max(2 %, old + 1 pt)
max_p95_ms="${CANARY_MAX_P95_MS:-500}"     # canary p95 ≤ max(500 ms, 2 × old p95)
min_requests="${CANARY_MIN_REQUESTS:-30}"  # below this, real-traffic gates are skipped (synthetic gates still run)
max_probe_fail="${CANARY_MAX_PROBE_FAIL:-1}"
prom="https://api.fly.io/prometheus/${FLY_ORG:-personal}/api/v1/query"
machines_api="https://api.machines.dev/v1/apps/${app}"
log() { echo "[canary $(date -u +%H:%M:%S)] $*" >&2; }
m_api() { curl -fsS -H "Authorization: Bearer ${FLY_API_TOKEN}" -H 'content-type: application/json' "$@"; }
promq() { # promq <query> → first value or empty
  curl -fsS -H "Authorization: FlyV1 ${FLY_API_TOKEN}" "$prom" --data-urlencode "query=$1" | jq -r '.data.result[0].value[1] // empty'
}
summary() { [[ -n "${GITHUB_STEP_SUMMARY:-}" ]] && echo "$*" >> "$GITHUB_STEP_SUMMARY" || true; }

machines=$(m_api "${machines_api}/machines" | jq -c '[.[] | select((.config.metadata.fly_process_group // "app") == "app" and .state == "started")]')
count=$(jq length <<<"$machines")
(( count >= 2 )) || { log "only $count started app machine(s): canary needs ≥ 2, use a plain rolling deploy"; exit 3; }
canary=$(jq -r '.[0].id' <<<"$machines")
others=$(jq -r '[.[1:][].id] | join("|")' <<<"$machines")
log "app $app: canary $canary, others $others, image $image"

# 1. Migrations (one-off machine, same as Fly's release_command machine; not part of the app group).
mig_cfg=$(m_api "${machines_api}/machines/${canary}" | jq -c --arg img "$image" '.config
  | .image = $img | .init = {exec:["/app/bin/migrate"]} | .restart = {policy:"no"} | .auto_destroy = false
  | del(.services) | del(.checks) | .metadata = {fly_process_group:"fly_app_release_command", purpose:"canary-migrate"}')
mig=$(m_api -X POST "${machines_api}/machines" -d "$(jq -nc --argjson c "$mig_cfg" '{name:"canary-migrate",region:"fra",config:$c}')" | jq -r .id)
log "migrate machine $mig"
for _ in $(seq 1 120); do
  st=$(m_api "${machines_api}/machines/${mig}" | jq -r .state)
  [[ "$st" == "stopped" || "$st" == "destroyed" ]] && break
  sleep 5
done
rc=$(m_api "${machines_api}/machines/${mig}/events" 2>/dev/null | jq -r '[.[] | select(.type=="exit")][0].request.exit_event.exit_code // empty' || true)
[[ -n "$rc" ]] || rc=$(m_api "${machines_api}/machines/${mig}" | jq -r '[.events[] | select(.type=="exit")][0].request.exit_event.exit_code // "unknown"')
flyctl logs -a "$app" -i "$mig" --no-tail 2>/dev/null | tail -n 30 >&2 || true
m_api -X DELETE "${machines_api}/machines/${mig}?force=true" >/dev/null 2>&1 || true
[[ "$rc" == "0" ]] || { log "migrations failed (exit $rc): nothing was switched"; summary "❌ Canary: migrations failed (exit $rc), no machine changed."; exit 1; }
log "migrations ok"

rollback() {
  log "gate failed: $1 → canary back to $prev"
  summary "❌ Canary gate failed: $1. Canary $canary rolled back to the previous image."
  flyctl machine update "$canary" --app "$app" --image "$prev" --yes --wait-timeout 300 >&2 || log "WARN rollback update failed: check $canary"
  exit 1
}

# 2. Canary machine to the new image (flyctl waits for its health checks).
flyctl machine update "$canary" --app "$app" --image "$image" --yes --wait-timeout 300 >&2 || rollback "canary did not become healthy"
t0=$(date +%s)
restarts0=$(m_api "${machines_api}/machines/${canary}" | jq '[.events[] | select(.type=="exit")] | length')

# Full smoke pinned to the canary.
FORCE_INSTANCE="$canary" ./scripts/smoke.sh "$base_url" >&2 || rollback "smoke on canary failed"

# 3. Watch.
fails=0; end=$(( t0 + minutes * 60 ))
while (( $(date +%s) < end )); do
  sleep 30
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "fly-force-instance-id: ${canary}" --max-time 5 "${base_url}/v1/health" || echo 000)
  [[ "$code" == "200" ]] || { fails=$((fails + 1)); log "health on canary: $code ($fails)"; }
  (( fails <= max_probe_fail )) || rollback "health probe failed $fails times"
  restarts=$(m_api "${machines_api}/machines/${canary}" | jq '[.events[] | select(.type=="exit")] | length')
  (( restarts == restarts0 )) || rollback "canary machine restarted"
done

w="$(( $(date +%s) - t0 ))s"
sel_c="app=\"${app}\",instance=\"${canary}\""; sel_o="app=\"${app}\",instance=~\"${others}\""
req_c=$(promq "sum(increase(phoenix_router_dispatch_stop_duration_count{${sel_c}}[${w}]))"); req_c=${req_c:-0}
err_c=$(promq "sum(increase(phoenix_router_dispatch_stop_duration_count{${sel_c},status=~\"5..\"}[${w}]))"); err_c=${err_c:-0}
req_o=$(promq "sum(increase(phoenix_router_dispatch_stop_duration_count{${sel_o}}[${w}]))"); req_o=${req_o:-0}
err_o=$(promq "sum(increase(phoenix_router_dispatch_stop_duration_count{${sel_o},status=~\"5..\"}[${w}]))"); err_o=${err_o:-0}
exc_c=$(promq "sum(increase(phoenix_router_dispatch_exception_count{${sel_c}}[${w}]))"); exc_c=${exc_c:-0}
p95_c=$(promq "histogram_quantile(0.95, sum by (le) (rate(phoenix_router_dispatch_stop_duration_bucket{${sel_c}}[${w}])))")
p95_o=$(promq "histogram_quantile(0.95, sum by (le) (rate(phoenix_router_dispatch_stop_duration_bucket{${sel_o}}[${w}])))")
log "canary: ${req_c} req, ${err_c} 5xx, ${exc_c} exceptions, p95 ${p95_c:-n/a} ms | old: ${req_o} req, ${err_o} 5xx, p95 ${p95_o:-n/a} ms"
summary "| | requests | 5xx | p95 ms |"; summary "|---|---|---|---|"
summary "| canary \`$canary\` (${w}) | ${req_c} | ${err_c} | ${p95_c:-n/a} |"; summary "| old machines | ${req_o} | ${err_o} | ${p95_o:-n/a} |"

verdict=$(jq -rn --argjson rc "$req_c" --argjson ec "$err_c" --argjson ro "$req_o" --argjson eo "$err_o" \
  --arg pc "${p95_c:-}" --arg po "${p95_o:-}" --argjson min "$min_requests" --argjson m5 "$max_5xx" --argjson mp "$max_p95_ms" '
  def num: if . == "" or . == "NaN" then null else tonumber end;
  if $rc < $min then "ok-low-traffic"
  else ($ec / $rc) as $sc | (if $ro > 0 then $eo / $ro else 0 end) as $so
    | ([$m5, $so + 0.01] | max) as $lim5
    | ($pc | num) as $p | ($po | num) as $q
    | ([$mp, (if $q then 2 * $q else 0 end)] | max) as $limp
    | if $sc > $lim5 then "5xx share \($sc * 100 | floor) % > \($lim5 * 100 | floor) %"
      elif $p and $p > $limp then "p95 \($p | floor) ms > \($limp | floor) ms"
      else "ok" end end')
[[ "$verdict" == ok* ]] || rollback "$verdict"
(( $(printf '%.0f' "$exc_c") == 0 )) || rollback "$(printf '%.0f' "$exc_c") crashed requests (exceptions) on canary"
log "gate passed ($verdict)"
summary "✅ Canary gate passed ($verdict) after ${w}."
