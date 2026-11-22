#!/usr/bin/env python3
"""Pick the most low-end physical Android phone on Firebase Test Lab (EN-16, #175).
stdin: `gcloud firebase test android models list --format=json`. Prints `model=…,version=…`.
Low-end proxy: fewest screen pixels, then oldest newest-supported Android, among PHYSICAL phones
that support API >= MIN_SDK (24). Override with repo variable TESTLAB_DEVICE."""
import json, os, sys

MIN_SDK = int(os.environ.get("MIN_SDK", "24"))


def pick(models):
    best = None
    for m in models:
        if m.get("form") != "PHYSICAL" or m.get("formFactor", "PHONE") != "PHONE":
            continue
        vers = sorted(int(v) for v in m.get("supportedVersionIds", []) if str(v).isdigit() and int(v) >= MIN_SDK)
        if not vers:
            continue
        px = int(m.get("screenX", 0)) * int(m.get("screenY", 0))
        key = (px or 10**9, vers[-1])
        if best is None or key < best[0]:
            best = (key, f"model={m['id']},version={vers[-1]}")
    return best[1] if best else None


if __name__ == "__main__":
    d = pick(json.load(sys.stdin))
    if not d:
        sys.exit("no physical phone found")
    print(d)
