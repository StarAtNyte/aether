#!/bin/sh
# Run film-arch-clean.ts (nice, memory-capped, the built studio), then finish the master into arch-cutaway.mp4.
#   scripts/demo/film-arch-clean.sh [film-arch-clean.ts options]    env: OUT (default film8), BROWSER, GPU
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE/../.."
OUT="${OUT:-$HOME/.local/share/aether/demo/film8}"
cd "$ROOT" || exit 1
export STATIC_DIR="${STATIC_DIR:-$ROOT/apps/studio/dist}"
mkdir -p "$OUT/master" "$OUT/clips"
systemd-run --user --scope -p MemoryMax=8000M nice -n 5 npx tsx scripts/demo/film-arch-clean.ts --out="$OUT/master" --name=arch-cutaway --browser="${BROWSER:-chrome}" --gpu="${GPU:-intel}" "$@" || exit 1
"$HERE/finish-footage.sh" "$OUT/master/arch-cutaway.mkv" "$OUT/clips/arch-cutaway.mp4" --glow=0.05
python3 "$HERE/footage-metrics.py" "$OUT/clips/arch-cutaway.mp4" --json "$OUT/clips/arch-cutaway.metrics.json" > /dev/null
python3 "$HERE/film8-manifest.py" "$OUT" arch-cutaway 1920x1080 8
