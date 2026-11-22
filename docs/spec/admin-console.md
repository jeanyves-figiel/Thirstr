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
| A-01 | Queue (#179) | one prioritised list of reports, photo reviews, hash hits, quarantine reviews and appeals, sorted by tier (0 hash hit/CSAM · 1 underage/violence/non-consensual · 2 scam · 3 harassment/hate · 4 spam/impersonation · 5 other), trusted flagger, then SLA left (F-15 R-15.51); tier counts, type filter, j/k + Enter | open → A-02 / A-03 / A-05 / A-12 |
| A-02 | Report detail | reason, reporter note, franked messages/media the reporter attached, public profile snapshot, prior actions on account (counts), account age, trust signals (verified, vouches, attestation) | dismiss, warn, remove content, suspend (1/3/7 d), ban, escalate; reason code required |
| A-03 | Photo review | AI-flagged public photos (F-15 R-15.10) below confidence threshold, and photos whose hash check failed for 30 min (R-15.43); borderline Moments (`review`, F-21 R-21.24, #221) still in time; reviewer tools R-15.52 | approve, reject (reason), mark explicit → private-only, escalate to A-12 (CSAM); Moments: approve (live for the time left) / reject (deleted) |
| A-03b | Linked accounts hand check (I-01, #17) | OnlyFans / JustFor.Fans links whose bio code could not be fetched (`manual_pending_at`), oldest first: platform, handle, code, profile link (opens the creator page), age | approve (✓ proof `manual`), reject (link stays, no ✓). Impersonation reports (≥ 2 reporters) hide the link automatically (R-I01.24). Every action audited |
| A-04 | Quarantine | accounts in shadow quarantine (F-15) with signals | release, extend, ban |
| A-05 | Appeals | user and notifier appeals (F-15 R-15.30–33): original decision, facts, statement of reasons as sent, appeal text; 12 h cooling-off when the same person decided (beta) | uphold, reverse (reason ≤ 300 required); user notified in app (S-81 timeline) |
| A-06 | Verification appeals | failed/cooldown cases (no images stored) | grant re-try, reset cooldown |
| A-07 | Venues & clubs | submissions, edits, claims | approve, edit, reject |
| A-07b | Places (#113, #191) | venue catalogue counts by source/kind, places added by members (newest 50: name, kind, nearest city, time, check-ins, map link; never the creator), last OSM import (time, added/updated/removed), upcoming official parties | Import now (OSM, F-12 R-12.9); hide/unhide venue; delete a member place (F-12 R-12.11); add official party (venue search by name + city, title, start, end, link); remove party. Every action audited |
| A-08 | Legal register | requests, jurisdiction, response, hold | log; respond with templated "data held" summary |
| A-12 | Hash hits & CSAM cases (#179) | open/confirmed/false-positive cases: provider, match id, account, time, SLA 1 h; image never revealed by default (reveal = reason + confirm, audited); monthly PhotoDNA calls vs cap | confirm (ban + blocklist + report pack), false positive (release photo + account), legal hold |
| A-13 | Legal reports (#179) | per confirmed case: report pack (JSON + summary), where filed (NCMEC, fedpol, country hotline, Art. 18 police), date, external ref, filer; evidence expiry (1 y) | mark filed, add ref, extend hold, download pack (legal only, audited) |
| A-14 | My moderation day (#179) | own items today, time on tiers 0–1, breaks taken | — |
| A-09 | Config | rate limits, k-anon k, view caps, flags | change with 2-person approval |
| A-10 | Audit log | filter by actor, action, time | read-only |
| A-11 | Costs & capacity (#180, EN-21) | this month's cost per vendor, cost per MAU, budget bar, 6-month history, capacity forecast | add/edit/end a cost item; set budget, alert email, FX rate, capacity inputs. Every action audited. See § Costs & capacity |
| A-12 | Support inbox (F-22, #178) | requests sorted by target time left (R-22.13), topic, ref, language, app details, message + screenshots, thread; Recovery conflicts tab (claim events only, no images); feedback held by the scrubber/classifier | reply (free text or saved reply with placeholders, R-22.14), mark waiting / solved, edit saved replies; recovery conflict: keep paused / release freeze after a side withdrew. **No** action changes sign-in methods, devices, recovery phrase or ownership (R-22.20). Every view and reply audited |

## Rules
- R-AD.6 Moderators never see: location, chats not attached by a reporter, private albums not attached, email, device ids, IPs.
- R-AD.7 CSAM: auto-hide on classifier match, escalate to senior_mod, report to NCMEC/national hotline per law; reviewer exposure minimised (blurred by default, grayscale, click to reveal).
- R-AD.8 Severity SLAs: minor safety / violence / CSAM ≤ 1 h; scam ≤ 12 h; other ≤ 48 h.
- R-AD.9 Every enforcement sends the user an in-app notice with rule cited and appeal link (DSA Art. 17 statement of reasons).
- R-AD.10 Transparency report figures (counts per action, per reason) computed from audit log, no user ids.
- R-AD.12 Closed beta: owner is sole admin and moderator. Two-person rules (R-AD.3, A-09) degrade to owner self-approval with mandatory reason; audit log unchanged. Re-enable before public beta.
- R-AD.11 Moderator wellbeing: queue rotation, max 4 h/day on severe queues, opt-out of categories. Details F-15 R-15.53 (break card at 2 h, lock at 4 h, 60 s pause after tier 0; beta owner: warnings only).
- R-AD.13 Evidence (F-15 R-15.47) is readable only by `legal` and `senior_mod`, with a reason, one audit entry per read; `moderator` gets 403 (AC-15.16).

### Owner passkey enrolment (R-AD.16, #179)
Console sign-in is passkey only (R-AD.12). An owner who signed up with Apple, Google or email has no passkey for the console host, so the console enrols one through a one-time link that only someone with Fly SSH access can create.
- R-AD.16 `bin/thirstr rpc 'Thirstr.AdminEnrol.link("<account id>")'` prints `https://<APP_URL host>/admin/enrol?t=<token>`. Refused (`{:error, :not_admin}`) unless the id is in `ADMIN_ACCOUNT_IDS`. Token: 32 random bytes; Valkey keeps only its HMAC (`ae:<hash>`) → account id, TTL 10 min, single use. Audit `enrol_link` (actor `console`, object = account hash).
- R-AD.16a `GET /admin/enrol?t=` shows "Create console passkey" (no account data on the page) or "Link expired or used" (410). `Referrer-Policy: no-referrer`, `Cache-Control: no-store`.
- R-AD.16b The browser creates a discoverable passkey for the console host's RP id (`WEBAUTHN_RP_ID`: `staging.thirstr.fun`, `api.thirstr.fun`, DEV `localhost`) with user verification **required**. `POST /admin/enrol` takes the token (GETDEL, single use), checks the id is still in `ADMIN_ACCOUNT_IDS`, verifies the attestation, stores the passkey on that account, audits `passkey_enrolled`, and starts the console session (8 h / idle 30 min).
- R-AD.16c Failures (expired, reused, not admin, bad attestation) → 403/410, audit `enrol_failed`, no detail on the page. 10 attempts per IP per hour (rate limit `enrol`).
- R-AD.16d The same passkey also signs in to the app on that host (it is an ordinary account passkey). iCloud Keychain or Google Password Manager syncs it to the owner's other devices; a hardware security key works too. Enrol staging and prod separately (different RP ids).
- AC-AD.8 Given an admin id, when the owner opens a fresh link and creates a passkey, then they land on `/admin` signed in, and the link no longer works. Given an id not in `ADMIN_ACCOUNT_IDS`, `link/1` returns `{:error, :not_admin}`.

## Acceptance
- AC-AD.1 Login without FIDO2 key is impossible (automated).
- AC-AD.2 Every action in A-02…A-09 creates exactly one audit entry (automated).
- AC-AD.3 No console endpoint returns location, email, or IP fields (contract test + privacy grep).
- AC-AD.4 Config change without second approver is rejected (automated).

## Costs & capacity (A-11, #180, EN-21)
Owner view of what Thirstr costs, per vendor and per monthly active user, with a budget alert and a capacity forecast. No new vendor, no spend: Fly numbers come from the Fly Machines API with a read-only token, everything else is typed in. Only aggregates: no account id, email, IP or location anywhere on the page or in the email (AC-AD.3).

### Data
| Table | Columns | Notes |
|---|---|---|
| `cost_items` | id, vendor, label, amount_cents (EUR), cadence `once`/`monthly`/`yearly`, start_month, end_month (null = open), note, created_at | Manual entries. `yearly` counts 1/12 per month (amortised); `once` counts in start_month only. Ending sets end_month, never deletes (history stays right). |
| `cost_fly_daily` | day, app, rate_cents_month (USD), detail jsonb (machines: cpu_kind, cpus, memory_mb, state; volumes: size_gb) | One row per Fly app per day, written by the daily job. |
| `usage_daily` | day, dau, mau, db_bytes | DAU = accounts with a device seen that day; MAU = seen in the last 30 days (`devices.last_seen_day`). Counts only. |
| `cost_settings` | key, value jsonb | `budget_eur` (0 = alerts off), `alert_email`, `usd_eur` (default 0.92), `fly_prices`, capacity inputs below. |
| `cost_alerts` | month, threshold (80/100), sent_at | Unique (month, threshold): each alert at most once a month. |

### Fly from the API (R-AD.13)
- Daily job `Thirstr.Jobs.CostSnapshot` (Oban cron `10 2 * * *`, maintenance queue) lists the org's apps, their machines and volumes via `api.machines.dev` with `FLY_COST_TOKEN` (read-only org token, `fly tokens create readonly thirstr`; runbook `docs/runbooks/costs.md`). Without the token the Fly row says "token not set" and Fly can be typed in as a manual item instead.
- Rate per app = Σ started machines (shared: $1.94 per vCPU incl. 256 MB; performance: $31 per vCPU incl. 2 GB; extra RAM $5/GB) + Σ volumes ($0.15/GB) per 30-day month. Prices are list prices kept in `fly_prices`, editable, labelled "estimate". Stopped machines count 0.
- Fly month to date = Σ days of (rate / days in month); month-end projection = month to date + today's rate × days left. USD → EUR with `usd_eur`.
- Failure (network, 401) keeps yesterday's row, logs a warning, shows "last updated <date>".

### Page A-11 (`/admin/costs`)
1. **Header**: month selector (last 12), total this month (projected month-end, month to date in smaller text), budget bar (green < 80 %, amber 80–100 %, red > 100 %).
2. **KPI row**: Total (EUR), MAU, cost per MAU, DAU/MAU.
3. **By vendor** table: vendor, source (Fly API / manual / yearly ÷ 12 / one-off), this month, last month, change. Fly row expands to per-app rates (thirstr-api-prod, thirstr-db-prod, …).
4. **6-month history**: stacked bars per vendor + cost-per-MAU line.
5. **Cost items**: list of manual items (vendor, amount, cadence, from–to) with Edit / End; form to add (vendor, label, amount EUR, cadence, start month, note).
6. **Capacity forecast** (below).
7. **Settings**: budget EUR, alert email, USD→EUR, Fly prices, capacity inputs. Saving needs a reason (R-AD.12).

### Budget alert email (R-AD.14)
- Same daily job, after the snapshot: if `budget_eur` > 0 and projected month-end ≥ 80 % (then ≥ 100 %) of it and no `cost_alerts` row for (month, threshold), send one email via `Thirstr.Mailer` (Amazon SES) to `alert_email` (default `COST_ALERT_EMAIL`, else `hello@thirstr.fun`), then insert the row.
- Content: subject "Thirstr costs: <projected> of <budget> budget (<pct> %)"; body = projected, month to date, top 3 vendors, cost per MAU, link to `/admin/costs`. No user data.
- Staging: same code, its own budget (off by default).

### Capacity forecast (R-AD.15, from SR-12 #152)
Inputs (settings): peak concurrent users one API machine holds within SLO (from the SR-12 run log; "unmeasured" badge until a run date is entered, planning default 500 for `shared-cpu-1x` 512 MB), headroom ×2 (capacity.md), peak concurrent = 10 % of DAU, DB volume size (Fly API), monthly MAU growth (measured from `usage_daily` over 30 days, manual override allowed).
Outputs, as a table for now, +3, +6, +12 months and the 10k / 100k / 1M milestones:
- MAU, DAU, peak concurrent; API machines needed = ⌈peak × 2 / per-machine⌉ vs machines running now.
- DB size = bytes per MAU now × MAU, vs volume size.
- Monthly cost = Fly cost per machine now × machines needed + manual items scaled by MAU (fixed items stay fixed: Apple, Google, domain).
- **Runway** line: "Current sizing holds until ≈ <MAU> (<month>)" from the first limit hit (API or DB disk), red when < 3 months.
- Growth 0 or negative → "no growth, sizing holds"; < 14 days of history → uses the manual growth.

### Rules & acceptance
- R-AD.13 Fly token is read-only and only in `FLY_COST_TOKEN`; never logged, never on the page.
- R-AD.14 At most one alert email per threshold per month.
- R-AD.15 Every forecast number shows its inputs on hover/tap and whether they are measured or assumed.
- AC-AD.5 Monthly total = Σ manual items (cadence rules) + Fly month to date, checked by a unit test with fixed data.
- AC-AD.6 Alert sent once at 80 % and once at 100 %, not again the same month (automated).
- AC-AD.7 Cost page and alert contain no account id, email (other than the alert recipient), IP or location (contract test).
