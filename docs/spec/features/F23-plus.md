# F-23 Thirstr Plus

Issue #7 (pricing). Decision D-25 (owner, 2026-11-22, [Plus split form](https://claude.ai/artifact/EyYTTqkNxYcfgjbD3T3yfN): every row on the recommended option, €5.99). [Mockup](https://claude.ai/artifact/C2t81w4khbvFPRxPgXdNRn).

## Purpose
Pay for Thirstr without making the free app worse than a competitor's paid one. Free covers the whole core loop: find, chat, meet, stay safe. Plus is for power users: more people in the list, hosting big parties, travel, who viewed me, more Moments and storage, convenience and extras. No ads, ever. No boosts, no pay-to-be-seen, no pay-to-message.

## Terms
- **Plus**: the paid tier. **Free**: everyone else.
- **Entitlement**: the server's answer to "does this account have Plus now, and why" (`source`: `beta`, `safe_mode`, `store`, `lifetime`, `grant`, `none`).
- **Limits**: the numbers that differ between Free and Plus (table R-23.5). One server table (`Thirstr.Plus.limits/1`), sent to the app on `/me`, never hard-coded in the app.

## Rules

### Who has Plus
- R-23.1 **Beta**: while the server setting `plus_mode` is `beta_all` (default on staging and prod until open beta) every account is Plus (`source: beta`). Nothing can be bought. The Plus screen says "Free during the beta" and lists what will be Plus.
- R-23.2 **Safe Mode**: an account whose Safe Mode is on (`safe_mode = on` or `safe_mode_active`, F-14) is Plus at no cost (`source: safe_mode`). Features Safe Mode turns off stay off (e.g. hosting R-10.9, Views R-23.20). The server never learns the country (R-14.3): it only sees the Safe Mode state the phone already reports. Turning Safe Mode off ends this source at once (store or lifetime Plus continues).
- R-23.3 **Store**: an active auto-renewing subscription (monthly or yearly) or the lifetime purchase, verified on the server (R-23.40). **Grant**: a time-boxed grant by the owner from the console (support gestures, testers), audited (admin-console.md A-15).
- R-23.4 Order of sources when several apply: `lifetime` > `store` > `grant` > `safe_mode` > `beta`. Only the first is shown in Settings.

### What Plus gives (D-25)
- R-23.5 Limits (Free → Plus). Abuse caps that already exist stay and apply to both.

| Area | Free | Plus | Spec |
|---|---|---|---|
| People nearby, grid / list | first **200** people, nearest first | unlimited | R-04.5 |
| Distance filter max | 100 km | 300 km | R-04.8 |
| Map | everyone's area pin / count bubble | same | R-04.18 |
| Host parties | **1 per rolling 7 days**, capacity 2–**10** | up to 3 a day (R-10.1 cap), capacity 2–**40**, up to 3 co-hosts, recurring weekly | R-10.1, R-10.4 |
| Join parties | unlimited | unlimited | R-10.3 |
| Who viewed me (Views) | count only ("12 views this week") | full list, 30 days | R-23.20 |
| Trips | **1** planned trip | **5** trips + **Look around any city** without a trip | R-20.1, R-20.14 |
| Tonight plans active at once | **1** | **3** | R-09.9 |
| Moments posted | **3 a day** (live ≤ 3), lasts 1/6/24 h | fair use 20 a day, live ≤ 10, also **48 h** | R-21.5 |
| Private album storage | **1 GB**, videos ≤ 3 min | **25 GB**, videos ≤ 10 min | R-08.17 |
| Chat translation (on device) | — | on | R-07.25 |
| Friend-online alerts | up to 20 friends | up to 100 | R-07.44 |
| Saved filter presets | — | up to 10 per mode | R-23.25 |
| Chat folders | — (built-in All / Favorites / Friends / Groups stay free) | up to 10 own folders | R-23.26 |
| Chat themes, app icons, early access, supporter badge | — | on | R-23.27 |

- R-23.6 **Always free (pledge, published on thirstr.fun/plus and in the app):** unlimited messages, every filter, Hidden, Safe Mode, verification, block / report, date safety and check-in, video check, read receipts, unlimited number of private albums, the disguised app icon, joining parties, Taps, favorites, notes, friends, Moments viewing, the map. From the day billing starts (open beta), nothing that is free then will ever move to Plus, and a Free limit is never lowered. Any change to this list needs a new owner decision and a ChangeLog entry under **Changed** with the reason.
- R-23.7 No paywall in safety, consent or moderation flows, and no Plus prompt in a chat, a party guest chat, a safety screen, during onboarding, or in the first 3 days after sign-up.

### Price (D-25)
- R-23.10 Products: `plus.monthly` €5.99 / month, `plus.yearly` €49 / year (≈ €4.08 / month, shown as "Save 32 %"), `plus.lifetime` €149 once (non-consumable). Same products on App Store and Google Play; no web checkout in v1.
- R-23.11 **Fair price by country (PPP)**: store price tiers per storefront, never below 40 % of the EUR price. The table lives in `docs/spec/plus-prices.md` (generated from the World Bank PPP conversion factor, rounded to the storefront's nearest price point) and is set in App Store Connect / Play Console by a script (`scripts/ops/store-prices.ts`), not by hand.
- R-23.12 **No trial tricks**: no free trial that auto-converts in v1 (beta already gives Plus to everyone). Introductory offers are off.
- R-23.13 **Cancel in 2 taps**: Settings › Plus › Manage subscription opens the store's own subscription page (`itms-apps://apps.apple.com/account/subscriptions`, `https://play.google.com/store/account/subscriptions?sku=…&package=app.thirstr`). Renewal reminder: yearly plans get one in-app card (no push) 7 days before renewal with the date, price and a Manage button.
- R-23.14 Prices shown come from the store (StoreKit `Product.displayPrice`, Play `ProductDetails.formattedPrice`), never typed in the app.

### Where Plus shows up (soft gates only)
- R-23.15 **Plus screen** (S-90, `Plus` route): from Settings › Plus, from Me › top card chip "Plus" (Free only), and from every limit card (R-23.16). Layout (mockup S-90): close ×; wordmark `thirstr` with a `plus` gradient "+"; title "More of everything you already like"; 6 benefit rows (icon tile, title, one line: Everyone nearby · Host big parties · Who viewed you · Travel anywhere · More Moments, more space · Translate, folders, themes); plan picker (Yearly selected by default with "Save 32 %", Monthly, Lifetime), price per period from the store; white **Continue** button repeating the price ("Continue · €49 / year"); under it "Cancel any time in 2 taps · Renews yearly until you cancel"; links Restore purchases · Terms · Privacy; teal pledge card "Free stays free" with the R-23.6 list (expand). In beta: the plan picker is replaced by a teal card "Plus is free during the beta. You have everything on this list." and the button reads "Got it".
- R-23.16 **Limit card** (component `PlusLimit`): shown only when the person reaches a limit by their own action, inline where it happens, never as a full-screen interstitial and never on app open. Content: `plus` gradient "+" tile, one line saying what the limit is in plain words, one line what Plus adds, a **See Plus** pill, and a × that hides that card for 7 days on this device. Placements:
  - Explore grid end: after tile 200, a full-width card "You've seen the 200 nearest people" / "Plus shows everyone around, as far as 300 km." The map is unaffected.
  - Create party: capacity stepper stops at 10 with the hint "Up to 40 guests with Plus"; second party in 7 days: the sheet shows "Next free party from Sat 29 Nov" with See Plus. Co-host and Repeat rows show a small "+" tag and open S-90.
  - Tonight: posting a second plan → "One plan at a time on Free" (keeps the form; the person can end the current plan instead).
  - Trips: "＋ Add a trip" after 1 → "Plan up to 5 trips with Plus". Look around: a city search field "Look around any city" with the "+" tag.
  - Moments composer after 3 today → "3 Moments a day on Free. Next one at 14:20." 48 h chip shows the "+" tag.
  - Album upload over 1 GB / video over 3 min → "Albums hold 1 GB on Free (you use 0.98 GB)" / "Videos up to 3 min on Free, 10 min with Plus."
  - Translation: the Settings row and chat ⋯ "Translate this chat" show the "+" tag; a received foreign message shows no prompt.
  - Views: Me › Views shows the count and blurred-free placeholder rows (no faces, no names: grey tiles) with See Plus.
- R-23.17 Plus-only rows elsewhere show a small `plus` "+" tag (12 pt, gradient fill, ink "+"), never a lock icon. Tapping opens S-90 scrolled to that benefit.
- R-23.18 No push notification, email or badge is ever sent about Plus, except the yearly renewal card (R-23.13, in-app) and store receipts.
- R-23.19 Plus status is never visible to other people, except the optional supporter badge (R-23.27, off by default).

### Views (who viewed me, D-25 "Plus, reciprocal opt-in")
- R-23.20 Setting Settings › Privacy › **Views**: Off (default) / On. On = "People you open can see you visited, and you can see who visited you." Turning it on is the only way to appear in anyone's Views. Hidden accounts (R-05.7) are never recorded and can't turn Views on (greyed: "You're hidden"). Safe Mode forces Off and hides the row.
- R-23.21 A view is recorded when a viewer with Views On opens the full profile (S-20) of an owner with Views On for at least 2 s (not grid tiles, map pins, Moments, chat headers). One row per (owner, viewer) per 24 h; blocks or hides in either direction delete the rows at once and stop new ones. Own profiles are never recorded.
- R-23.22 Me › **Views** (S-91): Free with Views On sees "12 views this week" and the 3-row grey placeholder with See Plus. Plus sees the list for the last 30 days: Today / This week / Earlier; row = avatar, name, age, verified tick, distance bucket (as Explore), "2 h ago"; tap opens the profile (which records a view back only under R-23.21). Swipe to remove a row. No push for views, ever. Turning Views Off deletes own recorded views both ways within 1 min.
- R-23.23 Storage: `profile_views(owner_profile_id, viewer_profile_id, day, last_at)`, deleted after 30 days by the retention sweep (probe `views_30d`). Never in exports of the other person, never used for ranking.

### Convenience and extras
- R-23.25 **Saved filter presets** (S-24 Filters): "Save as preset" at the bottom of the Filters sheet (name ≤ 24), chips above the filters to apply one; up to 10 per mode; device-synced in the E2EE settings blob (R-17.2), never readable by the server.
- R-23.26 **Chat folders** (S-40 inbox): the existing chips (All · Favorites · Friends · Groups) stay free; Plus adds "＋ Folder" (name ≤ 20, emoji optional) and long-press a chat → Move to folder. Up to 10 folders; membership is device-synced in the E2EE settings blob; the server never sees folders.
- R-23.27 **Extras**: chat themes (6 Pop backgrounds for the chat screen: Ink, Night, Coral dusk, Violet, Lime court, Teal; text contrast checked in CI); alternate app icons (4 Pop variants; the disguised Calculator-style icon stays free, F-17); early access (opt in to features behind the `early_access` flag before they reach everyone); supporter badge ✦ on own profile (opt-in, off by default, `plus` gradient, label "Supporter").

### When Plus ends
- R-23.30 Nothing is deleted. Above-limit items stay until they end on their own: trips and plans run to their end, scheduled parties happen, live Moments expire normally, album media stays viewable and shareable but new uploads wait until under 1 GB ("Remove 1.2 GB to add more"), presets and folders stay visible and usable but no new ones, recurring parties stop creating new dates, Views list goes back to count only. Translation and extras turn off.
- R-23.31 Grace: a failed renewal (billing retry) keeps Plus for 16 days (Apple billing grace period, Google grace period set to the same).
- R-23.32 Refunds: a refunded purchase ends the entitlement at the store notification; nothing else happens to the account.

### Billing (built for open beta; specified now)
- R-23.40 **iOS**: StoreKit 2 (`Product.purchase(options: [.appAccountToken(uuid)])`, where `uuid` = a per-account random token stored on the server, never the account id). The app sends the signed `Transaction.jwsRepresentation` to `POST /v1/plus/verify`; the server verifies the JWS chain against Apple's root (no network call needed) and stores the entitlement. **App Store Server Notifications v2** to `POST /v1/plus/apple` (signed JWS, verified the same way) handle renewals, grace, expiry, refunds, revokes. App Store Server API (`GET /inApps/v1/subscriptions/{originalTransactionId}`) is used for the nightly reconcile.
- R-23.41 **Android**: Play Billing Library 7 (`obfuscatedAccountId` = the same token). The app sends `purchaseToken` to `POST /v1/plus/verify`; the server checks it with the Google Play Developer API (`purchases.subscriptionsv2.get`, `purchases.products.get`) with a service account, then acknowledges. **Real-time developer notifications** via Pub/Sub push to `POST /v1/plus/google` (OIDC-signed push, audience checked).
- R-23.42 **Restore purchases**: StoreKit `Transaction.currentEntitlements` / Play `queryPurchasesAsync`, each sent to `/v1/plus/verify`. A purchase already tied to another account moves to the restoring account only after a confirm sheet ("This purchase is used by another Thirstr account. Move Plus here?"); the old account keeps nothing.
- R-23.43 **Privacy**: the server stores product, store, original transaction id / purchase token hash, period end, state, storefront country (for tax only) and nothing about payment means. No third-party billing SDK (no RevenueCat), no analytics SDK. Apple / Google receipts never leave our server.
- R-23.44 **Nightly reconcile** (Oban job `PlusReconcile`, 03:30 UTC): re-checks active and grace entitlements with the store APIs; mismatches are fixed and counted (metric `plus_reconcile_fixed`).
- R-23.45 Prices, tax and invoices are the stores' (merchant of record). Revenue is read from the stores' reports into the cost dashboard (A-11) later.

## States
- Plus screen: beta · free (picker) · purchasing (button spinner, sheet stays) · pending (Ask to Buy / slow card: "Waiting for approval") · active (shows plan, renews / ends date, Manage) · grace (amber "Payment issue, fix in the App Store by ‹date›") · error (store message + Try again).
- Limit card: shown · hidden for 7 days.

## Data
- `accounts.plus_token uuid` (appAccountToken / obfuscatedAccountId).
- `plus_entitlements(id, account_id, store ios|android|grant, product, original_id_hash, state active|grace|expired|refunded|revoked, period_end, storefront, granted_by, reason, inserted_at, updated_at)`; one active row per account at most.
- `profile_views` (R-23.23).
- Server setting `plus_mode`: `beta_all` | `billing` (EN-13 flag table, row `plus_billing` on = billing).

## API
- `GET /v1/me` adds `plus: {active, source, product?, renews_at?, ends_at?, grace_until?}` and `limits: {nearby, distance_km, party_per_week, party_capacity, party_cohosts, party_recurring, trips, look_around_any_city, tonight_active, moments_per_day, moments_live, moments_48h, album_bytes, video_seconds, translate, friend_alerts, filter_presets, chat_folders, extras, views_list}`. The app reads every limit from here.
- `GET /v1/me/views` → `{count_7d, items?: [Card + {at}]}` (`items` only with Plus).
- `POST /v1/profiles/:id/viewed` (R-23.21, idempotent per 24 h; 204 also when nothing is recorded, so the response tells nothing).
- `DELETE /v1/me/views/:profile_id`.
- `POST /v1/plus/verify`, `POST /v1/plus/apple`, `POST /v1/plus/google` (R-23.40–42).
- Errors at a limit: 422 `{error: "plus_limit", limit: "<key>", free: n, plus: m, next_at?}`; the app shows the limit card (R-23.16). Old builds get the existing `validation` / `rate_limited` shapes they understand when they don't send `X-Thirstr-Plus: 1`.

## Privacy
- Nothing about Plus is shared with others (R-23.19). Views are opt-in both ways and never record Hidden people. Purchases carry a random token, not the account id. No billing SDK.

## Acceptance criteria
- AC-23.1 With `plus_mode = beta_all`, every account's `/me` has `plus.active = true, source = beta` and the top row of every limit.
- AC-23.2 With billing on, a Free account gets item 201+ never from `GET /explore/grid` (cursor stops, `more: false, capped: true`); the map endpoints return the same people as for Plus.
- AC-23.3 Free host: second party within 7 days → 422 `plus_limit` `party_per_week` with `next_at`; capacity 11 → 422 `party_capacity`. Plus host: capacity 40 ok, 41 refused.
- AC-23.4 Safe Mode on → `source = safe_mode`; off → back to Free (or store).
- AC-23.5 A Hidden viewer never creates a `profile_views` row; Views Off on either side creates none; block deletes rows both ways.
- AC-23.6 Plus ending never deletes a trip, plan, party, Moment, album item, preset or folder (test each).
- AC-23.7 No Plus prompt renders on chat, safety, onboarding screens or in the first 3 days (UI test).
- AC-23.8 Apple and Google notifications with a bad signature / wrong audience → 401, no state change.

## Build status
- **Server, done (PR for #7):** `Thirstr.Plus` (sources R-23.1–4, limits R-23.5), `plus` + `limits` on `/me`, `plus_billing` flag (off), table `plus_entitlements`, 422 `plus_limit` (R-23.16). Enforced now: nearby list 200, Tonight plans, trips, party capacity / 1 a week / co-host, Moments live + per day.
- **Reported in `limits`, enforced with the app work:** distance 300 km (needs a candidate-query load test first, SR), look around any city, Moments 48 h, album bytes, video length, translation, friend alerts, presets, folders, extras, Views.
- **Next:** app screens S-90 / limit cards / "+" tags (after mockup OK), Views S-91, presets + folders + extras, billing R-23.40–45 before open beta.
