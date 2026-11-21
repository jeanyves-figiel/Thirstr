# F-14 Safe Mode

## Trigger
- R-14.1 Country from device cell r5 → bundled ILGA criminalization list (offline, updated with app). Also IP country at Welcome.
- R-14.1a List rule (owner, issue 49, 2026-11-17): ILGA World legal data plus countries with active persecution without a law (e.g. EG, IQ, RU); whole country even where only a province criminalises (ID). Countries with "LGBT propaganda" laws only are not listed (users there can set Always on). Updates after launch: one public file `GET /v1/safe-mode/countries`, identical for every phone and cached; the app checks it at most daily and may only add countries to its bundled list, never remove (removals ship in an app release), so a tampered server can only switch protection on. Changes go through a GitHub PR with sources, approved by the owner.
- R-14.2 Setting: Auto (default) / Always on / Off. Turning Off in a listed country needs a second explicit warning.

## Protections when on
| Protection | Behaviour |
|---|---|
| Location | Default City; Exact disabled (override = second warning); map shows counts only |
| Visibility | Visible to verified users only; new accounts (< 7 d) can't see you |
| App lock | Forced on |
| Icon | Prompt to switch to disguised icon (Notes/Calculator/Weather) |
| Notifications | No previews, generic title "Reminder" |
| Media | Received media auto-delete after viewing; save disabled |
| Duress PIN | Offered at activation |
| Parties/venues | Creation and check-in disabled; no place layers on the Explore map (#113) |
| Entrapment warnings | Banner on chats with accounts < 30 d, unverified, or pushing to meet quickly (heuristic: meet request within 5 messages) |
| Resources | International NGOs only in beta (Rainbow Railroad, ILGA World, Front Line Defenders); local groups need vetting first (fake help lines are an entrapment method) |
| Onboarding | F-02 R-02.10 variant |

## Rules
- R-14.6 (#188) Travel (F-20): locals in Safe Mode are never returned to Look-around viewers (R-20.17); showing yourself early in a listed country needs a second confirm (R-20.19).
- R-14.3 No server-side list of users in a country is ever produced; detection is client-side.
- R-14.4 Leaving the country: prompt to restore previous settings.
- R-14.5 Moderation coverage: reports from Safe Mode countries prioritized (SLA 1 h).

## Acceptance criteria
- AC-14.1 With Safe Mode on, no Exact pin can be set without passing the second warning.
- AC-14.2 Push payload titles in Safe Mode are generic.
