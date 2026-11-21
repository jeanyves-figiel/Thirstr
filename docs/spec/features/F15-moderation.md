# F-15 Moderation & anti-bot

## Anti-bot gate
- R-15.1 Verification required to be visible and to initiate (F-03).
- R-15.2 Device attestation on every session; emulator/rooted/jailbroken without attestation → read-only.
- R-15.3 Max 1 active account per verified human; 1 profile per account (F-06 R-06.1).
- R-15.4 Rate limits (api.md). New accounts (< 7 d): halved limits.
- R-15.5 Signals (metadata only): identical first-message hash across ≥ 5 recipients (client sends salted hash of first message, not content), link attempts in first messages, reply ratio < 5 % over 50 sends, 24/7 activity, location velocity, cell-hopping, copy-paste bios (server-side similarity on public bios).
- R-15.6 Score ≥ threshold → **shadow quarantine**: user sees normal UI, outbound taps/messages/visibility delivered to nobody. Review within 24 h.
- R-15.7 Community: "Bot / scam" one-tap report; 3 reports from distinct verified accounts with good reporter score in 24 h → immediate quarantine pending review.
- R-15.8 Creator profile type: accounts promoting paid content must self-declare; undeclared promotion → warning then quarantine. Creators hidden by default in filters.

## Content moderation
- R-15.9 Report flow (S-50): reason (spam/bot, scam/extortion, underage, harassment, non-consensual content, hate, impersonation, other) + optional franked messages/media + note. Block offered automatically.
- R-15.10 Public photo classifier (self-hosted): labels nudity levels; main photo must be "clothed/shirtless"; slots 1–4 allow underwear/suggestive, reject genitals/sex acts; Each photo also gets `main_ok` (strict pass); only those show in Friends and Sport (F-06 R-06.3). Borderline → human queue (SLA 12 h).
- R-15.11 Hash matching (CSAM list) on all public photos; positive → account banned + legal reporting.
- R-15.12 Bio/text: discriminatory phrases → write-time nudge; post-publish flag → hide field + warning.
- R-15.13 Human moderators: closed beta = owner only, EN/FR/DE. Public launch: regional coverage (EN, FR, DE, ES, PT, IT, AR, RU, TR). SLAs: underage/CSAM/violence 1 h, extortion 4 h, others 24 h. Beta compensating control: content auto-hidden on classifier match or ≥ 2 independent reports for severe reasons until reviewed.
- R-15.14 Actions: warn, hide field/photo, quarantine, suspend (1–30 d), ban (account + LSH face bucket, F-03 R-03.6). Every action has reason code + appeal (in-app, 1 appeal, reviewed by different moderator ≤ 72 h).
- R-15.15 Moderator tool: sees only reported content + public profile + metadata signals; no access to chats beyond franked reported messages; all access logged.
- R-15.16 Transparency report quarterly: reports by category, actions, bot-rate per 1k MAU, government requests.

## Hide, block, report everywhere (#111)
Owner feedback 2026-11-21: "moderation - option to hide/block/report". Mockup: [Hide, Block, Report](https://claude.ai/artifact/BcXqbMNne1uWyakLqfC67c) (option A, three tiles).
- R-15.17 **One safety sheet (S-21)** wherever you meet someone: profile ⋯, map pin long-press (R-04.14), grid tile long-press (F-04), 1:1 chat ⋯ (F-07 R-07.9) and Chats inbox long-press. Same three tiles in the same order and place every time: **Hide** (eye-off, `fg.secondary`, "Not shown to you"), **Block** (ban, `state.danger`, "No contact, both ways"), **Report** (flag, `state.warn`, "Tell Thirstr, anonymous"). Screen-specific rows go above (Explore: Open profile, Tap, Message; chat: View profile, Date check-in) or below (profile: Share, Vouch; inbox: Star, Mute, Archive, Delete; chat settings). Footnote: "‹Name› is never told you hid, blocked or reported. Settings › Hidden & blocked". Group chats and gone chats keep their own sheet without the tiles.
- R-15.18 **Hide**: one tap, no confirm. Removes the profile from the viewer's Explore (map pins, avatars, grid, header counts, R-04). Chats keep working. Toast "‹Name› hidden" with **Undo** for 5 s (DELETE /profiles/{id}/hide). Medium haptic.
- R-15.19 **Block**: confirm step in the same sheet: title "Block ‹Name›?", three points (you won't see each other anywhere; chat closes and taps are removed; they aren't told), red Block + Cancel. On success: toast "‹Name› blocked", the person leaves the current list, the chat is archived and a chat or profile screen closes. Not undoable from the toast (Settings only).
- R-15.20 **Report**: closes the sheet and opens S-50 with the context (profile, explore, chat + conversation id for franked messages). S-50 keeps "Also block" on by default (R-15.9).
- R-15.21 **Settings › Safety › Hidden & blocked (S-71)**: row shows hidden + blocked count. Screen: two tabs "Hidden · N" / "Blocked · N", one-line explanation per tab, rows newest first (photo, name, age, "today / N d ago / N w ago"), Unhide / Unblock pill; toast on success. Empty: "Nobody hidden/blocked" + "Hold anyone on the map, grid or in Chats to hide or block them."
- R-15.22 **Discoverability**: the grid shows a teal hint "Hold a tile for Hide, Block, Report" above the tiles until the first long-press on that device.

## DSA notice, statement of reasons and appeals (#170)
Status: **specified, waiting for the owner's mockup pick; not built.** Legal basis and gap analysis: [`../../legal/dsa.md`](../../legal/dsa.md) (draft, not legal advice). Mockup: [DSA flows](https://claude.ai/artifact/L7VFBJLiQv5Vysz3YN5M1M) (option A recommended).

### Notices (DSA Art. 16)
- R-15.23 **S-50 v2 reason list** adds a last reason **"It's illegal"** (danger flag icon, "Breaks the law where you are") and, under every other reason, a switch **"This may also be illegal"** (off). Either opens step 2. Other reasons keep today's one-step flow.
- R-15.24 **Step 2 "Illegal content" (S-50b)**: country (pre-filled from the phone region, changeable), type pick list (Child sexual abuse · Intimate images shared without consent · Threats or violence · Hate speech · Fraud or scam · Impersonation · Copyright or trademark · Something else), **"What's illegal about it?"** (free text 20–1 000 chars, required), what it is about (pre-filled context: profile, photo n, Moment, party, chat messages picked with franking), optional **"Tell us who you are"** (name + email; off by default; hidden for Child sexual abuse) and a required checkbox **"I believe this report is accurate and complete"**. Send → R-15.26.
- R-15.25 **Web form `thirstr.fun/report`** (W-xx, site, en/fr/de, no account, no third-party captcha): link to the content (share link `thirstr.fun/p/…` or party link; validated), type (same list), explanation (20–1 000), name + email (required unless Child sexual abuse), good-faith checkbox, proof-of-work challenge in the browser (~1 s) + 5 per IP-hash per day. Confirmation page + email (SES) with a reference `R-XXXX-XXXX`.
- R-15.26 **Receipt**: in app a sheet "Report received" with reference, "We'll tell you what we decide", Also block (on, as today). Severe types go to the top of the queue (R-AD.8).
- R-15.27 **Outcome to the notifier** (Art. 16(5)): when a moderator decides, the notifier sees it in **Account status › Your reports** (option A; option B = a "Thirstr" system chat) and gets one content-free push "Update on your report"; web notifiers get an email. Shows: date, what was reported (type + "a profile"/"a photo", never the person's name), decision (Removed · Restricted · Account suspended · No action: doesn't break our rules or the law), whether automated tools helped, **Ask for a review** until 6 months after (R-15.32).

### Statement of reasons (Art. 17)
- R-15.28 **Notice detail (S-86)** replaces the one-line card on Account status (S-70 › Notices from Thirstr) for every action, incl. a shadow quarantine once a person confirms it or after 24 h, and auto-hides from severe reports (R-15.13). Blocks, top to bottom: header (action colour + icon, "Your photo was removed", date); **What** (scope: which photo/field/Moment/party or the whole account; thumbnail blurred if a photo; duration "until 28 Nov, 14:00" or "permanent"); **Why** (rule name + one-line rule text + link to the Community rule; or the law and country when the ground is legal); **Facts** (moderator's 1–3 line note, required, picked from per-reason templates + free text); **How we decided** (three chips: "Found by: automatic check / report / our team", "Decided by: a person / automatically", "Reviewed by: —"); **What you can do** (Ask for a review · until ‹date + 6 months›; "Independent dispute bodies" link to the EU list; "You can also go to court"). Language = app language.
- R-15.29 Shadow quarantine based only on bot/spam signals (R-15.6) gets no notice while under review (DSA Recital 55, counsel to confirm); a person confirming it creates a normal S-86 notice with reason `spam_bot`.

### Appeals (Art. 20)
- R-15.30 **Ask for a review** (S-87 sheet): "What should we know?" (≤ 1 000), optional "Add a photo or file" (no, out of scope v1), Send. Open **6 months** from the decision, one per decision (409 after); free; also while suspended.
- R-15.31 Review by a person who did not take the decision; beta exception (owner only, D-12): the notice says "Reviewed again by a person". Target 72 h, overdue in A-05 after 48 h.
- R-15.32 **Notifier review**: on a "No action" outcome the notifier can ask for a review the same way (6 months, one per report). Web notifiers: link in the email to a review page (reference + email check).
- R-15.33 **Decision** updates the same S-86 card with a timeline (Decided · Review asked · Reviewed) and the reviewer's reason. Reversed → content/account restored at once, banner "We reversed our decision. Sorry about that." Upheld → out-of-court + court lines stay.

### Misuse, trusted flaggers, records
- R-15.34 Misuse (Art. 23): ≥ 5 reports in 30 d of which ≥ 80 % "No action" and ≥ 3 judged manifestly unfounded by a moderator → warning notice (S-86, reason `report_misuse`); repeat within 90 d → reports from this account are not handled for 30 d (accepted but marked low priority; still checked for Child sexual abuse). Same rule (manifestly illegal content) for posters → suspend after a prior warning.
- R-15.35 Trusted flaggers (Art. 22): `trusted_flagger` flag on web notifier emails/organisations set in A-09; their notices sort first in A-01.
- R-15.36 Data: `reports` gains `illegal bool`, `legal_type`, `country`, `explanation (1 000)`, `notifier_contact_enc` (encrypted, web/opt-in only, deleted with the report), `good_faith bool`, `channel enum(app, web)`, `ref`, `decision`, `decided_at`, `automated bool`, `notifier_review_state`; `moderation_actions` gains `ground enum(tos, law)`, `law_ref`, `facts (300)`, `detected_by enum(auto, report, staff)`, `decided_by enum(person, auto)`, `appeal_until`, `reviewed_by_other bool`. Transparency counts (R-AD.10) read these. API: `GET /me/reports` (outcomes), `POST /me/reports/{id}/review`, `POST /public/notices` (web form), `POST /public/notices/{ref}/review`. Retention as `reports` (1 y; notifier contact deleted with it).

### Acceptance (DSA)
- AC-15.6 An S-50 "It's illegal" report without explanation or good-faith tick is rejected (422).
- AC-15.7 Every action except signal-only quarantine creates a notice with ground, facts, detected_by, decided_by and appeal_until = decided_at + 6 months.
- AC-15.8 A notifier sees the outcome of each report and can ask for one review within 6 months; the reported person's name is never shown in the outcome.
- AC-15.9 The web form works without an account and without third-party scripts (CSP test).

## Acceptance criteria
- AC-15.1 Quarantined account receives HTTP 200 on sends; recipients receive nothing.
- AC-15.2 Moderator UI cannot open a chat that wasn't reported (permission test).
- AC-15.3 Bot-rate KPI computed daily.
- AC-15.4 (#111) Hide then GET /me/hidden lists the profile; unhide removes it and the profile returns to the viewer's grid (server test `explore_test.exs`).
- AC-15.5 (#111) Safety copy exists in en/fr/de with identical keys (`moderation-i18n.test.ts`).
