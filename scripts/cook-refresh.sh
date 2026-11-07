#!/usr/bin/env bash
# Keep the hosted template packages fresh: when main's generator code version (scripts/vite/gen-version.ts) or a
# template's world no longer matches the package on the dataset, build a dist and re-cook only the stale templates.
#
#   scripts/cook-refresh.sh             update the refresh checkout to origin/main, list stale templates, cook and upload them
#   scripts/cook-refresh.sh --dry-run   update and list the stale templates only (no build, no cook, no upload)
#   scripts/cook-refresh.sh --no-pull   use the refresh checkout as it is (with AETHER_REFRESH_REPO=<a checkout>: that tree)
#
# Run by the user timer in scripts/systemd/ (docs/ARCHITECTURE-STREAMING.md §3.5.2 has the install commands).
#
# - The refresh checkout is a detached worktree of this repository (AETHER_REFRESH_REPO, default
#   ~/.cache/aether-cookall/repo), moved to origin/main on each run: the working checkout is never touched.
# - It has its own `npm ci` install, redone when origin/main's package-lock.json changes (step 2 says why not links).
# - One run at a time (a lock), and no cooking run while any cook runs (scripts/cook.ts or scripts/cook-upload.ts).
# - The build and the cooks are niced and capped: systemd-run --user --scope -p MemorySwapMax=0, MemoryMax=5000M for
#   the build and 8000M for each cook (Lisbon's cook is killed at 5000M).
# - Everything is logged to ~/.cache/aether-cookall/refresh.log.
set -euo pipefail

SELF_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE="${AETHER_COOKALL_DIR:-$HOME/.cache/aether-cookall}"
REPO="${AETHER_REFRESH_REPO:-$CACHE/repo}"
DIST="${AETHER_REFRESH_DIST:-$CACHE/dist-refresh}"
OUT="${AETHER_REFRESH_OUT:-$CACHE/cooked}"
LOG="$CACHE/refresh.log"
LOCK="$CACHE/refresh.lock"
export GEN_GPU="${GEN_GPU:-intel}"
export PATH="$HOME/.local/bin:$PATH"

DRY=0
PULL=1
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    --no-pull) PULL=0 ;;
    *) echo "unknown option $a" >&2; exit 2 ;;
  esac
done

mkdir -p "$CACHE"
# Log to the file, and to the terminal when there is one.
if [ -t 1 ]; then exec > >(tee -a "$LOG") 2>&1; else exec >>"$LOG" 2>&1; fi
log() { printf '%s %s\n' "$(date -Is)" "$*"; }

exec 9>"$LOCK"
if ! flock -n 9; then
  log "another refresh holds $LOCK: skipped"
  exit 0
fi
# A dry run only reads manifests: it may run beside a cook.
if [ "$DRY" = 0 ] && pgrep -u "$(id -u)" -f 'scripts/cook(-upload)?\.ts' >/dev/null; then
  log "a cook is running: skipped"
  exit 0
fi

capped() { systemd-run --user --scope --quiet -p MemoryMax=5000M -p MemorySwapMax=0 nice -n 10 "$@"; }

log "refresh start (dry run: $DRY, checkout: $REPO)"

# 1. The refresh checkout at origin/main.
if [ "$PULL" = 1 ]; then
  git -C "$SELF_ROOT" fetch --quiet origin main
  if [ ! -e "$REPO/.git" ]; then
    git -C "$SELF_ROOT" worktree add --detach "$REPO" origin/main
  else
    git -C "$REPO" checkout --quiet --detach --force origin/main
    git -C "$REPO" clean -fdq -e node_modules
  fi
fi
log "checkout at $(git -C "$REPO" log -1 --format='%h %s' | cut -c1-100)"

# 2. Dependencies: the refresh checkout's own `npm ci` install, redone when main's lockfile changes. Not links into
# this checkout's node_modules: a package reached through a link resolves outside the tree, and the generator code
# version (scripts/vite/gen-version.ts) would then differ from the deployed build's, so every package would be stale.
if [ "$REPO" != "$SELF_ROOT" ]; then
  MARK="$REPO/node_modules/.npm-ci-lock"
  if [ -f "$MARK" ] && cmp -s "$REPO/package-lock.json" "$MARK"; then
    : # its own install is current
  else
    log "npm ci in the refresh checkout"
    rm -rf "$REPO/node_modules"
    (cd "$REPO" && capped npm ci --no-audit --no-fund)
    cp "$REPO/package-lock.json" "$MARK"
  fi
fi

cd "$REPO"
TSX="$REPO/node_modules/.bin/tsx"

# 3. Which templates are stale on the dataset (generator code version and world IR hash, as the player checks).
DRYOUT="$(capped "$TSX" scripts/cook-upload.ts --all --dry-run)"
printf '%s\n' "$DRYOUT"
STALE="$(printf '%s\n' "$DRYOUT" | sed -n 's/^stale: //p' | tail -1)"
# AETHER_COOK_FORCE=a,b re-cooks those templates although current: a change the version does not cover (an opening
# view chosen by new rules). `systemctl --user set-environment AETHER_COOK_FORCE=… && systemctl --user start …`.
FORCE=""
if [ -n "${AETHER_COOK_FORCE:-}" ]; then
  STALE="$(printf '%s,%s' "$STALE" "$AETHER_COOK_FORCE" | tr ',' '\n' | sed '/^$/d' | awk '!seen[$0]++' | paste -sd, -)"
  FORCE="--force"
fi
if [ -z "$STALE" ]; then
  log "every template is current: nothing to cook"
  exit 0
fi
log "stale: $STALE"
if [ "$DRY" = 1 ]; then
  log "dry run: not building or cooking"
  exit 0
fi

# 4. A dist of this tree (scratch folder, never apps/studio/dist), then cook and upload the stale templates one by one.
log "building $DIST"
(cd apps/studio && capped node "$REPO/node_modules/vite/bin/vite.js" build --outDir "$DIST" --emptyOutDir)
log "cooking $STALE"
if STATIC_DIR="$DIST" nice -n 10 "$TSX" scripts/cook-upload.ts --all $FORCE --retry-failed --clean --out="$OUT" --only="$STALE"; then
  log "refresh done"
else
  log "refresh finished with failures (see $OUT/.cook-all-state.json)"
  exit 1
fi
