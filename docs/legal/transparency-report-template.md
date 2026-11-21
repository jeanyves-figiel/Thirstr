# Transparency report template

> **DRAFT — NOT LEGAL ADVICE.** Claude (AI) draft, 2026-11-21. Template follows DSA Art. 15 and Art. 24 and the Commission's harmonised templates (Implementing Regulation on transparency reporting, applicable from 2025 reporting periods; **check the latest official template and use it as the authoritative format**). See [README](README.md).

Cadence: DSA yearly (Art. 15) + F-15 R-15.16 quarterly summary. Figures are computed from `admin_audit`, `reports`, `moderation_actions` with no user ids (R-AD.10). Counts under 10 are shown as "< 10" to avoid identifying anyone.

---

## Thirstr transparency report · ‹period start› – ‹period end›
Published ‹date› · Provider: Thirstr ‹legal name, address› · Legal representative in the EU: ‹name, Member State› · Contact for authorities: legal@thirstr.fun

### 1. Service
| | |
|---|---|
| Average monthly active recipients in the EU (Art. 24(2)), last 6 months | ‹n› |
| Per Member State (optional) | table |
| Languages of the service | en, fr, de (+ …) |

### 2. Orders from authorities (Art. 9 and 10)
| Member State | Orders to act (illegal content type) | Orders to provide information | Median time to confirm receipt | Median time to give effect |
|---|---|---|---|---|
| ‹MS› | ‹n› | ‹n› | ‹h› | ‹h› |

Requests from outside the EU (CH, UK, US, other): ‹n›, complied ‹n›, refused ‹n› (reason categories). Data available is minimal by design (no chats, no exact location history).

### 3. Notices (Art. 16)
| Category of alleged illegal content | Notices | from trusted flaggers | Actioned on legal ground | Actioned on ToS ground | No action | Median time to action |
|---|---|---|---|---|---|---|
| Child sexual abuse material | | | | | | |
| Non-consensual intimate images | | | | | | |
| Threats / violence | | | | | | |
| Illegal hate speech | | | | | | |
| Fraud / scams | | | | | | |
| Impersonation / identity theft | | | | | | |
| Intellectual property | | | | | | |
| Other illegal content | | | | | | |
| Notices processed by automated means | ‹n› | | | | | |

### 4. Own-initiative moderation
| Reason (ToS rule) | Detection: automated | Detection: human | Removal of content | Visibility restriction | Suspension | Termination |
|---|---|---|---|---|---|---|
| spam_bot | | | | | | |
| scam | | | | | | |
| underage | | | | | | |
| harassment | | | | | | |
| non_consensual | | | | | | |
| hate | | | | | | |
| impersonation | | | | | | |
| creator_undeclared | | | | | | |
| photo rules (classifier) | | | | | | |

Automated tools used: public-photo classifier (self-hosted NudeNet, accuracy indicators: ‹precision/recall on review sample›), CSAM hash matching (‹provider›), anti-bot signal score (F-15 R-15.5). Safeguards: human review of borderline photos, quarantine reviewed within 24 h, every appeal reviewed by a person.

### 5. Internal complaints (Art. 20)
| | Users affected by a decision | Notifiers |
|---|---|---|
| Complaints received | | |
| Decision upheld | | |
| Decision reversed | | |
| Median time to decide | | |

### 6. Out-of-court dispute settlement (Art. 24(1)(a))
Disputes submitted ‹n›, outcomes ‹…›, median duration ‹d›, share of decisions implemented ‹%›.

### 7. Suspensions for misuse (Art. 23)
| | |
|---|---|
| Accounts suspended for manifestly illegal content | |
| Notifiers suspended for manifestly unfounded notices | |
| Complainants suspended for unfounded complaints | |

### 8. Content moderation resources
Moderators (FTE, languages), training, support (R-AD.11).

### 9. Other (Thirstr extras, R-15.16)
- Bot rate per 1 000 MAU (AC-15.3)
- Government requests by country (incl. outside EU) and how many we could answer with data
- Warrant canary: "As of ‹date›, Thirstr has not received any secret order requiring it to disclose user data or modify its service" (remove if no longer true; counsel to confirm legality per jurisdiction)
