# F-10 Parties

## Purpose
Host or join group hookups/parties safely.

## Rules
- R-10.1 Create (verified; no account-age minimum, owner decision 2026-11-17): title 40, start/end (max 12 h), capacity 2–50, rules (chips: age range, PrEP/safer, vers welcome, no chems, custom ×3), audience (verified · my chats · invite only), approximate area (cell r8 auto). Max 3 created/day, 1 live at a time.
  - Form (#189): own header row (back + "Host a party"); live preview of the featured card; **Title** (40); **When** = Today/Tonight or Tomorrow, then a timeline scrubber (Today/Tonight: now → 12:00 after the night, at most 18 h shown; Tomorrow: 06:00 → 06:00), 15 min snap, 1–12 h, default 22:00 → 4 h (or the next half hour + 30 min after 21:30); **Guests** = stepper 2–50, default 6; **House rules** = 8 icon tiles (age range, safer sex, PrEP, vers welcome, no chems, sober friendly, bring toys, dress code), default safer sex, + up to 3 own rules typed inline (30 chars); **Who sees it** = Verified / My chats / Invite only. Create sits in the sticky bar above the nav bar; content scrolls clear of it.
- R-10.2a Party card on Tonight (#210): status pill, seats, ⋯, title, time · distance · host, house rules line, seat bar. Actions: **Request a seat** (same as R-10.3, one tap; then "Requested", or "You're in" which opens the party and its guest chat; "Full" when full; disabled when unverified or "Not this time"), **Map** (Explore map centred on the r8 area at zoom 14 with the party marker selected; parties layer forced on until Locate me). **⋯ / hold**: Hide this party (Tonight and map, this device only, until it ends; Undo) and Report party (R-10.8). Host sees no ⋯ and no request button.
- R-10.2 Discovery: Tonight featured cards, map marker (party icon) at cell r8 centroid, never exact.
- R-10.3 Request to join: one tap; requester profile + vouches + verified shown to host. Requests expire at party end.
- R-10.4 Host actions: accept / decline (silent to requester: "Not this time"), remove guest, mark full, cancel, end. Co-host (1) optional.
- R-10.5 On accept: requester added to party MLS group "Guest chat"; host sends **address & door code** as E2EE message (template prefilled from host device, never stored server-side). Option "send address 30 min before start".
- R-10.6 Seat meter = accepted / capacity, realtime on `party:{id}`.
- R-10.7 After end: guest chat stays 24 h then auto-deletes (default); optional host rating (thumbs) visible as count after ≥ 3 ratings.
- R-10.8 Safety: any guest can report party; 2 reports → party hidden pending review. Check-in (F-13) suggested on accept.
- R-10.9 Safe Mode: party creation disabled; viewing only invite-only parties.
- R-10.10 Official parties (#113): events listed by the team (beta) or a partner venue, at a catalogue venue: title (60), venue, start/end (max 24 h), optional https link. Table `events`; admin console › Places adds and removes them. Public: shown on the Explore map at the venue's coordinates (yellow marker, F-04 R-04.20) from 12 h before start until the end, to everyone not in Safe Mode. No guest list, no requests: they're nightlife listings.
- R-10.11 Hosted parties on the Explore map (#113): same visibility as `GET /parties` (R-10.2: verified audience to verified viewers, chats audience to chat partners, never invite-only), marker at the r8 cell centroid, never the address (AC-10.1).

## Screens
S-14 Party detail (host view: requests list; guest view: status, rules, chat), S-15 Create party sheet.

## Acceptance criteria
- AC-10.1 No party API returns street address or exact coordinates.
- AC-10.2 Capacity never exceeded under concurrent accepts (transactional).
- AC-10.3 Guest chat auto-deleted 24 h after end on all devices.
