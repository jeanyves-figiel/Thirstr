# F-15 Moderation & anti-bot

## Anti-bot gate
- R-15.1 Verification required to be visible and to initiate (F-03).
- R-15.2 Device attestation on every session; emulator/rooted/jailbroken without attestation → read-only.
- R-15.3 Max 1 active account per verified human; 1 profile per account (F-06 R-06.1).
- R-15.4 Rate limits (api.md). New accounts (< 7 d): halved limits.
- R-15.5 Signals (metadata only): identical first-message hash across ≥ 5 recipients (client sends salted hash of first message, not content), link attempts in first messages, reply ratio < 5 % over 50 sends, 24/7 activity, location velocity, cell-hopping, copy-paste bios (server-side similarity on public bios).
- R-15.6 Score ≥ threshold → **shadow quarantine**: user sees normal UI, outbound taps/messages/visibility delivered to nobody. Review within 24 h.
- R-15.7 Community: "Bot / scam" one-tap report; 3 reports from distinct verified accounts with good reporter score in 24 h → immediate quarantine pending review.
- R-15.8 Creator profile type: accounts promoting paid content must self-declare; undeclared promotion → warning then quarantine. Creators hidden by default in filters.

## Content moderation
- R-15.9 Report flow (S-50): reason (spam/bot, scam/extortion, underage, harassment, non-consensual content, hate, impersonation, other) + optional franked messages/media + note. Block offered automatically.
- R-15.10 Public photo classifier (self-hosted): labels nudity levels; main photo must be "clothed/shirtless"; slots 1–4 allow underwear/suggestive, reject genitals/sex acts; Each photo also gets `main_ok` (strict pass); only those show in Friends and Sport (F-06 R-06.3). Borderline → human queue (SLA 12 h).
- R-15.11 Hash matching (CSAM list) on all public photos; positive → account banned + legal reporting.
- R-15.12 Bio/text: discriminatory phrases → write-time nudge; post-publish flag → hide field + warning.
- R-15.13 Human moderators: closed beta = owner only, EN/FR/DE. Public launch: regional coverage (EN, FR, DE, ES, PT, IT, AR, RU, TR). SLAs: underage/CSAM/violence 1 h, extortion 4 h, others 24 h. Beta compensating control: content auto-hidden on classifier match or ≥ 2 independent reports for severe reasons until reviewed.
- R-15.14 Actions: warn, hide field/photo, quarantine, suspend (1–30 d), ban (account + LSH face bucket, F-03 R-03.6). Every action has reason code + appeal (in-app, 1 appeal, reviewed by different moderator ≤ 72 h).
- R-15.15 Moderator tool: sees only reported content + public profile + metadata signals; no access to chats beyond franked reported messages; all access logged.
- R-15.16 Transparency report quarterly: reports by category, actions, bot-rate per 1k MAU, government requests.

## Hide, block, report everywhere (#111)
Owner feedback 2026-11-21: "moderation - option to hide/block/report". Mockup: [Hide, Block, Report](https://claude.ai/artifact/BcXqbMNne1uWyakLqfC67c) (option A, three tiles).
- R-15.17 **One safety sheet (S-21)** wherever you meet someone: profile ⋯, map pin long-press (R-04.14), grid tile long-press (F-04), 1:1 chat ⋯ (F-07 R-07.9) and Chats inbox long-press. Same three tiles in the same order and place every time: **Hide** (eye-off, `fg.secondary`, "Not shown to you"), **Block** (ban, `state.danger`, "No contact, both ways"), **Report** (flag, `state.warn`, "Tell Thirstr, anonymous"). Screen-specific rows go above (Explore: Open profile, Tap, Message; chat: View profile, Date check-in) or below (profile: Share, Vouch; inbox: Star, Mute, Archive, Delete; chat settings). Footnote: "‹Name› is never told you hid, blocked or reported. Settings › Hidden & blocked". Group chats and gone chats keep their own sheet without the tiles.
- R-15.18 **Hide**: one tap, no confirm. Removes the profile from the viewer's Explore (map pins, avatars, grid, header counts, R-04). Chats keep working. Toast "‹Name› hidden" with **Undo** for 5 s (DELETE /profiles/{id}/hide). Medium haptic.
- R-15.19 **Block**: confirm step in the same sheet: title "Block ‹Name›?", three points (you won't see each other anywhere; chat closes and taps are removed; they aren't told), red Block + Cancel. On success: toast "‹Name› blocked", the person leaves the current list, the chat is archived and a chat or profile screen closes. Not undoable from the toast (Settings only).
- R-15.20 **Report**: closes the sheet and opens S-50 with the context (profile, explore, chat + conversation id for franked messages). S-50 keeps "Also block" on by default (R-15.9).
- R-15.21 **Settings › Safety › Hidden & blocked (S-71)**: row shows hidden + blocked count. Screen: two tabs "Hidden · N" / "Blocked · N", one-line explanation per tab, rows newest first (photo, name, age, "today / N d ago / N w ago"), Unhide / Unblock pill; toast on success. Empty: "Nobody hidden/blocked" + "Hold anyone on the map, grid or in Chats to hide or block them."
- R-15.22 **Discoverability**: the grid shows a teal hint "Hold a tile for Hide, Block, Report" above the tiles until the first long-press on that device.

## Acceptance criteria
- AC-15.1 Quarantined account receives HTTP 200 on sends; recipients receive nothing.
- AC-15.2 Moderator UI cannot open a chat that wasn't reported (permission test).
- AC-15.3 Bot-rate KPI computed daily.
- AC-15.4 (#111) Hide then GET /me/hidden lists the profile; unhide removes it and the profile returns to the viewer's grid (server test `explore_test.exs`).
- AC-15.5 (#111) Safety copy exists in en/fr/de with identical keys (`moderation-i18n.test.ts`).
