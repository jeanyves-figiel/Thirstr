# App store policy review

> **DRAFT — NOT LEGAL ADVICE.** Claude (AI) draft, 2026-11-21. Based on Apple App Review Guidelines and Google Play Developer Policy as known to the drafter; both change often. **Re-check the live texts before every submission.** See [README](README.md).

Scope: hookup-first gay dating app with public photos (main vanilla, others "a bit spicy"), unlimited private albums incl. video, E2EE chat, parties, Moments. Ties to I-03 R-I03.1–5.

## 1. Apple App Store
| Guideline | Rule (summary) | Thirstr today | Gap / action |
|---|---|---|---|
| 1.1.4 | No overtly sexual or pornographic material | public photos: main must pass strict classifier; slots 1–4 underwear/suggestive allowed, genitals and sex acts rejected (R-15.10) | **Keep "spicy" public photos to underwear/shirtless.** Review screenshot-able surfaces (grid, map, Moments) with the strict check before submission. Moments use the permissive classifier → make Moments on public surfaces use the public-photo rule set (no explicit), action below |
| 1.2 UGC | filter objectionable content, report mechanism with timely response, block abusive users, published contact info | ✔ classifier, ✔ report everywhere (S-21, S-50), ✔ block, ✔ hello@ contact | add response-time statement in Help; DSA flows add notice outcome (R-15.23+) |
| 1.2 (random / anonymous chat) | apps used mainly for hookups / anonymous chat may be rejected if they lack safety | verification required to initiate, video check, check-ins | describe safety features in review notes |
| 1.1.4 private content | explicit content exchanged privately is user-to-user and outside the app's public catalogue | private albums + chat E2EE; we cannot see them | review notes: E2EE, report with franking, block, 18+ verified. **Do not show private-album content in screenshots or marketing** |
| 1.3 / age rating | adult apps must have accurate age rating | 17+ planned | Use **18+** rating (Apple's new age-rating tiers, 2025). Answer "frequent/intense mature themes, sexual content (in UGC)" honestly |
| 4.3 spam | dating apps saturated: need unique value | map-first, privacy, safety, lenses | write review notes on differentiation |
| 5.1.1(v) | in-app account deletion | ✔ R-01.10 | — |
| 5.1.1 / 5.1.2 | privacy policy, data use, no data sharing without consent | ✔ no SDKs | privacy policy URL + nutrition labels per R-I03.4 |
| 5.1.1(ix) | apps in regulated fields: n/a | — | — |
| 2.3.10 / alt icons | disguised icons must not impersonate other apps | R-I03.5 | ✔ keep neutral names (Calculator-like names may be judged misleading: use generic "Notes"-style only if not imitating a brand) |
| Sign in with Apple (4.8) | offer if other social logins | ✔ Apple first | — |
| Age-assurance APIs | Declared Age Range API (iOS 26) and US state app-store age laws (Texas SB 2420, Utah) from 2026 | not used | adopt Declared Age Range as an extra signal on iOS; follow `age-assurance.md` |

## 2. Google Play
| Policy | Rule (summary) | Gap / action |
|---|---|---|
| Sexual content & profanity | no sexually explicit content; dating apps allowed; no sexual services for compensation | same public-photo rule as Apple; ban "paid meets" in ToS + scam reason |
| User-generated content | in-app reporting, blocking, moderation, ToS acceptance before UGC | ✔; ToS acceptance on S-02 ✔ |
| **Child Safety Standards** (social + dating apps) | publish CSAE standards page, in-app feedback mechanism, address CSAM, comply with child-safety law, name a child-safety point of contact in Play Console | **Write and publish `thirstr.fun/child-safety`** (draft in `dsa.md` §7), name the owner as contact |
| Target audience | must declare 18+ only | set Target audience 18+ |
| Data safety form | accurate declaration | fill from RoPA |
| Account deletion | in-app + web link | **add web deletion page** (`thirstr.fun/delete`) |
| Restricted content: dating | — | OK with verification |

## 3. Risks and web fallback plan
Likelihood of rejection is **real** (hookup positioning, spicy public photos, unlimited private explicit content). Incumbent gay apps operate on both stores with private explicit sharing between users, which is precedent but not a guarantee.

Mitigations before first submission:
1. Public surfaces (grid, map, profiles, Moments to "Everyone") use the strict-or-suggestive rule set; nothing explicit outside E2EE.
2. Review build: account on a demo region with SFW seed profiles; review notes describe E2EE, franking reports, block, verification, 18+.
3. Store listing: lead with safety, privacy and community; no "hookup" in title (description may mention it).

**Web fallback (if a store rejects or removes the app):**
| Step | What | Effort |
|---|---|---|
| W1 | PWA web client on `app.thirstr.fun` (spec: web client is "Later", F README) with passkeys, Web Push, MLS via WASM | large (Later item, start spec early) |
| W2 | Android: direct APK / alternative stores (EU DMA allows alternative distribution) | medium |
| W3 | iOS EU: alternative marketplace / web distribution under DMA (Apple notarisation still applies, 1.1.4 not enforced by marketplaces) | medium |
| W4 | Comms: in-app + email notice to users with the fallback link | small |

Decision for the owner later: start W1 spec now or only on rejection. Draft recommendation: write the W1 spec before public launch, build only on rejection.
