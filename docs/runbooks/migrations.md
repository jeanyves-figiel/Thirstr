# Runbook: database migrations (EN-12, #171)

## Rule: expand and contract
During a deploy old and new machines run side by side, and a rollback ("Promote to production" with the previous digest) runs the old image on the **new** schema. So every release must keep the previous image working.

| Release N (expand) | Release N+1 or later (contract) |
|---|---|
| add table / nullable column / column with default | drop the old column or table |
| create index `concurrently: true` (with `@disable_ddl_transaction true`) | drop the old index |
| write to old **and** new column, backfill in an Oban job | read only the new column, then drop the old |
| new NOT NULL: add nullable + backfill + `CHECK ... NOT VALID`, validate | `SET NOT NULL` |
| rename = add new + dual write + backfill | drop old name |

## CI check
`scripts/check-migrations.py` runs first in the `server` CI job and fails on new migrations that drop, remove, rename, modify a column, change a type, `SET NOT NULL`, `TRUNCATE` or `DELETE FROM`. `def down` blocks are ignored. Files up to `20261121174202` are grandfathered.

A contract step that is safe (no running image reads the thing any more) is allowed with a line in the file:

```elixir
# migration-lint: contract #123 avatars.legacy_url unused since build 140
```

Check before marking: `git grep` the server for the column, and the oldest build still allowed (`min_build`, `docs/runbooks/flags.md`) does not send or expect it.

## Run locally
```sh
python3 scripts/check-migrations.py
```
