#!/bin/bash
# Assemble a vignette: frames -> graded H.264 with grain, vignette and the procedural sound bed.
#   assemble.sh <frames_dir> <viewport_dir|-> <audio.wav> <out_prefix> [fps=24]
# Writes <out_prefix>-clean.mp4 and, when a viewport frame dir is given, <out_prefix>-inset.mp4 (a plain grey viewport
# render of the rough scene in the top-left corner, fading in at 0.4 s).
set -eu
FR=$1; VP=$2; AU=$3; OUT=$4; FPS=${5:-24}
FONT=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
# restrained grade: slight warm lift in the mids, gentle S-curve, a touch less saturation, soft vignette, temporal grain
GRADE="eq=saturation=0.94:contrast=1.03,curves=r='0/0 0.5/0.52 1/1':b='0/0.01 0.5/0.48 1/0.99',vignette=angle=PI/4.6:mode=forward,noise=alls=5:allf=t+u"
ENC="-c:v libx264 -preset slow -crf 14 -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 192k -shortest"
ffmpeg -y -loglevel error -framerate "$FPS" -i "$FR/f_%04d.png" -i "$AU" -filter_complex "[0:v]$GRADE[v]" -map "[v]" -map 1:a $ENC "$OUT-clean.mp4"
if [ "$VP" != "-" ]; then
  LABEL=""
  [ -f "$FONT" ] && LABEL=",drawtext=fontfile=$FONT:text='Blender viewport  ·  built locally':fontcolor=white@0.9:fontsize=15:x=38:y=262:box=1:boxcolor=black@0.45:boxborderw=5"
  ffmpeg -y -loglevel error -framerate "$FPS" -i "$FR/f_%04d.png" -framerate "$FPS" -i "$VP/f_%04d.png" -i "$AU" -filter_complex \
    "[0:v]$GRADE[base];[1:v]scale=480:270,pad=484:274:2:2:color=white@0.9,format=rgba,fade=t=in:st=0.4:d=0.5:alpha=1[ins];[base][ins]overlay=36:36:format=auto${LABEL}[v]" \
    -map "[v]" -map 2:a $ENC "$OUT-inset.mp4"
fi
