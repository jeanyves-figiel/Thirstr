# Two-person rule and code owners (EN-22, #181)

## Now (closed beta, one person)
- One owner, Jean-Yves, holds every account and approves every prod promotion explicitly.
- `.github/CODEOWNERS` names him everywhere; it only auto-requests review. Branch protection keeps **Require review from Code Owners off**: with one person it would block every PR.
- Prod changes are already logged: each **Promote to production** run records the image digest, who ran it and when (Actions history), and `CHANGELOG.md` says what changed.
- Admin console two-person rules degrade to owner self-approval with a mandatory reason (admin-console.md R-AD.12).

## When the second engineer joins (open beta)
Turn on, the same day:
1. Branch protection on `main`: require 1 approving review, **Require review from Code Owners**, dismiss stale approvals, require status checks (CI), no force push, include administrators.
2. `CODEOWNERS`: add the engineer to the default `*` line. Infra/security paths keep the owner: any change there needs the **other** person's approval (author can't approve their own PR).
3. GitHub `production` environment: required reviewer = both, "Prevent self-review" on. A promotion then needs the other person's click.
4. Admin console: re-enable R-AD.3 (JIT elevation needs a second admin) and A-09 two-person actions.
5. Auto-merge on green stays for non-owned paths only.

## What counts as a two-person change
Paths marked in `CODEOWNERS` (CI/workflows, `infra/`, `scripts/`, migrations, retention, auth, crypto in `core/`, router and plugs, runbooks, team docs, security spec), plus anything that:
- touches prod data by hand (SQL, rpc writes, restores),
- creates, rotates or widens a secret, token or account role,
- changes who can see location, photos or chats.

## Exceptions
Emergencies use break-glass (`docs/runbooks/break-glass.md`): act alone, review after, within 1 working day.
