#!/bin/sh
# Run render-clean.ts the way the footage pipeline does: nice, memory-capped, the built studio, the chosen GPU.
#   scripts/demo/render-clean.sh [--clip=...] [render-clean.ts options]      (GEN_GPU=intel|nvidia, default intel)
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 1
export STATIC_DIR="${STATIC_DIR:-$ROOT/apps/studio/dist}"
export GEN_GPU="${GEN_GPU:-intel}"
exec systemd-run --user --scope -p MemoryMax=8000M nice -n 5 npx tsx scripts/demo/render-clean.ts "$@"
