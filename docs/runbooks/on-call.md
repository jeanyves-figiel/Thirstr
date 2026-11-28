# Runbook: on-call (EN-06, #165)

## Who
| Period | Rotation | Pager |
|---|---|---|
| Closed beta (now) | **Solo**: owner (Jean-Yves), 24/7 for SEV1, waking hours for SEV2 | Pushover on his phone |
| Open beta (#181) | Weekly rotation owner ↔ engineer, handover Monday 09:00 Zurich | Pushover delivery group; escalation key = the other person |

No SMS: Pushover emergency pushes repeat every 2 min until acknowledged and bypass Do Not Disturb, which covers what SMS was for, at €0/month.

## How it works
- `.github/workflows/oncall.yml` runs every 5 min on GitHub (outside Fly, so it still pages when Fly is down) and runs `scripts/ops/oncall.py`.
- Rules: `infra/alerts/rules.json` (Fly Prometheus queries on prod, HTTPS health probe, TLS expiry). Each rule has a section in `docs/runbooks/alerts.md`; every push links to it. CI fails without one.
- Severity → push:

| Sev | Push | Repeats | Escalation |
|---|---|---|---|
| 1 | Emergency (priority 2): sound until **Acknowledge**, bypasses quiet hours, 2 min retries for 1 h | again after 1 h while still firing | not acknowledged in 15 min → `PUSHOVER_ESCALATION_KEY` (if set) |
| 2 | Normal (priority 0), respects Pushover quiet hours | every 4 h while firing | none |
| 3 | No push, job summary only | | |
| resolved | Quiet (priority −1) | | emergency retries are cancelled |

- State (what is firing, since when, receipts) lives in a small Actions cache entry, saved only when it changes. Lost cache = at most one duplicate push.
- Quiet push **"on-call connected"** the first time keys work, then **"weekly check"** every Monday ~07:00 UTC: if it doesn't arrive, the pipe is broken.
- GitHub emails the owner when the workflow itself fails (second channel).
- Limits: GitHub cron can start a few minutes late, so real time to page is ~5 to 15 min plus the rule's duration. Staging is never paged. Backup freshness is not paged yet (#276).

## Setup (owner, once)
1. Buy Pushover for iOS (one-off ~€5) and sign in. Copy the **User Key** from the app's home.
2. pushover.net › Create an Application: name `Thirstr on-call`, icon optional. Copy its **API Token**.
3. In the app: Settings › Quiet Hours 23:00 to 07:00 (SEV2 waits, SEV1 still rings). Allow Critical Alerts when asked (iOS), so emergencies sound in silent mode.
4. GitHub › repo Settings › Secrets and variables › Actions › **Repository secrets** (not an environment):
   - `PUSHOVER_USER_KEY` = User Key
   - `PUSHOVER_APP_TOKEN` = API Token
   - `FLY_METRICS_TOKEN` (repo secret) = read-only Fly token (`fly tokens create readonly -o thirstr`). Required since the org move (#168): app deploy tokens cannot read org metrics, so on-call, the SLO report and the canary's metric gates need it.
5. Actions › **On-call alerts** › Run workflow › tick *Send a test push*. Expect "Thirstr on-call test" and "Thirstr on-call connected" within a minute.

6. **Chat probe (EN-23 OB-2)**: one random key per environment (`openssl rand -hex 32`), set on the API app **and** as a repo secret:
   - `fly secrets set --stage PROBE_KEY=<staging key> -a thirstr-api-staging` and repo secret `PROBE_KEY_STAGING`
   - `fly secrets set --stage PROBE_KEY=<prod key> -a thirstr-api-prod` and repo secret `PROBE_KEY_PROD` (takes effect with the next promote)
   The two probe accounts are created on the first run. Without the keys the probe rules show "not run".

Never paste the keys in issues, chats or commits. Rotate: Pushover › app › regenerate token, then update the secret.

## Responding
1. Acknowledge the push (stops the retries; with a second person, stops escalation).
2. Tap the runbook link. If users are affected: `docs/runbooks/incident-response.md` (open the `incident` issue, severity, comms).
3. Fixed → the alert resolves on its own within 5 min (quiet push).
4. Noisy or wrong alert → fix the rule in `infra/alerts/rules.json` in a PR; don't just ignore it.

## Handover (from open beta)
Monday 09:00 Zurich, 10 min, written in the week's handover issue (label `on-call`):
- Alerts that fired, what was done, anything still open.
- Changes going out this week (risky migrations, flags to flip).
- Snoozed or known-noisy rules, with their issue.
- Confirm the incoming person got last week's "weekly check" push and has prod access (`docs/team/onboarding.md`).

## Adding the second person
1. On-board them (`docs/team/onboarding.md`), including Pushover.
2. Pushover › Groups › create `Thirstr on-call`, add both users; put the **group key** in `PUSHOVER_USER_KEY` (whole group gets SEV pushes) or keep one person per week and set the other as `PUSHOVER_ESCALATION_KEY`.
3. Start the weekly handover above.
