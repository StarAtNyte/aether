"""Encode a PNG to WebP at a size and quality (centre-cropped to the aspect first).

The fallback of tests/e2e/showcase.e2e.ts when `cwebp` is not installed.
Usage: python3 -I to-webp.py <in.png> <out.webp> <width> <height> <quality>
"""
import sys

from PIL import Image

src, out, w, h, q = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
im = Image.open(src).convert('RGB')
sw, sh = im.size
aspect = w / h
cw, ch = sw, round(sw / aspect)
if ch > sh:
    ch, cw = sh, round(sh * aspect)
cx, cy = (sw - cw) // 2, (sh - ch) // 2
im = im.crop((cx, cy, cx + cw, cy + ch)).resize((w, h), Image.LANCZOS)
im.save(out, 'WEBP', quality=q, method=6)
