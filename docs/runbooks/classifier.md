# Runbook: public-photo classifier (F-15 R-15.10, #26)

Self-hosted [NudeNet](https://github.com/notAI-tech/NudeNet) 3.4.2 (MIT, `320n` ONNX on CPU). No third party ever sees a photo.

| What | Value |
| --- | --- |
| Code | `infra/classifier/` (Python stdlib HTTP server, ~90 MB RAM, ~50 ms per photo) |
| Apps | `thirstr-classifier-staging`, `thirstr-classifier-prod` (Fly, `fra`, shared-cpu-1x 512 MB) |
| Network | **Private only**: no public IP. API calls `http://thirstr-classifier-<env>.flycast` (Fly proxy, private IPv6) |
| Idle | `auto_stop_machines = "suspend"`, `min_machines_running = 0`: resumes in < 1 s, billed only while running |
| Auth | `CLASSIFIER_TOKEN` (same random value on the API and the classifier app) |
| SSRF guard | `ALLOWED_URL_PREFIXES` = the env's photo bucket; any other URL is refused |
| Deploy | `.github/workflows/classifier.yml`: main push → staging; prod by manual dispatch. Skips while the app does not exist |

## Flow
1. API (`Thirstr.Moderation.NudeNetClassifier`) sends `POST /detect {"url": <presigned GET, 120 s>}`.
2. Service downloads the photo into memory (≤ 25 MB), runs NudeNet, returns labels + scores, forgets the photo. No request logging.
3. API maps labels to a verdict (`Classifier.decide/3`, table in `docs/spec/beta-build-plan.md` › Classifier mapping): main photo must be vanilla; other public photos may be spicy, never genitals/anus; ≥ 0.6 rejects, 0.4–0.6 human review.
4. Service down, timeout or error → **review** (hidden until a moderator decides). Never auto-approve.

## First-time setup (per env, needs owner's spend OK)
```sh
fly apps create thirstr-classifier-<env> --org personal
fly ips allocate-v6 --private -a thirstr-classifier-<env>
TOKEN=$(openssl rand -hex 32)
fly secrets set -a thirstr-classifier-<env> CLASSIFIER_TOKEN=$TOKEN --stage
fly deploy --config infra/fly/classifier-<env>.toml --ha=false
fly secrets set -a thirstr-api-<env> CLASSIFIER_URL=http://thirstr-classifier-<env>.flycast CLASSIFIER_TOKEN=$TOKEN
```
Setting `CLASSIFIER_URL` switches the API from the stand-in (`DevClassifier`, accepts everything) to the service.

## Check
- `fly logs -a thirstr-classifier-<env>`: `detect ok n=<labels> ms=<ms>` per photo.
- Upload a main photo on the env: verdict appears within 3 s (first call after idle adds < 1 s resume).
- Roll back: `fly secrets unset -a thirstr-api-<env> CLASSIFIER_URL` (back to stand-in).
