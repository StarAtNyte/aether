#!/usr/bin/env python3
"""Pixel-hue scan: count saturated blue pixels in UI screenshots, outside canvas/img/video boxes (written by ui-audit.ts)."""
import sys, json, os, colorsys
from PIL import Image
d = sys.argv[1]
bad = 0
for f in sorted(os.listdir(d)):
    if not f.endswith('.png'): continue
    im = Image.open(os.path.join(d, f)).convert('RGB')
    w, h = im.size
    boxes = []
    try: boxes = json.load(open(os.path.join(d, f[:-4] + '.json')))
    except Exception: pass
    px = im.load(); n = 0; first = None
    for y in range(0, h):
        for x in range(0, w):
            if any(b[0] <= x <= b[2] and b[1] <= y <= b[3] for b in boxes): continue
            r, g, b = px[x, y]
            hh, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if 190 <= hh * 360 <= 285 and s > 0.28 and v > 0.25:
                n += 1; first = first or (x, y, (r, g, b))
    print(f'{f}: {n} blue px' + (f' first {first}' if first else ''))
    bad += n > 30
print('blue found in', bad, 'screenshots' if bad else 'no screenshots')
sys.exit(1 if bad else 0)
