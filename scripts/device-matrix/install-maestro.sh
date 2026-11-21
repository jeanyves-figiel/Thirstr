#!/usr/bin/env bash
# Installs a pinned Maestro CLI release, checksum-verified (no curl | bash, semgrep gha-curl-pipe-shell).
# Bump: new version + sha256 of its maestro.zip (github.com/mobile-dev-inc/maestro/releases).
set -euo pipefail
VERSION="${MAESTRO_VERSION:-2.12.1}"
SHA256="${MAESTRO_SHA256:-54dbb0716425626604973cbb374c585ca30272375d9ce15177a1152765ddd9d7}"
dir="${RUNNER_TEMP:-/tmp}/maestro-dl"; mkdir -p "$dir"
curl -fsSL -o "$dir/maestro.zip" "https://github.com/mobile-dev-inc/maestro/releases/download/cli-${VERSION}/maestro.zip"
echo "${SHA256}  $dir/maestro.zip" | (command -v sha256sum >/dev/null && sha256sum -c - || shasum -a 256 -c -)
rm -rf "$HOME/.maestro"; mkdir -p "$HOME/.maestro"
unzip -q "$dir/maestro.zip" -d "$HOME/.maestro"   # → ~/.maestro/maestro/bin/maestro
mv "$HOME/.maestro/maestro/"* "$HOME/.maestro/" && rmdir "$HOME/.maestro/maestro"
"$HOME/.maestro/bin/maestro" --version
