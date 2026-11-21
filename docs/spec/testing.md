# Test strategy

## Levels
| Level | Tooling | Scope | Gate |
|---|---|---|---|
| Unit | ExUnit, cargo test, Jest | rules R-xx logic | PR |
| Integration | ExUnit + Testcontainers (Postgres+h3, Valkey) | API endpoints, channels | PR |
| Contract | OpenAPI schema from api.md, generated client tests | app ↔ server | PR |
| E2E mobile | Maestro on Android emulators + iOS simulator (device matrix below) | onboarding, explore, chat offline→online, check-in | nightly + manual |
| Crypto | OpenMLS interop vectors, property tests | MLS, media keys, blind signatures | PR |
| Abuse | custom harnesses | trilateration (AC-05.1), scraping (A9), quarantine (AC-15.1), Safe Mode leaks | nightly + pre-promote |
| Chaos | `scripts/chaos/chaos.sh` (staging only, below) | machine kill, Valkey/DB down, disk full | monthly game day |
| Load | k6 | 100k concurrent sockets, 5k grid req/s, 20k msg/s per cluster | pre-milestone |
| Privacy | log/payload grep for PII, push payload inspection | AC-07.1, AC-16.1 | nightly |
| Accessibility | axe/RN a11y lint + manual VoiceOver/TalkBack | all screens | milestone |
| Usability | moderated sessions n=10 per milestone | onboarding < 60 s, 3-tap message | milestone |

## Traceability
- Each AC-xx maps to ≥ 1 automated test tagged `@ac AC-xx.n`; CI report lists AC coverage per spec.
- Untestable ACs flagged in spec with "manual".

## Test data
- Seed generator: 5k fake profiles across 3 cities with realistic cell density, no real photos (generated avatars).
- Never use production data in DEV/staging.

## Chat test bots (staging only, #109, #200)
Simulated users so testers can try chat, photos, albums, location modes, plans and parties end to end from the TestFlight build.
- **Who** (`apps/testbot/src/personas.ts`): every bot has 🤖 in its name, a bio that starts with "TEST ACCOUNT" (enforced by the server) and generated abstract photos labelled "TEST BOT n" (no real people). All verified. Accounts carry `accounts.test_bot` + a unique `test_bot_handle`; max 12.

| Bot | Lang | Shows | Location | Tests |
|---|---|---|---|---|
| Testbot | de | all lenses | Area, Altstetten (server-kept, seeded) | receipts, typing, translation commands, Now |
| Luca | it | Hookup | Exact pin near Altstetten station (4 h, renewed) | 5 public photos, private album "Notte" (4), photos and view-once photos in chat, Now "hosting" |
| Tiago | pt | Friends + Hookup | City (Lisbon) | trip to Zurich (F-20): shows as Visiting, from Lisbon, for 7 days, re-planned when it ends |
| Jonas | de | Sport + Friends | Area, Letzigrund | gym activity in 2 h; group chat with everyone who joins |
| Rémi | fr | Hookup | Area, Altstetten | hosts a party, accepts every request, runs the guest group chat |
| Kenji | ja | Hookup + Friends | Area, Hardbrücke | non-binary; read receipts off (you only see Sent); Tonight plan (drinks first), re-posted when it expires |
| Ghost | en | Hookup | Hidden (never on Explore) | writes first, once, to anyone who chatted with another bot |

- **E2EE**: each bot is a normal chat client (`apps/testbot`, Node). It bundles the app's own `apps/mobile/src/chat/mls.ts` + `bytes.ts`, keeps MLS keys on a private Fly volume (one file per key) and only sends/receives ciphertext through `/mls/*`. Photos and album items in chat are encrypted on the bot with a fresh AES-GCM key per item (`/media/upload`), like the app. The server never sees plaintext.
- **Setup goes through the public API** like the app: `PUT /me/location` (+ `PUT /me/pin` for Exact), `POST /me/profiles/:id/photos` + check, `PUT /me/now`, `POST /tonight`, `POST /trips`, `POST /parties` + `…/requests/:pid/accept`, `POST /activities`, `POST /profiles/:id/tap` (taps back), `POST /me/profiles/:id/share`.
- **Session**: `POST /v1/testbot/session` with header `x-testbot-key` = `TESTBOT_KEY` and the persona (`handle`, `name`, `age`, `gender`, `here_for`, `show_in`, `fields`, `settings`, `seeded`, `server_location`). Creates/updates that bot, removes its earlier devices (their key packages and queued ciphertext go with them) and returns tokens + `profile_id`. With `new_session: false` it only applies the persona (bot restart: device, MLS state and chats kept). With `resume: true` (refresh token lost or rejected) it issues new tokens for the bot's latest device, un-revoking it, so its queue and chats survive (#208); the bot refreshes one at a time so parallel 401s never spend a refresh token twice. A 1:1 send rejected with 422 `to_device_id` (the person reinstalled) drops that group once and goes out on the newer one, as the app does (#206). Only whitelisted fields and settings are kept. 404 when `TESTBOT_KEY` is unset/short, the key is wrong, or `DEPLOY_ENV` is `prod`/`production`.
- **Chat behaviour**: Delivered, Read (~1 s, unless off for that bot), typing, then the reply in the bot's language. Commands (first word): `help`, `lang de|pt|fr|es|it|en|ja`, `mix`, `long`, `burst N` (≤ 10), `later N` (≤ 600 s), `quick`, `echo <text>`, `noread`, `read on|off`, `receipts on|off`, `status`, `photo`, `once` (view once), `album` / `revoke` (private album; Luca has one), `location` (live location 1 h), `link` (profile share link). The "Pics?" quick reply shares the album (or a photo). Group chats (party, activity): a short reply to each message. A message it can't decrypt for 10 min triggers the R-07.20 resync.
- **Run**: Fly app `thirstr-bot-staging` (fra, 512 MB, volume `botdata` at `/data`), all bots in one process (`BOTS=a,b` limits it), secret `TESTBOT_KEY` (same value on `thirstr-api-staging`). Deployed by `.github/workflows/testbot.yml` on main pushes touching the bots. No prod app exists, and the prod API refuses the endpoint.
- **Tests**: `apps/testbot` `npm test`: reply rules, and end to end with the built bots against a mock API and a second client (the app's MLS code): setup calls, Delivered/Read, language switch, quick reply `k`, photos / view-once / album the peer decrypts, live location, party request accepted and group chat answered. Server: `test/thirstr_web/test_bot_test.exs`.

## Device matrix (EN-16, #175)
Nightly (02:30 UTC) and on demand: `.github/workflows/device-matrix.yml`. No paid device farm (owner rule "no extra spend", 2026-11-21): GitHub-hosted runners only (free for this public repo). Real phones: Firebase Test Lab free tier (§ Real devices).

| Profile | Runs on | Stands for | CPU / RAM | Screen | Network | Backend |
|---|---|---|---|---|---|---|
| `android-low` | Android emulator, API 30 (Android 11), AOSP x86_64 | low-end Android (Android Go class, ~€100 phone) | 2 cores, 2 GB | 720×1280, 320 dpi | **3G** (`-netspeed umts -netdelay umts`: 384/384 kbit/s, ~200 ms) | hermetic DEV stack on the runner |
| `android-mid` | Android emulator, API 35 (Android 15), AOSP x86_64 | Pixel 6a class | 4 cores, 4 GB | 1080×2400, 420 dpi | full | hermetic DEV stack on the runner |
| `ios-old` | iOS simulator, smallest iPhone on the image (iPhone SE 3rd gen / iPhone 11 class), Release build | old iPhone | host Mac (no CPU limit possible) | 4.7″–6.1″ | **3G** via `dnctl`/`pfctl` dummynet on the runner (780 kbit/s down, 330 kbit/s up, 100 ms) | staging (read-only, signed out) |

- **Hermetic backend (Android)**: `docker compose` api + db + valkey + s3 + mailpit (`infra/e2e/compose.e2e.yml` on top of `docker-compose.yml`, `MIX_ENV=dev`), plus the chat test bot `Testbot 🤖` (`apps/testbot`, `BOTS=testbot`) on the runner. The app is a Release APK built with `EXPO_PUBLIC_ENV=dev` and `EXPO_PUBLIC_API_URL=http://10.0.2.2:4000` (emulator → runner), so "Continue with Google" signs in through the DEV issuer (no real account, no email). Cleartext HTTP is allowed in this E2E APK only (manifest patched in CI); TestFlight/store builds are untouched. Nothing touches staging or prod.
- **iOS** cannot run the Docker stack (no Docker on GitHub macOS runners) and has no test-only sign-in on staging, so it covers cold start, signed-out onboarding and the sign-in sheet over 3G against staging. Signed-in flows on iOS stay manual (TestFlight) until a staging E2E sign-in exists (#267).
- **Flows** (`apps/mobile/e2e/flows/`, Maestro YAML, `id:` = React Native `testID`):
  | Flow | Profiles | Checks |
  |---|---|---|
  | `launch.yaml` | all | cold start to the Welcome screen (`start`) |
  | `onboarding.yaml` | Android | Get started → Google (DEV issuer) → name, birthday, identity, here-for → Area location (pinned to Zurich Altstetten) → photo later → verify later → Done → Explore |
  | `explore.yaml` | Android | Explore map, grid sheet opens, Testbot 🤖 tile, profile opens |
  | `chat.yaml` | Android | Message Testbot → `echo` reply arrives; airplane mode on → send → offline banner → airplane mode off → message delivered and reply arrives (R-07 outbox) |
  | `checkin.yaml` | Android | chat menu › Date check-in sheet opens (safety contacts gate shown; a full started check-in needs a bot that accepts safety-contact invites, #266) |
  | `signin-sheet.yaml` | iOS | Get started → sign-in methods (Apple, passkey, Google) render |
- **Measured per profile** (written to the job summary and `metrics.json` artifact, compared with `apps/mobile/e2e/budgets.json`):
  | Metric | How | Budget |
  |---|---|---|
  | JS bundle (bytes) | `index.android.bundle` in the APK / `main.jsbundle` in the .app | enforced |
  | APK / .app size | file size | enforced |
  | Cold start to first frame (ms) | Android `am start -W` TotalTime | report |
  | Cold start to Welcome (ms) | launch → `start` visible (Maestro, includes ~1 s tool overhead) | report |
  | Memory after Explore (MB) | Android `dumpsys meminfo` TOTAL PSS; iOS host RSS of the simulator process | report |
  | Network bytes during the flows | Android `/proc/net/dev` delta (AOSP image, no Google services); iOS dummynet pipe counters | report |
  | Flow duration (s) | per flow | report |
- **Gate**: a failing flow or an enforced budget fails the run. "report" budgets print ⚠ when exceeded; they switch to enforced once 7 nightly runs give a baseline (EN-18 #177: "release blocked on regression"). Emulators on shared CI hosts are noisy, so timing budgets are ceilings for regressions, not the EN-18 targets on real phones.
- **Run by hand**: also runs on PRs that change the matrix (flows, scripts, budgets). Actions › Device matrix › Run workflow (input `profiles`: `all`, `android-low`, `android-mid`, `ios-old`). Locally with an emulator: `scripts/device-matrix/android.sh` (needs Docker, Android SDK, Maestro).

### Real devices (`android-real`)
Owner pick 2026-11-21: **Firebase Test Lab, free Spark tier** (no billing account, ≤ 5 physical-device runs a day; Google-hosted, not EU-only: the build has no user data and talks to staging only).
- Nightly job `android-real` (not on PRs, to keep the daily quota): Release APK (arm64) built for **staging**, signed out; **Robo** test (Test Lab crawls the app for 5 min) on the **most low-end physical phone** Test Lab offers (fewest screen pixels, then oldest Android ≥ API 24; `scripts/device-matrix/testlab-pick.py`; override with repo variable `TESTLAB_DEVICE`, e.g. `model=a10,version=29`).
- Metrics from the Tool Results API (`testlab-metrics.py`): cold start to first frame and to fully drawn, peak memory, network bytes, crash-free outcome; same budget table (`android-real` in `budgets.json`).
- The Android staging build offers no sign-in method a crawler can complete (Apple/Google are iOS-only, email link is off), so Robo never sends email or creates accounts.
- iOS on Test Lab needs XCTest bundles signed for devices: not set up (would use the same quota).
- **Setup (owner, once, ~10 min)**: 1) console.firebase.google.com › Add project `thirstr-testlab` (Analytics off), stay on **Spark**. 2) In Google Cloud console for that project, enable **Cloud Testing API** and **Cloud Tool Results API**. 3) IAM › Service accounts › create `github-testlab`, role **Editor** (project holds nothing else) › Keys › Add key › JSON. 4) GitHub › Settings › Secrets and variables › Actions: secret `FIREBASE_TESTLAB_SA` = the JSON file content; variable `FIREBASE_PROJECT_ID` = the project id. Until then the job prints a notice and skips.

## Chaos and game days (EN-15, #174)
Staging only. Runbook: [`docs/runbooks/game-day.md`](../runbooks/game-day.md). Tool: `scripts/chaos/chaos.sh` run by `.github/workflows/chaos-staging.yml` (manual only, never scheduled, so nobody is surprised while testing TestFlight against staging).
- **Hard guards**: app names are fixed in the script (`thirstr-*-staging`); any argument or resolved app containing `prod` aborts; the workflow input `confirm` must be `staging`; one run at a time (concurrency group); the run aborts if a staging deploy or prod promotion is running; every experiment restores the original state in a `trap` (machine started again, fill file removed) even when a step fails.
- **Experiments**:
  | Id | Fault | Expected (pass) |
  |---|---|---|
  | `api-kill` | SIGKILL the API machine mid-traffic (no drain) | Fly restarts it; health back < 60 s; no data loss (outbox, SR-04) |
  | `api-stop` | graceful stop (SR-03 drain) | next request auto-starts it; back < 30 s |
  | `valkey-down` | stop Valkey for `duration` s | API stays up (health 200, welcome 200); rate limits fail open, chat send keeps working (SR-11 #151) |
  | `db-restart` | stop + start Postgres | API errors only while DB is down; back < 60 s after DB is up, no restart of the API needed |
  | `disk-fill` | fill the API machine's root disk to 95 % for `duration` s | API keeps answering; fill removed afterwards |
- **Measured**: a probe hits `/v1/health`, `/v1/config` and `/v1/welcome` once a second during the run; the report gives requests, errors, longest outage, time to recover and p95 latency, in the job summary.
- **Not automated (game-day checklist only)**: expired APNs key, Tigris outage, DB failover (needs EN-01 #160), region split (needs EN-02 #161), quarterly load-env run (no load env, "no extra spend").
- Each run is logged in the runbook; a failed expectation becomes a fix issue or a runbook change.

## Release criteria (closed beta)
- 100 % of Milestone-1 ACs automated or manually signed off.
- 0 open critical/high security findings.
- Abuse harnesses green 7 consecutive nights.
