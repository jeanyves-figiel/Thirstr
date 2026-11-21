# Runbook: status page status.thirstr.fun (EN-04, #163)

Spec: [`docs/spec/slos.md`](../spec/slos.md) › 6. Workflow `.github/workflows/status.yml`. Source `status/`. Data branch `status-data`.

## How it works
- Every 5 min a GitHub Actions run probes prod from outside Fly (`status/probe.mjs`): sign-in (`POST /v1/auth/refresh` with a dummy token → 401), chat (`/v1/health` + WebSocket handshake; 403 for an anonymous connect counts as up), Explore (`/v1/welcome`), photo storage (Tigris front door), website. Notifications come from Fly Prometheus when the optional repo secret `FLY_PROM_TOKEN` (read-only token) exists; otherwise that row is hidden.
- Two failed checks in a row → component red, and (unless repo variable `STATUS_AUTO_INCIDENT=0`) an `incident` issue is opened automatically.
- History (`daily.json`, `state.json`) and the page data (`status.json`, `feed.xml`) are committed to `status-data`, never to `main`, so the page never redeploys staging or resets the prod promotion window.
- The page is plain HTML/JS, fonts from `web/site/fonts`, no cookies, no third-party requests.
- GitHub cron can run late (5–15 min) under load; the page says "Status unknown" if the last check is older than 30 min.

## One-time setup (owner)
1. GoDaddy DNS: `status` CNAME `jeanyves-figiel.github.io` (TTL 1 h).
2. GitHub › repo Settings › Pages: Source **GitHub Actions**; Custom domain `status.thirstr.fun`; tick **Enforce HTTPS** once the certificate is ready (a few minutes).
3. GitHub › Settings › Secrets and variables › Actions › Variables: `STATUS_PAGE` = `on` (until then probes and history run, but nothing is published).
4. Optional: `fly tokens create readonly personal` → repo secret `FLY_PROM_TOKEN` (shows Notifications and the message / map speed tiles).
5. Run "Status page" once by hand (Actions › Status page › Run workflow): creates the labels.

## Post an incident
1. New issue, title = what people notice ("Messages delivered late"), labels `incident`, `investigating`, `sev-N`, one `affects:<component>` per part (`sign`, `chat`, `explore`, `media`, `push`, `site`). The issue body is **not** shown: keep internal notes there.
2. Each public update = a comment starting with `Update:`; optionally a new state first: `Update: identified: A database server failed; switching to the backup.` Swap the state label too (`identified`, `monitoring`).
3. Resolved = close the issue (last update = what happened and what people need to do, usually nothing).
4. Only collaborators' comments are shown; anyone else's comment is ignored.
5. Wording: plain, what users notice, no blame, no internal names. Templates in `incident-response.md`.

## Planned maintenance
Issue with label `maintenance` + `affects:…`, first body line `When: 2026-11-23T02:00Z/2026-11-23T02:15Z`. Shown as "Planned" until the window, "Maintenance in progress" during it (red checks inside the window count as maintenance, not outage). Close it afterwards.

## Checks
- Last runs: Actions › Status page. Data: `https://raw.githubusercontent.com/jeanyves-figiel/Thirstr/status-data/status.json`.
- False red (prober side, e.g. GitHub network): close the auto-opened issue with a comment `Update: false alarm from our checker; Thirstr was working.`, or set `STATUS_AUTO_INCIDENT=0` while investigating the prober.
