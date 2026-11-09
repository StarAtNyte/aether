#!/bin/bash
# Web deliverables from a graded cut: silent 1280x720 H.264 (<= 6 MB, faststart), VP9 WebM of similar size, WebP poster (<= 60 KB).
#   web.sh <clean.mp4> <out_dir> [poster_second=4.2]
set -eu
IN=$1; OUT=$2; PS=${3:-4.2}
mkdir -p "$OUT"
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN")
KBPS=$(python3 -c "print(int((5.5*8*1000)/float('$DUR')*0.93))")   # target ~5.5 MB of video
ffmpeg -y -loglevel error -i "$IN" -an -vf scale=1280:720:flags=lanczos -c:v libx264 -preset veryslow -b:v ${KBPS}k -maxrate $((KBPS*14/10))k -bufsize $((KBPS*2))k -pix_fmt yuv420p -movflags +faststart "$OUT/aether-blender-real-shot.mp4"
ffmpeg -y -loglevel error -i "$IN" -an -vf scale=1280:720:flags=lanczos -c:v libvpx-vp9 -b:v ${KBPS}k -crf 27 -row-mt 1 -cpu-used 1 -pix_fmt yuv420p "$OUT/aether-blender-real-shot.webm"
Q=94
while :; do
  ffmpeg -y -loglevel error -ss "$PS" -i "$IN" -frames:v 1 -vf scale=1280:720:flags=lanczos -c:v libwebp -quality $Q -compression_level 6 "$OUT/aether-blender-real-shot-poster.webp"
  SZ=$(stat -c %s "$OUT/aether-blender-real-shot-poster.webp")
  [ "$SZ" -le 61440 ] || [ "$Q" -le 20 ] && break
  Q=$((Q - 6))
done
ls -l "$OUT"
