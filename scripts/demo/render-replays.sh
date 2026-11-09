#!/bin/sh
# The two build replays, clean: planner builds (no model call) probed once into patches.json, then replayed step by step
# with one-moment frames (film-replay.ts) and finished like the other clips. Env as render-film8.sh (SIZE, SUB, OUT, GPU, BROWSER) plus HOLD (frames per step) and STEPS. The village is CPU-bound
# (about 5 s per draw), so it is rendered at 1080p with 4 draws; the villa at 4K with 8.
#   scripts/demo/render-replays.sh [villa-pool] [village-market]
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${OUT:-$HOME/.local/share/aether/demo/film8}"
SIZE="${SIZE:-3840x2160}"
SUB="${SUB:-8}"
mkdir -p "$OUT/master" "$OUT/clips" "$OUT/plans"
[ $# -eq 0 ] && set -- villa-pool village-market
for c in "$@"; do
  case "$c" in
    villa-pool) PROMPT="a two-storey villa with a pool"; EXTRA="--elev=13 --dist=2.3 --arc=40 --az=215";;
    village-market) PROMPT="a small medieval village with a market square"; EXTRA="--elev=16 --dist=1.5 --arc=45 --az=200 --core=house,stall,plaza,well";;
    *) continue;;
  esac
  if [ ! -f "$OUT/plans/$c/patches.json" ]; then
    STATIC_DIR="${STATIC_DIR:-$HERE/../../apps/studio/dist}" GEN_GPU=intel npx tsx "$HERE/film-build.ts" --prompt="$PROMPT" --probe=1 --out="$OUT/plans/$c" || continue
  fi
  # shellcheck disable=SC2086
  "$HERE/film-replay.sh" --browser="${BROWSER:-chrome}" --gpu="${GPU:-intel}" --patches="$OUT/plans/$c/patches.json" --out="$OUT/master" --name="$c" --size="$SIZE" --sub="$SUB" --hold="${HOLD:-14}" --steps="${STEPS:-14}" $EXTRA || continue
  "$HERE/finish-footage.sh" "$OUT/master/$c.mkv" "$OUT/clips/$c.mp4" --scale=1920:1080 --glow=0.1
  "$HERE/finish-footage.sh" "$OUT/master/$c.mkv" "$OUT/clips/$c-4k.mp4" --sharpen=0.5 --glow=0.1
  python3 "$HERE/footage-metrics.py" "$OUT/clips/$c.mp4" --json "$OUT/clips/$c.metrics.json" > /dev/null
  python3 "$HERE/film8-manifest.py" "$OUT" "$c" "$SIZE" "$SUB"
done
