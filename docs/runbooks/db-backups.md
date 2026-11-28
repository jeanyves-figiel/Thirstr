# Runbook: Postgres backups & point-in-time restore (SR-01, #141)

## What runs
| | |
|---|---|
| Tool | pgBackRest (from apt.postgresql.org) inside the DB image `registry.fly.io/thirstr-db-<env>:pg16-h3` (`infra/postgres/`) |
| Repo | Tigris bucket `thirstr-backups-<env>` (Fly add-on, primary region `fra`, private), path `/pgbackrest`, stanza `thirstr` |
| Encryption | pgBackRest `aes-256-cbc` with `PGBACKREST_REPO1_CIPHER_PASS` (client-side, before upload). Tigris only ever sees ciphertext. |
| WAL | `archive_mode=on`, `archive_timeout=300` → every change is off the machine within ≤ 5 min (RPO ≤ 5 min; ops.md target 15 min) |
| Base backups | `backup-loop.sh` checks every 10 min: newest backup > 24 h old → take one; full if newest full > 7 d, else differential |
| Retention | 5 fulls (≈ 5 weeks of point-in-time restore; ops.md asks ≥ 30 d). Old WAL is expired with them. |
| Verify | weekly `pgbackrest verify` (checksum of every backup file, WAL continuity) by `backup-loop.sh` (DB-07, #333). `backup` / `verify` results → table `db_maint_status` → alert `db-backup-old` |
| Also | Fly volume snapshots (daily, 5 d, same host provider) stay on as a second layer |

Off when `PGBACKREST_REPO1_S3_BUCKET` is unset (DEV compose, CI) or the machine has env `BACKUPS=off` (restore drills).

## Secrets (Fly app secrets on `thirstr-db-<env>`, never in git)
`PGBACKREST_REPO1_S3_BUCKET`, `PGBACKREST_REPO1_S3_KEY`, `PGBACKREST_REPO1_S3_KEY_SECRET`, `PGBACKREST_REPO1_CIPHER_PASS`.

**The cipher pass is the only way to read the backups.** Keep a copy outside Fly (owner password manager), see #158. Without it a backup is useless.

## Check
```sh
# status lines from the loop
fly logs -a thirstr-db-<env> | grep backup-loop
# backups, WAL range, sizes
fly ssh console -a thirstr-db-<env> -C "gosu postgres pgbackrest info"
# archive works end to end
fly ssh console -a thirstr-db-<env> -C "gosu postgres pgbackrest check"
```
(Without flyctl: Machines API `POST /v1/apps/<app>/machines/<id>/exec` with the same commands.)

## Restore to a point in time (drill or real)
Never restore over the running prod volume. Restore into a new machine + volume, check, then switch `DATABASE_URL`.

1. Create a volume (same size or larger) in `fra` on `thirstr-db-<env>`.
2. Create a machine from the same image digest with that volume at `/var/lib/postgresql/data`, the app secrets, `PGDATA=/var/lib/postgresql/data/pgdata`, and init `["sleep","inf"]` (so Postgres doesn't start yet).
3. Exec on it:
   ```sh
   export PGBACKREST_STANZA=thirstr PGBACKREST_PG1_PATH=$PGDATA PGBACKREST_REPO1_TYPE=s3 \
     PGBACKREST_REPO1_PATH=/pgbackrest PGBACKREST_REPO1_S3_ENDPOINT=fly.storage.tigris.dev \
     PGBACKREST_REPO1_S3_REGION=auto PGBACKREST_REPO1_CIPHER_TYPE=aes-256-cbc
   mkdir -p $PGDATA && chown postgres $PGDATA && chmod 700 $PGDATA
   gosu postgres pgbackrest restore --type=time --target="2026-11-21 09:00:00+00" --target-action=promote
   ```
   (Latest point: omit `--type/--target`.)
4. Start Postgres on it.
   - **Drill:** start it by exec, local only, never archiving: `gosu postgres bash -c "setsid postgres -D \$PGDATA -c listen_addresses=localhost -c archive_mode=off > /tmp/pg.log 2>&1 < /dev/null &"`. `thirstr-db-<env>.internal` resolves to every machine of the app, so a drill copy listening on 6PN could receive real API traffic. The drill machine also has env `BACKUPS=off` (app secrets reach every machine).
   - **Real incident:** update the machine without the sleep init (normal entrypoint, backups on).
5. Check: `SELECT count(*) FROM accounts; SELECT max(created_at) FROM mls_messages;`
6. Destroy the drill machine and volume (Machines API `DELETE …/machines/<id>?force=true`, then the volume).
7. Real incident: stop `thirstr-api-<env>`, point `DATABASE_URL` at the new machine (`<id>.vm.thirstr-db-<env>.internal`), start the API, then make the new machine the only DB machine.

## Automated drill (EN-17, #176)
`scripts/ops/restore-drill.sh <env> <region> [--migrate-image <api image>]` does steps 1–6 with the Machines API and prints a JSON result:
- temporary volume (live size **+ 2 GB**: WAL replay needs room) + machine on `thirstr-db-<env>` in another EU region, `BACKUPS=off`, init `sleep`, metadata `purpose=dr-drill`;
- `pgbackrest restore` (latest), then Postgres on **port 5499** with `archive_mode=off` and the pgBackRest env (the `restore_command` needs it), until recovery has promoted;
- RTO = start → usable DB; RPO = how old the last archived WAL was on the live DB at drill time (worst-case loss); `accounts` count and newest message age as sanity checks;
- amcheck on the copy: `bt_index_check(heapallindexed)` on every B-tree index + `verify_heapam` on every table; any failure fails the drill (`amcheck` field, DB-08 #333);
- `--migrate-image`: a second temporary machine runs `/app/bin/migrate` of that image against the copy (one-time superuser `drill_migrator`, random password, only `fdaa::/16`);
- always destroys machines (all with this run id) and the volume, even on failure.

Workflow **DR drill** (`dr-drill.yml`): monthly (1st, 04:17 UTC; DB-08) on prod into `ams`, or by hand (env, region). It dry-runs the image live on staging, writes the run summary and comments on the issue labelled `dr-drill` ("DR drill log"). Cost: two shared-cpu machines + a small volume for ~5–10 min.

## Hardening (DB-09, #334)
`scripts/ops/db-hardening.sh <env> [--image <ref>] [--dry-run]`, workflow **DB hardening** (`db-hardening.yml`, manual, dry run by default). Run `infra-images.yml` first (it also runs on every main push touching `infra/postgres/`).
1. Moves the live DB machine to the newest image (`:pg16-h3`): tuned config sized from the machine's RAM, `pg_stat_statements`, timeouts (DB-01/03/04).
2. Checksums off → boots with init `sleep` (Postgres stopped cleanly), checks `pg_controldata` says `shut down`, runs `pg_checksums --enable`, boots normally. Already on → only step 1 and 3.
3. Mount auto-extend: 80 % used → +2 GB, cap 50 GB.
DB down ≈ 1–2 min (3 GB). **Prod only with the owner's OK**; staging first. Afterwards `show data_checksums` = `on`; `thirstr_db_health_checksums_on` = 1.

## Gotchas
- A target time needs a commit **after** it in archived WAL, else recovery stops with "recovery ended before configured recovery target was reached". Force it with `SELECT pg_switch_wal()` (its own statement: `psql -c "a; b"` runs as one transaction) or wait ≤ `archive_timeout`.
- `pgbackrest` options come from env vars on the DB machine; an exec shell must export them (see step 3), **also for the shell that starts Postgres** (recovery calls `pgbackrest archive-get`; without them: "archive-get command requires option: stanza").
- A restore volume the same size as the live one can fill up during WAL replay (pg_wal grows to `max_wal_size`): use live size + 2 GB and `-c max_wal_size=256MB`.
- Machines API: create with `skip_launch: true`, then `start` (create+launch with a fresh volume answered 400); `wait` timeout max 60 s.

## Drill log
| Date | Env | Target | Result | Time to usable DB |
|---|---|---|---|---|
| 2026-11-21 | prod | — (rollout) | ✔ backups on at 09:30 UTC (`pg16-h3-8994cda`), first full 09:31 (40 MB → 6.7 MB), API health checks passing; DB restart ~10 s | — |
| 2026-11-21 | staging | 09:07:47 UTC (between two marker rows) | ✔ row before target present, row after absent, `venues` count matches (28 686); full backup 40 MB → 6.8 MB in repo | ~1 min per restore (2.6 min incl. one retry, see Gotchas) |
| 2026-11-21 | staging → `ams` | latest (automated `restore-drill.sh`, #176) | ✔ second region from backups only; 8 accounts; migration dry run of the staging image ok (11 s); everything destroyed after | RTO 177 s (restore 21 s + WAL replay); RPO at drill time 161 s |
