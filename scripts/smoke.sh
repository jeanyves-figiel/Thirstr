#!/usr/bin/env bash
# Smoke checks after deploy (ops.md). Usage: smoke.sh <base-url> [expected-release-sha]
# FORCE_INSTANCE=<machine id> pins every request to one machine (canary, EN-12) via Fly's fly-force-instance-id.
set -euo pipefail
base="$1"; sha="${2:-}"
pin=(); [[ -n "${FORCE_INSTANCE:-}" ]] && pin=(-H "fly-force-instance-id: ${FORCE_INSTANCE}")
curl() { command curl "${pin[@]}" "$@"; }
for i in $(seq 1 30); do
  body=$(curl -fsS "$base/v1/health" || true)
  if [[ -n "$body" && ( -z "$sha" || "$body" == *"$sha"* ) ]]; then break; fi
  sleep 5
done
echo "health: $body"
[[ -z "$sha" || "$body" == *"$sha"* ]] || { echo "::error::release $sha not live"; exit 1; }
# Welcome counts endpoint answers without auth and never returns profile fields
curl -fsS "$base/v1/welcome" | grep -q '"cells"'
# Email link: always 202 (R-01.3)
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{"email":"smoke@example.invalid"}' "$base/v1/auth/email/link")
[[ "$code" == "202" ]] || { echo "::error::email link returned $code"; exit 1; }
# Auth required
code=$(curl -s -o /dev/null -w '%{http_code}' "$base/v1/me")
[[ "$code" == "401" ]] || { echo "::error::/v1/me returned $code"; exit 1; }
# Dev-only routes must not exist outside DEV
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$base/v1/dev/oidc/token")
[[ "$code" == "404" ]] || { echo "::error::dev route exposed ($code)"; exit 1; }
echo "smoke OK"
