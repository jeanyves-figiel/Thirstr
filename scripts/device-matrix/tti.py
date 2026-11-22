#!/usr/bin/env python3
"""Time to interactive (ms) from a Maestro debug-output dir: launchApp + the wait for `start`.
Prints `null` when the command log can't be read (the budget then reports n/a)."""
import glob, json, os, sys

def main(d):
    files = sorted(glob.glob(os.path.join(d, "**", "commands-*.json"), recursive=True))
    if not files:
        return "null"
    total, seen = 0, 0
    for c in json.load(open(files[0])):
        cmd = c.get("command", {})
        meta = c.get("metadata", {})
        if "launchAppCommand" in cmd or "extendedWaitUntilCommand" in cmd or "assertConditionCommand" in cmd:
            total += int(meta.get("duration") or 0)
            seen += 1
        if seen >= 2:
            break
    return str(total) if seen >= 2 else "null"

if __name__ == "__main__":
    print(main(sys.argv[1]))
