#!/usr/bin/env python3
"""Pixel diff of two folders of PNGs with the same names: mean abs error (0..255) and the share of pixels off by more than 8."""
import sys, os
import numpy as np
from PIL import Image

a_dir, b_dir = sys.argv[1], sys.argv[2]
for name in sorted(os.listdir(a_dir)):
    pb = os.path.join(b_dir, name)
    if not name.endswith('.png') or not os.path.exists(pb):
        continue
    a = np.asarray(Image.open(os.path.join(a_dir, name)).convert('RGB')).astype(int)
    b = np.asarray(Image.open(pb).convert('RGB')).astype(int)
    if a.shape != b.shape:
        print(name, 'size differs', a.shape, b.shape)
        continue
    d = np.abs(a - b)
    print(f'{name}: mean {d.mean():.2f} / 255, over 8: {(d.max(axis=2) > 8).mean() * 100:.2f} %')
