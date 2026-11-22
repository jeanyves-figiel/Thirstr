# Runbook: certificate pinning + Play Integrity setup (#168)

## Pinning (app)
`apps/mobile/plugins/with-cert-pinning.js` pins `api.thirstr.fun` and `staging.thirstr.fun` (plus the build's `EXPO_PUBLIC_API_URL` host when it is a `*.thirstr.fun` https host) to **CA public keys**, never to our leaf certificate (Fly renews the Let's Encrypt leaf every ~60 days).

| Pin | Why | Valid to |
|---|---|---|
| ISRG Root X1 (RSA) | today's RSA chain | 2035 |
| ISRG Root X2 (ECDSA) | today's ECDSA chain | 2040 |
| ISRG Root YR (RSA) | Let's Encrypt "Gen Y" roots; chains move to them in 2026–27 and phones that trust them directly stop at them | 2045 |
| ISRG Root YE (ECDSA) | same | 2045 |
| GTS Root R1 / R4 | backup CA not in use: we can move the certificate off Let's Encrypt without an app update | 2036 |

Checked 2026-11-21: all four Thirstr hosts have Let's Encrypt certificates (Fly GraphQL `certificates { certificateAuthority }` = `lets_encrypt`, RSA + ECDSA). The Gen Y keys were taken from `letsencrypt.org/certs/gen-y/root-y{r,e}.txt` and checked against each certificate's Subject Key Identifier.

Recompute a pin: `openssl x509 -in root.pem -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64`.

- iOS: `NSAppTransportSecurity › NSPinnedDomains` (system TLS for `URLSession`/`fetch`; iOS 14+). No expiry, so the set must always contain the CA we use **and** a backup.
- Android: `res/xml/network_security_config.xml`, pin-set `expiration="2028-06-30"`: after that date Android stops enforcing it (fails open, never bricks the app). Renew the date and ship before then. Cleartext only for `localhost` / `10.0.2.2` / `127.0.0.1` (Metro, DEV).
- Web never pins. DEV (`localhost:7443`) isn't pinned.

**Before changing the CA or the hosting** (Cloudflare, another provider, custom certificate): check the new chain contains one of the pins. If not, first ship an app build with the new pin, wait until the forced-update minimum (`min_build`, EN-14) is past it, then switch.

**If pinning ever blocks real users** (wrong chain served): fix the chain on the server side first (Fly cert re-issue). Emergency app build without pins: `THIRSTR_CERT_PINNING=off` in the iOS/Android build env, then raise `min_build`.

## Play Integrity (owner, console, once; needs the Play Console app)
1. Google Cloud console › project for Thirstr (same as Google sign-in/FCM) › enable **Google Play Integrity API**. Note the **project number**.
2. Play Console › Thirstr › Test and release › App integrity › Play Integrity API › **Link** that Cloud project.
3. Cloud console › IAM › Service accounts › create `play-integrity` (no project roles) › Keys › JSON. Play Console › Users and permissions: not needed for decode.
4. `fly secrets set -a thirstr-api-<env> PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON="$(cat key.json)"` (staging and prod). Optional `PLAY_INTEGRITY_CERT_SHA256=<base64 app signing cert SHA-256>` (Play Console › App signing).
5. Android build env: `EXPO_PUBLIC_PLAY_CLOUD_PROJECT_NUMBER=<project number>` (public, not a secret).
Until 4 and 5 exist, Android devices simply don't attest; on staging/prod they can't get verified (#270), which is the intended state while there is no Android build.

Key rotation: yearly, `docs/runbooks/access.md` §3.
