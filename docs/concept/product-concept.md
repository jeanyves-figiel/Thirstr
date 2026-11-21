# Thirstr — Product Concept v0.3

Status: draft v0.3 (audience, photo policy, worldwide launch) · 2026-11-16 · Owner: Jean-Yves

Goal: **hookup-first** app for anyone who identifies as a man (cis, trans, non-binary masc-identified; gay, bi, queer) (also friends + chat) that outlasts Grindr, Scruff, Romeo, Hornet, Jack'd, Taimi, Feeld, Sniffies.
Pillars: **functionality · privacy · speed · control**. Usable fully free. **Zero bots.**

Positioning:
- **Primary job: hookups.** Fastest path from "horny now" to "door open", safely. Every default optimizes this.
- Secondary: chat, friends. Same profile, intent toggle; never dilutes primary flow.
- Audience: self-identified men, incl. trans men and non-binary people who identify as men. Self-declared identity; no proof asked. Gender/identity fields + filters inclusive from v1; transphobia = moderation offence.
- Distribution: **App Store + Google Play** (native). Store rules drive public-photo policy (§5 Photos).
- Scope: **worldwide from day 1** (§12).
- Mockups: [Thirstr app screens](https://claude.ai/artifact/TErsb1tkyu5qWo8JQxD6VG) (private canvas; share from its menu).

---

## 1. Thesis

- Incumbents monetize via **ad-tech + paywalled usability + AI upsell**. That model structurally conflicts with user safety. They cannot fix privacy without cutting revenue.
- Moat = **trust architecture they can't copy cheaply**: server knows almost nothing, so nothing can leak, be sold, subpoenaed, or trilaterated.
- Win condition: local density in target cities + "safest app" reputation + no reason to leave (free tier does the job).

## 2. Market scan

| App | Model / price | Strengths | Top pain points |
|---|---|---|---|
| Grindr | Ads + Xtra ~$19.99/mo, Unlimited ~$39.99/mo; AI tier "EDGE" tested at very high price points | Largest network, Right Now, grid speed | Heavy ads, bots/extortion, paywalled basics, location precision history, indifferent moderation, notification previews outing users |
| Scruff | Pro ~$14.99/mo | Travel (Venture), events, community | Slow harassment moderation, aging UX, travel/filters behind Pro, weak verification |
| Romeo | Plus only (no ads in revenue) | EU base, web + app, long-form profiles | 2023 moved search options, Quickshare initiation, list/big grid to Plus; free capped at 150 results |
| Hornet | Freemium | Social feed, stories, int'l reach | 2024 Check Point: trilateration to precise location; server received precise coords |
| Jack'd | Freemium | POC community | 2019: private photos publicly accessible; NY AG settlement |
| Taimi | XL ~$19.99/mo | Broad LGBTQ+, video | Bot saturation, absent moderation, aggressive paywall |
| Feeld | Majestic ~$11.99/mo | Kink/ENM, desires, couples | Subscription bloat, couple verification clunky, small pool, bugs |
| Sniffies | Web map, Plus tier | Browser-based (no app store), live map, cruising | Map precision risk, adult-only niche, spam |

Cross-app pain points (user reviews):
1. Bots, OnlyFans promos, scammers, extortion.
2. Paywall on core usability (filters, scroll depth, ad removal, read receipts, travel).
3. Ads: intrusive, slow, data-hungry SDKs.
4. Racism/body-shaming text in profiles; weak moderation.
5. Location precision → stalking, outing, police entrapment.
6. Notifications/app icon outing users.
7. Ghosting / dead-end chats; repetitive grid; burnout.

## 3. Privacy incidents to design against

| Incident | Lesson → requirement |
|---|---|
| Grindr 2018: HIV status + location shared with SDK vendors (Apptimize, Localytics) | Zero third-party SDKs. Health data never leaves device unencrypted. |
| Grindr Norway fine NOK 65M (2021), upheld by Borgarting Court of Appeal Oct 2025: app ID = sexual orientation (GDPR Art. 9) shared with ad partners; forced consent | No ads, no ad IDs. Consent granular, refusable, app works without it. |
| Grindr UK settlement £26M (Sep 2026), ~12k claimants, HIV data to advertisers | Same. Treat whole account as Art. 9 special-category data. |
| 2021 Pillar outing of a priest via purchased Grindr-derived location data | No data broker exposure possible: no ad SDK, no precise location stored. |
| Trilateration: Grindr 2014/2016, Romeo/Grindr/Recon 2019 (Pen Test Partners), Hornet 2024 (Check Point) | Server never receives precise coords; distances computed from coarse cells. |
| Jack'd 2019 private photos exposed | Private media E2EE; server holds only ciphertext. |
| Egypt/MENA police entrapment (HRW 2023: Egypt, Iraq, Jordan, Lebanon, Tunisia) | Hostile-country mode, anti-catfish trust signals, panic wipe, decoy icon, no plaintext on device seizure. |

## 4. Product principles

- **No ads. Ever.** No ad SDKs, no ad IDs, no data sales. Written into bylaws/ToS.
- **Free tier must be complete**: a user never needs to pay to find, chat, meet safely.
- **Safety features never paywalled** (Hidden, hostile-country mode, disguised icon, blocking, verification).
- **Know nothing server-side**: minimize what exists to be leaked.
- **User owns ranking**: transparent, chronological/distance; no hidden pay-to-win sorting.
- **Fast**: grid < 300 ms p95, cold start < 1 s, app < 30 MB.

## 5. Differentiating features

### Discovery
- **Home = map first** (owner decision 2026-11-16): live map + "Active now" card tray; Map/Grid toggle; mode switch Hookup / Sport / Friends (recolours app); tabs Explore / Tonight / Chats / Me. Deliberately not a Grindr-style grid home.
- **Grid + Map** (map: area heat by default; exact pins only for users who opted in, see §6.2).
- **Intents** (default selected: Now + Hookup): Now / Hookup / Chat / Friends / Travel. Filter by intent; free.
- **Hookup tooling**: hosting / can travel / door open status; position, practices, PrEP/safer-sex prefs as filterable tags (shown to verified viewers only); "Now" posts with exact pin opt-in; quick-yes/no tap replies to cut chat time.
- **Right Now with expiry**: post auto-deletes (1–6 h); visible to cell-ring only.
- **All filters free**: age, distance bucket, intent, tags, verified-only, has-photo, online.
- **Travel planner**: set future location; preview + pre-chat locals. 1 free trip active; more = paid.
- **Events & venues**: bars, saunas, parties, Pride; RSVP privately; "who's going" only to mutual-opt-in.
- **Ice-breaker prompts** vs. "hey" dead ends; optional, not AI-generated messages.
- **Friends mode**: non-sexual social graph so coupled users stay (retention).

### Social hookup features (owner-approved 2026-11-16)
- **Group & party hosting**: "3 hosting tonight, 2 spots left"; host sets capacity, rules, audience; RSVP verified-only; address revealed only to accepted guests, E2EE.
- **Private notes & tags on profiles**: "met 03/11", "flaky"; stored on device only, synced E2EE across own devices.
- **Disappearing chats by default**: per-chat timer 24 h / 7 d / never; default 7 d (user-changeable).
- **One profile, three lenses** (replaces multiple profiles, 2026-11-18, #96): choose where you show up (Hookup / Friends / Sport); Friends and Sport show only safe photos and no hookup details.
- **Venue check-in**: sauna, bar, party, gym; "who's here" visible only to others checked in who opted in; auto check-out on leaving geofence / after 4 h.
- **Tonight board**: plans for later today (not just now): "free after 22:00, hosting", expiring at end of night; own tab on home.

### Activities (gym buddies, sports)
- New intent **Activities**: gym buddy, running, cycling, climbing, swimming, team sports, hiking, yoga, martial arts, etc.
- **Activity profile**: SFW variant of the profile (vanilla photos only, no position/practice tags). Shown in Activities mode; hookup content never leaks into it.
- **Activity posts**: "Leg day, Basic-Fit Oberkampf, 19:00, need a spotter" / "10 km Sunday 9:00, 5:30 pace". Expiring, RSVP, verified-only by default.
- **Open-to-more flag** per user: "just sport" / "open to more". Viewers filter by it, so nobody is surprised.
- **Clubs & teams**: queer sports clubs (rugby, football, volleyball, running crews) get pages, events, join requests. Partnership channel (listings, not ads).
- Gyms/sports venues in venue layer: check-in visible only to opted-in people at same place.
- Location: same levels as everywhere; Activities default = Area.
- Why: non-hookup reason to open the app daily → retention for coupled/off-season users; strong local density driver; brand not only hookups.

### Photos & media policy
| Where | Limit | Allowed | Checked by |
|---|---|---|---|
| Main public photo (1) | — | **Vanilla**: face/body, clothed or shirtless; no underwear focus, no nudity | Server AI, strict |
| Other public photos | max 4 (5 total) | "Spicy": shirtless, underwear, jockstrap, suggestive; **no genitals, no sex acts, no visible erection** | Server AI, permissive; human review on flag |
| Private albums | **No limit** (photos + videos) | Anything legal between consenting adults | E2EE, not scanned server-side; user reports (franking) + on-device CSAM/minor safety check |
| Chat media | No limit | Same as private albums | Same |

- Public line = App Store guideline 1.1.4 (no "overtly sexual or pornographic material") + Play "sexual content" policy. Grindr/Scruff operate at this line; the store app's public surface can't go further.
- Explicit content allowed only inside E2EE private albums/chat (user-to-user, not published) + 18+ age rating + verified-only.
- Unsolicited explicit media: blurred by default for receiver ("tap to view"), receiver controls per-sender.
- Videos: private albums/chat only, size cap per file (e.g. 100 MB / 3 min), E2EE, view-once option.

### Chat
- E2EE 1:1 and groups (MLS / Signal protocol).
- Private albums: E2EE, per-recipient grant, revocable, expiring, view-once.
- Viewer-specific invisible watermark on shared media (leak deterrence + attribution).
- Screenshot detection notice (Android block; iOS notify).
- In-app voice/video (E2EE, WebRTC) → no number exchange needed.
- Read receipts + typing: free, user-toggled, symmetrical.
- Chat sort: "replied / unreplied / starred"; mute; snooze.

### Share from X, Bluesky, OnlyFans, JustFor.Fans (owner request 2026-11-17)
Goal: send a member a post (e.g. a clip showing what you're like in bed) straight from those platforms.

How:
- **Share-sheet target**: in X/Bluesky/OF/JFF app or browser → Share → Thirstr → pick member(s). Also paste link in chat.
- **Preview built on the sender's phone** (OpenGraph/oEmbed), sent E2EE inside the message. Server never fetches the URL, so it never learns what was shared.
- Explicit previews **blurred by default**, receiver taps → opens in the source app/browser. Explicit media never rendered inside our app's public surfaces (store rules); inside E2EE chat it follows the receiver's "explicit media" setting.
- **Linked accounts on profile** (optional, visibility per field, default My chats): X, Bluesky, OnlyFans, JustFor.Fans, Instagram.
  - **Ownership check** so nobody can claim someone else's account: Bluesky = handle/DID proof; X = OAuth; OF/JFF/others = one-time code placed in their bio. Shows "linked ✓".
- No API dependency: OF and JFF have no public API; X API is paid; Bluesky (AT Protocol) is open. Link + device-side preview works for all, no partnership needed.

Guardrails (keeps §9.1 anti-bot intact):
- Links allowed in a chat **once the other person has replied** (first-message link block stays).
- Promo/mass sending caught by the same send-rate + duplicate-message signals; Creator profile type for accounts that mainly promote.
- Sharing content that isn't yours or shows someone who didn't consent → one-tap report, removal + ban.

### Health (local-only)
- PrEP/test reminders stored on device only.
- Profile health fields (status, PrEP, U=U) visible **only to matched/chosen users**, never to grid.
- Anonymous partner notification: E2EE message to past chats, sender unrevealed.
- Clinic finder (static open data, no tracking).

### Safety
- **Meet check-in**: share meet location + timer with trusted contact; auto-alert if not checked in.
- **Verified badge** (see §7).
- **Trust signals**: account age, verified, vouches; new accounts flagged to viewer.
- **Boundaries card**: declare consent preferences up front.
- **Block = total**: blocked user can't see you even via new account on same device (device attestation hash, not ID).

### Control
- Full field list, per-field visibility and settings tree: [profile-and-settings.md](profile-and-settings.md).
- Sign-up (passkey-first, no phone number), onboarding flow, design system & audit: [onboarding-and-design.md](onboarding-and-design.md).
- Visibility per field (public / matches / chosen).
- Hidden: browse without appearing, for a set time or until I switch (free; replaces Incognito, #114).
- Pause profile vs. delete.
- One-tap full export (GDPR Art. 20) + instant hard delete (no 30-day limbo beyond legal min).
- No algorithmic feed by default; optional "suggestions" toggle, explainable.

## 6. Privacy-by-design architecture

### 6.1 Data minimization
| Data | Stored server-side? |
|---|---|
| Precise GPS | **Only if user opts into Exact** (§6.2): RAM-only, TTL-bound, no history, no logs, never backed up |
| Location (default) | H3 cell (res ~9, ~0.1 km², ~200 m; res 8/7 when sparse) + timestamp; overwritten, no history |
| Phone number / email | Optional. Account = keypair. Recovery via recovery phrase or optional email hash |
| Real name, DOB | No. Age = boolean "18+ verified" credential |
| Messages / media | Ciphertext only, deleted after delivery (or TTL 30 d undelivered) |
| Profile (public) | Yes, plaintext (it's public by intent) |
| Health fields | Encrypted to recipients only |
| Analytics | Aggregate, on-device differential privacy; no per-user event stream |
| IP | Not logged beyond abuse-rate-limiting window (24 h, hashed) |

### 6.2 Location: user's choice, safe by default

Precision is the user's call. Four levels, switchable anytime (mockup: Location control):

| Level | Others see | Server stores | Default |
|---|---|---|---|
| Hidden | Nothing (browse only). **Verified users only** | Cell for own grid query, not indexed | |
| City | City name | City-level cell (res ~5) | Safe Mode |
| Area | Distance bucket ("< 200 m", "200–500 m", "500 m–1 km", "1–2 km"...), avatar placed inside its zone on map (not at real point) | Cell res ~9 (~200 m) in cities; auto-coarsens to res 8/7 when cell has < k users | **Yes** |
| Exact | Pin on map + distance in metres | Exact point, RAM-only, TTL | Opt-in only |

What you see = what each nearby person chose, not your own setting. Your setting only controls how others see you.

Viewing rules:
- **Exact pins visible to any viewer the pin owner allows** (owner decision 2026-11-17), incl. Hidden viewers unless the owner turns on "Hide me from hidden users"; no give-to-get. Filters: pin owner's audience setting (verified only by default / my chats / everyone) + that toggle.
- Grid sort: exact users by metres, then area users by cell distance, randomized within cell.
- **k-anonymity**: a cell is only shown at res 9 (~200 m) if it holds ≥ k active users (e.g. k = 5); else merged up to res 8 (~500 m) or 7.
- **Hide me from hidden users** (owner decision 2026-11-17): toggle; when on, viewers in Hidden mode don't see you in grid, map, exact pins, Tonight or venues. Off by default.
- Hidden mode requires verification (owner decision 2026-11-17): no anonymous lurking by unverified accounts.

Exact opt-in rules:
- Explicit action each time; one-screen warning ("anyone you allow sees your exact spot").
- **Auto-expiry required**: 30 min / 1 h / 3 h / until you leave the spot (geofence on device). Never permanent.
- Audience: verified only (default) / people I chat with / everyone verified-or-not.
- Pin jittered ≤ 10–20 m (enough to come knock, not enough to identify flat).
- Blocked users never see it; new/unverified accounts can't see it unless user picks "everyone".
- Server keeps exact point in memory store with TTL; no disk, no logs, purged on expiry.
- **Disabled automatically in Safe Mode countries**; user can't override without a second, explicit warning.
- Also available per-chat: "share exact location with this person only" (E2EE, expiring).

Anti-trilateration (Hidden/City/Area levels):
- Device snaps GPS → H3 cell locally. Only cell ID sent.
- Grid query = k-ring of cells. Server returns profiles grouped by cell; **no per-user distance computed server-side**.
- Client shows distance **buckets** ("< 1 km", "1–3 km", "3–10 km") derived from cell centroids.
- Per-user stable random offset within cell (seeded per day) prevents edge-averaging.
- Location update rate-limited + velocity check (spoofed teleports for triangulation throttled/flagged).
- Map shows cell heat for Area users; pins only for Exact opt-ins.
- Exact users' distance is real by design (they chose it); trilateration against them only reveals what they already share, within jitter and TTL.
- Hostile-country mode: res drops to city-level (res ~5) automatically.

### 6.3 E2EE + local-first
- Protocol: MLS (RFC 9420) via OpenMLS for groups/multi-device; or libsignal. Decision → issue.
- Chats live on device (SQLCipher). Server = store-and-forward relay.
- Multi-device: MLS group per user's devices.
- Backup: optional, client-encrypted, user-held key.
- Sealed sender: server doesn't know who messages whom beyond delivery token.
- **Message franking** (Facebook-style) so users can verifiably report abusive E2EE messages without breaking E2EE for everyone.

### 6.4 Infra
- EU hosting (GDPR jurisdiction), no US ad-tech dependencies.
- Zero third-party SDKs in client (no Firebase Analytics, no ads, no attribution). Push via APNs/FCM with **content-free payloads** (wake-up only).
- Open-source client + crypto core; reproducible builds; annual independent audit; transparency report; warrant canary.
- Subpoena response: we hand over what we have, which is almost nothing.

## 7. Verification without doxxing

- **Liveness + photo match on-device** (or via zero-retention vendor), compares selfie to profile photos.
- Output = **anonymous credential** (blind-signed token / Privacy Pass style): "real human, 18+, matches photos". No ID document stored.
- Age assurance where law requires (UK OSA, EU, some US states): third-party age estimation with zero retention, result = boolean only.
- Re-verify on major photo change.
- Verified-only inbox filter (free). Strongest bot/catfish deterrent.
- Vouching: verified users can vouch (met IRL) for others; capped, decays; visible as count only.

## 8. Hostile-country safety (travel + residents)

- Auto-detect via cell → country, mapped to ILGA criminalization data. Prompt: enable Safe Mode.
- **Safe Mode** (free):
  - Hidden from grid unless explicitly visible; visible only to verified users.
  - City-level location only.
  - Disguised app icon + name (calculator/notes).
  - Duress PIN → opens decoy empty profile; real PIN unlocks. Panic gesture wipes local data.
  - No message previews; no photos in notifications.
  - Media auto-expiry default on.
  - Entrapment warnings: new accounts, unverified, pushy-meet patterns flagged.
- Local NGO hotline/resources per country (static, offline).
- Arabic, Russian, Turkish, Farsi, etc. moderation coverage (HRW recommendation).
- No geofencing that silently tells authorities who is gay (avoid "app disabled in X" leaking user lists).

## 9. Moderation & trust

- Layers: (1) friction for new accounts (rate limits, verified to message at scale), (2) metadata-based spam/bot ML (send rates, cell-hopping, copy-paste bios — no message content), (3) user reports with message franking, (4) regional human moderators, (5) appeals.
- Profile text nudge: discriminatory phrases ("no fats/fems/asians") flagged at write-time with prompt; repeated → hidden.
- OnlyFans/promo: commercial links banned in bio; separate opt-in "creator" label instead of whack-a-mole.
- Extortion/sextortion: proactive warning when sharing first nude with new contact; one-tap report + block + media revoke.
- Public photos: server AI classifier (vanilla for main photo, permissive for others, §5 Photos); flags → human review.
- CSAM: hash matching on **public** profile photos (server-visible); private/E2EE media checked by on-device classifier + hash match before send (blocks, never reports content plaintext to server), plus user reports via franking. Age gate + verification.
- Transparency report quarterly.

### 9.1 Anti-bot: zero-bot target

Bots = #1 complaint category-wide (Grindr, Taimi, HER). Goal: a bot costs more than it earns, and gets no reach before it's caught.

Gate (before visibility):
- **Verification required to appear in grid/map and to start chats.** Unverified = browse-only + reply-only to people who messaged them first. No exceptions.
- Liveness check with randomized challenge (turn head, blink, gesture) on-device; defeats stock photos + replayed videos; deepfake/injection detection.
- **Device attestation** (Play Integrity / App Attest): emulators, rooted farms, scripted clients rejected.
- One verified human ↔ max N active accounts (credential is rate-limited, unlinkable but non-reusable).
- Private API: signed requests, attested client, no public endpoints; certificate pinning.

Behavior (after visibility; metadata only, E2EE intact):
- Send-rate caps scaling with account age + trust.
- Signals: identical first messages across recipients (client-side hash, no content leak), link/handle in first messages, reply-to-message ratio, 24/7 activity, cell-hopping, never-moving, opening-line templates.
- First-message link block: no URLs, handles, or "check my bio" until a reply exists.
- Bio: commercial links banned; OnlyFans/creators only under labelled "Creator" profile type (filterable off by default).
- Shadow quarantine: suspect accounts keep sending, nobody receives; zero feedback for bot operators.

Community:
- One-tap "bot" report; 3 independent verified reports → instant quarantine pending review.
- Reporters with good track record weigh more.
- Public bot-rate KPI (bot reports / 1k MAU) in transparency report.

Economics:
- No ads = no incentive to inflate MAU with fake profiles.
- Verification cost per account kills bulk farms; bans tied to device attestation + credential, not email.

## 10. Speed

- Native-feel cross-platform UI; shared Rust core (crypto, H3, storage).
- Grid: cell-keyed cached tiles at edge (CDN), thumbnails AVIF/WebP, pre-fetch next page.
- Offline-first: chats/profile cached locally; optimistic send.
- Budgets: grid p95 < 300 ms; message delivery p95 < 500 ms; cold start < 1 s; app < 30 MB; no SDK bloat.
- Perf budgets enforced in CI.

## 11. Monetization (no ads, generous free)

Free (forever):
- Unlimited grid/map scroll, all filters, unlimited messages, private albums (limited count), video calls, Hidden, Safe Mode, verification, read receipts, 1 active travel plan, events.

**Plus** (target €4.99–6.99/mo, PPP regional pricing, lifetime option):
- Multiple/scheduled travel plans; bigger album storage + longer media history; themes/icons; advanced chat organization; early features; supporter badge (optional).
- **No** visibility boosts that degrade free users' experience. If boosts exist: capped, labeled, one per user/day.

Other revenue:
- Events/venue ticketing commission; venue listings (labeled, non-tracking).
- Sexual-health partnerships (sponsored clinic listings, home-test kits) — zero data shared.
- Donations / "pay what you can" for hostile-country users (always free there).

Cost advantage: no ad sales team, minimal server data, E2EE relay cheap. Target infra < €0.05/MAU/mo.

Governance: steward-ownership or foundation clause locking "no ads / no data sale" to resist post-acquisition drift (Grindr Kunlun era lesson).

## 12. MVP scope (v1)

In:
- Account (keypair, optional email), profile (inclusive gender/identity fields), 5 public photos (main vanilla + 4 spicy, AI-checked), unlimited private albums incl. video.
- On-device verification → badge; **verification required to be visible / start chats** (anti-bot gate, §9.1).
- Grid (cell-based) + distance buckets, all filters, intents (Now + Hookup default).
- Location levels Hidden / City / Area / Exact (opt-in, expiring) + map view with area heat and exact pins.
- Hookup status: hosting / can travel / door open.
- Anti-bot v1: device attestation, send-rate caps, first-message link block, shadow quarantine, bot report.
- E2EE 1:1 chat, media, view-once, block/report (franking).
- Hidden, Safe Mode basics (disguised icon, city-level, no previews).
- Right Now (expiring posts).
- Push (content-free).
- Export/delete.
- Share link / QR to own profile (for bios on other apps, see §15).
- Moderation console v0.
- **Home = map first** + Active-now tray, Map/Grid toggle, Tonight tab.
- **Social hookup features** (owner: all in v1): party hosting, private notes, disappearing chats (default 7 d), profile lenses (Hookup/Friends/Sport), venue check-in, Tonight board.
- **Activities**: intent, SFW activity profile, activity posts, open-to-more flag, clubs & teams, gym check-in.

Out (v2+): groups, video calls, events, travel planner, health module, vouching, Plus billing, multi-device, duress PIN.

Launch: **worldwide, day 1** (owner decision). Density is the risk of a global launch (empty grid → uninstall), so:
- Adaptive radius: grid widens automatically until it shows ≥ N profiles; shows "nearest active" instead of empty states.
- Travel + "who's around this weekend" fill sparse areas.
- Marketing concentrated on top gay hubs simultaneously (Paris, Berlin, London, Madrid, NYC, SF, São Paulo, Bangkok, Sydney...) while app is open everywhere.
- Partners: venues, parties, Pride orgs, NGOs per region.
- Localization at launch: EN, FR, DE, ES, PT, IT + RTL-ready; moderation coverage scales with regional signups.
- Safe Mode live worldwide from day 1 (ILGA list).

KPIs: D1/D30 retention, % verified, bot reports/1k MAU, reply rate, time-to-first-meet, p95 latencies, NPS on "feel safe".

## 13. Moat & retention

- **Trust moat**: audited zero-knowledge stance; incumbents can't follow without killing ad revenue.
- **Density moat**: city-by-city; network effects are local, so win cities, not globe.
- **Social graph beyond hookups**: friends, events, vouches → reasons to stay when partnered.
- **Reputation**: verified + vouch history is non-portable value earned on platform.
- **Community**: NGO/venue partnerships, open roadmap, user council.
- **Brand**: "the app that can't out you." Earned via audits and transparency, not claims.
- **No paywall churn**: users don't leave because free works.

## 14. Mistakes not to repeat

Each recurring complaint (app-store reviews, Reddit, press) → incumbent cause → our rule. Each rule is a release gate: a feature that breaks one doesn't ship.

| # | Complaint | Who | Root cause | Our rule |
|---|---|---|---|---|
| 1 | "Unusable without paying" | Grindr, Taimi, Romeo, Feeld | Core usability paywalled (filters, scroll cap, ad removal) | Free = complete. All filters, unlimited scroll, unlimited messages free. Plus sells convenience only. |
| 2 | Ads everywhere, full-screen, slow | Grindr | Ad revenue model | No ads, no ad SDKs. Written into ToS/bylaws. |
| 3 | My data/HIV status sold or shared | Grindr (Norway fine, UK settlement) | Ad-tech SDKs, forced consent | Zero third-party SDKs; health fields E2EE to chosen users; consent refusable. |
| 4 | Someone found my exact location | Grindr, Romeo, Hornet | Precise coords server-side, exact distances, no choice | Area by default; exact only by explicit, expiring, audience-limited opt-in; off in Safe Mode. |
| 5 | Bots, OnlyFans spam, scammers | Grindr, Taimi, HER | No verification, profit from MAU counts | Verification required to be visible/initiate; device attestation; shadow quarantine; creator label (§9.1). |
| 6 | Extortion / sextortion | Grindr | Unverified accounts, screenshots | Verified badge, view-once, viewer watermark, first-nude warning, one-tap revoke. |
| 7 | Reports ignored, automated moderation | Grindr, Scruff, Taimi | Moderation as cost center | Regional human mods, SLAs, appeals, quarterly transparency report. |
| 8 | Racism, body-shaming bios | All | No friction at write-time | Write-time nudge, repeat → hidden; ethnicity filter not offered. |
| 9 | Notification / icon outed me | Grindr | Content in push payloads | Content-free push; disguised icon free. |
| 10 | Police / catfish entrapment | Grindr (Egypt, MENA) | Unverified new accounts can browse locals | Safe Mode, verified-only visibility, new-account flags, duress PIN. |
| 11 | Same grid, nobody replies, burnout | Grindr | Engagement-max design | Intents, prompts, reply-rate signals, Friends mode, pause instead of delete. |
| 12 | Features removed then re-sold | Romeo (2023), Taimi | Squeezing ARPU | Free-tier freeze: no free feature ever moved to paid (public pledge). |
| 13 | Price hikes, $40–$500/mo tiers | Grindr | Whale monetization | Single low Plus tier, PPP pricing, lifetime option, free in hostile countries. |
| 14 | AI writing chats, "dating as admin" | Grindr gAI | AI upsell | No AI ghost-writing messages. Any AI on-device, opt-in, never trained on chats. |
| 15 | Laggy, battery-hungry, crashes | Grindr, Feeld, Scruff | SDK bloat, legacy code | Perf budgets in CI; < 30 MB app; no SDKs. |
| 16 | Couples/trans/non-binary handled badly | Feeld, HER, Scruff | Afterthought data model | Linked profiles, flexible gender/identity fields from v1. |
| 17 | Can't really delete account | Several | Retention dark patterns | One-tap export + hard delete; no dark-pattern cancel flows. |
| 18 | Hard to cancel subscription | Category-wide | Dark patterns | Cancel in 2 taps; reminder before renewal. |
| 19 | Values drift after acquisition | Grindr (Kunlun era) | Ownership change | Steward-ownership / foundation lock on "no ads, no data sale". |

## 15. Interconnection with other apps

User ask: let people link existing Grindr/Scruff/Romeo/Hornet accounts and use those networks from our app.

### Findings
- **No public APIs.** None of Grindr, Scruff, Romeo, Hornet, Jack'd, Taimi, Feeld, Sniffies offers a partner/third-party API for profiles or chat.
- **ToS forbid it.** Grindr ToS: users may not "create extensions of, products related to, or that interoperate with, the Grindr Services"; reverse engineering and disabling security features also banned. Others carry similar clauses.
- **EU DMA doesn't help.** Messaging interoperability obligations apply only to designated gatekeepers (WhatsApp, Messenger). Dating apps aren't designated; no legal right to interop.
- **GDPR Art. 20 portability** gives users the right to export their own data (structured, machine-readable). It doesn't oblige live interop, and covers only the user's own data, not other users' profiles.

### Options
| Option | How | Verdict |
|---|---|---|
| A. Unofficial client / bridge (log in with their credentials, proxy their API) | Reverse-engineer private APIs; we or the device hold their session tokens | **Reject.** ToS breach → user bans, cease-and-desist, app-store removal, CFAA/contract risk (US). Holding other apps' credentials contradicts our privacy stance. Breaks constantly. Ships their trackers' data flows into our trust story. |
| B. On-device-only bridge (tokens never leave phone) | Same as A, client-side | **Reject for product.** Lower our liability, same ban/store/legal risk for users. |
| C. Profile import via GDPR export | User requests export from Grindr/Romeo/etc., uploads ZIP; we parse locally on device, pre-fill profile, photos, tags | **Do (v1.1).** Legal, user-initiated, privacy-preserving. Import parsing on-device; nothing kept server-side beyond chosen profile. |
| D. Contact bridge via share links | User posts our profile link/QR in their bio elsewhere ("chat me safely on Thirstr") | **Do (MVP).** Viral loop, no ToS risk on our side (check each app's bio rules). |
| E. Open protocol / federation | Publish our profile+E2EE chat protocol (MLS-based); invite other apps to federate | **Do (v2+), strategic.** Positions us as the interoperable standard; incumbents unlikely to join, but small apps/venues/NGOs might. Moat by openness. |
| F. Regulatory push | Support EU calls to extend interop/portability rules | Low cost, long horizon. |

### Recommendation
- MVP: D (share links/QR). v1.1: C (GDPR-export import, on-device parser per app). v2+: E (open protocol).
- Never A/B. Revisit only if an incumbent offers an official API.

## 16. Risks

| Risk | Mitigation |
|---|---|
| Cold start / density (worldwide launch) | Adaptive radius, hub-focused marketing, travel, events tie-in |
| App store adult-content rules | Main photo vanilla, others no genitals/sex; explicit only in E2EE private albums/chat; 17+/18+ rating; report/block per guideline 1.2 |
| Age-verification laws | Zero-retention age estimation, boolean credential |
| E2EE abuse / CSAM scrutiny | Franking, verification, metadata ML, public-photo hashing |
| Funding w/o ads | Low cost base, Plus conversion 5–8%, events revenue |
| Coarse location = worse UX than competitors | Buckets + optional exact share in chat; users accept for safety (market it) |
| Spoofed location attackers | Velocity checks, attestation, cell-only exposure caps damage |

## 17. Sources

- Grindr ToS interop clause (via ConductAtlas): https://conductatlas.com/platform/grindr/grindr-terms-of-service/no-creating-extensions-or-interoperating-products/
- EU DMA messaging interoperability: https://digital-markets-act.ec.europa.eu/messaging-interoperability_en

- Unstar, LGBTQ dating apps ranked 2026: https://unstar.app/blog/lgbtq-dating-apps-grindr-her-scruff-feeld-taimi-ranked-2026
- PPC Land, Norwegian court upholds €6.5M Grindr fine: https://ppc.land/norwegian-court-upholds-eu6-5m-grindr-fine-for-data-sharing-violations/
- Ground News, Grindr £26M UK settlement: https://ground.news/daily-briefing/1edcc961-5afe-4aff-8306-f0596ac8f530
- Check Point Research, Hornet location (2024): https://blog.checkpoint.com/research/not-so-private-after-all-how-dating-apps-can-reveal-your-exact-location/
- arXiv, "Your Neighbors Are My Spies" (2016): https://arxiv.org/pdf/1604.08235
- PinkNews, Grindr/Romeo/Recon leaking location (2019): https://emdash.thepinknews.com/2019/08/09/grindr-romeo-recon-gay-dating-apps-leak-location-data
- Global Dating Insights, Grindr 2026 roadmap (gAI): https://www.globaldatinginsights.com/featured/grindr-releases-2026-roadmap-focuses-on-gai/
- Romeo, PLUS changes 2023: https://www.romeo.com/care/plus-changes-2023
- VOA / HRW digital targeting MENA (2023): https://www.voaafrica.com/a/protect-lgbtq-big-tech-hrw/6972378.html
- PinkNews, Grindr warns Egypt users (2023): https://thepinknews.com/2023/03/23/grindr-sends-every-user-in-egypt-warning-about-police-tricking-and-arresting-queer-men
