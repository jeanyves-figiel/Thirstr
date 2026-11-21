# I-02 Profile share link & GDPR-export import

## Share link / QR (MVP, #8, [mockup](https://claude.ai/artifact/PmAkuXFdHgSc8RNaP1cHyV))
Purpose: put a way to reach you on Thirstr in your bio on other apps, a story or a card, without giving away more than a stranger on Explore would see, and less.

- R-I02.1 **One link per profile**, off until the owner creates it. `https://thirstr.fun/p/{slug}`; slug = 10 chars from `abcdefghijkmnpqrstuvwxyz23456789` drawn with a CSPRNG (`:crypto.strong_rand_bytes`, rejection sampling; ≈ 2⁵⁰ space). **New link** replaces the slug (old one dead at once); **Turn off** deletes it. The slug carries nothing about the account (never the profile id).
- R-I02.2 **Public page** `GET /p/{slug}` shows only: the display name, a **blurred photo** (when the owner leaves "Blurred photo on the page" on, default on), "Chat me safely on Thirstr.", **Open in Thirstr** (`thirstr://p/{slug}`), store buttons, a one-line privacy footer. Never age, distance, location, lens fields, stats, verification, other photos or last seen.
  - The blur is made **on the owner's phone**: the main photo is scaled to 16 × 20 px JPEG (≤ 2 KB) when the link is created or renewed, when the toggle turns on, and whenever the Share sheet opens and the server says the preview is missing or no longer matches the main photo (`has_preview: false`); `PUT /me/profiles/{id}/share/preview`. The page embeds it as a `data:` URI and scales it up with CSS blur. The full photo, its storage key and any signed URL never reach the page, so no detail can be recovered from the page source.
  - The preview stores the photo id it came from; if that photo is no longer the approved main photo (`ok_main`), the page shows no photo until the phone sends a new preview.
- R-I02.3 **In the app** a tap on `thirstr://p/{slug}` or the universal link `https://thirstr.fun/p/{slug}` calls `GET /v1/share/{slug}` → `{profile_id}` and opens S-20 through the normal profile read (blocks both ways, Safe Mode, lenses, Hidden rules). Not found, blocked or not visible → toast "This profile isn't available." (same text for every reason). Own link → S-66 Preview.
- R-I02.4 **No tracking**: no scripts, cookies, analytics, query params or third-party requests. Headers: `Content-Security-Policy: default-src 'none'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`, `Cache-Control: no-store`. Server logs record the route, never the slug.
- R-I02.4a **Link previews** (iMessage, WhatsApp, Telegram…): Open Graph title "A Thirstr profile" and site name only: no name, description or `og:image`, so a preview never keeps the name or photo after the link dies.
- R-I02.4b **Dead link**: unknown slug, link off or renewed, account paused, suspended, quarantined, banned or deleted → the same 404 page "This link isn't active" with "Get Thirstr". Nothing says which.
- R-I02.4c **Rate limits** per IP: page 60/min, `GET /v1/share/{slug}` 30/min (bucket `share`); slug guesses can't enumerate.
- R-I02.4d **Where in the app**: Me header QR button → **S-80 Share sheet**. Edit profile no longer has its own share block (one place). Sharing **someone else's** profile is removed (it shared a raw profile id, which led nowhere).
- R-I02.4e **Bio rules on other apps**: most hookup apps hide or forbid URLs and non-face photos in profiles, which we don't control. The sheet's **Copy** gives the bare form `thirstr.fun/p/{slug}` (no `https://`), which survives most link filters and can be typed. Users are responsible for each app's rules; we never post anywhere for them.

## Import from other apps (v1.1, spec now)
- R-I02.5 User requests their data export from Grindr / Romeo / Scruff / Hornet (GDPR Art. 20) and picks the ZIP/JSON in our app.
- R-I02.6 Parser runs **on device**; extracts own profile text fields + own photos only (never other users' data or chats).
- R-I02.7 Mapping table per source app → our fields; user reviews every field before saving; photos go through F-15 classifier.
- R-I02.8 File deleted from app storage after import.
- R-I02.9 No live connection, no credentials of other apps ever requested (concept §15).

## Acceptance criteria
- AC-I02.1 Share page has no scripts, cookies or third-party requests; CSP header as R-I02.4 (test).
- AC-I02.1a Page HTML never contains a storage URL, storage key or profile id; photo only as a ≤ 2 KB `data:` JPEG ≤ 32 px (test).
- AC-I02.1b Paused / suspended / quarantined / banned / deleted / renewed / off → identical 404 body (test).
- AC-I02.1c Slug generated with a CSPRNG; renew makes the old slug 404 (test).
- AC-I02.1d In-app open of a link from someone who blocked you (or whom you blocked) → "This profile isn't available.", no profile data returned.
- AC-I02.2 Import never uploads the source archive.
