# Design system: tokens, copy & i18n

Source of truth for `/design/tokens.json` and `/design/strings/`. Theme: **Pop** (only theme, chosen 2026-11-17, #38). Mockups: [Pop direction canvas](https://claude.ai/artifact/KfanUPTq3GCiWjzEa55mFW) (row "Pop"); earlier v0.1 screens: [canvas](https://claude.ai/artifact/TErsb1tkyu5qWo8JQxD6VG) for flows only, their colours are superseded. Rationale: [onboarding-and-design.md](../concept/onboarding-and-design.md).

## Theme: Pop
- One theme only: dark ink base, saturated colour used for meaning (mode, privacy, status), never as decoration. No light theme, no alternate themes, no user accent picker.
- Colour is a fill with ink text on top; long text always sits on ink or `bg.raised`.
- Each mode owns a colour. Switching mode recolours accent surfaces (active mode chip, active tab, map zones, own location ring, tray badges, hot card outline).
- Teal is privacy/location/trust and never changes with mode. Sunflower marks private/personal things (private note, "Default" badge, disappearing timer).

## Tokens (`/design/tokens.json`, W3C Design Tokens format)
Generated to TS (RN theme) by Style Dictionary in CI. Hard-coded colours/sizes in app code MUST fail lint.

### Colour
| Token | Value | Use |
|---|---|---|
| `bg.base` | #17142E | screen background (ink) |
| `bg.map` | #1B1836 | map land |
| `bg.raised` | #262248 | cards, sheets, segmented tracks, inputs |
| `bg.overlay` | #2E2A55 | modals, menus, incoming chat bubble |
| `bg.inverse` | #FFFFFF | bottom nav bar, back buttons on photos, "You" label |
| `fg.primary` | #FFFFFF | body text |
| `fg.secondary` | #C2BDE3 | meta text (≥ 9:1 on `bg.base`) |
| `fg.muted` | #8A86B0 | disabled, hints (large text/icons only) |
| `fg.onColor` | #17142E | text/icons on any colour fill and on `bg.inverse` |
| `line` | #39346A | borders, dividers |
| `line.subtle` | #2E2A55 | header/composer separators |
| `map.road` | #282449 | main roads |
| `map.road.minor` | #221E40 | minor roads |
| `map.water` | #1F3A5C | water |
| `mode.hookup` | #FF6B5B | Hookup (coral) |
| `mode.friends` | #A78BFA | Friends (violet) |
| `mode.sport` | #B8F04A | Sport (lime) |
| `trust` | #3DD6C3 | verified, location, privacy, E2EE, Save in privacy flows (teal) |
| `personal` | #FFC93C | private note, defaults, disappearing timer (sunflower) |
| `travel` | #7CC8FF | travel plans (F-20): Visiting labels, visitor tile outline, trip cards, "Looking around from afar" bar (sky; ink text 10.9:1). Never used for anything else |
| `moment` | gradient #FF6B5B → #A78BFA → #B8F04A (135°) | unseen Moment rings and the composer Share glow only (F-21). Seen ring = `line` |
| `danger` | #FF4D6D | block, report, panic: always icon + label, never a plain fill beside `mode.hookup` |
| `tile.*` | #7A2F3B, #4B3A8C, #2F6B5E, #7A5A1E, #5B2F6E, #2E4F8C | photo placeholder / skeleton tones before an image loads (rotate by user id hash) |
- Accent = current mode token. `trust`, `personal`, `danger` never change with mode.
- Map pins are coloured by the person's own current mode (status), not the viewer's mode. Pin = solid circle, 3 pt `bg.base` outline, initial in `fg.onColor`.
- Contrast: `fg.onColor` on every colour fill ≥ 4.5:1 (coral 6.4, violet 6.6, lime 12, teal 9.5, sunflower 11); `fg.primary`/`fg.secondary` on `bg.base` and `bg.raised` ≥ 4.5:1. Checked in CI.
- Colour is never the only signal: mode chips carry a label, status badges carry text, pins have an accessible label.

### Type
| Token | Size/line | Weight | Use |
|---|---|---|---|
| `type.display` | 32/38 | 800 | onboarding headlines, profile name |
| `type.title` | 22/28 | 800 | screen titles, tray titles |
| `type.headline` | 16/21 | 800 | card names, list titles |
| `type.body` | 15/21 | 400 | text |
| `type.meta` | 13/18 | 500 | distance, time |
| `type.caption` | 11/14 | 800 | badges, chips, tab labels |
- Family: **Bricolage Grotesque** (OFL, bundled, weights 400/500/700/800). Letter spacing −0.03 em on display/title, 0 elsewhere. System fallback.
- Tabular numerals for counts/distances (`fontVariant: tabular-nums`); if the bundled cut lacks `tnum`, numerals in counters fall back to Inter. Verify at implementation.
- MUST respect OS Dynamic Type / font scale up to 200 %; layouts reflow, no truncation of actions.

### Logo
- Wordmark: `thirstr` all lowercase, Bricolage Grotesque 800, letter spacing −0.04 em. The final `r` in `mode.hookup` coral; the rest `fg.primary`. Followed by three dots (Ø 0.3 em, gap 0.08 em, baseline-aligned): `personal` sunflower, `mode.friends` violet, `mode.sport` lime.
- The wordmark colours are fixed brand colours: they do NOT follow the current mode.
- Header use: 27 pt, left-aligned, on `bg.base` or the map.
- App icon (chosen 2026-11-17, concept A of the [icon concepts](https://claude.ai/artifact/L54sELRarhcQp1E8poghPZ)): short form of the wordmark. Ink `bg.base` full-bleed square; lowercase `t` white and `r` coral (Bricolage Grotesque 800, outlined, 600/1024 of the canvas, tracking −0.04 em, baseline at y 702), then three dots Ø 80/1024, gap 18, bottom on the baseline: sunflower, violet, lime. No gradient, no shadow, no text other than `tr`.
  - Sources: `/design/brand/*.svg` (glyphs outlined from the bundled font, so no font is needed to render). `design/brand/build.js` regenerates every PNG in `/apps/mobile/assets`.
  - iOS: `icon.png` 1024×1024, RGB without alpha (App Store rejects alpha); iOS applies the mask.
  - Android adaptive: `android-icon-foreground.png` (mark scaled to 66 % about the centre so it sits inside the 66 dp safe circle on every launcher mask), background colour `bg.base` (`android-icon-background.png` kept for tools that need an image), `android-icon-monochrome.png` (all-white mark for Android 13+ themed icons).
  - Store safety: App Store guideline 2.3.8 requires icons to suit 4+ even for a 17+ app; Play bans sexual content in icons. The mark is lettering only, so no review risk. Sass lives in the app, not the icon.
  - Disguised-icon builds (I-03) keep their neutral icons.
- Splash: `bg.base` with the full wordmark centred (white `thirst`, coral `r`, three dots), 70 % of the 1024 `splash-icon.png` canvas, transparent background; `resizeMode: contain`. Same wordmark as the header, never the icon.
- Clear space = height of the `t`. Never outline, stretch, recolour or put on a photo.

### Space, radius, elevation, motion
- `space`: 2, 4, 8, 12, 16, 20, 24, 32, 48. Screen gutter 16.
- `radius`: sm 12, md 22, lg 32, pill 999. Grid tiles md (22); tray cards 24; chat bubbles 22 with a 6 pt tail corner; sheets and the profile photo lg (32); buttons, chips, segmented controls, inputs pill.
- `elevation`: 0 flat, 1 card, 2 sheet, 3 modal (shadow + `bg` step).
- `motion.fast` 120 ms, `motion.base` 220 ms, `motion.slow` 360 ms; easing `standard` cubic-bezier(0.2,0,0,1). Sheets use spring (damping 20). Mode switch cross-fades accent colours over `motion.base`. Reduce Motion ⇒ cross-fade only.
- Touch targets ≥ 44×44 pt.
- Gestures ([F-19](features/F19-gestures.md), #187): one spring for everything a finger lets go of (damping 22, stiffness 220, carries the fling velocity); Reduce Motion ⇒ 150 ms timing. Rubber band past any limit. Swipe action buttons 76 pt wide, colour fill + ink icon and label (Favorite sunflower, Archive violet, Mute muted). Reaction bar: white pill 260×52 over a dimmed chat, emoji under the finger grows 1.45×. Haptics only `tick` / `tap` / `success` / `warning`.

### Key component rules (Pop)
- Bottom nav: floating `bg.inverse` pill (16 pt side inset, 8 pt above the home-indicator inset, 64 pt high); active tab is a filled pill in the current mode colour with `fg.onColor`; inactive tabs #4A4570. Unread badge `mode.hookup` with count.
- Bottom nav on **every screen** (#137, owner 2026-11-21): one bar drawn over the whole app, pushed screens included (profile, chat, settings, forms). The tab under the current screen stays lit; tapping any tab closes pushed screens and opens that tab. Hidden only while the keyboard is up and on the selfie camera (Verify). A screen's own bottom bar (chat composer, profile action row, `StickyCta`) sits directly **above** the nav bar; code reserves the space with `useNavSpace().bottom` (nav 72 pt + home-indicator inset, 0 while typing).
- Mode switch: segmented pill on `bg.raised`; each selected segment fills with its own mode colour.
- Explore grid sheet (#100): `bg.base` fill, top radius lg (32), shadow elevation 2; handle 40×5 pill `line`, 28 pt touch row; title `type.title` + `type.meta` sub; tiles radius 18, 8 pt gap. Selected pin 58 px with mode-colour ring + white name chip (13/800 ink); selected tile 3 px mode-colour ring. Zoom chip: 30 pt pill, ink 86 %, `fg.secondary` 12/700. Quiet-state cards: `bg.raised`, radius 24, 44 pt round tinted icon, coral Post pill.
- Location chip (header): `bg.raised` pill, `trust` pin icon + current level label.
- Primary button: pill, fill = context colour (`mode.hookup` for Message, `trust` for Save in location/privacy), label `fg.onColor` 800.
- Chat: own bubbles = mode colour of the conversation's origin mode (default Hookup), incoming = `bg.overlay`; E2EE line in `trust`; disappearing timer chip `personal`; shared exact-pin card `trust`.
- Profile: interest/status chips use the palette fills; private note card is `personal` with ink text; "Ask to unlock" album button `mode.friends`.

### App v2 rules (issue 58, mockup approved 2026-11-17)
- Bottom nav: icon on every tab; label only on the active tab, which grows (flex 1.6) and fills with the mode colour; inactive icons `navInactive`. Chats badge = coral count with a white ring.
- Explore header (#104, live header, F-04 R-04.17): row 1 wordmark 26 pt · filter button (count badge) · own avatar (Now ring); row 2 place name 30 pt heavy + chevron, teal level chip, mode-colour live dot + "N around · M Now"; row 3 three mode tiles (74 pt, radius 20, icon + count + label, active = mode-colour fill + ink text). Soft radial mode-colour glow behind. Verify nudge lives in the grid sheet, not the header.
- Photo tiles and tray cards: bottom scrim from transparent to ink 85–90 %; name + age 800, distance `fg.secondary`; Now badge top-left in the person's mode colour; online dot = lime with ink ring; tray card outlined in mode colour when Now.
- Tab-root titles are 34/38 800 (Tonight, Chats, Me); captions above in `fg.secondary` 13.
- Profile actions: white round 44 pt buttons over photos; sticky bottom row above the nav bar = 58 pt round Tap (flame) + 58 pt round favourite (star) + coral Message pill; content fades out under it. Unverified Message → toast "Verify to send the first message" with Verify now (#124).
- Rows: 58 pt min height, 10 pt coloured dot, value right in `fg.secondary` (teal for location), chevron `fg.muted`.
- Text glyphs are never icons: use `src/ui/icons.tsx`.

### Sub-screen rules (issue 63, mockup: app v2 canvas, second row)
- Stack header: no bar chrome; 44 pt round `bg.raised` back button (`BackButton`), optional right pill action. Screen draws its own 32–34 pt display title, optional `fg.secondary` 15 subtitle.
- Groups: `SectionLabel` (12 pt 800 uppercase `fg.muted`, 0.8 tracking) above a `Section` card (`bg.raised`, radius 22, no border, 1 px `line.subtle` separators). Rows 60 pt min, title 16/700, sub 13 `fg.muted`, value 14/700 `fg.secondary`, chevron icon.
- Inside a card, chips use `line` fill and fields/segmented use `bg.overlay` so they never vanish into the card.
- Fields: label as `SectionLabel`; input 56 pt, radius 18, `bg.raised` fill, 2 pt border that turns mode colour on focus.
- Chips: 40 pt, no border, 15/700; selected = mode colour fill + ink text.
- Banners: tinted fill (tone at 10 %), bold tone-coloured text, chevron when tappable. No emoji prefixes. Banners live **in the layout flow only**; never position one over content (its fill is see-through, #124).
- Floating messages = **Toast**: solid `bg.inverse`, up to 3 lines, optional action pill (Undo, Verify now); sits 12 pt above the nav bar (and above a screen's own bottom bar), 5 s.
- No overlap rule (#124): no text may sit under another element or another text at scroll end, on 320 / 375 / 393 pt wide phones, in en / fr / de. Segmented controls size each segment to its label and share the rest; names shorten with … but age, counts and badges stay visible.
- Keyboard (#134): bottom bars drop the home-indicator inset while the keyboard is up (no gap above the keys); every scroll view with or near inputs closes the keyboard on drag; sheets ride up with the keyboard (`KeyboardAvoidingView`); long forms keep the focused field visible.
- Native pop-ups from a sheet (#124): close the sheet first, then open the system share sheet / picker once it is gone (`afterSheet`), or iOS freezes the screen after Cancel.
- Hero card (`Hero`): Party, Activity, Club (mode colour) and Venue (teal). Radius 28, ink status pill, 30 pt title, meta line, up to 3 stat tiles.
- Primary action: one pill in `StickyCta` (bottom fade) on forms (Edit profile, Host a party, Post activity, New club, Report). Save is white; destructive submit is `danger` fill.
- Single choice of 2–4 options = `Segmented` (audience, intent, join policy, visibility); longer single choice = radio rows (Report reasons).
- Form controls (#189, [mockup option A](https://claude.ai/artifact/Vra2UhUrQeLyytnkqGrHYD)): no chip walls. One control per question, `apps/mobile/src/ui/form.tsx`:
  - `TimeRange` timeline scrubber for any start → end time: `bg.raised` card radius 22, big 26 pt `start → end` readout with an ink length pill, 64 pt track with half-hour ticks and hour labels (every 2 h, 4 h above 16 h), mode-colour window (2 pt border, 22 % fill), white 16×46 knobs. Drag an end to set it, drag the middle to slide the whole window, tap outside to move the nearest end. Snap 15 min to clock quarters; the domain start stays "Now". A11y: adjustable, actions ±15 min for start and end.
  - `Stepper` for counts: − / + 52 pt round buttons (hold repeats, accelerating), 44 pt number that also drags sideways (12 pt per step), dots showing the size (you in white).
  - `IconChoice` for one choice of 2–5 (type, audience): one `bg.raised` rail, icon over label (or side by side with `row`), selected = fill + ink.
  - `IconTiles` for multi-select of up to 8 (house rules): 4 square tiles per row, icon + label, selected = mode fill + ink dot.
  - Forms open with a live preview card of what others will see ("How others see it" tag on the card edge).
  - Haptics (#187 tokens): selection tick per step or choice, light impact at a limit, success on submit. Respects Settings › Haptics.
- Photo editor: mosaic, main photo 2×2 with white "Main" pill, two right, two wide below; empty slots dashed with plus icon.

### Iconography
- 24 px grid, 1.75 px stroke, rounded. Set lives in `/design/icons` (SVG → RN components).
- Badges: verified (trust check), vouched (count), creator, host. Never colour-only: badge = icon + accessible label.

## Components (RN, `/apps/mobile/src/ui`)
Button (primary/secondary/ghost/danger), Chip (toggle, filter, mode), Tile (grid profile), Pin (map: cell, exact, cluster, venue, party), Sheet, ListRow, Toggle, Segmented (mode switch), GridSheet (Explore), Composer, MessageBubble, Badge, Skeleton, EmptyState, ErrorState, OfflineChip, Toast. Each has a story in Storybook with all states from [screens.md](screens.md).

## Copy
### Voice
- Direct, warm, a bit cheeky; never crude in system copy. Sex-positive, no shame, no moralising.
- Say what happens and what is shared: "Visible to verified guys within ~200 m" not "Location on".
- Privacy copy names the data and the audience. No dark patterns: equal weight for yes/no, no confirm-shaming.
- Neutral to identity: "guys", "men" as product audience; never assume pronouns; user-chosen pronouns shown as entered.

### Rules
- R-DS.1 Every string has a key `area.screen.element` (e.g. `explore.map.tray.empty`), lives in `/design/strings/en.json`; no inline strings (lint).
- R-DS.2 Plurals via ICU MessageFormat; never concatenate strings.
- R-DS.3 Push notification strings are generic and content-free (F-16): `push.generic` = "New activity". No names, no counts in Safe Mode.
- R-DS.4 Disguised-icon builds use neutral app name strings from `disguise.*` (I-03 R-I03.5).
- R-DS.5 Error messages: what happened + what to do, ≤ 2 lines, with retry action.

### Key strings (en, reference)
| Key | Text |
|---|---|
| `welcome.headline` | "{count, plural, one {# guy} other {# guys}} around you right now" |
| `welcome.headline.sparse` | "Guys are joining near you" |
| `location.area.desc` | "Shown in a ~200 m zone. Widens automatically if few people are around." |
| `location.exact.desc` | "Your pin, slightly shifted, for {ttl}. Then it disappears." |
| `location.hidden.locked` | "Verify to go Hidden" |
| `location.hideFromHidden` | "Hide me from guys who are hidden" |
| `chat.e2ee` | "End-to-end encrypted. Not even we can read this." |
| `chat.blocked` | "Not delivered" |
| `profile.unavailable` | "Not available" |
| `safety.checkin.due` | "All good?" |
| `push.generic` | "New activity" |

## i18n
- Closed beta locales: en, fr, de. Public launch adds: es, pt-BR, it, nl, pl, tr, ru, ar (RTL), he (RTL), ja, zh-Hans, id, th, hi.
- RTL: layout mirrors via RN `I18nManager`; map controls mirror; numerals per locale.
- Translation: professional + community review (queer-native reviewers per locale); TMS self-hosted (Weblate), EU.
- Locale MUST NOT be sent to server except for push language (stored on device, server sends generic key only; device renders).
- Units: metric default; imperial for en-US/en-GB (miles for distance), user-overridable (F-17).
- Dates/times: device locale + 24/12 h per OS.

## Accessibility
- Every interactive element: accessibilityLabel + role; images: profile photo label = "{name}'s photo {n} of {total}".
- Map has list alternative (grid) reachable in one tap; pins announce distance band, not exact metres.
- Focus order follows visual; sheets trap focus; Escape/back closes.
- Acceptance: AC-DS.1 axe/RN a11y lint zero errors on all S-xx; AC-DS.2 all screens usable at 200 % font; AC-DS.3 VoiceOver/TalkBack complete onboarding unaided (manual).
