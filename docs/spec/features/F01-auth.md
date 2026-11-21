# F-01 Auth & account

## Purpose
Create and access an account with zero identity leakage: no phone, no password.

## Scope
Beta: passkey, Apple, Google, email magic link, device link by QR, recovery phrase, pause, delete, export. Later: encrypted cloud backup UI polish.

## User stories
- As a new user I create an account in one tap with Face ID.
- As a user without passkey support I use Apple/Google/email.
- As a user with a new phone I get back in with my synced passkey or by scanning a QR on my old phone.
- As a user I can pause or delete my account instantly.

## Rules
- R-01.1 Passkey is the primary CTA. Apple/Google/Email secondary. **No phone number, no password, anywhere.**
- R-01.2 OIDC: store only `SHA-256(provider‖sub‖server_pepper)`. Never email/name from the provider. Apple "Hide My Email" accepted. iOS (#25): Apple via the native sheet (no scopes); Google via authorization code + PKCE in the system browser with the iOS OAuth client (`openid` scope only, redirect `com.googleusercontent.apps.<id>:/oauthredirect`). Server accepts Google ID tokens with `iss` `https://accounts.google.com` or `accounts.google.com` and `aud` in `GOOGLE_CLIENT_IDS`.
- R-01.3 Email magic link: email stored hashed; link valid 15 min, single use; response is always 202 (no account enumeration). An account made with Apple/Google/passkey can add a sign-in email later (`POST /me/email`, [RF-7](../required-fields.md)).
- R-01.4 One account per verified human (enforced at F-03, not here).
- R-01.5 Access token 15 min; refresh 30 d, bound to device key; rotate on use (re-use > 60 s after use revokes the device; within 60 s is a client race → 409, #116; the app runs one refresh at a time and signs out only on 401/403); revoke all on "Log out everywhere".
- R-01.6 Device link: old device shows QR (expires 120 s) → new device scans → old device confirms with Face ID / Touch ID or the phone passcode (always asked when the phone has one, App lock on or not; #25) → MLS adds new device to the user's groups → optional chat history transfer (R-01.14).
- R-01.7 **Recovery phrase + sealed backup** (#25, [mockup, option B picked 2026-11-21](https://claude.ai/artifact/Pg5CERwBK7harpHies1ZJ7)). Optional. 12 English BIP-39 words (128-bit entropy, checksum), made on the phone, shown once, never sent or stored anywhere by Thirstr.
  - **Keys** (on the phone): `e = entropy(words)`; `HKDF-SHA256(e, salt "thirstr-recovery-v1")` → info `signin` = Ed25519 seed (sign-in key), info `vault` = AES-256-GCM key. Server stores only the Ed25519 public key (32 B, unique) and the sealed backup ciphertext. The phone keeps the vault key in the Keychain (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`) to update the backup; never the words or the sign-in key.
  - **Where offered**: once on "You're verified" (card "Keep a way back in": Set up recovery phrase / Not now; Not now never shows it again) and always in Settings › Account › Sign-in › **Recovery phrase** (Off / On · since ‹date›).
  - **Setup** (S-64a): intro (3 lines: only you have them; they work when nothing else does; they unlock your sealed backup; coral "Chats don't come back") → **Show my 12 words** asks Face ID / passcode (R-01.6 `deviceAuth`) → words in a 2 × 6 numbered mono grid, blurred until press-and-hold (blur back on release; screenshot → warning toast) + sun warning "Anyone with these words can sign in as you. Thirstr will never ask for them." → **I wrote them down** → check: 3 random positions, 4 word chips each (3 decoys from the list), wrong pick = shake + "Show the words again" → `PUT /me/recovery {public_key}` + first backup upload → "Recovery phrase on".
  - **On** (Settings row opens): since ‹date›, last backup ‹time›, **Make new words** (Face ID; replaces the public key at once, re-seals the backup with the new key; old words stop working) and **Turn off** (Face ID; deletes key and backup).
  - **Sealed backup**: JSON `{v: 1, albums, notes, favorites, friends}` (album list with item keys/blob ids, private notes, favorites, friends), AES-256-GCM with a random 96-bit IV, AAD `thirstr-vault-v1`. ≤ 1 MB (album item keys are ~100 B each). Uploaded at app start / foreground when its SHA-256 changed and the last upload is ≥ 1 h old (and right after setup). Never photos, never chats. Deleted with the key and with the account.
  - **Sign in with the words** (S-02 login mode only): text link "Lost your phone? Use recovery phrase" → 12 fields (next on space / return; suggestion bar of up to 3 list words matching the prefix; Paste fills all; a field turns coral if not a list word) → **Sign in** enabled when the checksum is valid → `POST /auth/recovery/options` → sign `"thirstr-recovery:" ‖ challenge` → `POST /auth/recovery` → session for this phone; **every other device of the account is signed out** (they may be lost or stolen). Then the app downloads and opens the sealed backup (albums, notes, favorites, friends restored) and shows "You're back" (what came back, what didn't).
  - **Limits**: 5 failed sign-ins per 10 min per IP and per install → 1 h wait (`rate_limited`). Unknown key and bad signature answer the same 401 `recovery_invalid`. Account status is kept (paused, quarantined, suspended sign in as today; banned/deleted → 403). The words can't make a new account.
- R-01.8 Max 5 devices per account (revoked devices waiting for a resume don't count).
- R-01.13 Device resume (SR-04, #144): a revoke by refresh re-use (R-01.5) keeps the device row and its queued chat messages for 7 d. Each sign-in returns `device_id` + `device_secret` (Keychain); the next sign-in of the same install sends them (`x-thirstr-device`, `x-thirstr-device-secret`) and, after the full sign-in, gets the same device back with a new secret. Not resumed in 7 d → device and queue deleted. "Log out" / "Log out everywhere" delete at once.
- R-01.14 **Chat history to a new phone** (#146, decided 2026-11-21: phone-to-phone at device link): right after R-01.6 the old phone asks "Bring your chats to the new phone?" with **All chats** (default) / **Last 12 months** / **Not now**, switch **Photos and videos** (default on on Wi-Fi, off on mobile data) and the estimated size.
  - **Key**: the R-01.6 QR carries the old phone's one-time X25519 public key; the new phone sends its own one-time key in the link request. Both derive `HKDF-SHA256(ECDH, salt "thirstr-xfer-v1")` → AES-256-GCM key. Both phones show the same 6-digit code (from both public keys); the old phone's confirm (Face ID / passcode) says "Check the new phone shows ‹code›". The server only relays ciphertext.
  - **Stream**: the old phone reads its store (R-07.21) chat by chat, newest first, and sends sealed chunks (≤ 4 MiB plaintext, deflated, random 96-bit IV, AAD `thirstr-xfer-v1 ‖ transfer id ‖ chunk n`) through `blob/xfer/{id}/{n}`; the new phone is told over its socket (`device:<id>` `xfer.chunk`), downloads, commits each chunk to its store in one transaction, then acks (the server deletes the chunk). At most 4 chunks in flight. Rows keep their message `id`, so a retry or a later live copy is a no-op.
  - **What moves**: messages (text, reactions, receipts state, media references), received and sent media files (re-sealed in the chunk) when Photos and videos is on, conversation list, pins, mutes, drafts. Not moved: MLS state (the new phone has its own leaf, R-07.13), view-once items, messages whose disappearing timer ends within 1 h (others keep their end time), translation cache (R-07.30), Explore / profile caches.
  - **UI**: both phones show "Moving your chats" with a progress bar (chats n/N, MB), **Pause** and **Cancel**; both screens stay on (no sleep) while it runs; the new phone is usable meanwhile (chats appear as they land, "Older messages still arriving" row). Mobile data with more than 50 MB → asks "Use mobile data?" first. App in background: continues for the OS grace period, then pauses and resumes at the next foreground of both phones. Done → "All your chats are here" (n chats, n messages, n photos and videos). Items that failed are listed and can be retried once from the old phone.
  - **Limits**: one transfer at a time per account; transfer expires 2 h after its last chunk (chunks and the row deleted); total ≤ 20 GiB. Old phone keeps everything (it is a link, not a move); the user can log it out afterwards.
- R-01.15 **Chat backup** (#146, opt-in, decided 2026-11-21): Settings › Chats & media › **Chat backup**: **Off** (default) / **On**. Needs the recovery phrase on (R-01.7); turning it on with the phrase off opens phrase setup first.
  - **Key**: `HKDF-SHA256(vault key, salt "thirstr-chats-v1")` → AES-256-GCM key, kept in the Keychain like the vault key. The server stores ciphertext only; no one, Thirstr included, can open it without the 12 words.
  - **Format**: append-only **segments** (≤ 4 MiB plaintext, deflated, sealed, random IV, AAD `thirstr-chats-v1 ‖ segment id`) holding message rows added since the last segment plus **tombstones** (delete for me, chat delete, disappearing end) so a restore honours deletions; a sealed **manifest** (≤ 256 KiB) lists segments with SHA-256. Compacted (rewritten) when tombstoned rows > 30 % or segments > 200. View-once and messages with a disappearing timer under 24 h are never backed up.
  - **Options**: **Photos and videos** (default off; text is always in), **Back up over mobile data** (default off). Quota 2 GiB per account: text always kept, oldest media dropped from the backup first when over.
  - **When**: daily, as a background task that asks for Wi-Fi and power (iOS `BGProcessingTask`, Android WorkManager `UNMETERED` + charging); else at app foreground on Wi-Fi when the last run is ≥ 24 h old. Row shows "Last backup ‹time› · ‹size›" and **Back up now**.
  - **Restore**: after a recovery sign-in (R-01.7) the "You're back" screen adds **Restore chats (‹size›)**; any other sign-in on a phone with no chats shows it in the Chats list when a backup exists and asks for the 12 words. Text first (newest first), then media; chats are usable as they land; Wi-Fi asked first above 50 MB.
  - **Ends**: Off or recovery phrase off → backup deleted at once; **Make new words** → full re-upload under the new key, then the old backup is deleted; deleted with the account (≤ 24 h). Not used for 180 d (no upload) → reminder push, deleted 30 d later.
- R-01.9 Pause: profiles hidden everywhere, chats kept, can resume anytime.
- R-01.10 Delete: confirm with biometrics + type "DELETE"; hard delete server data ≤ 24 h; client wipes local DB immediately; MLS leave all groups.
- R-01.11 Export (GDPR Art. 20, #25, [mockup](https://claude.ai/artifact/Pg5CERwBK7harpHies1ZJ7)): Settings › Account › Download my data. The phone packs **one .zip** and opens the share sheet: `data.json` (server archive from `GET /account/export` + device-only data: chats as text, private notes, favorites, friends, trusted-contact names, album index), `photos/<profile>-<slot>.jpg` (profile photos, fetched with the archive's 1 h URLs, which are then left out of `data.json`), `albums/<name>-<id>/<nnn>.<ext>` (private album photos and videos, decrypted on the phone with its keys). Built and kept on the phone only; the server never stores an archive, so nothing waits ≤ 24 h. Streamed to a cache file (one item in memory at a time; media stored, JSON deflated). Sheet "Packing your data" shows per-stage counts (Account and profile ✓, Profile photos n/N, Private albums n/N, Chats N) and Cancel (deletes the partial file). Item that can't be fetched → skipped, listed with `file: null`. Server limit 3 exports / 24 h. Web: same zip, downloaded.
- R-01.12 18+ confirmation on sign-up (checkbox); verification later enforces age.

## States
`anonymous → registered (unverified) → verified → paused ↔ verified → deleted`; `quarantined`, `banned` set by F-15.

## Interactions
| Action | Result |
|---|---|
| Tap "Continue with passkey" | OS passkey sheet → success → F-02 Basics |
| Cancel passkey sheet | Stay; show secondary options |
| Tap "I already have an account" | OS passkey login sheet (+ other methods below) |
| Email submit | "Check your inbox" screen; deep link opens app logged in |

## Edge cases
- Passkey created but network fails → retry silently 3×, then "Try again".
- OIDC account later adds passkey → both work.
- Device lost + no recovery phrase + no other device → email/OIDC login restores account (profiles, verification) but not chats.
- Banned account tries to re-register → blocked at verification (credential reuse detection, F-03 R-03.6).

## Privacy
No PII stored. Auth logs keep hashed IP 24 h.

## Acceptance criteria
- AC-01.1 New user reaches Basics in ≤ 2 taps via passkey.
- AC-01.2 No API or DB field contains a phone number or plaintext email.
- AC-01.3 Email link endpoint returns 202 for unknown and known emails with identical timing (±50 ms).
- AC-01.4 Deleting account removes all server rows within 24 h (verified by job).
- AC-01.5 QR link expires after 120 s and is single-use.
- AC-01.6 Recovery: no API field or table holds the words, the sign-in private key or the vault key; the backup is opaque ciphertext; a recovery sign-in signs out every other device.
- AC-01.7 (#146) Transfer: a phone with 10 000 messages and 500 photos moves to a new phone with nothing lost or duplicated after a kill of either app mid-way and a resume; the server never holds a readable chunk; a wrong 6-digit code check is possible on both screens.
- AC-01.8 (#146) Chat backup: off by default; restore with the 12 words on a fresh phone brings back every backed-up message and none deleted before the last backup; no server field or object is readable without the words.
