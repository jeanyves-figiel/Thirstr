# Runbook: move Thirstr to Fly org `thirstr` (EN-09, #168)

Why: today every Thirstr app sits in the owner's `personal` org next to other projects. Fly's registry and private network are per org, so any deploy token for any app in `personal` can push images to Thirstr's registry, and the CI token reaches non-Thirstr apps. A dedicated org gives Thirstr its own network, registry, tokens, billing and member list.

Cost: €0 extra (same machines, volumes and traffic; billed to the new org). Fly asks for a payment method on the new org.

## Facts that shape the plan (Fly docs, "Move an app to another org", read 2026-11-21)
- `fly apps move <app> --org thirstr` (or dashboard › App › Settings › Move app). Machines, volumes with data, secrets, env, certificates and domains move with the app. **Up to a few minutes of downtime per app.**
- The private network (`*.internal`, `*.flycast`) is per org. While some apps have moved and others haven't, they can't reach each other. So each environment moves **all its apps back to back**, API first stopped, API last started.
- `thirstr-db-<env>` is our own Postgres image on Machines, not a Fly Postgres app, so `apps move` applies (the Fly Postgres restriction doesn't).
- `*.flycast` addresses are allocated per org: after the move the classifier needs a new private IPv6 (`fly ips allocate-v6 --private -a thirstr-classifier-<env>`), otherwise `CLASSIFIER_URL` stops resolving.
- Tigris buckets (`thirstr-public-<env>`, `thirstr-backups-<env>`) are org add-ons, not app resources. They **stay in `personal`** for now: the keys and the public endpoint keep working from any org, so photos and backups are untouched. Moving them later means new buckets + copy + new keys (own change, own window).
- Public IPs, DNS and Let's Encrypt certificates are unchanged; no GoDaddy change.

## Owner steps before (console, needs his login)
1. Fly dashboard › account › **Security**: 2FA on (TOTP or passkey), recovery codes saved (`access.md` › Break-glass).
2. Dashboard › **Create organization** `thirstr`, add a payment method. Owner is the only member.
3. Tell the thread "org ready".

Who runs the move: the owner, on his laptop, with `scripts/ops/fly-org-move.sh <staging|prod>` (flyctl logged in as him). Claude's environment token is scoped to `personal` only and can't see `thirstr`, which is how it should stay. The script does the steps below in order and ends with the smoke test.

Timing: moving restarts the staging API machines, which resets the "live on staging ≥ 30 min" clock of the prod promote. So staging moves right **after** a promote has finished, not shortly before one.

## Staging (any open merge window, ~15 min, no users affected)
Order: stop API → move db, valkey, classifier, bot → move API → start.
1. `fly scale count 0 -a thirstr-api-staging` (or stop machines via Machines API) so nothing writes during the move.
2. `fly apps move thirstr-db-staging --org thirstr -y`, then `thirstr-valkey-staging`, `thirstr-classifier-staging`, `thirstr-bot-staging`.
3. `fly ips allocate-v6 --private -a thirstr-classifier-staging`.
4. `fly apps move thirstr-api-staging --org thirstr -y`; start it again (scale 1).
5. Check: `scripts/smoke.sh https://staging.thirstr.fun` (health, DB-backed endpoints); upload a photo (Tigris + classifier); Testbot replies in chat (Valkey, sockets); a pgBackRest `archive-push` succeeds in the DB logs.
6. Mint the staging CI token in the new org: `scripts/ops/fly-ci-tokens.sh staging`, then dispatch **Deploy staging** once.

## Production (between two waves, never during a promote, owner OK at the time)
Planned with the release orchestrator thread: freeze merges, no promote running, staging moved and green for ≥ 1 h.
1. Announce: maintenance banner not needed (beta, ≤ 10 min), but pick the quietest hour.
2. Same order as staging with `-prod` names (no bot): stop API → db → valkey → classifier → flycast IP → API → start.
3. Checks: `scripts/smoke.sh https://api.thirstr.fun`, `https://thirstr.fun` site, sign in on the owner's phone, send a chat message, open Explore.
4. `scripts/ops/fly-ci-tokens.sh production` (deletes the repo-level `FLY_TOKEN` when both environments have their own).
5. Replace the Claude environment token with an org token for `thirstr` (`access.md` §2) and revoke the old org-wide token.

## Rollback
`fly apps move <app> --org personal -y` for each app in the same order. Data stays on the volumes, so a rollback costs only the same few minutes. If the DB machine does not come up after the move: it is the same volume; follow `db-backups.md` › Real incident only if the volume itself is lost.

## After
- `docs/runbooks/fly.md`: org name.
- Close the org part of #168; next quarterly review (`access.md` §5) lists the new org's members and tokens.
