#!/usr/bin/env python3
"""Summarise one chaos experiment probe log (EN-15 #174). Usage: report.py <experiment> <log>.

Log lines: "<epoch> MARK <name>" or "<epoch> <endpoint> <http_code> <seconds>".
Prints one Markdown table row block with PASS/FAIL per docs/runbooks/game-day.md.
"""
import sys

# experiment -> (mark the recovery clock starts from, max recovery s, max error rate)
RULES = {
    "api-kill": ("fault", 60, None),
    "api-stop": ("stopped", 30, None),
    "valkey-down": ("fault", None, 0.01),
    "db-restart": ("restore", 60, None),
    "disk-fill": ("fault", None, 0.01),
}


def main(exp: str, path: str) -> int:
    marks, rows = {}, []
    for line in open(path, encoding="utf-8"):
        p = line.split()
        if len(p) == 3 and p[1] == "MARK":
            marks[p[2]] = float(p[0])
        elif len(p) == 4:
            rows.append((float(p[0]), p[1], p[2], float(p[3])))
    rows.sort()
    if not rows:
        print(f"| {exp} | no probe data | | | | | FAIL |")
        return 0
    ok = lambda r: r[2] == "200"  # noqa: E731
    errors = [r for r in rows if not ok(r)]
    health = [r for r in rows if r[1] == "/v1/health"]

    # Longest health outage: first failure → next success.
    longest, start = 0.0, None
    for r in health:
        if not ok(r) and start is None:
            start = r[0]
        elif ok(r) and start is not None:
            longest = max(longest, r[0] - start)
            start = None
    if start is not None:
        longest = max(longest, health[-1][0] - start)

    since_name, max_rec, max_err = RULES.get(exp, ("fault", None, None))
    since = marks.get(since_name, marks.get("fault", rows[0][0]))
    failed_after = [r for r in health if r[0] >= since and not ok(r)]
    if failed_after:
        nxt = [r for r in health if r[0] > failed_after[-1][0] and ok(r)]
        recovery = (nxt[0][0] - since) if nxt else float("inf")
    else:
        recovery = 0.0

    lat = sorted(r[3] for r in rows if ok(r))
    p95 = lat[int(0.95 * (len(lat) - 1))] * 1000 if lat else 0
    rate = len(errors) / len(rows)
    tail = rows[-9:]  # last 3 probe rounds
    reasons = []
    if max_rec is not None and recovery > max_rec:
        reasons.append(f"recovery {recovery:.0f}s > {max_rec}s")
    if max_err is not None and rate > max_err:
        reasons.append(f"errors {rate:.1%} > {max_err:.0%}")
    if not all(ok(r) for r in tail):
        reasons.append("still failing at the end")
    verdict = "PASS" if not reasons else "FAIL: " + "; ".join(reasons)
    rec = "∞" if recovery == float("inf") else f"{recovery:.0f}s"
    codes = sorted({r[2] for r in errors})
    print("| Experiment | Requests | Errors | Longest outage | Recovery | p95 | Result |")
    print("|---|---|---|---|---|---|---|")
    print(f"| {exp} | {len(rows)} | {len(errors)} ({rate:.1%}{', codes ' + ','.join(codes) if codes else ''}) "
          f"| {longest:.0f}s | {rec} (from {since_name}) | {p95:.0f} ms | {verdict} |")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
