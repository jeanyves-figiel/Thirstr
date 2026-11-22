#!/usr/bin/env python3
"""EN-16/EN-18 budget check for one device-matrix profile.
Usage: budgets.py <profile> <metrics.json> [budgets.json] → Markdown on stdout; exit 1 when a flow
failed or an enforced budget is exceeded. Report-only budgets print ⚠ (testing.md › Device matrix)."""
import json, os, sys

DEFAULT = os.path.join(os.path.dirname(__file__), "..", "..", "apps", "mobile", "e2e", "budgets.json")
LABEL = {
    "js_bundle_bytes": "JS bundle", "apk_bytes": "APK size", "app_bytes": ".app size",
    "first_frame_ms": "Cold start → first frame", "tti_ms": "Cold start → Welcome",
    "pss_mb": "Memory (PSS, Android)", "rss_mb": "Memory (RSS)", "net_bytes": "Network during flows",
}


def fmt(k, v):
    if v is None:
        return "n/a"
    if k.endswith("_bytes"):
        return f"{v / 1e6:.2f} MB"
    if k.endswith("_ms"):
        return f"{v:,} ms"
    if k.endswith("_mb"):
        return f"{v} MB"
    if k.endswith("_s"):
        return f"{v} s"
    return str(v)


def check(profile, metrics, budgets):
    b = budgets.get(profile, {})
    lines = [f"### {profile}" + (f" · {metrics['device']}" if metrics.get("device") else ""), "",
             "| Metric | Value | Budget | |", "|---|---|---|---|"]
    failed = []
    for k, label in LABEL.items():
        if k not in metrics and k not in b:
            continue
        v, rule = metrics.get(k), b.get(k)
        mark, lim = "", "—"
        if rule:
            lim = fmt(k, rule["max"]) + (" (enforced)" if rule.get("enforce") else " (report)")
            if v is None:
                mark = "n/a"
            elif v > rule["max"]:
                mark = "❌" if rule.get("enforce") else "⚠"
                if rule.get("enforce"):
                    failed.append(f"{label} {fmt(k, v)} > {fmt(k, rule['max'])}")
            else:
                mark = "✅"
        lines.append(f"| {label} | {fmt(k, v)} | {lim} | {mark} |")
    flows = [k[5:] for k in metrics if k.startswith("flow_") and not k.endswith("_s")]
    if flows:
        lines += ["", "| Flow | Result | Time |", "|---|---|---|"]
        for f in flows:
            ok = metrics[f"flow_{f}"] == "pass"
            if not ok:
                failed.append(f"flow {f} failed")
            lines.append(f"| {f} | {'✅' if ok else '❌'} | {fmt('x_s', metrics.get(f'flow_{f}_s'))} |")
    if not flows:
        failed.append("no flow ran")
    lines.append("")
    return "\n".join(lines), failed


def main():
    profile, mpath = sys.argv[1], sys.argv[2]
    budgets = json.load(open(sys.argv[3] if len(sys.argv) > 3 else DEFAULT))
    budgets.pop("_doc", None)
    metrics = json.load(open(mpath)) if os.path.exists(mpath) else {}
    text, failed = check(profile, metrics, budgets)
    print(text)
    for f in failed:
        print(f"::error::{profile}: {f}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
