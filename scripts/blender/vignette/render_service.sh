#!/bin/bash
# Resumable frame-by-frame render of a vignette scene. Run as a user service so it survives the session:
#   systemd-run --user --unit=aether-vignette -p Nice=10 scripts/blender/vignette/render_service.sh kitchen.py /path/frames 1 240 80 1920x1080
# args: scene.py outdir first last samples WxH [mode]
# Frames already on disk (non-empty) are skipped; a crashed frame leaves a zero-byte placeholder that is removed before
# each retry. When the shared GPU runs out of memory the loop waits and retries (CPU only after 40 fruitless tries).
set -u
SCENE=$1; OUT=$2; A=$3; B=$4; SPP=${5:-80}; RES=${6:-1920x1080}; MODE=${7:-final}
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$OUT"
DEVICE=OPTIX
fails=0
for attempt in $(seq 1 300); do
  find "$OUT" -name 'f_*.png' -size 0 -delete
  have=$(find "$OUT" -name 'f_*.png' -size +0 | wc -l)
  [ "$have" -ge $((B - A + 1)) ] && echo "all frames present" && exit 0
  echo "attempt $attempt device $DEVICE have $have $(date)"
  "$HERE/run.sh" "$SCENE" --anim "$A" "$B" --out "$OUT/f_" --res "$RES" --samples "$SPP" --mode "$MODE" --exposure "${EXPOSURE:-0.2}" --device "$DEVICE" 2>&1 \
    | tr '\r' '\n' | grep --line-buffered -E "Saved|Error|Traceback|out of memory|CUDA|OPTIX"
  if grep -q . /dev/null; then :; fi
  have2=$(find "$OUT" -name 'f_*.png' -size +0 | wc -l)
  [ "$have2" -ge $((B - A + 1)) ] && echo "done $(date)" && exit 0
  # no progress: the shared GPU is out of memory right now. Wait and retry the GPU; CPU only after 40 fruitless tries
  if [ "$have2" -eq "$have" ]; then fails=$((fails + 1)); [ "$fails" -ge 40 ] && DEVICE=CPU; else fails=0; fi
  sleep 30
done
echo "gave up"; exit 1
