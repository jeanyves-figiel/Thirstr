# Runbook: break-glass access (EN-22, #181)

When the normal path is blocked during an incident, or the owner is unreachable and prod is down. Every use is logged and reviewed.

## When to use
- SEV1 (`incident-response.md` › Severity) and the normal path is too slow or blocked: review required, CI down, GitHub down.
- The person on call has lost their normal access (phone lost, 2FA device broken, account locked).
- Owner incapacitated (see Emergency contact below).

Never for convenience, never to skip review on a normal change.

## What exists
| Need | Normal path | Break-glass |
|---|---|---|
| Roll back / deploy | **Promote to production** workflow | `fly deploy -a thirstr-api-prod --image <previous digest>` with the org token from the vault (`fly.md` › Deploy) |
| GitHub down / CI red for reasons outside the change | wait | same as above; deploy the already-built image digest, never an unbuilt local image |
| Feature off | kill switch in admin console | `fly ssh console … rpc` flag update (`flags.md`) |
| Lost 2FA on GitHub / Fly / Apple / AWS | — | recovery codes in the vault (below) |
| DB by hand | admin console | `fly ssh console -a thirstr-db-prod`, read-only first; writes only with a written plan in the incident issue |

## The vault
Owner's password manager, emergency-access entry **"Thirstr break-glass"**. Holds, per account (GitHub, Fly.io, GoDaddy DNS, Apple Developer / App Store Connect, Google Play / Cloud, AWS (SES), Expo, ImprovMX, Pushover):
- login, 2FA recovery codes;
- Fly org token (deploy) and read-only metrics token;
- pgBackRest cipher pass for prod and staging (#158, `db-backups.md`).

Nothing from the vault goes in git, issues, chats or CI logs. Check the entry is complete every quarter (calendar reminder) and after any rotation.

**Emergency contact (owner incapacitated):** set the password manager's emergency access for one trusted person, with a waiting period (e.g. 48 h). That person's job is only to give access to a named engineer or to shut the service down safely (enable maintenance via kill switches, keep data, don't delete anything). Owner to name the person (not in this repo).

## Procedure
1. Open (or use) the `incident` issue. Write: "BREAK-GLASS <UTC time>: why, what I'm about to do."
2. Take only what you need; prefer read-only.
3. Do the change. Note every command (no secrets) in the issue.
4. Afterwards, within 1 working day:
   - rotate anything taken from the vault that left it (tokens copied to a laptop, recovery codes used: generate new ones);
   - open a PR that brings git back in line with prod (e.g. the digest you deployed);
   - second person (when there is one) reviews the issue log; otherwise the owner writes a short note why it was needed;
   - add the action items to the post-mortem.

## Test
Twice a year: from a clean laptop, use only the vault to deploy the current prod digest to **staging** (`fly deploy -a thirstr-api-staging --image …`) and sign in to every account. Record the date in `docs/incidents/`.
