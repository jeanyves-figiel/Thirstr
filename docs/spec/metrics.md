# Privacy-preserving metrics

Goal: know if the product works without tracking anyone. No analytics SDKs (I-03 Forbidden). Owner: product + security review.

## Principles
- R-MX.1 Server-side aggregates only; no per-user event streams, no user/device ids in metrics.
- R-MX.2 Client-reported metrics use local differential privacy (randomized response / RAPPOR-style) or are aggregated in buckets; opt-out in Settings (F-17), default on except Safe Mode (off, not changeable).
- R-MX.3 Counts below 20 are suppressed in dashboards; geography no finer than country, and country hidden for Safe Mode jurisdictions.
- R-MX.4 Raw counters retained 90 d; aggregates retained 2 y.
- R-MX.5 Crash reports: self-hosted Sentry-compatible, scrubbed (no message text, no location, no ids beyond random per-install id rotated every 30 d).

## Product KPIs (beta)
| KPI | Definition | Source |
|---|---|---|
| Activation | % new accounts completing onboarding within 24 h | server counters (account created, onboarding done) |
| Onboarding time | p50/p90 seconds S-01→S-06 | client, bucketed (10 s bins), LDP |
| Verification rate | % active accounts verified | server |
| Weekly active | distinct accounts with ≥ 1 session in 7 d, via HyperLogLog sketch reset weekly | server (HLL, no ids stored) |
| Retention D1/D7/D30 | cohort ratios from HLL intersections per signup week | server |
| First message | % new accounts sending a message within 7 d | server counter at first-send flag |
| Reply rate | % first messages that get a reply in 48 h | server counters (MLS DS sees envelopes, not content) |
| Meet signal | "Met?" optional in-chat prompt answer (yes/no), LDP | client |
| Density | median visible profiles in user's Area (k-anon buckets) | server aggregate per city |
| Tonight / Party use | plans posted, party requests, acceptance | server counters |
| Safety | reports per 1k actives, time to action, check-ins started/escalated | server |
| Bots | quarantine entries, false-positive releases | server |
| Performance | app start, grid load, message send latency p50/p95 | client, bucketed |

## Guardrail metrics
- Block/report rate per 1k messages; unsolicited-link rate; churn reasons (optional exit survey, free text stays on device unless sent).
- Privacy: PII grep findings (must be 0), push payload size/content check (must be content-free).

## Implementation
- Counters: Telemetry → Prometheus (OpenTelemetry) with fixed label sets (no ids). HLL sketches in Postgres (`postgresql-hll`).
- Client: `/core` exposes `metric_record(name, bucket)`; batched daily, LDP applied on device, sent over attested channel without account token.
- Dashboards: Grafana, EU; access `admin`/`product` roles only.

## Acceptance
- AC-MX.1 No metrics label or payload contains account id, device id, IP, coordinates, or H3 cell finer than res 5 (automated lint + privacy grep).
- AC-MX.2 Safe Mode clients send zero client metrics (automated).
- AC-MX.3 Dashboard suppression for n < 20 enforced in query layer (automated).
