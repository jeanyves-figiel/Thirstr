# W-01 Public website (marketing site)

Issue #40. Owner (2026-11-17): visitors to the web domain see a small marketing site, not the app. The app is native only (iOS/Android); the web client stays **Later** (README) and is no longer served on any public host.

## Hosts & routing
| Host | `/` and site paths | `/v1`, `/socket`, `/.well-known` |
|---|---|---|
| `thirstr.fun` (canonical) | site | API (same release) |
| `www.thirstr.fun` | 301 → `https://thirstr.fun` + same path and query | 301 likewise |
| `api.thirstr.fun`, `staging.thirstr.fun`, `*.fly.dev` | site with `X-Robots-Tag: noindex` (preview / fallback) | API |
| DEV `https://localhost:7446` | site served by local Phoenix (`noindex`) | API |

- R-W.1 Served by the Phoenix release (plug `ThirstrWeb.Plugs.Site`) from `priv/static/site`, built at image build from `web/site/`. No separate hosting, no CDN, no third-party origin.
- R-W.2 `thirstr.fun` + `www.thirstr.fun` point at Fly app `thirstr-api-prod` (Fly certs; GoDaddy apex A + AAAA, `www` CNAME → `thirstr.fun`, `_acme-challenge.*` CNAMEs). Runbook `docs/runbooks/fly.md` › Domain.
- R-W.3 Unknown path on a site request → `404.html` with status 404 (language from path prefix). `HEAD` same as `GET` without body.
- R-W.4 Only `GET`/`HEAD` reach the site. Other methods on non-API paths fall through to the router (404).
- R-W.5 Expo web client: removed from the release image and from staging (`SERVE_WEB_CLIENT` dropped). DEV keeps the Expo web build at `https://localhost:7443` as a developer tool only.

## Pages
| Path (en) | fr | de | Content |
|---|---|---|---|
| `/` | `/fr/` | `/de/` | home |
| `/privacy/` | `/fr/privacy/` | `/de/privacy/` | privacy summary (plain language; full policy by counsel before store submission) |
| `/legal/` | `/fr/legal/` | `/de/legal/` | legal notice / Impressum (#62): operator name, postal address, country, contact email, UID if any, person responsible, liability + consumer-dispute notes. Operator data in `web/site/legal.json`; page and footer link are built only when that file exists |
| `404.html` | — | — | not found (trilingual) |

Home sections, in order:
1. Header: Pop wordmark (`thirstr` + coral `r` + three dots, design-system.md › Logo), language switch EN/FR/DE.
2. Hero: headline "Hookups first. Privacy always.", subline (map-first, free, you decide who sees what), store pills "App Store · soon" / "Google Play · soon" (not links; no Apple/Google badge artwork until listed), note "Invite-only beta in Zurich, Berlin and Paris".
3. Three modes: Hookup (coral), Friends (violet), Sport (lime, safe for work), one line each from the concept.
4. Location (teal): the four levels Hidden / City / Area (default, ~200 m) / Exact (opt-in, expires).
5. Privacy promises (teal): no ads, no ad IDs, no selling data; E2EE chats and private albums; photos checked by AI, not browsed by staff; delete = gone immediately; real people only (anti-bot).
6. Free: fully usable for free, no paywalled basics.
7. For every man: cis, trans, non-binary; 18+ only.
8. Contact: `hello@thirstr.fun` (mailto; forwarded by ImprovMX to the owner's inbox, #62). Footer: © year Thirstr, Privacy, Legal notice, email, "18+".

Copy rules: claims only from concept/spec; no competitor names; en/fr/de written per language (not machine-literal), strings in `web/site/strings/<lang>.json`.

## Privacy & security
- R-W.6 Zero third-party requests: fonts self-hosted (Bricolage Grotesque 400/800 latin, OFL), no analytics, no cookies, no storage, no external scripts. The site ships no JavaScript.
- R-W.7 Response headers on site responses: `Content-Security-Policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Permissions-Policy: interest-cohort=()`, `Strict-Transport-Security: max-age=31536000`. HTML `Cache-Control: public, max-age=300`; fonts/CSS `max-age=86400`.
- R-W.8 No user data, profile or count is shown on the site (A9: no public web profiles).

## Build
- `web/site/build.mjs` (Node ≥ 20, no dependencies): `template.html` + `privacy.html` + `strings/*.json` → `web/site/dist/`. Release Dockerfile runs it in the `site` stage and copies `dist` to `priv/static/site`. DEV compose service `site` runs it; `server/priv/static/site` is mounted.
- Tests: `test/thirstr_web/plugs/site_test.exs` (www redirect, noindex on non-canonical host, 404 page, API paths untouched, non-GET passthrough). CI builds the site (`node web/site/build.mjs`) in the mobile job.

## Acceptance
- AC-W.1 `https://staging.thirstr.fun/` shows the site (not the app), `noindex`, smoke still green.
- AC-W.2 After promotion (owner OK) + DNS: `https://thirstr.fun/` 200 site, `https://www.thirstr.fun/x` 301 → `https://thirstr.fun/x`, `https://api.thirstr.fun/v1/health` 200.
- AC-W.3 Lighthouse a11y ≥ 95; page weight < 150 KB incl. fonts; renders at 360 px with no horizontal scroll.
