#!/usr/bin/env python3
"""Write the restrained filmic grade as a 3D LUT (.cube, 33^3) for finish-footage.sh.

  python3 scripts/demo/make-film-lut.py out.cube [--sat 0.94] [--contrast 1.0] [--warm 0.0]

Input and output are display-referred (Rec.709 / sRGB) values 0..1. The curve is a gentle filmic S: a soft toe that
lifts the blacks a hair (so shadows stay open, never crushed), a shoulder that rolls highlights off instead of
clipping, a split tone (cool shadows, warm highlights, both small) and a small saturation trim. It is meant to take the
raw engine picture a step toward photographed, not to restyle it.
"""
import sys

import numpy as np

N = 33


def curve(x, contrast):
    # Filmic S in two parts: a toe below 0.18 and a shoulder above 0.72, a straight section in between.
    x = np.clip(x, 0, 1)
    lift = 0.012
    toe = lift + (1 - lift) * x
    y = toe
    # Contrast about mid grey with a smoothstep blend (keeps the ends fixed).
    s = x * x * (3 - 2 * x)
    y = y + (s - y) * 0.35 * contrast
    # Shoulder: compress the top 25% so highlights roll off.
    hi = 0.75
    over = np.clip(y - hi, 0, None)
    y = np.where(y > hi, hi + (1 - hi) * (1 - np.exp(-over / (1 - hi) * 1.15)) / (1 - np.exp(-1.15)), y)
    return np.clip(y, 0, 1)


def main():
    out = sys.argv[1]
    a = sys.argv[2:]
    get = lambda k, d: float(a[a.index(k) + 1]) if k in a else d
    sat, contrast, warm = get('--sat', 0.94), get('--contrast', 1.0), get('--warm', 0.0)
    g = np.linspace(0, 1, N)
    with open(out, 'w') as f:
        f.write(f'TITLE "aether-film"\nLUT_3D_SIZE {N}\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n')
        for b in g:
            for gg in g:
                for r in g:
                    rgb = np.array([r, gg, b])
                    luma = float(rgb @ np.array([0.2126, 0.7152, 0.0722]))
                    rgb = luma + (rgb - luma) * sat
                    rgb = np.array([curve(c, contrast) for c in rgb])
                    l2 = float(rgb @ np.array([0.2126, 0.7152, 0.0722]))
                    sh = max(0.0, 1 - l2 * 2.2)  # shadows
                    hl = max(0.0, l2 * 2 - 1)  # highlights
                    rgb = rgb + np.array([-0.006, 0.0, 0.010]) * sh + np.array([0.008 + warm, 0.003 + warm * 0.4, -0.006 - warm]) * hl
                    rgb = np.clip(rgb, 0, 1)
                    f.write(f'{rgb[0]:.6f} {rgb[1]:.6f} {rgb[2]:.6f}\n')


if __name__ == '__main__':
    main()
