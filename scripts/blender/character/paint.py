"""The atlas: flat swatches for every part, the hair strip with its highlight shape, the collar stripe, and the painted
face (layered eyes with catchlights, lashes, brows, mouths for each expression, nose, blush, tears).

Alpha is the toon shader's code (packages/render/src/characters/toon.ts): 1 normal, 0.6 hair highlight (lit side only),
0.2 unshaded (eyes). Painting is in sRGB, 2x supersampled shapes from signed distances.
"""
import math

import numpy as np

from common import linear_to_srgb

SIZE = 1024
CELL = 32          # swatch cell (px)


def srgb(lin):
    return np.array([linear_to_srgb(c) for c in lin[:3]])


def mix(a, b, t):
    return a + (b - a) * t


class Atlas:
    def __init__(self, size=SIZE):
        self.size = size
        self.img = np.zeros((size, size, 4), np.float32)
        self.img[..., 3] = 1
        self.cells = {}        # name -> (x0, y0, w, h) in px, top-left origin
        self.swatches = {}     # name -> uv centre
        self.cursor = [0, 0, 0]  # x, y, row height (feature area, top of the atlas)
        self.sw_next = 0

    # --- allocation --------------------------------------------------------------------------------------------------
    def cell(self, name, w, h):
        x, y, rh = self.cursor
        if x + w > self.size:
            x, y, rh = 0, y + rh, 0
        self.cells[name] = (x, y, w, h)
        self.cursor = [x + w, y, max(rh, h)]
        return self.cells[name]

    def uv(self, name, u, v, inset=2.0):
        """Cell-local (u, v) in 0..1 (v up) as atlas UV (glTF/Blender v up), kept `inset` px inside the cell."""
        x, y, w, h = self.cells[name]
        u = inset / w + u * (1 - 2 * inset / w)
        v = inset / h + v * (1 - 2 * inset / h)
        px = x + u * w
        py = y + (1 - v) * h
        return (px / self.size, 1 - py / self.size)

    def swatch(self, name, lin, alpha=1.0):
        """A flat colour cell at the bottom of the atlas; returns its UV centre."""
        if name in self.swatches:
            return self.swatches[name]
        per_row = self.size // CELL
        i = self.sw_next
        self.sw_next += 1
        cx = (i % per_row) * CELL
        cy = self.size - CELL * (1 + i // per_row)
        self.img[cy:cy + CELL, cx:cx + CELL, :3] = srgb(lin)
        self.img[cy:cy + CELL, cx:cx + CELL, 3] = alpha
        uv = ((cx + CELL / 2) / self.size, 1 - (cy + CELL / 2) / self.size)
        self.swatches[name] = uv
        return uv

    # --- painting ------------------------------------------------------------------------------------------------------
    def grid(self, name, ss=2):
        """Cell coordinates (u, v in 0..1, v up), supersampled."""
        x, y, w, h = self.cells[name]
        us = (np.arange(w * ss) + 0.5) / (w * ss)
        vs = 1 - (np.arange(h * ss) + 0.5) / (h * ss)
        U, V = np.meshgrid(us, vs)
        return U, V

    def put(self, name, rgb, alpha, ss=2):
        """Write a supersampled (h*ss, w*ss) layer: rgb (.., 3) sRGB, alpha code (.., ) into the cell (box-filtered)."""
        x, y, w, h = self.cells[name]
        rgb = rgb.reshape(h, ss, w, ss, 3).mean((1, 3))
        a = alpha.reshape(h, ss, w, ss).mean((1, 3))
        self.img[y:y + h, x:x + w, :3] = rgb
        self.img[y:y + h, x:x + w, 3] = a

    def rgba(self):
        return self.img


def cover(d, aa):
    """Coverage of a signed distance (negative inside) with an anti-aliasing width."""
    return np.clip(0.5 - d / aa, 0, 1)


def layer(canvas, colour, cov):
    canvas[:] = canvas * (1 - cov[..., None]) + np.array(colour)[None, None, :] * cov[..., None]


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = np.clip(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy + 1e-12), 0, 1)
    return np.hypot(px - (ax + t * dx), py - (ay + t * dy)), t


def stroke(X, Y, pts, widths):
    """Distance field of a tapered polyline (pts: list of (x, y), widths per point: half-widths)."""
    d = np.full(X.shape, 1e9)
    for i in range(len(pts) - 1):
        (ax, ay), (bx, by) = pts[i], pts[i + 1]
        dd, t = seg_dist(X, Y, ax, ay, bx, by)
        w = widths[i] + (widths[i + 1] - widths[i]) * t
        d = np.minimum(d, dd - w)
    return d


def curve(f, x0, x1, n=24):
    xs = np.linspace(x0, x1, n)
    return [(x, f(x)) for x in xs]


# ---------------------------------------------------------------------------------------------------------------------
# The face.

def eye_shape(kind):
    """Upper and lower lid curves of the left eye (x from -1 inner corner to 1 outer corner, cell coordinates -1..1)."""
    if kind == 'droopy':
        upper = lambda x: 0.62 - 0.32 * x * x - 0.14 * x
        lower = lambda x: -0.66 + 0.24 * x * x - 0.08 * x
    elif kind == 'narrow':
        upper = lambda x: 0.22 - 0.22 * x * x + 0.04 * x
        lower = lambda x: -0.34 + 0.16 * x * x
    else:
        upper = lambda x: 0.72 - 0.42 * x * x + 0.06 * x
        lower = lambda x: -0.68 + 0.26 * x * x
    return upper, lower


def paint_face(at, spec):
    skin = srgb(spec['skin'])
    line = srgb(spec['line']) * 0.9
    iris = srgb(spec['eyes'])
    hair = srgb(spec['hair']['colour'])
    lash = mix(line, hair * 0.6, 0.35) * 0.85
    kind = 'narrow' if spec['old'] > 0.3 else spec['eye_shape']
    upper, lower = eye_shape(kind)
    ss = 2
    # Open eye (left; the right eye mirrors its UVs). Cell coordinates x, y in -1..1.
    at.cell('eye', 256, 256)
    U, V = at.grid('eye', ss)
    X, Y = U * 2 - 1, V * 2 - 1
    aa = 4.0 / 256
    col = np.ones(X.shape + (3,)) * skin
    alpha = np.ones(X.shape)
    yu = upper(X)
    yl = lower(X)
    inside = np.maximum(Y - yu, yl - Y)
    inside = np.maximum(inside, np.abs(X) - 0.98)
    sc = cover(inside, aa)
    white = np.array([0.97, 0.96, 0.97])
    layer(col, white, sc)
    # iris: a tall ellipse with a darker top, a warm lower glow and a dark ring, clipped by the lids
    cx, cy = 0.04, -0.06
    rx, ry = (0.5, 0.74) if kind != 'narrow' else (0.36, 0.42)
    r = np.hypot((X - cx) / rx, (Y - cy) / ry)
    ic = cover((r - 1) * rx, aa) * sc
    t = np.clip((Y - (cy - ry)) / (2 * ry), 0, 1)[..., None]
    iris_col = mix(np.clip(iris * 1.55 + 0.05, 0, 1), iris * 0.55, t ** 0.8)
    col[:] = col * (1 - ic[..., None]) + iris_col * ic[..., None]
    ring = cover(np.abs(r - 0.95) * rx - 0.035, aa) * sc
    layer(col, iris * 0.4, ring)
    pupil = cover((np.hypot((X - cx) / (rx * 0.42), (Y - cy + 0.04) / (ry * 0.45)) - 1) * rx * 0.42, aa) * sc
    layer(col, iris * 0.22, pupil)
    # lid shadow on the white and the iris top
    lid = cover(-(Y - (yu - 0.22)), 0.12) * sc
    layer(col, np.array([0.55, 0.5, 0.58]), lid * 0.5)
    # catchlights
    for (hx, hy, hr) in ((cx + 0.2, cy + 0.26, 0.15), (cx - 0.17, cy - 0.32, 0.065)):
        layer(col, np.array([1, 1, 1]), cover(np.hypot(X - hx, Y - hy) - hr, aa) * sc)
    # upper lash line with the outer flick, the crease above, a short lower lash
    up = curve(lambda x: upper(x) + 0.02, -1.0, 1.02)
    w = [0.03 + 0.07 * smooth01((x + 1) / 2) for x, _ in up]
    d = stroke(X, Y, up + [(1.12, upper(1.0) - 0.08)], w + [0.012])
    layer(col, lash, cover(d, aa))
    crease = curve(lambda x: upper(x) + 0.2 + 0.02 * x, -0.45, 0.85, 12)
    layer(col, mix(skin, line, 0.55), cover(stroke(X, Y, crease, [0.012] * len(crease)), aa))
    lo = curve(lambda x: lower(x) - 0.02, 0.25, 0.92, 10)
    layer(col, mix(lash, skin, 0.25), cover(stroke(X, Y, lo, [0.012 + 0.018 * (x - 0.25) for x, _ in lo]), aa))
    eye_px = np.maximum(sc, cover(d, aa))
    alpha = 1 - 0.8 * eye_px
    at.put('eye', col, alpha, ss)

    # Closed eye: a soft downward arc with lashes (blink), and a happy arc (smile + blink).
    at.cell('eye_closed', 256, 128)
    U, V = at.grid('eye_closed', ss)
    X, Y = U * 2 - 1, V * 2 - 1
    col = np.ones(X.shape + (3,)) * skin
    arc = curve(lambda x: -0.05 - 0.28 * (1 - x * x) + 0.05 * x, -0.95, 1.0)
    d = stroke(X, Y, arc + [(1.1, -0.02)], [0.03 + 0.05 * smooth01((x + 1) / 2) for x, _ in arc] + [0.015])
    c = cover(d, 6.0 / 256)
    layer(col, lash, c)
    at.put('eye_closed', col, 1 - 0.8 * c, ss)

    # Brow: a thin tapered stroke, hair-dark.
    at.cell('brow', 256, 64)
    U, V = at.grid('brow', ss)
    X, Y = U * 2 - 1, V * 2 - 1
    col = np.ones(X.shape + (3,)) * skin
    thick = 1.6 if spec['old'] > 0.3 else 1.0
    pts = curve(lambda x: -0.1 + 0.35 * (1 - x * x) - 0.15 * x, -0.95, 0.95, 16)
    d = stroke(X, Y, pts, [(0.16 + 0.16 * (1 - (x + 1) / 2)) * thick for x, _ in pts])
    bc = mix(hair, line, 0.45) * 0.9
    layer(col, bc, cover(d, 6.0 / 64))
    at.put('brow', col, np.ones(X.shape), ss)

    # Mouths, one cell each (128 x 96): x, y in -1..1.
    inner = np.array([0.42, 0.16, 0.2])
    tongue = np.array([0.86, 0.45, 0.45])
    lip = mix(skin, np.array([0.85, 0.45, 0.42]), 0.45)
    mouths = {
        'mouth': lambda X, Y: (None, curve(lambda x: -0.08 * x * x + 0.02, -0.4, 0.4, 10), 0.045),
        'mouth_smile': lambda X, Y: ('open', lambda x: 0.12 + 0.12 * x * x, lambda x: 0.12 - 0.6 * (1 - x * x) ** 0.8, 0.62),
        'mouth_sad': lambda X, Y: (None, curve(lambda x: -0.1 + 0.16 * x * x, -0.32, 0.32, 10), 0.04),
        'mouth_o': lambda X, Y: ('o', 0.18, 0.28),
        'mouth_open': lambda X, Y: ('open', lambda x: 0.22 - 0.06 * x * x, lambda x: 0.2 - 0.62 * (1 - x * x) ** 0.7, 0.42),
        'mouth_set': lambda X, Y: (None, curve(lambda x: 0.04 * x * x - 0.02, -0.42, 0.42, 10), 0.04),
    }
    for name, f in mouths.items():
        at.cell(name, 128, 96)
        U, V = at.grid(name, ss)
        X, Y = U * 2 - 1, V * 2 - 1
        col = np.ones(X.shape + (3,)) * skin
        aa = 5.0 / 128
        kind = f(X, Y)
        if kind[0] is None:
            layer(col, line * 0.8 + lip * 0.2, cover(stroke(X, Y, kind[1], [kind[2]] * len(kind[1])), aa))
        elif kind[0] == 'o':
            r = np.hypot(X / kind[1], (Y + 0.05) / kind[2])
            c = cover((r - 1) * kind[1], aa)
            layer(col, inner, c)
            layer(col, line * 0.85, cover(np.abs(r - 1) * kind[1] - 0.025, aa))
        else:
            top, bot, half = kind[1], kind[2], kind[3]
            inside = np.maximum(np.maximum(Y - top(X), bot(X) - Y), np.abs(X) - half)
            c = cover(inside * 0.7, aa)
            layer(col, inner, c)
            tg = cover(np.hypot(X / (half * 0.55), (Y - bot(X * 0) - 0.12) / 0.2) - 1, 0.1) * c
            layer(col, tongue, tg)
            edge = cover(np.abs(inside) - 0.03, aa) * (np.abs(X) < half + 0.05)
            layer(col, line * 0.85, edge)
        at.put(name, col, np.ones(X.shape), ss)

    # Nose: a small soft shadow under the tip and a short line.
    at.cell('nose', 64, 64)
    U, V = at.grid('nose', ss)
    X, Y = U * 2 - 1, V * 2 - 1
    col = np.ones(X.shape + (3,)) * skin
    sh = cover(np.hypot(X / 0.35, (Y + 0.1) / 0.18) - 1, 0.5)
    layer(col, skin * np.array([0.86, 0.78, 0.8]), sh * 0.7)
    layer(col, mix(skin, line, 0.5), cover(stroke(X, Y, [(-0.18, -0.15), (0.2, -0.22)], [0.05, 0.04]), 8.0 / 64))
    at.put('nose', col, np.ones(X.shape), ss)

    # Blush: a soft pink ellipse with three short hatches.
    at.cell('blush', 128, 64)
    U, V = at.grid('blush', ss)
    X, Y = U * 2 - 1, V * 2 - 1
    col = np.ones(X.shape + (3,)) * skin
    pink = mix(skin, np.array([0.98, 0.55, 0.58]), 0.5)
    layer(col, pink, np.clip(1 - np.hypot(X / 0.85, Y / 0.7), 0, 1) ** 0.8)
    for k in (-0.4, 0, 0.4):
        layer(col, mix(pink, line, 0.25), cover(stroke(X, Y, [(k - 0.12, -0.3), (k + 0.12, 0.3)], [0.05, 0.05]), 6.0 / 64))
    at.put('blush', col, np.ones(X.shape), ss)

    # Tears: a glossy band along the lower lid with a bright edge (unshaded).
    at.cell('tear', 128, 64)
    U, V = at.grid('tear', ss)
    X, Y = U * 2 - 1, V * 2 - 1
    col = np.ones(X.shape + (3,)) * skin
    band = cover(np.abs(Y + 0.1 - 0.25 * X * X) - 0.32, 0.08) * (np.abs(X) < 0.95)
    layer(col, np.array([0.72, 0.86, 0.98]), band)
    layer(col, np.array([1, 1, 1]), cover(np.hypot((X - 0.3) / 0.25, (Y - 0.05) / 0.1) - 1, 0.2) * band)
    at.put('tear', col, 1 - 0.8 * band, ss)

    # Beauty mark / wrinkles (small marks share one cell).
    at.cell('mark', 64, 64)
    U, V = at.grid('mark', ss)
    X, Y = U * 2 - 1, V * 2 - 1
    col = np.ones(X.shape + (3,)) * skin
    layer(col, line * 0.9, cover(np.hypot(X, Y) - 0.28, 8.0 / 64))
    at.put('mark', col, np.ones(X.shape), ss)

    at.cell('wrinkle', 128, 64)
    U, V = at.grid('wrinkle', ss)
    X, Y = U * 2 - 1, V * 2 - 1
    col = np.ones(X.shape + (3,)) * skin
    for k in (-0.35, 0.3):
        pts = curve(lambda x: k + 0.12 * (1 - x * x), -0.85, 0.85, 10)
        layer(col, mix(skin, line, 0.45), cover(stroke(X, Y, pts, [0.03] * len(pts)), 6.0 / 64))
    at.put('wrinkle', col, np.ones(X.shape), ss)


def smooth01(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------------------------------------------------------------
# Hair strip and cloth details.

def paint_hair(at, name, lin, grey=0.0):
    """u across a clump, v from root (1) to tip (0): a root shadow, the jagged highlight band (alpha 0.6), darker tips."""
    base = srgb(lin)
    at.cell(name, 128, 256)
    U, V = at.grid(name, 2)
    col = np.ones(U.shape + (3,)) * base
    col *= (0.86 + 0.14 * smooth01((1 - V) / 0.25))[..., None]
    col = col * (1 - 0.1 * smooth01((0.25 - V) / 0.25))[..., None]
    # highlight band: a zigzag around v 0.8 (near the crown), wider in the clump's middle
    # clump edges darker (the separation between painted clumps)
    edge = smooth01((np.abs(U - 0.5) - 0.3) / 0.2)
    col *= (1 - 0.22 * edge)[..., None]
    zig = 0.012 * np.sin(U * math.pi * 4 + 0.6) + 0.006 * np.sin(U * math.pi * 11)
    mid = np.sin(np.clip(U, 0, 1) * math.pi)
    band = cover(np.abs(V - 0.79 - zig) - 0.022 * mid ** 1.5, 3.0 / 256) * (mid > 0.3)
    hl = np.clip(base * 1.28 + 0.07, 0, 1)
    layer(col, hl, band)
    alpha = 1 - 0.4 * band
    at.put(name, col, alpha, 2)


def paint_stripes(at, name, base_lin, line_lin, lines=2):
    """u across a band (0 inner .. 1 outer edge): the base with `lines` lines near the outer edge."""
    at.cell(name, 64, 64)
    U, V = at.grid(name, 2)
    col = np.ones(U.shape + (3,)) * srgb(base_lin)
    for k in range(lines):
        c = 0.86 - 0.1 * k
        layer(col, srgb(line_lin), cover(np.abs(U - c) - 0.022, 1.5 / 64))
    at.put(name, col, np.ones(U.shape), 2)


def paint_pleats(at, name, lin):
    """u across one pleat (0 fold .. 1 next fold): flat, a thin darker crease at the fold and a soft inner shadow."""
    base = srgb(lin)
    at.cell(name, 64, 64)
    U, V = at.grid(name, 2)
    col = np.ones(U.shape + (3,)) * base
    col *= (1 - 0.18 * smooth01((U - 0.7) / 0.3))[..., None]
    layer(col, base * 0.55, cover(U - 0.03, 1.5 / 64))
    at.put(name, col, np.ones(U.shape), 2)


def paint_watch(at, name, lin):
    at.cell(name, 64, 64)
    U, V = at.grid(name, 2)
    X, Y = U * 2 - 1, V * 2 - 1
    col = np.ones(U.shape + (3,)) * srgb(lin)
    layer(col, np.array([0.62, 0.66, 0.6]), cover(np.maximum(np.abs(X) - 0.6, np.abs(Y) - 0.45), 0.05))
    for k in (-0.35, -0.1, 0.15, 0.4):
        layer(col, np.array([0.2, 0.22, 0.2]), cover(np.maximum(np.abs(X - k) - 0.06, np.abs(Y) - 0.22), 0.05))
    at.put(name, col, np.ones(U.shape), 2)


def paint_shell(at, name, lin):
    """The seashell charm: ribs fanning from the hinge."""
    at.cell(name, 64, 64)
    U, V = at.grid(name, 2)
    col = np.ones(U.shape + (3,)) * srgb(lin)
    ang = np.arctan2(U - 0.5, V - 0.05)
    rib = 0.5 + 0.5 * np.cos(ang * 18)
    col *= (0.84 + 0.16 * rib)[..., None]
    at.put(name, col, np.ones(U.shape), 2)
