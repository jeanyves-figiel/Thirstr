# Records of processing activities

> **DRAFT — NOT LEGAL ADVICE.** Claude (AI) draft, 2026-11-21. Not reviewed by a lawyer. Counsel review before open beta (#9). See [README](README.md).

GDPR Art. 30(1) · UK GDPR Art. 30 · nFADP Art. 12. Version 0.1, 2026-11-21. Keep in sync with [`../spec/data-model.md`](../spec/data-model.md): a PR that adds a table, field or vendor updates this file (checklist item in `../compliance/procedures.md` › Change management).

## 1. Controller
| | |
|---|---|
| Controller | Thirstr (Swiss entity, to incorporate, D-02) |
| Contact | `hello@thirstr.fun` (privacy@ alias to add) |
| DPO | none appointed (not mandatory under nFADP; GDPR Art. 37 to confirm given large-scale Art. 9 processing — **likely mandatory once at scale**) |
| EU representative (Art. 27) | to appoint |
| UK representative (Art. 27 UK GDPR) | to appoint |

## 2. Processing activities
All activities: data subjects = users (18+) unless stated; all account data treated as special-category (DPIA §1).

| ID | Activity | Purpose | Data | Legal basis (Art. 6 / 9) | Recipients | Retention | TOMs |
|---|---|---|---|---|---|---|---|
| P-01 | Account & sign-in | create and secure accounts | account row, passkey public keys, hashed OIDC sub, hashed email, refresh token hashes, devices | 6(1)(b) / 9(2)(a) | Apple, Google (sign-in), Amazon SES (magic link) | account life; deleted ≤ 24 h after delete | passkeys, hashing with pepper, token rotation |
| P-02 | Age gate & verification | 18+, real human, photo match | birthdate, age confirm, verification result + blind token; biometrics on device only | 6(1)(c)/(b) / 9(2)(a) | Yoti (fallback, boolean, zero retention) | birthdate: account life; token: spent hash only | on-device processing, blind signatures |
| P-03 | Profile & photos | show the user to others | profile fields, ≤ 5 public photos, classifier scores | 6(1)(b) / 9(2)(a), 9(2)(e) | other users, CDN | until edited/deleted | field visibility, classifier on own infra |
| P-04 | Location & discovery | show people nearby | H3 cells, exact pin (RAM), viewer cell (RAM), trips | 6(1)(b) / 9(2)(a) | other users (coarse) | overwritten; 24 h inactivity; pin TTL ≤ 4 h | k-anonymity, jitter, Safe Mode |
| P-05 | Chat & media | messaging | MLS ciphertext, media blobs (ciphertext), franking tags | 6(1)(b) / 9(2)(a) | recipients only | until delivered, ≤ 30 d | E2EE, ack delete |
| P-06 | Events | Tonight, parties, activities, venues, Moments | posts, requests, check-ins (coarse cells) | 6(1)(b) / 9(2)(a) | other users | expiry + 1 h | auto-expiry sweeps |
| P-07 | Safety | check-ins, trusted contacts, SOS | relay hashes, ciphertext alerts | 6(1)(b), 6(1)(d) vital interests / 9(2)(a), 9(2)(c) | trusted contacts (web page) | ack or 24 h | E2EE, relay tokens |
| P-08 | Anti-bot & abuse | platform integrity | signals (counters, hashes), attestation, rate limits | 6(1)(f) / 9(2)(a) | none | windows ≤ 30 d | RAM counters, no content |
| P-09 | Moderation & DSA | handle reports, notices, appeals, statements of reasons | reports, franked messages, actions, appeals, notifier contact (web form) | 6(1)(c) DSA, 6(1)(f) / 9(2)(f)/(g) | moderators; authorities on order; DSA transparency DB (if applicable) | reports 1 y; franked decision + 90 d; actions + appeals 1 y after last action (to confirm) | R-AD.6 minimal views, audit log |
| P-10 | CSAM reporting | legal duty | hash match result, minimal account metadata | 6(1)(c) / 9(2)(g) | NCMEC / national hotline / police | as law requires | senior_mod only |
| P-11 | Support | answer requests | email, message content user sends | 6(1)(b) | helpdesk (EN-19, EU, to pick) | 1 y after closure | — |
| P-12 | Security & ops | availability, incident response | hashed IP 24 h, metrics, error reports (scrubbed), admin audit log | 6(1)(f) | Fly.io | logs ≤ 30 d; audit log 2 y | no ids in logs, PII scrub |
| P-13 | Backups & DR | restore after failure | full DB copy (encrypted client-side) | 6(1)(f) | Tigris (ciphertext) | 30 d | aes-256 before upload |
| P-14 | Website & contact | marketing site, contact email | IP (hashed, transient), email to hello@ | 6(1)(f) | ImprovMX (forwarding), Fly | email: inbox retention | no trackers |
| P-15 | Data subject requests | export, delete, rectify, object | request record, proof of completion | 6(1)(c) | — | 3 y (proof) | in-app tooling |
| P-16 | Legal requests | respond to authorities | request register (A-08) | 6(1)(c) | requesting authority | 5 y (to confirm) | legal role only |

## 3. Processors and sub-processors
Full inventory with DPA status: [`../compliance/inventories.md`](../compliance/inventories.md) › Vendors.

## 4. International transfers
| Recipient | Country of entity | Data location | Mechanism (to verify) | Note |
|---|---|---|---|---|
| Fly.io, Inc. | USA | EU regions (fra, ams) | EU–US Data Privacy Framework if certified, else SCCs (2021/914) + TIA; Swiss–US DPF for nFADP | CLOUD Act exposure; mitigated by E2EE, client-side backup encryption, KMS outside Fly (#27); review #23 |
| Tigris Data, Inc. | USA | EU placement (to confirm, #27) | same as Fly | stores public photos + ciphertext |
| Amazon Web Services (SES) | USA (AWS EMEA SARL contract) | eu-central-2 Zurich | AWS DPA + SCCs; DPF | email address in transit |
| Apple Inc. | USA | global | Apple's terms; DPF | APNs (opaque token), Sign in with Apple, App Attest |
| Google LLC | USA | global | Google's terms; DPF | FCM, Google sign-in (`openid` only) |
| Yoti Ltd | UK | UK | UK adequacy (EU) / Swiss adequacy list | boolean only, zero retention |
| ImprovMX | to check | to check | to check | forwards `hello@` |
| GoDaddy | USA | — | — | DNS only, no personal data |

Switzerland ↔ EU: adequacy both ways. UK: adequacy both ways.

## 5. Technical and organisational measures (summary)
See [`../spec/security.md`](../spec/security.md) and [`../compliance/controls.md`](../compliance/controls.md).
