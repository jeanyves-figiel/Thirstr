#!/usr/bin/env bash
# EN-16 (#175): old-iPhone profile on the iOS simulator, 3G via dummynet, against staging (signed out).
# Usage: ios-run.sh <app-path> <out-dir>
set -uo pipefail
APP="$1"; OUT="$2"
FLOWS="$(cd "$(dirname "$0")/../../apps/mobile/e2e/flows" && pwd)"
mkdir -p "$OUT/maestro" "$OUT/shots"
M="$OUT/metrics.json"; echo '{}' >"$M"
put() { python3 - "$M" "$1" "$2" <<'PY'
import json, sys
p, k, v = sys.argv[1:]
d = json.load(open(p))
try: v = json.loads(v)
except ValueError: pass
d[k] = v
json.dump(d, open(p, "w"), indent=1)
PY
}
put app_bytes "$(du -sk "$APP" | awk '{print $1*1024}')"
put js_bundle_bytes "$(stat -f %z "$APP/main.jsbundle")"

# Old-iPhone class device on the newest runtime on the image (older runtimes aren't installed).
rt=$(xcrun simctl list runtimes -j | python3 -c "import json,sys;r=[x for x in json.load(sys.stdin)['runtimes'] if x['isAvailable'] and x['platform']=='iOS'];print(sorted(r,key=lambda x:[int(p) for p in x['version'].split('.')])[-1]['identifier'])")
dt=$(xcrun simctl list devicetypes -j | python3 -c "
import json,sys
t={x['name']:x['identifier'] for x in json.load(sys.stdin)['devicetypes']}
for n in ['iPhone SE (3rd generation)','iPhone 11','iPhone 12 mini','iPhone 13 mini','iPhone SE (2nd generation)','iPhone 16e','iPhone 15','iPhone 16']:
    if n in t: print(n+'|'+t[n]); break
")
put device "\"${dt%%|*} / ${rt##*.}\""
udid=$(xcrun simctl create e2e-old "${dt##*|}" "$rt") || { echo "::error::no simulator for ${dt%%|*} on $rt (device may not support this iOS)"; exit 1; }
xcrun simctl boot "$udid"; xcrun simctl bootstatus "$udid" -b
xcrun simctl install "$udid" "$APP"
xcrun simctl privacy "$udid" grant location app.thirstr 2>/dev/null || true
xcrun simctl location "$udid" set 47.3914,8.4887 2>/dev/null || true

# 3G: 780 kbit/s down, 330 kbit/s up, 100 ms each way, on the default route only (Maestro uses loopback).
ifc=$(route -n get default | awk '/interface:/{print $2}')
sudo dnctl pipe 1 config bw 780Kbit/s delay 100
sudo dnctl pipe 2 config bw 330Kbit/s delay 100
printf 'dummynet in on %s all pipe 1\ndummynet out on %s all pipe 2\n' "$ifc" "$ifc" | sudo pfctl -q -f - 2>/dev/null
sudo pfctl -q -E 2>/dev/null || true

status=0
for f in launch signin-sheet; do
  t0=$(date +%s.%N)
  maestro --device "$udid" test "$FLOWS/$f.yaml" --debug-output "$OUT/maestro/$f" --flatten-debug-output --test-output-dir "$OUT/shots" >"$OUT/maestro/$f.log" 2>&1
  rc=$?; t1=$(date +%s.%N)
  put "flow_${f}_s" "$(python3 -c "print(round($t1-$t0,1))")"
  put "flow_${f}" "$([ $rc = 0 ] && echo '"pass"' || echo '"fail"')"
  [ $rc = 0 ] || { status=1; echo "::error::flow $f failed on ios-old"; tail -30 "$OUT/maestro/$f.log"; xcrun simctl io "$udid" screenshot "$OUT/shots/FAILED-$f.png" || true; break; }
  [ "$f" = launch ] && put tti_ms "$(python3 "$(dirname "$0")/tti.py" "$OUT/maestro/launch")"
done
rss=$(ps -axo rss=,command= | awk '/Thirstr.app\/Thirstr/ && !/awk/ {print int($1/1024); exit}')
put rss_mb "${rss:-null}"
put net_bytes "$(sudo dnctl pipe show 2>/dev/null | awk '{for(i=1;i<NF;i++) if($(i+1)=="bytes" || $(i+1)=="Bytes") s+=$i} END{print s+0}')"
sudo pfctl -q -d 2>/dev/null || true; sudo dnctl -q flush 2>/dev/null || true
xcrun simctl spawn "$udid" log show --last 10m --predicate 'process == "Thirstr"' --style compact >"$OUT/app.log" 2>/dev/null || true
exit $status
