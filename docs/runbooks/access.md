# Runbook: access, tokens, rotation, break-glass (EN-09, #168)

Decision 2026-11-21 (owner): no KMS for now, budget €0. Master keys (`ID_PEPPER`, backup cipher keys) stay in Fly secrets; EU KMS (Scaleway Key Manager or AWS KMS `eu-central-2`) is revisited before open beta.

Goals: one human with full access, protected by 2FA; machines only get what one job needs, for a limited time; every credential has an owner, a place, an expiry and a rotation date; a tested way back in when the normal path is lost.

## 1. Accounts (humans)

| System | Account | Role | 2FA | Notes |
|---|---|---|---|---|
| Fly.io | owner | admin of org `thirstr` (after the move, `fly-org-move.md`) | **required**: TOTP app or passkey | `personal` org keeps only non-Thirstr apps and the Tigris buckets until they are moved |
| GitHub | `jeanyves-figiel` | repo owner | required (GitHub enforces it) | environments `staging`, `production` |
| Apple Developer / App Store Connect | owner | Account Holder | Apple ID 2FA (always on) | team `U7VAR53G86` |
| Google Cloud / Play Console | owner | owner | Google 2-Step | Play Integrity, FCM, Google sign-in |
| AWS (SES) | owner root + IAM | root locked away, daily use by IAM | root: hardware/passkey MFA | SES `eu-central-2`, `docs/runbooks/email.md` |
| GoDaddy | owner | registrar + DNS for `thirstr.fun` | required | domain lock on |
| ImprovMX | owner | mail forwarding `hello@` | required | |
| Expo | `eternael` | not used for builds | on | can be closed |

Rule: no shared logins. A second person gets their own account with the smallest role, and appears in the quarterly review (§5).

## 2. Machine credentials (least privilege)

| Credential | Where | Scope | Expiry | Rotate |
|---|---|---|---|---|
| `FLY_TOKEN` in GitHub env **staging** | GitHub › Environments › staging | Fly **deploy tokens** for `thirstr-{api,db,valkey,bot,classifier}-staging` only, joined in one value | 90 days | quarterly, `scripts/ops/fly-ci-tokens.sh staging` |
| `FLY_TOKEN` in GitHub env **production** | GitHub › Environments › production | deploy tokens for `thirstr-{api,db,valkey,classifier}-prod` only | 90 days | quarterly, `scripts/ops/fly-ci-tokens.sh production` |
| Repo-level `FLY_TOKEN` | GitHub › Secrets › Actions | **delete** once the two above exist (the script does it) | | |
| `FLY_TOKEN_EXPIRES_STAGING` / `_PRODUCTION` | GitHub › Variables (not secret) | expiry date of the above, `YYYY-MM-DD` | | written by the script; `nightly.yml` fails 14 days before |
| Claude cloud environment `FLY_TOKEN` | claude.ai › environment settings | today: the owner's org-wide token for `personal` (reaches non-Thirstr apps too). After the move: `fly tokens create org -o thirstr --expiry 720h` | 30 days | monthly |
| `ASC_KEY_ID` / `ASC_KEY_P8` | GitHub secrets | App Store Connect API key "Thirstr CI Admin" (Admin is required for cloud signing) | none (Apple) | yearly, or at once if leaked: revoke in ASC › Users and Access › Integrations |
| `PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON` | Fly secret on `thirstr-api-<env>` | Google service account with no project roles; Play Integrity API only | key: yearly | Google Cloud › IAM › Service accounts › Keys |
| `FCM_SERVICE_ACCOUNT_JSON` | Fly secret | Firebase Cloud Messaging sender only | yearly | same |
| `APNS_KEY_P8` | Fly secret | APNs auth key | yearly | Apple Developer › Keys |
| SES IAM user keys | Fly secret | `ses:SendEmail`/`SendRawEmail` as `hello@thirstr.fun` only | 90 days | `docs/runbooks/email.md` |
| Tigris keys (`S3_*`, `PGBACKREST_REPO1_S3_KEY*`) | Fly secrets | one bucket each | yearly | create new key → set secret → restart → delete old |
| `SECRET_KEY_BASE`, `VALKEY_PASSWORD`, `POSTGRES_PASSWORD`, `CLASSIFIER_TOKEN`, `TESTBOT_KEY` | Fly secrets | one app pair | yearly | set on both apps in one change, restart both (`fly.md` › Secrets) |
| `ID_PEPPER` | Fly secret, copy in owner's password manager | master key | **never rotated in place** (rotation = rehash all identifiers, planned with KMS) | |
| Backup cipher keys `PGBACKREST_REPO1_CIPHER_PASS` | Fly secret, copy in password manager (#158) | master key | with a new backup repo only | `db-backups.md` |

What a Fly deploy token can and cannot do (tested 2026-11-21 on staging with 1-hour tokens):
- Machines API and `fly ssh console` for **its own app only** (`403 Not authorized to manage this app` for any other app).
- Several deploy tokens joined with `,` in one `FLY_API_TOKEN` work together; that is how one GitHub environment covers its 4–5 apps.
- The Fly registry (`registry.fly.io`) is **per org, not per app**: any deploy token can pull and push images of every app in the org. So prod can deploy the staging image by digest with a prod-only token, and so non-Thirstr apps must not share Thirstr's org (one more reason for the move). Prod only runs a digest that the promote job checked is live on staging.
- No GraphQL access to other apps' secrets.

Never: the all-powerful `fly auth token` in CI; tokens in git, chat, issues or logs; one token for both environments.

## 3. Rotation schedule

| When | What |
|---|---|
| Every quarter (Jan, Apr, Jul, Oct, first week), with §5 | Fly CI tokens (both envs), SES IAM keys; check expiry dates in §2 |
| Monthly | Claude environment Fly token |
| Yearly (November) | ASC key, APNs key, Google service-account keys, Tigris keys, app-pair secrets |
| At once | anything a person who left could know; anything that appeared in a log, screenshot, chat or commit; after any break-glass use (§4) |

How to rotate a Fly CI token: `scripts/ops/fly-ci-tokens.sh <staging|production>` on the owner's laptop (needs `flyctl` logged in and `gh` logged in). It mints fresh deploy tokens with `--expiry 2160h`, writes the GitHub environment secret and the expiry variable, and prints the old token ids. Then run **Deploy staging** (manual dispatch) to prove the staging token, and revoke the old ones: `fly tokens list -a <app>` → `fly tokens revoke <id>`. For production, prove it with the next promotion (never a promotion just for the test).

## 4. Break-glass

When: owner locked out of Fly or GitHub, phone lost, 2FA device broken, or an incident needs access faster than the normal path.

Prepared once (owner):
1. Fly and GitHub **recovery codes** printed, in a sealed envelope at home, plus a copy in the password manager's secure notes. A second 2FA factor (passkey on another device or a hardware key) registered on Fly, GitHub, Apple, Google, AWS root, GoDaddy.
2. A **break-glass Fly token**: `fly tokens create org -o thirstr --name break-glass --expiry 8760h`, stored only in the password manager (never in GitHub, Fly or the Claude environment). It is the way to deploy, roll back or scale if both the dashboard login and CI are unavailable.
3. Password-manager emergency access for one trusted person (read-only, with waiting period), so the business survives the owner being unreachable. Optional, owner's call.

Use:
1. Write in the incident channel (`docs/runbooks/incident-response.md`) what you are about to do and why.
2. Use the break-glass token from a trusted laptop: `FLY_API_TOKEN=… fly …`. Do only what the incident needs.
3. Afterwards, same day: revoke and recreate the break-glass token (`fly tokens list --scope org` → `fly tokens revoke`), rotate every secret it could have read, and note the use in the next access review.

Test: once a year, with the quarterly review in October, run `fly status -a thirstr-api-staging` with the break-glass token, then rotate it.

## 5. Quarterly access review (first week of Jan, Apr, Jul, Oct; 30 minutes)

Open a GitHub issue "Access review YYYY-Qn" with this list and tick it:
- [ ] Fly: org `thirstr` members = owner only (or the people agreed); 2FA on for each. `fly tokens list --scope org` and per app: delete anything unknown or unused.
- [ ] GitHub: collaborators, deploy keys, installed GitHub Apps, fine-grained tokens, environment secrets; `production` environment protection rules as decided.
- [ ] App Store Connect users + API keys; Google Cloud IAM members + service-account keys; Play Console users; AWS IAM users, keys > 90 days; GoDaddy and ImprovMX delegates.
- [ ] Claude cloud environment: which secrets it holds, which repos and connectors it can reach.
- [ ] Rotate what §3 says is due; update the expiry variables; record new dates here.
- [ ] Break-glass: envelope intact, token still valid, last test date.
- [ ] Admin console allow-list `ADMIN_ACCOUNT_IDS` = owner only.
- [ ] Close the issue with a one-line summary (this is the evidence for EN-10).

## 6. Admin console access (R-AD.12, R-AD.16)

Per environment (`thirstr-api-staging`, `thirstr-api-prod`), once:
1. Find your account id (Apple/Google sign-in; for email use `Thirstr.Ids.hash(~s(email), ~s(<email>))` against `email_hash`):
   `fly ssh console -a <app> -C "sh -c '/app/bin/thirstr rpc \"Thirstr.Repo.query!(~s(select a.id::text, p.display_name, a.inserted_at::text from accounts a left join profiles p on p.account_id = a.id where a.auth_oidc_hash is not null order by a.inserted_at limit 10)).rows |> IO.inspect()\"'"`
2. `fly secrets set ADMIN_ACCOUNT_IDS=<id> -a <app>` (empty = console 404).
3. Enrolment link (10 min, single use): `fly ssh console -a <app> -C "sh -c '/app/bin/thirstr rpc \"Thirstr.AdminEnrol.link(~s(<id>)) |> IO.puts()\"'"`
4. Open the link on the Mac, "Create console passkey" (iCloud Keychain or security key). You land on `/admin`. Afterwards sign in at `/admin/login`.
