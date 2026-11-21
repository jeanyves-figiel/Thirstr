#!/usr/bin/env python3
"""EN-12 (#171): block destructive DB migrations (expand-and-contract only).

A release must keep the previous image working on the new schema: staging and prod
run old and new machines side by side during a deploy, and a rollback reuses the old
image. So a migration may add (tables, nullable columns, indexes concurrently) but not
drop, rename or change types. Removing something is a separate "contract" release,
once no running image reads it: mark that file with a line

    # migration-lint: contract <issue or reason>

Files up to BASELINE are grandfathered (already applied everywhere).
"""
import pathlib
import re
import sys

BASELINE = 20261121174202
ROOT = pathlib.Path(__file__).resolve().parent.parent
DIR = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "server/priv/repo/migrations"
ALLOW = re.compile(r"#\s*migration-lint:\s*contract\s+\S")
RULES = [
    (r"\bdrop(_if_exists)?\s*\(?\s*(table|index|constraint)\b", "drops a table/index/constraint", 0),
    (r"^\s*remove(_if_exists)?\s+:", "removes a column", 0),
    (r"^\s*rename\s", "renames a table/column", 0),
    (r"^\s*modify\s+:", "changes a column (type/null/default)", 0),
    (r"\bDROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT|TYPE|FUNCTION|VIEW)\b", "SQL DROP", re.I),
    (r"\bRENAME\s+(TO|COLUMN)\b", "SQL RENAME", re.I),
    (r"\bALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE\b", "SQL column type change", re.I),
    (r"\bSET\s+NOT\s+NULL\b", "SQL SET NOT NULL (breaks old writers)", re.I),
    (r"\bTRUNCATE\b|\bDELETE\s+FROM\b", "deletes rows", re.I),
]


def down_blocks(text):
    """Lines inside `def down` are rollbacks of an expand: allowed."""
    out, skip, depth = [], False, 0
    for line in text.splitlines():
        s = line.strip()
        if re.match(r"def down\b", s):
            skip, depth = True, 0
        if skip:
            depth += len(re.findall(r"\bdo\b", s)) - len(re.findall(r"^end\b", s))
            if depth <= 0 and s.startswith("end"):
                skip = False
            out.append("")
        else:
            out.append(line)
    return out


def main():
    bad = []
    for f in sorted(DIR.glob("*.exs")):
        m = re.match(r"(\d{14})_", f.name)
        if not m or int(m.group(1)) <= BASELINE:
            continue
        text = f.read_text()
        if ALLOW.search(text):
            continue
        for n, line in enumerate(down_blocks(text), 1):
            code = line.split("#", 1)[0]
            for pat, why, flags in RULES:
                if re.search(pat, code, flags):
                    bad.append(f"{f.name}:{n}: {why}: {line.strip()}")
    if bad:
        print("Destructive migration (EN-12, docs/runbooks/migrations.md):")
        print("\n".join(bad))
        print("Split into expand now + contract in a later release, or mark the file\n"
              "'# migration-lint: contract <reason>' once no running image uses it.")
        return 1
    print("migrations: expand-only OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
