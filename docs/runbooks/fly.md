# Runbook: Fly.io environments (D-03)

Created 2026-11-17 in Fly org `personal`, region `fra` (EU only, enforced by `scripts/check-fly-regions.sh`).

| App | Role | Notes |
|---|---|---|
| `thirstr-api-staging` / `thirstr-api-prod` | Phoenix API (`infra/fly/api-<env>.toml`) | public IPv6 + shared IPv4; deployed by digest only; serves the marketing site (W-01) on non-API paths, no web client |
| `thirstr-db-staging` / `thirstr-db-prod` | Postgres 16 + h3 + pgBackRest machine, encrypted volume (1 GB / 3 GB), `stop_config` SIGINT / 30 s | image `registry.fly.io/thirstr-db-<env>:pg16-h3`, built by `infra-images.yml`; reachable at `thirstr-db-<env>.internal:5432` (6PN only) |
| `thirstr-valkey-staging` / `thirstr-valkey-prod` | Valkey, RAM only (`--save "" --appendonly no`), password auth | no volume by design (ADR-0001) |
| Tigris buckets `thirstr-public-staging` / `thirstr-public-prod` | public photos (private bucket, presigned URLs) | created as Fly add-ons, primary region `fra` |

## Secrets (set as Fly app secrets, never in git)
- API: `SECRET_KEY_BASE`, `ID_PEPPER`, `DATABASE_URL`, `VALKEY_URL`, `S3_*`.
- DB: `POSTGRES_PASSWORD`, `PGBACKREST_REPO1_S3_BUCKET`, `PGBACKREST_REPO1_S3_KEY`, `PGBACKREST_REPO1_S3_KEY_SECRET`, `PGBACKREST_REPO1_CIPHER_PASS` (#141). Valkey: `VALKEY_PASSWORD`.
- Rotate: set new value on the dependent app and the API in one change, then restart both.

## GitHub (owner setup)
- Environments `staging` and `production`; `production` requires reviewer **jeanyves-figiel** (D-14).
- Secret `FLY_TOKEN` (org-scoped deploy token) in both environments. Workflows map it to `FLY_API_TOKEN`.

## Domain (#34)
Registrar + DNS: GoDaddy (owner account). Records (TTL 1 h):

| Name | Type | Value |
|---|---|---|
| `staging` | A / AAAA | `66.241.125.177` / `2a09:8280:1::20c:7564:0` (`thirstr-api-staging`) |
| `_acme-challenge.staging` | CNAME | `staging.thirstr.fun.pk8d8p6.flydns.net` |
| `api` | A / AAAA | `66.241.125.131` / `2a09:8280:1::20c:7568:0` (`thirstr-api-prod`) |
| `_acme-challenge.api` | CNAME | `api.thirstr.fun.29xzx8w.flydns.net` |
| `@` (apex) | A / AAAA | `66.241.125.131` / `2a09:8280:1::20c:7568:0` (`thirstr-api-prod`, marketing site W-01, #40; replaced GoDaddy parking) |
| `_acme-challenge` | CNAME | Fly DNS-01 target from `addCertificate(thirstr.fun)` |
| `www` | CNAME | `thirstr.fun` (same app; `Plugs.Site` 301 → apex) |
| `_acme-challenge.www` | CNAME | Fly DNS-01 target from `addCertificate(www.thirstr.fun)` |
| `@` | MX | `mx1.improvmx.com` (10), `mx2.improvmx.com` (20): ImprovMX forwards `hello@thirstr.fun` to the owner (#62) |
| `@` | TXT | `v=spf1 include:spf.improvmx.com ~all` (add the transactional SMTP provider here, #26) |
| `_dmarc` | TXT | GoDaddy default `p=quarantine` (unchanged) |

Fly certificates (Let's Encrypt, auto-renew) were added with GraphQL `addCertificate(appId, hostname)`; check with `checkCertificate` or `flyctl certs show <host> -a <app>`. IPs come from `app { sharedIpAddress ipAddresses }`. New host: add cert → add the 3 records → wait for `clientStatus: Ready` → change `PHX_HOST`/`APP_URL`/`WEBAUTHN_*` in the toml.

## Deploy
- Staging: automatic on push to `main` (`deploy-staging.yml`): build → SBOM → cosign sign → `flyctl deploy --image <digest>` → migrate (+ idempotent synthetic seed on staging) → `scripts/smoke.sh`.
- Prod: Actions → **Promote to production** → reason (+ optional digest). Checks the digest has been live on staging ≥ 30 min and staging smoke is green, waits for owner approval, deploys the same digest, smokes, rolls back to the previous image on failure.

## Checks
```sh
FLY_API_TOKEN=… scripts/fly-live-image.sh thirstr-api-staging   # digest + rollout time
scripts/smoke.sh https://staging.thirstr.fun
```

## Known gaps (tracked in GitHub)
- Single Postgres machine per env: no standby yet (EN-01 #160). Backups + PITR: pgBackRest → `thirstr-backups-<env>` (#141, [`db-backups.md`](db-backups.md)).
- `ID_PEPPER` is a Fly secret; spec wants it in an EU KMS.
- No SMTP provider yet: email magic links are not delivered on staging/prod. Setup: [`email.md`](email.md) (#26). Classifier apps: [`classifier.md`](classifier.md).
- Tigris EU-only placement to confirm.
