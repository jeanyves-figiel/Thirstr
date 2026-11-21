# On-boarding an engineer (EN-22, #181)

Closed beta has no second engineer; this is ready for open beta. Copy the checklist into an issue `Onboard <first name>` (label `team`) and tick it. Grant the least that works; widen later.

## Before day 1 (owner)
- [ ] Signed contract incl. confidentiality and data-processing terms (special category data: sexual orientation, location).
- [ ] Their own accounts only, never shared logins. 2FA with an authenticator or passkey on every one.

## Access
| System | Grant | Notes |
|---|---|---|
| GitHub | repo collaborator, **Write** (not Admin) | add to `CODEOWNERS` default line (`two-person-rule.md`) |
| GitHub `production` environment | required reviewer | promotions need the other person |
| Fly.io (org `personal`) | member | deploy tokens stay in CI; personal `fly auth login` for ssh/logs |
| Fly Grafana | via Fly org | dashboards + metrics |
| Admin console | `moderator` first, `admin` after 30 days | JIT elevation (R-AD.3) |
| Pushover | own account + licence | added to the on-call group (`on-call.md` › Adding the second person) |
| App Store Connect | **Developer** role (not Admin) | TestFlight internal tester |
| Google Play Console | release manager | when Android ships |
| AWS (SES) | IAM user, read-only console + SES stats | no IAM admin |
| GoDaddy DNS, Apple account holder, Expo owner, ImprovMX | **none** | owner only |
| Break-glass vault | none at first | named emergency contact rule stays with the owner |

## Day 1–5
- [ ] DEV running locally (`README.md`, https://localhost:7443).
- [ ] Read: `docs/spec/README.md`, `security.md`, `decisions.md`, `docs/runbooks/` (all), `incident-response.md`.
- [ ] First PR (small, with CHANGELOG entry) merged through CI.
- [ ] Shadow one prod promotion; then do one with the owner as reviewer.
- [ ] Test push received from **On-call alerts** (Run workflow › Send a test push).
- [ ] Restore drill on staging once (`db-backups.md`).

## Before first on-call week
- [ ] Walk through every section of `docs/runbooks/alerts.md` with the owner.
- [ ] Can: read logs, roll back to a previous digest (on staging), flip a kill switch, raise `min_build`.
- [ ] Handover slot agreed (`on-call.md` › Handover).

Record the date access was granted in the issue; it is the access log the off-boarding uses.
