#!/usr/bin/env python3
"""Real-device metrics from a Test Lab run (EN-16, #175) via the Tool Results API.
Usage: testlab-metrics.py <project> <matrix-id> <access-token> → metrics.json on stdout.
Best effort: missing values become null (the budget step reports n/a)."""
import json, sys, urllib.request

P, MATRIX, TOK = sys.argv[1:4]


def get(url):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOK}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def ms(d):
    return None if not d else int(int(d.get("seconds", 0)) * 1000 + int(d.get("nanos", 0)) / 1e6)


out = {"first_frame_ms": None, "tti_ms": None, "pss_mb": None, "net_bytes": None, "flow_robo": "fail"}
try:
    tr = get(f"https://testing.googleapis.com/v1/projects/{P}/testMatrices/{MATRIX}")["testExecutions"][0]["toolResultsStep"]
    BASE = (f"https://toolresults.googleapis.com/toolresults/v1beta3/projects/{P}"
            f"/histories/{tr['historyId']}/executions/{tr['executionId']}")
    ex = get(BASE)
    out["flow_robo"] = "pass" if ex.get("outcome", {}).get("summary") in ("success", "flaky") else "fail"
    for st in get(BASE + "/steps").get("steps", []):
        s = get(f"{BASE}/steps/{st['stepId']}/perfMetricsSummary")
        a = s.get("appStartTime", {})
        out["first_frame_ms"] = ms(a.get("initialDisplayTime"))
        out["tti_ms"] = ms(a.get("fullyDrawnTime"))
        try:
            ser = get(f"{BASE}/steps/{st['stepId']}/perfSampleSeries").get("perfSampleSeries", [])
            for x in ser:
                kind = x.get("basicPerfSampleSeries", {}).get("perfMetricType")
                samples = get(f"{BASE}/steps/{st['stepId']}/perfSampleSeries/{x['sampleSeriesId']}/samples").get("perfSamples", [])
                vals = [float(v.get("value", 0)) for v in samples]
                if not vals:
                    continue
                if kind == "memory":  # KiB
                    out["pss_mb"] = int(max(vals) / 1024)
                elif kind == "network":  # KiB/s per second sample
                    out["net_bytes"] = int(out.get("net_bytes") or 0) + int(sum(vals) * 1024)
        except Exception as e:  # noqa: BLE001
            print(f"perf samples: {e}", file=sys.stderr)
        break
except Exception as e:  # noqa: BLE001
    print(f"tool results: {e}", file=sys.stderr)
print(json.dumps(out, indent=1))
