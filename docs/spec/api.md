# API & realtime contract

Base: `https://api.thirstr.fun/v1` (staging: `https://staging.thirstr.fun/v1`; DEV: `https://localhost:7443/v1`). JSON. Auth: short-lived access token (15 min) + refresh (30 d, device-bound) issued after passkey/OIDC/magic-link. Every request signed with device key + attestation token (iOS App Attest / Play Integrity) refreshed daily.

Errors: `{ "error": { "code": "rate_limited", "message": "...", "retry_after": 30 } }`. Codes: `unauthorized`, `forbidden`, `not_verified`, `rate_limited`, `not_found`, `conflict`, `validation`, `safe_mode_blocked`, `quarantined` (never returned to the quarantined client; it gets fake success).

## REST

### Auth (F-01)
| Method | Path | Body → Response |
|---|---|---|
| POST | /auth/passkey/register/options | {} → WebAuthn creation options |
| POST | /auth/passkey/register | attestation → {account_id, tokens} |
| POST | /auth/passkey/login/options | {} → request options |
| POST | /auth/passkey/login | assertion → tokens |
| POST | /auth/oidc | {provider: apple\|google, id_token} → tokens |
| POST | /auth/email/link | {email} → 202 (always) |
| POST | /auth/email/verify | {token} → tokens |
| POST | /auth/refresh | {refresh} → tokens (rotated; re-use of a spent token revokes the device, except within 60 s of its use: 409 `refresh_race`, no revoke; clients single-flight refresh, #116) |
| POST | /auth/logout · /auth/logout_all | → 204 (this device · every device, R-01.5) |
| POST | /auth/device/link/start | → {qr_payload, expires} (old device) |
| POST | /auth/device/link/complete | {qr_payload, new_device_pubkey} → tokens |
| DELETE | /account | {confirm: "DELETE"} → 202; rows deleted immediately, objects purged by job ≤ 24 h |
| POST | /account/pause · /account/resume | |
| GET | /account/export | → 200 archive JSON to the device (beta-build-plan › B4d); 3/day |
| GET | /me/devices | → {devices: [{id, platform, last_seen_day, current}]} |
| DELETE | /me/devices/{id} | → 204 (signs that device out) |
| POST | /devices/link | → {code, expires_in: 120} |
| GET | /devices/link/{code} | → {state: pending\|claimed\|confirmed, platform?} |
| POST | /devices/link/{code}/confirm | → 204 (after app lock / Face ID on the old device) |
| POST | /auth/device-link | no auth, 10/min/IP. {code, platform} → {claim}; {code, claim} → 202 {state} until confirmed, then Session |

Sign-up calls (passkey register, OIDC, email verify) carry `age_confirmed: true` (R-01.12) and `platform`. Every request carries `x-thirstr-install` (random per install, hashed server-side) used only for the R-02.3 under-age flag. Session response: `{access_token, refresh_token, expires_in, account: Me}`.

Outside `/v1`: `GET /.well-known/apple-app-site-association` → `{webcredentials: {apps: ["<TeamID>.app.thirstr"]}}` so iOS accepts this host as passkey relying party (I-03); 404 until `APPLE_TEAM_ID` is set. Native Apple sign-in sends Apple's identity token with `aud` = bundle id (`APPLE_CLIENT_IDS`, default `app.thirstr`).

### Account & onboarding (F-01, F-02)
| Method | Path | Body → Response |
|---|---|---|
| GET | /me | → Me `{status, verified, onboarding_step, safe_mode, profile, location}` (no ids of the account, no birthdate). `location` = `{level, pin, hide_from_hidden, cell_r5}`; `cell_r5` is the caller's own stored coarse cell (map centring fallback, R-04.13), never shown to others |
| POST | /account/pause · /account/resume | → Me |
| PUT | /me/basics | {display_name, birthdate, gender, gender_other?, here_for[]} → Me; under 18 → 403 `underage`, account deleted, install flagged 30 d |
| POST | /me/onboarding/verify_later | → Me (step `verify` → `done`, browse-only) |
| GET | /welcome | → {city, center, count, cells:[{cell r7, count}]} (no auth, approximate IP city, R-02.2) |
| GET | /cities?q= | → {cities:[{id, name, country, cell_r5}]} (S-04b picker, F-20 trip city). ≥ 2 letters, prefix match on `search_key` (lowercase, accents removed, so "zur" finds Zürich), biggest cities first, max 10 |
| POST | /me/profiles/{id}/photos/{photo_id}/check | → {photo:{id, slot, status, reject_reason, url}, account: Me} (inline classifier result, R-02.7) |

`PUT /me/location` (F-05) accepts `{level: area|exact, cell_r9, precise?, cell_r10?}` (#197: `precise: true` needs `cell_r10` whose r9 parent is `cell_r9`, else 422; refused in Safe Mode with 422 `safe_mode`) or `{level: city, city_id | cell_r5}`; `hidden` requires verification. Onboarding step order: `basics → location → photo → verify → done`.

### Verification (F-03)
| POST | /verification/challenge | → {nonce, steps: 3 of turn_left\|turn_right\|smile\|look_up (blink dropped, #131), expires_in: 300, key: {n: b64url, e, bits: 3072, hash: "SHA-384"}}. 403 during the 24 h cooldown (R-03.10) |
| POST | /verification/attest | {nonce, passed: bool, blinded?: b64url} → {signature: b64url} when passed, else {passed: false, attempts_left}. Nonce single use (AC-03.3); 3 fails / 24 h → cooldown |
| POST | /verification/redeem | {token: b64url 32–64 B, signature: b64url} → Me (verified, epoch + 1; onboarding `verify` → `done`). Signature check: `sᵉ mod n = MGF1-SHA-384(token) mod n`; sha256(token) stored once (spent) |
Blind signature (R-03.4, Chaum RSA-FDH): client picks random `token` and `r`, sends `FDH(token)·rᵉ mod n`, unblinds `s = s'·r⁻¹ mod n`. The issuer key is generated once and kept in `server_keys`. Credentials lapse after 12 months (daily sweep, R-03.7).

### Profiles (F-06)
| GET | /profile-options | {options:{field:[values]}, defaults:{field:{visibility, kinds}}, health:[…]} (field catalogue) |
| GET | /me/profiles | {profiles:[MyProfile]} (always exactly one; MyProfile has `show_in`, photos have `main_ok`) |
| PATCH | /me/profiles/{id} | {display_name?, fields?, visibility_map?, show_in?} (show_in ≥ 1 else 422 `show_in_empty`) → MyProfile. Values whose visibility is `chats`/`only_me` are dropped (kept on device, R-06.6); health fields can't be `public`; bio/text checked for contact details and links (R-06.10) |
| POST | /me/profiles/{id}/photos | {slot, content_type} → {photo_id, put_url} |
| POST | /me/profiles/{id}/photos/{photo_id}/check | inline classifier → {photo, account} (status ok_main / ok_public / pending / rejected) |
| DELETE | /me/profiles/{id}/photos/{photo_id} | 204; main photo can't be removed |
| PUT | /me/profiles/{id}/photos/order | {order:[photo_id]} → MyProfile; first must have `main_ok` |
| GET | /profiles/{id}?mode | ProfileView through the viewer's lens (F-06 R-06.1b; default hookup) and audience (stranger: public; verified: public+verified). `online` (bool, #115): active in the last 5 min and both sides show online status (R-17.5); false for yourself. 404 when blocked/unavailable or mode not in the profile's `show_in`. 300 views/h |
| POST | /profiles/{id}/tap | verified only; 100/day (50 for accounts < 7 days) → {mutual} |
| POST | /profiles/{id}/block | account-level, silent |
| POST · DELETE | /profiles/{id}/hide | hide from Explore |
| GET | /me/blocks | {blocks:[{profile_id, display_name, age, photo, at}]} · DELETE /me/blocks/{profile_id} |
| GET | /me/hidden | {hidden:[{profile_id, display_name, age, photo, at}]} newest first, max 500 (#111) · unhide = DELETE /profiles/{id}/hide |
| GET | /taps | {taps:[{profile, at, seen, mutual, kind}]} (7 days) · POST /taps/seen |
| POST | /profiles/{id}/report | {reason, franked_payload?} (B4) |

### Location (F-05)
| PUT | /me/location | {level, cell_r9? \| cell_r5? \| city_id?, safe_mode_override?, until?, return_level?} (client computes cells; never lat/lng). Account-wide. Hidden: `until` ≤ 48 h, `return_level` city\|area (R-05.7) |
| PUT | /me/pin | {lat, lng, ttl_s: 1800\|3600\|7200\|14400, audience: verified\|chats\|everyone, confirm: true, safe_mode_override?} → Me. RAM only, jittered 10–20 m. Verified only; Safe Mode needs override |
| DELETE | /me/pin | → Me |
| PATCH | /me/visibility | {hide_from_hidden?} → Me (`incognito` removed, #114: 422) |

### Explore (F-04)
Common query: `mode=hookup|friends|sport`, `age_min`, `age_max`, `distance_max` (m), `verified_only` (default true), `online_now`, `has_now`, `hide_creators` (default true), `new_members`, and comma lists for `position, hosting, tribes, build, looking_for, sports, sport_level, schedule, sport_intent, orientation` (position/hosting apply only for verified viewers and only to values visible to them). `languages` is not a filter (#106); an old client sending it is ignored.

| GET | /explore/grid | &cursor → {items:[Card], next, further_from, reason, fit_m}. `fit_m` = auto-fit radius (R-04.15, bucketed, null if none). 60/page; sparse areas widen to 100 km with a "Further away" index |
| GET | /explore/summary | ?mode=&filters → `{place, counts: {hookup, friends, sport}, now}` (R-04.17, #104). `place` = nearest city name to the viewer's own cell (null if unknown). `counts` = visible people within 10 km per mode (grid rules; `mode` uses the given filters, others defaults); `now` = active Now in `mode` (0 for sport). Exact integers, client caps at 99+ |
| GET | /explore/map | &bbox=w,s,e,n → {cells:[{cell, res, count}], pins:[Card], avatars:[Card]}. Unverified and Safe Mode viewers get counts only (r7 / r5) |
| | /explore/* `intents` | (#113, R-04.18) `grid`, `map`, `tray`, `summary` take `intents=hookup,friends,sport` (any non-empty subset). With it: profiles whose `show_in` overlaps; each card is rendered through its first matching lens; `mode` is ignored for filtering. Every Card has `intents` (ordered hookup → friends → sport). `summary` adds `total` (union) and `counts` per intent; `now` excludes Sport-only views |
| GET | /places | ?bbox=w,s,e,n&kinds=clubs,saunas,parties,gyms (#113, R-04.20). → {places:[{id, type: venue\|event\|party, kind: club\|bar\|sauna\|gym\|official\|hosted, name, lat, lng, distance, here?, starts_at?, ends_at?, venue_name?, url?, source}]}. Venues and events at public coordinates; hosted parties at the r8 centroid (AC-10.1) and only those `GET /parties` would show. Safe Mode → []. bbox ≤ 0.5°×0.5° (bigger → []), max 150 nearest the bbox centre |
| GET | /explore/tray | → {items:[Card]} up to 20 active (pin, Now, online) |

Card: `{id, display_name, age, verified, photo, online, distance, now, exact, pin_expires_at, further, creator, intent, position, new, lat?, lng?, visitor?, trip?}`; `visitor: true` + `trip: {city, country, first_day, last_day, here, from}` for travellers (F-20 R-20.13, `distance` null unless `here`); `distance` is `{kind: exact, m}` (pin and owner allows exact), `{kind: area, m, approx: true, floor: bool, precise: bool, bucket}` (#197: `m` rounded per R-04.6, `floor` = show "< m"; `m` omitted under the spoof brake or `show_distance = range`; `bucket` lt200 … 10k_plus kept for old builds; ≥ 1 km for unverified viewers) or `{kind: city, city}`.

### Travel (F-20, #188)
| Method | Path | Body → Response |
|---|---|---|
| GET | /trips | → {trips:[Trip], limits:{max: 3, ahead_days: 180, max_days: 30, creates_left}} own trips, soonest first |
| POST | /trips | {city_id, first_day, last_day (ISO dates), show_days: null\|0\|3\|7\|14, say_from: bool, safe_mode_ack?, tz_offset_min} → Trip. 422 limits (R-20.3), 403 `not_verified` when show_days ≠ null and unverified, 409 `conflict` shown windows overlap, 429 6 creates / 30 d |
| PATCH | /trips/:id | same fields, partial → Trip (city change counts as a create) |
| DELETE | /trips/:id | → 204 |
| GET | /explore/visitors | ?intents&filters&trip_id → {count, items:[Card]} visitors listed for the viewer's area (R-20.12), max 60; map bubble + "See all" |

Trip: `{id, city:{id, name, country, lat, lng}, first_day, last_day, show_days, say_from, shown_from (date or null), safe_mode_country: bool}`.

`trip_id` (own, unexpired trip) on `GET /explore/grid|map|tray|summary|visitors` and `GET /profiles/:id`: the viewer point becomes the trip city's centre (R-20.15); no Exact pins; locals with `show_to_remote` off or in Safe Mode are left out (R-20.17). Unknown or foreign trip → 404. `GET /explore/grid` interleaves visitors (R-20.10) unless `visitors=false`; `GET /profiles/:id` adds `trip` when the viewer point is in the trip city's area (R-20.7).

### Settings & Safe Mode (F-17, F-14)
| GET · PATCH | /me/settings | server-enforced settings (hide_from_*, show_in_*, show_to_remote (F-20, default true), show_distance, online_visible, read_receipts, who_can_message, explicit_from_strangers, disappearing_default, push, quiet_hours) |
| PUT | /me/safe_mode | {setting: auto\|on\|off, active: bool} → Me (country detection stays on device) |
| GET | /safe-mode/countries | public, `cache-control: public, max-age=21600` → {version, source, countries: [ISO alpha-2]}; same body for every caller (R-14.1a) |

### Map tiles
| GET | /tiles/style.json · /tiles/v/{z}/{x}/{y} · /tiles/fonts/{stack}/{range} | public; Pop dark style, tiles and glyphs proxied from `TILES_UPSTREAM` (OpenFreeMap) so clients never contact a third party |

### Tonight & Now (F-09)
| PUT/DELETE | /me/now | {status: now\|hosting\|can_travel\|door_open, text ≤ 80 (no links/contacts), ttl_s: 1–6 h} (verified only) |
| GET | /tonight?mode&from&to | → {plans: [{id, profile: card, text, tag, audience, window_start, window_end, distance}], mine: [plan]}; area = k-ring 2 around caller's r8 (10 km), widened to 25 km when < 5 plans; `chats` audience only for chat partners |
| POST | /tonight | {mode, text ≤ 140, tag: hosting\|can_travel\|drinks_first\|party\|other, audience: verified\|chats, window_start, window_end, tz_offset_min} (verified; ≤ 2 live per profile; expires 06:00 local) |
| DELETE | /tonight/{id} | own plan |

### Parties (F-10)
| GET | /parties | → {parties: [party]} nearby, live, not hidden (hookup profile) |
| POST | /parties | {title, starts_at, ends_at, capacity 2–50, rules[], audience: verified\|chats\|invite} (verified, not Safe Mode, 1 live party, 3 created/day) → party (+ `invite_code` for audience invite) |
| GET | /parties/{id}?code= | party; host view adds `requests: [{profile, state, at, vouches}]` and `invite_code` |
| PATCH | /parties/{id} | host: {status: open\|full\|ended\|cancelled, cohost_profile_id?} |
| POST | /parties/{id}/request | {code?} (verified) → party (`my_state: pending`) |
| POST | /parties/{id}/requests/{profile_id}/accept\|decline\|remove | host or co-host; accept is transactional and sets `full` at capacity |
| POST | /parties/{id}/leave · /rate {up} · /report {reason} | rate: accepted guests after end; 2 reports → hidden pending review |
Party: `{id, title, host: card, starts_at, ends_at, capacity, seats_taken, rules, audience, status, distance, my_state: host\|pending\|accepted\|declined\|left\|null, rating?}`. Socket topic `party:{id}` → `seats` updates. Address and door code are never sent to the server: the host sends them E2EE in the guest group chat.

### Activities & clubs (F-11) — Sport profile
| GET | /activities?sports= | → {posts: [post]} nearby, not expired |
| POST | /activities | {sport, title, place_text?, venue_id?, starts_at, capacity?, intent, club_id?} (verified, `sport` in `show_in` else 409 `sport_off`, ≤ 3 live; expires start + 3 h) |
| DELETE | /activities/{id} | host |
| POST | /activities/{id}/rsvp | {going: bool} (capacity checked in a transaction) |
| GET | /activities/{id}/members · DELETE /activities/{id}/members/{profile_id} | host and going members only · host removes |
| GET/POST | /clubs | list nearby (r5) / create {name, description, sport, join_policy: open\|approval} (verified, account ≥ 30 days) |
| GET | /clubs/{id} | club + `events`; members see `member_list` |
| POST | /clubs/{id}/join · /leave · /members/{profile_id}/approve\|remove\|promote | admin actions for admins |

### Venues (F-12)
| GET | /venues/nearby?mode | → {venues: [{id, name, kind, here: "0"\|"a_few"\|n, distance, member}]}; kinds by mode (gym only in Sport); hidden venues left out |
| POST | /venues?mode | F-12 R-12.11 add a place: {name 2–60, kind club\|bar\|sauna\|gym\|other, lat, lng, visible?, zone?} (verified, not Safe Mode, ≤ 1.5 km from the caller's cell, 3 per 24 h) → here (caller checked in). 409 `place_exists` {error: {code, message, existing: {id, name, kind}}} when a similar name is listed within 75 m |
| DELETE | /venues/{id} | creator only, while nobody else is checked in (403 / 409 otherwise) → 204 |
| POST | /venues/{id}/checkin?mode | {visible, zone? ≤ 40} (verified, not Safe Mode, ≤ 1.5 km from the venue cell) → here; one check-in per account, auto check-out after 4 h |
| PATCH | /venues/{id}/checkin | {visible?, zone?} |
| POST | /venues/checkout | |
| GET | /venues/{id}/here | 403 unless checked in here; invisible callers see nobody. → {venue: {id, name, kind, member, mine, removable}, me, stats: {total, visible_to_you, tapped_you}, people: [{profile, zone, since, tapped_me}]} |

### Group chats (parties, activities, clubs)
MLS groups like 1:1 chats. `context` = `party:{id}` \| `activity:{id}` \| `club:{id}` on `/mls/keypackages/claim` and `/mls/messages` lets members of the same party, activity or club reach each other without first-contact rules and without counting as new contacts. The host (party host, activity host, first club admin) adds and removes members with MLS commits when the member list changes. Welcome wire: `sha256(kp) ‖ '{"ctx":"…"}\n' ‖ Welcome`. Sender name and group title travel inside the E2EE payload.

### Messaging (F-07, F-08) — MLS Delivery Service
One MLS identity per (own profile, device): credential identity = `{"p": profile_id, "d": device_id}`. The server routes by (profile, device) and stores ciphertext only (AC-07.1).

| Method | Path | Body → response |
|---|---|---|
| GET | /mls/keypackages | → {counts: {profile_id: {count, last_resort}}, device_id} for this device |
| POST | /mls/keypackages | {profile_id, key_packages: [b64] (≤ 200 stored per device), last_resort?: b64 (replaces previous)} → {counts, device_id} |
| POST | /mls/keypackages/claim | {from_profile_id, to_profile_id, context?} → {key_packages: [{id, device_id, key_package}]}, one per recipient device, single-use (last-resort reused). First contact needs caller verified unless replying (R-07.2); recipient without packages → 409 `unavailable` |
| POST | /mls/messages | {client_id: hex ≤ 32 (R-07.18, idempotency: a repeat from the same device within 7 d returns the first result and stores nothing), from_profile_id, group_id: b64, franking_tag?: b64, context?, envelopes: [{to_profile_id, to_device_id, kind: welcome\|commit\|app, key_package_id?, ciphertext: b64 ≤ 256 KB}] ≤ 200} → {delivered: [profile_id], undelivered: [profile_id]}. Blocked recipients land in `undelivered` (generic "Not delivered", no block reveal). New-contact limit 30/h. Emits `message.new` (no content) + push. All-or-nothing (R-07.22) |
| GET | /mls/messages?after= | → {messages: [{id, to_profile_id, from_profile_id, group_id, kind, key_package_id, ciphertext, at}], expired: [{group_id, count}]} for this device, ≤ 200, ordered by id. `expired` = messages swept unread for this device since last pull (R-07.22) |
| POST | /mls/messages/ack | {ids} → deletes them (R-07.12); unacked swept after 30 d |
| POST | /media/upload | {size ≤ 210 MB, ttl_s?, album?: bool} → 201 {blob_id, put_url}; ciphertext only (AES-256-GCM on device). Chat media ≤ 30 d; album items until deleted |
| POST | /media/upload (once) | `once: true` (video check, R-18.12): size ≤ 3 MB, TTL 24 h fixed, 20 per account per day |
| GET | /media/{blob_id} | → {url} signed GET (1 h). Once blob (R-18.12): first call binds to the caller (`fetched_by`), URL valid 2 min; repeat only by that account ≤ 10 min after first fetch, else 404 |
| DELETE | /media/{blob_id} | owner only; album revoke and item delete. Once blob: owner or `fetched_by` |
| PUT | /me/push | {token, platform: ios\|android} → 204 (device push token) |

Welcome wire (client convention): `sha256(recipient key package) ‖ MLS Welcome`, so the receiver finds its private key package without trial decryption. Plaintext inside MLS app messages is JSON `{v: 1, id, at, fk, t, …}` with `t` from R-07.4 plus `read`, `disappearing`, `screenshot`. `fk` is the franking key; `franking_tag = HMAC-SHA256(fk, plaintext)` goes to the server (R-07.11).

### Reports, notices, appeals (F-15, R-AD.9)
| POST | /reports | {profile_id, reason: spam_bot\|scam\|underage\|harassment\|non_consensual\|hate\|impersonation\|other, context: profile\|chat\|photo\|party\|tonight, note? ≤ 500, messages?: [{plain: b64 exact plaintext, fk: b64}] ≤ 20} → 201 {attached}. A message is kept only if `HMAC-SHA256(fk, plain)` equals a franking tag stored at delivery from that profile to one of the reporter's profiles (R-07.11); only `t`, `text`, `at` are stored. ≥ 3 verified spam/scam reporters in 24 h or ≥ 2 severe (underage, non_consensual, scam) → shadow quarantine pending review (R-15.7, R-15.13) |
| GET | /me/notices | → {notices: [{id, action: warn\|remove_photo\|hide_field\|suspend\|ban, reason, at, ends_at, appeal: null\|open\|upheld\|overturned, seen}]}. Quarantine is never listed (R-15.6) |
| POST | /me/notices/seen | → 204 |
| POST | /me/notices/{id}/appeal | {text ≤ 1000} → 204; one appeal per action (409 after) |
Suspended accounts (`status: suspended`) can read, see notices, appeal, ack messages, sign out and delete; every other write → 403 `suspended`. Quarantined accounts see `status: active`; their sends return 200 and reach nobody (AC-15.1).

### Safety (F-13)
Envelopes are opaque b64 ciphertext ≤ 64 KB (F-13 › Beta implementation). `relay` = relay id (uuid) of one of the caller's accepted relays.
| POST | /trusted/invite | {intro} → 201 {id, rid}. ≤ 3 accepted + 2 pending (409 `contacts_full`) |
| GET | /trusted | → {contacts: [{id, accepted, push, created_at}]} |
| DELETE | /trusted/{id} | → 204 (relay + mailbox gone) |
| POST | /checkin | {due_at (15 min–12 h ahead), notices: [{relay, ciphertext}], alerts: [{relay, ciphertext}]} → 201 {token, due_at}. One active check-in per account (409 `checkin_active`); no accepted relay → 422 |
| PUT | /checkin/{token}/alerts | {alerts, live?: [{relay, ciphertext}]} → 204 (replaces held alerts; `live` delivered now) |
| POST | /checkin/{token}/extend | {alerts} → 200 {due_at} (+30 min, max 3, 409 `max_extensions`) |
| POST | /checkin/{token}/ok | {oks?: [{relay, ciphertext}]} → 204 (check-in + held alerts deleted, R-13.10) |
| POST | /checkin/{token}/panic | {alerts} → 204 (released now, check-in closed) |
| POST | /checkin/panic | {alerts} → 204 (released now; no check-in needed) |
| GET | /checkin | → {checkin: null \| {token, due_at, extensions}} |

Contact side (no account; `rid` from the link fragment; 60 req/min per IP):
| GET | /relay/{rid} | → {accepted, intro, vapid_key} (404 when removed) |
| POST | /relay/{rid}/accept | {push?: {endpoint, keys}} → 204 |
| PUT | /relay/{rid}/push | {push} → 204 |
| GET | /relay/{rid}/messages | → {messages: [{id, ciphertext, at}]} (released only) |
| POST | /relay/{rid}/ack | {ids} → 204 (deleted) |
| DELETE | /relay/{rid} | → 204 (opt out, R-13.3) |

### Social (I-01, I-02, F-18)
| GET | /me/profiles/{id}/linked-accounts | → {linked: [{id, platform, handle, visibility, verified, code?}]} |
| POST | /me/linked-accounts | {profile_id, platform: x\|bluesky\|onlyfans\|jff\|instagram, handle, visibility: everyone\|verified\|chats} → 201 {id, proof_method: bio_code\|none, code?} (max 5 per profile) |
| PATCH | /me/linked-accounts/{id} | {visibility} → 204 |
| POST | /me/linked-accounts/{id}/verify | → {verified} (Bluesky: code in public bio) |
| DELETE | /me/linked-accounts/{id} | → 204 |
| GET | /me/profiles/{id}/share | → {share: {slug, url} \| null} |
| POST | /me/profiles/{id}/share | → {slug, url} (creates or rotates) |
| DELETE | /me/profiles/{id}/share | → 204 (link dead) |
| GET | /share/{slug} | → {profile_id} (signed in; then GET /profiles/{id}) |
Public page `GET /p/{slug}` (HTML, no scripts) — I-02.
| POST · DELETE | /profiles/{id}/vouch | vouch / withdraw. Verified, account ≥ 30 d (403, AC-18.1), ≥ 10 messages each way with that profile, ≤ 5 per 30 d. Profile view adds `vouches` (weighted, anonymous), `vouched`, `can_vouch` |

## Realtime (Phoenix Channels, WSS)
Connect: `wss://<api host>/socket/websocket?token=<access token>&vsn=2.0.0`, then join `user:me` (beta: one private topic per account; the server maps it).

| Topic | Events (server → client) | Client → server |
|---|---|---|
| `user:{account_token}` | `message.new` (ciphertext), `tap.new`, `party.request`, `party.accepted`, `photo.status`, `verification.done`, `checkin.due`, `moderation.notice` | `typing`, `read` (if enabled) |
| `cell:{cell_r7}` | `presence.diff` (counts per r9/r8), `pin.add/remove`, `now.add/remove` | — (join/leave by viewport) |
| `party:{id}` | `seat.update`, `status` | — |
| `venue:{id}` | `here.diff` (checked-in, visible) | — |

Rate limits (beta defaults, per account): messages to new contacts 30/h (unverified: 0), taps 100/day, location updates 1/30 s, pin set 6/h, party create 3/day, report 20/day.

## Push payloads
Beta (no notification service extension yet): a **visible, generic** alert, identical for every event type:
`{ "aps": { "alert": { "title": "Thirstr", "body": "New activity" }, "sound": "default", "mutable-content": 1 }, "t": "<opaque>" }`.
Safe Mode: title "Reminder", body "You have a reminder". Never names, text, images or event type. iOS does not reliably deliver silent `content-available` pushes to a closed app, so a pure silent wake would lose messages. The app fetches and renders the rest when opened. Preview levels Name only / Full (R-16.3) arrive with the notification service extension (`mutable-content` is already set). Throttle: 1 push per account per 20 s; type toggles and quiet hours applied server-side.
