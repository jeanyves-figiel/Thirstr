# Runbook: costs & capacity (EN-21, #180)

Console page A-11 `/admin/costs` (admin-console.md › Costs & capacity). Daily job `Thirstr.Jobs.CostSnapshot` at 02:10 UTC: usage counts → Fly run-rate → budget alert.

## Fly read-only token (optional, R-AD.13)
Without it the Fly row is empty; add Fly as a manual item instead.
1. Create a read-only org token: `fly tokens create readonly thirstr` (or Dashboard › Tokens › Read-only org token). Never use the deploy token.
2. Set it on the API app only: `fly secrets set FLY_COST_TOKEN=<token> -a thirstr-api-prod` (staging: `-a thirstr-api-staging`).
3. Check next day on `/admin/costs` ("Fly API, updated …"), or run now: `bin/thirstr rpc 'Thirstr.Jobs.CostSnapshot.perform(nil)'`.

Env: `FLY_ORG` (default `thirstr`, the org staging and prod run in since 2026-11-22), `FLY_APP_NAME` (set by Fly; the DB app is the same name with `-db-`), `COST_ALERT_EMAIL` (default `hello@thirstr.fun`).

## Automatic vendors (R-AD.18, #326)
- **Amazon SES**: counted as emails are sent (per recipient, $0.10 / 1000). Only where `SES_REGION` is set. Nothing to configure.
- **Tigris**: bucket size measured by the daily job ($0.02 / GB per 30 days, storage only).
- Typing in an item named exactly `Amazon SES` or `Tigris` replaces the estimate with your invoice figure.
- Prices: `metered_prices` in `cost_settings` (defaults in `Thirstr.Costs`).

## Preset and manual cost items
The daily job adds Apple Developer (€99/yr), Google Play (€23 once) and Domain thirstr.fun (€30/yr, estimate) once. Edit them to your invoices; ending or deleting one is permanent. Type in anything else (ImprovMX if paid, …). Amounts in EUR. Ending an item keeps past months right; never delete. Run now instead of waiting for 02:10 UTC: `bin/thirstr rpc 'Thirstr.Jobs.CostSnapshot.perform(nil)'`.

## Budget alert
Set the monthly budget (EUR) in the page settings; 0 = off. One email at 80 % and one at 100 % of the projected month-end, per month (table `cost_alerts`). Sent through `Thirstr.Mailer` (Amazon SES).

## Capacity inputs
After each SR-12 load run (capacity.md), enter "users per API machine" and the run date: the forecast drops its "unmeasured" badge.
