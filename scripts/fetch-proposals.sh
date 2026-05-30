#!/usr/bin/env bash
# Fetch tc39/proposals into vendor/proposals/ for the proposals index.
# Idempotent: clones on first run, fetches on subsequent runs.
set -euo pipefail

cd "$(dirname "$0")/.."

REPO="${PROPOSALS_REPO:-https://github.com/tc39/proposals}"
BRANCH="${PROPOSALS_BRANCH:-main}"
DEST="vendor/proposals"

mkdir -p vendor

if [[ -d "$DEST/.git" ]]; then
  echo "==> Updating $DEST to $BRANCH" >&2
  git -C "$DEST" fetch --depth=1 origin "$BRANCH" >&2
  git -C "$DEST" checkout --detach FETCH_HEAD >&2
else
  echo "==> Cloning $REPO to $DEST at $BRANCH" >&2
  git clone --depth=1 --branch "$BRANCH" "$REPO" "$DEST" >&2
fi

sha=$(git -C "$DEST" rev-parse HEAD)
echo "proposals @ $sha"
