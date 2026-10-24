#!/usr/bin/env python3
"""Candidate captures against a reference folder (same file names): upscale-metrics.py ref_dir cand_dir [cand_dir ...]

Per candidate: PSNR and SSIM at full size, SSIM after a 4x4 box downsample (what survives aliasing and sub-pixel shifts),
and the detail ratio (mean gradient magnitude of the candidate over the reference's: 1.0 keeps the reference's sharpness,
below it is soft, well above it is noise or ringing)."""
import sys, os
import numpy as np
from PIL import Image
from skimage.metrics import structural_similarity as ssim


def down(a, k=4):
    h, w = a.shape[0] // k * k, a.shape[1] // k * k
    return a[:h, :w].reshape(h // k, k, w // k, k, -1).mean(axis=(1, 3))


def grad(a):
    g = a.mean(axis=2)
    return np.hypot(np.diff(g, axis=1)[:-1], np.diff(g, axis=0)[:, :-1]).mean()


ref = sys.argv[1]
for cand in sys.argv[2:]:
    rows = []
    for name in sorted(os.listdir(ref)):
        pc = os.path.join(cand, name)
        if not name.endswith('.png') or not os.path.exists(pc):
            continue
        a = np.asarray(Image.open(os.path.join(ref, name)).convert('RGB')).astype(np.float64)
        b = np.asarray(Image.open(pc).convert('RGB')).astype(np.float64)
        if a.shape != b.shape:
            continue
        mse = ((a - b) ** 2).mean()
        psnr = 99 if mse == 0 else 10 * np.log10(255 ** 2 / mse)
        rows.append((psnr, ssim(a, b, channel_axis=2, data_range=255), ssim(down(a), down(b), channel_axis=2, data_range=255), grad(b) / grad(a)))
    if rows:
        m = np.mean(rows, axis=0)
        print(f'{cand}: PSNR {m[0]:.2f} dB  SSIM {m[1]:.4f}  SSIM(4x down) {m[2]:.4f}  detail {m[3]:.2f}  ({len(rows)} frames)')
