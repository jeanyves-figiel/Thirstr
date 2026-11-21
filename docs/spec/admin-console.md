# Admin & moderation console

Internal web app (`/server/apps/admin`, Phoenix LiveView). Implements back office for F-15 Moderation, F-03 Verification appeals, F-12 Venues, F-11 Clubs, legal requests. Not user-facing.

## Access
- R-AD.1 Reachable only via VPN/zero-trust proxy; no public DNS.
- R-AD.2 Login: FIDO2 hardware key only; session 8 h idle 30 min.
- R-AD.3 Just-in-time grants: role elevation requires second admin approval, expires ≤ 4 h.
- R-AD.4 Every view and action is written to an append-only audit log (who, what, object id hash, reason, time); audit log retained 2 y, read-only to `auditor`.
- R-AD.5 No bulk export of user data from the console. No search by name, email, or location.

## Roles
| Role | Can |
|---|---|
| `moderator` | work report queue, view reported content (only what reporter attached, decrypted via franking), warn/suspend ≤ 7 d, remove public photos |
| `senior_mod` | + permanent ban, unban, quarantine release, appeal decisions |
| `trust_ops` | verification appeals (no biometrics stored: only result + cooldown), venue/club approvals |
| `legal` | legal request register, preservation holds (data minimal by design) |
| `admin` | role management (with JIT), feature flags, rate-limit config |
| `auditor` | read audit log |

## Queues (screens)
| ID | Screen | Content | Actions |
|---|---|---|---|
| A-01 | Report queue | reports sorted by severity (minor safety, violence, CSAM, scam, spam, other) then age; SLA timer | open → A-02 |
| A-02 | Report detail | reason, reporter note, franked messages/media the reporter attached, public profile snapshot, prior actions on account (counts), account age, trust signals (verified, vouches, attestation) | dismiss, warn, remove content, suspend (1/3/7 d), ban, escalate; reason code required |
| A-03 | Photo review | AI-flagged public photos (F-15 R-15.10) below confidence threshold | approve, reject (reason), mark explicit → private-only |
| A-04 | Quarantine | accounts in shadow quarantine (F-15) with signals | release, extend, ban |
| A-05 | Appeals | user appeals of bans/rejections | uphold, overturn; user notified in app |
| A-06 | Verification appeals | failed/cooldown cases (no images stored) | grant re-try, reset cooldown |
| A-07 | Venues & clubs | submissions, edits, claims | approve, edit, reject |
| A-07b | Places (#113, #191) | venue catalogue counts by source/kind, places added by members (newest 50: name, kind, nearest city, time, check-ins, map link; never the creator), last OSM import (time, added/updated/removed), upcoming official parties | Import now (OSM, F-12 R-12.9); hide/unhide venue; delete a member place (F-12 R-12.11); add official party (venue search by name + city, title, start, end, link); remove party. Every action audited |
| A-08 | Legal register | requests, jurisdiction, response, hold | log; respond with templated "data held" summary |
| A-09 | Config | rate limits, k-anon k, view caps, flags | change with 2-person approval |
| A-10 | Audit log | filter by actor, action, time | read-only |

## Rules
- R-AD.6 Moderators never see: location, chats not attached by a reporter, private albums not attached, email, device ids, IPs.
- R-AD.7 CSAM: auto-hide on classifier match, escalate to senior_mod, report to NCMEC/national hotline per law; reviewer exposure minimised (blurred by default, grayscale, click to reveal).
- R-AD.8 Severity SLAs: minor safety / violence / CSAM ≤ 1 h; scam ≤ 12 h; other ≤ 48 h.
- R-AD.9 Every enforcement sends the user an in-app notice with rule cited and appeal link (DSA Art. 17 statement of reasons).
- R-AD.10 Transparency report figures (counts per action, per reason) computed from audit log, no user ids.
- R-AD.12 Closed beta: owner is sole admin and moderator. Two-person rules (R-AD.3, A-09) degrade to owner self-approval with mandatory reason; audit log unchanged. Re-enable before public beta.
- R-AD.11 Moderator wellbeing: queue rotation, max 4 h/day on severe queues, opt-out of categories.

## Acceptance
- AC-AD.1 Login without FIDO2 key is impossible (automated).
- AC-AD.2 Every action in A-02…A-09 creates exactly one audit entry (automated).
- AC-AD.3 No console endpoint returns location, email, or IP fields (contract test + privacy grep).
- AC-AD.4 Config change without second approver is rejected (automated).
