# Runbook: costs & capacity (EN-21, #180)

Console page A-11 `/admin/costs` (admin-console.md › Costs & capacity). Daily job `Thirstr.Jobs.CostSnapshot` at 02:10 UTC: usage counts → Fly run-rate → budget alert.

## Fly read-only token (optional, R-AD.13)
Without it the Fly row is empty; add Fly as a manual item instead.
1. Create a read-only org token: `fly tokens create readonly personal` (or Dashboard › Tokens › Read-only org token). Never use the deploy token.
2. Set it on the API app only: `fly secrets set FLY_COST_TOKEN=<token> -a thirstr-api-prod` (staging: `-a thirstr-api-staging`).
3. Check next day on `/admin/costs` ("Fly API, updated …"), or run now: `bin/thirstr rpc 'Thirstr.Jobs.CostSnapshot.perform(nil)'`.

Env: `FLY_ORG` (default `personal`), `FLY_APP_NAME` (set by Fly; the DB app is the same name with `-db-`), `COST_ALERT_EMAIL` (default `hello@thirstr.fun`).

## Manual cost items
Type in what has no API: Tigris, Amazon SES, Apple Developer (yearly), Google Play (once), GoDaddy domain (yearly), ImprovMX. Amounts in EUR. Ending an item keeps past months right; never delete.

## Budget alert
Set the monthly budget (EUR) in the page settings; 0 = off. One email at 80 % and one at 100 % of the projected month-end, per month (table `cost_alerts`). Sent through `Thirstr.Mailer` (Amazon SES).

## Capacity inputs
After each SR-12 load run (capacity.md), enter "users per API machine" and the run date: the forecast drops its "unmeasured" badge.
