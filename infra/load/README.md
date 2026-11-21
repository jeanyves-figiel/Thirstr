# Load test (SR-12, #152)

k6 scenarios against a **dedicated load environment** (`DEPLOY_ENV=load`), never staging or prod (`Thirstr.LoadTest` refuses both).

| Scenario | What | Threshold |
|---|---|---|
| `grid` | `GET /v1/explore/grid` page 1, then page 2 (cached order, SR-09) | p95 < 300 ms |
| `chat` | send (`POST /v1/mls/messages`, 256 B ciphertext) → recipient pull → ack | send p95 < 500 ms |
| `sockets` | `user:me` channel join + 30 s heartbeat, held `SOCKET_HOLD_S` | — |
| all | | errors < 0.1 % |

Targets (testing.md): 100k sockets, 5k grid req/s, 20k msg/s per cluster. Run in steps (×2 each) and note where p95 or errors break.

## Run
```sh
# 1. load env: same image as prod, own DB/Valkey/bucket, DEPLOY_ENV=load, seeded
fly ssh console -a thirstr-api-load -C "bin/thirstr eval 'Thirstr.Release.seed(100_000)'"
# 2. accounts (verified, located near the seed city centres; tokens live 15 min)
fly ssh console -a thirstr-api-load -C "bin/thirstr rpc 'Thirstr.LoadTest.users(2000) |> IO.puts()'" > users.json
# 3. run (from a machine in the same region, e.g. a Fly machine with grafana/k6)
k6 run -e BASE=https://thirstr-api-load.fly.dev -e GRID_RPS=500 -e MSG_RPS=500 -e SOCKETS=5000 -e DURATION=10m thirstr.js
```
Locally (DEV): `mix run -e 'File.write!("users.json", Thirstr.LoadTest.users(60))'`, then `k6 run -e BASE=http://localhost:4000 …`.

Chat sends count against the per-account limit (600/h): use ≥ `MSG_RPS × duration_s / 600` users.

## Results
Log every run in `docs/runbooks/capacity.md` (machine sizes, rates, p95, errors, first bottleneck).
