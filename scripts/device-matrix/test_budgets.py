#!/usr/bin/env python3
"""Unit test for budgets.py (run in CI › infra)."""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from budgets import check  # noqa: E402

B = {"p": {"js_bundle_bytes": {"max": 100, "enforce": True}, "tti_ms": {"max": 10}}}
_, f = check("p", {"js_bundle_bytes": 90, "tti_ms": 50, "flow_launch": "pass", "flow_launch_s": 3}, B)
assert f == [], f  # report-only over budget does not fail
_, f = check("p", {"js_bundle_bytes": 120, "flow_launch": "pass"}, B)
assert len(f) == 1 and "JS bundle" in f[0], f
_, f = check("p", {"js_bundle_bytes": 90, "flow_launch": "fail"}, B)
assert f == ["flow launch failed"], f
_, f = check("p", {}, B)
assert "no flow ran" in f, f
real = json.load(open(os.path.join(os.path.dirname(__file__), "..", "..", "apps", "mobile", "e2e", "budgets.json")))
real.pop("_doc", None)
for prof in ("android-low", "android-mid", "ios-old"):
    assert prof in real, prof
    for k, r in real[prof].items():
        assert isinstance(r["max"], (int, float)) and r["max"] > 0, (prof, k)
print("budgets ok")
