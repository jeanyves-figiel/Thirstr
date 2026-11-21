# F-19 Gestures & haptics

Issue [#187](https://github.com/jeanyves-figiel/Thirstr/issues/187). Mockup with picks: [Gestures](https://claude.ai/artifact/CPdgwYCbyyA6oPgHk1CRZm).

## Purpose
Make the app fast to use with one hand: the common actions (reply, react, archive, Tap, next profile, close) are one gesture away, without hiding anything. Every gesture is a shortcut, never the only way.

## Scope
Beta: G1–G18 below. Jean-Yves picked all 18 on the mockup (2026-11-21). Out of scope: swipe between tabs (conflicts with map pan and the photo pager), card-stack yes/no swipe (Thirstr is grid and map first), shake gestures (false triggers), swipe-to-delete a chat (data loss by mistake).

## Global rules
- R-19.1 **Visible alternative.** Every gesture has a visible control that does the same thing (listed per gesture). A gesture is never the only path.
- R-19.2 **Screen readers.** Every gesture is also an `accessibilityActions` entry on its element (VoiceOver rotor / TalkBack actions menu) with the same label as its visible control. Covered by tests.
- R-19.3 **UI thread.** Gestures use `react-native-gesture-handler` v2 + `react-native-reanimated` (worklets). No JS runs per frame; JS is called once, on commit (`runOnJS`). No `PanResponder` and no `Animated` JS driver for gestures.
- R-19.4 **System gestures win.** The iOS left back edge (first 24 pt) and Android system back / home gestures are never captured. Horizontal row swipes start only after 12 pt horizontal travel with |dx| > 1.5·|dy|, so vertical scroll always wins.
- R-19.5 **Reduce Motion.** With OS Reduce Motion on, follow-the-finger stays (it is direct manipulation) but springs become 150 ms timing curves and bursts (heart, Tap) become a fade.
- R-19.6 **Thresholds.** Commit threshold = 30 % of the travel or velocity > 800 pt/s. Crossing it plays one `tick` haptic and the action icon fills; going back under it cancels silently.
- R-19.7 **Undo.** Any gesture that moves or hides content (archive, close profile with unsent note) shows a 4 s toast with Undo.
- R-19.8 **Haptics** (G17). Four tokens only, in `ui/haptics.ts`: `tick` (selection, threshold, sheet stop), `tap` (action done), `success` (Tap sent, reply sent from gesture), `warning` (Block, Report, SOS). Off when Settings → Haptics is off (iOS also mutes them in Low Power Mode). Never on scroll or per frame.
- R-19.9 **Web build.** Gestures that need touch (G1, G2, G5, G8–G13) are no-ops on web; the visible alternative is used.
- R-19.10 **Taps never block swipes.** Every tap / double-tap gesture fails once the finger moves 10 pt (`TAP_SLOP`), so a pan or swipe on the same element starts at once. Map markers open on one tap via the marker's own press (iOS annotation tap), deduplicated with the inner button.

## Gestures

| # | Where | Gesture | Result | Visible alternative |
|---|---|---|---|---|
| G1 | Chat message (any) | Swipe right ≥ 56 pt | Reply: quote card above composer (name + first 80 chars or "Photo"), composer focused. Payload `reply_to: msg_id` | Long-press menu → Reply |
| G2 | Chat message (theirs) | Double-tap | ❤️ reaction toggled (one reaction per person per message, the latest wins; an empty emoji takes it back) | Long-press → ❤️ |
| G3 | Chat message | Long-press 350 ms | Bubble lifts (scale 1.03), chat dims, reaction bar (❤️ 🔥 😂 😮 👍) above (below when too close to the top), actions below (Reply, Copy, Report (theirs), Delete for me). Slide to an emoji and release = react in one move; release elsewhere keeps the menu open for taps. Same emoji again takes the reaction back | — (it is the menu) |
| G4 | Chat | Swipe list left | Send times slide in on the right; release snaps back | Tap a message shows its time |
| G5 | Chats list row | Swipe left | Reveals Mute + Archive; full swipe (> 60 %) archives, toast + Undo | Long-press menu |
| G5 | Chats list row | Swipe right | Favorite (1:1) or Pin (group), toggles | Long-press menu |
| G6 | Chats (waiting messages + Taps), Taps, Hidden & blocked, Party, Activity (members), Club, Venue | Pull down | Refresh from server; spinner in mode colour. Albums are on the phone, so no pull there | Lists update live |
| G7 | Explore grid sheet | Drag handle / sheet | Follows finger; 3 stops; fling (> 800 pt/s) goes to next stop; rubber band above top; `tick` at each stop | Tap handle cycles stops |
| G8 | Explore grid | Pinch (> 1.25 out, < 0.8 in) | 2 ↔ 3 ↔ 4 columns, remembered per device, `tick` | Filters → Grid size |
| G9 | Profile photo | Tap left 35 % / anywhere else | Previous / next photo (replaces the sideways photo swipe); bars on top show position; next photo prefetched | Tap a bar |
| G10 | Profile (from grid) | Swipe left / right (outside left 24 pt) | Pager: the profile follows the finger 1:1 and the neighbour's card (first photo, name, age, tick) slides in beside it; commit at 25 % or fling, finishing at the finger's speed (120–260 ms). Neighbours ±2 fetched ahead (data + first photo, memory cache of 24), so the new profile shows at once, scrolled to the top. Unavailable profiles are skipped. At the end, rubber band | ‹ › in header (same slide) |
| G11 | Profile photo | Double-tap | Sends Tap once; coral burst at the finger; `success`; toast "Tap sent". Already tapped: nothing | Tap button |
| G12 | Profile photo, page at scroll top | Pull down (30 % of 400 pt or fling) | Page follows the finger (rounded, slightly smaller), then closes | Back button |
| G13 | Full-screen photo viewer (profile: pinch out on the photo or ⤢; album and chat: tap the photo) | Pinch / double-tap / swipe / swipe down | Zoom 1–4×, double-tap toggles 1× / 2.5× at the finger, swipe next / prev (3 photos mounted), swipe down closes. Chat photos and view-once: one photo, no paging, no save | ✕, ‹ › |
| G14 | All stack screens (iOS) | Swipe right from anywhere | Back (`fullScreenGestureEnabled`). Off on Profile (G10), Chat (G1), photo viewer (G13), where only the edge works | Back button |
| G15 | Every `Sheet` and live safety sheet | Drag down on the handle / header | Follows the finger, scrim fades; closes past 30 % or fling | ✕, tap outside, VoiceOver escape |
| G16 | Tab bar | Long-press 400 ms | Explore: lens picker; Me: Hidden on/off (verified only, else explains); Chats: first unread chat | Lens switcher, Me → Hidden, inbox |
| G17 | App | — | Haptics tokens (R-19.8) | Settings → Haptics |
| G18 | App | — | Accessibility actions (R-19.2) | — |

## Data
- G1 adds optional `reply_to` (message id) and `reply_preview` (≤ 80 chars, sender display name) inside the E2EE `text` payload. Server unchanged (payload is opaque). Old clients ignore unknown fields and show the plain text.
- G8 grid size: device setting `thirstr.explore.cols` (2|3|4, default 4 = smallest tiles, #223), plain storage (not private).
- G1 reply quote: the reader names the quoted sender from its own copy of that message ("You" or the name); `re.n` only when the original is gone.

## Performance
- Swipeable rows (G1, G5) are one gesture detector per visible row, recycled with the list; no per-row timers.
- Photo viewer (G13) loads the full photo only when opened; zoom uses the cached image (no re-download).
- No gesture adds a network request except its committed action.

## Testing
- Unit: thresholds, velocity commit, rubber band, grid size, photo zones, next profile, row swipe end, reaction hit test, zoom pan limit, strings in en/fr/de (`__tests__/gestures.test.ts`).
- Manual on DEV: iPhone (edge back still works on every screen), Android (system back), VoiceOver pass on Chat, Chats list, Profile.
