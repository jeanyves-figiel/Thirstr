# F-02 Onboarding

## Purpose
Install → seeing who's around in < 60 s; visible + messaging in < 2 min.

## Flow (screens S-01…S-06), v2 (issue 54)
Mockup (approved 2026-11-17): [onboarding v2 canvas](https://claude.ai/artifact/WRqvyNvvLQjGijjRg3NtyB).

| Step | Screen | Required | Skippable | Exit |
|---|---|---|---|---|
| — | S-01 Welcome | — | — | Get started → S-02; I already have an account → S-02 (login copy) |
| — | S-02 Sign up | one method; 18+ consent line | no | → S-03a |
| 1 | S-03a Name | name 1–30 | no | → S-03b |
| 2 | S-03b Birthday | date, age ≥ 18 | no | → S-03c, under 18 → S-03x |
| 3 | S-03c I am | one option (+ text for "Something else") | no | auto-advance 380 ms after a pick (not for "Something else") → S-03d |
| 4 | S-03d Here for | ≥ 1 tile | nothing pre-selected (Continue disabled until ≥ 1) | Continue = `PUT /me/basics` → S-04 |
| 5 | S-04 Location | level + OS prompt (or city) | deny → city picker | → S-05 |
| 6 | S-05 Main photo | 1 photo passing main check | extras skippable | → S-06 |
| 7 | S-06 Verify | — | "Later" | → S-07 |
| — | S-07 You're in | — | — | "See who's around" → S-10 Explore |

## Rules
- R-02.1 One question per screen. Steps 1–7 show a 7-segment progress bar (done = `mode.hookup`, current = `fg.primary`, todo = `line`), a "n/7" counter, and a 44 pt round back button (`bg.raised`) on steps 2–4 and on sub-screens (S-04b city picker, S-02 to S-01). Steps 5–7 are saved server-side and have no back. Back never loses entered values. Primary CTA is a 58 pt pill pinned to the bottom safe area, disabled at 35 % opacity until valid. Screens enter with a 360 ms fade + 14 pt rise (Reduce Motion: fade only).
- R-02.1a Headlines are `type.display`-sized 34/38, written as questions in the second person ("What should guys call you?"); one muted helper line under each. No form labels.
- R-02.1b S-02 lists Continue with Apple (white pill, first on iOS), Use a passkey, Continue with Google (both `bg.raised`), Email me a sign-in link (text button). The 18+ checkbox is replaced by the line "By continuing you confirm you're 18 or older and accept the Terms and Privacy Policy"; tapping a method sends `age_confirmed: true` (F-01 R-01.12). S-03b still blocks under-18s (R-02.3).
- R-02.1c S-03a: one large borderless input (34 pt, 800, coral caret, underline turns coral on focus), autofocus, `given-name` autofill, counter n/30. Return key = Continue.
- R-02.1d S-03b: three-column snap wheel (day · month name · year 1930…current−18), selected row on a `bg.raised` pill, haptic tick per row, initial value 01 Jan (current−25). Chip under the wheel: "You'll show as {age}" (teal tint) or "You need to be 18+" (danger tint). No keyboard, no free text.
- R-02.1e S-03c: four full-width pill options (Man · Trans man · Non-binary · Something else); selected = `bg.inverse` with `fg.onColor` and filled radio. "Something else" reveals a pill text field (20 max).
- R-02.1f S-03d: 2-column tiles (radius 24, min 112 pt; Sport full width): Hookups "The main event", Tonight "Free right now" (coral), Chat "Talk first, see after", Friends "New people, no pressure" (violet), Sport "Gym, runs, games" (lime). Selected tile fills with its colour, ink text and check.
- R-02.1g S-07: "You're in, {name}." with the profile card as others will see it (main photo, name + age, verified tick, location level chip, Here-for chips) and CTA "See who's around".
- R-02.2 Welcome shows live blurred activity: server returns counts per r7 cell around an **approximate** IP-geolocated city (no permission needed; offline DB-IP City Lite lookup on our own server, IP never stored or sent anywhere, #26); text "N guys around you." (N = active accounts in the area, not people online now, so no "right now"; thousands separated per locale). N rounded down to nearest 10 if < 100.
- R-02.3 Birthday under 18 → stop: "You need to be 18+". Account deleted, device flagged 30 d.
- R-02.4 "I am": Man · Trans man · Non-binary · Other (free text 20) · Prefer not to say (stored `unspecified`). **Optional** ([RF-3](../required-fields.md)); not shown on the profile.
- R-02.5 "Here for": multi-select Hookup, Tonight, Chat, Friends, Sport. Nothing pre-selected; at least 1 required ([RF-4](../required-fields.md)). Sets default Explore mode and the initial `show_in` lenses (F-06 R-06.1a).
- R-02.6 Location step explains before OS prompt. Default level Area (~200 m) with a sunflower "Default" badge. Hidden and Exact options disabled with a lock and "Verify first" for unverified accounts (AC-05.4; the server refuses both with 403 not_verified). A map preview (168 pt, radius 28) shows the chosen level live: City = large dashed teal zone, Area = ~200 m teal zone + pin, Exact = small ring + pin, caption chip in teal. Footer: "Your coordinates never leave your phone." CTA teal: "Allow location" (City: "Pick my city").
- R-02.6a (#197, [mockup](https://claude.ai/artifact/RaNCGCLH8xhMEeDPgRjwTg) B) When Area is selected, a teal panel right under the Area row asks "Show guys how close you are?" with two answer tiles: **~150 m** "Yes, ~50 m zone. Better matches nearby." / **200–500 m** "No, keep ~200 m zone." Nothing preselected; the CTA stays disabled until answered. The map preview draws the ~50 m zone inside the dashed ~200 m zone when Yes. Footer "Never your exact spot. Change it any time on Me." Safe Mode: panel not shown (off). The answer is sent as `precise` with `PUT /me/location`.
- R-02.7 Main photo: 4:5 frame (radius 32) is the picker itself; extras are 4 small slots beside it, enabled once the main passes. While checking, a teal scan line runs over the frame; pass = teal border + "Main" badge. Camera or library; on-device pre-check then server classifier (F-15 R-15.10). Result inline < 3 s: ok / "needs to be less explicit for your main photo" / "we need to see a person". 4 extra slots offered, skippable. Faceless main photos allowed. "Add it later" skips the step (`POST /me/onboarding/photo_later`); the account stays invisible until a main photo passes ([RF-6](../required-fields.md)).
- R-02.8 S-06 intro sells the payoff (verified badge, unlocks Hidden, checked on the phone) with teal "Verify now" and text "Later". Liveness view: face oval with teal progress ring, one large prompt, 3 step pips. Verify "Later": user lands on Explore browse-only; banner "Verify to be seen and message first" persistent until done.
- R-02.9 Push permission is **not** asked in onboarding; asked on first incoming message/tap.
- R-02.10 Safe Mode country detected (F-14) → flow becomes: Welcome (neutral copy) → Create account → **App lock + disguised icon** → Basics → Location (City default, Exact disabled) → Photo → Verify (mandatory before visible).
- R-02.11 Coach mark on first Explore: one bubble "Tap a pin or swipe the cards", dismissed on first interaction.
- R-02.12 Progressive profiling triggers: first Now post → position/hosting; first time Sport is turned on → sport fields (F-11 R-11.1); 3rd chat → health "share privately" offer; profile completeness nudge max 1/day.

## Edge cases
- App killed mid-onboarding → resume at last incomplete step.
- Location denied → City picker (search city), level City; can upgrade later.
- Photo rejected 3× → tips sheet + manual review option (24 h).

## Acceptance criteria
- AC-02.1 Median time install→Explore ≤ 60 s in usability test (n=10).
- AC-02.2 No push permission prompt before first inbound event.
- AC-02.3 Under-18 birthday blocks account creation.
- AC-02.4 Safe Mode variant shows app lock step before Basics.
