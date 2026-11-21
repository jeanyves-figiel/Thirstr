# F-12 Venues & check-in

## Rules
- R-12.1 Venue catalogue: curated by team + partner venues (kind sauna, bar, club, gym, other). Fields: name, kind, cell r9, geofence radius (30–150 m), hours. Members can add places too (R-12.11).
- R-12.2 Check-in: manual from venue page or prompt when inside geofence ≥ 3 min (prompt only, never automatic). Verified only.
- R-12.3 Visibility inside venue: "visible to others here" toggle (default on). Only people currently checked in **and** visible see each other. Outside the venue nobody sees check-ins; no history kept.
- R-12.4 "Here now" grid (S-17): checked-in visible profiles, newest first, sub-label (zone free text like "steam room" optional), "tapped you" highlight.
- R-12.5 Stats header: total checked in (count incl. invisible, rounded if < 5 → "a few"), visible to you, tapped you.
- R-12.6 Auto check-out: leaving geofence for 10 min, or 4 h, or venue closing time. Manual "Check out" / "Go invisible".
- R-12.7 Mode: gyms show in Sport mode; saunas/bars/clubs in Hookup; bars in Friends too.
- R-12.8 Safe Mode: venue check-in disabled; no venues on the Explore map (F-04 R-04.20).
- R-12.9 Catalogue sources (#113): `team`, `partner`, `osm` and `member` (R-12.11). Venues store their **public** coordinates (`lat`, `lng`, they are businesses) besides the cells; user locations never do. OpenStreetMap import runs on our server only:
  - Gay venues **worldwide** by tag, no area at all: `amenity` nightclub/bar/pub or `leisure`/`amenity` sauna, with `lgbtq` = primary/only or `gay` = yes. Kinds club / bar / sauna.
  - Gyms (`leisure=fitness_centre`) for a fixed list of regions in config (`:osm_gym_regions`, country ISO codes; beta: CH, DE, AT, FR, BE, NL, LU, GB, ES, IT, PT). The list is chosen by the team, never derived from where users are.
  - Weekly job + admin console › Places › Import now + GitHub Actions "Places import" (workflow_dispatch, staging or production: queues the same job over `fly ssh`, waits, prints counts). Upsert by `ext_id` (`osm:node/123`); an OSM venue gone from the source is deleted unless someone is checked in (then at check-out). Name, kind, coordinates, hours (`opening_hours` kept as text) are copied; nothing about users is ever sent.
  - Endpoint: `OSM_OVERPASS_URL` (default overpass-api.de). Data © OpenStreetMap contributors (ODbL): attribution on the place card.
- R-12.10 Team can hide a venue (`hidden`), e.g. closed or not gay-friendly; hidden venues are never listed (Tonight, map), cannot be checked into, and are never imported back.
- R-12.11 Add a place (#191, S-17a): any verified member, not in Safe Mode, can add a place that is not listed and is checked in there at once.
  - Entry: Tonight › Venues nearby › last row "Add a place" (always shown, also when the list is empty; hidden in Safe Mode).
  - Position: the place is pinned at the member's **exact** device position (high-accuracy GPS, rounded to ~1 m), shown on a still map with its accuracy. If accuracy is worse than 100 m, adding is disabled until a better fix. The server checks the point is within 1.5 km of the member's location cell. This is the only flow that sends exact coordinates; it never updates the member's own location level.
  - Consent: a coral card says "This shares your exact location. The place is pinned exactly where you are now. Everyone on Thirstr will see it on the map and can check in. Never add a home or a private address." The only button is "I understand, add & check in".
  - Fields: name (2–60, whitespace collapsed; no links, @, or long digit runs), kind club / bar / sauna / gym / other.
  - No review before: the place is live for everyone at once (Tonight list, Explore map: club/bar/other under Clubs, sauna under Saunas, gym under Gyms) and anyone can check in.
  - Label "Added by a member" on the Tonight row, the venue page and the map card. The creator is **never** shown to anyone; it is kept (`created_by`) only for the daily limit, the creator's own removal and abuse handling, and is nulled when the account is deleted. Places added are in the member's data export.
  - Duplicate guard: if a listed place (any source, not hidden) within 75 m has a similar name (accents, case and punctuation ignored; one contains the other), the server answers 409 `place_exists` with that place, and the app offers "Check in there".
  - Limits: 3 new places per account per 24 h.
  - Creator removal: the creator sees "Remove this place" on the venue page while nobody else is checked in.
  - Review after the fact: admin console A-07b › Added by members (newest first, name, kind, nearest city, time, check-ins, map link) with Hide / Unhide / Delete. Every action audited. The weekly OSM import never touches member places.

## Acceptance criteria
- AC-12.1 GET /venues/{id}/here returns 403 if caller not checked in.
- AC-12.2 venue_checkins rows deleted at check-out (no history table).
- AC-12.3 POST /venues creates a `member` place at the given point and checks the caller in; it is listed for others at once, the response never carries the creator, a similar name within 75 m returns 409 `place_exists`, a 4th place in 24 h returns 422, and the creator can DELETE it only while nobody else is checked in.
