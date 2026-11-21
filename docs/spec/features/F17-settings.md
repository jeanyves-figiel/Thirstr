# F-17 Settings

Full tree: [concept/profile-and-settings.md §3](../../concept/profile-and-settings.md). Behavioural rules:

- R-17.1 All settings free. No setting behind Plus.
- R-17.2 Settings sync across own devices E2EE (settings blob encrypted to account key); server stores only what it must enforce (visibility, message permissions, safe_mode, hide_from_hidden, hidden).
- R-17.3 Safe defaults: verified-only messaging, explicit media blur, disappearing 7 d, previews None, watermark on, creators hidden.
- R-17.4 Search field at top of Settings (S-61).
- R-17.5 Symmetry rules: hiding online status/read receipts hides others' to you. Read receipts also cover Delivered ticks and typing, with a per-chat override (F-07 R-07.23).
- R-17.5b Translate messages (device-only, F-07 R-07.27): Automatic / Tap / Off; per-chat switch in chat ⋯.
- R-17.6 "Who can message me": everyone verified (default) · only people I tapped · only people matching my filters.
- R-17.7 "Hide from": age ranges, accounts < 7 days, unverified (default on).
- R-17.8 Destructive actions (delete account, panic wipe setup) require biometrics.
- R-17.16 **Data saver** (#177, decided 2026-11-21): Settings › App › **Data saver**: **Auto on mobile data** (default) / **Always** / **Off**. Device-only (`dataSaver` in the app preferences, `thirstr.prefs`). Auto is active on cellular and on any network the OS marks as metered or low-data (iOS Low Data Mode, Android Data Saver); Always also on Wi-Fi. When active:
  - Explore, grids, lists and Moments rings load the 480 px card copy (`-t`, SR-10) only; full photos load on open of a profile or viewer.
  - No prefetch: next profiles, Moments ahead, map tiles beyond the visible area, album covers off-screen.
  - Chat: photos ≤ 500 KB download on open of the chat; larger photos, videos and album items show a blurred placeholder with size and **Tap to load**. No video autoplay (Moments videos too).
  - Videos you send while it is active are exported at 720p (iOS system preset, H.264; R-08.17 uses 1080p H.265 otherwise); photos keep full quality.
  - Chat media messages carry their ciphertext `size` (bytes) so the receiver can tell a small photo from a large one; older messages without it count as large.
  - Background jobs that move a lot wait for Wi-Fi: chat backup (R-01.15), media in history transfer asks first (R-01.14).
  - Never affects: messages, receipts, safety (check-in, SOS), location updates, push.
  - Settings row summary: "Auto · on now" / "Auto · off on Wi-Fi" / "Always" / "Off". Data saver active and a load was skipped → the placeholder says "Data saver" so the user knows why.
- R-17.10 Structure (#102): Settings is a hub of 5 categories (Privacy & visibility, Chats & media, Notifications, Safety, Account) plus App and About inline. At most 2 levels deep; every category row shows a summary of its current values.
- R-17.11 No label is used twice: lenses are "Show me in" (Me, F-06); surfaces are "Appear on" (Grid, Map, Tonight, Activities, Venues).
- R-17.12 Location level (incl. Hidden's Stay hidden / Come back as, #114) and Now are set on Me (one tap); Settings links there, it does not duplicate them. Date check-in lives on Me; Safety settings hold Safe Mode, app lock, verification, blocked, notices.
- R-17.13 Destructive and leaving actions are grouped last in Account; Delete account opens its own confirm (R-17.8).
- R-17.14 (#188) Privacy & visibility › Who can see you: **Show me to people looking from afar** (default on, server `show_to_remote`, F-20 R-20.17). Off: only people whose own position is in your area see you; travellers looking around from elsewhere don't.
- R-17.15 (#238, [mockup option B](https://claude.ai/artifact/MfUBpaiRKoVvKb79m7A6U1), picked 2026-11-21) **What's new.** After an update that brings a new release note, a small card (S-78) appears once under the Explore header; no scrim, the map stays usable. Card: gradient spark tile, "New in 0.9.0", "N things · tap for more", ✕, and up to 3 one-line previews (dot in the feature colour, bold title: sub). Tap → full list sheet (S-78b); ✕, swipe up or 12 s untouched → closes. If Explore stops being quiet before it closes, the card hides and comes back on the next quiet Explore. Any close marks the note seen.
  - Content: 2–4 lines, each an icon tile in the feature's colour, a title (≤ 24 chars) and one line (≤ 44 chars), en / fr / de. Only things people can see or use; fixes only when noticeable. Curated by hand from CHANGELOG.md into `apps/mobile/src/whatsnew/notes.ts` (newest first, integer `id`); fix-only builds add no note, so they show no card. CI checks ids, line counts, lengths and languages.
  - Full list sheet (S-78b): tapping a line closes it and opens that screen; **Got it**, ✕, tapping outside or swiping down closes it. Footer "Find it again in Settings › What's new" opens S-79. Skipped several updates: newest note only, footer starts with "+ N earlier updates".
  - When: Explore tab on top, no keyboard, no other panel or sheet, 1.2 s after that state settles. Never during onboarding, App lock, a stack screen, or a check-in alert screen; it waits for the next quiet Explore.
  - Once: the phone stores the last seen note id (AsyncStorage `thirstr.whatsNewSeen`) when the card or sheet closes. Fresh install (no earlier app data, `thirstr.prefs` absent) shows nothing and stores the newest id.
  - Privacy and cost: notes ship inside the app; no request, no analytics, no "seen" event leaves the phone. No battery or data cost.
  - Settings › About › **What's new** (S-79): last 10 notes, newest first with a "New" pill, same lines, each opens its screen. Also found by Settings search.
- R-17.9 App: language, units, theme: none (single Pop theme, see design-system.md), accent per mode (fixed palette), haptics, data saver (R-17.16).

## Acceptance criteria
- AC-17.1 Every setting in the tree has an API field or local key documented in data-model/api.
- AC-17.3 Every setting reachable in ≤ 2 taps from Me (gear → category); search finds any setting by its label.
- AC-17.4 (#238) After updating to a build with a new note the card shows exactly once (until closed); a fresh install and a fix-only build show nothing; nothing is sent to the server.
- AC-17.5 (#177) With Data saver Auto on cellular, scrolling 100 Explore cards downloads only `-t` copies (no full photo, no prefetch); a 3 MB chat photo is not downloaded until tapped; on Wi-Fi everything loads as before.
- AC-17.2 Changing a setting on device A reflects on device B ≤ 10 s.
