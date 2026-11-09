#!/bin/sh
# Render clean world clips end to end: 4K master with sub-frame accumulation, then the delivery clips and the manifest.
#
#   scripts/demo/render-film8.sh lisbon-drone terraces-falls ...      (names from scripts/demo/film/clean-clips.json)
#   env: GPU=intel|nvidia-webgpu (default intel: the real headed Chrome, which lands on the RTX here), BROWSER=chrome|headless,
#        SIZE=3840x2160, SUB=16, TRIM=0.3, OUT=~/.local/share/aether/demo/film8
#
# Output: $OUT/master/<clip>.mkv (lossless, deletable), $OUT/clips/<clip>.mp4 (1920x1080, CRF 13), $OUT/clips/<clip>-4k.mp4
# (3840x2160, CRF 13), $OUT/clips/<clip>.metrics.json and the running $OUT/clips/manifest.json.
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${OUT:-$HOME/.local/share/aether/demo/film8}"
SIZE="${SIZE:-3840x2160}"
SUB="${SUB:-16}"
TRIM="${TRIM:-0.3}"
mkdir -p "$OUT/master" "$OUT/clips"
for c in "$@"; do
  "$HERE/render-clean.sh" --browser="${BROWSER:-chrome}" --gpu="${GPU:-intel}" --clip="$c" --size="$SIZE" --sub="$SUB" --warmup=24 --trim="$TRIM" --out="$OUT/master" || continue
  [ -f "$OUT/master/$c.mkv" ] || continue
  "$HERE/finish-footage.sh" "$OUT/master/$c.mkv" "$OUT/clips/$c.mp4" --scale=1920:1080
  "$HERE/finish-footage.sh" "$OUT/master/$c.mkv" "$OUT/clips/$c-4k.mp4" --sharpen=0.5
  python3 "$HERE/footage-metrics.py" "$OUT/clips/$c.mp4" --json "$OUT/clips/$c.metrics.json" > /dev/null
  python3 "$HERE/film8-manifest.py" "$OUT" "$c" "$SIZE" "$SUB"
done
