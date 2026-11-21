# I-03 Platform services

| Service | Use | Data shared | Rules |
|---|---|---|---|
| APNs / FCM | wake-up push | opaque token only | content-free payloads (F-16) |
| Passkeys (iCloud Keychain / Google Password Manager) | auth | WebAuthn public key | F-01 |
| Sign in with Apple / Google | auth | id_token → hashed sub (Google: `openid` only, PKCE, iOS client in GCP project `thirstr`; consent screen in Testing until published) | F-01 R-01.2 |
| App Attest / Play Integrity | anti-bot | attestation blobs | F-15 R-15.2 |
| MapLibre + self-hosted Protomaps tiles | maps | tile requests to our CDN (no user id) | no Google/Apple Maps SDK |
| Self-hosted image classifier | photo moderation | public photos only | F-15 R-15.10 |
| Age-assurance vendor (zero retention) | fallback age check | per-session boolean | F-03 R-03.3; vendor DPA required |
| App Store / Google Play | distribution, IAP (Plus, later) | store receipts | rating 17+/18+; public photos per F-15; explicit only in E2EE private content |
| Email sender (EU, transactional) | magic links | email address in transit only | no tracking pixels/links |

## Store compliance checklist
- R-I03.1 Apple 1.1.4 / Play sexual content: public surfaces non-explicit; private E2EE content user-to-user with report + block (Apple 1.2 UGC).
- R-I03.2 Age rating 17+ (iOS) / Mature 18+ (Play); age gate + verification.
- R-I03.3 Account deletion in-app (Apple 5.1.1(v)).
- R-I03.4 Privacy nutrition labels: "Data not linked to you" where applicable; no tracking.
- R-I03.5 Disguised icons via alternate app icons API (iOS) / activity-alias (Android); allowed names must not impersonate other apps' branding.

## Forbidden
No analytics SDKs, ad SDKs, attribution SDKs, crash reporters that send PII (use self-hosted Sentry-compatible with scrubbing), no Firebase Analytics, no Facebook SDK.
