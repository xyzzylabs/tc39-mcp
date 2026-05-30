#!/usr/bin/env bash
# Clone tc39/test262 to vendor/test262 (shallow). Required for the
# offline / no-auth path of `test262.search` — the index builder reads
# every test's YAML front-matter from this checkout.
#
# Re-running updates the existing checkout to the requested ref.
set -euo pipefail

cd "$(dirname "$0")/.."

REF="${TEST262_REF:-main}"
REPO_URL="${TEST262_REPO_URL:-https://github.com/tc39/test262}"
dest="vendor/test262"

mkdir -p vendor

if [[ -d "$dest/.git" ]]; then
  echo "==> Updating $dest to $REF" >&2
  git -C "$dest" fetch --depth=1 origin "$REF" >&2
  git -C "$dest" checkout --detach FETCH_HEAD >&2 2>/dev/null || \
    git -C "$dest" checkout "$REF" >&2
else
  echo "==> Cloning $REPO_URL to $dest at $REF" >&2
  git clone --depth=1 --branch "$REF" "$REPO_URL" "$dest" >&2
fi

sha=$(git -C "$dest" rev-parse HEAD)
count=$(find "$dest/test" -name '*.js' -type f 2>/dev/null | wc -l | tr -d ' ')
echo
echo "test262 ref: $REF"
echo "test262 SHA: $sha"
echo "test files:  $count"
