#!/usr/bin/env bash
# Prints the image digest live on a Fly app and when it was rolled out, via the Machines API.
# Usage: fly-live-image.sh <app>   →   {"digest":"sha256:…","image":"…","since":<epoch s>}
# Fails if app machines run different digests (deploy in progress or drift).
set -euo pipefail
app="$1"
curl -fsS -H "Authorization: Bearer ${FLY_API_TOKEN}" "https://api.machines.dev/v1/apps/${app}/machines" |
  jq -e '
    [ .[] | select((.config.metadata.fly_process_group // "app") == "app")
          | select(.state != "destroyed" and .state != "destroying") ] as $ms
    | if ($ms | length) == 0 then error("no machines") else . end
    | ($ms | map(.image_ref.digest) | unique) as $d
    | if ($d | length) != 1 then error("machines run different digests: \($d)") else . end
    | {
        digest: $d[0],
        image: ($ms[0].image_ref | "\(.registry)/\(.repository)@\(.digest)"),
        since: ($ms | map([.events[] | select(.type == "launch" or .type == "update") | .timestamp] | max) | max / 1000 | floor)
      }'
