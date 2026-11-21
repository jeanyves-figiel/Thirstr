# Enterprise readiness: plan, roadmap & costs (2026-11-21)

Status: proposal · 2026-11-21 · Builds on [`scalability-and-reliability.md`](scalability-and-reliability.md) (SR-01…SR-16). Each item is a GitHub issue (EN-xx). Prod infra changes still need the owner's OK per change (ops.md).

Goal: run Thirstr like a mature consumer platform: no lost messages, no lost data, privacy by default, fast on a cheap phone on 3G, light on battery and data, safe releases, provable security and compliance, and costs that grow slower than users.

## 1. Targets
| | Closed beta (now) | Open beta · 10k MAU | Launch · 100k MAU | Scale · 1M MAU |
|---|---|---|---|---|
| API availability (monthly) | best effort | 99.9 % | 99.95 % | 99.95 % |
| Message send → delivered to online device, p95 | < 1 s | < 500 ms | < 500 ms | < 500 ms |
| Grid / map first page, p95 (server) | < 500 ms | < 300 ms | < 300 ms | < 300 ms |
| Data loss (RPO) | ≤ 5 min (SR-01) | ≤ 5 min | ≤ 1 min (sync replica) | ≈ 0 (sync replica) |
| Recovery (RTO) | 4 h | 1 h | 15 min (auto failover) | 5 min |
| App cold start (iPhone 12 / Pixel 6a) | — | < 2 s | < 1.5 s | < 1.5 s |
| Mobile data per hour of active use (no photos opened) | — | < 15 MB | < 10 MB | < 10 MB |
| Battery, 1 h foreground map + chat | — | < 8 % | < 6 % | < 6 % |
| Crash-free sessions | — | 99.5 % | 99.8 % | 99.9 % |

## 2. Workstreams

### A. Data & high availability
- Backups + PITR (SR-01 #141: live on staging 2026-11-21, restore drill passed; prod after owner OK 2026-11-21), key escrow (#158). Runbook: `docs/runbooks/db-backups.md`.
- **EN-01** (#160) HA Postgres: primary + synchronous standby (`fra`) + async replica (`ams`), automatic failover (Fly Managed Postgres if it supports h3, else Patroni/repmgr on Fly machines); app connects via a failover-aware address. Read replica serves Explore/places reads.
- **EN-02** (#161) Multi-region inside the EU: API in `fra` + `ams` (later `cdg`/`waw`), Valkey replica per region, Tigris with EU placement (#27). Region failure = degraded, not down.
- **EN-03** (#162) Scale-out plan for 1M: partition `mls_messages` (by day / device hash), `location_cells` hot set in memory (ETS/Valkey), PgBouncer when nodes × pool > 300 connections, evaluate dedicated EU hardware (Hetzner) for the DB at 1M (exit path, #23). Design: [`scale-out-1m.md`](scale-out-1m.md) (hash partitions by device for the queue, range partitions for TTL tables, ETS then Valkey hot set, PgBouncer at 80 % of `max_connections`, DB decision points at 100k and 1M MAU).

### B. Observability, SLOs, on-call
- Metrics + alerts (SR-07).
- **EN-04** (#163) SLOs with error budgets for the targets above; burn-rate alerts; public status page (`status.thirstr.fun`); weekly SLO review. ✔ Spec `slos.md`, status page on GitHub Pages (`status.yml`), weekly report (`slo-report.yml`), alert rules in `monitoring.md`.
- **EN-05** (#164) Error + crash reporting with PII scrubbing, EU-hosted (Sentry EU or self-hosted GlitchTip): server, iOS, Android; release health gates (crash-free %). ✔ Built in-house instead (no vendor, no cost): anonymous app reports + session pings, server grouping and scrubbing, crash-free alert (`docs/runbooks/monitoring.md` › App crashes); server errors via existing metrics + Fly logs.
- **EN-06** (#165) On-call: rotation (owner + ≥ 1 engineer once hired), paging (phone push + SMS), runbook per alert, escalation path. ✔ Solo on-call for beta: GitHub Actions every 5 min → Pushover (SEV1 emergency until acknowledged, escalation key ready), runbook link per alert (`docs/runbooks/on-call.md`, `alerts.md`); no SMS (Pushover covers it, €0/month).

### C. Incident response
- **EN-07** (#166) Incident process: severity levels, incident commander, comms templates (in-app banner, status page, email), GDPR 72 h breach notification flow (Art. 33/34), blameless post-mortems with tracked actions, yearly tabletop exercise. ✔ `docs/runbooks/incident-response.md`, register `docs/incidents/` (legal wording to confirm with counsel, #9).

### D. Security
- **EN-08** (#167) Security program: annual external pen test (API + iOS + Android + MLS implementation review), bug bounty (private → public), SAST/DAST in CI (sobelow, semgrep, ZAP on staging), dependency patch SLAs (critical 48 h), SBOM already signed (cosign).
  - Done (#244): every GitHub Action pinned to a full commit SHA with a version comment (Dependabot proposes bumps monthly), workflow inputs and step outputs reach `run:` only through quoted `env:` variables, `FLY_TOKEN` scoped to the jobs that use it, and the `semgrep` CI job is blocking (`--error`); a justified false positive gets `# nosemgrep: <rule-id> <reason>`.
  - Done (#167, free tooling only until public launch, owner 2026-11-21): ZAP baseline on staging (`.github/workflows/zap-staging.yml`, `.zap/rules.tsv`), patch SLAs (`docs/runbooks/security-patching.md`). Next: AI pen test on staging; external pen test + bounty revisited before launch.
- **EN-09** (#168) Secrets & keys: EU KMS for pepper (#27) and backup key, rotation schedule, short-lived deploy tokens, Fly org `thirstr` with SSO + 2FA, least-privilege tokens, break-glass account, quarterly access review. 2026-11-21: KMS deferred to before open beta (€0 budget). Access runbook ✔ (`docs/runbooks/access.md`: rotation schedule, break-glass, quarterly review), per-environment 90-day deploy tokens ✔ (`scripts/ops/fly-ci-tokens.sh`, nightly expiry check), org move planned (`docs/runbooks/fly-org-move.md`).
- Certificate pinning + app attestation (App Attest / Play Integrity) against bots and API scraping (spec security.md).

### E. Compliance
- **EN-10** (#169) Control set aligned with ISO 27001 / SOC 2 (policies, asset + vendor inventory with DPAs, access reviews, change management, evidence collected automatically). Certify only when a partner, investor or store asks; until then "aligned, not certified". ◐ Draft control set: `docs/compliance/` (controls, inventories, procedures).
- GDPR: DPIA for Art. 9 data (#9), records of processing, DSR tooling (export exists, delete ≤ 24 h), data retention proofs. ◐ Drafts in `docs/legal/` (not legal advice; lawyer review before open beta).
- **EN-11** (#170) EU Digital Services Act: notice-and-action, statement of reasons, internal appeals (Art. 20), transparency report, point of contact; UK Online Safety Act + age assurance as markets open. ◐ Drafts: `docs/legal/dsa.md`, `transparency-report-template.md`, `age-assurance.md`; product flows F-15 R-15.23–R-15.36 (mockup pick pending).

### F. Release safety
- Graceful deploys (SR-03).
- **EN-12** (#171) Canary deploys: one machine gets the new image first, auto-rollback on error rate / latency / crash gates; expand-and-contract DB migrations only (CI lint blocks destructive migrations in the same release); migration dry run on a prod snapshot. CI lint ✔ (`scripts/check-migrations.py`, `docs/runbooks/migrations.md`); canary + dry run open.
- **EN-13** (#172) Feature flags + kill switches: server-driven, per cohort/country/app version, no third-party tracking; every risky feature ships dark first. ✔ `GET /v1/config`, `docs/runbooks/flags.md`.
- **EN-14** (#173) Mobile release safety: phased App Store / Play staged rollout, minimum supported version + forced-update screen, API versioning with 2 app versions supported, OTA config kill switches. Minimum build + forced update ✔; phased rollout and API versioning open.

### G. Testing & resilience
- Load test + sizing (SR-12).
- **EN-15** (#174) Chaos and game days (monthly on staging, quarterly in a load env): kill an API machine, fail over the DB, stop Valkey (SR-11), drop the network between regions, fill a disk, expire APNs creds. Each result → runbook or fix. ◐ Staging tool + game-day runbook ✔ (`scripts/chaos/`, `docs/runbooks/game-day.md`, testing.md › Chaos); DB failover / region split wait for EN-01/EN-02, load env waits for spend.
- **EN-16** (#175) Device test matrix: real-device runs (low-end Android, old iPhone, 3G profile) in CI nightly; performance budgets enforced (EN-18). ◐ Emulator/simulator matrix nightly ✔ (low-end Android + 3G, mid Android, old iPhone + 3G; testing.md › Device matrix, no spend). Real-device farm = owner decision (costs or non-EU); signed-in iOS flows #267.

### H. Retention, backup & DR
- **EN-17** (#176) Quarterly full DR drill: restore prod into the second region from backups only, measure RTO/RPO, log in `docs/runbooks/db-backups.md`. Automated checks that retention rules (data-model.md) actually delete (row age metrics). Retention probes ✔ (`Thirstr.Retention`, alert in monitoring.md); DR drill ✔ automated (`dr-drill.yml`, quarterly into `ams` from backups only, `db-backups.md` › Automated drill).

### I. Performance, battery & data saving ("no compromises")
- **EN-18** (#177) Performance + energy budget, measured on every release:
  - Network: thumbnails + stable cacheable URLs (SR-10), WebP/AVIF, HTTP/2 + zstd/gzip on JSON, delta sync (only changed cards since last fetch, ETag/`If-None-Match`), batch requests, socket delivery (SR-13) instead of pull + ack round trips.
  - Battery: no polling while backgrounded (timers paused on `AppState` background), location only on open / significant change (Balanced accuracy, no continuous GPS except Exact pin), socket heartbeat tuned, push wakes instead of background fetch, map frame-rate cap when idle, lists virtualized.
  - Device storage: encrypted LRU caches with caps (SR-05, SR-10, SR-16), indexed local DB (SR-15).
  - "Data saver" setting: thumbnails only on mobile data, no video autoplay, prefetch only on Wi-Fi.
  - CI budgets: JS bundle size, cold start, request count per screen, bytes per grid page; release blocked on regression.

### J. Support & moderation
- **EN-19** (#178) Support: in-app help center + contact (en/fr/de), EU-hosted helpdesk, account recovery with identity checks, response SLAs, macros; feedback loop to issues.
- **EN-20** (#179) Moderation at scale: prioritized queue (safety first), reviewer tools with blur-by-default, CSAM hash matching on public photos before publish (e.g. Thorn Safer / PhotoDNA; E2EE content stays out of reach by design, reports carry franking proof), legal reporting path, appeals, moderator wellbeing, 24/7 coverage via vetted EU vendor from 100k MAU.

### K. Cost & capacity
- **EN-21** (#180) Monthly cost dashboard (Fly, Tigris, egress, vendors), cost per MAU, budget alerts, capacity forecast from SR-12 numbers.

### L. Team & process
- **EN-22** (#181) Bus factor: second engineer with prod access, code owners, two-person review for infra/security changes, documented on-boarding/off-boarding, change log for prod (already: promote-prod workflow). ✔ Ready now (€0): `.github/CODEOWNERS`, `docs/team/two-person-rule.md`, `onboarding.md`, `offboarding.md`, `docs/runbooks/break-glass.md`. Second engineer + enforced two-person review at open beta.

## 3. Phased roadmap
| Phase | When | Must have |
|---|---|---|
| 0 · Closed beta hardening | now → 4 weeks | SR-01 ✔ staging / prod, #158, SR-02, SR-03, SR-04, SR-05, SR-07, SR-14, SR-08, SR-15, EN-05, EN-07, EN-09 (org + access) |
| 1 · Open beta, 10k MAU | +1–3 months | SR-09, SR-10, SR-11, SR-12, SR-16, EN-01 (standby + failover), EN-04, EN-06, EN-12, EN-13, EN-14, EN-18, EN-19, EN-21, first pen test (EN-08) |
| 2 · Public launch, 100k MAU | +3–6 months | SR-06, SR-13, EN-02, EN-10, EN-11, EN-15, EN-16, EN-17, EN-20 (vendor), bug bounty, EN-22 |
| 3 · 1M MAU | +6–18 months | EN-03, certification if needed (EN-10), active-active regions, dedicated DB hardware decision |

## 4. Cost estimate (per month, EUR, rough)
Assumptions: DAU = 40 % of MAU, peak concurrent = 10 % of DAU, 6 public photos/user (≈ 1.5 MB originals + thumbnails), chat media ≤ 30 d server-side, prices = public list prices late 2026, to recheck before buying. People costs not included unless stated.

| | 10k MAU | 100k MAU | 1M MAU |
|---|---|---|---|
| Peak concurrent users | ~400 | ~4 000 | ~40 000 |
| API machines | 2–3 × performance-1x (2 GB): €60–100 | 4–6 × performance-2x (4 GB), 2 regions: €250–400 | 20–30 × performance-2x/4x, 2–3 regions: €2 500–4 500 |
| Postgres | perf-2x primary + standby + backups: €150–250 | perf-8x 32 GB primary + standby + replica: €900–1 500 | dedicated / bare-metal cluster + replicas: €4 000–8 000 |
| Valkey | €10–20 | HA pair: €60–120 | cluster: €400–800 |
| Object storage (Tigris) | ~0.1 TB: €5 | ~1 TB: €25 | ~10 TB: €250 |
| Egress / CDN | ~1–2 TB: €20–40 | ~15–25 TB: €300–500 | ~150–250 TB (CDN mandatory): €2 000–4 000 |
| Push (APNs, FCM) | €0 | €0 | €0 |
| Observability + errors (EU) | €0–50 | €150–300 | €1 000–2 000 |
| Email, SMS paging, status page | €20–50 | €100–200 | €300–600 |
| **Infra subtotal** | **≈ €300–500** | **≈ €1 800–3 000** | **≈ €10 000–20 000** |
| Security & compliance (amortized) | pen test €10–20k/yr → €1–1.5k | + bug bounty, DPIA/legal: €2–4k | + certification (ISO/SOC 2 €40–80k first year): €5–10k |
| Moderation & support (people/vendor) | owner + volunteers | 24/7 vendor, 2–4 FTE: €8–15k | 10–20 FTE: €40–80k |

Per MAU infra: ≈ €0.04 (10k) → €0.02–0.03 (100k) → €0.01–0.02 (1M). People (moderation, support, on-call) dominate cost from 100k MAU.

## 5. Issues
EN-01 … EN-22 = #160 … #181 (EN-n = #159+n). Backup key escrow: #158. Older related: #9 (DPIA), #21 (security checklist), #23 (hosting review), #27 (infra hardening).
