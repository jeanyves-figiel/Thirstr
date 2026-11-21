# I-01 Shared posts & linked accounts

Issue #17. Owner decision 2026-11-21: **build all now, in closed beta** (D-23). [Mockup](https://claude.ai/artifact/LHYfbUwpEpAQviEa98VhPr) (6 boards), OK'd by the owner 2026-11-21 ("Build as shown"). Concept §5.

## Purpose
Guys already live on X, Bluesky, OnlyFans and JustFor.Fans. Two things should feel native in Thirstr:
1. **Share a post into a chat**: from any app's share sheet, pick one or more chats, send. The other side sees a rich card (author, text, thumbnail) without his phone ever contacting that platform.
2. **Show your accounts on your profile**, with a ✓ when Thirstr checked you own them, so people know the OnlyFans or X account is really you (anti-catfish, anti-impersonation).

Privacy first: Thirstr's server never sees which posts are shared, never fetches a shared URL, and keeps no platform tokens.

## Terms
- **Link card**: chat message `link.preview` (F-07 R-07.4): URL + preview built on the sender's phone, sent end-to-end encrypted.
- **Adult platform**: OnlyFans (`onlyfans.com`) and JustFor.Fans (`justfor.fans`). X and Bluesky are general platforms whose posts may still be explicit.
- **Linked account**: a handle on X, Bluesky, OnlyFans, JustFor.Fans or Instagram attached to the profile. **Proven** (✓) when ownership was checked (R-I01.17).
- **`adult_links` flag**: server feature flag (EN-13) that switches every adult-platform surface on or off per platform/build (R-I01.30).

## Rules

### A. Share into Thirstr (S-44)
- R-I01.1 **Share target.** iOS Share Extension (`targets/share`, bundle `app.thirstr.share`, built by `@bacons/apple-targets`) accepts one web URL, or text containing one (first `https://` URL wins; `http://` upgraded; other schemes refused). It shows only the ink background, hands the text to the app as `thirstr://share?url=<percent-encoded>` and closes; **no App Group, nothing stored**. Android `ACTION_SEND` follows with the Android build (#107). Opening the app first keeps App lock and the duress PIN in force (F-13 R-13.11, same reason as the Live Activity, R-13.20).
- R-I01.2 **Share sheet (S-44)**, full-height sheet over whatever screen was open:
  - top: the link card as the receiver will see it (R-I01.8), building state = skeleton with platform glyph and host, ready in ≤ 2 s on 4G (R-I01.5);
  - "Add a message" field (≤ 500 chars, optional, sent in the same message);
  - recipients: search field, then **Recent** (last 20 1:1 chats, unread first), avatar + name + last-seen line. Multi-select **max 5**; a chat where the other side hasn't replied yet is greyed with "Waits for his reply" (R-I01.22);
  - sticky coral **Send to N** button; after send: haptic + toast "Sent to N", sheet closes, app returns to the screen it was on (deep link `thirstr://chats/{id}` if exactly one chat).
- R-I01.3 Not signed in / onboarding not finished → app opens on sign-in; after sign-in the pending share sheet opens once (kept in memory only, dropped after 10 min).
- R-I01.4 **In chat**: pasting or typing one URL in the composer shows a compact preview chip above the composer within 1 s of the last keystroke (debounce 600 ms); ✕ on the chip sends plain text instead. Sending with the chip = one `link.preview` message whose `text` is the rest of the composer.
- R-I01.5 **Preview built on the sender's phone** (never on our server, never on the receiver's phone):
  - fetch with an ephemeral session (no cookies, no cache shared with other apps), generic UA `Mozilla/5.0 (compatible; Thirstr-Preview)`, `Accept-Language` = app language, 5 s timeout, ≤ 1 MB HTML read, ≤ 3 redirects, `https` only, refuse IP literals, `localhost`, `*.local` and private/link-local ranges;
  - platform readers first, then generic OpenGraph / Twitter Card / oEmbed discovery:
    | Platform | Source | Fields |
    |---|---|---|
    | Bluesky | `public.api.bsky.app` `app.bsky.feed.getPostThread` (depth 0) | author handle + display name, text (≤ 300), first image thumb, self-labels + moderation labels (`porn`, `sexual`, `nudity`, `graphic-media`) |
    | X | `publish.twitter.com/oembed?omit_script=1` | author, text (from the blockquote, ≤ 280); no image (X gives none without login) |
    | OnlyFans / JustFor.Fans | page OpenGraph | title, avatar/cover as thumb; never content behind login (no scraping, no cookies) |
    | anything else | OpenGraph → Twitter Card → `<title>` | title, description (≤ 200), image |
  - final URL = `og:url` if same registrable domain, else the last redirect target (so a shortener shows the real host);
  - thumbnail: first image, downloaded (≤ 5 MB), decoded and **re-encoded** to JPEG q 0.8, long side ≤ 480 px, EXIF stripped, target ≤ 40 KB; encrypted and uploaded as F-08 media (same key handling, same 30 d server TTL);
  - failure (timeout, blocked, no metadata) → card with host + URL only, never a blocking error.
- R-I01.6 Preview cache on the sender's phone: by normalised URL (lower-case host, no `utm_*`/`fbclid`/`si`/`s`/`t` params), 24 h, max 200 entries, LRU; one share uploads the encrypted thumbnail once and sends the same reference to every chat of that share (the key travels only inside each E2EE message).
- R-I01.7 Tracking parameters listed in R-I01.6 are **removed** from the URL that is sent.

### B. Link card in chat
- R-I01.8 **Card** (bubble width, 16 pt radius, Pop surface): header row with platform glyph (X, Bluesky butterfly, OF, JFF or a globe) + author/display name + host in `fg.secondary`; post text (≤ 4 lines, "more" expands); thumbnail 16:9 or 1:1 (as received) on top for posts with an image; footer: host (`bsky.app`, `x.com`, …) + "Open". Sender's message text, if any, sits above the card in the same bubble.
- R-I01.9 **Blur**: the thumbnail is blurred with "Tap to view" (same component as R-08.7) when any of: adult platform; Bluesky label in R-I01.5; receiver classifier (F-08 R-08.7) says explicit; Settings › Privacy › **Adult link previews** = Blur (default) — choices Blur · Show · No pictures. Unblurring is per card and stays on the phone.
- R-I01.10 **Open**: tap on the card → bottom sheet "Open ‹host›?" with the full URL (host bold, punycode shown decoded with a warning if mixed scripts) + **Open** + Copy link + Cancel. "Don't ask again for ‹host›" for X and Bluesky only (stored on the phone). Open uses the system: the platform app if installed (universal link / app link), else the default browser. **Never** an in-app web view (cookies, tracking, store review).
- R-I01.11 Card long-press menu = message menu (F-19) + **Copy link** + **Report** (R-I01.24).
- R-I01.12 Disappearing timers, view-once and delete-for-both apply to link cards like any message (F-07).
- R-I01.13 Old app versions that don't know `link.preview` show the URL as text (`fallback` field, F-07 compatibility rule).

### C. Linked accounts (S-63, S-20)
- R-I01.14 **Where**: Edit profile hub › **Linked accounts** row (shows "2 linked · 1 ✓") → S-63. Profile view S-20: a "Elsewhere" row of chips under About: platform glyph + `@handle` + teal ✓ if proven. Tap → R-I01.10 sheet.
- R-I01.15 **Add** (S-63b): platform grid (Bluesky, X, OnlyFans, JustFor.Fans, Instagram) → handle field (`@` prefilled, paste-friendly: a full profile URL is parsed into the handle) → **Who sees it**: Everyone · Verified · My chats (default) → next step = proof (R-I01.17). Max **5** per profile; one per platform.
- R-I01.16 Visibility filtering is **server-side** (`Linked.visible/4`), so old clients and the API never receive hidden handles. "My chats" = a 1:1 contact exists both ways (R-07.3 contact table, no content).
- R-I01.17 **Proof** per platform:
  | Platform | Method | Who checks |
  |---|---|---|
  | Bluesky | code `thirstr-xxxxxxx` in the public bio, or in the display name | server reads `public.api.bsky.app` `getProfile`; stores the **DID** so a later handle change keeps the ✓ (handle refreshed from the DID on each check) |
  | X | **Sign in with X** (OAuth 2.0 + PKCE, scopes `users.read tweet.read`) in the system auth sheet | server exchanges the code, reads `/2/users/me` (id + username), **revokes the token at once**; keeps username + numeric id only |
  | OnlyFans / JustFor.Fans | code in the public bio | server fetches the public profile page (fixed host + handle, no redirects off-host, 8 s); if the page can't be read (bot wall, JS-only) → **Checked by hand** queue (admin console, owner in beta, SLA 24 h): moderator opens the public page in a clean browser and taps Approve / Reject |
  | Instagram | none in beta | shown without ✓ |
- R-I01.18 Proof UX: the code is shown big with **Copy**, a **Open ‹platform›** button (opens the profile edit page of that platform where known), and **Check now**. States: Not checked · Checking… · ✓ Proven · Checked by hand (pending) · Not found ("We couldn't find the code in @handle's bio. It can take a minute to show.") After ✓: "You can remove the code from your bio now."
- R-I01.19 Re-check every **90 d** (daily sweep, ≤ 200 per run): Bluesky by DID, OF/JFF by page fetch (fail = keep ✓ but flag for hand check, never silently drop on a bot wall), X never re-checked (OAuth proof stands; ✓ removed if the X id now has another username → handle updated, ✓ kept). Bio code check passes only if the code is still there **or** the account was proven ≥ 1 day ago (user may remove it, R-I01.18): re-check confirms the handle still exists, not the code.
- R-I01.20 A handle proven by one Thirstr account cannot be proven by another (unique on `platform + platform_user_id`); conflict → "This account is already proven on Thirstr. Report if it's yours." (opens R-I01.24 impersonation report).
- R-I01.21 **Creator rule** (F-15 R-15.8): linking OF/JFF does not make a profile a Creator. Linking OF/JFF with visibility **Everyone** shows a one-time note "Fine to show your page. Sending promo links to lots of people isn't: that needs a Creator profile (F-15 R-15.8)." Creator self-declare UI is not part of #17. Promotion signals in R-I01.23.

### D. Guardrails
- R-I01.22 Link cards obey R-07.3: never the first message to a new contact; allowed once the other side replied. Group chats: allowed (members already consented to the group).
- R-I01.23 **Rate and duplicate signals without seeing links**:
  - phone limits: ≤ 5 chats per share, ≤ **40 link cards / 24 h** per account (counter on the phone; over the limit → "You've shared a lot today. Try again tomorrow.");
  - with each `link.preview` send the client adds `lh` = first 8 bytes of HMAC-SHA256(**device-only key**, normalised URL) to the send request (not to the ciphertext). The server can count "same link to many people **from this sender**" but cannot learn the link, compare senders or test guesses (it never has the key);
  - server signal (R-15.5): one `lh` reaching 15 distinct recipients in 24 h records `link_fanout` (Valkey, 24 h window, never stored in the DB or logged); 3 of those in 24 h → shadow quarantine review (R-15.6). Adult-platform host + ≥ 15 recipients/24 h → the phone shows the R-I01.21 note again (the phone knows the host; the server learns nothing about it).
- R-I01.24 **Reports**: link card ⋯ → Report → **Shared without consent** (`non_consensual`, severe), **Spam / promotion** (`spam_bot`), **Something else**. The franked message (R-07.11) carries `url`, `title`, `text` only (no thumbnail). The card is hidden for the reporter at once. Profile view: long-press a linked chip → **Not his account** = `POST /reports` with `reason: impersonation`, `note: linked:<platform>`; ≥ 2 independent reports → ✓ removed and chip hidden pending review.
- R-I01.25 No link cards inside Moments, Tonight plans, party descriptions or bios (text fields keep their existing link rules).

### E. Store review & Safe Mode
- R-I01.26 Age rating stays 17+ (App Store) / Mature 17+ (Play). App Review notes list the feature and the demo account (ops runbook `docs/runbooks/store-review.md`).
- R-I01.27 The app ships **no adult-platform content**: no preview is fetched by us, nothing is embedded, links open outside the app (R-I01.10).
- R-I01.28 **Safe Mode** (F-14) on → OnlyFans / JustFor.Fans links are hidden on the own profile for everyone, link cards from those hosts show host only (no title, no thumbnail), and the add grid hides those two platforms.
- R-I01.29 Linked OF/JFF accounts are never shown to viewers under 18 (n/a, 18+ only) and never in the Friends or Sport lens (F-06 R-06.3): only Hookup.
- R-I01.30 **`adult_links` flag** (EN-13, default on). New rule `off_builds` (per platform list of native build numbers). Before a store submission, ops sets `Flags.set("adult_links", true, %{"off_builds" => %{"ios" => [<build>]}})`, so the build under review (and only it) shows no OF/JFF: no platform tiles, profile chips filtered **server-side** by the request's build, link cards from those hosts degrade to host-only, share sheet still sends them as plain text. After approval, ops removes the build from the list; nothing ships again. Kill switch: `enabled = false` hides it for every build.

### F. Privacy, energy, performance
- R-I01.31 Server never fetches a shared URL; only fixed profile URLs on 4 hosts (Bluesky AppView, X API, onlyfans.com, justfor.fans) for proofs. Egress allowlist in config; no user-controlled host, path built from a validated handle (`^[a-z0-9._-]{1,64}$`).
- R-I01.32 Logs and metrics never contain shared URLs, titles or `lh` values (AC-I01.1). OAuth codes and tokens are never logged; token discarded after the single `/users/me` call (AC-I01.2).
- R-I01.33 The receiver's phone makes **no network call** for a card except the encrypted thumbnail download (≤ 40 KB), so opening a chat never tells any platform who you are or where.
- R-I01.34 Energy/data: preview fetch only on explicit share/paste, never in the background; ≤ 1 MB per preview; thumbnails follow Data saver (≤ 40 KB, always loaded, F-17 R-17.16).
- R-I01.35 Export (R-01.11) includes linked accounts (platform, handle, visibility, proof method, proven at). Delete account deletes them at once.

## Acceptance criteria
- AC-I01.1 Server logs, DB and metrics contain no shared URL, title, post text or `lh` (grep test on a staging run with 20 shares).
- AC-I01.2 X OAuth: token revoked and not persisted; only `x_user_id` + username stored.
- AC-I01.3 Share from X, Bluesky, OnlyFans, JustFor.Fans and Safari (iOS) / Chrome (Android) opens S-44 in ≤ 1.5 s (warm) and the card is ready in ≤ 2 s on 4G.
- AC-I01.4 Receiver opening a chat with 10 link cards makes 0 requests to any host other than our media storage.
- AC-I01.5 OF/JFF cards are blurred by default; a Bluesky post labelled `porn` is blurred.
- AC-I01.6 Build listed in `off_builds` shows no OF/JFF anywhere (UI test + API test on `/profiles/{id}` with that build header).
- AC-I01.7 A link card can't be sent as first message to a new contact (client + test).
- AC-I01.8 Same Bluesky account can't be proven by two Thirstr accounts.
