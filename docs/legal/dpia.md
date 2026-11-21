# DPIA: Thirstr dating & discovery service

> **DRAFT — NOT LEGAL ADVICE.** Claude (AI) draft, 2026-11-21. Not reviewed by a lawyer. Counsel review before open beta (#9, owner's separate OK). See [README](README.md).

| | |
|---|---|
| Version | 0.1 draft · 2026-11-21 |
| Controller | Thirstr (Swiss entity, D-02; to incorporate) |
| Owner | Jean-Yves (founder, acting DPO until one is appointed) |
| Frameworks | GDPR Art. 35 + EDPB/WP29 DPIA guidelines (WP248 rev.01); Swiss nFADP Art. 22–23; UK GDPR Art. 35 |
| Review | before open beta, before public launch, and on any change listed in §9 |
| Related | [`records-of-processing.md`](records-of-processing.md), [`../spec/security.md`](../spec/security.md), [`../spec/data-model.md`](../spec/data-model.md) |

## 1. Why a DPIA is mandatory
WP248 criteria met (two are enough): sensitive data on a large scale (sexual orientation, health), location tracking, vulnerable data subjects (LGBTQ+ people in hostile countries), innovative technology (on-device face matching, age estimation), automated decisions with significant effect (anti-bot quarantine), matching/combining datasets (report signals). nFADP Art. 22: high risk because of sensitive data processed extensively and profiling.

**Baseline decision: all account data is treated as special-category data** (GDPR Art. 9, nFADP Art. 5(c)). Having a Thirstr account reveals, or strongly suggests, a man's sexual orientation or sex life. So even "plain" data (email hash, device id, IP, payment receipt later) is protected as if it were Art. 9 data.

## 2. Description of the processing
### 2.1 Nature
Mobile app (iOS, Android later) and website for men who look for hookups, friends and sport partners nearby. Server: Elixir/Phoenix on Fly.io EU regions (fra, ams), Postgres, Valkey (RAM only), Tigris object storage. Chat is end-to-end encrypted (MLS); the server stores ciphertext only.

### 2.2 Scope: data and where it lives
| Category | Examples | Server sees | Art. 9 / sensitive |
|---|---|---|---|
| Account | account id, created_at, status, birthdate, age confirm, auth credential ids, hashed OIDC subject, hashed email | yes | yes (account existence) |
| Public profile | display name, age, photos (≤ 5 public), bio, body, tribes, orientation, pronouns, looking for, lenses | yes (public by intent) | yes: orientation, sex life |
| Hookup fields | position, practices, hosting, groups (coarse flags, verified viewers) | yes | yes: sex life |
| Health fields | HIV status, PrEP, testing dates | **no** (E2EE to chat partners only) | yes: health |
| Location | H3 cells r5–r10, exact pin (opt-in, RAM, ≤ 4 h), viewer cell (RAM 24 h) | coarse cells | yes (reveals movements + presence at gay venues) |
| Chats, private albums, videos, notes, favorites, friends | message text, media | ciphertext only / device only | yes |
| Safety | trusted-contact relays, held alerts | ciphertext only | yes |
| Verification | liveness + face match + age estimate | **on device only**; server keeps a blind-signed token + result | biometric (processed on device only) |
| Moderation | reports, franked messages the reporter attached, actions, appeals | yes | yes |
| Technical | device id, push token (encrypted), attestation key, IP (hashed 24 h, never stored raw), rate counters | yes | yes (linked to account) |
| Events & activity | Tonight plans, parties, activities, venue check-ins, Moments, trips | yes (coarse cells, expiring) | yes |

### 2.3 Data subjects
Users (18+ men incl. trans and non-binary people), people shown in user photos, people named in reports, trusted contacts (no account; web page), notifiers using the web report form (DSA), testers.

### 2.4 Recipients
Other users (per field visibility), processors (see RoPA §3), authorities only on valid legal order (A-08 legal register), NCMEC / national hotlines for CSAM.

### 2.5 Purposes
1. Provide the service (discovery, chat, events). 2. Safety (check-ins, reports, blocks). 3. Anti-bot and anti-abuse. 4. Age assurance (18+). 5. Moderation and legal compliance (DSA, CSAM). 6. Security and reliability. 7. Support. **Never:** advertising, sale or sharing of data, profiling for marketing, analytics SDKs (governance lock).

### 2.6 Retention
As in [`data-model.md`](../spec/data-model.md) › Retention, enforced by `Thirstr.Retention` probes (EN-17): deleted account hard-deleted ≤ 24 h, backups roll off ≤ 30 d; reports 1 y, franked payload decision + 90 d; location overwritten / 24 h; undelivered ciphertext 30 d.

## 3. Necessity and proportionality
| Principle | How it is met | Evidence |
|---|---|---|
| Lawfulness (Art. 6 + 9) | see §4 | consent screens F-02, privacy policy |
| Purpose limitation | purposes §2.5 only; governance lock bans ads and data sale | `governance-lock.md` |
| Data minimisation | coarse location by default, server never sees chats/health/albums, no email unless magic link, birthdate never returned by API, IP hashed | data-model.md, security.md |
| Accuracy | user edits own profile; verification proves photos match | F-03, F-06 |
| Storage limitation | expiry on every ephemeral object, measured | `Thirstr.Retention`, alert `thirstr_retention_overdue` |
| Integrity & confidentiality | E2EE (MLS), SQLCipher on device, TLS 1.3, backups client-side encrypted, admin FIDO2 + audit log | security.md, admin-console.md |
| Data subject rights | in-app export (R-01.11), delete ≤ 24 h (R-01.10), edit, pause, visibility control per field | F-01, F-17 |
| Privacy by default (Art. 25) | Area (~200 m) default, health default "chats", exact pin opt-in and expiring, Safe Mode Auto | F-05, F-06, F-14 |

## 4. Legal bases (to confirm by counsel)
| Processing | Art. 6 | Art. 9 condition | nFADP |
|---|---|---|---|
| Account + public profile incl. orientation | contract (6(1)(b)) | **explicit consent** 9(2)(a), collected at sign-up (separate, unticked, withdrawable = delete account); fields the user publishes himself: also 9(2)(e) | consent (Art. 6(7)(a)) |
| Hookup and health fields | contract | explicit consent per field (optional fields, visibility chosen by the user) | consent |
| Location cells | contract | explicit consent (location permission + level choice) | consent |
| On-device verification (biometrics) | contract | explicit consent at S-06; no server processing of biometric data | consent |
| Anti-bot signals, quarantine | legitimate interest (6(1)(f)): platform integrity | 9(2)(a) consent covers account data; signals are metadata | overriding interest (Art. 31) |
| Moderation, reports, DSA | legal obligation (6(1)(c)) for DSA duties; legitimate interest otherwise | 9(2)(f) legal claims / 9(2)(g) substantial public interest (to confirm) | Art. 31 |
| CSAM reporting | legal obligation | 9(2)(g) | Art. 31 |
| Security logs | legitimate interest | — (no content) | Art. 31 |

**Open question for counsel:** consent can be withdrawn at any time; withdrawal = account deletion. Is that acceptable "freely given" consent when the whole service depends on it (Art. 7(4))? Draft position: yes, because orientation is intrinsic to the service purpose and nothing beyond what's needed is bundled.

## 5. Risks to people
Likelihood × severity on a 1–4 scale (WP248 approach). Severity is high by default because of outing, violence and criminal prosecution risks.

| # | Risk | Source (security.md) | L | S | Inherent |
|---|---|---|---|---|---|
| R1 | Outing: someone's account or orientation becomes known to family, employer, state | A2, A4, A6, A9 | 3 | 4 | **high** |
| R2 | Physical location of a user found (stalking, gay-bashing, entrapment) | A1, A2 | 3 | 4 | **high** |
| R3 | State actor in a criminalising country identifies or entraps users | A2, A7 | 2 | 4 | **high** |
| R4 | Data breach of server DB / backups | A6 | 2 | 4 | **high** |
| R5 | Private photos / chats leaked (screenshots, insiders, device seizure) | A5, A8 | 3 | 3 | high |
| R6 | Health status (HIV) disclosed beyond chosen audience | A5, A6 | 2 | 4 | high |
| R7 | Minors on the platform | — | 3 | 4 | **high** |
| R8 | Sextortion / scams by bots or fake profiles | A3 | 3 | 3 | high |
| R9 | Wrongful automated quarantine / ban (no human, no redress) | — | 2 | 3 | medium |
| R10 | Scraping of public profiles into datasets | A9, A4 | 3 | 3 | high |
| R11 | Transfer exposure: US provider compelled under CLOUD Act / FISA 702 | A7 | 2 | 3 | medium |
| R12 | Biometric data misuse (face templates) | — | 1 | 4 | medium |
| R13 | Function creep: future owner adds ads or sells data | — | 2 | 4 | high |
| R14 | Moderator sees more than needed | A5 | 2 | 3 | medium |

## 6. Measures and residual risk
| # | Measures (implemented ✔ / planned ○) | Residual |
|---|---|---|
| R1 | ✔ no ads, no SDKs; ✔ disguised icon, app lock, duress PIN; ✔ hashed identifiers; ✔ no public web profiles; ✔ IP hashed 24 h; ○ EU-owned host review (#23) | medium |
| R2 | ✔ Area default (H3 r9, k-anonymity ≥ 5, widens), ✔ exact pin opt-in, jittered, RAM-only, ≤ 4 h; ✔ precise distance opt-in with rounding + crowd floor; ✔ hide-from-hidden; ✔ trilateration harness in CI; ✔ block both ways | medium |
| R3 | ✔ Safe Mode (66 countries, auto), ✔ verified-only visibility, ✔ no server country lists, ✔ duress wipe; ✔ entrapment warnings; ○ warrant canary + transparency report | medium |
| R4 | ✔ E2EE (nothing readable for chats/health/albums), ✔ backups encrypted client-side, ✔ least-privilege, ✔ secret scanning, ○ KMS pepper (#27), ○ pen test before public beta (EN-08) | medium |
| R5 | ✔ E2EE MLS, ✔ view-once + expiry, ✔ screenshot notices, ✔ SQLCipher, ✔ panic wipe; residual: a second phone can film (stated in UI) | medium |
| R6 | ✔ health E2EE only, default audience "chats", never public (AC-06.3) | low |
| R7 | ✔ age gate + birthdate, ✔ on-device age estimate, Yoti fallback < 23 (D-13), ✔ "underage" report reason severity 1, ○ market-specific age assurance (`age-assurance.md`) | medium |
| R8 | ✔ verification required to initiate, ✔ attestation, ✔ quarantine, ✔ first-message link block, ✔ video check, ✔ scam report one tap | medium |
| R9 | ✔ statement of reasons + appeal (R-AD.9, R-15.14); ○ DSA flows v2 (R-15.23–36: human review of every appeal, facts + automation disclosure); residual: one moderator in beta (D-12) | medium |
| R10 | ✔ 300 profiles/h cap, ✔ attestation, ✔ random pagination tokens, ✔ scraping harness | medium |
| R11 | ✔ EU regions only, ✔ E2EE, ✔ minimal plaintext; ○ DPF/SCC check, ○ KMS keys outside Fly, ○ #23 hosting review | medium |
| R12 | ✔ biometrics never leave the device, templates deleted after check (R-03.5, AC-03.1) | low |
| R13 | ○ governance lock (articles + golden share + user promise) | low once in place |
| R14 | ✔ moderators see only reported content + franked messages (R-AD.6, AC-AD.3), ✔ audit log append-only | low |

**Residual risk overall: medium** after planned measures. No residual "high" risk once ○ items for R4, R7 and R13 are done, so **prior consultation (GDPR Art. 36 / nFADP Art. 23) is not expected**. Counsel to confirm.

## 7. Consultation
- Data subjects: closed beta feedback (D-04, ~500 testers) on privacy controls; summary to be added here.
- DPO / counsel: pending (#9).
- Processors: DPAs listed in [`../compliance/inventories.md`](../compliance/inventories.md).

## 8. Actions before open beta
| Action | Owner | Issue |
|---|---|---|
| Lawyer review of this DPIA, RoPA, privacy policy, ToS | owner (separate OK) | #9 |
| Appoint EU Art. 27 + UK representative, DSA Art. 13 legal representative | owner | #170 |
| Sign DPAs with every processor; record DPF / SCC status | owner | #169 |
| Consent screen for Art. 9 explicit consent (separate from ToS acceptance) | build after spec | new issue |
| Governance lock in articles | owner + notary | #9 |
| KMS pepper, pen test | eng | #27, #167 |

## 9. Review triggers
New data category, new processor, new country with Safe Mode change, new automated decision, cloud translation (D-16), payments (Plus), web client, breach, or 12 months since last review.
