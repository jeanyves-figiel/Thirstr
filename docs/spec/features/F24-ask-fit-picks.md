# F-24 Ask, Fit & Picks (AI search and interest matching)

**Status: approved 2026-11-28 (#338, D-27): build all three now.** Mockup: [Ask, Fit & Picks](https://claude.ai/artifact/UbsUPZs3DfVCDvw4NCfSPt) (`/mnt/project-files/ai-search/mockup.html`).

Owner ask (2026-11-28): something similar to Grindr Edge (AI that narrows a search and matches people with the same interests), not a copy. Three stackable concepts: **A Ask** (natural-language search), **B Fit** (interests + compatibility), **C Picks** (a few chosen people a day). C needs B. **Plus (owner, 2026-11-28): the whole feature is Thirstr Plus** (R-24.7, R-24.16, R-24.25). Owner picked all three now (D-27).

## Principles (all concepts)
- P-1 **On device only.** No profile, chat, query or behaviour data is sent to any AI or LLM provider, ours or third-party. No server-side model. (Rejected: EU-hosted LLM fallback for Ask, est. ≈ €50 / 1 M asks: needs the query text on a server.)
- P-2 **Explainable.** Every parsed search shows its filters; every Fit and Pick lists its reasons in plain words.
- P-3 **User control.** Each part has its own switch (R-24.30); "Count me in others' Fit" lets a person stay out of everyone's Fit.
- P-4 **Never searchable or scored:** HIV status, ethnicity, languages (R-04.8 list), health fields, any `chats` / `only_me` field the viewer has not received.
- P-5 **No new data on the server** beyond the Interests field (B). Fit scores, rankings, asks and learned weights never leave the phone and are never logged.
- P-6 Energy and data: no extra network calls; no model download (system models only); compute only on user action or twice a day for Picks.

## A · Ask (natural-language search)
- R-24.1 Explore: an **Ask field** (✦, 44 pt, teal focus ring) under the floating bar (R-04.18). Tap to type; hold the mic to dictate (on-device speech: iOS `SFSpeechRecognizer` with `requiresOnDeviceRecognition`, Android `SpeechRecognizer` on-device; if not available, the mic is hidden). Up to 3 suggestion chips from the person's own last asks (device only, max 20 kept, clear in R-24.30).
- R-24.2 **Parser output** is a JSON object of the Filters sheet schema (R-04.8: age, distance, verified, online, has Now, position, hosting, tribes, body, looking for, sport fields, new members) plus `interests` (B, if built) plus `refused[]`. Nothing outside that schema can be produced.
- R-24.3 **Engines**, first available wins: (1) iOS 26+ Apple Foundation Models framework (on-device, guided generation constrained to the schema); (2) Android ML Kit GenAI with Gemini Nano (on-device); (3) built-in phrase grammar en/fr/de (≈ 60 KB, synonyms + number/age/distance patterns), always shipped, also used to validate (1)/(2) output. Target: parse < 400 ms p95 on (1)/(2), < 30 ms on (3).
- R-24.4 **Review sheet** "Here's your search": one row per filter group with chips (drop by tap), live count ("14 match within 10 km", from `GET /explore/summary` with those filters), buttons Edit filters (opens S-24 prefilled) and Show N. Footnote: "Your words stayed on this phone. Only these filters go to Thirstr."
- R-24.5 **Refusals** (P-4): HIV status, ethnicity/race words, and exclusion phrases ("no fems", "no fats", "no Asians"…, list in `ask_refusals.<lang>.json`) are never parsed into filters. Sheet shows a sunflower note per refusal with the reason and, where one exists, a neutral alternative (tribes). Three refusals in 7 days → the R-06.13 nudge, counted on device only.
- R-24.6 Applying an ask = applying filters; same request, same server rules (R-04.9, R-04.10). The server cannot tell an ask from the Filters sheet.
- R-24.7 **Plus.** Ask is a way to fill filters, not a filter: every filter stays free in the Filters sheet (pledge R-23.6 unchanged). Free: the Ask field shows with the `plus` "+" tag; tapping it opens S-90 at the Ask benefit (R-23.17). "Save as preset" reuses R-23.25.

## B · Fit (interests + compatibility)
- R-24.10 **Interests field** (F-06): up to 12 tag IDs from a curated list (94 tags in 12 groups: music, nights, outdoors, play, screen, food, culture, mind, travel, home, wellness, causes; `GET /profile-options` returns `interest_groups`). No free text. Translated en/fr/de. Safe for all lenses. Default visibility Public; R-06.4 applies. Edit hub (S-74) section "Interests". Storage: the profile's `fields` map like every catalogue field (no migration). Completeness: not weighted in v1.
- R-24.11 Grid cards carry `match` (the Fit inputs: interests, tribes, sports, sport_level, schedule, looking_for, position, hosting, practices, limits, each per R-06.4 visibility and the current lens) only for Plus viewers (`limits.ai_match`) and only when the owner's `fit_visible` setting is not false. Map pins never carry it. Profile view adds `fit_ok`. No new endpoint.
- R-24.12 **Fit score**, computed on the viewer's phone from fields the viewer may already see in the current lens:
  - shared interests (count), shared sports (Sport lens or Hookup), shared tribes;
  - Hookup lens only, both verified: position compatibility table (top↔bottom/vers bottom, vers↔any, side↔side), hosting complement (can host ↔ can travel/either), shared `looking_for` time intent (now / tonight), no item of his `into` in the viewer's limits and vice versa (else Fit = none).
  - Output: `common` (0–12) and `fit` (bool: position + hosting or intent match, no limit clash).
- R-24.13 Tiles: teal chip "N ♥" when common ≥ 1; coral "Fit" chip when `fit`. Sheet sort chips: Nearest (default, R-04.4) · ✦ Best fit · Online. Best fit re-orders the people already loaded (within the Free 200 / Plus cap), ties by distance.
- R-24.14 Profile (S-20): "Why you fit" card above tags: one line per reason (icon in lens colour), "worked out on your phone". Shared tags first, filled white.
- R-24.15 A person with "Count me in others' Fit" off: no chips, no card, excluded from Best fit ordering boost (shown in distance order).
- R-24.16 **Plus split** (owner 2026-11-28). Free: fill Interests (R-24.10), shared tags shown first on S-20, appear in others' Fit and Best fit. Plus: tile chips (R-24.13), Best fit sort, Why you fit card (R-24.14). Free tiles show no Fit chips and no placeholder. Tapping Best fit without Plus opens the limit card (R-23.16 rules). In the beta everyone is Plus (R-23.1). Not a filter, so the pledge (R-23.6) is not affected.

## C · Picks (later, needs B)
- R-24.20 **Plus only.** Two windows a day (07:00 and 19:00 local), up to 5 picks each; refresh once an hour. Free: no Picks row; appearing in others' Picks stays free. Row of cards at the top of the grid sheet; dots pager.
- R-24.21 Candidates: only people in the viewer's last grid result (no extra request). Never people the viewer hid, blocked, chatted with in the last 30 days, or picked in the last 7 days.
- R-24.22 Ranker on device: Fit features + learned weights (logistic regression, ≈ 40 weights) trained on the phone from the viewer's own taps, favourites, chats started and replies. Weights stored in the app's encrypted store, never synced to the server (E2EE device sync allowed).
- R-24.23 Each pick shows up to 3 reasons, incl. learned ones in plain words ("Like guys you reply to: 35–45, bears"). Actions: Not for me (hide from Picks 30 days), Less like this (negative example), Message.
- R-24.24 "See what Picks learned" lists the top learned traits; "Forget everything learned" wipes weights and history.
- R-24.25 Free: one inline card at the top of the grid sheet at most once a week ("✦ Picks and Fit come with Plus", See Plus, ✕ hides 7 days), R-23.16 / R-23.7 rules (never in the first 3 days). No paid boost into others' Picks, ever. New rows in R-23.5: Fit (— / on), Picks (— / 10 a day).

## Settings
- R-24.30 Settings › Privacy › **Ask, Fit & Picks**: Ask on Explore · Show Fit · Picks · Learn from what I do · Count me in others' Fit · See what Picks learned › · Forget everything learned (inline confirm). All on by default except Picks (on when built). Off = feature and its data gone from the phone.

## Cost (estimates)
| | Runtime | Data | Build |
|---|---|---|---|
| A Ask | €0 | 0 | ≈ 2 weeks |
| B Fit | €0 | +≈ 1.4 KB per 60-card grid page | ≈ 2 weeks |
| C Picks | €0 | 0 | ≈ 2–3 weeks after B |

## Build notes (v1, PR 340)

- Ask ships engine (3), the phrase grammar, on every phone. Engines (1) and (2) need native modules and come later (#346). Dictation uses the keyboard's own on-device dictation; no custom mic button.
- Suggestion chips from past asks (R-24.1) are not in v1.
- Picks: `limits.picks_per_day` = 10 for Plus (5 per window), 0 for Free. Candidates exclude anyone with an existing chat on this phone. Model, cooldowns and window state live in the private store key `thirstr.picks.v1`.
- Settings › Privacy › Ask, Fit & Picks: four switches (Ask, Fit, Picks, Learn from what I do), "Count me in others' Fit" (`fit_visible`, server setting), learned traits, Forget everything learned.

## Acceptance criteria (draft)
- AC-24.1 Network capture during an ask shows no request containing the query text or audio.
- AC-24.2 No parser path (any engine) emits HIV, ethnicity or language filters; refusal list covered by tests in en/fr/de.
- AC-24.3 Fit never uses a field the viewer could not see in that lens (test per lens × audience).
- AC-24.4 No endpoint accepts or returns a Fit score, ranking or learned weight.
- AC-24.5 Each switch in R-24.30 off → the feature is absent and its on-device data deleted.
