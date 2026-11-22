#!/usr/bin/env bash
# EN-16 (#175): runs the Android flows on a booted emulator and records metrics.
# Usage: android-run.sh <profile> <apk> <out-dir>
# Needs: adb, maestro on PATH, hermetic backend on the runner (infra/e2e/compose.e2e.yml) + Testbot.
set -uo pipefail
PROFILE="$1"; APK="$2"; OUT="$3"
FLOWS="$(cd "$(dirname "$0")/../../apps/mobile/e2e/flows" && pwd)"
PKG=app.thirstr
mkdir -p "$OUT/maestro" "$OUT/shots"
M="$OUT/metrics.json"
echo '{}' >"$M"
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
netbytes() { adb shell cat /proc/net/dev | awk -F'[: ]+' 'NR>2 && $2 != "lo" {s += $3 + $11} END {print s+0}'; }

adb install -r -g "$APK" >/dev/null || { echo "::error::install failed"; exit 1; }
put apk_bytes "$(stat -c %s "$APK")"
put js_bundle_bytes "$(unzip -l "$APK" assets/index.android.bundle | awk 'NR==4{print $1}')"
adb emu geo fix 8.4887 47.3914 >/dev/null 2>&1 || true   # Zurich Altstetten (Testbot's area)
adb shell settings put global window_animation_scale 0; adb shell settings put global transition_animation_scale 0; adb shell settings put global animator_duration_scale 0

# Cold start to first frame (am start -W), app installed + never started before = worst case
adb shell am force-stop $PKG
ff=$(adb shell am start -W -n $PKG/.MainActivity | awk -F': ' '/TotalTime/{print $2+0}')
put first_frame_ms "${ff:-null}"
sleep 5; adb shell am force-stop $PKG

net0=$(netbytes)
status=0
for f in launch onboarding explore chat checkin; do
  t0=$(date +%s.%N)
  maestro --device emulator-5554 test "$FLOWS/$f.yaml" -e PROFILE="$PROFILE" \
    --debug-output "$OUT/maestro/$f" --flatten-debug-output --test-output-dir "$OUT/shots" >"$OUT/maestro/$f.log" 2>&1
  rc=$?; t1=$(date +%s.%N)
  put "flow_${f}_s" "$(python3 -c "print(round($t1-$t0,1))")"
  put "flow_${f}" "$([ $rc = 0 ] && echo '"pass"' || echo '"fail"')"
  [ $rc = 0 ] || { status=1; echo "::error::flow $f failed on $PROFILE"; tail -30 "$OUT/maestro/$f.log"; adb exec-out screencap -p >"$OUT/shots/FAILED-$f.png"; break; }
  if [ "$f" = launch ]; then put tti_ms "$(python3 "$(dirname "$0")/tti.py" "$OUT/maestro/launch")"; fi
  if [ "$f" = explore ]; then
    put pss_mb "$(adb shell dumpsys meminfo $PKG | awk '/TOTAL PSS:/{print int($3/1024); exit} /^ *TOTAL /{print int($2/1024); exit}')"
  fi
done
put net_bytes "$(( $(netbytes) - net0 ))"
adb logcat -d -s ReactNativeJS:V ReactNative:V AndroidRuntime:E >"$OUT/logcat.txt" 2>/dev/null || true
exit $status
