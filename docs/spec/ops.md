# CI/CD, environments & operations

## Repos & layout (monorepo)
```
/apps/mobile        React Native (Expo bare) app
/apps/share-ext     iOS share extension / Android share target glue
/core               Rust crate (MLS, H3, crypto, storage) + UniFFI bindings
/server             Elixir/Phoenix app (contexts: accounts, auth, onboarding, location, profiles, jobs; realtime, mls_ds, admin added per slice; split to umbrella if needed)
/infra              fly.toml per app/env, Fly config scripts, runbooks
/design             tokens.json, icons, copy/strings
/docs               concept, spec, adr
```

## Environments
| Env | URL | Data | Deploy |
|---|---|---|---|
| DEV | `https://localhost:7443` | seeded fake data | `docker compose up` (caddy, phoenix, postgres+h3, valkey, seaweedfs-s3, mailpit, mock-push, tile server) |
| Staging | `https://staging.thirstr.fun` (Fly app `thirstr-api-staging`) | synthetic (re-seeded idempotently on deploy) + testers; serves the marketing site (W-01, noindex) on `/`, no web client | auto on squash-merge to `main` |
| Prod | `https://api.thirstr.fun` (Fly app `thirstr-api-prod`) | real | manual workflow **"Promote to production"** (same image digest as staging), owner OK per change; owner is the only required reviewer |

## Trunk model
1. Branch off `main` → PR (template: summary, linked spec IDs, ChangeLog entry, screenshots ≤ 800 px).
2. CI must pass: format, lint, unit, integration, AC tests touched, security scans, ChangeLog present.
3. Squash-merge → build image `server:<sha>`, mobile build to TestFlight/Internal track → deploy staging.
4. Validate on staging (smoke + AC checks).
5. Run "Promote to production" (workflow_dispatch, input: image digest, requires environment approval by owner).

## GitHub Actions workflows
| Workflow | Trigger | Jobs |
|---|---|---|
| `ci.yml` | PR | server (mix format/credo/sobelow/deps.audit/test), core (cargo fmt/clippy/test/audit), mobile (tsc/eslint/jest/web build), image build, infra (EU-region check, compose config), changelog-check, secret scan (gitleaks) |
| `deploy-staging.yml` | push main | build+sign images (cosign), SBOM, push to EU registry, `fly deploy --image <digest>` to staging apps, smoke tests |
| `promote-prod.yml` | manual | verify digest deployed on staging ≥ 30 min (Machines API, `scripts/fly-live-image.sh`) & smoke green → environment `production` approval → `fly deploy --image <digest>` to prod apps → smoke → auto-rollback (redeploy previous release) on failure |
| `ios-testflight.yml` | push main touching `apps/mobile/**`, manual | GitHub macOS runner: `expo prebuild` → `xcodebuild archive` (automatic signing via App Store Connect API key) → export + upload to TestFlight; app → staging API; skips with a warning until owner secrets exist (#31, runbook `docs/runbooks/ios.md`) |
| `mobile-release.yml` (later) | tag `app-v*` | prod-pointing store builds; store submission manual |
| `nightly.yml` | cron | dependency audits (mix, cargo, npm), staging smoke; abuse harnesses (trilateration, scraping) added as features land |
| `infra-images.yml` | manual / infra/postgres change | build + push Postgres 16 + h3 image for `thirstr-db-<env>` |
| `places-import.yml` | manual (target staging \| production) | F-12 R-12.9: over `fly ssh` + `bin/thirstr rpc`, cancels Places import jobs killed by a restart, queues `Thirstr.Jobs.PlaceImport` (same as admin › Places › Import now; weekly cron Mon 03:30 UTC), polls `place_imports` until done, writes added / updated / removed + venue count to the run summary. Don't merge to main while a staging import runs: the deploy restarts the machine (Oban Lifeline re-queues stuck jobs after 45 min) |
| `android-compile.yml` | PR touching `apps/mobile/modules/*/android/**`, a module config or the lockfile; manual | #107: `expo prebuild --platform android`, then `compileReleaseKotlin` for every local `thirstr-*` module. Keeps the Kotlin side building until a Play Store pipeline exists; no APK, no signing |

## Infra (Fly.io, EU regions only; D-03)
- Apps per env: `thirstr-api-<env>` (Phoenix, ≥ 2 machines, fra + ams, clustered via `dns_cluster` over 6PN private network), `thirstr-valkey-<env>` (Valkey machine, no volume, RAM only), `thirstr-db-<env>` (Postgres 16 + h3-pg: Fly Managed Postgres if h3 extension supported, else self-run Postgres machine with volume + replica), `thirstr-tiles-<env>` (Protomaps tiles).
- Object storage: Tigris (EU region pinned) or Hetzner Object Storage; public photos via CDN, E2EE media as ciphertext.
- Image registry: `registry.fly.io`, images signed with cosign; deploy by digest only.
- Secrets: `fly secrets` (per app); pepper/KMS keys stay outside Fly (EU KMS).
- Region policy: primary_region `fra`; no machine outside EU regions (CI check on fly.toml).
- Domain: `thirstr.fun` (registrar + DNS: GoDaddy; D-01). `staging.thirstr.fun` → `thirstr-api-staging`, `api.thirstr.fun` → `thirstr-api-prod`: A (Fly shared IPv4) + AAAA (app IPv6) + `_acme-challenge.<host>` CNAME to Fly for Let's Encrypt DNS-01. `*.fly.dev` hosts stay reachable but are not canonical. Apex `thirstr.fun` + `www` → `thirstr-api-prod`, which serves the marketing site (W-01, `website.md`; `www` 301 → apex, `SITE_HOST`); MX → ImprovMX forwarding for `hello@` (#62); DKIM waits for the SMTP provider (#26). Host is config only (`PHX_HOST`, `APP_URL`, `WEBAUTHN_ORIGIN`, `WEBAUTHN_RP_ID` in `infra/fly/api-<env>.toml`); passkeys are bound to the RP ID, so testers re-enrolled once at the switch (#34). Runbook: `docs/runbooks/fly.md` › Domain.
- Access: Fly org `personal` for beta (move to org `thirstr` before public launch); CI uses org-scoped deploy token `FLY_TOKEN` in GitHub environment secrets; humans via SSO + 2FA.
- Exit path: same Docker images run on Hetzner k3s; review before public launch (#23).
- Observability: Prometheus metrics on internal port 9091 → Fly managed Prometheus/Grafana (SR-07 #147, runbook [`monitoring.md`](../runbooks/monitoring.md)); SLOs: API availability 99.9 %, grid p95 < 300 ms, message p95 < 500 ms (EN-04 #163).
- Backups: Postgres PITR 7 d + daily encrypted snapshots 30 d; restore drill monthly. pgBackRest WAL archive (≤ 5 min) + daily diff / weekly full to encrypted Tigris bucket `thirstr-backups-<env>` (SR-01 #141, runbook [`db-backups.md`](../runbooks/db-backups.md)); single DB machine, no standby yet (EN-01 #160).
- Scalability & reliability review (2026-11-21): findings and prioritized plan in [`scalability-and-reliability.md`](scalability-and-reliability.md) (SR-01 … SR-16, #141–#156).
- DR: RPO 15 min, RTO 4 h; secondary EU region cold standby.
- On-call: alerting to owner/devs; runbooks in `/docs/runbooks` (to write per service).
