# Threat model & security plan

Method: STRIDE per asset + attacker profiles. Owner: security lead. Review before each milestone.

## Assets (by sensitivity)
| Asset | Where | Sensitivity |
|---|---|---|
| Sexual orientation (= account existence) | everywhere | GDPR Art. 9 |
| Location (cells, exact pins) | Postgres/Valkey | critical |
| Messages, media, albums | device (CT on server) | critical |
| Health fields | device / E2EE | critical |
| Verification credential | server (blind-signed) | high |
| Public profile + photos | server/CDN | medium (public by intent, still Art. 9) |
| Auth keys, refresh tokens | device keystore | high |

## Attackers
| ID | Attacker | Goal | Key mitigations |
|---|---|---|---|
| A1 | Stalker / ex-partner | locate a person | cell-only location, k-anon, jitter, TTL pins, hide-from-hidden, account-level block, velocity checks |
| A2 | Police in hostile country | identify/entrap gay users | Safe Mode, verified-only visibility, no server country lists, duress PIN, disguised icon, minimal server data |
| A3 | Bot/scam operator | mass spam, extortion | verification, attestation, quarantine, rate limits, first-message link block |
| A4 | Data broker / advertiser | harvest data | zero SDKs, no ads, no IDs in logs, anti-scrape (attested clients, rate limits) |
| A5 | Malicious insider | read data | E2EE, least privilege, audited moderator access, no plaintext chats exist |
| A6 | Server breach | dump DB | nothing sensitive in plaintext; hashed identifiers; exact pins not persisted |
| A7 | Legal compulsion | user data | warrant canary, transparency report, minimal retention ⇒ little to hand over; beta host Fly.io is US-owned (CLOUD Act): E2EE + no plaintext sensitive data, keys in EU KMS; reassess before public launch |
| A8 | Device seizure | read phone | app lock, SQLCipher, duress PIN/decoy, panic wipe, disappearing messages |
| A9 | Scraper with real accounts | build profile dataset | attestation, per-account view caps (300 profiles/h), random pagination tokens, no public web profiles |

## Key management
- Account root key: generated on device, stored in Secure Enclave/StrongBox; never leaves except as recovery phrase (user-held).
- Device keys: per device, attested at registration (see Device attestation).
- MLS: OpenMLS, ciphersuite `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`; key packages rotated; forward secrecy + post-compromise security via commits ≥ weekly.
- Media: per-file AES-256-GCM key in MLS message; album keys rotated on revoke.
- Server secrets: Vault/sealed secrets; pepper for hashes in HSM-backed KMS (EU).
- TLS 1.3 only, HSTS, certificate pinning in app (backup pins).

## Device attestation (#25)
- **iOS App Attest** (`@expo/app-integrity`, entitlement `com.apple.developer.devicecheck.appattest-environment = production`). After sign-in, on app start and on return to foreground, at most once per 24 h (retry after 6 h on failure), foreground only:
  1. `POST /devices/attest/challenge` → 32 random bytes, base64url, single use, 5 min, bound to the device.
  2. First time on this install: Secure Enclave key (`generateKey`) → `attestKey(keyId, challenge)` → `POST /devices/attest`. Server (`Thirstr.AppAttest`) checks: CBOR `fmt = apple-appattest`; x5c chain to the **Apple App Attestation Root CA** (`server/priv/certs`, SHA-256 1CB9823B…C932) incl. validity; nonce extension `1.2.840.113635.100.8.2` = SHA-256(authData ‖ SHA-256(challenge)); key id = SHA-256(public key) = credential id; RP id hash = SHA-256(`<TeamID>.app.thirstr`); counter 0; aaguid `appattest` (production) or `appattestdevelop` (refused when `DEPLOY_ENV` is prod). Stores the public key (never a private key), counter, `attestation_ok`, `attested_at`.
  3. Later days: `generateAssertion(keyId, challenge)` → `POST /devices/assert`: ECDSA P-256 signature over SHA-256(authData ‖ SHA-256(challenge)) with the stored key, same RP id, counter strictly greater. Refreshes `attested_at`. A failed assertion makes the app create and attest a new key.
- A device counts as **attested** when `attestation_ok` and `attested_at` < 7 days old (`DeviceAttest.attested?/1`).
- **Beta: soft.** Nothing is blocked for unattested clients (Android has no build yet, web is a DEV tool). Enforcement (rate caps for unattested devices, F-15 signal `unattested`) follows once Play Integrity ships.
- Android Play Integrity: with the Android build (needs a Google Cloud project number).

## Controls checklist (beta gate)
- [ ] Dependency scanning + SBOM in CI; Renovate.
- [ ] SAST (Sobelow for Phoenix, ESLint security, cargo-audit).
- [ ] Secrets scanning on GitHub.
- [ ] Logs: no account IDs, no IPs (hashed 24 h), no message metadata beyond counters.
- [ ] Rate limits + attestation enforced at gateway.
- [ ] Backups encrypted, EU-only, 30 d.
- [ ] Admin access via hardware keys (FIDO2) + just-in-time grants.
- [ ] External pentest + crypto audit (MLS integration, verification protocol) before public beta.
- [ ] Bug bounty (private) at closed beta.
- [ ] Incident response runbook; 72 h GDPR breach notification.

## Abuse tests (automated, see testing.md)
- Trilateration harness (A1), scraping harness (A9), quarantine invisibility (A3), Safe Mode leak checks (A2), log PII grep (A4/A6).
