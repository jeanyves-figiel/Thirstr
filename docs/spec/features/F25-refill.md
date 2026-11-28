# F-25 Refill: bring back people you've met

Issue #339 (owner request 2026-11-28: "like Grindr's Reconnect, but better and not called Reconnect"). [Mockup + pick form](https://claude.ai/artifact/1GXbFpJ6qzD6Ko74get3AY). Decision D-26 (owner pick 2026-11-28 in the form): **concepts A + C**, name **Refill**, first-run **ask once**, **Thirstr Plus** feature, all six triggers built. Rejected: concept B (Again shelf), names Seconds / Encore / Round two / Callback. The mockup still says "Seconds" (working name); UI copy uses Refill: "Up for a refill?", "You both want a refill".

## Purpose
Help people meet again someone they already met or chatted with, at a moment where it makes sense (he's nearby again, same city on a trip, same party or venue tonight), without anyone feeling chased. Differences from Reconnect: consent first (concept A: nobody learns you thought of him unless he thought of you too), every card says why now, computed on the phone only, and the other side can opt out of being resurfaced at all.

## Terms
- **Past contact**: a profile with a 1:1 chat where both sides sent at least one message, or a "We met" mark / ended date check-in (F-13). Kept in the device store (key `refill:<profile id>` = `{first_at, last_msg_at, met_at?, rating?, muted?, last_card_at?}`), never on the server. One-way chats (he never replied) are never past contacts.
- **Card**: one private suggestion shown to the viewer, with a reason (trigger).
- **Sealed yes** (concept A): an E2EE payload in the 1:1 MLS group `{t: 'refill', op: 'yes' | 'withdraw', until}` that the receiving app stores without showing anything.

## Concepts (A + C chosen, B rejected)
- **A · Sealed yes** (chosen). A card asks the viewer "Up for a refill?" (Up for a refill / Not now / ⋯). Yes sends a sealed yes valid 30 days ("Take it back" sends `withdraw`). When a phone holds both its own unexpired yes and the peer's, both phones show "You both want a refill" (full-screen, coral), a coral system line in the chat, and one push without a name ("Someone you've met said yes too"). No yes from the peer = he never learns anything. Known limit: a modified client could reveal a received sealed yes on its own phone; accepted (playful feature, no proof value).
- **B · Again shelf** (rejected, kept for reference). Explore grid sheet shows an "Again" shelf (past contacts with a current trigger, reason chip each) and a sunflower "Again" tag on their tiles; a private reason card on the profile (S-20), with the viewer's private note (R-06.9); Trips (S-72) show "N people you've met live there". One-sided: the peer learns only what the viewer writes.
- **C · After the date** (chosen, feeds A). When a date check-in ends (F-13) or after "We met" (chat ⋯), one skippable sheet "Again with ‹name›? Yes / Maybe / No" + private note + (with A) "Seal a yes". Yes people get cards; No people are never resurfaced and are ranked last in the viewer's own Explore (device-side, affects nobody else); No offers Hide / Block in one tap. Me › Refill lists ratings (Yes / Maybe / No) with live status (Here now, Sealed, Trip, Away).

## Rules (all concepts)
- R-25.1 **On the phone only.** Eligibility, triggers and ratings run on the device over data the app already receives. The server never learns who chatted with or met whom. New server data: one profile setting `resurface_ok` (bool) and `resurface: false` on Card JSON when the profile owner turned it off (the client then drops that profile from Refill).
- R-25.2 **Both sides opt in.** Settings › Privacy › Refill: **Show me Refill** (viewer side) and **Let people I've met find me again** (`resurface_ok`). Default: both off until a one-time intro card, shown the first time a trigger would fire, asks for both with one button (D-26). Free members get the intro only for the opt-out switch.
- R-25.3 **Never resurfaced**: blocked or reported either way; hidden by the viewer (F-13); "Not him again" (⋯ on a card, device-only, list in settings); friend removed; chat deleted by the viewer; peer `resurface_ok` off, paused, quarantined, Hidden or in Safe Mode; viewer in Safe Mode; peer no longer matches the viewer's age range or intents.
- R-25.4 **Timing**: earliest 21 days after the last message in the chat; no cards in the viewer's first 7 days on Thirstr.
- R-25.5 **Pacing**: at most 1 card a day, 1 card per person per 60 days; "Not now" = 60 days; Snooze all 1 week / 1 month. No push for cards; the only push is a mutual yes (A). Quiet hours follow F-16.
- R-25.6 **Triggers** (each switchable): Back nearby (he appears in Explore results after ≥ 14 days absent; default on) · Same city on a trip (F-20 Look around results or visitor tiles; on) · Same party or venue (shared party guest list or both checked in at a venue, F-10 / F-12; on) · Both on Tonight with a shared intent (F-09; on) · A year since we met (6 / 12 months after a meetup, he's in your city; off) · Gone quiet (a favorite not messaged in 60 days is online; off). All six are built (D-26).
- R-25.7 **Data**: all Refill data is in "Download my data" (device part), never in reports, deleted with the chat's peer on block. "Forget" on a row deletes that person's Refill record.
- R-25.8 **Plus** (D-26, F-23). Plus: trigger cards, the after-date rating, Me › Refill, the mutual-match screen and push. Free: chat ⋯ **Up for a refill?** (manual sealed yes with no trigger), so a free member can answer a Plus member's yes and the match still shows on both phones; nothing ever tells a free member that a yes is waiting (that would leak it). Always free: Not him again, Snooze, Refill off, `resurface_ok` opt-out, No → Hide / Block. No Plus prompt in the first 3 days; the Refill limit card sits in Me › Refill only, never in chat (F-23).

## Design
Sunflower (`personal`) for private Refill surfaces (cards, after-date sheet, Me › Refill); coral only for the mutual moment. Copy en/fr/de; the brand name stays English.

## Acceptance criteria (draft)
- AC-25.1 With network capture, no request carries a past-contact list, rating or trigger (only `resurface_ok` on settings).
- AC-25.2 A one-sided sealed yes never changes anything on the peer's screen.
- AC-25.3 Blocking either side removes the person from Refill on both phones within one sync.
- AC-25.4 No more than 1 card a day and 1 per person per 60 days (device clock tests).
