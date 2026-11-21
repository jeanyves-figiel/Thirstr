# Off-boarding (EN-22, #181)

Same day the person leaves, or within 1 hour for an unfriendly exit. Copy into an issue `Offboard <first name>` (label `team`), work from their on-boarding issue's access list.

## Remove access
- [ ] GitHub: remove collaborator; remove from `CODEOWNERS`, `production` environment reviewers; revoke any deploy keys or PATs they created.
- [ ] Fly.io: remove from org; `fly tokens list` → revoke any token they made.
- [ ] Admin console: disable account (sessions end at once).
- [ ] Pushover: remove from the on-call group; if their key was `PUSHOVER_ESCALATION_KEY` / `PUSHOVER_USER_KEY`, replace the secret.
- [ ] App Store Connect, Play Console, AWS IAM: remove user; deactivate their access keys.
- [ ] Shared chats, calendars, password-manager shares.

## Rotate what they could have seen
Rotate if they had prod shell or saw the value; when unsure, rotate.
- [ ] Fly deploy token (`FLY_TOKEN` GitHub secret) and metrics token.
- [ ] `SECRET_KEY_BASE`, DB and Valkey passwords (`fly.md` › Secrets › Rotate).
- `ID_PEPPER`: rotating changes derived ids; only if it leaked, with a written migration plan.
- [ ] App Store Connect API key (`ASC_KEY_*`) if they had it.
- [ ] Pushover app token.
- Backup cipher pass: do **not** rotate casually (old backups need the old pass); note it, rotate at the next full backup per `db-backups.md`.

## Hand over
- [ ] Their open PRs and issues reassigned.
- [ ] On-call rotation updated; back to solo if they were the only other person (`on-call.md`), turn Code Owners review off if it would block (`two-person-rule.md`).
- [ ] Note in the issue: date, what was removed, what was rotated. Close it.
