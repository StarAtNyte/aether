#!/bin/sh
# Master (lossless, from render-clean.ts) to a delivery clip: filmic LUT, soft glow, fine grain, light temporal clean-up,
# high-bitrate H.264 (CRF 13, 10-bit-safe 4:2:0, slow preset).
#
#   scripts/demo/finish-footage.sh master.mkv out.mp4 [--scale=1920:1080] [--grain=5] [--glow=0.14] [--denoise=0] [--no-grade]
#
# --scale     downscale target (Lanczos); default none (keep the master's size, e.g. 3840x2160 for a 4K source)
# --sharpen   luma unsharp mask amount after scaling (0 = off); default 0.5 (a still: blurdetect 4.96 to about 4.5)
# --grain     temporal film grain strength; default 0 (OFF: per-frame grain read as flicker, +1.4 to +3.2 grey levels of temporal
#             noise in smooth areas of the finished clips against the lossless masters)
# --glow      screen-blended highlight glow strength (0 = off); default 0.14
# --denoise   hqdn3d luma temporal strength for a last-resort clean-up (0 = off); default 0
# --no-grade  skip the LUT (glow and grain only)
set -e
IN="$1"; OUT="$2"; shift 2
FRAMES=""; SCALE=""; SHARP=0.5; GRAIN=0; GLOW=0.14; DEN=0; GRADE=1
for a in "$@"; do
  case "$a" in
    --scale=*) SCALE="${a#--scale=}";;
    --frames=*) FRAMES="${a#--frames=}";;
    --sharpen=*) SHARP="${a#--sharpen=}";;
    --grain=*) GRAIN="${a#--grain=}";;
    --glow=*) GLOW="${a#--glow=}";;
    --denoise=*) DEN="${a#--denoise=}";;
    --no-grade) GRADE=0;;
  esac
done
HERE="$(cd "$(dirname "$0")" && pwd)"
LUT="${FILM_LUT:-$HERE/film.cube}"
[ -f "$LUT" ] || python3 "$HERE/make-film-lut.py" "$LUT"
F="format=gbrp"
[ "$DEN" != "0" ] && F="$F,hqdn3d=0:0:$DEN:$DEN"
[ "$GRADE" = "1" ] && F="$F,lut3d=file=$LUT:interp=tetrahedral"
G="$F"
if [ "$GLOW" != "0" ]; then
  # Highlights only (curves cut the mids), blurred wide, screened back over the picture.
  G="$F,split[a][b];[b]curves=all='0/0 0.55/0 0.85/0.5 1/1',gblur=sigma=26:steps=3[g];[a][g]blend=all_mode=screen:all_opacity=$GLOW"
fi
[ -n "$SCALE" ] && G="$G,scale=$SCALE:flags=lanczos+accurate_rnd"
[ "$SHARP" != "0" ] && G="$G,unsharp=5:5:$SHARP:5:5:0"
if [ "$GRAIN" != "0" ]; then G="$G,noise=alls=$GRAIN:allf=t+u:all_seed=7"; fi
G="$G,format=yuv420p"
exec ffmpeg -y -v error -i "$IN" ${FRAMES:+-frames:v "$FRAMES"} -vf "$G" -c:v libx264 -preset slow -crf 13 -tune film -profile:v high -movflags +faststart -an "$OUT"
