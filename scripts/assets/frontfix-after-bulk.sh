#!/usr/bin/env bash
# Dev-time driver: wait until the `aether-bulk` user service has finished, then run the whole front fix:
#   1. front-fix for every converted or published bulk model (vision check, cached)
#   2. push the small simready-fronts.json to main
#   3. bulk --reprocess=front (converts again only the changed ids, publishes them to the hub dataset, re-pins assets/hub.json)
#   4. verify the staged dataset
# Nothing here touches the shared staging folder or the dataset while the bulk service runs (the service's checkout is old code that
# does not know publish.lock, so this waits for the unit itself). Log: ~/.local/share/aether/simready-bulk/frontfix.log
# Start: systemd-run --user --unit=aether-frontfix -p Nice=19 -p WorkingDirectory=<checkout> bash scripts/assets/frontfix-after-bulk.sh
set -u
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
LOG=${AETHER_FRONTFIX_LOG:-$HOME/.local/share/aether/simready-bulk/frontfix.log}
UNIT=${AETHER_BULK_UNIT:-aether-bulk}
exec >>"$LOG" 2>&1
say() { echo "$(date +%T) $*"; }
export NVM_DIR=$HOME/.nvm
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null
cd "$ROOT" || exit 1

say "frontfix: waiting for $UNIT to finish"
while :; do
  st=$(systemctl --user show -p ActiveState --value "$UNIT" 2>/dev/null || echo inactive)
  case "$st" in active | activating | reloading | deactivating) sleep 60 ;; *) break ;; esac
done
say "frontfix: $UNIT is $st; starting"

git fetch -q origin main && git merge -q --ff-only origin/main || { say "frontfix: cannot fast-forward the checkout; stopping"; exit 1; }

say "step 1: front-fix"
npm run assets:simready -- front-fix --budget-usd="${AETHER_FRONTFIX_BUDGET:-15}" || { say "front-fix failed; stopping"; exit 1; }

push_fronts() {
  local tmp
  tmp=$(mktemp -d)
  git worktree add -q --detach "$tmp" origin/main || return 1
  cp scripts/assets/simready-fronts.json "$tmp/scripts/assets/simready-fronts.json"
  if ! git -C "$tmp" diff --quiet -- scripts/assets/simready-fronts.json; then
    git -C "$tmp" add scripts/assets/simready-fronts.json
    git -C "$tmp" commit -q -m "Front and mounting of the converted SimReady models decided by the vision check" &&
      { git -C "$tmp" push -q origin HEAD:main || { git -C "$tmp" fetch -q origin main && git -C "$tmp" rebase -q origin/main && git -C "$tmp" push -q origin HEAD:main; }; } &&
      say "pushed simready-fronts.json"
  fi
  git worktree remove --force "$tmp"
}
say "step 2: push simready-fronts.json"
push_fronts || say "push of simready-fronts.json failed"

say "step 3: bulk --reprocess=front"
npm run assets:simready -- bulk --reprocess=front --concurrency=2 --max=2000 --time-budget=10 || say "reprocess ended with an error"

say "step 4: verify"
npm run assets:hf -- verify || say "verify reported a problem"
say "frontfix: done"
