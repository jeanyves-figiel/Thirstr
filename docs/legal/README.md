# Legal & compliance drafts

> **DRAFT — NOT LEGAL ADVICE.** Written by Claude (AI) on 2026-11-21 for internal planning. Not reviewed by a lawyer. Owner decision 2026-11-21: "Claude drafts, lawyer later". A privacy/platform lawyer reviews everything here **before open beta** (#9, ~€2–4k, needs the owner's separate OK). Do not publish, send to a regulator or store, or rely on these texts as legal advice.

## Documents
| Doc | Covers | Issue |
|---|---|---|
| [`dpia.md`](dpia.md) | Data protection impact assessment, all account data treated as GDPR Art. 9 / nFADP sensitive | #9 |
| [`records-of-processing.md`](records-of-processing.md) | GDPR Art. 30 / nFADP Art. 12 records, processors, transfers, retention | #9, #169 |
| [`governance-lock.md`](governance-lock.md) | Binding "no ads, no data sale" lock: articles clause, golden share, user promise | #9 |
| [`store-policy-review.md`](store-policy-review.md) | Apple App Store + Google Play adult/dating/UGC rules, gap list, web fallback plan | #9 |
| [`dsa.md`](dsa.md) | EU Digital Services Act: notice-and-action, statement of reasons, appeals, contact points, legal representative | #170 |
| [`transparency-report-template.md`](transparency-report-template.md) | Yearly DSA / quarterly F-15 transparency report template | #170 |
| [`age-assurance.md`](age-assurance.md) | UK Online Safety Act + age assurance per market | #170 |
| [`../compliance/controls.md`](../compliance/controls.md) | ISO 27001:2022 / SOC 2-aligned control set (no certification) | #169 |
| [`../compliance/inventories.md`](../compliance/inventories.md) | Asset + vendor inventory with DPA status | #169 |
| [`../compliance/procedures.md`](../compliance/procedures.md) | Access review, change management, evidence collection, DSR + retention proofs | #169 |

Product flows these drafts require (report → statement of reasons → appeal) are specified in F-15 R-15.23–R-15.36 ([mockup](https://claude.ai/artifact/L7VFBJLiQv5Vysz3YN5M1M)) and wait for the owner's mockup pick before any build.

## Legal frame (to confirm by counsel)
- **Controller:** Thirstr, Swiss entity (D-02, not yet incorporated). Primary law: Swiss revised Federal Act on Data Protection (**nFADP**, in force 2023-09-01).
- **GDPR applies** (Art. 3(2)): the service targets and monitors people in the EU. No EU establishment ⇒ **EU representative required (Art. 27)**, no one-stop-shop: every EU supervisory authority is competent.
- **UK GDPR** applies to UK users ⇒ **UK representative (Art. 27 UK GDPR)**.
- **DSA applies** (Art. 2): substantial connection to the EU. No EU establishment ⇒ **DSA legal representative (Art. 13)** in a Member State.
- **UK Online Safety Act** applies once UK users can sign up (user-to-user service with pornographic user content ⇒ highly effective age assurance).
- Hosting: Fly.io (US company, EU regions only, D-03) ⇒ transfer analysis in the RoPA.

## Open questions for counsel (collected from all drafts)
1. Is processing sexual orientation based on **explicit consent** (Art. 9(2)(a)) enough on its own, given account existence reveals it? Or also Art. 9(2)(e) for public profile fields? (dpia.md §4)
2. Shadow quarantine of bot/scam accounts without a statement of reasons: covered by DSA Recital 55 (deceptive high-volume / inauthentic use) only for spam/bot; what about quarantine after severe reports? (dsa.md §4)
3. DSA micro/small-enterprise exemption (Art. 19, Art. 15(2)): we plan to comply voluntarily; confirm what is strictly mandatory now. (dsa.md §1)
4. Fly.io and Tigris are US companies: is EU-region hosting + E2EE + EU-US Data Privacy Framework / SCCs sufficient, or is an EU-owned host needed before public launch (#23)? (records-of-processing.md §4)
5. Germany JMStV: do private albums with explicit content need a "closed user group" with age verification for German users? (age-assurance.md §3)
6. Governance lock vehicle: Swiss foundation with golden share vs steward-ownership GmbH; tax and notary costs. (governance-lock.md)
7. Duty to report CSAM / threats to life (DSA Art. 18) for a Swiss entity: which authority per Member State; NCMEC for US users. (dsa.md §7)
8. Age-estimation model on device as primary age check: acceptable as "highly effective" in the UK, or must UK users go through a certified provider? (age-assurance.md §2)
