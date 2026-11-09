#!/bin/sh
# Run film-replay.ts like render-clean.sh does (nice, memory-capped, the built studio).
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 1
export STATIC_DIR="${STATIC_DIR:-$ROOT/apps/studio/dist}"
exec systemd-run --user --scope -p MemoryMax=8000M nice -n 5 npx tsx scripts/demo/film-replay.ts "$@"
