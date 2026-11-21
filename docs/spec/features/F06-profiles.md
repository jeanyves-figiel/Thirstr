# F-06 Profiles

Field catalogue and defaults: [concept/profile-and-settings.md](../../concept/profile-and-settings.md) (authoritative for field lists). This spec covers behaviour.

## Rules
- R-06.1 One profile per account (decision 2026-11-18, #96; replaces Now/Sport/Friends profiles). Created at onboarding. One name, photo set, bio, inbox, block list, share link. Server never returns account_id.
- R-06.1a **Lenses.** Hookup, Friends and Sport are lenses on the one profile. `show_in` ⊆ {hookup, friends, sport}, at least 1 (else 422 `show_in_empty`; to disappear use Pause). Default at onboarding from "Here for" (R-02.5): Hookup/Tonight/Chat → hookup; Friends → friends; Sport → sport. Editable any time on Me (S-60 "Show me in" switches, mode-coloured). A profile appears in Explore, Tonight, venues and activities of a mode only if that mode is in `show_in`.
- R-06.1b **What each lens shows** (server-enforced on every read, incl. Explore cards, pins, profile view, share link):
  - Hookup: all fields and photos, per field visibility (R-06.4).
  - Friends: only photos with `main_ok` (strict check, R-06.3); identity, languages, bio, prompt, body, tribes, relationship, socials (per visibility). Never hookup fields (position, practices, limits, hosting, groups, boundaries; `looking_for` keeps only dates/friends/activities/chat) and never health.
  - Sport: Friends set + sport fields (sports, level, gym, schedule, intent).
  - The lens is the viewer's current Explore mode (`?mode=` on reads; default hookup). A profile whose `show_in` lacks that mode returns 404 in that mode.
- R-06.1c Chats, taps and blocks belong to the one profile. A chat keeps the mode it started in (bubble colour, design-system).
- R-06.1d Migration (beta): for accounts with extra `sport`/`friends` rows, copy sport fields into the main profile where empty, add that mode to `show_in`, move their activity posts to the main profile, then delete the extra rows with their photos, location cells, taps and share links. Chats with an extra profile end. One-time in-app notice: "Profiles are now one profile. Choose where you show up in Me".
- R-06.2 Required to be visible: display name, age, main photo (ok_main) ([RF-10](../required-fields.md)). Every other field is optional.
- R-06.3 Photos: 5 public max; slot 0 main (strict check), 1–4 public (permissive). Every photo also gets `main_ok` (passes the strict check) at upload; only `main_ok` photos show in Friends and Sport (R-06.1b). The editor tags each photo "All lenses" or "Hookup only". Reorder by drag; main must stay ok_main. The app uploads a 480 px JPEG copy next to each photo (SR-10); cards and lists show it when it passed the classifier on its own, else the full photo.
- R-06.4 Per-field visibility: public / verified / chats / only_me. Server enforces for SV fields; for `chats` and `only_me` fields the server stores nothing — client sends values E2EE when a chat starts (R-06.6).
- R-06.5 Hookup fields (position, practices, hosting, groups, limits) default `verified`; health default `chats`, never `public` (UI disables it).
- R-06.6 Chat-shared fields: when a chat is created or a field changes, client sends an E2EE `profile.private` message to chat partners allowed by visibility; receiver caches locally.
- R-06.7 "Preview as": lens (Hookup / Friends / Sport) × audience (stranger / verified / chats). Client renders own profile with the same lens and visibility logic. A lens not in `show_in` previews as "You don't show up in X".
- R-06.7a (#114) S-66 lists what the chosen viewer misses in the chosen lens, each item once, first reason wins: (1) photos not shown by the lens (count, "Hookup only"), (2) filled fields the lens drops ("Hookup only"), (3) filled fields whose visibility is above the viewer: `verified` (for New guy), `chats` (for New guy and Verified), `only_me` (always). "My chats" values kept on the phone count for (3). Private albums are always listed ("shared one by one"). Full-screen preview (S-20 with `preview`) shows a "Seen by ‹viewer› in ‹lens›" pill pair; each pill cycles its value in place; a lens not in `show_in` adds the banner "You don’t show up in X".
- R-06.8 Completeness ring = weighted % (basics 20, main photo 20, extras 10, bio 10, body 10, looking for 5, hookup or sport 10, prompt 5, languages 10), see [RF-12](../required-fields.md).
- R-06.8a Quick wins (#219): the client lists missing R-06.8 items by completeness gain (ties: photos, bio, languages, body, hookup/sport, looking for, prompt) and shows the top 3 with their gain. Extra photos are one item ("Add N more photos"). Same weights as the server; the server value stays the source of truth for the ring.
- R-06.8b Edit profile = hub (S-74) + one page per section (S-75): Basics (name, pronouns, orientation, languages), About you (bio, prompt, looking for, relationship), Body, Hookup, Health, Sport. No Save button: a section saves 800 ms after the last change and when left; values stored on the device (`chats`/`only_me`, R-06.4) save locally the same way.
- R-06.9 Private notes & tags on others' profiles: device-only, synced E2EE across own devices; max 500 chars + 10 tags; shown on S-20 in yellow dashed card, under the chat header (F-07 R-07.35) and in the inbox; searchable from Chats (R-07.34).
- R-06.10 Profile view (S-20): hero photos (swipe), name/age/verified, distance, status line, tags, prompt, bio, mode-specific sections, linked accounts (I-01), vouches count, private note, actions: Tap (flame) · Favorite (star, private, F-07 R-07.32) · Message · ⋯ (add/remove friend R-07.36, block, report, hide, vouch).
- R-06.11 Edits propagate within 5 s; photo changes trigger re-check and possibly re-verify (F-03 R-03.7).
- R-06.12 Bio: 300 chars; links blocked for first 24 h after account creation and always for unverified; no phone numbers/emails (regex + nudge).
- R-06.13 Discriminatory phrases at write time → inline nudge; repeated → field hidden + moderation (F-15).

## Acceptance criteria
- AC-06.1 GET /profiles/{id} by stranger never returns fields with visibility ≠ public.
- AC-06.2 HIV status cannot be set to public via API (validation error).
- AC-06.3 Friends and Sport reads never return a photo without `main_ok`, a hookup field or a health field (test per read path: Explore list, map pins, GET /profiles/{id}, share link).
- AC-06.4 A profile whose `show_in` lacks a mode never appears in that mode (Explore, Tonight, activities, venues) and returns 404 to `GET /profiles/{id}?mode=<that mode>`.
- AC-06.5 `POST /me/profiles` no longer exists; an account has exactly one profile after migration.
