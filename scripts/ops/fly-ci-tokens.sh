#!/usr/bin/env bash
# EN-09 (#168, docs/runbooks/access.md §2–3): mint least-privilege, expiring Fly deploy tokens for
# one GitHub environment and store them as that environment's FLY_TOKEN secret.
# Run on the owner's laptop (needs `flyctl` and `gh`, both logged in). Nothing is printed or saved
# except token ids; the token goes straight from flyctl into GitHub.
# Usage: scripts/ops/fly-ci-tokens.sh <staging|production> [expiry-hours, default 2160 = 90 days]
set -euo pipefail
env="${1:-}"; hours="${2:-2160}"
repo="${THIRSTR_REPO:-jeanyves-figiel/Thirstr}"
case "$env" in
  staging)    apps="thirstr-api-staging thirstr-db-staging thirstr-valkey-staging thirstr-bot-staging thirstr-classifier-staging" ;;
  production) apps="thirstr-api-prod thirstr-db-prod thirstr-valkey-prod thirstr-classifier-prod" ;;
  *) echo "usage: $0 <staging|production> [expiry-hours]" >&2; exit 2 ;;
esac
command -v flyctl >/dev/null || { echo "flyctl missing (brew install flyctl)" >&2; exit 1; }
command -v gh >/dev/null || { echo "gh missing (brew install gh)" >&2; exit 1; }
gh auth status >/dev/null

name="ci-$env-$(date -u +%Y%m%d)"
combined=""
for app in $apps; do
  if ! flyctl status -a "$app" >/dev/null 2>&1; then
    echo "skip $app (does not exist)"; continue
  fi
  tok=$(flyctl tokens create deploy -a "$app" -x "${hours}h" -n "$name" 2>/dev/null | grep -E '^FlyV1 ' | tail -1)
  [[ -n "$tok" ]] || { echo "could not mint a token for $app" >&2; exit 1; }
  # Joined tokens: "FlyV1 a,b" + ",c,d" … (each deploy token is itself a comma list of macaroons)
  if [[ -z "$combined" ]]; then combined="$tok"; else combined="$combined,${tok#FlyV1 }"; fi
  echo "minted $app ($name, ${hours} h)"
done
[[ -n "$combined" ]] || { echo "no apps found" >&2; exit 1; }

printf '%s' "$combined" | gh secret set FLY_TOKEN --env "$env" --repo "$repo"
unset combined tok
expires=$(date -u -d "+${hours} hours" +%Y-%m-%d 2>/dev/null || date -u -v+"${hours}"H +%Y-%m-%d)
gh variable set "FLY_TOKEN_EXPIRES_$(tr '[:lower:]' '[:upper:]' <<<"$env")" --body "$expires" --repo "$repo"
echo "GitHub env '$env': FLY_TOKEN set, expires $expires"

# Once both environments hold their own token, the old repo-wide token must go.
if gh secret list --repo "$repo" | grep -q '^FLY_TOKEN\b' &&
   gh secret list --env staging --repo "$repo" | grep -q '^FLY_TOKEN\b' &&
   gh secret list --env production --repo "$repo" | grep -q '^FLY_TOKEN\b'; then
  read -r -p "Both environments have their own FLY_TOKEN. Delete the repo-wide FLY_TOKEN now? [y/N] " a
  [[ "$a" == y* ]] && gh secret delete FLY_TOKEN --repo "$repo" && echo "repo-wide FLY_TOKEN deleted"
fi

echo
echo "Next: prove it (staging: dispatch 'Deploy staging'; production: the next promotion), then revoke the old tokens:"
for app in $apps; do echo "  flyctl tokens list -a $app   # then: flyctl tokens revoke <id> for every token not named $name"; done
