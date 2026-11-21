# Required vs optional fields

Status: decided by the owner on 2026-11-18 through the [required fields form](https://claude.ai/artifact/QAmbqaCeHXRymyo7SBfk2f) (answers stored with it). This page is the single list of what a person **must** provide, what is **optional**, and what has a **default**. Feature specs link here instead of repeating the rules.

Legend: **Required** = cannot continue without it · **Optional** = can be skipped forever · **Default** = pre-filled, can be changed · **Gate** = optional, but something is locked until it is done.

## Sign-up and onboarding (F-01, F-02)

| ID | Item | Rule | Notes |
|---|---|---|---|
| RF-0 | Sign-in method | Required, one of Apple, passkey, Google, email link | 18+ consent line on S-02 (R-01.12). |
| RF-1 | Display name | Required, 1–20 characters | Was 30. Grid cards and chat headers fit 20. Existing longer names stay until edited (the limit applies on change). |
| RF-2 | Birthday | Required, age ≥ 18 | Legal. Under 18 blocks and deletes (R-02.3). Only the age is shown. |
| RF-3 | I am (gender) | **Optional** | S-03c adds a fifth option "Prefer not to say" (auto-advances). Stored as `unspecified`; a request without `gender` is stored the same way. Not shown on the profile. |
| RF-4 | Here for | Required, at least 1 | **Nothing pre-selected** (owner choice). Continue stays disabled until one tile is picked. Sets the default Explore mode. |
| RF-5 | Location level | Required (City if permission is denied) | Hidden and Exact need verification (AC-05.4). |
| RF-6 | Main photo | **Gate** | S-05 has "Add it later" (`POST /me/onboarding/photo_later`). Without a main photo that passed the check the account is invisible everywhere (Explore needs a photo). S-07 shows the initial on the card and "Nobody sees you until you add one."; Explore shows a yellow "Add a main photo" banner above the verify banner, which opens Edit profile. |
| RF-6a | Face in the main photo | **Optional** | Faceless main photos are allowed: vanilla and a person (F-15 R-15.10). Copy changed from "Show your face." to "Show yourself." The verified badge carries the trust. |
| RF-6b | Extra public photos | Optional, 0–4 | Unlock once the main photo passes. |
| RF-7 | Sign-in email | Optional | Not asked in onboarding. Settings › Account › "Sign-in email" (`POST /me/email`, link to confirm, only the hash is stored). Offered once on Me, 7 days after sign-up, if none is on file; "Not now" hides it for good on that phone. `GET /me` returns `has_email`. |
| RF-8 | Verification | **Gate** | Needed to be visible and to message first (unchanged). "Later" lands on Explore browse-only. |
| RF-9 | Push permission | Optional | Asked on the first inbound event, never in onboarding (R-02.9). |

## Profile (F-06)

| ID | Item | Rule | Notes |
|---|---|---|---|
| RF-10 | Visible to others | Display name, age, main photo, verified | Gender is no longer part of this list (RF-3). |
| RF-11 | All other fields | Optional | Pronouns, orientation, languages, bio, prompt, body, looking for, relationship, position, practices, limits, hosting, groups, boundaries, health, sport fields. No field is required to save Edit profile. |
| RF-11a | Health fields | Optional, default visibility My chats | Never Public, HIV never filterable (R-06.5, AC-06.2). |
| RF-12 | Completeness ring | Basics count | Weights: basics 20 (always met after onboarding), main photo 20, extras 10 (2.5 each), bio 10, body 10, looking for 5, hookup or sport 10, prompt 5, languages 10. A profile fresh out of onboarding shows 40 % (20 % without a photo) instead of 6 %. |

## Tonight, parties, Activities (F-09, F-10, F-11)

| ID | Item | Rule | Notes |
|---|---|---|---|
| RF-13 | Tonight plan | Time window and tag required; **text optional** (max 140) | A plan with no text shows its tag ("Hosting", "Drinks first"…) as the line. |
| RF-14 | Party | Title required (1–40); everything else pre-filled | Defaults: starts in 1 h, 4 h long, 6 guests, rule "Safer", audience Verified. Area is automatic. Address only via chat. |
| RF-15 | Activity post | Title and time required | Time comes from chips (default set), place and capacity optional. |

## Safety (F-13)

| ID | Item | Rule | Notes |
|---|---|---|---|
| RF-16 | App lock | Optional; required in Safe Mode | Unchanged (R-02.10). |
| RF-17 | Meet check-in | Needs one accepted trusted contact | Unchanged: a pending invite is not enough. |

## Acceptance criteria
- AC-RF.1 `PUT /me/basics` with a 21-character name → 422; with no `gender` → 200 and `gender: "unspecified"`.
- AC-RF.2 `POST /me/onboarding/photo_later` on step `photo` → step `verify`; any other step → 409. The account does not appear in Explore until a main photo is `ok_main`.
- AC-RF.3 Completeness right after basics = 20; after a passing main photo = 40.
- AC-RF.4 `POST /tonight/plans` with empty text → 201.
- AC-RF.5 `POST /me/email` → 202; consuming the link sets `has_email: true`; the email then signs into the same account.
