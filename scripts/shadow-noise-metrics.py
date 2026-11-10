#!/usr/bin/env python3
"""Noise metrics of the frames scripts/shadow-noise-probe.ts writes.

  shadow-noise-metrics.py <dir> [<dir> ...]

Per directory, on the held view (hold-*.png, camera at rest):
  hp      high-pass residual (std, 8-bit levels) of the shadow-edge patches (the dither of the penumbrae)
  tnoise  mean absolute difference between consecutive hold frames inside a smooth patch (temporal noise; 0 = frozen)
  speck   percent of pixels more than 14 levels above their 5x5 mean (the dots along shadow edges)
  cols    peak of the column-wise spectrum of the wall patch relative to its mean (stripes; ~1 = none)
Patches are fractions of the frame (x0, y0, x1, y1).
"""
import sys
import numpy as np
from PIL import Image

SHADOW = [(0.61, 0.60, 0.70, 0.69), (0.33, 0.74, 0.40, 0.80)]  # penumbra right of the table, rug edge by the chair
SPECK = [(0.612, 0.645, 0.650, 0.685), (0.680, 0.615, 0.708, 0.640)]  # shadow edges on the rug right of the table
WALL = (0.68, 0.16, 0.76, 0.27)
SMOOTH = WALL


def load(path):
    return np.asarray(Image.open(path).convert('L')).astype(np.float64)


def crop(a, f):
    h, w = a.shape
    return a[int(f[1] * h):int(f[3] * h), int(f[0] * w):int(f[2] * w)]


def box(a, k=5):
    p = k // 2
    pad = np.pad(a, p, mode='edge')
    out = np.zeros_like(a)
    for dy in range(k):
        for dx in range(k):
            out += pad[dy:dy + a.shape[0], dx:dx + a.shape[1]]
    return out / (k * k)


def hp(a):
    return float((a - box(a)).std())


def speckle(a):
    """Share of pixels that stand out from the 5x5 mean by more than 14 levels (isolated lit dots on shadow edges)."""
    d = a - box(a)
    return float((d > 14).mean() * 100)


def cols(a):
    c = a.mean(0)
    c = c - np.convolve(c, np.ones(9) / 9, 'same')
    c = c[8:-8]
    return float(np.abs(np.fft.rfft(c)[1:]).max() / (np.abs(np.fft.rfft(c)[1:]).mean() + 1e-9))


for d in sys.argv[1:]:
    import glob
    hold = sorted(glob.glob(f'{d}/hold-*.png'))
    fr = [load(p) for p in hold]
    h = np.mean([np.mean([hp(crop(f, s)) for s in SHADOW]) for f in fr])
    t = np.mean([np.abs(crop(fr[i + 1], SMOOTH) - crop(fr[i], SMOOTH)).mean() for i in range(len(fr) - 1)]) if len(fr) > 1 else float('nan')
    ts = np.mean([np.abs(crop(fr[i + 1], SHADOW[0]) - crop(fr[i], SHADOW[0])).mean() for i in range(len(fr) - 1)]) if len(fr) > 1 else float('nan')
    c = np.mean([cols(crop(f, WALL)) for f in fr])
    sp = np.mean([np.mean([speckle(crop(f, s)) for s in SPECK]) for f in fr])
    print(f'{d.split("/")[-1]:24s} hp {h:6.3f}  tnoise(wall) {t:6.3f}  tnoise(shadow) {ts:6.3f}  speck {sp:5.2f}%  cols {c:5.2f}')
