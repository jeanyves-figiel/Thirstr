#!/usr/bin/env bash
# D-03: no Fly machine outside EU regions. Fails CI if any fly.toml names another region.
set -euo pipefail
allowed=" fra ams cdg arn "
status=0
for f in infra/fly/*.toml; do
  while read -r region; do
    if [[ "$allowed" != *" $region "* ]]; then
      echo "::error file=$f::region '$region' is not an allowed EU region (fra, ams, cdg, arn)"
      status=1
    fi
  done < <(grep -Eo '(primary_region|region)\s*=\s*"[a-z]+"' "$f" | sed -E 's/.*"([a-z]+)"/\1/')
done
[ $status -eq 0 ] && echo "Fly regions OK (EU only)"
exit $status
