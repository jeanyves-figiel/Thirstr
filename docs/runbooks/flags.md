# Runbook: feature flags, kill switches, minimum app build (EN-13 #172, EN-14 #173)

Server-driven, no third-party service. Table `feature_flags`; every node re-reads it within 30 s; apps re-read `GET /v1/config` at start and on each foreground (offline: last known value).

## Kill a feature now
```sh
fly ssh console -a thirstr-api-prod -C "bin/thirstr rpc 'Thirstr.Flags.set(\"video_check\", false, %{}, \"kill: <reason>\")'"
```
Back on: `Thirstr.Flags.delete("video_check")` (falls back to the default, on).

## Ship dark, then roll out
```elixir
Thirstr.Flags.set("new_thing", true, %{"platforms" => ["ios"], "min_build" => %{"ios" => 140}, "percent" => 10})
```
`percent` is stable per install (same phone, same answer). Raise it step by step; watch crash-free sessions and errors (monitoring.md).
Known flags and their defaults: `Thirstr.Flags.defaults/0` (add a name there before app code reads it).

## Force an update
```elixir
Thirstr.Flags.set("min_build", true, %{"ios" => 140, "android" => 0})
```
Builds below get HTTP 426 on every call (except `/v1/config`, `/v1/health`) and the app shows "Time for an update" with the store link (`IOS_STORE_URL` / `ANDROID_STORE_URL`). Builds that send no build number (before EN-14, web) are not blocked. Only raise `min_build` once the new build is live in the store for everyone (phased release complete).

## Rules
- Every change: one line in the CHANGELOG or the incident log (who, why).
- Never use a flag to hide personal data handling from users; flags switch features, not consent.
