#!/usr/bin/env python3
"""Frames of one clip at given times, tiled two across at a chosen width (for checking details such as legs and skirts).

  python3 scripts/demo/frame-sheet.py out.jpg clip.mp4 <width> t1 t2 t3 ...
"""
import subprocess
import sys

from PIL import Image

out, clip, width, times = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4:]
ims = []
for i, t in enumerate(times):
    p = f'/tmp/_fs_{i}.png'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', t, '-i', clip, '-frames:v', '1', '-vf', f'scale={width}:-1', p], check=True)
    ims.append(Image.open(p).convert('RGB'))
w, h = ims[0].size
rows = (len(ims) + 1) // 2
sheet = Image.new('RGB', (w * 2, h * rows))
for i, im in enumerate(ims):
    sheet.paste(im, ((i % 2) * w, (i // 2) * h))
sheet.save(out, quality=90)
