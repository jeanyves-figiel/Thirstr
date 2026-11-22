#!/usr/bin/env bash
# EN-09 (#168, docs/runbooks/fly-org-move.md): move one environment's Fly apps from `personal` to
# the org `thirstr`, in the order that keeps the private network consistent. Run on the owner's
# laptop (flyctl logged in as the owner, member of both orgs). Prod only between waves, never
# during a promote, with the owner's OK at the time (the release orchestrator thread coordinates).
# Usage: scripts/ops/fly-org-move.sh <staging|prod> [--yes]
set -euo pipefail
env="${1:-}"; yes="${2:-}"; org="${THIRSTR_ORG:-thirstr}"
case "$env" in
  staging) host=staging.thirstr.fun; deps="thirstr-db-staging thirstr-valkey-staging thirstr-classifier-staging thirstr-bot-staging" ;;
  prod)    host=api.thirstr.fun;     deps="thirstr-db-prod thirstr-valkey-prod thirstr-classifier-prod" ;;
  *) echo "usage: $0 <staging|prod> [--yes]" >&2; exit 2 ;;
esac
api="thirstr-api-$env"
here="$(cd "$(dirname "$0")/../.." && pwd)"
command -v flyctl >/dev/null || { echo "flyctl missing" >&2; exit 1; }
flyctl orgs show "$org" >/dev/null || { echo "org $org not visible to this login" >&2; exit 1; }
exists() { flyctl status -a "$1" >/dev/null 2>&1; }
org_of() { flyctl apps list --json | jq -r --arg a "$1" '.[] | select(.Name == $a) | .Organization.Slug'; }

echo "Plan ($env → $org): stop $api → move $deps → move $api → start $api → smoke $host"
[[ "$yes" == "--yes" ]] || { read -r -p "Go? [y/N] " a; [[ "$a" == y* ]] || exit 1; }
t0=$(date +%s)

ids=$(flyctl machines list -a "$api" --json | jq -r '.[] | select(.config.metadata.fly_process_group // "app" | . == "app") | .id')
echo "1/5 stop $api machines: $ids"
for id in $ids; do flyctl machine stop "$id" -a "$api" || true; done

echo "2/5 move dependencies"
for app in $deps; do
  if ! exists "$app"; then echo "  skip $app (does not exist)"; continue; fi
  if [[ "$(org_of "$app")" == "$org" ]]; then echo "  $app already in $org"; continue; fi
  flyctl apps move "$app" --org "$org" --yes
  # `apps move` only updates machines it manages (fly_process_group). Machines made through the
  # Machines API (our DB) keep their old-org 6PN address until updated: force a no-op update.
  for id in $(flyctl machines list -a "$app" --json | jq -r '.[] | select(.config.metadata.fly_process_group == null) | .id'); do
    flyctl machine update "$id" -a "$app" --metadata "org_move=$(date +%s)" --yes
  done
done

echo "3/5 classifier private address (flycast is per org)"
cls="thirstr-classifier-$env"
if exists "$cls"; then
  # The old flycast address moves with the app but stays on the old org's network: release it,
  # then allocate one in the new org (an app can hold only one). CLASSIFIER_URL uses the
  # .flycast name, so nothing else changes. Never add a public IP here.
  for ip in $(flyctl ips list -a "$cls" --json | jq -r '.[] | select(.Type == "private_v6") | .Address'); do
    flyctl ips release "$ip" -a "$cls"
  done
  flyctl ips allocate-v6 --private -a "$cls" --org "$org"
fi

echo "4/5 move + start $api"
[[ "$(org_of "$api")" == "$org" ]] || flyctl apps move "$api" --org "$org" --yes
for id in $(flyctl machines list -a "$api" --json | jq -r '.[] | select(.state != "started") | .id'); do flyctl machine start "$id" -a "$api" || true; done

echo "5/5 smoke"
"$here/scripts/smoke.sh" "https://$host"
echo "Done in $(( $(date +%s) - t0 )) s. Now: photo upload, chat message, then scripts/ops/fly-ci-tokens.sh $([[ $env == prod ]] && echo production || echo staging)."
echo "Rollback: same order with --org personal (fly-org-move.md › Rollback)."
