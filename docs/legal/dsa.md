# EU Digital Services Act (Regulation (EU) 2022/2065)

> **DRAFT — NOT LEGAL ADVICE.** Claude (AI) draft, 2026-11-21. Not reviewed by a lawyer. Counsel review before open beta (#170, #9). See [README](README.md).

## 1. Classification
- Thirstr is a **hosting service** and an **online platform** (stores user content and disseminates it to the public: public profiles, photos, Moments, parties). Private E2EE chats and albums are hosting but not dissemination to the public.
- Not a VLOP (< 45 M EU MAU).
- **Micro/small enterprise** (< 50 staff, < €10 M turnover): Art. 19 exempts Section 3 (Arts. 20–28: internal complaints, out-of-court settlement, trusted flaggers, misuse, platform transparency, dark patterns, ads, recommender, minors) and Art. 15(2) exempts the transparency report. **Owner policy (enterprise bar, 2026-11-21): comply voluntarily with all of them**, so that crossing the threshold changes nothing. Counsel to confirm which parts are strictly mandatory now.
- No EU establishment (Swiss) ⇒ **Art. 13 legal representative** in a Member State, mandated in writing, notified to the Digital Services Coordinator (DSC) of that state. Candidate states: Germany (Berlin seed) or Ireland/Netherlands (English-speaking). The representative's DSC becomes competent for Thirstr.

## 2. Obligations map
| Art. | Obligation | Status | Where |
|---|---|---|---|
| 11 | single point of contact for authorities (electronic, languages) | ○ | `legal@thirstr.fun` (to create), en/de/fr; listed on `thirstr.fun/legal` |
| 12 | single point of contact for users (not only automated) | ◐ | in-app Help (EN-19) + `hello@thirstr.fun`; add to `thirstr.fun/legal` |
| 13 | legal representative in the EU | ○ | appoint (§1) |
| 14 | T&Cs: restrictions, moderation incl. algorithmic tools, internal complaints, in clear language | ○ | ToS draft must list rules (reason codes), automated tools (classifier, anti-bot), appeal |
| 15 | yearly transparency report | ○ | [`transparency-report-template.md`](transparency-report-template.md) |
| 16 | notice-and-action mechanism for illegal content, easy, electronic, by anyone | ◐ | in-app S-50 (users) ✔; **web form for non-users ○**; required fields ○ (R-15.23–25) |
| 17 | statement of reasons for every restriction | ◐ | R-AD.9 notices ✔; missing facts, automation disclosure, legal vs ToS ground, redress options ○ (R-15.28) |
| 18 | notify authorities of suspected crimes threatening life or safety | ○ | procedure §7 |
| 20 | internal complaint-handling, ≥ 6 months, free, human, also for notifiers | ◐ | appeal exists (1 per action) but no window, notifiers can't appeal ○ (R-15.30–33) |
| 21 | inform about certified out-of-court dispute bodies | ○ | in SoR + appeal decision (R-15.28, R-15.33) |
| 22 | trusted flaggers priority | ○ | queue priority flag (R-15.35) |
| 23 | measures against misuse (frequent manifestly illegal content, manifestly unfounded notices) | ○ | R-15.34 |
| 24 | transparency report additions, MAU publication every 6 months, SoR to Commission DB | ○ | publish average MAU on `thirstr.fun/legal`; SoR DB submission voluntary (Art. 24(5)) |
| 25 | no dark patterns | ✔ | design bar; review in store review |
| 26 | ad transparency | n/a | no ads (governance lock) |
| 27 | recommender transparency | ○ | ToS: explain Explore order (distance → Now → online; F-04) and the user's options |
| 28 | protection of minors | ✔/○ | 18+ only, age assurance (`age-assurance.md`); no profiling ads |

## 3. Notice-and-action (Art. 16)
Who can notify: anyone (users in app, non-users on the web).

A valid notice contains (Art. 16(2)): (a) explanation why the content is illegal; (b) exact location (profile link / share link / party link, or in-app context id); (c) name and email of the notifier — **except** for offences under Directive 2011/93/EU (child sexual abuse), where the notifier may stay anonymous; (d) good-faith statement.

Thirstr design (spec F-15 R-15.23–R-15.27):
- In app (S-50 v2): users pick a reason. Choosing "**It's illegal**" (or any reason + "This may be illegal where I am") adds: country, what law/what's illegal (free text ≥ 20 chars, or a pick list: CSAM, non-consensual intimate images, threats, hate speech under national law, fraud, IP infringement, other), good-faith checkbox. Name/email come from the account context only if the notifier chooses to give them (in-app notifier is identifiable by account to us; never shown to the reported person).
- Web form `thirstr.fun/report` for non-users: link to the content (profile share link `thirstr.fun/p/…`), category, explanation, name + email (optional for CSAM), good-faith checkbox, captcha-free proof-of-work (no third-party captcha). Email confirmation via SES.
- **Receipt** (Art. 16(4)): instant in-app confirmation / email.
- **Decision** to the notifier (Art. 16(5)): in-app "Your reports" outcome or email, with whether automated means were used and redress (appeal for notifiers, R-15.32).
- Not "actual knowledge" by default: a notice that lets a diligent provider see illegality without detailed legal examination gives actual knowledge (Art. 16(3)) ⇒ act expeditiously; SLAs R-AD.8.

## 4. Statement of reasons (Art. 17)
Required for every restriction on grounds of illegality or ToS incompatibility: removal, disabling, visibility restriction (incl. **demotion / shadow quarantine**), suspension or termination of the account, monetary restriction.

Content of each SoR (R-15.28): action + scope + duration; facts and circumstances (which content, which part of it); whether automated means were used to **detect** and/or to **decide**; legal ground (law + country) or contractual ground (ToS section + rule); redress: internal appeal (≥ 6 months), out-of-court dispute settlement bodies, courts. Language: user's app language. Delivered in app (account has no reliable email by design; in-app notice is the electronic channel; Art. 17(2) "contact details known").

**Shadow quarantine (F-15 R-15.6):** Recital 55 lets platforms skip the SoR for **deceptive high-volume commercial content** (bots, fake accounts). Draft position: no SoR while quarantine is based on bot/spam signals; **SoR is due** when quarantine is the result of severe reports (R-15.13 auto-hide) or lasts beyond the 24 h review, and in every case once a human confirms an action. Counsel to confirm.

Exemptions: orders under Art. 9 (authority orders) follow the order's own rules; SoR is not needed where the user's contact is unknown (non-user web content n/a).

## 5. Internal complaints (Art. 20)
- Open to the affected user **and the notifier** (against a decision not to act).
- Window: **≥ 6 months** after the decision (Thirstr: 6 months; today's "one appeal" rule kept, per decision).
- Free, electronic, user-friendly; reviewed by **qualified staff, not solely automated**, by someone other than the original decider. Beta: owner is the only moderator (D-12) ⇒ disclose "reviewed again by a person"; second reviewer required from open beta.
- Decision "without undue delay": target 72 h (R-15.14), reasoned, with out-of-court option.
- Reversal: restore content/account immediately; record in transparency stats.

## 6. Out-of-court dispute settlement (Art. 21)
List certified bodies in the SoR and appeal decision with a link to the Commission's list (e.g. `appeals centre` bodies certified by DSCs). Platform pays fees if the user wins (Art. 21(5)). Budget line for counsel.

## 7. Child safety, crime notification (Art. 18) and point of contact
- Suspected offence involving a threat to life or safety (e.g. credible threat, child sexual abuse, trafficking): inform the law enforcement or judicial authorities of the Member State concerned (or where the provider's legal rep is, or Europol if unclear) **promptly**. Procedure: senior_mod (owner in beta) logs in A-08, sends minimal data. Swiss users: fedpol / cantonal police.
- CSAM: hash match → ban + report (R-15.11): NCMEC CyberTipline for US nexus, national hotlines (INHOPE members) / police for EU, fedpol for CH. Preserve evidence per law.
- **Child safety standards page** (`thirstr.fun/child-safety`, also needed for Google Play): 18+ only; zero tolerance for CSAE; how to report (in app "Underage" / web form); how we act (hash matching, 1 h SLA, reporting to NCMEC/hotlines/police); contact `childsafety@thirstr.fun` (to create).

## 8. Misuse (Art. 23)
- Users who **frequently** post manifestly illegal content: suspend for a reasonable period after a prior warning.
- Notifiers who frequently submit **manifestly unfounded** notices: suspend processing of their notices for a period after a warning (R-15.34). Criteria in ToS: absolute numbers, proportion, gravity, intent.

## 9. Records and transparency
Every notice, decision, SoR, appeal and its outcome is stored without content beyond need (data-model `reports`, `moderation_actions`, new fields R-15.36) so the transparency report can be computed without user ids (R-AD.10). Template: [`transparency-report-template.md`](transparency-report-template.md).

## 10. Actions
| Action | Issue |
|---|---|
| Spec + mockup for DSA flows (this PR) → owner pick → build | #170 |
| Appoint Art. 13 legal representative (could be the same firm as GDPR Art. 27 rep) | #170 |
| Create `legal@`, `childsafety@`, `privacy@` aliases; publish `thirstr.fun/legal`, `/child-safety`, `/report` | #170 |
| ToS + Community rules with reason codes and moderation description (Art. 14) | #170 |
| Counsel review | #9 |
