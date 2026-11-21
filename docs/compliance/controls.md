# Control set aligned with ISO/IEC 27001:2022 and SOC 2

> **DRAFT.** Claude (AI) draft, 2026-11-21 (EN-10, #169). **Aligned, not certified.** Certification (€40–80k first year) only when a partner, investor or store requires it (owner decision 2026-11-21). Privacy parts reviewed by counsel with #9 before open beta.

Scope: Thirstr service (API, DB, storage, admin console, mobile apps, website, CI/CD) and the people who run it. Statement of applicability below maps each control to ISO 27001:2022 Annex A and SOC 2 Trust Services Criteria (2017, rev. 2022): CC = Common Criteria (Security), A = Availability, C = Confidentiality, P = Privacy.

Status: ✔ in place with evidence · ◐ partial · ○ planned · n/a.

## 1. Policies (ISO 5.1 · SOC CC1, CC2, CC5.3)
One short policy per row, all in this folder or linked; owner approves; reviewed yearly.

| Policy | Content | Where | Status |
|---|---|---|---|
| Information security policy | scope, roles, risk approach, this control set | this file | ◐ |
| Acceptable use & access | least privilege, FIDO2, no shared accounts, JIT grants | `procedures.md` › Access | ◐ |
| Change management | trunk model, PR + CI + ChangeLog, promote with owner OK | `procedures.md` › Change | ✔ |
| Incident response | severities, 72 h breach notification | `../runbooks/incident-response.md` | ✔ |
| Backup & DR | PITR, encryption, drills | `../runbooks/db-backups.md` | ✔ staging / ◐ prod |
| Data protection & retention | DPIA, RoPA, retention table, DSR | `../legal/`, `../spec/data-model.md` | ◐ |
| Vendor management | DPA before use, yearly review | `inventories.md` › Vendors | ◐ |
| Secure development | threat model, SAST, dependency SLAs, code review | `../spec/security.md`, EN-08 | ◐ |
| Cryptography & keys | E2EE, TLS 1.3, KMS, rotation | `../spec/security.md` › Key management, EN-09 | ◐ |
| Moderation & content | F-15, DSA flows | `../spec/features/F15-moderation.md`, `../legal/dsa.md` | ◐ |
| HR security | onboarding/offboarding, confidentiality, training | `procedures.md` › People | ○ (one person today) |

## 2. Statement of applicability (summary by theme)
### 2.1 Organisational (ISO A.5)
| ISO | Control | SOC 2 | Thirstr implementation | Evidence (automated where possible) | Status |
|---|---|---|---|---|---|
| 5.2–5.4 | roles, segregation of duties | CC1.3, CC5.1 | owner = all roles in beta (D-12, R-AD.12); two-person rules re-enabled before public beta; EN-22 second engineer | role list in `procedures.md` | ◐ (accepted risk) |
| 5.7 | threat intelligence | CC3.2 | dependency advisories (mix/cargo/npm audit nightly), Apple/Google policy watch | `nightly.yml` runs | ✔ |
| 5.9 | asset inventory | CC6.1 | `inventories.md` › Assets | file + quarterly review issue | ◐ |
| 5.10–5.12 | data classification, acceptable use | C1.1 | SV/CT/RAM/DEV labels in data-model; Art. 9 baseline | data-model.md | ✔ |
| 5.15–5.18 | access control, identity, authentication, access rights | CC6.1–6.3 | GitHub 2FA, Fly SSO + 2FA, FIDO2 admin, quarterly access review | access review issue + export | ◐ |
| 5.19–5.23 | supplier security, cloud services | CC9.2 | vendor inventory + DPAs | `inventories.md` | ◐ |
| 5.24–5.28 | incident management, evidence | CC7.3–7.5 | runbook, register `docs/incidents/` | register entries | ✔ |
| 5.29–5.30 | continuity, ICT readiness | A1.2–A1.3 | backups + PITR, restore drills, DR drill quarterly (EN-17) | drill log in db-backups.md | ◐ |
| 5.31–5.34 | legal, IP, records, privacy | P1–P8 | `../legal/`, retention probes | DPIA, RoPA, `thirstr_retention_overdue` | ◐ |
| 5.35–5.36 | independent review, compliance | CC4.1 | yearly pen test (EN-08), counsel review (#9) | reports | ○ |
| 5.37 | documented procedures | CC2.1 | `docs/runbooks/` | repo | ✔ |

### 2.2 People (ISO A.6)
| ISO | Control | SOC 2 | Implementation | Status |
|---|---|---|---|---|
| 6.1–6.2 | screening, terms | CC1.4 | contract with confidentiality + privacy clause for every hire/contractor/moderator vendor | ○ |
| 6.3 | awareness & training | CC2.2 | yearly security + privacy training; moderators: CSAM handling, wellbeing (R-AD.11) | ○ |
| 6.5 | after termination | CC6.2 | offboarding checklist (revoke GitHub, Fly, admin key, secrets rotation) | ○ |
| 6.7 | remote working | CC6.7 | full-disk encryption, screen lock, hardware keys | ○ |

### 2.3 Physical (ISO A.7)
Cloud only; physical controls inherited from Fly.io / Tigris / AWS (their SOC 2 / ISO reports collected yearly, `inventories.md`). Laptops: 7.9 / 7.10 encrypted, 7.14 secure disposal. Status ◐.

### 2.4 Technological (ISO A.8)
| ISO | Control | SOC 2 | Implementation | Evidence | Status |
|---|---|---|---|---|---|
| 8.2 | privileged access | CC6.1 | Fly org deploy token in GitHub env secrets, admin console FIDO2 + JIT | Fly org members export | ◐ |
| 8.5 | secure authentication | CC6.1 | passkeys for users; FIDO2 for staff | AC-AD.1 test | ✔ |
| 8.7 | malware | CC6.8 | uploads only images/videos, re-encoded; classifier; no executables | — | ✔ |
| 8.8 | vulnerability management | CC7.1 | deps audit nightly, semgrep, sobelow, gitleaks; patch SLA critical 48 h, high 7 d | CI logs | ◐ |
| 8.9 | configuration | CC8.1 | infra as code (`infra/`), EU-region CI check | CI | ✔ |
| 8.10 | information deletion | P4.3 | account delete ≤ 24 h; retention sweeps + probes | `thirstr_retention_overdue` = 0 | ✔ |
| 8.11 | data masking | C1.1 | hashed identifiers, IP hashed 24 h, scrubbed error reports | log PII grep test | ✔ |
| 8.12 | data leakage prevention | C1.1 | no SDKs, E2EE, AC-AD.3 contract test | tests | ✔ |
| 8.13 | backup | A1.2 | pgBackRest PITR, encrypted, monthly restore | drill log | ✔ staging / ◐ prod |
| 8.14 | redundancy | A1.2 | ≥ 2 API machines fra+ams; HA Postgres EN-01 | — | ◐ |
| 8.15–8.16 | logging, monitoring | CC7.2 | Prometheus metrics, alerts (`monitoring.md`), append-only admin audit | alert rules | ✔ |
| 8.20–8.22 | network security, segregation | CC6.6 | Fly 6PN private network, classifier without public IP, admin behind zero-trust | fly config | ◐ |
| 8.24 | cryptography | CC6.1, C1.1 | TLS 1.3, MLS, AES-256-GCM, cosign image signing; KMS pepper ○ (#27) | — | ◐ |
| 8.25–8.29 | secure SDLC, testing | CC8.1 | spec before build, PR review, CI tests, abuse harnesses | CI | ✔ |
| 8.31 | separation of environments | CC8.1 | DEV / staging (synthetic) / prod | ops.md | ✔ |
| 8.32 | change management | CC8.1 | see `procedures.md` › Change | PR + workflow runs | ✔ |
| 8.33 | test information | C1.1 | no prod data in staging (seeded synthetic) | — | ✔ |
| 8.34 | audit testing | CC4.1 | read-only access for auditors | — | ○ |

### 2.5 SOC 2 Availability and Privacy extras
- A1.1 capacity: EN-21 cost + capacity dashboard, SR-12 load test (◐).
- P1–P8 notice, choice, collection, use, access, disclosure, quality, monitoring: privacy policy (○), in-app consent (○ Art. 9 screen), export + delete (✔), DSR log (`procedures.md`) (○).

## 3. Risk register (link)
Information security risks = DPIA §5 + security.md attackers A1–A9. Reviewed quarterly with the access review.

## 4. When to certify
Trigger: a partner, investor or store asks; or > 100k MAU with enterprise partners. Path: SOC 2 Type I (3–4 months of evidence) → Type II, or ISO 27001 stage 1+2. Tooling then (Vanta/Drata-type, EU data residency) vs current GitHub-based evidence.
