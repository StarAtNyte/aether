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
PAD = 6            # gutter round a painted cell (px)


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
        """A painted cell with a gutter of PAD px all round (filled from the cell's edges by `put`), so filtering and
        the smaller mip levels never pull a neighbour's colour into a decal's margin."""
        x, y, rh = self.cursor
        if x + w + 2 * PAD > self.size:
            x, y, rh = 0, y + rh, 0
        self.cells[name] = (x + PAD, y + PAD, w, h)
        self.cursor = [x + w + 2 * PAD, y, max(rh, h + 2 * PAD)]
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
        # the gutter: the cell's edge pixels carried outward (rows, then columns with the corners)
        p = PAD
        self.img[y - p:y, x:x + w] = self.img[y:y + 1, x:x + w]
        self.img[y + h:y + h + p, x:x + w] = self.img[y + h - 1:y + h, x:x + w]
        self.img[y - p:y + h + p, x - p:x] = self.img[y - p:y + h + p, x:x + 1]
        self.img[y - p:y + h + p, x + w:x + w + p] = self.img[y - p:y + h + p, x + w - 1:x + w]

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
    elif kind == 'sheet':
        # the concept sheets' almond: lower and longer than the round eye, the lid's peak toward the inner third
        upper = lambda x: 0.47 - 0.4 * x * x - 0.05 * x
        lower = lambda x: -0.42 + 0.22 * x * x
    elif kind == 'narrow':
        upper = lambda x: 0.22 - 0.22 * x * x + 0.04 * x
        lower = lambda x: -0.34 + 0.16 * x * x
    else:
        upper = lambda x: 0.62 - 0.4 * x * x + 0.06 * x
        lower = lambda x: -0.58 + 0.24 * x * x
    return upper, lower


def paint_face(at, spec):
    if spec.get('face_style') == 'painted':
        return paint_face_cel(at, spec)
    # a painted face (face_style = painted) is drawn at twice the cell size on the 2048 atlas: sharper lines, same shapes
    FS = 2 if spec.get('face_style') == 'painted' else 1
    skin = srgb(spec['skin'])
    line = srgb(spec['line']) * 0.9
    iris = srgb(spec['eyes'])
    hair = srgb(spec['hair']['colour'])
    lash = mix(line, hair * 0.55, 0.55) * 0.9
    kind = 'narrow' if spec['old'] > 0.3 else spec['eye_shape']
    if FS == 2 and kind == 'round':
        kind = 'sheet'
    upper, lower = eye_shape(kind)
    ss = 2
    # Open eye (left; the right eye mirrors its UVs). Cell coordinates x, y in -1..1.
    at.cell('eye', 256 * FS, 256 * FS)
    U, V = at.grid('eye', ss)
    X, Y = U * 2 - 1, V * 2 - 1
    aa = 4.0 / (256 * FS)
    col = np.ones(X.shape + (3,)) * skin
    alpha = np.ones(X.shape)
    yu = upper(X)
    yl = lower(X)
    inside = np.maximum(Y - yu, yl - Y)
    inside = np.maximum(inside, np.abs(X) - 0.98)
    sc = cover(inside, aa)
    white = np.array([0.97, 0.96, 0.97])
    layer(col, white, sc)
    # the sheet's own iris colours when it has them (build.sheet_fit: the eye's mid tone and its darkest tenth)
    sf = ((spec.get('sheet_fit') or {}).get('head') or {}).get('eyes') or []
    if sf:
        mid = np.mean([e['iris'] for e in sf], 0)
        deep = np.mean([e['dark'] for e in sf], 0)
        # keep the brief's hue, take the sheet's value and depth (a painted iris reads darker than its swatch)
        iris = mix(iris, mid, 0.6)
        iris_deep = mix(iris * 0.3, deep, 0.6)
    else:
        iris_deep = iris * 0.3
    # sclera: cool white, shaded under the upper lid and toward the corners
    shade = np.clip(1 - (yu - Y) / 0.5, 0, 1) ** 2
    corner = smooth01((np.abs(X) - 0.6) / 0.4)
    scl = white[None, None, :] * (1 - 0.16 * shade[..., None] - 0.08 * corner[..., None]) + np.array([-0.03, -0.01, 0.02]) * shade[..., None]
    col[:] = col * (1 - sc[..., None]) + scl * sc[..., None]
    # the iris: large (its top always under the lid), in layers like a painted anime eye
    cx, cy = 0.0, -0.08
    rx, ry = (0.62, 0.78) if kind not in ('narrow', 'sheet') else (0.4, 0.5) if kind == 'narrow' else (0.52, 0.66)
    r = np.hypot((X - cx) / rx, (Y - cy) / ry)
    ic = cover((r - 1) * rx, aa) * sc
    t = np.clip((Y - (cy - ry)) / (2 * ry), 0, 1)
    # 1. the base: light at the bottom, deep at the top
    base_c = mix(np.clip(iris * 1.45 + 0.06, 0, 1), iris_deep, (t ** 0.9)[..., None])
    col[:] = col * (1 - ic[..., None]) + base_c * ic[..., None]
    # 2. fibres: fine radial strokes, a little darker
    ang = np.arctan2(Y - cy, X - cx)
    fib = (0.5 + 0.5 * np.sin(ang * 23 + np.sin(ang * 7) * 1.5)) * smooth01((r - 0.35) / 0.3) * (1 - smooth01((r - 0.92) / 0.08))
    layer(col, iris_deep, ic * fib * 0.18)
    # 3. the lid's shadow over the iris' top third (a hard band, the way it is painted)
    band = cover((yu - 0.36) - Y, 0.05) * ic
    layer(col, iris_deep * 0.9, band * 0.55)
    # 4. the lower crescent of light (the iris lit through from below)
    cres = cover(np.hypot((X - cx) / (rx * 0.78), (Y - cy + ry * 0.38) / (ry * 0.42)) - 1, 0.18) * ic * (Y < cy)
    layer(col, np.clip(iris * 1.8 + 0.12, 0, 1), cres * 0.75)
    # 5. the limbal ring
    ring = cover(np.abs(r - 0.96) * rx - 0.03, aa) * sc
    layer(col, iris_deep * 0.7, ring)
    # 6. the pupil, a soft tall oval
    pr = np.hypot((X - cx) / (rx * 0.36), (Y - cy + 0.02) / (ry * 0.42))
    layer(col, iris_deep * 0.55, cover((pr - 1) * rx * 0.36, aa) * sc)
    # 7. catchlights: the key (upper outer), a small second one (lower inner), a soft reflected arc
    for (hx, hy, hrx, hry) in ((cx + 0.2, cy + 0.3, 0.15, 0.17), (cx - 0.2, cy - 0.34, 0.07, 0.06)):
        layer(col, np.array([1, 1, 1]), cover((np.hypot((X - hx) / hrx, (Y - hy) / hry) - 1) * hrx, aa) * sc)
    arc = cover(np.abs(np.hypot((X - cx) / (rx * 0.7), (Y - cy) / (ry * 0.7)) - 1) * rx - 0.018, aa) * ic * (Y < cy - 0.25) * (X > cx - 0.1)
    layer(col, np.clip(iris * 2.0 + 0.25, 0, 1), arc * 0.55)
    # upper lash line: heavy, tapered at the inner corner, thickest past the middle, three lash points at the outer end
    up = curve(lambda x: upper(x) + 0.025, -1.0, 1.02)
    w = [0.042 + 0.09 * smooth01((x + 0.9) / 1.4) for x, _ in up]
    d = stroke(X, Y, up + [(1.14, upper(1.0) - 0.06)], w + [0.01])
    for (lx, ly, ex, ey) in ((0.62, 0.05, 0.86, 0.3), (0.82, 0.0, 1.08, 0.18), (0.95, -0.06, 1.2, 0.02)):
        y0 = upper(lx) + ly
        d = np.minimum(d, stroke(X, Y, [(lx, y0), (ex, upper(min(1, ex)) + ey)], [0.03, 0.006]))
    layer(col, lash, cover(d, aa) * 0.92)
    crease = curve(lambda x: upper(x) + 0.22 + 0.02 * x, -0.45, 0.85, 12)
    layer(col, mix(skin, line, 0.5), cover(stroke(X, Y, crease, [0.014] * len(crease)), aa))
    # lower lash: thin, the outer half, with two short ticks
    lo = curve(lambda x: lower(x) - 0.02, 0.15, 0.95, 10)
    layer(col, mix(lash, skin, 0.25), cover(stroke(X, Y, lo, [0.01 + 0.02 * (x - 0.15) for x, _ in lo]), aa))
    for tx in (0.55, 0.78):
        ty = lower(tx) - 0.02
        layer(col, mix(lash, skin, 0.35), cover(stroke(X, Y, [(tx, ty), (tx + 0.06, ty - 0.1)], [0.014, 0.004]), aa))
    eye_px = np.maximum(sc, cover(d, aa))
    alpha = 1 - 0.8 * eye_px
    at.put('eye', col, alpha, ss)

    # Closed eye: a soft downward arc with lashes (blink), and a happy arc (smile + blink).
    at.cell('eye_closed', 256 * FS, 128 * FS)
    U, V = at.grid('eye_closed', ss)
    X, Y = U * 2 - 1, V * 2 - 1
    col = np.ones(X.shape + (3,)) * skin
    arc = curve(lambda x: -0.05 - 0.28 * (1 - x * x) + 0.05 * x, -0.95, 1.0)
    d = stroke(X, Y, arc + [(1.1, -0.02)], [0.03 + 0.05 * smooth01((x + 1) / 2) for x, _ in arc] + [0.015])
    c = cover(d, 6.0 / (256 * FS))
    layer(col, lash, c)
    at.put('eye_closed', col, 1 - 0.8 * c, ss)

    # Brow: a thin tapered stroke, hair-dark.
    at.cell('brow', 256 * FS, 64 * FS)
    U, V = at.grid('brow', ss)
    X, Y = U * 2 - 1, V * 2 - 1
    col = np.ones(X.shape + (3,)) * skin
    thick = 1.6 if spec['old'] > 0.3 else 1.0
    pts = curve(lambda x: -0.1 + 0.35 * (1 - x * x) - 0.15 * x, -0.95, 0.95, 16)
    d = stroke(X, Y, pts, [(0.13 + 0.1 * (1 - (x + 1) / 2) ** 1.5) * thick for x, _ in pts])
    bc = mix(hair * 0.78, skin * 0.5, 0.12)
    layer(col, bc, cover(d, 8.0 / (64 * FS)) * 0.97)
    at.put('brow', col, np.ones(X.shape), ss)

    # Mouths, one cell each (128 x 96): x, y in -1..1.
    inner = np.array([0.42, 0.16, 0.2])
    tongue = np.array([0.86, 0.45, 0.45])
    lip = mix(skin, np.array([0.85, 0.45, 0.42]), 0.45)
    mouths = {
        'mouth': lambda X, Y: ('lips',),
        'mouth_smile': lambda X, Y: ('smile',),
        'mouth_sad': lambda X, Y: (None, curve(lambda x: -0.1 + 0.16 * x * x, -0.32, 0.32, 10), 0.04),
        'mouth_o': lambda X, Y: ('o', 0.18, 0.28),
        'mouth_open': lambda X, Y: ('open', lambda x: 0.22 - 0.06 * x * x, lambda x: 0.2 - 0.62 * (1 - x * x) ** 0.7, 0.42),
        'mouth_set': lambda X, Y: (None, curve(lambda x: 0.04 * x * x - 0.02, -0.42, 0.42, 10), 0.04),
    }
    for name, f in mouths.items():
        at.cell(name, 128 * FS, 96 * FS)
        U, V = at.grid(name, ss)
        X, Y = U * 2 - 1, V * 2 - 1
        col = np.ones(X.shape + (3,)) * skin
        aa = 5.0 / (128 * FS)
        kind = f(X, Y)
        if kind[0] == 'lips':
            lipc = mix(skin * 0.5, line, 0.3) * np.array([1.0, 0.8, 0.78])
            # the lower lip's tone, soft, under the line
            layer(col, lip, cover(np.hypot(X / 0.3, (Y + 0.26) / 0.12) - 1, 0.6) * 0.45)
            # a calm line: its middle a touch heavier, its ends fading out, the corners barely lifted
            pts = curve(lambda x: 0.04 + 0.1 * x * x, -0.46, 0.46, 18)
            wd = [0.055 * (1 - 0.7 * (abs(x) / 0.46) ** 2) + 0.012 for x, _ in pts]
            layer(col, lipc, cover(stroke(X, Y, pts, wd), aa))
        elif kind[0] == 'smile':
            # a gentle closed smile: a shallow U, its corners lifted into small cheeks, the lower lip's tone under it
            lipc = mix(skin * 0.5, line, 0.3) * np.array([1.0, 0.8, 0.78])
            layer(col, lip, cover(np.hypot(X / 0.34, (Y + 0.24) / 0.15) - 1, 0.6) * 0.5)
            pts = curve(lambda x: 0.14 - 0.34 * (1 - x * x) ** 0.9 + 0.0, -0.56, 0.56, 22)
            wd = [0.05 * (1 - 0.6 * (abs(x) / 0.56) ** 2) + 0.012 for x, _ in pts]
            layer(col, lipc, cover(stroke(X, Y, pts, wd), aa))
            for sg in (-1, 1):
                layer(col, lipc, cover(stroke(X, Y, [(sg * 0.6, 0.16), (sg * 0.64, 0.26)], [0.025, 0.01]), aa))
        elif kind[0] is None:
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
    at.cell('nose', 64 * FS, 64 * FS)
    U, V = at.grid('nose', ss)
    X, Y = U * 2 - 1, V * 2 - 1
    col = np.ones(X.shape + (3,)) * skin
    sh = cover(np.hypot((X - 0.04) / 0.5, (Y + 0.22) / 0.22) - 1, 0.55)
    layer(col, skin * np.array([0.84, 0.74, 0.76]), sh * 0.75)
    # the bridge's shaded side and the tip's own small shape
    layer(col, skin * np.array([0.9, 0.84, 0.85]), cover(stroke(X, Y, [(-0.12, 0.7), (-0.2, 0.05)], [0.1, 0.16]), 0.6) * 0.55)
    nl = mix(skin * 0.55, line, 0.3)
    layer(col, nl, cover(stroke(X, Y, curve(lambda x: -0.18 - 0.1 * np.cos(x * 3.0), -0.34, 0.3, 8), [0.045] * 8), 8.0 / (64 * FS)) * 0.9)
    layer(col, nl, cover(stroke(X, Y, [(-0.3, -0.2), (-0.34, -0.12)], [0.04, 0.02]), 8.0 / (64 * FS)) * 0.8)
    at.put('nose', col, np.ones(X.shape), ss)

    # Blush: a soft pink ellipse with three short hatches.
    at.cell('blush', 128 * FS, 64 * FS)
    U, V = at.grid('blush', ss)
    X, Y = U * 2 - 1, V * 2 - 1
    col = np.ones(X.shape + (3,)) * skin
    pink = mix(skin, np.array([0.98, 0.55, 0.58]), 0.5)
    layer(col, pink, np.clip(1 - np.hypot(X / 0.85, Y / 0.7), 0, 1) ** 0.8)
    for k in (-0.4, 0, 0.4):
        layer(col, mix(pink, line, 0.25), cover(stroke(X, Y, [(k - 0.12, -0.3), (k + 0.12, 0.3)], [0.05, 0.05]), 6.0 / (64 * FS)))
    at.put('blush', col, np.ones(X.shape), ss)

    # Tears: a glossy band along the lower lid with a bright edge (unshaded).
    at.cell('tear', 128 * FS, 64 * FS)
    U, V = at.grid('tear', ss)
    X, Y = U * 2 - 1, V * 2 - 1
    col = np.ones(X.shape + (3,)) * skin
    band = cover(np.abs(Y + 0.1 - 0.25 * X * X) - 0.32, 0.08) * (np.abs(X) < 0.95)
    layer(col, np.array([0.72, 0.86, 0.98]), band)
    layer(col, np.array([1, 1, 1]), cover(np.hypot((X - 0.3) / 0.25, (Y - 0.05) / 0.1) - 1, 0.2) * band)
    at.put('tear', col, 1 - 0.8 * band, ss)

    # Beauty mark / wrinkles (small marks share one cell).
    at.cell('mark', 64 * FS, 64 * FS)
    U, V = at.grid('mark', ss)
    X, Y = U * 2 - 1, V * 2 - 1
    col = np.ones(X.shape + (3,)) * skin
    layer(col, line * 0.9, cover(np.hypot(X, Y) - 0.28, 8.0 / (64 * FS)))
    at.put('mark', col, np.ones(X.shape), ss)

    at.cell('wrinkle', 128 * FS, 64 * FS)
    U, V = at.grid('wrinkle', ss)
    X, Y = U * 2 - 1, V * 2 - 1
    col = np.ones(X.shape + (3,)) * skin
    for k in (-0.35, 0.3):
        pts = curve(lambda x: k + 0.12 * (1 - x * x), -0.85, 0.85, 10)
        layer(col, mix(skin, line, 0.45), cover(stroke(X, Y, pts, [0.03] * len(pts)), 6.0 / (64 * FS)))
    at.put('wrinkle', col, np.ones(X.shape), ss)


def smooth01(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------------------------------------------------------------
# The cel face (face_style = painted): the anime look of the concept sheets, drawn as hard-edged cel shapes.

# Skin kept round a feature, in cell widths; beyond it the decal is a hole (atlas alpha 0). Thin: the decals float a
# fraction of a millimetre over the face and cast into the sun's map, so the ring's edge draws its own shadow line on
# the skin beside it; kept this close it falls on the feature's own dark edge.
RING = 0.012


def dilate(m, r):
    """Binary dilation of a mask by r px (an octagon: alternating cross and square steps)."""
    out = m.copy()
    for i in range(r):
        n = out.copy()
        n[1:] = np.maximum(n[1:], out[:-1])
        n[:-1] = np.maximum(n[:-1], out[1:])
        n[:, 1:] = np.maximum(n[:, 1:], out[:, :-1])
        n[:, :-1] = np.maximum(n[:, :-1], out[:, 1:])
        if i % 2:
            n[1:, 1:] = np.maximum(n[1:, 1:], out[:-1, :-1])
            n[:-1, :-1] = np.maximum(n[:-1, :-1], out[1:, 1:])
            n[1:, :-1] = np.maximum(n[1:, :-1], out[:-1, 1:])
            n[:-1, 1:] = np.maximum(n[:-1, 1:], out[1:, :-1])
        out = n
    return out


def put_cut(at, name, col, code, feat, ss=2):
    """Write a face cell whose margin is cut away: the features (coverage `feat`) and a thin ring of skin round them
    keep their codes, the rest of the decal is a hole (alpha 0), so the head's own skin shows there and a decal's
    rectangle can never shade differently from the face around it. The ring keeps the features' coverage up in the
    smaller mip levels (a far face keeps its eyes)."""
    w = feat.shape[1]
    keep = dilate((feat > 0.02).astype(np.float32), max(2, int(RING * w)))
    at.put(name, col, np.where(keep > 0.5, code, 0.0), ss)


def eye_lids(kind):
    """Upper and lower lids of the left eye (x from -1 inner corner to 1 outer corner), large and tall like the
    sheets': the lids meet in points at the corners; `gentle` (Mio) lets the outer corner fall, `sheet` (Kaho) lifts it."""
    tilt = -0.07 if kind == 'droopy' else 0.06
    def yc(x):
        return 0.0 + tilt * x
    def upper(x):
        x = np.clip(x, -1, 1)
        return yc(x) + 0.56 * (1 - x * x) ** 0.55 * (1 - 0.1 * x)
    def lower(x):
        x = np.clip(x, -1, 1)
        return yc(x) - 0.43 * (1 - x * x) ** 0.8
    return upper, lower


def paint_face_cel(at, spec):
    FS = 2
    ss = 2
    skin = srgb(spec['skin'])
    line = srgb(spec['line']) * 0.9
    iris = srgb(spec['eyes'])
    hair = srgb(spec['hair']['colour'])
    # the lash line: near black with the hair's warmth (sheets draw it darker than the hair)
    lash = np.clip(mix(line * 0.75, hair * 0.45, 0.3), 0, 1)
    kind = spec['eye_shape']
    upper, lower = eye_lids(kind)
    droopy = kind == 'droopy'

    # --- the open eye (left; the right mirrors its UVs) --------------------------------------------------------------
    at.cell('eye', 256 * FS, 256 * FS)
    U, V = at.grid('eye', ss)
    X, Y = U * 2 - 1, V * 2 - 1
    aa = 3.0 / (256 * FS)
    col = np.ones(X.shape + (3,)) * skin
    yu, yl = upper(X), lower(X)
    inside = np.maximum(np.maximum(Y - yu, yl - Y), np.abs(X) - 0.99)
    sc = cover(inside, aa)
    white = np.array([0.98, 0.97, 0.98])
    layer(col, white, sc)
    # the sclera's cel shadow under the upper lid: one flat cool band
    lidsh = cover(Y - (yu - 0.1 - 0.02 * np.cos(X * 2)), aa) * sc
    layer(col, np.array([0.86, 0.86, 0.94]), lidsh)
    sf = ((spec.get('sheet_fit') or {}).get('head') or {}).get('eyes') or []
    if sf:
        mid = np.mean([e['iris'] for e in sf], 0)
        deep = np.mean([e['dark'] for e in sf], 0)
        iris = mix(iris, mid, 0.5)
        iris_deep = mix(iris * 0.32, deep, 0.5)
    else:
        iris_deep = iris * 0.32
    iris = np.clip(iris * 1.12, 0, 1)
    iris_light = np.clip(iris * 1.55 + np.array([0.08, 0.06, 0.05]), 0, 1)
    iris_deep = np.clip(iris_deep * 0.85, 0, 1)
    # the iris: big, its top under the lash line, its bottom cut by the lower lid
    cx, cy = (0.02, -0.03)
    rx, ry = 0.48, 0.58
    r = np.hypot((X - cx) / rx, (Y - cy) / ry)
    ic = cover((r - 1) * rx, aa) * sc
    layer(col, iris, ic)
    # the deep upper half: a hard curved edge (the lid's shadow on the iris and the iris' own dark top in one)
    top = cover((cy + 0.05 - 0.12 * ((X - cx) / rx) ** 2) - Y, aa)
    layer(col, iris_deep, ic * (1 - top))
    # the lit lower crescent
    cres = cover(np.hypot((X - cx) / (rx * 0.72), (Y - (cy - ry * 0.48)) / (ry * 0.36)) - 1, 0.03) * ic
    layer(col, iris_light, cres)
    # a few fibres in the light, soft
    ang = np.arctan2(Y - cy, X - cx)
    fib = (np.sin(ang * 17) > 0.6) * smooth01((r - 0.45) / 0.15) * (r < 0.9)
    layer(col, mix(iris_light, iris, 0.6), ic * fib * cres * 0.5)
    # the limbal ring and the pupil
    layer(col, iris_deep * 0.8, cover(np.abs(r - 0.97) * rx - 0.028, aa) * sc)
    pr = np.hypot((X - cx) / 0.17, (Y - (cy + 0.04)) / 0.25)
    layer(col, iris_deep * 0.45, cover((pr - 1) * 0.17, aa) * ic)
    # catchlights: the key (upper, toward the outer corner), a small second (lower inner), a dot
    for (hx, hy, hrx, hry) in ((cx + 0.17, cy + 0.24, 0.15, 0.17), (cx - 0.2, cy - 0.3, 0.075, 0.065), (cx + 0.3, cy - 0.12, 0.035, 0.035)):
        layer(col, np.array([1.0, 1.0, 1.0]), cover((np.hypot((X - hx) / hrx, (Y - hy) / hry) - 1) * hrx, aa) * sc)
    # the upper lash line: heavy, thin at the inner corner, thickest toward the outer third, ending in a flick
    xs = np.linspace(-1.0, 1.0, 40)
    up = [(x, float(upper(x)) + 0.02 + 0.03 * smooth01((x - 0.3) / 0.7)) for x in xs]
    w = [0.02 + 0.085 * smooth01((x + 0.85) / 1.35) for x in xs]
    flick = (1.17, float(upper(1.0)) + (0.0 if droopy else 0.12))
    d = stroke(X, Y, up + [flick], w + [0.008])
    # two small lash points past the outer end
    for (lx, ex, ey) in ((0.7, 1.0, 0.36 if not droopy else 0.26), (0.86, 1.1, 0.24 if not droopy else 0.12)):
        y0 = float(upper(lx)) + 0.06
        d = np.minimum(d, stroke(X, Y, [(lx, y0), (ex, y0 + ey * 0.6)], [0.035, 0.006]))
    lc = cover(d, aa)
    layer(col, lash, lc)
    # the crease: a thin line above the lid
    cr = [(x, float(upper(x)) + 0.2 + 0.02 * x) for x in np.linspace(-0.4, 0.85, 12)]
    crc = cover(stroke(X, Y, cr, [0.012] * len(cr)), aa)
    layer(col, mix(skin, lash, 0.55), crc)
    # the lower lash: a fine line on the outer half, a touch of the inner corner
    lo = [(x, float(lower(x)) - 0.03) for x in np.linspace(0.1, 0.97, 12)]
    loc = cover(stroke(X, Y, lo, [0.008 + 0.018 * smooth01((x - 0.1) / 0.8) for x, _ in lo]), aa)
    layer(col, mix(lash, skin, 0.3), loc)
    eye_px = np.maximum(sc, lc)
    put_cut(at, 'eye', col, np.where(eye_px > 0.5, 0.2, 1.0), np.maximum(np.maximum(eye_px, crc), loc), ss)

    # --- closed eye: a downward arc of lash (blink) ------------------------------------------------------------------
    at.cell('eye_closed', 256 * FS, 128 * FS)
    U, V = at.grid('eye_closed', ss)
    X, Y = U * 2 - 1, V * 2 - 1
    col = np.ones(X.shape + (3,)) * skin
    xs = np.linspace(-0.95, 1.0, 30)
    arc = [(x, -0.05 - 0.3 * (1 - x * x) + (0.0 if droopy else 0.06) * x) for x in xs]
    d = stroke(X, Y, arc + [(1.12, 0.02)], [0.035 + 0.07 * smooth01((x + 0.9) / 1.6) for x in xs] + [0.012])
    c = cover(d, 5.0 / (256 * FS))
    layer(col, lash, c)
    put_cut(at, 'eye_closed', col, np.where(c > 0.5, 0.2, 1.0), c, ss)

    # --- brow: a crisp tapered stroke, thick at the inner end ---------------------------------------------------------
    at.cell('brow', 256 * FS, 64 * FS)
    U, V = at.grid('brow', ss)
    X, Y = U * 2 - 1, V * 2 - 1
    asp = 4.0
    Xa = X * asp
    xs = np.linspace(-0.92, 0.95, 20)
    pts = [(x * asp, -0.3 + 0.4 * (1 - x * x) - 0.06 * x) for x in xs]
    wd = [0.32 * (1 - 0.75 * smooth01((x + 0.9) / 1.85)) + 0.045 for x in xs]
    bc = np.clip(mix(hair * 0.6, lash, 0.3), 0, 1)
    c = cover(stroke(Xa, Y, pts, wd), 6.0 / (64 * FS))
    col = np.ones(X.shape + (3,)) * skin
    layer(col, bc, c)
    put_cut(at, 'brow', col, np.ones(X.shape), c, ss)

    # --- mouths (cells 4:3; x, y in -1..1) ----------------------------------------------------------------------------
    inner = np.array([0.5, 0.18, 0.22])
    tongue = np.array([0.9, 0.5, 0.5])
    mline = np.clip(mix(lash, np.array([0.55, 0.22, 0.22]), 0.35), 0, 1)
    asp = 4.0 / 3.0

    def tapered(f, x0, x1, w0, n=24):
        xs = np.linspace(x0, x1, n)
        pts = [(x * asp, f(x)) for x in xs]
        m = (x0 + x1) / 2
        hw = (x1 - x0) / 2
        return pts, [w0 * (1 - 0.65 * ((x - m) / hw) ** 2) + 0.008 for x in xs]

    for name in ('mouth', 'mouth_smile', 'mouth_sad', 'mouth_o', 'mouth_open', 'mouth_set'):
        at.cell(name, 128 * FS, 96 * FS)
        U, V = at.grid(name, ss)
        X, Y = U * 2 - 1, V * 2 - 1
        Xa = X * asp
        col = np.ones(X.shape + (3,)) * skin
        aa = 4.0 / (96 * FS)
        feat = np.zeros(X.shape)
        if name == 'mouth':
            # calm: a short line, its ends barely lifted
            pts, wd = tapered(lambda x: 0.02 + 0.08 * x * x, -0.34, 0.34, 0.05)
            c = cover(stroke(Xa, Y, pts, wd), aa)
            layer(col, mline, c)
            feat = c
        elif name == 'mouth_smile':
            # a gentle closed smile: a shallow curve, the corners lifted
            pts, wd = tapered(lambda x: -0.06 + 0.32 * x * x, -0.5, 0.5, 0.055)
            c = cover(stroke(Xa, Y, pts, wd), aa)
            layer(col, mline, c)
            feat = c
        elif name == 'mouth_sad':
            pts, wd = tapered(lambda x: 0.0 - 0.2 * x * x + 0.03, -0.36, 0.36, 0.05)
            c = cover(stroke(Xa, Y, pts, wd), aa)
            layer(col, mline, c)
            feat = c
        elif name == 'mouth_set':
            pts, wd = tapered(lambda x: 0.02 - 0.05 * x * x, -0.36, 0.36, 0.055)
            c = cover(stroke(Xa, Y, pts, wd), aa)
            layer(col, mline, c)
            feat = c
        else:
            if name == 'mouth_o':
                # a small open mouth, its top flatter (the sheets' surprise)
                half, topf, botf = 0.3, (lambda x: 0.26 - 0.15 * x * x), (lambda x: -0.42 + 0.55 * x * x)
            else:
                # open: a wide D, the top nearly straight, the bottom round
                half, topf, botf = 0.4, (lambda x: 0.24 - 0.08 * x * x), (lambda x: 0.22 - 0.72 * np.clip(1 - (x / 0.4) ** 2, 0, 1) ** 0.6)
            inside = np.maximum(np.maximum(Y - topf(X), botf(X) - Y), np.abs(X) - half)
            c = cover(inside, aa)
            layer(col, inner, c)
            tg = cover(np.hypot(X / (half * 0.6), (Y - botf(0 * X) - 0.06) / 0.16) - 1, 0.03) * c
            layer(col, tongue, tg)
            edge = cover(np.abs(inside) - 0.03, aa)
            layer(col, mline, edge)
            feat = np.maximum(c, edge)
        put_cut(at, name, col, np.ones(X.shape), feat, ss)

    # --- nose: a short tick on its shaded side and a small hard shadow under the tip ----------------------------------
    at.cell('nose', 64 * FS, 64 * FS)
    U, V = at.grid('nose', ss)
    X, Y = U * 2 - 1, V * 2 - 1
    col = np.ones(X.shape + (3,)) * skin
    aa = 5.0 / (64 * FS)
    sh = cover(np.hypot((X + 0.05) / 0.28, (Y + 0.32) / 0.1) - 1, 0.15) * (Y < -0.28)
    layer(col, skin * np.array([0.9, 0.82, 0.84]), sh)
    tick = cover(stroke(X, Y, [(-0.16, 0.2), (-0.2, -0.12), (-0.08, -0.26)], [0.03, 0.05, 0.03]), aa)
    nl = np.clip(mix(skin * 0.6, line, 0.25), 0, 1)
    layer(col, nl, tick * 0.9)
    put_cut(at, 'nose', col, np.ones(X.shape), np.maximum(tick, sh), ss)

    # --- blush: a soft pink oval with three fine hatches ---------------------------------------------------------------
    at.cell('blush', 128 * FS, 64 * FS)
    U, V = at.grid('blush', ss)
    X, Y = U * 2 - 1, V * 2 - 1
    col = np.ones(X.shape + (3,)) * skin
    pink = mix(skin, np.array([0.97, 0.56, 0.6]), 0.3)
    # (a cel oval with a hard edge: a soft one would end in skin, then the ring, then its shadow line round it)
    soft = cover((np.hypot(X / 0.78, Y / 0.56) - 1) * 0.6, 0.04)
    layer(col, pink, soft)
    hatch = np.zeros(X.shape)
    for k in (-0.3, 0.0, 0.3):
        hatch = np.maximum(hatch, cover(stroke(X * 2, Y, [((k - 0.08) * 2, -0.28), ((k + 0.08) * 2, 0.28)], [0.035, 0.035]), 5.0 / (64 * FS)))
    layer(col, mix(pink, line, 0.18), hatch * 0.8)
    put_cut(at, 'blush', col, np.ones(X.shape), np.maximum(soft, hatch), ss)

    # --- tears: a glossy band along the lower lid with a bright edge (unshaded) ---------------------------------------
    at.cell('tear', 128 * FS, 64 * FS)
    U, V = at.grid('tear', ss)
    X, Y = U * 2 - 1, V * 2 - 1
    col = np.ones(X.shape + (3,)) * skin
    band = cover((np.abs(Y + 0.05 - 0.3 * X * X) - 0.16) * 2, 0.05) * (np.abs(X) < 0.85)
    layer(col, np.array([0.74, 0.88, 0.99]), band)
    layer(col, np.array([1, 1, 1]), cover(np.hypot((X - 0.3) / 0.22, (Y - 0.05) / 0.09) - 1, 0.1) * band)
    put_cut(at, 'tear', col, np.where(band > 0.5, 0.2, 1.0), band, ss)

    # --- beauty mark / wrinkles -----------------------------------------------------------------------------------------
    at.cell('mark', 64 * FS, 64 * FS)
    U, V = at.grid('mark', ss)
    X, Y = U * 2 - 1, V * 2 - 1
    col = np.ones(X.shape + (3,)) * skin
    c = cover(np.hypot(X, Y) - 0.3, 6.0 / (64 * FS))
    layer(col, lash * 0.9, c)
    put_cut(at, 'mark', col, np.ones(X.shape), c, ss)

    at.cell('wrinkle', 128 * FS, 64 * FS)
    U, V = at.grid('wrinkle', ss)
    X, Y = U * 2 - 1, V * 2 - 1
    col = np.ones(X.shape + (3,)) * skin
    feat = np.zeros(X.shape)
    for k in (-0.35, 0.3):
        pts = curve(lambda x: k + 0.12 * (1 - x * x), -0.85, 0.85, 10)
        c = cover(stroke(X, Y, pts, [0.03] * len(pts)), 6.0 / (64 * FS))
        layer(col, mix(skin, line, 0.45), c)
        feat = np.maximum(feat, c)
    put_cut(at, 'wrinkle', col, np.ones(X.shape), feat, ss)


# ---------------------------------------------------------------------------------------------------------------------
# Hair strip and cloth details.

RUNTIME_TOE = 0.6   # measured in the player, against Cloudwatch's grade: dark mid-tones draw as their 1.6th power
RUNTIME_GAIN = (0.9, 1.0, 0.92)   # and its pull toward red


def hair_lift(c):
    """What paint_hair does to a hair colour (sRGB, 0..1) so that it draws as itself in the player: the preview shows
    it lifted, and the palette check compares against this."""
    c = np.asarray(c, float)
    w = float(np.clip((0.55 - float(np.dot(c, [0.3, 0.59, 0.11]))) / 0.25, 0.0, 1.0))
    c = np.clip(c, 0, 1) ** (1.0 / (1.0 + RUNTIME_TOE * w))
    return c * (1 + (np.array(RUNTIME_GAIN) - 1) * w)


def paint_hair(at, name, lin, grey=0.0):
    """u across a clump, v from root (1) to tip (0): a root shadow, the jagged highlight band (alpha 0.6), darker tips."""
    base = srgb(lin)
    # darkness of the hair: how much of the runtime's grade compensation it takes (below)
    dark_w = float(np.clip((0.55 - float(np.dot(base, [0.3, 0.59, 0.11]))) / 0.25, 0.0, 1.0))
    at.cell(name, 128, 256)
    U, V = at.grid(name, 2)
    col = np.ones(U.shape + (3,)) * base
    col *= (0.86 + 0.14 * smooth01((1 - V) / 0.25))[..., None]
    col = col * (1 - 0.1 * smooth01((0.25 - V) / 0.25))[..., None]
    # highlight band: a zigzag around v 0.8 (near the crown), wider in the clump's middle
    # clump edges darker (the separation between painted clumps)
    edge = smooth01((np.abs(U - 0.5) - 0.3) / 0.2)
    col *= (1 - 0.13 * edge)[..., None]
    dark = float(np.dot(base, [0.3, 0.59, 0.11])) < 0.25
    if dark:
        # black hair: darkening the edges does not show; lift each clump's middle with a cool sheen instead
        col += (0.11 * (1 - edge) * np.sin(np.clip(U, 0, 1) * math.pi))[..., None] * np.array([0.85, 0.9, 1.1])
    # strands inside the clump: a few fine darker lines along it (root to tip, gently converging to the tip) and two
    # lighter ones, so a clump reads as a bundle of hair, not a ribbon
    rng = np.random.default_rng(7)
    for k in range(3):
        u0 = 0.14 + 0.72 * (k + rng.uniform(-0.3, 0.3)) / 2
        conv = 0.5 + (u0 - 0.5) * (0.55 + 0.45 * V)
        wv = 0.006 + 0.004 * rng.uniform()
        v_end = rng.uniform(0.05, 0.4)
        sl = cover(np.abs(U - conv) - wv, 1.2 / 128) * smooth01((V - v_end) / 0.1) * (1 - smooth01((V - 0.93) / 0.05))
        col = col * (1 - (0.08 if not dark else 0.05) * sl)[..., None] + (0 if not dark else 0) * sl[..., None]
    for k in range(2):
        u0 = 0.3 + 0.4 * k + rng.uniform(-0.05, 0.05)
        conv = 0.5 + (u0 - 0.5) * (0.6 + 0.4 * V)
        sl = cover(np.abs(U - conv) - 0.005, 1.2 / 128) * smooth01((V - 0.35) / 0.15) * (1 - smooth01((V - 0.7) / 0.08))
        layer(col, np.clip(base * 1.15 + 0.04, 0, 1), sl * 0.6)
    # the band: a clean arc across the clump with pointed ends (the classic angel ring cut into strands), not noise
    zig = 0.01 * np.sin(U * math.pi * 2 + 0.6)
    mid = np.sin(np.clip(U, 0, 1) * math.pi)
    band = cover(np.abs(V - 0.79 - zig) - 0.028 * mid ** 2, 4.0 / 256) * (mid > 0.2)
    hl = np.clip(base * 1.4 + np.array([0.08, 0.06, 0.04]), 0, 1) if not dark else np.clip(base * 1.3 + np.array([0.2, 0.21, 0.26]), 0, 1)
    layer(col, hl, band)
    # The world's filmic grade crushes dark mid-tones: a chestnut hair (#644946) painted as itself drew as maroon at half
    # its value (48/36/36 against the sheet's 91/70/65), the highlight ring alone near it. Dark hair is painted with the
    # inverse of the toe (a power of 1 / 1.6, weighted by how dark it is: light and grey hair are untouched, black stays
    # black), so what the player shows is the brief's colour; the Blender preview shows it lighter.
    col = np.clip(col, 0, 1) ** (1.0 / (1.0 + RUNTIME_TOE * dark_w))
    # (and the grade's pull toward red: the red and blue channels a tenth lower, measured the same way)
    col = col * (1 + (np.array(RUNTIME_GAIN) - 1) * dark_w)
    # the code is exact (0.6 where the band is, 1 elsewhere), so filtering never makes a half-highlight texel
    alpha = np.where(band > 0.5, 0.6, 1.0)
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


def paint_collar(at, name, lin):
    """u across a turn-down collar (0 the stand's foot .. 0.3 the fold .. 1 the leaf's edge) or a lapel (0.3 its front
    edge's fold .. 1 its outer edge): the stand a step darker, a dark crease at the fold, the leaf a touch lighter than
    the garment, a topstitched line just inside its edge."""
    base = srgb(lin)
    at.cell(name, 64, 64)
    U, V = at.grid(name, 2)
    col = np.ones(U.shape + (3,)) * np.clip(base * 1.1 + 0.02, 0, 1)
    layer(col, base * 0.82, cover(U - 0.28, 1.5 / 64))
    layer(col, base * 0.55, cover(np.abs(U - 0.3) - 0.025, 1.5 / 64))
    layer(col, base * 0.6, cover(np.abs(U - 0.88) - 0.012, 1.5 / 64))
    at.put(name, col, np.ones(U.shape), 2)


def paint_pleats(at, name, lin):
    """u across one pleat's face (0 where it comes out from under the last pleat .. 1 its folded edge): the tucked end
    in shade, a thin light line along the folded edge; u 0 itself (a few texels) is the fold's dark underside."""
    base = srgb(lin)
    at.cell(name, 64, 64)
    U, V = at.grid(name, 2)
    col = np.ones(U.shape + (3,)) * base
    col *= (1 - 0.2 * (1 - smooth01(U / 0.35)))[..., None]
    layer(col, np.clip(base * 1.25 + 0.03, 0, 1), cover(np.abs(U - 0.95) - 0.02, 1.5 / 64))
    # the fold's underside: dark on dark cloth, a softer grey-brown line on pale cloth (as a painter draws it)
    lum = float(np.dot(base, [0.3, 0.59, 0.11]))
    layer(col, base * (0.5 + 0.2 * lum), cover(U - 0.06, 1.5 / 64))
    at.put(name, col, np.ones(U.shape), 2)


def paint_rib(at, name, lin, ribs=3):
    """Knit rib across u (three ribs a face): each rib lit in its middle, a dark groove between."""
    base = srgb(lin)
    at.cell(name, 48, 32)
    U, V = at.grid(name, 2)
    ph = (U * ribs) % 1.0
    k = 0.84 + 0.22 * np.sin(ph * math.pi) ** 0.7
    col = np.clip(np.ones(U.shape + (3,)) * base * k[..., None], 0, 1)
    at.put(name, col, np.ones(U.shape), 2)


def paint_shoe(at, name, lin, kind):
    """A shoe's upper: u heel (0) to toe (1), v from the sole (0) up. Leather (loafers, boots): a long soft highlight
    along the top of the vamp and the toe, a darker welt line over the sole and, on a loafer, the apron's stitched seam
    round the toe. Canvas (sneakers): a fine weave, the heel's seam, a darker line over the sole."""
    base = srgb(lin)
    at.cell(name, 128, 64)
    U, V = at.grid(name, 2)
    col = np.ones(U.shape + (3,)) * base
    welt = cover(V - 0.1, 2.0 / 64)
    if kind == 'sneakers':
        weave = 0.97 + 0.03 * np.sign(np.sin(U * 128 * math.pi) * np.sin(V * 64 * math.pi))
        col *= weave[..., None]
        layer(col, base * 0.82, cover(np.abs(U - 0.06) - 0.006, 1.5 / 128) * (V > 0.15))
        layer(col, base * 0.8, welt)
    else:
        hl = np.exp(-((V - 0.78) / 0.12) ** 2) * smooth01((U - 0.45) / 0.25)
        hl += 0.8 * np.exp(-((U - 0.9) / 0.06) ** 2) * np.exp(-((V - 0.55) / 0.2) ** 2)
        layer(col, np.clip(base * 1.6 + 0.1, 0, 1), np.clip(hl, 0, 1) * 0.7)
        layer(col, base * 0.6, welt)
        if kind == 'loafers':
            apron = cover(np.abs(np.hypot((U - 1.0) / 0.42, (V - 0.35) / 0.48) - 1) - 0.012, 1.5 / 64) * (U > 0.55)
            layer(col, base * 0.55, apron)
    at.put(name, col, np.ones(U.shape), 2)


def parse_colour(text):
    from common import colour
    return colour(text)


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
