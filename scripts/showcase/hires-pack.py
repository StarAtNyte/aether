"""Pack hires-thumbs.ts stills into the card images the studio ships.

For each <slug>.png in <in-dir>: Lanczos down to 1280x720 -> public/templates/<slug>@2x.webp (q82, <= 110 KB) and
640x360 -> <slug>.webp (<= 40 KB); with --lead the 1920x1080 -> public/templates/featured/<slug>.webp (<= 160 KB).
Quality steps down only when a file is over its limit. Sources smaller than the target are refused (no upscaling).

Usage: python3 -I hires-pack.py <in-dir> <public-templates-dir> [--lead slug,...] [slug ...]
"""
import os
import sys

from PIL import Image

LIMITS = {640: 40 * 1024, 1280: 110 * 1024, 1920: 160 * 1024}


def save(im, w, path):
    h = round(w * 9 / 16)
    sw, sh = im.size
    ch = round(sw * 9 / 16)
    if ch <= sh:  # centre-crop to 16:9
        im = im.crop((0, (sh - ch) // 2, sw, (sh - ch) // 2 + ch))
    else:
        cw = round(sh * 16 / 9)
        im = im.crop(((sw - cw) // 2, 0, (sw - cw) // 2 + cw, sh))
    if im.size[0] < w:
        raise SystemExit(f'{path}: source {im.size} is smaller than {w} px, not upscaling')
    out = im.resize((w, h), Image.LANCZOS)
    for q in (84, 82, 78, 74, 70, 66, 60, 54, 48, 42):
        out.save(path, 'WEBP', quality=q, method=6)
        if os.path.getsize(path) <= LIMITS[w]:
            return q, os.path.getsize(path)
    raise SystemExit(f'{path}: does not fit {LIMITS[w]} B')


def main():
    args = sys.argv[1:]
    src, dest = args[0], args[1]
    rest = args[2:]
    lead = []
    if '--lead' in rest:
        i = rest.index('--lead')
        lead = rest[i + 1].split(',')
        del rest[i : i + 2]
    slugs = rest or sorted(f.rsplit('.', 1)[0] for f in os.listdir(src) if f.endswith(('.png', '.webp')))
    os.makedirs(os.path.join(dest, 'featured'), exist_ok=True)
    for s in slugs:
        path = os.path.join(src, f'{s}.png')
        im = Image.open(path if os.path.exists(path) else os.path.join(src, f'{s}.webp')).convert('RGB')
        sizes = []
        for w, name in ((1280, f'{s}@2x.webp'), (640, f'{s}.webp')):
            q, n = save(im, w, os.path.join(dest, name))
            sizes.append(f'{w}w q{q} {n // 1024} KB')
        if s in lead:
            q, n = save(im, 1920, os.path.join(dest, 'featured', f'{s}.webp'))
            sizes.append(f'1920w q{q} {n // 1024} KB')
        print(s, ', '.join(sizes))


main()
