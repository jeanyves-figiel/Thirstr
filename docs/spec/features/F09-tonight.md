# F-09 Now & Tonight

## Now
- R-09.1 Now status: none · now · hosting · can travel · door open. Optional text 80 chars. TTL 1 / 2 / 3 / 6 h. Verified only.
- R-09.2 Setting Now first time triggers progressive fields (position, hosting) sheet.
- R-09.3 Now profiles: badge on cards/pins, sorted first after exact, pulse animation < 10 min.
- R-09.4 Ending: manual, TTL, or app detects user marked "Done" from notification action.

## Tonight (S-13)
- R-09.5 Tonight tab shows plans for today until 06:00 local, area within 10 km (radius widens if sparse).
- R-09.6 Time slider (now → 03:00) filters plans whose window overlaps selection; default now → +4 h.
- R-09.7 Featured: parties nearby with free spots appear as large cards at top (F-10), max 2.
- R-09.8 Plan card: avatar, name, verified, distance bucket · window, text, tag chip; tap the person → profile.
  - Actions (#210, [mockup](https://claude.ai/artifact/1YSABPxLq3S7pMxGoEwwbW)): **I'm in** (opens the chat with “Re: ‹plan› · I'm in 👋” in the composer, not sent), **Tap** (same as Explore Tap; button turns "Tapped"), **Chat**. Unverified viewers get the verify prompt instead of a chat. **⋯ or press and hold** → shared safety sheet (S-51): Hide this plan, then Hide / Block / Report him (report context `tonight`). **Swipe left** → Hide this plan (F-19 G5 row), toast with Undo.
  - Hidden plans and parties are kept on this device only (encrypted store) until the plan's window end / party end, never sent to the server.
- R-09.9 Post plan (FAB "Post your plan"): window start/end, text optional 140 (empty → tag shown as the line), tag (hosting, can travel, drinks first, party, other), audience (verified default / my chats). Max 2 active plans. Verified only.
  - Form (#189): live preview of the plan row (R-09.8) on top; **What** = 5 icon choices in one row (default: last type used); optional line; **When** = timeline scrubber from now to 06:00 (R-09.11), 15 min snap, window 30 min–12 h, default now → +4 h; "Now" means the moment of posting; **Who sees it** = Verified people / My chats. Post button repeats the window ("Post · Now – 01:45").
- R-09.10 Mode applies: Hookup shows hookup plans; Sport shows activity posts (F-11) today; Friends shows friends plans.
- R-09.11 Expiry 06:00 local or window_end + 1 h, whichever first.

## Acceptance criteria
- AC-09.1 Plans disappear from API ≤ 1 min after expiry.
- AC-09.2 Unverified cannot post Now/Tonight (403).
