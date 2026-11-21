# F-21 Moments (temporary photos)

Issue #212 (owner request 2026-11-21: "temporary pics, a little bit like Instagram stories"). [Mockup](https://claude.ai/artifact/Ctum8QhK6cBFwWytjziZu1). Decision D-21 (**pending owner pick**: placement D-21a, viewer list D-21b).

## Purpose
Show what you look like **right now**, tonight, at the gym, getting ready, without touching your profile photos. A Moment is a photo that disappears on its own (1 h / 6 h / 24 h), shown to an audience you choose. It is the fastest way to say "I'm up for it" with a face, and the best answer to stale profile photos (a top complaint about competitor apps). Free (R-17.1).

## Terms
- **Moment**: one photo + optional caption, owned by an account, with an audience and an expiry. Max **10 live** per account.
- **Ring**: the visual marker that a person has live Moments the viewer is allowed to see.
- **Unseen**: the viewer has not yet opened every live Moment of that person.

## Rules

### Posting
- R-21.1 Entry: (a) Me › top card "＋ Moment" next to the profile photo; (b) Explore floating bar avatar long-press → "Post a Moment"; (c) long-press the Me tab (G-15 shortcut adds "Post a Moment"); (d) own ring tap when no Moment is live. Opens the **composer** (S-74): camera first (front camera default, flash, flip, shutter 76 pt), roll strip under it (last 30 photos, same access rules as R-08.12 tray).
- R-21.2 Composer edit step (S-74b), full-screen photo with tools on the right: **Crop** (9:16 default, 4:5, 1:1), **Blur** brush (finger-painted, 3 sizes, undo) and **Blur faces** one-tap (on-device face detection, Vision / ML Kit; blurs every face except the poster's if he chooses "Keep mine"), **Caption** (≤ 80 chars, one line, 3 styles: clean, pill, Pop highlight in the current intent colour). No stickers, no location, no time stamp, no mentions in v1 (nothing that can place or name a person).
- R-21.3 Bottom bar of the edit step: **Who sees it** chip (R-21.6), **Lasts** chip cycling 1 h · 6 h · **24 h** (default, last used remembered), intent chips Hookup · Friends · Sport (which lenses see it; default = own `show_in`, R-06.1b), coral **Share** button. Live preview line under the bar: "Everyone who can see you · 24 h · Hookup".
- R-21.4 Processing on the phone before upload: re-encode JPEG 0.85 → server stores AVIF; max 1440 × 2560; EXIF/GPS/maker notes stripped (R-08.1, AC-08.1); blur is **burned in** (the unblurred original never leaves the phone); a 480 px copy is uploaded next to it for rings and thumbnails (SR-10). On-device CSAM / minor check before sending (R-08.8).
- R-21.5 Upload is optimistic: the own ring shows a progress arc; failure → own ring red dot + "Tap to retry". Posting is rate-limited server-side: **10 live**, **20 per rolling 24 h** (429 `rate_limited`, "You can post 20 Moments a day").

### Audience
- R-21.6 **Who sees it** (per Moment, default = last used, first time = Everyone):
  - **Everyone who can see me**: anyone the Explore visibility rules would show this profile to (R-04.9: blocks both ways, hides, `hide_from_unverified`, `hide_from_new`, age range, Safe Mode, lens `show_in` ∩ the Moment's intents). Hidden posters (R-05.7) can't pick this (greyed, "You're hidden: only people you chat with").
  - **People I chat with**: accounts with at least one message exchanged both ways in a 1:1 chat (server knows the pair exists, never the content).
  - **Favorites**: accounts in the poster's chat Favorites (R-07 #115). Favorites list never leaves the poster's account; the server only receives the resolved audience id list for that Moment.
- R-21.7 Audience is fixed at posting; **Delete** is always possible (R-21.13). Blocking someone removes the Moment from him at once; un-hiding does not add him back to Moments posted while hidden.
- R-21.8 **Lenses**: Friends and Sport lenses only show Moments that pass the strict check (`main_ok`, R-15.10). A Moment that fails `main_ok` is shown only in Hookup even if Friends/Sport were ticked; the composer says so after the check ("Shown in Hookup only: too spicy for Friends").

### Where Moments show (placement: D-21a)
- R-21.9 **Option A, Rings only (recommended)**: a 2.5 pt ring around the person wherever his face appears: grid tile (inset border), map pin / avatar, profile photo (S-20), chat header and inbox row (S-40/41), Tonight cards. Ring = Pop gradient (coral → violet → lime, token `moment`) when unseen, `line` (#39346A) when all seen. Tap the ring area / the small "▶ Moments" tag on the profile photo → viewer. On grid tiles a tap still opens the profile (the ring only marks); the profile opens on the Moment first when unseen, with a "Profile ↓" handle to skip.
- R-21.10 **Option B, Moments row + rings**: everything in A, plus a horizontal **Moments row** at the top of the grid sheet (above "Active now"): 64 pt circles, own first ("＋ You"), then people with unseen Moments nearest first (same order as the grid, R-04.5), seen ones at the end; max 30; hidden when empty or in peek snap. Tap → viewer that auto-advances person to person in row order.
- R-21.11 **Viewer** (S-75): full screen, segmented progress bars on top (one per Moment, 6 s each, tap right/left = next/previous, hold = pause, swipe left = next person (B only, A: closes), swipe down = close). Header: avatar, name, age, distance bucket (as in Explore), "2 h ago", ⋯ menu (Mute Moments from him, Hide, Block, Report). Bottom: reply field "Reply to ‹name›…" + 🔥 (sends a Tap with the Moment attached) + ✈︎ (opens chat). Reply sends a normal E2EE chat message with a quoted thumbnail of the Moment (thumb shows until the Moment expires, then "Moment expired").
- R-21.12 Receiver safety: explicit-but-allowed Moments (passed the permissive check, failed `main_ok`) are blurred with "Tap to view" when the viewer's Settings › Chats & media › "Blur spicy photos" is on (R-08.7 setting reused). Viewer's own **Mute Moments** (per person) removes the ring for that person without telling him.

### Own Moments
- R-21.13 Own ring tap → own viewer: same as S-75 plus bottom bar **Seen by N** (D-21b), **Delete** (instant, no confirm, toast with Undo 5 s), **⋯** (Save to phone, Change who sees it → only narrower).
- R-21.14 Me shows "Live Moments · 3" row with time left of the next to expire. Expiry notifications: none (no nagging).

### Who viewed (D-21b)
- R-21.15 **Option A, Names**: Seen by list (avatar, name, "12 min ago", 🔥 if tapped). Viewers who are Hidden appear as "Someone hidden".
- R-21.16 **Option B, Count only**: "Seen by 34 · 🔥 5". No names ever.
- R-21.17 **Option C, Names unless they watch quietly (recommended)**: Settings › Privacy › **Watch Moments quietly** (default off). On: your views count but your name never shows; reciprocal: you also see only counts on your own Moments. Hidden viewers always count as quiet.

### Privacy & anti-leak
- R-21.18 Screenshots: Android FLAG_SECURE on composer and viewer (no capture at all). iOS: screenshot or screen recording detected → poster gets "‹name› took a screenshot of your Moment" in the viewers list (and as a quiet notification); screen recording → the viewer content is replaced by a blurred frame while recording (UIScreen.isCaptured).
- R-21.19 Invisible per-viewer watermark is **not** possible for public broadcast at scale in v1 (one file for many viewers); instead each Moment URL is signed per viewer (5 min TTL) and fetch logs (viewer id, Moment id, time) are kept 7 days for leak investigation on report, then deleted.
- R-21.20 No location data: a Moment carries no cell, no place, no check-in. Viewers see the poster's distance bucket exactly as on his profile (never more precise).
- R-21.21 Safe Mode (F-14) poster: audience forced to People I chat with or Favorites; viewer in Safe Mode: rings shown only for people he chats with.
- R-21.22 Expiry: at `expires_at` the Moment disappears from every surface (clients check `expires_at` locally too, no network needed); the server sweep (`ExpirySweep`, every 15 min) deletes the blobs from storage and purges the CDN, and deletes view rows. Nothing kept after expiry except the poster's own copy if he chose Save to phone. Not in data export after expiry; live ones are in the export.
- R-21.23 Delete account / duress wipe / pause → all Moments deleted / hidden at once.

### Moderation
- R-21.24 Classifier (R-15.10) runs before the Moment goes live (p95 < 2 s; the poster's own ring shows "Checking…"): **permissive** rules = public photos 1–4 (underwear, shirtless, suggestive OK; genitals and sex acts rejected → "This Moment can't be shared: no genitals or sex in Moments. Use a private album for that." + link to Albums). `main_ok` computed too (R-21.8). Borderline → human queue; stays hidden until reviewed.
- R-21.25 Report from the viewer ⋯ → S-50 with Moment context; ≥ 2 serious reports → auto-hide (beta rule R-15.13). Text in captions passes the same filter as bios.
- R-21.26 Anti-bot: posting needs a verified account (unverified: composer opens a verify prompt). Accounts younger than 24 h: max 3 Moments.

## Performance & data saving
- R-21.27 Rings come with existing payloads: Explore cards and profiles gain `moments: {live: n, unseen: bool}` (2 fields, no extra call). The viewer fetches `GET /moments/:account_id` only when opened; the next person's first Moment is prefetched (480 px copy first, full image when the viewer opens it). On cellular with Low Data Mode, only 480 px copies load until tapped "Full quality".
- R-21.28 Seen state is kept on the device (SQLCipher `moments.seen`, ids expire with the Moment) and posted in batches (`POST /moments/views`, max every 10 s) for the viewer counts.

## API (api.md › Moments)
- `POST /moments` (multipart: image, thumb, caption, audience `everyone|chats|favorites`, intents[], ttl `3600|21600|86400`) → 201 `{id, status: "checking"|"live"|"rejected", expires_at}`.
- `GET /moments/:account_id` → live Moments the caller may see `[{id, url (signed, 5 min), thumb_url, caption, caption_style, created_at, expires_at, spicy: bool}]`; 404 when none / not allowed (no difference between the two).
- `POST /moments/views` `{ids[]}`; `POST /moments/:id/tap`.
- `GET /moments/mine` → own live Moments with `seen_count`, `tap_count`, `viewers[]` (per D-21b), `screenshots[]`.
- `DELETE /moments/:id`.
- `PATCH /me/settings` gains `moments_quiet` (D-21b C).
- Socket: `moments:{account_id}` events `posted`, `deleted` for people the viewer has in view (rings update live).

## Data (data-model.md)
`moments`: id · account_id · blob_key · thumb_key · caption · caption_style · audience enum · intents text[] · main_ok bool · status enum (checking, live, rejected, hidden) · created_at · expires_at (index). `moment_audience` (moment_id, account_id) only for `chats` / `favorites`. `moment_views` (moment_id, viewer_id, at, tapped bool, screenshot bool), unique (moment_id, viewer_id), deleted with the Moment. All rows hard-deleted at expiry + sweep.

## Design
New token `moment` (gradient coral #FF6B5B → violet #A78BFA → lime #B8F04A, 135°) used only for unseen rings and the composer Share glow. Seen ring `line`. Progress bars white 90 % / 30 %. Motion: ring → viewer open is a shared-element zoom from the tapped avatar (`motion.slow`), close reverses it; Reduce Motion → cross-fade.

## Later (not v1)
Videos (needs #138 metadata stripping), music, polls, close-friends lists beyond Favorites, Moments in parties / venue pages.

## Acceptance criteria
- AC-21.1 A Moment uploaded from a photo with GPS EXIF has no EXIF on the server; blurred areas are blurred in the stored file.
- AC-21.2 A Moment with audience `favorites` is returned by `GET /moments/:id` only to favorites; others get 404, identical to "no Moment".
- AC-21.3 Blocked (either way) viewers never get rings or Moments; blocking removes access immediately.
- AC-21.4 At `expires_at` + 15 min the blob and thumb return 404 from storage and CDN, and no `moment_views` rows remain.
- AC-21.5 A Moment that fails `main_ok` is never returned to Friends or Sport lens viewers.
- AC-21.6 11th live Moment or 21st in 24 h → 429; unverified account → 403 `not_verified`.
- AC-21.7 Android: screenshot of the viewer yields a black image. iOS: screenshot creates a `screenshot` flag visible to the poster.
- AC-21.8 Explore payload size grows by ≤ 20 bytes per card; opening the viewer starts showing the first image < 400 ms p95 on 4G (thumb first).
