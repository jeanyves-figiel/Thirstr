# Runbook: incident response (EN-07, #166)

Applies to staging and prod. Beta team = the owner; roles below are hats one person can wear until more people join (EN-06, EN-22).

## 1. Severity
| Sev | Examples | Response | Comms |
|---|---|---|---|
| **SEV1** | Prod down or chats not delivering for most users; data exposed or suspected breach; safety alerts (check-in, SOS) not delivered; location precision leak | start now, any hour | in-app / status within 30 min, update every 60 min |
| **SEV2** | One feature broken for many (photos, push, Explore), p95 > 2 s for 30 min, backups failing > 26 h | within 1 h (waking hours) | status if users notice |
| **SEV3** | Minor bug, one platform, workaround exists | next working day | GitHub issue only |

Any suspected **personal data breach** (Art. 4(12) GDPR: unauthorised access, loss, disclosure) is SEV1 until shown otherwise.

## 2. Roles
- **Incident commander (IC)**: owns the incident, decides, keeps the timeline. Default: owner.
- **Ops**: hands on Fly / DB / code. Can be the IC in a one-person team.
- **Comms**: user-facing messages (§5).

## 3. First 15 minutes
1. Open a GitHub issue `INCIDENT <date> <short title>`, label `incident`, sev in the title. Timeline goes in comments (UTC times).
2. Stop the bleeding, cheapest first:
   - Bad release → "Promote to production" with the previous image digest (`docs/runbooks/fly.md`).
   - Bad feature → kill switch (`docs/runbooks/flags.md`), takes effect within 30 s server side, at next app foreground on phones.
   - Bad old app build → raise `min_build` (forced update).
   - Abuse / scraping → rate limits, block account(s) in the admin console.
   - DB damage → point-in-time restore (`docs/runbooks/db-backups.md`). Never restore over prod without the owner.
3. Check dashboards and alerts (`docs/runbooks/monitoring.md`), `fly logs -a thirstr-api-prod`, app crash groups (monitoring.md › App crashes).
4. Preserve evidence for a breach: do not delete logs or machines; snapshot the DB volume (`fly volumes snapshots create`).

## 4. Personal data breach (GDPR Art. 33/34, Swiss FADP Art. 24)
Clock starts when we are **aware** a breach likely happened.
1. Within **24 h**: assess what data, how many people, which countries, likely consequences. Thirstr data is treated as special category (sexual orientation, Art. 9), so most breaches are high risk.
2. Within **72 h**: notify the lead supervisory authority (EU) and the FDPIC (Switzerland, "as soon as possible") unless the breach is unlikely to result in a risk. Content: nature, categories and approx. numbers, contact point, likely consequences, measures taken. Partial notice is allowed; complete later.
3. **Without undue delay**: tell affected users when risk is high (Art. 34): plain language, what happened, what they should do (e.g. change email password, check devices), what we did. In-app + email.
4. Record **every** breach, notified or not, in `docs/incidents/` (facts, effects, remedial action). Art. 33(5).
5. Data processors (Fly.io, Tigris, email provider) must tell us without undue delay; check their DPAs (#23).

End-to-end content (chats, private albums, safety envelopes) is ciphertext on our side; say so precisely, never overclaim.

> Legal: authority, deadlines and wording to be confirmed by counsel (#9, EN-11) before public launch.

## 5. Comms templates
**In-app / status (outage):**
> We're having trouble with <messages / photos / Explore> since <HH:MM UTC>. Your chats are safe on your phone. We're on it; next update by <HH:MM UTC>.

**Resolved:**
> Fixed at <HH:MM UTC>. <What happened in one sentence.> <Anything users need to do, or "Nothing to do on your side.">

**Breach notice to users (Art. 34):**
> On <date> we found that <what> was <accessed / exposed> between <dates>. It concerned <data>. It did **not** include <chats and private albums, which are end-to-end encrypted> . We <fixed X, reset Y>. We recommend you <action>. Questions: <contact>. We reported this to <authority>.

Status page: EN-04 (#163). Until then: app store notes + email + in-app via the next build or kill-switch config.

## 6. Close and learn
- Incident is over when users are unaffected and the cause is contained.
- **Post-mortem within 5 working days** in the incident issue (blameless): summary, impact (users, duration), timeline, root cause, what went well, what didn't, actions. Each action = its own GitHub issue linked from the post-mortem, with an owner.
- Update the runbook that was missing or wrong.

## 7. Practice
- Yearly tabletop exercise (scenario: leaked DB backup, or SOS alerts not delivered), logged in `docs/incidents/`.
- Game days: EN-15 (#174).
