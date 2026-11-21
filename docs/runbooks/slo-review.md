# Runbook: weekly SLO review (EN-04, #163)

Spec and budget policy: [`docs/spec/slos.md`](../spec/slos.md). Report: workflow `slo-report.yml` (Mondays 07:00 UTC, or run by hand) → comment on the open issue labelled `slo` ("SLO weekly review"). Script `scripts/ops/slo-report.sh` (read-only Prometheus queries).

## Each Monday (10 min)
1. Read the comment. For each SLO: 28-day budget left → policy (> 50 % normal · 0–50 % risky changes wait · < 0 fixes only).
2. Compare with last week: a budget that dropped > 20 points needs a cause (incident, release, traffic). Link it in a reply.
3. Burn-rate alerts that fired this week (Grafana › Alerting history): real or noise? Noise → adjust the rule in `monitoring.md` with a reason.
4. Incidents of the week (status page): post-mortem done if > 20 % of a budget burned (`docs/incidents/`)?
5. Reply on the issue with the decisions (or "nothing to do").

## Notes
- Closed beta: testers use **staging** (TestFlight points there), prod sees only probes. Both apps are in the report until the store build points at prod.
- Low traffic makes ratios jumpy: read them with the request count.
- `le="300"` latency bucket exists from 2026-11-21 (#163); older windows fall back to `le="250"` (stricter).
