# Test strategy

## Levels
| Level | Tooling | Scope | Gate |
|---|---|---|---|
| Unit | ExUnit, cargo test, Jest | rules R-xx logic | PR |
| Integration | ExUnit + Testcontainers (Postgres+h3, Valkey) | API endpoints, channels | PR |
| Contract | OpenAPI schema from api.md, generated client tests | app ↔ server | PR |
| E2E mobile | Detox (RN) on iOS sim + Android emu | onboarding, explore, chat, party flows | main |
| Crypto | OpenMLS interop vectors, property tests | MLS, media keys, blind signatures | PR |
| Abuse | custom harnesses | trilateration (AC-05.1), scraping (A9), quarantine (AC-15.1), Safe Mode leaks | nightly + pre-promote |
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

## Release criteria (closed beta)
- 100 % of Milestone-1 ACs automated or manually signed off.
- 0 open critical/high security findings.
- Abuse harnesses green 7 consecutive nights.
