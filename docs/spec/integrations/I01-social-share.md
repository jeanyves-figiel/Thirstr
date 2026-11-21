# I-01 Social post sharing & linked accounts

Platforms: X, Bluesky, OnlyFans, JustFor.Fans, Instagram (link-only).

## Share into Thirstr
- R-I01.1 iOS Share Extension + Android share target accept URLs (and text containing URLs). Flow: pick recipients (recent chats, search) → optional message → send.
- R-I01.2 Link preview built **on device**: fetch URL with generic UA, parse OpenGraph/oEmbed (title, image, video poster); image re-encoded and encrypted as F-08 media. Server never fetches the URL.
- R-I01.3 Preview card in chat: platform icon, title, thumbnail; explicit classifier on receiver device → blurred if explicit (per settings); tap → opens URL in external browser/app (never in-app webview for adult domains).
- R-I01.4 Sending links requires an existing two-way chat (F-07 R-07.3).
- R-I01.5 Paywalled posts (OF/JFF): preview shows what the platform exposes publicly (often avatar + title) — no scraping behind login.

## Linked accounts on profile
- R-I01.6 Add: platform + handle. Proof:
  | Platform | Proof |
  |---|---|
  | Bluesky | handle resolves to DID; user posts or sets profile field containing one-time code, or OAuth (AT Protocol OAuth) |
  | X | OAuth 2.0 (read-only scope `users.read`), only username kept |
  | OnlyFans / JustFor.Fans / Instagram | one-time code placed in public bio; device fetches public profile page and confirms; code removable after |
- R-I01.7 Visibility per linked account (default My chats). Shown with ✓ when proven.
- R-I01.8 Re-check ownership every 90 d (device-side fetch); failed → ✓ removed.
- R-I01.9 Creator rule: linking OF/JFF does **not** force Creator type; promoting (mass sending links) does (F-15 R-15.8).

## Acceptance criteria
- AC-I01.1 Server logs contain no shared URLs.
- AC-I01.2 OAuth tokens discarded after username read.
