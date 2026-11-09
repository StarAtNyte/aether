#!/usr/bin/env python3
"""A contact sheet of candidate clips: three frames per clip (20, 50 and 80 percent), one row per clip, labelled.

  python3 scripts/demo/clip-sheet.py out.jpg clip1.mp4 clip2.mp4 ...
"""
import os
import subprocess
import sys

from PIL import Image, ImageDraw

W, H = 480, 270
out, clips = sys.argv[1], sys.argv[2:]
im = Image.new('RGB', (W * 3, H * len(clips)))
dr = ImageDraw.Draw(im)
for r, c in enumerate(clips):
    d = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', c], capture_output=True, text=True).stdout.strip() or 0)
    for k, f in enumerate((0.2, 0.5, 0.8)):
        p = f'/tmp/_cs_{r}_{k}.png'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(d * f), '-i', c, '-frames:v', '1', '-vf', f'scale={W}:{H}', p])
        if os.path.exists(p):
            im.paste(Image.open(p), (k * W, r * H))
            os.remove(p)
    dr.rectangle((0, r * H, 260, r * H + 16), fill=(0, 0, 0))
    dr.text((4, r * H + 2), os.path.basename(c), fill=(255, 255, 0))
im.save(out, quality=88)
