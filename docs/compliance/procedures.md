# Compliance procedures

> **DRAFT.** Claude (AI) draft, 2026-11-21 (EN-10, #169). Procedures the controls in [`controls.md`](controls.md) rely on.

## 1. Access review (quarterly; ISO 5.18 · SOC CC6.2)
1. Open a GitHub issue "Access review YYYY-Qn" from the checklist below (label `compliance`).
2. Export and paste (no secrets): GitHub repo collaborators + their roles; GitHub environments and who can approve `production`; Fly org members + tokens (`fly tokens list`); AWS IAM users/keys (SES user least privilege); App Store Connect users + API keys; Google Cloud project IAM; admin console roles.
3. For each: still needed? least privilege? 2FA/FIDO2? key age < 1 y? Remove or rotate, note the change.
4. Close the issue with "reviewed by" + date. The closed issue is the evidence.

Beta: one person holds every role (accepted risk D-12/R-AD.12); review still runs to catch stale tokens.

## 2. Change management (ISO 8.32 · SOC CC8.1)
Already implemented by the trunk model (`../spec/ops.md`):
- Every change = branch → PR (template: summary, spec IDs, ChangeLog) → CI (tests, sobelow, semgrep, gitleaks, changelog-check, EU-region check) → squash-merge → staging deploy → **"Promote to production"** only with the owner's explicit OK, same signed image digest, ≥ 30 min live on staging, smoke + auto-rollback.
- Emergency change: same path, PR may merge before review; post-incident review within 5 working days.
- Privacy check in the PR: if the change adds a table, field, vendor, retention rule or a new use of data → update `../legal/records-of-processing.md` and, if risk changes, `../legal/dpia.md` §9.
- Evidence: PR history, Actions runs, promote-prod run log, ChangeLog.

## 3. Evidence collection (automated where possible)
| Evidence | Source | How | Frequency |
|---|---|---|---|
| Change approvals | GitHub PRs + `promote-prod.yml` runs | GitHub API export | continuous |
| CI security scans | Actions logs (sobelow, semgrep, gitleaks, audits) | retained by GitHub (90 d) → monthly export | monthly |
| Backups + restore drills | pgBackRest info, drill log | `db-backups.md` log | monthly / quarterly |
| Retention enforcement | `thirstr_retention_overdue` metric | Grafana snapshot | monthly |
| Access reviews | closed `compliance` issues | GitHub | quarterly |
| Incidents | `docs/incidents/` | repo | per incident |
| Vendor DPAs | `inventories.md` + stored PDFs (owner's drive, not in repo) | manual | yearly |
| Admin actions | `admin_audit` (append-only) | DB | continuous |

Proposal (not built; needs spec + owner OK): `compliance-evidence.yml` monthly workflow that exports PR/merge/promote metadata, CI scan summaries and Fly release list into a private artifact, and opens the next access-review issue at quarter start.

## 4. Data subject requests (GDPR Art. 12–22 · nFADP Art. 25–32)
| Right | Channel | Tooling | Deadline |
|---|---|---|---|
| Access / portability | in app: Settings › Account › Download my data | ✔ R-01.11 | instant |
| Erasure | in app: Delete account | ✔ R-01.10, ≤ 24 h + backups ≤ 30 d | instant |
| Rectification | edit profile | ✔ | instant |
| Restriction / objection | pause account, field visibility, Hidden | ✔ | instant |
| Requests by email (no app access, e.g. lost phone, trusted contacts, web notifiers) | `privacy@thirstr.fun` (to create) | manual: identify via recovery phrase sign-in or account-bound proof; never by name/photo alone | 1 month (GDPR), 30 d (nFADP) |
Log each email request (date, type, outcome, no content) in a private register for 3 years (proof).

## 5. Retention proofs
`Thirstr.Retention` counts rows past each deadline (EN-17); alert when > 0 for 1 h. Monthly evidence: metric snapshot showing 0 per rule. A new retention rule must add a probe (data-model.md).

## 6. Vendor onboarding
Before any personal data flows: purpose, data, region, security reports, DPA + transfer tool recorded in `inventories.md`; RoPA §3/§4 updated; owner OK.

## 7. People
Onboarding: contract with confidentiality, security training, hardware key, least-privilege roles. Offboarding same day: revoke all of §1, rotate shared secrets they could read.
