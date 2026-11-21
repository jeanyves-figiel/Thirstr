#!/usr/bin/env bash
# Offline test of chaos.sh against a mock Machines API + mock app (no Fly, no staging).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
tmp=$(mktemp -d); trap 'kill $(jobs -p) 2>/dev/null || true; rm -rf "$tmp"' EXIT
python3 "$HERE/mock.py" 18081 18082 >"$tmp/mock.log" 2>&1 &
for _ in $(seq 50); do curl -fs http://127.0.0.1:18082/v1/health >/dev/null 2>&1 && break; sleep 0.1; done
export FLY_TOKEN=test MACHINES_MOCK=http://127.0.0.1:18081/v1 BASE=http://localhost:18082 OUT="$tmp/out" CHAOS_FAST=1
for e in api-kill valkey-down db-restart disk-fill api-stop; do
  "$HERE/chaos.sh" "$e" 10 >"$tmp/$e.txt" 2>&1 || { cat "$tmp/$e.txt"; echo "FAIL $e"; exit 1; }
  grep -q "| $e |.*PASS" "$tmp/out/summary.md" || { cat "$tmp/out/summary.md" "$tmp/$e.txt"; echo "FAIL $e (no PASS row)"; exit 1; }
  # every machine started again
  curl -fs http://127.0.0.1:18081/v1/apps/x/state | grep -q '"stopped"' && { echo "FAIL $e left a machine stopped"; exit 1; }
  echo "ok $e"
done
out=$(FLY_TOKEN=x "$HERE/chaos.sh" prod 2>&1 || true)
grep -q refusing <<<"$out" || { echo "FAIL prod not refused: $out"; exit 1; }
echo "ok prod refused"
