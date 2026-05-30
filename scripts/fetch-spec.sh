#!/usr/bin/env bash
# Fetch the TC39 specs we cover:
#
#   ECMA-262 (core language) — every annual release tag (esYYYY) +
#     the main branch.
#   ECMA-402 (Intl)          — the few candidate tags it publishes +
#     the main branch. ECMA-402 doesn't use the same esYYYY final-
#     release tagging that ECMA-262 does, so the coverage is thinner.
#
# Defaults can be overridden via $EDITIONS_262 / $EDITIONS_402 /
# $MAIN_BRANCH (space-separated).
set -euo pipefail

cd "$(dirname "$0")/.."

EDITIONS_262="${EDITIONS_262:-es2016 es2017 es2018 es2019 es2020 es2021 es2022 es2023 es2024 es2025}"
EDITIONS_402="${EDITIONS_402:-es2025-candidate-2025-04-01}"
MAIN_BRANCH="${MAIN_BRANCH:-main}"
REPO_262="${REPO_262:-https://github.com/tc39/ecma262}"
REPO_402="${REPO_402:-https://github.com/tc39/ecma402}"

mkdir -p vendor

clone_at() {
  local dest="$1"
  local ref="$2"
  local url="$3"
  if [[ -d "$dest/.git" ]]; then
    echo "==> Updating $dest to $ref" >&2
    git -C "$dest" fetch --depth=1 origin "$ref" >&2 || \
      git -C "$dest" fetch --depth=1 origin "refs/tags/$ref:refs/tags/$ref" >&2
    git -C "$dest" checkout --detach FETCH_HEAD >&2 2>/dev/null || \
      git -C "$dest" checkout "$ref" >&2
  else
    echo "==> Cloning $url to $dest at $ref" >&2
    git clone --depth=1 --branch "$ref" "$url" "$dest" >&2
  fi
  git -C "$dest" rev-parse HEAD
}

: > vendor/PINNED.txt
echo "fetched:    $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> vendor/PINNED.txt
echo >> vendor/PINNED.txt

# ─── ECMA-262 ──────────────────────────────────────────────────────
echo "# ECMA-262 — core ECMAScript spec" >> vendor/PINNED.txt
for ed in $EDITIONS_262; do
  sha=$(clone_at "vendor/ecma262-$ed" "$ed" "$REPO_262")
  printf '262 %-16s ref: %s\n' "$ed" "$ed" >> vendor/PINNED.txt
  printf '262 %-16s SHA: %s\n' "$ed" "$sha" >> vendor/PINNED.txt
done
main_sha=$(clone_at "vendor/ecma262-main" "$MAIN_BRANCH" "$REPO_262")
printf '262 %-16s ref: %s\n' "main" "$MAIN_BRANCH" >> vendor/PINNED.txt
printf '262 %-16s SHA: %s\n' "main" "$main_sha" >> vendor/PINNED.txt
echo >> vendor/PINNED.txt

# ─── ECMA-402 (Intl) ───────────────────────────────────────────────
# Upstream candidate tags get a friendly local alias: the long form
# `es2025-candidate-2025-04-01` is what gets cloned, but we land it in
# `vendor/ecma402-es2025-candidate/` to match the editions catalog.
echo "# ECMA-402 — Internationalization API (Intl)" >> vendor/PINNED.txt
for ed in $EDITIONS_402; do
  local_name=$(echo "$ed" | sed -E 's/-[0-9]{4}-[0-9]{2}-[0-9]{2}$//')
  sha=$(clone_at "vendor/ecma402-$local_name" "$ed" "$REPO_402")
  printf '402 %-16s ref: %s\n' "$local_name" "$ed" >> vendor/PINNED.txt
  printf '402 %-16s SHA: %s\n' "$local_name" "$sha" >> vendor/PINNED.txt
done
main_sha=$(clone_at "vendor/ecma402-main" "$MAIN_BRANCH" "$REPO_402")
printf '402 %-16s ref: %s\n' "main" "$MAIN_BRANCH" >> vendor/PINNED.txt
printf '402 %-16s SHA: %s\n' "main" "$main_sha" >> vendor/PINNED.txt

echo
cat vendor/PINNED.txt
