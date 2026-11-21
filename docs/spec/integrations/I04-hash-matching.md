# I-04 Hash matching of public images (CSAM)

Requirements: F-15 R-15.40–R-15.50. Issue #179 (EN-20). Owner decision 2026-11-21: Microsoft PhotoDNA Cloud Service, applied for by the owner ([application answers](I04-photodna-application.md)); pluggable until keys arrive.

## Contract
```elixir
@callback match(storage_key :: String.t(), bytes :: binary()) ::
            {:no_match, meta :: map()}
            | {:match, meta :: map()}        # meta: provider, list/source, match id, tracking id
            | {:unchecked, meta :: map()}    # Noop only
            | {:error, reason :: term()}     # timeout, 5xx, 429, bad key
```
`Thirstr.Moderation.HashMatch.check(key)` (the only caller entry):
1. Reads the object (≤ 15 MB, already enforced by upload limits), computes SHA-256.
2. Internal blocklist (`hash_blocklist` table, sha256 → case id): hit → `{:match, %{provider: "internal"}}`, no vendor call.
3. Calls `impl().match/2` with a 3 s timeout, 2 retries with jitter on `:error`.
4. Writes `photos.hash_state` / `moments.hash_state` (`no_match | match | unchecked | retry`), `hash_checked_at`, `hash_provider`.

## Providers
| Provider | Config | Behaviour |
|---|---|---|
| `noop` (default staging/prod until keys) | `HASH_MATCH_PROVIDER=noop` | `{:unchecked, %{}}`; backfill later (R-15.46) |
| `dev` (DEV/test) | `HASH_MATCH_PROVIDER=dev` | key ending `-hashhit` → match, `-hasherror` → error, else no_match |
| `photodna` | `HASH_MATCH_PROVIDER=photodna`, secrets `PHOTODNA_KEY`, `PHOTODNA_URL` | PhotoDNA Cloud Service Match call (below) |

### PhotoDNA Cloud Service (what is public)
- REST, subscription key in header (`Ocp-Apim-Subscription-Key`). Endpoint, body and response fields come from the developer portal after vetting; the adapter is written against the portal spec when keys arrive and tested in Microsoft's integration environment (benign images that simulate a hit). Until then `photodna.ex` stays a stub that returns `{:error, :not_configured}` (fail-closed).
- Still images only (no video). Images are hashed on Microsoft's side and **not stored** (Microsoft FAQ).
- Free with a monthly transaction cap; 30-day subscription term, renewed; no SLA, can throttle → our fail-closed retry (R-15.43) and the `retry` alert are required, and a counter of monthly calls is shown in A-12 against the cap.
- Use is limited to CSAM prevention; internal use only (no managed service for others).
- We send the card-size copy when it exists (≤ 480 px JPEG, SR-10) and the full image only if Microsoft requires a minimum size — to be confirmed on the portal.

## Data flow
Server → PhotoDNA: image bytes over TLS, no user id, no metadata. PhotoDNA → server: match flag + match details. Nothing else leaves. Listed in I-03 table and RoPA.

## Failure handling
- `:error` → `hash_state = retry`, photo stays `pending` (not visible), Oban job `HashRetry` every 2 min up to 30 min, then A-03 queue with "hash check failed" chip. Alert at > 20 in `retry`.
- Bad/expired key (401/403) → Sentry error + owner alert once per hour; behaves like `:error`.
- Kill switch `hash_match` (EN-13 flags): off = `noop` behaviour (only for an outage decision by the owner, audited).

## Tests
`hash_match_test.exs`: dev hit quarantines + opens case; error keeps pending; noop publishes unchecked; blocklist hit skips provider (Mox expects 0 calls); backfill picks only `unchecked`.
