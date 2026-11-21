# Runbook: transactional email (sign-in links, #26)

Only email Thirstr sends: magic sign-in links (F-01 R-01.3) and the "add sign-in email" link (RF-7). Plain text, no tracking pixels, no link rewriting. The address is used once and forgotten (only a peppered hash is kept).

| What | Value |
| --- | --- |
| DEV | Mailpit (`docker compose`, UI https://localhost:7443 › mail) |
| Staging / prod | **Amazon SES**, region **`eu-central-2` (Zurich)**, same AWS account as the owner's other app (owner's pick 2026-11-21, replaces Brevo). That account is out of the SES sandbox in Zurich (50k/day, 14/s); Frankfurt is still sandbox, don't use it. SMTP `email-smtp.eu-central-2.amazonaws.com:587`, STARTTLS, certificate + hostname verified. AWS DPA (GDPR) applies |
| Sender | `MAIL_FROM` (default `hello@thirstr.fun`) |
| Off switch | no `SMTP_HOST` → email sign-in is not delivered on that env (Apple, Google, passkeys still work) |

## Amazon SES specifics (state 2026-11-21)
- Identity `thirstr.fun`: verified, Easy DKIM RSA-2048 (3 `…._domainkey` CNAMEs in GoDaddy).
- Custom MAIL FROM `bounce.thirstr.fun`: MX `10 feedback-smtp.eu-central-2.amazonses.com` + TXT `v=spf1 include:amazonses.com ~all` on `bounce`. Apex SPF (ImprovMX) and existing DMARC (`p=quarantine`) unchanged; DMARC passes via aligned DKIM.
- No tracking (no configuration set with open/click tracking).
- SMTP credentials: the SES console now steers to paid **Mail Manager** endpoints; don't use them. Use the classic **IAM SMTP** path: one IAM user per env (`thirstr-ses-smtp-staging`, `thirstr-ses-smtp-prod`), inline policy only:
  ```json
  {"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"ses:SendRawEmail",
    "Resource":"arn:aws:ses:eu-central-2:<account>:identity/thirstr.fun",
    "Condition":{"StringEquals":{"ses:FromAddress":"hello@thirstr.fun"}}}]}
  ```
  Access key → SMTP password derived for `eu-central-2` (AWS "SMTP password from secret key" algorithm, region-specific).
- Staging: secrets staged 2026-11-21. Prod: IAM user + secrets still to do (after staging test).

## Setup (per env)
1. Owner's AWS account (GDPR DPA is part of the AWS service terms).
2. Authenticate `thirstr.fun` (records above). Add DMARC: `_dmarc` TXT `v=DMARC1; p=quarantine; rua=mailto:hello@thirstr.fun`.
3. Set secrets (never in git):
   ```sh
   fly secrets set --stage -a thirstr-api-<env> SMTP_HOST=email-smtp.eu-central-2.amazonaws.com SMTP_PORT=587 SMTP_USER=<access key id> SMTP_PASSWORD=<derived SMTP password>
   ```
4. Check: request a link from the app on that env; it arrives from `hello@thirstr.fun`, passes SPF/DKIM/DMARC ("Show original" in Gmail).
