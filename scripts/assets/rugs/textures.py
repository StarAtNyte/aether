"""
Make the texture set of every rug (and the oak of the display furniture) into a work folder:

    python3 scripts/assets/rugs/textures.py <work-dir> [id ...]

Per rug: `<id>.color.png` (4096 px on the long edge, knots / tufts / weave visible), `<id>.normal.png` (a 512 px tile of
the pile, repeated knot for knot), `<id>.rough.png` (Isfahan: silk), `<id>.fringe.png` (RGBA fringe card) and
`<id>.json` (sizes, normal repeat). CPU only (numpy, Pillow, scipy).
"""
from __future__ import annotations

import json
import math
import os
import sys
import time
import zlib

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import designs  # noqa: E402
import rugkit as K  # noqa: E402
from specs import FRINGE, RUGS  # noqa: E402

TILE = 512


def build_rug(work: str, rid: str, design: str) -> dict:
    t0 = time.time()
    d = designs.DESIGNS[design]()
    rng = np.random.default_rng(zlib.crc32(rid.encode()))
    h, w, _ = d.rgb.shape
    if d.kind == 'knot':
        tex = K.expand_knots(rng, d.rgb, d.kp)
        normal = K.knot_normal_tile(rng, TILE, d.kp)
        per_tile = TILE // d.kp  # knots per tile
        rep = (w / per_tile, h / per_tile)
    elif d.kind == 'tuft':
        tex = K.expand_tufts(rng, d.rgb, d.kp)
        normal = K.tuft_normal_tile(rng, TILE, 4.0)
        rep = (tex.shape[1] / TILE, tex.shape[0] / TILE)
    else:
        tex = K.expand_weave(rng, d.rgb, d.kp)
        normal = K.weave_normal_tile(rng, TILE, d.kp)
        rep = (tex.shape[1] / TILE, tex.shape[0] / TILE)
    K.save_rgb(os.path.join(work, f'{rid}.color.png'), tex)
    Image.fromarray(normal).save(os.path.join(work, f'{rid}.normal.png'))
    meta = {'id': rid, 'design': design, 'kind': d.kind, 'tex': [tex.shape[1], tex.shape[0]], 'knots': [w, h], 'normalRepeat': [round(rep[0], 5), round(rep[1], 5)], 'notes': d.notes}
    if d.silk is not None:
        # roughness: 0.9 wool, 0.42 silk (G channel of glTF metallicRoughness)
        r = np.where(d.silk > 0.5, 0.42, 0.9).astype(np.float32)
        r = ndi.gaussian_filter(r, 0.6)
        Image.fromarray((r * 255 + 0.5).astype(np.uint8)).save(os.path.join(work, f'{rid}.rough.png'))
        meta['rough'] = True
    if design in FRINGE:
        fr = K.fringe_texture(rng, FRINGE[design])
        Image.fromarray((np.clip(fr, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA').save(os.path.join(work, f'{rid}.fringe.png'))
        meta['fringe'] = True
    # a small preview for the contact sheet
    Image.fromarray((np.clip(tex, 0, 1) * 255).astype(np.uint8)).resize((tex.shape[1] // 8, tex.shape[0] // 8), Image.LANCZOS).save(os.path.join(work, f'{rid}.preview.png'))
    with open(os.path.join(work, f'{rid}.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    print(f'{rid}: {tex.shape[1]}x{tex.shape[0]} {d.kind}, {time.time() - t0:.1f}s', flush=True)
    return meta


def oak(work: str, rid: str, w: int, h: int, tone: str, seed: int, planks: int) -> None:
    """Quarter-sawn-ish oak: long grain lines, medullary flecks, pores, planks glued along the length (grain along V)."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    base = K.hexrgb(tone)
    pw = w / planks
    plank = np.floor(xx / pw)
    shift = rng.uniform(0, 1000, planks)[plank.astype(np.int64)]
    tint = (1 + rng.normal(0, 0.05, planks))[plank.astype(np.int64)]
    warp = K.fbm(rng, h, w, w / 3, 4) * 6 + K.value_noise(rng, h, w, h / 2) * 10
    rings = np.sin((xx + warp + shift) * 2 * math.pi / rng.uniform(5, 9)) * 0.5 + 0.5
    rings = rings ** 3
    flecks = (K.value_noise(rng, h, w, 3) > 0.55) * (K.value_noise(rng, h, w, 25) > 0.1) * 0.08
    pores = ndi.gaussian_filter(rng.standard_normal((h, w)).astype(np.float32), (6, 0.5))
    pores = (pores < -1.2) * 0.12
    lum = 1 - 0.16 * rings - pores + flecks + 0.05 * K.fbm(rng, h, w, w / 2, 3)
    lum *= tint
    # glue lines
    seam = (np.abs((xx % pw)) < 1.0) * 0.12
    lum -= seam
    col = np.clip(base[None, None, :] * lum[..., None], 0, 1)
    col[..., 2] *= 0.97
    K.save_rgb(os.path.join(work, f'{rid}.color.png'), col)
    height = -rings * 0.4 - pores * 3 - seam * 4
    Image.fromarray(K.normal_from_height(ndi.gaussian_filter(height, 0.7), 2.0)).resize((w // 2, h // 2), Image.BILINEAR).save(os.path.join(work, f'{rid}.normal.png'))
    print(f'{rid}: {w}x{h} oak', flush=True)


def main() -> None:
    work = sys.argv[1]
    want = set(sys.argv[2:])
    os.makedirs(work, exist_ok=True)
    for rid, design, *_ in RUGS:
        if want and rid not in want:
            continue
        build_rug(work, rid, design)
    if not want or 'oak' in want:
        oak(work, 'oak-light', 1024, 2048, '#c49a6c', 11, 6)
        oak(work, 'oak-smoked', 1024, 2048, '#5a4231', 12, 6)


if __name__ == '__main__':
    main()
