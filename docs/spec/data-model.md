# Data model (server-side)

Principle: store the minimum; anything audience-restricted is E2EE or coarse-flagged. Server-visible = **SV**, ciphertext only = **CT**, RAM-only = **RAM**, device-only = **DEV**.

## Postgres

### accounts
| Column | Type | Notes |
|---|---|---|
| id | uuid | internal; never shown |
| created_at | timestamptz | |
| auth_passkey_ids | bytea[] | WebAuthn credential IDs |
| auth_oidc_hash | bytea null | SHA-256(provider‖sub‖pepper) for Apple/Google |
| email_hash | bytea null | magic link / recovery only |
| verified_at | timestamptz null | set by F-03 |
| verification_epoch | int | bumps on re-verify |
| status | enum(active, paused, quarantined, suspended, banned, deleted) | quarantined = shadow (shown to the account as active); suspended = read-only until the suspend action's ends_at |
| safe_mode | enum(auto, on, off) | |
| settings | jsonb | non-sensitive settings (F-17) |
| plus_until | timestamptz null | Later |
| birthdate | date | R-02.3 age gate + profile age; never returned by the API |
| age_confirmed_at | timestamptz | R-01.12 checkbox |
| onboarding_step | enum(basics, location, photo, verify, done) | F-02 resume |
| paused_at | timestamptz null | R-01.9 |
| incognito | bool | deprecated (#114, merged into Hidden); always false |
| hidden | bool | location level Hidden (no location_cells rows) |
| hidden_until | utc_datetime null | R-05.7 end of Hidden (null = until I switch) |
| hidden_return | text null | R-05.7 level to come back as: city \| area |
| safe_mode_active | bool | effective Safe Mode reported by the device (F-14) |

### passkeys
| id · account_id · credential_id bytea (unique) · cose_key bytea (public key) · sign_count |

### refresh_tokens
| id · account_id · device_id · token_hash bytea (HMAC) · expires_at · used_at (rotation) |

### cities (public reference data for S-04b / Welcome / F-20 trips)
| id · name · country · lat · lng · cell_r5 · population · search_key (lowercase, accents removed; prefix index) |
Loaded by migration from `server/priv/cities/cities.tsv`: GeoNames cities ≥ 15 000 inhabitants (CC BY 4.0, ~23 700 rows) + a short list of smaller travel spots; rows already present (same `search_key` + country) are kept.

### trips (F-20, #188)
| id uuid · account_id · city_id → cities · first_day date · last_day date · show_days smallint null (null browse only, 0 / 3 / 7 / 14) · say_from bool · created_at · updated_at |
Indexes: (account_id), (city_id, last_day). Deleted by `ExpirySweep` (every 15 min) at 12:00 UTC the day after `last_day`; deleted with the account. Never exposed as a list to others.

### trip_creates (F-20 rate limit)
| account_id · at | rows older than 30 d swept by `ExpirySweep` |

### moments (F-21, #212)
| id uuid · account_id · profile_id · storage_key · thumb_key · caption ≤ 80 · caption_style · audience (everyone, chats, favorites) · intents text[] · main_ok bool · status (uploading, live, review, rejected, hidden) · reject_reason · hash_state · hash_checked_at · hash_provider (#179) · ttl_s · expires_at · created_at |
Indexes: (profile_id, status, expires_at), (account_id, created_at), (expires_at). No location of any kind. Hard-deleted with their files by `ExpirySweep` at `expires_at` (uploads never published: after 1 h); files deleted with the account.

### moment_audience · moment_views · moment_mutes (F-21)
| moment_audience: moment_id · profile_id (chats / favorites list) | moment_views: moment_id · viewer_profile_id · at · tapped · screenshot (deleted with the Moment) | moment_mutes: account_id · profile_id · created_at (viewer mutes a poster) |

### devices
| id uuid · account_id · platform enum(ios, android, web) · attestation_ok bool · push_token_enc bytea (encrypted at rest) · mls_client_id bytea · last_seen_day date |

### profiles
| Column | Type | Notes |
|---|---|---|
| id | uuid | public handle id (random) |
| account_id | uuid | **never exposed in API** |
| kind | enum(now) | legacy, always `now`; one profile per account (unique on account_id) |
| show_in | text[] ⊆ {hookup, friends, sport}, ≥ 1 | lenses the profile appears in (F-06 R-06.1a) |
| display_name, age, gender (+ gender_other), here_for[], pronouns, orientation, languages[] | SV | Public fields (age stored as int, refreshed from birthdate) |
| bio, prompt_q, prompt_a | SV | |
| body (height_cm, weight_kg, build, hair, beard), tribes[] | SV | |
| looking_for[] | SV | |
| hookup_flags | int bitset | position, hosting, groups, practices (coarse flags for filtering) — served only to verified viewers |
| sport (sports[], level, schedule[], intent) | SV | |
| relationship | SV | |
| creator | bool | |
| visibility_map | jsonb | field → public/verified/chats/only_me |
| photo_ids | uuid[5] | ordered; [0] = main |
| completeness | smallint | |
| fields | jsonb (GIN) | catalogue values whose visibility is public/verified (`Thirstr.Profiles.Fields`); filters query it |
| public_updated_at | timestamptz | fuzzed ±1 h |
| updated_at | timestamptz | |

B1 stores the SV fields in the `fields` jsonb rather than one column each; `hookup_flags` is not used (jsonb filters instead).

Audience-restricted values (health, socials, limits, boundaries card) are **not** stored here; they are sent E2EE to chat partners (F-06 R-06.6).

### photos
| id · profile_id · slot (0–4) · storage_key · thumb_key (480 px copy, set only when it passed the classifier on its own, SR-10) · status enum(pending, ok_main, ok_public, rejected) · reject_reason · review_state · classifier_score jsonb (`main_ok` = passes strict check; only these show in Friends/Sport) · hash_state enum(no_match, match, unchecked, retry) null · hash_checked_at · hash_provider (#179, R-15.43) · created_at |

### location_cells (one row per visible profile, overwritten)
| profile_id pk · level enum(city, area, exact) · cell_r10 null (#197, Precise only) · precise bool (#197) · cell_r9 · cell_r8 · cell_r7 · cell_r5 (bigint = `h3index::bigint`; City stores r5 only) · updated_at · hide_from_hidden bool · display_res smallint (10/9/8/7/5; 10 only when precise and ≥ 3 visible in the r9 cell; k-anonymity, widened each minute when < 5 people share the cell) |
Exact coordinates are **not** here (Valkey).

### now_status
| profile_id pk · status enum(now, hosting, can_travel, door_open) · text · created_at · expires_at |

### tonight_plans
| id · profile_id · window_start · window_end · text (140) · tag enum(hosting, can_travel, drinks_first, party, other) · audience enum(verified, chats) · cell_r8 · cell_r5 · expires_at (06:00 local, from tz_offset_min) |

### parties
| id · host_profile_id · cohost_profile_id null · title · starts_at · ends_at · capacity · rules[] · audience enum(verified, chats, invite) · invite_code null · cell_r8 · cell_r5 · status enum(open, full, live, ended, cancelled) · hidden bool (2 reports) |
### party_requests
| party_id · profile_id · state enum(pending, accepted, declined, left) · rating null (up/down after end) · created_at |
### party_reports (party_id, reporter_account, reason, created_at; unique pair)
Address/door code: E2EE message to accepted guests, never in DB.

### activity_posts
| id · profile_id · club_id null · sport · title · place_text · venue_id null · starts_at · capacity null · intent enum(just_sport, open_to_more) · cell_r8 · cell_r5 · expires_at (start + 3 h) |
### activity_rsvps (post_id, profile_id, state)

### clubs / club_members
| clubs: id · name · sport · cell_r5 · description · join_policy enum(open, approval) · verified_club bool · created_at |
| club_members: club_id · profile_id · role enum(member, admin) · state enum(requested, member) · joined_at (first admin = owner, runs the club chat) |

### venues / venue_checkins
| venues: id · name · kind enum(sauna, bar, club, gym, other) · cell_r9 · cell_r5 · geofence_radius_m · hours null · tz_offset_min · added_by enum(team, partner) |
| venue_checkins: venue_id · profile_id (PK) · visible bool · zone (40) null · checked_in_at · auto_out_at (4 h); row deleted at check-out |

### taps (from_profile_id, to_profile_id, seen, created_at; unique pair; swept after 7 d)
### profile_hides (account_id, profile_id, created_at) — hidden from the viewer's Explore; listed in S-71 (#111)
### contacts (profile_a, profile_b, a_sent, b_sent) — who has messaged whom (pin audience "my chats", who-can-message)
### blocks (account_from, account_to) — account-level: blocks all profiles both ways
### vouches (from_account, to_profile, created_at; unique pair) — weight computed by SQL `vouch_count(profile)`: 1 for 6 months, linear to 0 at 12, reciprocal pairs × 0.5, max 20 (F-18)
### reports (id, reporter_account, target_account, target_profile, reason, context, note (500), franked jsonb {messages: [{t, text, at}]} (franking-verified only), severity 1–6, state enum(open, actioned, dismissed), action, created_at, resolved_at; one open report per reporter × target × reason)
### moderation_actions (id, target_account, action enum(quarantine, warn, remove_photo, hide_field, suspend, ban, release), reason, actor, created_at, ends_at (suspend), report_id, appeal_state enum(open, upheld, overturned), appeal_text, seen)
### csam_cases (#179, F-15 R-15.44–48)
| id uuid · state enum(open, confirmed, false_positive) · source enum(hash, classifier, report) · provider · match_ref · target_account · photo_id / moment_id / report_id (one) · sha256 bytea · evidence_key (in `evidence/`, AES-256-GCM, key wrapped) · snapshot jsonb (public profile at upload) · decided_by · decided_at · hold_until (default created_at + 1 y; legal hold extends) · created_at |
### csam_filings (case_id, authority enum(ncmec, fedpol, hotline, art18_police, europol), country, external_ref, filed_by, filed_at)
### hash_blocklist (sha256 bytea pk, case_id, created_at) — exact-bytes re-upload block; kept after the case's evidence expires
### mod_time (moderator, day, tier, seconds) — wellbeing counters (R-15.53), no content
### server_keys (name pk, der, created_at) — `verify_rsa`: F-03 blind-signature issuer key (RSA 3072), generated on first use
### spent_tokens (hash pk = sha256(token), created_at) — redeemed verification tokens, no link to the account (R-03.4)
### admin_audit (id bigserial, actor, action, object_hash (sha256 prefix of the object id), reason, at) — append-only (DB rules drop UPDATE/DELETE), R-AD.4
### linked_accounts (id uuid, profile_id, platform enum(x, bluesky, onlyfans, jff, instagram), handle (64), code, verified_at, checked_at, visibility enum(everyone, verified, chats), created_at)
### profile_shares (slug pk (10), profile_id unique, created_at) — I-02 share link; rotate = new row
### mls_key_packages (id bigserial, profile_id, device_id, key_package bytea, last_resort bool, created_at) — single-use; ≤ 200 per (profile, device); one last-resort per (profile, device)
### mls_messages (id bigserial, to_profile_id, to_device_id, from_profile_id, group_id bytea, kind welcome|commit|app, key_package_id, ciphertext bytea, created_at) — deleted on ack, swept after 30 d
### franking_tags (message_id, tag bytea, created_at) — R-07.11 commitments, swept with messages
### mls_send_keys (device_id, client_id, result jsonb, created_at; PK device_id + client_id) — R-07.18 idempotency, swept after 7 d
### mls_expired (to_device_id, group_id bytea, count, created_at) — R-07.22 swept-unread counts, deleted when reported to the device
### media_blobs (id uuid, account_id, storage_key, size, expires_at, created_at, once bool, fetched_by uuid null, fetched_at null) — E2EE ciphertext only; owner can delete. `once` = video check clip (R-18.12): bound to first fetcher, swept 10 min after first fetch
### chat_backups (account_id pk, manifest bytea, bytes bigint, segments int, inserted_at, updated_at) — CT; sealed with a key derived from the recovery phrase (F-01 R-01.15)
### chat_backup_segments (id uuid, account_id, storage_key, size, sha256 bytea, committed bool, created_at) — CT; uncommitted → swept after 24 h; dropped from the manifest → row deleted, object 24 h later
### device_transfers (id uuid, account_id, from_device uuid, to_device uuid, state sending|done, estimate, bytes, sent, acked, total, updated_at, created_at) + device_transfer_chunks (transfer_id, n, size, ready) — objects under `blob/xfer/{id}/{n}` are CT; chunk deleted on ack, transfer on cancel, done or 2 h idle (F-01 R-01.14)
### devices.push_token / push_platform — APNs/FCM token per device (content-free pushes)
### trusted_contacts — **not stored server-side** beyond relay tokens (F-13).
### safety_relays (id uuid, account_id, rid_hash bytea unique, intro bytea, accepted_at, push jsonb {endpoint, keys}, created_at) — one per trusted contact; rid and key device-only
### safety_msgs (id bigserial, relay_id, checkin_id null, kind notice|alert|panic|ok|loc, ciphertext bytea, release_at null (held) \| time, created_at) — deleted on contact ack or 24 h after release (R-13.10)
### checkins (id uuid, account_id unique, token_hash, due_at, extensions, due_pushed bool, created_at) — deleted on OK/panic; alerts released at due + 15 min

## Valkey (RAM-only, no persistence)
| Key | Value | TTL |
|---|---|---|
| `pin:{profile_id}` | lat, lng (jittered), audience, expires_at | user-chosen (30 min–4 h) |
| `ownpin:{account}` | pin info for Me | same |
| `vcell:{account}` | viewer cell for Explore (also when Hidden) | 24 h |
| `seen:{account}` | last request (online dot, 5 min) | 15 min |
| `hfh:{account}` | hide-from-hidden flag | 30 d |
| `sig:{signal}:{account}` | anti-bot signal counters (velocity, tap bursts) | window |
| `presence:{cell_r8}` | Phoenix Presence | live |
| `rl:{account}:{action}` | counters | window |
| `ip:{hash}` | abuse counters | 24 h |
| `dlink:{code}` | device-link state (account, state, claim hash, new platform, both one-time `xfer_pub` keys) | 120 s |
| `dlinkdone:{code}` | finished link → {account, new device} (R-01.14 transfer may start) | 2 h |
| `pushq:{account}` | push throttle (1 per 20 s) | 20 s |

## Object storage
- `public/{photo_id}.avif` — public photos (plaintext, CDN, signed URL 12 h, stable per 6 h window). `public/{photo_id}-t` — 480 px JPEG copy for cards and lists (SR-10), deleted with the photo.
- `blob/{random}` — E2EE media (ciphertext), deleted on all-recipients-ack or 30 d.
- `blob/xfer/{transfer}/{n}` — history transfer chunks (ciphertext), deleted on ack, cancel or 2 h idle.
- `backup/{account}/{segment}` — chat backup segments (ciphertext), deleted with the backup or the account.

## Device-only (SQLCipher)
Chats, private notes & tags, favorites, friends (F-07 R-07.32–36), trusted contacts list, health reminders, received media, albums keys, MLS state, recovery phrase (never stored, shown once).

Beta store: one encrypted key-value table (`expo-sqlite` + SQLCipher, key in Keychain). Keys: `convs`, `msg` table (one row per message, R-07.21), `outbox` table (R-07.17), `pending` (undecrypted ciphertext ≤ 24 h, R-07.20), `grp:{group}` (MLS state), `g2c:{group}`, `kp:{sha256}` (private key packages), `kp:lastresort:{profile}`, `albums`, `grant:{conv}:{album}`, `note:{profile}`, `quick:custom`, `tr:{conv}␁{message id}` (on-device translation cache, F-07 R-07.30), `recent.media` (Sent recently index + per-file keys, F-08 R-08.14; ciphertext files in `Documents/recent/`), `media.opts` (last tray options), `cache:explore` (last Explore first page for the current settings, ≤ 60 cards, 24 h; SR-16), `cache:profile:{id}|{mode}|{trip}` (profiles you opened, 24 h, newest 200; SR-16), `backup.state` (chat backup: segment list with SHA-256, message ids per chat already backed up, last run; F-01 R-01.15), `backup.prefs` ({on, cellular}); the chat backup key is derived from the vault key (Keychain) at each run. AsyncStorage `thirstr.restorePending` = restore asked on "You're back". Media message `media` and album items: `{blob, key, iv, mime, w?, h?}` (chat media also `size`, ciphertext bytes, #177); videos (`video/mp4`, `video/quicktime`) add `dur` (s). Temp video files: `Caches/vplay/` (only while the viewer is open). Wiped on sign-out and account delete. App preferences (AsyncStorage `thirstr.prefs`, not secret): units, haptics, media auto-delete, translate, `dataSaver` (`auto` | `always` | `off`, F-17 R-17.16). MapLibre's own tile cache (outside the store) is capped at 100 MB and cleared on sign-out, duress wipe and when Safe Mode turns on.

## Retention
| Data | Retention |
|---|---|
| Undelivered ciphertext | 30 d |
| Location cell | overwritten; deleted on Hidden or 24 h inactivity |
| Exact pin | TTL |
| Tonight / Now / activity posts | expiry + 1 h |
| Reports | 1 y (legal), franked payload deleted after decision + 90 d |
| Deleted account | hard delete ≤ 24 h; backups roll off ≤ 30 d |
| History transfer chunks | ack, cancel or 2 h idle |
| Chat backup | while on; 210 d without upload → deleted |

Enforcement is measured (EN-17): `Thirstr.Retention` counts rows past each deadline + grace and exports `thirstr_retention_overdue{rule}`; alert when > 0 for 1 h (`docs/runbooks/monitoring.md`). A new retention rule adds a probe there.
