"""Textures of a VRM body for the toon shader (called by scripts/characters/vrm-character.ts).

    python3 -I scripts/characters/vrm_textures.py <jobs.json>

Each job: {name, src, dst, code, cut, max, recolour?}. The alpha is rewritten into the toon atlas codes (a hole, 0, where
the source alpha is under one half when `cut`, else the material's code: 1 shaded, 0.2 unshaded), the colour optionally
recoloured, the image down-sized to `max` pixels on its long side and written as WebP (lossy colour, lossless alpha, so
the codes survive).

Recolour ops (`recolour: {op, colour}`, colour as #rrggbb):
- `lum`:  the colour scaled by each pixel's luminance over the median luminance of
  its lit pixels (hair, irises: keeps the shading).
- `mul`:  the pixel multiplied by colour / white (a white garment dyed).
- `lift`: colour times 0.8 + 0.2 * luminance / its 95th percentile (a dark garment made light, folds kept).
"""
import json
import sys

import numpy as np
from PIL import Image


def hexrgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)


def recolour(rgb, mask, spec):
    c = hexrgb(spec['colour'])
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    sel = lum[mask] if mask.any() else lum.ravel()
    if spec['op'] == 'lum':
        lit = sel[sel > 4]
        ref = max(float(np.median(lit if lit.size else sel)), 1.0)
        out = c[None, None, :] * (lum / ref)[..., None]
    elif spec['op'] == 'mul':
        out = rgb * (c / 255.0)[None, None, :]
    elif spec['op'] == 'lift':
        ref = max(float(np.percentile(sel, 95)), 1.0)
        out = c[None, None, :] * (0.8 + 0.2 * np.clip(lum / ref, 0, 1.25))[..., None]
    else:
        raise ValueError(f"unknown recolour op {spec['op']}")
    return np.clip(out, 0, 255)


def main():
    jobs = json.load(open(sys.argv[1]))
    for j in jobs:
        im = Image.open(j['src']).convert('RGBA')
        a = np.asarray(im).astype(np.float32)
        al = a[..., 3]
        rgb = a[..., :3]
        if j.get('recolour'):
            rgb = recolour(rgb, al >= 128, j['recolour'])
        code = int(round(j['code'] * 255))
        alpha = np.where(al < 128, 0, code) if j['cut'] else np.full(al.shape, code)
        out = Image.fromarray(np.dstack([rgb, alpha]).astype(np.uint8), 'RGBA')
        if j.get('max') and max(out.size) > j['max']:
            s = j['max'] / max(out.size)
            out = out.resize((max(1, round(out.size[0] * s)), max(1, round(out.size[1] * s))), Image.LANCZOS)
            # (resampling blends the codes at their edges: snap them back)
            o = np.asarray(out).copy()
            if j['cut']:
                o[..., 3] = np.where(o[..., 3] < code / 2, 0, code)
            else:
                o[..., 3] = code
            out = Image.fromarray(o, 'RGBA')
        out.save(j['dst'], 'WEBP', quality=88, alpha_quality=100, method=6)
        print(f"{j['name']}: {im.size} -> {out.size}{' recoloured ' + j['recolour']['op'] if j.get('recolour') else ''}")


if __name__ == '__main__':
    main()
