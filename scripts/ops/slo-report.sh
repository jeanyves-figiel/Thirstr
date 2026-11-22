#!/usr/bin/env bash
# Weekly SLO report (EN-04 #163, docs/spec/slos.md › 5). Prints Markdown on stdout.
#   slo-report.sh [app ...]   (default: thirstr-api-prod thirstr-api-staging)
# Needs FLY_API_TOKEN (Fly Prometheus, read-only queries), curl, jq. Optional STATUS_JSON = path/URL of status.json (SLO-2).
set -euo pipefail
apps=("$@"); [[ ${#apps[@]} -gt 0 ]] || apps=(thirstr-api-prod thirstr-api-staging)
prom="https://api.fly.io/prometheus/${FLY_ORG:-thirstr}/api/v1/query"
q() { curl -fsS -H "Authorization: FlyV1 ${FLY_METRICS_TOKEN:-$FLY_API_TOKEN}" "$prom" --data-urlencode "query=$1" | jq -r '.data.result[0].value[1] // empty' 2>/dev/null || true; }
pct() { [[ -z "$1" || "$1" == "NaN" ]] && { echo "–"; return; }; awk -v x="$1" 'BEGIN{printf "%.3f %%", x*100}'; }
# budget left = 1 - bad_ratio / allowed_bad
left() { [[ -z "$1" || "$1" == "NaN" ]] && { echo "–"; return; }; awk -v b="$1" -v a="$2" 'BEGIN{l=1-b/a; if(l<-9.99)l=-9.99; printf "%.0f %%", l*100}'; }

declare -A e m x c
req='phoenix_router_dispatch_stop_duration'
echo "## SLO weekly review · $(date -u +%F)"
echo
echo "Spec: \`docs/spec/slos.md\`. Budget left is for the rolling 28 days (policy §4: > 50 % ship normally · 0–50 % risky changes wait · < 0 fixes only)."
for app in "${apps[@]}"; do
  s="app=\"$app\""
  echo
  echo "### \`$app\`"
  echo
  echo "| SLO | Objective | 7 d | 28 d | Budget left (28 d) | Requests 28 d |"
  echo "|---|---|---|---|---|---|"
  n28=$(q "sum(increase(${req}_count{$s}[28d]))")
  for w in 7d 28d; do
    e[$w]=$(q "(sum(increase(${req}_count{$s,status=~\"5..\"}[$w])) or vector(0)) / sum(increase(${req}_count{$s}[$w]))")
    m[$w]=$(q "1 - sum(increase(${req}_bucket{$s,route=\"/v1/mls/messages\",le=\"500\"}[$w])) / sum(increase(${req}_count{$s,route=\"/v1/mls/messages\"}[$w]))")
    # le="300" exists from this release on; before it, the stricter 250 bucket stands in
    x[$w]=$(q "1 - (sum(increase(${req}_bucket{$s,route=~\"/v1/explore/(grid|map|tray|summary)\",le=\"300\"}[$w])) or sum(increase(${req}_bucket{$s,route=~\"/v1/explore/(grid|map|tray|summary)\",le=\"250\"}[$w]))) / sum(increase(${req}_count{$s,route=~\"/v1/explore/(grid|map|tray|summary)\"}[$w]))")
    c[$w]=$(q "(sum(increase(thirstr_client_error_count{$s,fatal=\"true\"}[$w])) or vector(0)) / sum(increase(thirstr_client_session_count{$s}[$w]))")
  done
  good() { [[ -z "$1" || "$1" == "NaN" ]] && echo "" || awk -v x="$1" 'BEGIN{print 1-x}'; }
  printf '| SLO-1 API available | 99.9 %% | %s | %s | %s | %s |\n' "$(pct "$(good "${e[7d]}")")" "$(pct "$(good "${e[28d]}")")" "$(left "${e[28d]}" 0.001)" "${n28:-0}"
  printf '| SLO-3 Messages < 500 ms | 95 %% | %s | %s | %s | |\n' "$(pct "$(good "${m[7d]}")")" "$(pct "$(good "${m[28d]}")")" "$(left "${m[28d]}" 0.05)"
  printf '| SLO-4 Map/grid < 300 ms | 95 %% | %s | %s | %s | |\n' "$(pct "$(good "${x[7d]}")")" "$(pct "$(good "${x[28d]}")")" "$(left "${x[28d]}" 0.05)"
  printf '| SLO-5 Crash-free sessions | 99.5 %% | %s | %s | %s | |\n' "$(pct "$(good "${c[7d]}")")" "$(pct "$(good "${c[28d]}")")" "$(left "${c[28d]}" 0.005)"
  ov=$(q "max(max_over_time(thirstr_retention_overdue{$s}[7d]))")
  printf '| SLO-6 Retention on time | 0 overdue | max %s | | | |\n' "${ov:-–}"
done
if [[ -n "${STATUS_JSON:-}" ]]; then
  sj=$( [[ "$STATUS_JSON" == http* ]] && curl -fsS "$STATUS_JSON" || cat "$STATUS_JSON" ) || sj=""
  if [[ -n "$sj" ]]; then
    echo
    echo "### SLO-2 reachable from outside (status prober, 90 d)"
    echo
    jq -r '"| Component | Now | 90 d |", "|---|---|---|", (.components[] | "| \(.id) | \(.state) | \(.uptime90 // "–") % |")' <<<"$sj"
    echo
    echo "Incidents in the last 7 days: $(jq --arg since "$(date -u -d '7 days ago' +%FT%TZ)" '[.incidents[] | select(.kind=="incident" and .opened >= $since)] | length' <<<"$sj")"
  fi
fi
echo
echo "_Low traffic: a ratio over fewer than ~1 000 requests moves a lot with one error; read it with the request count._"
