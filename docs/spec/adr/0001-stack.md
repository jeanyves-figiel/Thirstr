# ADR 0001 — Backend & client stack for beta

Status: **accepted** (owner picked Elixir / Phoenix, 2026-11-17) · Closes #1.

## Context
- Workload is dominated by: live presence (who is around, Now, Tonight), map/grid queries by H3 cell, E2EE message relay, push wake-ups, media blob storage. Little complex business logic.
- Constraints: privacy-by-design (server knows little), EU hosting, zero third-party SDKs/trackers, worldwide launch, DEV on `localhost:7443`, trunk model (main → staging auto-deploy → manual prod promote).

## Decision

### Backend
| Concern | Choice | Why |
|---|---|---|
| API + realtime | **Elixir / Phoenix** (REST for CRUD, Phoenix Channels over WebSocket for realtime, Phoenix Presence for online/Now) | Millions of concurrent sockets per cluster, built-in presence CRDT, fault tolerance. Alternatives: Go (more plumbing), Node (weaker concurrency). |
| E2EE delivery | **MLS (RFC 9420)** via OpenMLS (Rust) on clients; server = MLS Delivery Service + key-package directory (Elixir, stores ciphertext only) | Groups, multi-device, forward secrecy. |
| Primary DB | **PostgreSQL 16** + `h3-pg` extension | Profiles, cells, parties, clubs; H3 k-ring queries in SQL. |
| Ephemeral store | **Valkey** (Redis-compatible, BSD) | Exact pins (TTL, never persisted: `save ""`, no AOF), rate limits, presence fan-out, check-in timers. |
| Object storage | S3-compatible in EU (Scaleway / OVH / Hetzner) | Public photos (plaintext, CDN) and E2EE media blobs (ciphertext). |
| CDN | EU CDN in front of public photo bucket; signed URLs | Grid speed. |
| Jobs | Oban (Postgres-backed) | Expiry sweeps, moderation queue, push. |
| Push | Direct APNs + FCM, content-free payloads | No push vendor SDK. |
| Moderation ML | Self-hosted image classifier (GPU node) for public photos; PhotoDNA-style hash list for CSAM | No third-party content exposure. |
| Search/filters | Postgres (GIN on flag arrays) | Enough for beta. |
| Observability | OpenTelemetry → self-hosted Grafana/Loki/Tempo; **no user IDs in logs**, IP hashed 24 h | Privacy. |
| Infra | Docker; **Fly.io EU regions** (beta, D-03); GitHub Actions; Hetzner k3s as exit path | Matches trunk model; native Elixir clustering. |

### Client
| Concern | Choice |
|---|---|
| App | **React Native (Expo, bare workflow)**, TypeScript |
| Shared core | **Rust** crate via UniFFI: MLS (OpenMLS), H3, SQLCipher storage, media encryption, link-preview fetcher |
| Maps | **MapLibre GL** + self-hosted Protomaps vector tiles (no Google/Apple map tracking) |
| Liveness / AI photo check | On-device models (Core ML / TFLite) |
| Passkeys | Platform APIs (ASAuthorization / Credential Manager) |
| Attestation | App Attest (iOS), Play Integrity (Android) |

### Environments
| Env | Where | Deploy |
|---|---|---|
| DEV | `localhost:7443` via `docker compose` (Caddy, Phoenix, Postgres+h3, Valkey, SeaweedFS S3, Mailpit, mock push, tiles) | local |
| Staging | Fly.io EU | auto on squash-merge to `main` |
| Prod | Fly.io EU | manual "Promote to production" workflow, same image, owner OK per change |

## Amendments
- 2026-11-17: DEV object storage is **SeaweedFS** (S3 API, Apache-2.0): MinIO stopped publishing community Docker images. Staging/prod use Tigris via Fly (bucket per env).

## Consequences
- Elixir hiring pool smaller than Go/Node; mitigated by small backend surface.
- Rust core shared iOS/Android keeps crypto in one audited place.
- Self-hosted tiles/ML add ops work; accepted for privacy.

## Alternatives considered
- **Go**: strong; presence/fan-out hand-built. Fallback if Elixir rejected.
- **TypeScript/Node**: one language across stack; weakest for 1M+ sockets.
- **Firebase/Supabase**: rejected (third-party data processor, tracking SDKs, US jurisdiction).
- **Flutter**: viable; RN chosen for ecosystem + web reuse.
