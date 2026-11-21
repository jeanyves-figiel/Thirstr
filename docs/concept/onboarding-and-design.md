# Thirstr — Sign-up, onboarding & design system (v0.1)

Status: draft · 2026-11-17 · Companion to [product-concept.md](product-concept.md) · Mockups: "Onboarding" row on the [canvas](https://claude.ai/artifact/TErsb1tkyu5qWo8JQxD6VG).

Target: **install → seeing who's around in < 60 s; visible + messaging in < 2 min.**

## 1. Register & log in

| Method | Offered | Why |
|---|---|---|
| **Passkey** (Face ID / fingerprint) | **Default, one tap** | No password, no email, no phone. Phishing-proof. Account = device keypair + passkey. |
| Sign in with Apple (Hide My Email) | Yes | Familiar; we keep only an opaque, hashed ID. |
| Sign in with Google | Yes | Same; hashed ID only. |
| Email magic link | Yes | For people without passkey support; email stored hashed (recovery only). |
| Phone number / SMS | **No** | Outing risk (number = identity), SIM-swap, cost. Bots handled by liveness verification instead. |
| Username + password | No | Weakest option; passkey covers it. |

Log in on a new device:
- Passkey synced by iCloud Keychain / Google Password Manager → one tap.
- Or scan a QR shown on the old phone (adds device to the user's encrypted chat group; chat history comes along).
- Lost everything: recovery phrase (shown once, optional) or email magic link → account restored; old chats gone unless encrypted backup was on.

App lock: biometrics/PIN on open (default on in Safe Mode). Duress PIN optional.

## 2. Onboarding flow

One question per screen, big thumb-zone buttons, progress bar, everything skippable except age 18+ and one photo.

| # | Screen | Content | Time |
|---|---|---|---|
| 0 | **Welcome** | Live, blurred map of real activity nearby ("128 guys active within 2 km") + 3 promises (no bots · no ads · you control location). CTA "Get started" / "I have an account". | 3 s |
| 1 | **Create account** | Passkey one tap. Apple / Google / email as secondary. 18+ confirmation checkbox inline. | 5 s |
| 2 | **Basics** | Name · birthday (age only shown) · "I am" (man / trans man / non-binary / other) · "Here for" (Hookup, Tonight, Chat, Friends, Sport; multi-select, Hookup pre-selected). | 20 s |
| 3 | **Location** | Explainer then OS permission. Pick precision (Area 200 m default; Exact / City; Hidden unlocks after verification). | 8 s |
| 4 | **Main photo** | Camera or library; live AI check → "Looks good" or "Needs to be less explicit for your main photo". Add 4 more later. | 15 s |
| 5 | **Verify** | 30 s on-device liveness. **"Later" allowed** → browse-only until done (can look, can't appear or message first). Banner reminds. | 30 s |
| 6 | **Land on Explore** | Map with your zone pulsing; 1 coach mark ("Tap a pin or swipe the cards"). Push permission asked later, on first incoming message, not now. | — |

Progressive profiling (never a long form):
- Position/tags asked first time you post "Now" or open a hookup chat.
- Sport fields asked first time you switch to Sport mode.
- Health fields offered after 3rd chat, framed as "share privately with matches".
- Profile completeness ring on Me; nudges max 1/day.

Safe Mode onboarding (detected hostile country): order changes → disguised icon + app lock first, location defaults to City, no push prompt, verification required before visible.

## 3. Design system

### Principles
1. **One primary action per screen**, bottom thumb zone.
2. **3 taps max** to message someone nearby from launch.
3. **Progressive disclosure**: defaults that work; options in sheets, not on screen.
4. **Mode = colour** (Pop theme, see [design-system.md](../spec/design-system.md)): Hookup = coral `#FF6B5B`; Friends = violet `#A78BFA`; Sport = lime `#B8F04A`; trust/location/privacy = teal `#3DD6C3`; personal = sunflower `#FFC93C`. Switching mode recolours the whole app: you always know where you are.
5. **Dark by default** (night use, discreet), light theme available.
6. **Real people first**: photos large, chrome minimal, no ads, no upsell banners.
7. **Motion with purpose**: pins pulse when someone goes "Now"; party seats fill; verification badge lands with haptic. Reduced-motion respected.
8. **Accessible**: 4.5:1 contrast, ≥ 44 px targets, Dynamic Type, VoiceOver labels.

### Type & shape
- Bricolage Grotesque throughout: headings 800, body 400–500 (Pop theme).
- Radius: 14–18 px cards, pill chips, 22 px sheets.
- Spacing scale 4/8/12/16/24.

### Navigation (unified)
- **4 tabs**: Explore · Tonight · Chats · Me.
- **Explore** top: mode switch **Hookup · Sport · Friends** + Map/Grid toggle. Replaces separate Activities tab and intent chip row.
- Filters in one sheet (button), not chip rows.

### "Wow" moments
- Welcome screen shows the real, live (blurred) activity around you before sign-up.
- Mode switch recolours the app with a fluid transition.
- "Door open" pins breathe on the map; countdown ring on expiring pins.
- Party card seats fill in real time.
- Verification: face ring fills, badge drops onto your avatar.

## 4. Design audit of mockups v0.1 → fixes

| Issue | Fix |
|---|---|
| Grid screen had 5 tabs, others 4; Activities used its own tab | Unified 4 tabs; Activities = Sport mode inside Explore |
| Intent chips row (5 chips) + filter line = cognitive load | Mode switch (3) + one Filters button |
| Separate Map screen duplicated Home | Home (map-first) is the map; old Map board retired |
| Location precision buried | Location pill always on Explore, 1 tap to change |
| Settings long | Grouped; defaults safe; search in Settings |
| Sign-up undefined | Passkey-first 6-step flow above |
