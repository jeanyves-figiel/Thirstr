# Runbook: security findings and patch SLAs (EN-08, #167)

Applies to every security finding in our code, dependencies, images and infra. Free tooling only for now (owner decision 2026-11-21); external pen test and bug bounty are revisited before public launch.

## 1. Sources
| Tool | What | Where | Blocks |
|---|---|---|---|
| `mix sobelow` | Phoenix SAST | CI `server`, every PR | yes |
| `mix deps.audit` | Hex advisories | CI `server` + Nightly | yes |
| `cargo audit` | RustSec advisories | CI `core` + Nightly | yes |
| `npm audit --omit=dev --audit-level=high` | npm runtime deps | Nightly | nightly red |
| semgrep (OSS rules) | TS/React + workflows SAST | CI `semgrep`, every PR | report-only until #244 baseline is clean |
| gitleaks | secrets in git | CI `secrets`, every PR | yes |
| ZAP baseline (passive) | headers, cookies, error/PII disclosure, vulnerable JS on **staging** | `ZAP staging` workflow: after each staging deploy, weekly Mon 03:30 UTC, manual | FAIL rules in `.zap/rules.tsv` → red run + issue |
| AI pen test (staging only) | API, auth/session, WebAuthn, E2EE review, clients, IDOR, rate limits, anti-bot | on demand | findings → issues |
| Reports from people | hello@thirstr.fun | — | — |

**Never scan prod.** ZAP and the pen test target `staging.thirstr.fun` only; the workflow refuses any other target.

## 2. Severity and SLAs
Severity = CVSS v3.1/v4 base score of the advisory, raised one level if the issue is reachable from the internet without an account or touches location, messages, photos or identity (Art. 9 data), lowered one level only if the vulnerable code is provably not reachable in our build (write down why).

| Severity | CVSS | Fixed **in prod** within | Examples |
|---|---|---|---|
| **Critical** | 9.0–10 | **48 h** | RCE, auth bypass, exposed secret, location/precision leak, data breach path |
| **High** | 7.0–8.9 | **7 days** | stored XSS, IDOR on private data, missing auth check, high CVE in a runtime dep |
| **Medium** | 4.0–6.9 | 30 days | missing security header with real impact, CSRF on a low-value action |
| **Low** | 0.1–3.9 | 90 days or next dependency sweep | informational headers, dev-only deps |

- The clock starts when the finding is **known** (tool run, advisory published for a dep we ship, or report received), not when triaged.
- "Fixed" = the fixed image is live in prod (or the secret is rotated, or the vulnerable feature is turned off with a kill switch, `docs/runbooks/flags.md`). A merged PR on staging alone does not stop the clock.
- Critical or anything with signs of exploitation is also an incident: follow `incident-response.md` (SEV1 if personal data may be exposed; GDPR 72 h clock).

## 3. Flow
1. **Issue**: every finding gets a GitHub issue with label `security`, severity and due date in the title (e.g. `[High, due 2026-11-28] IDOR on /v1/albums/:id`). ZAP opens or comments `ZAP baseline: FAIL findings on staging` itself. Do not post exploit details for unfixed criticals in public issues (the repo is public): write "details in private notes" and keep them with the owner.
2. **Triage** (same day for critical/high): confirm, set severity, link the advisory/CVE.
3. **Fix** on a branch → PR (ChangeLog under `### Security`) → squash-merge on green → staging.
4. **Prod**: ask the owner for the promotion OK right away, saying it is a security fix and its due time. No prod promotion without his explicit OK, even for criticals; if he can't be reached before the deadline, use a kill switch / config change instead and say so.
5. **Close** the issue with the prod promotion run link.

## 4. Exceptions
A finding that can't meet its SLA (no upstream fix, false positive, accepted risk) needs a comment on its issue: reason, compensating control, new review date (≤ 30 days for high, ≤ 90 for medium). False positives: lower the rule in `.zap/rules.tsv` or add a semgrep `nosemgrep: <rule> <reason>` with the issue number.

## 5. ZAP rule levels
`.zap/rules.tsv` sets each passive rule to `FAIL` (red run + issue), `WARN` (job summary only; default for unlisted rules), `INFO` or `IGNORE`. Start: FAIL for cookie flags, debug/application error disclosure, PII, hash and private IP disclosure, vulnerable JS libraries, weak auth. Promote a WARN rule to FAIL once staging is clean for it. Report artifact `zap-staging-report` (HTML/MD/JSON) is kept 30 days.

## 6. Review
Monthly: open `security` issues vs. due dates, nightly failures, semgrep baseline progress (#244). Any missed SLA gets a line in the issue saying why.
