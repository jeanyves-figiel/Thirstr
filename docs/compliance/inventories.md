# Asset and vendor inventory

> **DRAFT.** Claude (AI) draft, 2026-11-21 (EN-10, #169). Owner reviews quarterly (access review, `procedures.md`). DPA statuses are **unverified** until the owner records the signed document.

## 1. Assets
| ID | Asset | Type | Location | Data class | Owner | Backup |
|---|---|---|---|---|---|---|
| AS-01 | `thirstr-api-prod` / `-staging` | Fly app (Phoenix) | fra, ams | processes all SV data | owner | image registry (signed) |
| AS-02 | `thirstr-db-prod` / `-staging` | Postgres 16 + h3 (Fly machine + volume) | fra | Art. 9 SV data | owner | pgBackRest → AS-05 |
| AS-03 | `thirstr-valkey-<env>` | Valkey, RAM only | fra | exact pins, counters (RAM) | owner | none by design |
| AS-04 | Tigris `thirstr-public-<env>` | object storage | EU (placement to confirm) | public photos, E2EE blobs (CT) | owner | no (re-uploadable / ephemeral) |
| AS-05 | Tigris `thirstr-backups-<env>` | object storage | EU | encrypted DB backups | owner | — |
| AS-06 | classifier app | Fly app, private | fra | public photos in transit | owner | image |
| AS-07 | tiles app | Fly app | fra | none personal | owner | image |
| AS-08 | Admin console | LiveView in API | behind zero-trust | moderation data | owner | — |
| AS-09 | GitHub repo `jeanyves-figiel/Thirstr` + Actions + environments | code, CI, secrets | GitHub | secrets (encrypted), no user data | owner | git clones |
| AS-10 | App Store Connect / TestFlight | distribution | Apple | tester emails | owner | — |
| AS-11 | Google Play Console | distribution (later) | Google | — | owner | — |
| AS-12 | Domain `thirstr.fun` + DNS | GoDaddy | — | none | owner | DNS export in fly.md |
| AS-13 | AWS account (SES) | email | eu-central-2 | email in transit | owner | — |
| AS-14 | Mailbox `hello@` (ImprovMX → owner inbox) | email | — | user emails | owner | — |
| AS-15 | Secrets: pepper, backup cipher pass, ASC key, FLY_TOKEN, SES creds, Google client ids | secrets | Fly secrets / GitHub env secrets / KMS (○ #27) | high | owner | escrow #158 |
| AS-16 | Mobile app binaries | software | stores | — | owner | git tags |
| AS-17 | Owner laptop + hardware keys | endpoint | — | admin access | owner | — |

## 2. Vendors
| Vendor | Service | Personal data | Region | Certifications (vendor-claimed, to collect) | DPA | Transfer tool | Review |
|---|---|---|---|---|---|---|---|
| Fly.io, Inc. | compute, Postgres hosting, registry, metrics | yes (all SV) | EU regions | SOC 2 Type II (request report) | ○ accept Fly DPA in org settings | DPF / SCCs (check) | yearly + #23 |
| Tigris Data, Inc. | object storage | public photos, ciphertext | EU (confirm) | to check | ○ | DPF / SCCs (check) | yearly |
| Amazon Web Services (SES) | transactional email | email address | Zurich | ISO 27001, SOC 2 | ○ AWS GDPR DPA (in AWS Service Terms, auto-applies; record it) | SCCs incl. | yearly |
| Apple | APNs, Sign in with Apple, App Attest, TestFlight, App Store | opaque tokens, hashed sub | global | — | Apple Developer Program License Agreement data terms | DPF | yearly |
| Google | FCM, Google sign-in, Play | opaque tokens, hashed sub | global | — | Google Cloud / Firebase data processing terms | DPF | yearly |
| Yoti Ltd | fallback age check (D-13) | face image transiently, boolean result | UK | ISO 27001, SOC 2, PAS 1296 (check) | ○ **required before use** | UK adequacy | before use |
| ImprovMX | email forwarding `hello@` | email contents | to check | to check | ○ | to check | replace by SES inbound or EU mailbox (proposal) |
| GoDaddy | registrar + DNS | none | — | — | n/a | n/a | — |
| GitHub (Microsoft) | code, CI | staff data only | US | SOC 2, ISO 27001 | GitHub DPA (default) | DPF | yearly |
| DB-IP | offline IP→city file | none (runs locally) | — | — | n/a (CC BY 4.0 licence) | n/a | — |
| OpenStreetMap / GeoNames / Protomaps | data files | none | — | — | n/a (licences) | n/a | — |
| Helpdesk (EN-19) | support | emails, messages | EU required | — | ○ before use | — | — |
| CSAM hash matching (EN-20) | hash match on public photos | photo hashes | EU preferred | — | ○ before use | — | — |
| Pen tester (EN-08) | security test | test accounts only | — | CREST / OSCP | NDA | — | per engagement |

Rule: no vendor receives personal data before a DPA is recorded here (procedures.md › Vendor).
