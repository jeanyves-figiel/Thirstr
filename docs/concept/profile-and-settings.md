# Thirstr — My profile & settings (v0.1)

Status: draft · 2026-11-17 · Companion to [product-concept.md](product-concept.md) · Mockups: "Me" + "Settings" boards on the [canvas](https://claude.ai/artifact/TErsb1tkyu5qWo8JQxD6VG).

Principles:
- Every field optional except display name, age bracket (from verification), main photo.
- **Every field has its own visibility**: Public · Verified only · My chats · Only me. Defaults below; user changes per field.
- Sensitive fields (sex/health) never Public by default; never indexed server-side in plaintext beyond what's needed for filters (filterable values stored as coarse flags).
- Free: all fields, all visibility controls, all settings. Plus adds convenience only (§11 concept).
- One profile, shown through lenses (Hookup / Friends / Sport); you pick where you show up. Friends and Sport show only safe photos and no hookup/health fields (decision 2026-11-18, #96).

## 1. Profile fields

### Identity
| Field | Values | Default visibility | Filterable |
|---|---|---|---|
| Display name | free text, 20 chars | Public | — |
| Age | exact or bracket; verified 18+ | Public | ✓ |
| Gender identity | man · trans man · non-binary (masc) · other (free text) | Public | ✓ |
| Pronouns | free | Public | — |
| Orientation | gay · bi · queer · pan · curious · other | Public | ✓ |
| Languages | multi | Public | ✓ |
| Bio | 300 chars; no links in first 24 h (anti-bot) | Public | — |
| Profile prompt | 1 of curated list ("Perfect night:", "Ask me about:") | Public | — |

### Photos & media
| Item | Limit | Rule |
|---|---|---|
| Main photo | 1 | Vanilla, AI-checked strict |
| Public photos | 4 more | Spicy ok, no genitals/sex (store rules) |
| Private albums | unlimited, photos + video | E2EE; grant per person; revoke anytime; expiry; view-once |
| Face blur / no-face mode | toggle | Main photo may be faceless; then "face-verified" badge still shows |

### Body & look
| Field | Values | Default | Filterable |
|---|---|---|---|
| Height / weight | metric/imperial | Public | ✓ |
| Body type | slim · fit · muscular · average · stocky · large | Public | ✓ |
| Body hair, beard | none → very | Public | ✓ |
| Tribes / vibes | bear, twink, jock, otter, daddy, geek, leather, pup, rugged, trans, clean-cut... (max 3, optional) | Public | ✓ |

### Hookup (Hookup lens only)
| Field | Values | Default | Filterable |
|---|---|---|---|
| Looking for | hookup · now · tonight · chat · dates · friends · activities | Public | ✓ |
| Position | top · vers top · vers · vers bottom · bottom · side | Verified | ✓ |
| Into / practices | curated tags (max 10) | Verified | ✓ |
| Limits / hard no's | tags | Verified | — |
| Hosting status | can host · can travel · either · neither | Verified | ✓ |
| Group | open to groups / parties | Verified | ✓ |
| Boundaries card | consent prefs, condom/PrEP stance, "ask before sending pics" | Verified | — |

### Health (opt-in, never Public)
| Field | Values | Default | Filterable |
|---|---|---|---|
| PrEP / DoxyPEP | on · off · ask | My chats | ✓ (verified viewers only) |
| HIV status | neg · pos undetectable (U=U) · pos · ask | My chats | ✗ (never filterable, anti-discrimination) |
| Last tested | month/year | My chats | — |
| Vaccinations | mpox, HPV, hep A/B | Only me | — |
| Test reminders | interval | Only me (device) | — |

### Activities (Sport and Hookup lenses)
| Field | Values | Default | Filterable |
|---|---|---|---|
| Sports | multi | Public | ✓ |
| Level | beginner → competitive | Public | ✓ |
| Gym / club | free text or venue | Verified | ✓ |
| Schedule | mornings · lunch · evenings · weekends | Public | ✓ |
| Intent | just sport · open to more | Public | ✓ |

### Social
| Field | Default |
|---|---|
| Instagram / socials | My chats (hidden from strangers; anti-scrape) |
| Relationship status | single · partnered · open · poly · it's complicated · Public |
| Vouches received | count only · Public |
| Clubs / teams joined | Verified |

### Trust badges (system-set, not editable)
- Verified human (+ date) · Member since · Vouches count · Responsive (reply rate bucket) · Host rating (opt-in, after parties).

## 2. "Me" screen

Top: completeness ring · **Show me in** (Hookup / Friends / Sport switches) · "Preview as…" (lens × stranger / verified / my chats) → see exactly what each audience sees.
Sections: photos · about · hookup · health · activities · social · private albums · my vouches.
Quick toggles row: Location level (Hidden has Stay hidden / Come back as, #114) · Online status · Do not disturb.

## 3. Settings

### Visibility & location
- Location level: Hidden (verified only) · City · Area (~200 m, default) · Exact (opt-in, expiry, audience). See concept §6.2.
- **Hide me from hidden users**: on/off (default off). Hidden viewers can't see you anywhere.
- Exact defaults: expiry (30 m/1 h/3 h/until leave) · audience (verified / my chats / everyone).
- Incognito merged into Hidden (#114): Hidden can end by itself (1 h, 6 AM, 24 h) and comes back as City or Area.
- Show in: grid · map · Tonight · Activities · venues (each toggle).
- Show distance: yes / range only / no.
- Online status & last seen: show / hide (symmetrical: hide = you don't see others').
- Read receipts & typing: on / off (symmetrical).
- Who can message me: everyone verified · only people I tapped · only matches by filter.
- Hide from: age ranges · new accounts (< 7 days) · unverified.

### Chat & media
- Disappearing messages default: 24 h · 7 d (default) · never; per-chat override.
- Explicit media from strangers: blur (default) · allow · block.
- Screenshot alerts; block screenshots (Android).
- Auto-delete received media after viewing.
- Watermark my shared albums with viewer ID (default on).
- Quick replies (custom yes/no/later).

### Notifications (content-free payloads)
- Per type: messages · taps · party requests · Tonight matches · activity joins · venue taps.
- Preview content: none (default) · sender name · full (only if device locked screen hidden).
- Quiet hours.

### Safety & privacy
- Safe Mode: auto (ILGA list) · always on · off.
- Disguised app icon (Notes, Calculator, Weather...).
- App lock: biometrics / PIN; **duress PIN** → decoy profile; panic wipe gesture.
- Trusted contacts for meet check-in.
- Blocked list · reported list.
- Verification status / re-verify.

### Account & data
- Recovery phrase · optional email · linked devices (MLS).
- Encrypted backup (on/off, user-held key).
- Download my data (GDPR Art. 20) · import from other app export (concept §15).
- Pause account (hidden, chats kept) · delete account (instant hard delete).
- Plus: status, manage, cancel in 2 taps.

### App
- Language · units (km/mi, cm/ft) · theme (dark default / light / auto) · accent colour · haptics · data saver (low-res photos).
- Transparency report · open-source licenses · privacy policy (plain-language summary first).
