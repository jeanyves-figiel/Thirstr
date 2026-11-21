# Thirstr — Functional & technical specification (beta)

Status: draft v0.1 · 2026-11-17 · Source of truth before any code. Product rationale lives in [`docs/concept/`](../concept/); this folder says **exactly what to build**.

## Conventions
- Each feature spec: Purpose · Scope (beta / later) · User stories · Rules · States · Interactions · Edge cases · Data · API · Privacy · Acceptance criteria.
- IDs: features `F-xx`, screens `S-xx`, rules `R-xx.n`, acceptance criteria `AC-xx.n`. Reference them in issues/PRs.
- "Verified" = holds a valid verification credential (F-03). "Visible" = Location level ≠ Hidden (Incognito merged into Hidden, #114).
- Times are device-local in UI, UTC on server. Distances metric by default.
- MUST / SHOULD / MAY per RFC 2119.
- Every change to a spec: ChangeLog entry + linked issue.

## Index
| ID | Spec |
|---|---|
| ADR-0001 | [Backend & client stack](adr/0001-stack.md) |
| — | [Owner decisions](decisions.md) |
| — | [Glossary](glossary.md) |
| — | [Data model](data-model.md) |
| — | [API & realtime contract](api.md) |
| — | [Screen inventory](screens.md) |
| — | [Design system: tokens, copy, i18n, a11y](design-system.md) |
| — | [Threat model & security plan](security.md) |
| — | [CI/CD, environments & operations](ops.md) |
| — | [Scalability, message reliability & phone cache (review 2026-11-21)](scalability-and-reliability.md) |
| — | [Enterprise readiness: plan, roadmap & costs](enterprise-readiness.md) |
| — | [Test strategy](testing.md) |
| — | [Admin & moderation console](admin-console.md) |
| W-01 | [Public website (marketing site)](website.md) |
| — | [Privacy-preserving metrics](metrics.md) |
| — | [Required vs optional fields](required-fields.md) |
| F-01 | [Auth & account](features/F01-auth.md) |
| F-02 | [Onboarding](features/F02-onboarding.md) |
| F-03 | [Verification](features/F03-verification.md) |
| F-04 | [Explore: map, grid, modes, filters](features/F04-explore.md) |
| F-05 | [Location & visibility](features/F05-location.md) |
| F-06 | [Profiles](features/F06-profiles.md) |
| F-07 | [Chat](features/F07-chat.md) |
| F-08 | [Media & private albums](features/F08-media.md) |
| F-09 | [Tonight & Now](features/F09-tonight.md) |
| F-10 | [Parties](features/F10-parties.md) |
| F-11 | [Activities & clubs](features/F11-activities.md) |
| F-12 | [Venues & check-in](features/F12-venues.md) |
| F-13 | [Safety: check-in, trusted contacts, panic, app lock](features/F13-safety.md) |
| F-14 | [Safe Mode](features/F14-safe-mode.md) |
| F-15 | [Moderation & anti-bot](features/F15-moderation.md) |
| F-16 | [Notifications](features/F16-notifications.md) |
| F-17 | [Settings](features/F17-settings.md) |
| F-18 | [Vouches & trust badges](features/F18-trust.md) |
| F-19 | [Gestures & haptics](features/F19-gestures.md) |
| F-20 | [Travel plans](features/F20-travel.md) (#188) |
| F-21 | [Moments: temporary photos](features/F21-moments.md) (#212, placement pick pending) |
| I-01 | [Social post sharing (X, Bluesky, OnlyFans, JustFor.Fans)](integrations/I01-social-share.md) |
| I-02 | [GDPR export import & profile share link](integrations/I02-import-share-link.md) |
| I-03 | [Platform services: push, maps, passkeys, attestation, stores](integrations/I03-platform.md) |

## Beta scope (v1)
All F-01…F-20 and I-01…I-03 are beta scope unless a section says **Later**. Later (v2+): video calls, health module beyond fields, Plus billing, open federation protocol, web client.
