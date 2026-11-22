# Beta build plan: full feature set in first TestFlight

Status: accepted · 2026-11-17 · Owner ask: "Build it all in the first. Functional application from the get go." Tracking issue: see ChangeLog.

Every F-01…F-18 / I-01…I-03 rule in beta scope ships before the closed beta opens. Work lands as a short series of PRs on `main` (each auto-deploys staging + uploads a TestFlight build); testers are invited only once the last one is green.

## Milestones (PRs)
| PR | Scope | Specs |
|---|---|---|
| B1 Explore | tab shell, Pop theme, profiles (all fields, 3 kinds, per-field visibility, preview-as, completeness), photos 5 slots + reorder, location levels (Hidden (timed, #114)/City/Area/Exact pin/hide-from-hidden, k-anon, velocity), Explore map + grid + tray + filters, profile view, taps, block, hide, map tile proxy | F-04, F-05, F-06, F-17 (visibility subset), F-18 badges |
| B2 Chat | MLS delivery service, key packages, realtime socket, inbox, 1:1 + group chat, disappearing, quick replies, read/typing, media + private albums (E2EE blobs), private notes, push (APNs/FCM, content-free), notification settings | F-07, F-08, F-16, F-06 R-06.6/R-06.9 |
| B3 Social | Now status, Tonight board, parties (requests, seats, guest chat, address), Activities + clubs, venues + check-in + here-now | F-09, F-10, F-11, F-12 |
| B4 Trust & safety | Verification (liveness + blind credential), reports + franking, shadow quarantine + signals, admin console, vouches, linked accounts, Safe Mode, check-in + trusted contacts + panic, app lock + duress, settings tree, GDPR export, device link | F-03, F-13, F-14, F-15, F-17, F-18, I-01, I-02, F-01 rest |

## Beta implementation choices (ADR-0001 amendments)
| Topic | ADR-0001 target | Beta implementation | Why / exit |
|---|---|---|---|
| MLS client | OpenMLS (Rust, UniFFI) | **ts-mls** (RFC 9420, TypeScript, noble crypto), ciphersuite `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519` | Same protocol and wire format; no native build risk on Hermes. Swap to OpenMLS core when audited bindings exist; groups re-created on migration. |
| MLS on Hermes | — | ts-mls `nobleCryptoProvider` still calls `crypto.subtle` (via @hpke/core). Hermes has none, so `src/crypto/subtleShim.ts` implements the needed subset (X25519, Ed25519, HKDF/HMAC-SHA256, AES-GCM, SHA digests) on noble. Installed only when `crypto.subtle` is missing | Pure JS, audited noble libraries. Unit test runs a full 1:1 flow on the shim. |
| Chat media | H.265 transcode, videos, voice notes | Photos (≤ 20 MB) re-encoded on device (drops EXIF/GPS), AES-256-GCM. Video and voice notes follow in a later build. Receiver blur (R-08.7) treats every photo from someone you haven't replied to as possibly explicit until the on-device classifier ships. Watermark (R-08.5) and pre-send CSAM hash (R-08.8) not in beta | Small closed beta; classifier work tracked separately. |
| Album revoke | lazy re-encrypt | Eager: revoke sends `album.revoke`, re-encrypts every item under new keys, deletes the old blobs, re-grants remaining viewers | Simple and meets AC-08.2. |
| Device storage | SQLCipher via Rust core | `expo-sqlite` with SQLCipher enabled; key in Keychain/Keystore (`expo-secure-store`) | Same at-rest guarantee. |
| Tokens | Keychain | `expo-secure-store` on native, memory + localStorage on web (DEV only) | |
| Map | MapLibre + self-hosted Protomaps | `@maplibre/maplibre-react-native` (native) / `maplibre-gl` (web). Tiles, glyphs fetched **through our API** (`/v1/tiles/*`, cached, no auth/user id forwarded) from an OpenMapTiles-schema upstream (default OpenFreeMap) | Third party sees only our server, never users. Exit: PMTiles in Tigris behind the same path. |
| IP → city (R-02.2) | — | Offline **DB-IP City Lite** (CC BY 4.0) converted at image build into a compact `TGEO` file read with `pread` (`Thirstr.Geo.GeoDb`); IP never leaves the server, never stored; client IP from `Fly-Client-IP` (#26) | No third-party lookup, no RAM cost. |
| Transactional email | — | EU SMTP relay with DPA, STARTTLS verified, plain text, no tracking; sender `hello@thirstr.fun`; runbook `docs/runbooks/email.md` (#26) | Only sign-in links are emailed. |
| Photo classifier | self-hosted GPU model | self-hosted **NudeNet** (ONNX, CPU) service `thirstr-classifier-{env}` on Fly, called server-side; mapping in F-15 R-15.10 table below. NudeNet 3.4.2 (MIT, `320n`), private app (no public IP, token, bucket-only fetch, suspends when idle); runbook `docs/runbooks/classifier.md` (#26) | Self-hosted, no third party. |
| Liveness | Core ML / TFLite | iOS **Apple Vision** (local Expo module `thirstr-face`): face rectangles revision 3 (continuous yaw/pitch) + eye, mouth and nose landmarks per challenge frame; frames never leave device and are deleted | Built-in OS framework, no SDK. Android + web: verification not offered in beta (iOS-only closed beta). Steps: 3 of turn left / turn right / smile / look up (blink dropped: too short for stills, #131). Checks vs a neutral baseline frame (face found, \|yaw\| < 0.35; none within 5 s → "can't see your face", no try spent): head turn \|Δyaw\| ≥ 0.25 rad or nose offset ≥ 0.12 eye-widths (direction not enforced), look up \|Δpitch\| ≥ 0.15 or nose height Δ ≥ 0.1, smile mouth width ≥ 108 %; stills sampled continuously up to 6 s per step, first pass wins, ✓ shown. Orientation: EXIF first, then the other orientations until a face is found. The server takes the device's verdict (no App Attest binding yet, #11) — acceptable for the invite-only beta. DEV web build on localhost simulates a pass so flows can be tested. |
| Duplicate-human control (R-03.6) | LSH face hash of banned users | Not in beta (Apple Vision gives landmarks, no embedding); bans rely on account + invite | Before public beta. |
| Photo match / age estimate | on-device embeddings | **Photo match built** (#232, R-03.2): SFace (D-22), 2 frontal selfie stills vs own public photos, both ≥ 0.40; no match = failed try; no face in any photo = verified without photo-match claim. Age = birthdate + 18+ checkbox; Yoti fallback deferred (#4) | Age estimation still has no on-device model. |
| Anonymous credential | RSA-BSSA (RFC 9474) | Chaum **RSA-FDH blind signature** (3072-bit, SHA-384 full-domain hash) | Same unlinkability property; RFC 9474 encoding later. |
| Attestation | App Attest / Play Integrity on every request | App Attest attestation verified once per device at sign-in when available; device marked `attestation_ok`; unattested devices keep read access but count as a bot signal | Full per-request assertion before public beta (#11). |
| Push | direct APNs/FCM | direct APNs (token auth, `APNS_KEY_P8` secret), generic visible alert (api.md › Push payloads); FCM when Android ships | Owner adds APNs key. Preview levels need the notification service extension. |
| Group chats (F-10, F-11) | MLS groups with server-side membership | Host device keeps the MLS group in step with the server member list (add/remove commits) on accept, RSVP, approve and on socket events; members joining before the host is online see "Waiting for the host" | No server-side MLS state; DS stays content-blind. |
| Party vouches (R-10.4) | vouch count on requests | Shows 0 until vouches ship with B4 trust & safety | |
| Venue geofence | OS geofencing auto check-out | 4 h auto check-out on the server; leaving the geofence is handled by the app when location updates arrive | No background location in beta. |
| Club logo | club image | Not in beta (name + sport only) | |
| Admin console | separate LiveView app behind VPN, FIDO2 | `/admin` server-rendered pages in the API app (no LiveView dependency, no JS except the passkey login). Owner passkey login; owners listed in `ADMIN_ACCOUNT_IDS` (empty → 404). Cookie session 8 h, idle 30 min, CSRF on every form, CSP. Screens A-01 reports, A-02 detail, A-03 photo review, A-04 quarantine, A-05 appeals, A-10 audit. A-06 verification appeals, A-07 venues, A-08 legal, A-09 config: not in beta (owner edits via DB/runbook) | VPN + separate app before public beta. |
| Reports (R-15.7) | reporter score | Any verified reporter counts; one open report per reporter × target × reason | Reporter score once there is volume. |
| Ban appeal | in-app | Banned accounts are signed out and can't sign in; ban appeals by email to the support address on the website in beta. Suspensions and warnings appeal in-app | |
| Badges | Replies fast | Not in beta (needs reply-time data we don't keep). Verified, member since, vouches, host rating ship | |
| Private notes sync | E2EE sync across own devices | Device-only in beta (one device per account) | Sync with device linking (B4). |
| Trusted-contact page | separate web page | `/c/` static page on the site host (`web/site/c`), key in URL fragment, decrypts in browser; relay API `/v1/relay/{rid}` (no account, 60/min/IP) | |
| Contact alerts | SMS/WhatsApp gateway | Empty-payload **Web Push** (VAPID) to the contact page; on iPhone the contact adds the page to the Home Screen. No SMS in beta | SMS gateway if contacts miss alerts |
| Check-in timer | Valkey `checkin:{token}` | Postgres `checkins` + held `safety_msgs`, swept every minute (a Valkey restart must never drop an alert) | |
| Alert location with app killed | captured at alert time | Location from the app's last 5-min refresh (iOS can't run a killed app at an exact time) | Background location task if needed |
| Panic trigger | power button 3 s | In-app SOS hold (2 s) only; iOS gives apps no power-button access | |
| Live location / panic power-button | OS hooks | in-app SOS only (long-press); power-button gesture not available to third-party iOS apps | |

## B4d implementation (account, sharing, settings, Safe Mode)
**Download my data (R-01.11, S-6x).** `GET /account/export` returns the archive JSON straight to the signed-in device (nothing stored server-side, no link): account, settings, profiles with all fields and photo URLs (1 h), location level, taps sent/received, blocks, hides, Now, Tonight plans, parties hosted/requested, activities, clubs, venue check-in, reports filed (reason, time), notices, vouches given, linked accounts, share links, trusted-contact relays (id, accepted), devices. The app adds device-only data (chats, private notes, favorites, friends, trusted-contact labels), saves `thirstr-export-YYYY-MM-DD.json` and opens the share sheet. Rate limit 3/day.

**Linked devices (R-01.6, R-01.8).** Settings › Linked devices lists devices (platform, last seen day, this device) with Remove. Link: old device `POST /devices/link` → 8-character code (Crockford base32, 120 s) shown as QR + text. New device (Welcome › "I have Thirstr on another phone") scans or types it: `POST /auth/device-link {code, platform}` → `{claim}`; old device sees "New iPhone wants to join" → confirm with app lock / Face ID → `POST /devices/link/{code}/confirm`; new device polls `POST /auth/device-link {code, claim}` → session. The old device then adds the new device to each of its MLS groups (add commit + welcome per group); new chats include all devices automatically. Chat history before the link stays on the old device (beta). Max 5 devices.

**Linked accounts and shared posts (I-01, #17).** Owner decision 2026-11-21 (D-23): full I-01 ships in beta: share extension + S-44 share sheet, on-device link previews sent E2EE (`link.preview`), blurred adult previews, linked accounts with proof (Bluesky bio code + DID, X code in a public post, OF/JFF bio code with hand-check fallback), guardrails (after reply, per-sender link hash, consent reports) and the `adult_links` store-review flag. See integrations/I01-social-share.md.

**Profile share link (I-02 R-I02.1–4).** Edit profile › Share link: create → `https://thirstr.fun/p/{slug}` (10 random chars) with QR; rotate (new slug, old dead) or turn off. `GET /p/{slug}` is a server-rendered page with no scripts, cookies or analytics: main photo blurred (CSS, signed URL 1 h), display name, "Chat me safely on Thirstr", store badges. Paused, banned, quarantined or deleted profiles → 404. In the app the link opens the profile (`thirstr://p/{slug}` and universal link `/p/*`), via `GET /v1/share/{slug}` → `{profile_id}`. Import from other apps (R-I02.5–9) stays v1.1.

**Settings tree (F-17, concept §3).** Adds: Safety & check-in, App lock, Linked devices, Download my data, Verification (status, re-verify), received media auto-delete after viewing (device), App: units km/mi, haptics, language (opens system settings), privacy policy, open-source licenses. Not in beta: data saver (amended 2026-11-17: media already loads as thumbnails until opened), recovery phrase, encrypted backup, optional email, disguised icon, transparency report, import, Plus.

**Safe Mode extras (F-14).** Auto detection runs on the device: country from the OS reverse geocoder (falls back to the device region) against the bundled list (`src/safety/criminalizing.ts`) plus additions from `GET /v1/safe-mode/countries` (add-only, daily; rule and process in F-14 R-14.1a, decided in issue 49) → `PUT /me/safe_mode {setting: auto, active}`; nothing about the country is sent. On activation: prompt to set app lock and a duress PIN. In Safe Mode: received photos auto-delete after viewing and saving is off; chat banner "Be careful" on chats with unverified people, accounts younger than 30 days (`member_since`), or a meet request in the first 5 messages (local keyword check); Resources sheet with international NGOs (Rainbow Railroad, ILGA World, Front Line Defenders). Leaving the country (auto off) → "Restore your previous settings?" (location level). Disguised icon: not in beta.

## Classifier mapping (R-15.10, NudeNet labels)
| Slot | Rejected if any detection ≥ 0.6 |
|---|---|
| 0 main (all kinds) | `*_GENITALIA_EXPOSED`, `ANUS_EXPOSED`, `BUTTOCKS_EXPOSED`, `FEMALE_BREAST_EXPOSED`; also `no_person` if no face/body detected |
| 1–4 Now/Friends | `*_GENITALIA_EXPOSED`, `ANUS_EXPOSED` |
| 1–4 Sport | same as main + `*_GENITALIA_COVERED` (> swimwear, AC-11.1) |
Scores 0.4–0.6 → live at once, `review_state = after`, `main_ok = false`; reviewed after publish in A-03 (F-15 R-15.56, #325).
`FEMALE_BREAST_EXPOSED` is ignored when `MALE_BREAST_EXPOSED` scores at least as high on the same photo (NudeNet confuses bare male chests; shirtless is allowed on main, #26).

## Out of beta (unchanged "Later")
Video calls, Plus billing, open protocol, web client for end users (web build stays a DEV tool).
