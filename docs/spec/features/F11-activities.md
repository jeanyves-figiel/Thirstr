# F-11 Activities & clubs (Sport mode)

## Rules
- R-11.1 Sport mode is the Sport lens of the one profile (F-06 R-06.1b: `main_ok` photos only, no hookup fields). The first time the user turns on Sport (Me switch, Explore banner, or posting an activity): 3-step mini-setup (sports, level, schedule, intent), then `sport` is added to `show_in`.
- R-11.2 Intent flag: "Just sport" / "Open to more" shown on cards + posts; filterable.
- R-11.3 Activity post: sport, title 80, place text or venue, start time, optional capacity, audience (verified default / everyone), intent. Expires start + 3 h. Max 3 active.
- R-11.4 RSVP: Join / Leave; joiners get group chat (MLS) for the post; host can remove.
- R-11.5 Feed (S-16): sport chips filter (multi), posts sorted by start time then distance; "Queer clubs nearby" carousel.
- R-11.6 Clubs: create (verified, account ≥ 30 d), name, sport, city, description, logo (strict check), join policy (open / request). Admin can post club events (= activity posts linked to club), approve members. Club chat (MLS, max 500).
- R-11.7 Verified club badge for partner clubs (manual).
- R-11.8 Gyms appear as venues (F-12) with Sport-mode check-in.
- R-11.9 Hookup content never surfaces in Sport mode: no Now pins, no hookup fields, no spicy photos.

## Acceptance criteria
- AC-11.1 Sport lens never shows a photo the classifier marks above "swimwear" (no `main_ok`).
- AC-11.2 Sport mode API never returns profiles without `sport` in `show_in`, or hookup fields.
