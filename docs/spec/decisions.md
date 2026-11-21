# Owner decisions (spec sign-off round 1)

Date: 2026-11-17. Source: [sign-off form](https://claude.ai/artifact/XqFcGc8h7xNGvt7R4gH32n). Binding for beta unless revised here.

| # | Topic | Decision | Applied in |
|---|---|---|---|
| D-01 | App name | **Thirstr** (replaces working name MascHoe, 2026-11-17). Domain `thirstr.fun` (registered 2026-11-17 at GoDaddy; `thirstr.app` taken). Bundle ID `app.thirstr`. | store listings, bundle IDs, docs |
| D-02 | Legal entity | Switzerland (hosting EU) | #9, security.md |
| D-03 | Hosting | **Fly.io, EU regions only** (fra primary, ams secondary) for beta; review jurisdiction (US CLOUD Act) + cost before public launch; Hetzner = exit path. Revised 2026-11-17 (was Hetzner). | ops.md, ADR-0001 |
| D-04 | Beta access | Invite-only, ~500 testers, 3 invite codes each | F-01, F-02 |
| D-05 | Seed cities | Zurich, Berlin, Paris (app usable worldwide) | testing.md seed data, go-to-market |
| D-06 | Beta languages | en, fr, de; 14 more at public launch | design-system.md i18n |
| D-07 | Exact pin TTL | 30 min / 1 h / 2 h / 4 h (max 4 h) | F-05 R-05.4 |
| D-08 | Party hosting | Verified only, no account-age minimum | F-10 R-10.1 |
| D-09 | Anti-scrape cap | 300 profile views / hour | security.md A9, F-15 |
| D-10 | Unverified users | Browse + reply only | F-03 R-03.9 |
| D-11 | Pricing | Fully free during beta; Plus after launch | #7 |
| D-12 | Moderation (beta) | Owner only; auto-hide compensating control | F-15 R-15.13, admin-console R-AD.12 |
| D-13 | Age-check fallback | Yoti, zero retention (DPA required) | F-03 R-03.3, I-03 |
| D-14 | Prod deploy approval | Owner only | ops.md |
| D-15 | Multiple profiles (2026-11-18, #96) | One profile, three lenses: `show_in` Hookup/Friends/Sport; Friends & Sport show only strict-safe photos, no hookup/health fields. Replaces Now/Sport/Friends profiles. Rejected: no modes (B), separate unlinkable profiles (C; can be added later on top) | F-06 R-06.1–1d, F-04 R-04.1, F-11 R-11.1 |
| D-16 | Chat translation (2026-11-19, #106) | Language is not an Explore filter. Chats translate automatically **on the device only** (Apple Translation iOS 18+, ML Kit on Android). No server or cloud translation in beta: it would expose E2EE plaintext to us or a third party. Trade-off accepted: older iPhones (< iOS 18) and rarer language pairs get no translation; first use of a language needs a one-time pack download. A cloud option (opt-in, per chat, EU provider, with consent) can be revisited after beta | F-07 R-07.25–R-07.31, F-04 R-04.8 |
| D-17 | Favorites, notes, friends (2026-11-21, #115) | Favorite = private star on a person; Tap moves to a flame icon. Friends are mutual (request/accept) and travel only inside the 1:1 E2EE chat; favorites, notes and friends stay on the device. Inbox layout A: All / Unread / Favorites / Friends + favorites strip. Rejected: B (separate People view), server-side friend graph (would reveal the social graph) | F-07 R-07.32–R-07.38, F-06 R-06.9–10 |
| D-18 | Photos & albums in chat (2026-11-21, #135) | Chat + opens a media tray in the keyboard slot (option A): Sent recently (last 30 sent photos, encrypted, only on the phone; re-send = new encrypted copy), camera roll (iOS limited access) + camera, multi-select ≤ 10 with expiry / view once / allow save; Albums tab with share sheet 1 h / 24 h / 7 d / Until I stop, Change time, Stop sharing; album card in chat. Rejected: B (one-tap quick strip: wrong-send risk). Videos wait for on-device metadata stripping (#138) | F-08 R-08.11–R-08.17, S-41, data-model.md |
| D-19 | Video check of chat partners (2026-11-21, #159) | Owner asked for it. Requested from a 1:1 chat; random two-step move picked on the requester's phone; recorder consents (Record / Not now), 3–5 s live clip in the app only; E2EE one-time blob deleted after first fetch; watched once; face match follows in #185; badge per chat only (device-only, 90 d). Capture protection: Android FLAG_SECURE, iOS protected layer + black while recording + screenshot notice; UI states a second phone can't be stopped. Viewer: **A hold to watch** (picked 2026-11-21); iOS first (Android with #107) ([mockup](https://claude.ai/artifact/KExcdnKfZCDiJLLPPMq8d2)); "Send mine too" off by default (pending). | F-18 R-18.7–R-18.20 |
| D-20 | Travel plans (2026-11-21, #188) | Owner asked for it. Trips (city + dates, ≤ 3, ≤ 180 d ahead, ≤ 30 d long), Look around from the trip city's fixed centre, optional "Show me there" up to 14 d early (verified only), sky `travel` label with reason and dates everywhere a visitor appears; never pinned on the map (one "N visiting" bubble). Locals: **B mixed into the grid, tagged** (picked 2026-11-21; position 2 then every 6th tile). Rejected: A separate Visiting soon row. Safe Mode: locals hidden from afar, showing in a listed country needs a second confirm. Free ([mockup](https://claude.ai/artifact/8i2ktMzTN6yGF8TdQjvCMz)) | F-20 |

## Open
- D-21 (#212) Moments, temporary photos (F-21): owner to pick **D-21a placement**: A rings only (recommended) / B Moments row on the grid + rings; and **D-21b who viewed**: A names / B count only / C names unless they watch quietly (recommended). [Mockup](https://claude.ai/artifact/Ctum8QhK6cBFwWytjziZu1).
- D-01: domain `thirstr.fun` registered 2026-11-17 (`thirstr.app` taken); hosts `api.thirstr.fun` (prod), `staging.thirstr.fun` (#34). Trademark clearance (EUIPO, Swissreg, USPTO; classes 9, 42, 45) by counsel before store submission. Web search 2026-11-17 found no app or mark named Thirstr; nearby marks: "Thirst" drinks apps, "Thirsty Thursday".
- Repo name `MascHoe` unchanged (owner action to rename).
- Risk accepted by owner: single moderator cannot meet 1 h SLA around the clock; mitigated by auto-hide (R-15.13). Revisit before public beta.
