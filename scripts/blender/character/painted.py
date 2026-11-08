"""Painted hair: the textures of `hair_style = painted` (hair_painted.py builds the smooth shapes they go on).

Anime games draw hair as a few simple volumes with a hand-painted look in the texture. Here the texture is painted
procedurally (numpy, signed distances, 2x supersampled) from the character's palette and, when there is one, the
sheet's own hair tones (`spec['sheet_fit']['head']['hair']`): per lock a base hue, a hard cel-shadow shape on the side
away from the light, an "angel ring" highlight band (atlas alpha 0.6, the toon code for a highlight), fine strand
lines that converge to the tip, a dark rim line round every lock (the only outline the strands get: the runtime's hull
has no width on these parts), and alpha-cut tips (atlas alpha 0 is a hole: toon.ts `CUT_CODE`) with flyaway strands.

Three cells: the mass (sides and back, u across the azimuth, v down), the fringe (a fan from the parting) and a side
lock (one tapered strip). Painted in sRGB with the runtime grade compensation of `paint.paint_hair`.
"""
import math

import numpy as np

from paint import RUNTIME_GAIN, RUNTIME_TOE, cover, mix, smooth01, srgb


class Hair_palette:
    """Base, cel shadow, highlight and line colours (sRGB 0..1) of a hair colour."""

    def __init__(self, lin, spec=None):
        base = srgb(lin)
        self.lum = float(np.dot(base, [0.3, 0.59, 0.11]))
        self.dark_w = float(np.clip((0.55 - self.lum) / 0.25, 0.0, 1.0))
        self.dark = self.lum < 0.25
        sf = (((spec or {}).get('sheet_fit') or {}).get('head') or {}).get('hair')
        self.base = base
        if sf and isinstance(sf, dict) and sf.get('mid') is not None and sf.get('dark') is not None:
            # the sheet's own tones: its mid tone steers the base's value, its darkest the shadow's depth
            m = np.asarray(sf['mid'], float)
            self.base = mix(base, m, 0.35)
        if self.dark:
            self.shade = self.base * np.array([0.66, 0.64, 0.74])
            self.hi = np.clip(self.base + np.array([0.2, 0.21, 0.26]), 0, 1)
            self.line = self.base * np.array([0.5, 0.5, 0.62])
        else:
            self.shade = self.base * np.array([0.7, 0.58, 0.64])
            self.hi = np.clip(self.base * 1.42 + np.array([0.07, 0.045, 0.035]), 0, 1)
            self.line = self.base * np.array([0.4, 0.3, 0.36])
        self.line = np.clip(self.line, 0, 1)

    def grade(self, col):
        """The world's grade crushes dark mid-tones (paint.RUNTIME_TOE): paint the inverse so it draws as itself."""
        col = np.clip(col, 0, 1) ** (1.0 / (1.0 + RUNTIME_TOE * self.dark_w))
        return col * (1 + (np.array(RUNTIME_GAIN) - 1) * self.dark_w)


def ribbon(X, Y, pts, hw):
    """Signed distance (px, negative inside) to a tapered ribbon along the polyline `pts` (N, 2) with half-widths `hw`
    (N,), the position along it t (0 root, 1 tip) and the lateral coordinate L (-1 .. 1 across the local width)."""
    d = np.full(X.shape, 1e9)
    T = np.zeros(X.shape)
    L = np.zeros(X.shape)
    n = len(pts)
    for i in range(n - 1):
        ax, ay = pts[i]
        bx, by = pts[i + 1]
        dx, dy = bx - ax, by - ay
        t = np.clip(((X - ax) * dx + (Y - ay) * dy) / (dx * dx + dy * dy + 1e-9), 0, 1)
        px, py = ax + t * dx, ay + t * dy
        dist = np.hypot(X - px, Y - py)
        w = hw[i] + (hw[i + 1] - hw[i]) * t
        dd = dist - w
        better = dd < d
        sgn = np.sign(dx * (Y - ay) - dy * (X - ax))
        T = np.where(better, (i + t) / (n - 1), T)
        L = np.where(better, sgn * dist / np.maximum(w, 1e-3), L)
        d = np.where(better, dd, d)
    return d, T, L


def bezier(p0, p1, p2, n=28):
    t = np.linspace(0, 1, n)[:, None]
    return (1 - t) ** 2 * np.asarray(p0, float) + 2 * (1 - t) * t * np.asarray(p1, float) + t ** 2 * np.asarray(p2, float)


def profile(n, t0, kind):
    """Half-width factor along a lock: full to t0, then a taper: `point` (pointed), `round` (blunt, rounded), `soft`."""
    t = np.linspace(0, 1, n)
    s = np.clip((t - t0) / (1 - t0), 0, 1)
    if kind == 'round':
        f = np.sqrt(np.clip(1 - s ** 2.6, 0, 1))
    elif kind == 'soft':
        f = 1 - 0.55 * s - 0.45 * s ** 6
    else:
        f = 1 - s ** 1.35
    root = 0.55 + 0.45 * smooth01(t / 0.22)
    return np.clip(f * root, 0.0, 1.0)


class Canvas:
    """A painted cell: colour, coverage and highlight, in px (y down), at the supersampled size."""

    def __init__(self, at, name, w, h, pal, ss=2, k=1.0):
        at.cell(name, w, h)
        self.at, self.name, self.w, self.h, self.ss, self.pal = at, name, w, h, ss, pal
        W, H = w * ss, h * ss
        xs = (np.arange(W) + 0.5) / ss
        ys = (np.arange(H) + 0.5) / ss
        self.X, self.Y = np.meshgrid(xs, ys)
        # holes carry the rim colour, so filtering at a cut edge blends toward the line, not a grey
        self.col = np.ones((H, W, 3)) * pal.line
        self.cov = np.zeros((H, W))
        self.hl = np.zeros((H, W))
        self.aa = 1.3
        self.k = k      # stroke scale: line widths in px follow the cell's resolution

    def lock(self, pts, hw0, tip='point', t0=0.55, shade_side=1.0, seed=0, band_t=None, band_w=0.05, n_strands=5, rim=2.4, shade_phase=0.0):
        """Paint one lock (a ribbon) over what is there: body, cel shadow, strands, highlight band, rim line."""
        pal = self.pal
        rng = np.random.default_rng(seed)
        pts = np.asarray(pts, float)
        hw = hw0 * profile(len(pts), t0, tip)
        rim = rim * self.k
        sl = self.box(pts, hw0 + rim + 8)
        X, Y = self.X[sl], self.Y[sl]
        d, T, L = ribbon(X, Y, pts, hw)
        m = cover(d, self.aa)
        if m.max() <= 0:
            return
        wpx = np.interp(T, np.linspace(0, 1, len(pts)), hw) + 1e-3
        col = np.ones(m.shape + (3,)) * pal.base
        # cel shadow: a hard shape down the side away from the light, its edge wandering; the root darker
        edge = 0.18 + 0.14 * np.sin(T * 11 + shade_phase) + 0.08 * np.sin(T * 27 + shade_phase * 2)
        shade = cover(((L * shade_side) - edge) * wpx, self.aa)
        # a second, smaller shadow under the tip's turn
        under = cover((T - 0.82 - 0.05 * np.sin(L * 5 + shade_phase)) * 60, self.aa) * (np.abs(L) < 0.7)
        sh = np.maximum(shade, under * 0.8)
        col = col * (1 - sh[..., None]) + pal.shade * sh[..., None]
        root = smooth01((0.16 - T) / 0.16)
        col = col * (1 - 0.5 * root[..., None]) + pal.shade * (0.5 * root[..., None])
        # strands: fine lines along the lock that converge toward the tip, some darker, some lighter, ending short
        for k in range(n_strands):
            lk = rng.uniform(-0.8, 0.8)
            t_end = rng.uniform(0.55, 0.97)
            lat = np.abs(L - lk * (1 - 0.45 * T))
            ln = cover(lat * wpx - 0.55 * self.k, self.aa) * smooth01((T - 0.03) / 0.06) * (1 - smooth01((T - t_end) / 0.05))
            if k % 3 == 2:
                col = col * (1 - 0.45 * ln[..., None]) + pal.hi * (0.45 * ln[..., None])
            else:
                col = col * (1 - 0.5 * ln[..., None]) + (pal.shade * 0.9 if not pal.dark else pal.base * 1.12 + 0.03) * (0.5 * ln[..., None])
        hlm = np.zeros(m.shape)
        if band_t is not None:
            # the angel ring: a pointed lens across the lock
            lens = (1 - np.abs(L) ** 2.4)
            bh = cover(np.abs(T - band_t - 0.025 * L * L) - band_w * np.clip(lens, 0, 1), 0.012) * (np.abs(L) < 0.9)
            hlm = bh * m * (1 - sh)
            col = col * (1 - 0.92 * hlm[..., None]) + pal.hi * (0.92 * hlm[..., None])
        # the rim line: round the lock, thicker on the shaded side
        rimw = rim * (1 + 0.25 * (L * shade_side))
        ring = cover(-(d + rimw) , self.aa) * m
        col = col * (1 - ring[..., None]) + pal.line * ring[..., None]
        self.col[sl] = self.col[sl] * (1 - m[..., None]) + col * m[..., None]
        self.hl[sl] = np.maximum(self.hl[sl] * (1 - m), hlm)
        self.cov[sl] = np.maximum(self.cov[sl], m)

    def box(self, pts, pad):
        s = self.ss
        x0 = int(max(0, (pts[:, 0].min() - pad) * s))
        x1 = int(min(self.w * s, (pts[:, 0].max() + pad) * s))
        y0 = int(max(0, (pts[:, 1].min() - pad) * s))
        y1 = int(min(self.h * s, (pts[:, 1].max() + pad) * s))
        return (slice(y0, max(y0, y1)), slice(x0, max(x0, x1)))

    def strand(self, pts, hw0, seed=0):
        """A single flyaway strand: a thin dark ribbon, pointed."""
        pts = np.asarray(pts, float)
        hw = (hw0 * profile(len(pts), 0.35, 'point') + 0.25) * self.k
        sl = self.box(pts, hw0 * self.k + 6)
        d, T, L = ribbon(self.X[sl], self.Y[sl], pts, hw)
        m = cover(d, self.aa * 0.8)
        col = np.ones(m.shape + (3,)) * mix(self.pal.base * 0.72, self.pal.line, 0.45)
        self.col[sl] = self.col[sl] * (1 - m[..., None]) + col * m[..., None]
        self.cov[sl] = np.maximum(self.cov[sl], m)
        self.hl[sl] = self.hl[sl] * (1 - m)

    def done(self):
        """Write the cell: colour graded for the runtime, alpha = the toon code (1 normal, 0.6 highlight, 0 a hole)."""
        col = self.pal.grade(self.col)
        solid = self.cov > 0.5
        alpha = np.where(solid, np.where(self.hl > 0.5, 0.6, 1.0), 0.0)
        self.at.put(self.name, col, alpha, self.ss)


def paint_mass(at, name, pal, w=1024, h=512, seed=11, n=11, band_y=0.26):
    """The hair of the sides and back, u across the azimuth, v from the crown (top) to the ends (cut below)."""
    cv = Canvas(at, name, w, h, pal)
    rng = np.random.default_rng(seed)
    cw = w / n
    order = list(range(n))
    # back to front: alternate so neighbours overlap both ways
    order = order[0::2] + order[1::2]
    for j, i in enumerate(order):
        cx = (i + 0.5) * cw + rng.uniform(-0.15, 0.15) * cw
        hw0 = cw * rng.uniform(0.62, 0.8)
        y_tip = h * rng.uniform(0.68, 0.86)
        sway = rng.uniform(-0.12, 0.12) * cw
        pts = bezier((cx, -30), (cx + sway * 0.3, y_tip * 0.5), (cx + sway, y_tip), 30)
        tip = ('point', 'point', 'soft', 'point', 'round')[int(rng.integers(0, 5))]
        cv.lock(pts, hw0, tip=tip, t0=rng.uniform(0.3, 0.5), shade_side=1.0 if (i % 2 == 0) else -1.0, seed=seed * 31 + i,
                band_t=(band_y * h + 30) / (y_tip + 30), band_w=0.06, n_strands=6, rim=2.6, shade_phase=i * 1.7)
    # flyaway strands beyond the tips
    for k in range(8):
        x0 = rng.uniform(0.05, 0.95) * w
        y0 = h * rng.uniform(0.55, 0.7)
        y1 = y0 + h * rng.uniform(0.18, 0.28)
        pts = bezier((x0, y0), (x0 + rng.uniform(-30, 30), (y0 + y1) / 2), (x0 + rng.uniform(-50, 50), y1), 16)
        cv.strand(pts, 1.6, seed=k)
    cv.done()
    return cv


def paint_fringe(at, name, pal, part_u=0.66, w=768, h=480, seed=5, n=9):
    """A fan of locks from the parting (top, at u = part_u) down over the forehead to their tips, longer toward the
    side the fringe is swept to; the gaps between locks are holes (the forehead shows through)."""
    cv = Canvas(at, name, w, h, pal, k=w / 640)
    rng = np.random.default_rng(seed)
    px = part_u * w
    order = list(range(n))
    order = order[0::2][::-1] + order[1::2]
    for i in order:
        f = i / (n - 1)
        tx = w * (0.04 + 0.92 * f) + rng.uniform(-0.02, 0.02) * w
        # the locks nearer the swept side (u < part) run longer
        reach = 0.66 + 0.24 * (1 - f) ** 0.8 if f < part_u else 0.6 + 0.2 * f
        ty = h * (reach + rng.uniform(-0.05, 0.05))
        root = (px + (tx - px) * 0.1, -30)
        ctrl = (px + (tx - px) * 0.28, ty * 0.55)
        end = (tx, ty)
        pts = bezier(root, ctrl, end, 30)
        hw0 = w / n * rng.uniform(0.75, 0.9)
        side = 1.0 if tx < px else -1.0
        cv.lock(pts, hw0, tip=('soft', 'point', 'soft', 'round')[i % 4], t0=rng.uniform(0.42, 0.6), shade_side=side, seed=seed * 17 + i,
                band_t=0.36, band_w=0.05, n_strands=5, rim=2.4, shade_phase=i * 2.3)
    for k in range(6):
        f = rng.uniform(0.05, 0.95)
        x0, y0 = w * f, h * rng.uniform(0.5, 0.66)
        pts = bezier((x0, y0), (x0 + rng.uniform(-20, 20), y0 + 40), (x0 + rng.uniform(-30, 30), y0 + h * rng.uniform(0.14, 0.24)), 14)
        cv.strand(pts, 1.5)
    cv.done()
    return cv


def paint_side(at, name, pal, w=192, h=512, seed=9):
    """A face-framing lock: one long tapered strip with an inner highlight and a pointed end."""
    cv = Canvas(at, name, w, h, pal)
    pts = bezier((w * 0.5, -30), (w * 0.52, h * 0.5), (w * 0.46, h * 0.9), 26)
    cv.lock(pts, w * 0.42, tip='point', t0=0.35, shade_side=1.0, seed=seed, band_t=0.28, band_w=0.05, n_strands=4, rim=2.6)
    cv.done()
    return cv
