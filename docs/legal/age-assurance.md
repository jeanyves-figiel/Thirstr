# Age assurance per market · UK Online Safety Act

> **DRAFT — NOT LEGAL ADVICE.** Claude (AI) draft, 2026-11-21. Age-verification law changes quickly; re-check each market's current rules before opening it. See [README](README.md).

Principle: Thirstr is **18+ only everywhere**. Age assurance must be strong where the law requires it, private everywhere (no ID images or face data stored by us, D-13, F-03 R-03.5).

## 1. Current mechanism (F-02, F-03, D-13)
1. Birthdate wheel at sign-up (self-declaration) + "I'm 18+" consent line.
2. Verification (needed to be seen and to start chats): on-device liveness + face match + **on-device age estimation**; estimate < 23 ⇒ second method: Yoti (zero retention, boolean only).
3. Unverified: browse + reply only (D-10).
4. Reports "Underage" = severity 1, SLA 1 h.

Gap: an unverified account can browse public profiles (incl. "spicy" slots) on self-declaration only.

## 2. United Kingdom: Online Safety Act 2023
| Duty (Ofcom codes) | Applies to Thirstr | Draft plan |
|---|---|---|
| Illegal content risk assessment + safety measures (in force since March 2025) | yes (user-to-user) | write UK illegal-harms risk assessment from DPIA §5 + F-15; record keeping; name a senior accountable person (owner) |
| Children's access assessment (since April 2025) | yes | conclusion: not likely accessed by children **only if** highly effective age assurance (HEAA) gates the whole service |
| Children's safety duties + **HEAA for pornographic content** (since 25 July 2025) | yes: users can share pornographic content (private albums, chat) | **HEAA before any access** for UK users |
| Complaints, ToS, user empowerment | yes | covered by DSA flows (R-15.23+) |
| Category 1/2A/2B duties | no (thresholds far above) | — |

**HEAA:** Ofcom says self-declaration and ToS bans are **not** highly effective. Methods Ofcom lists as capable: facial age estimation, photo-ID matching, open banking, credit card checks, mobile network operator checks, digital identity wallets, email-based age estimation. Criteria: technically accurate, robust, reliable, fair.

Plan for UK users (country from store region + IP city lookup + phone locale; the service must not rely on a single signal):
1. Sign-up stops before Explore at **"Confirm you're 18+"**: on-device facial age estimation (our model) **plus** Yoti facial age estimation or Yoti digital ID / ID scan when our estimate < 25 (challenge age buffer, Ofcom guidance). Counsel to confirm whether our own on-device model counts as HEAA without third-party certification; **fallback: Yoti for every UK user** (cost ~£0.10–0.25 per check, to quote).
2. No browsing for UK users before HEAA passes (unlike D-10).
3. Re-check: on suspicion (report "Underage"), and when a device changes country to UK.
4. Record: boolean + method + date only.

## 3. Per market (to confirm per country before opening it)
| Market | Main rule | Draft requirement | Status |
|---|---|---|---|
| EU (all) | DSA Art. 28 (minors), GDPR Art. 8; Commission age-verification blueprint / EU Digital Identity Wallet (2026) | 18+ gate + verification; accept EUDI wallet age proof when available | ✔ baseline |
| Germany | JMStV §4(2): pornographic telemedia only in closed user groups with age verification (KJM-approved AVS) | treat as UK: AV before access to private albums / explicit chat for DE users; counsel to confirm whether user-to-user E2EE albums fall under JMStV | ○ before Berlin beta grows |
| France | SREN law 2024 + Arcom référentiel (porn sites, "double anonymity") | likely n/a to a dating app with private UGC; monitor Arcom scope | ○ check |
| Italy | AGCOM age-verification rules for porn sites (2025) | monitor scope | ○ check |
| Switzerland | Youth protection in films and video games act (JSFVG, 2025–2027 phase-in), StGB Art. 197 (porn to under-16s) | 18+ gate + verification sufficient (draft) | ✔ |
| United Kingdom | OSA (above) | HEAA for all UK users before access | ○ **blocker for UK launch** |
| USA | state laws (e.g. Texas HB 1181 for porn sites; app-store accountability acts Texas SB 2420, Utah, Louisiana from 2026) | iOS Declared Age Range / Play Age Signals APIs as extra signal; HEAA-like check for states that require it | ○ before US launch |
| Australia | Online Safety Act + age-restricted material codes (2025–26), social media minimum age (16) | HEAA-style check | ○ before AU launch |
| Safe Mode countries (66) | criminalisation | unchanged; age checks never send identity data | ✔ |

## 4. Product changes this implies (spec later, not built)
- R-02 market switch: `age_assurance_level` per country from `/v1/config` (EN-13 flags): `self` (default), `heaa` (UK, DE…), `blocked` (markets not opened).
- `heaa` markets: S-03h "Confirm you're 18+" screen before Explore; Yoti flow as in-app web view (no SDK with trackers; check Yoti's SDK data flows).
- Store: iOS 18+ rating, Play target audience 18+, Play Child Safety Standards page (`store-policy-review.md`).
