"""
Shared building blocks of the procedural rug textures (numpy / Pillow / scipy, CPU only).

A design is painted at knot resolution into a palette-index canvas (one cell = one knot, or one weave unit for a
flatweave), then turned into colour with dye variation (abrash), wear and per-knot jitter, and finally expanded to
the texture resolution with the pile's micro structure (knot domes, tufts or weft ribs). Tiling normal maps of the
same micro structure are made at the same pitch, so the normal map lines up knot for knot with the colour map when
it is repeated `knots / tile_knots` times across the rug.
"""
from __future__ import annotations

import math

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi


def hexrgb(h: str) -> np.ndarray:
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], np.float32)


# ---------------------------------------------------------------------------------------------------------------
# Noise
# ---------------------------------------------------------------------------------------------------------------

def value_noise(rng: np.random.Generator, h: int, w: int, cell: float, periodic: bool = False) -> np.ndarray:
    """Smooth noise in [-1, 1] with features about `cell` pixels wide."""
    gh, gw = max(2, int(math.ceil(h / cell)) + 3), max(2, int(math.ceil(w / cell)) + 3)
    if periodic:
        gh, gw = max(2, round(h / cell)), max(2, round(w / cell))
        g = rng.uniform(-1, 1, (gh, gw)).astype(np.float32)
        g = np.tile(g, (3, 3))
        img = Image.fromarray(g, mode='F').resize((gw * 3 * w // gw, gh * 3 * h // gh), Image.BICUBIC)
        a = np.asarray(img)
        return a[h:2 * h, w:2 * w].copy()
    g = rng.uniform(-1, 1, (gh, gw)).astype(np.float32)
    img = Image.fromarray(g, mode='F').resize((int(gw * cell), int(gh * cell)), Image.BICUBIC)
    a = np.asarray(img)
    oy, ox = int(cell), int(cell)
    return a[oy:oy + h, ox:ox + w].copy()


def fbm(rng: np.random.Generator, h: int, w: int, cell: float, octaves: int = 4, periodic: bool = False) -> np.ndarray:
    out = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0.0
    for _ in range(octaves):
        out += amp * value_noise(rng, h, w, max(1.5, cell), periodic)
        tot += amp
        amp *= 0.5
        cell /= 2
    return out / tot


def periodic_gauss(rng: np.random.Generator, h: int, w: int, sigma_y: float, sigma_x: float) -> np.ndarray:
    """White noise blurred with wrap-around (tiles seamlessly), unit variance."""
    n = rng.standard_normal((h, w)).astype(np.float32)
    n = ndi.gaussian_filter(n, (sigma_y, sigma_x), mode='wrap')
    return n / (n.std() + 1e-6)


def steps(rng: np.random.Generator, n: int, lo: int, hi: int, amp: float, soft: float = 2.0) -> np.ndarray:
    """Piecewise-constant random offsets along one axis (dye batches), softly blended: abrash."""
    out = np.zeros(n, np.float32)
    i = 0
    v = 0.0
    while i < n:
        L = int(rng.integers(lo, hi))
        v = 0.55 * v + rng.normal(0, amp)
        out[i:i + L] = v
        i += L
    return ndi.gaussian_filter1d(out, soft)


# ---------------------------------------------------------------------------------------------------------------
# The canvas (palette indices at knot resolution)
# ---------------------------------------------------------------------------------------------------------------

class Canvas:
    def __init__(self, w: int, h: int, ground: int = 0):
        self.w, self.h = w, h
        self.idx = np.full((h, w), ground, np.uint8)
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        self.X = xx - (w - 1) / 2.0
        self.Y = yy - (h - 1) / 2.0

    # masks ---------------------------------------------------------------
    def put(self, mask: np.ndarray, c: int, outline: int | None = None, ow: int = 1, win: tuple[slice, slice] | None = None) -> None:
        if win is None:
            win = (slice(0, self.h), slice(0, self.w))
        sub = self.idx[win]
        if outline is not None:
            ring = ndi.binary_dilation(mask, iterations=ow) & ~mask
            sub[ring] = outline
        sub[mask] = c

    def window(self, cx: float, cy: float, r: float) -> tuple[tuple[slice, slice], np.ndarray, np.ndarray] | None:
        """A window around a centre given in canvas-centred coordinates; local dx, dy grids."""
        x0 = int(math.floor(cx + (self.w - 1) / 2 - r - 3))
        x1 = int(math.ceil(cx + (self.w - 1) / 2 + r + 4))
        y0 = int(math.floor(cy + (self.h - 1) / 2 - r - 3))
        y1 = int(math.ceil(cy + (self.h - 1) / 2 + r + 4))
        x0, y0 = max(0, x0), max(0, y0)
        x1, y1 = min(self.w, x1), min(self.h, y1)
        if x1 <= x0 or y1 <= y0:
            return None
        win = (slice(y0, y1), slice(x0, x1))
        return win, self.X[win] - cx, self.Y[win] - cy

    def stamp(self, cx: float, cy: float, r: float, fn, c: int, outline: int | None = None, ow: int = 1) -> None:
        w = self.window(cx, cy, r * 1.3)
        if w is None:
            return
        win, dx, dy = w
        m = fn(dx, dy)
        if m.any():
            self.put(m, c, outline, ow, win)

    def mirror4(self) -> None:
        """Copy the top-left quadrant onto the other three (Persian four-fold symmetry)."""
        h2, w2 = self.h // 2, self.w // 2
        self.idx[:, self.w - w2:] = self.idx[:, :w2][:, ::-1]
        self.idx[self.h - h2:, :] = self.idx[:h2, :][::-1, :]

    def mirror_y(self) -> None:
        h2 = self.h // 2
        self.idx[self.h - h2:, :] = self.idx[:h2, :][::-1, :]

    # strokes through PIL ---------------------------------------------------
    def lines(self, polylines: list[list[tuple[float, float]]], c: int, width: float, outline: int | None = None, ow: int = 1) -> None:
        img = Image.new('L', (self.w, self.h), 0)
        d = ImageDraw.Draw(img)
        ox, oy = (self.w - 1) / 2, (self.h - 1) / 2
        for pl in polylines:
            pts = [(x + ox, y + oy) for x, y in pl]
            if len(pts) >= 2:
                d.line(pts, fill=255, width=max(1, int(round(width))), joint='curve')
        m = np.asarray(img) > 127
        self.put(m, c, outline, ow)


# ---------------------------------------------------------------------------------------------------------------
# Motif masks (local coordinates in knots)
# ---------------------------------------------------------------------------------------------------------------

def rot(dx: np.ndarray, dy: np.ndarray, ang: float) -> tuple[np.ndarray, np.ndarray]:
    c, s = math.cos(ang), math.sin(ang)
    return dx * c + dy * s, -dx * s + dy * c


def lobed(dx, dy, ax, ay, lobes: int, depth: float, sharp: float = 1.5, ang: float = 0.0):
    """Lobed ellipse (cusps between lobes): a medallion or rosette outline."""
    u, v = dx / ax, dy / ay
    r = np.hypot(u, v)
    th = np.arctan2(v, u) + ang
    edge = 1.0 - depth * (1.0 - np.abs(np.cos(lobes * th / 2.0))) ** sharp
    return r < edge


def rosette(s: float, petals: int = 8, depth: float = 0.35, ang: float = 0.0):
    return lambda dx, dy: lobed(dx, dy, s, s, petals, depth, 1.2, ang)


def disc(s: float):
    return lambda dx, dy: dx * dx + dy * dy < s * s


def diamond(ax: float, ay: float):
    return lambda dx, dy: np.abs(dx) / ax + np.abs(dy) / ay < 1.0


def leaf(s: float, ang: float, width: float = 0.34, bend: float = 0.15):
    def f(dx, dy):
        u, v = rot(dx, dy, ang)
        v = v - bend * s * (1 - (u / s) ** 2)
        return (np.abs(u) < s) & (np.abs(v) < width * s * np.clip(1 - (u / s) ** 2, 0, 1))
    return f


def palmette(s: float, ang: float, lobes: int = 7, spread: float = 1.05):
    """A fan-shaped palmette growing from its base at the local origin along `ang`."""
    def f(dx, dy):
        u, v = rot(dx, dy, ang)
        r = np.hypot(u, v)
        th = np.arctan2(v, u)
        edge = s * (0.72 + 0.28 * np.abs(np.cos(lobes * th * math.pi / (2 * spread))))
        fan = (np.abs(th) < spread) & (r < edge) & (u > -0.05 * s)
        calyx = (u + 0.12 * s) ** 2 / (0.3 * s) ** 2 + v ** 2 / (0.22 * s) ** 2 < 1
        return fan | calyx
    return f


def cartouche(ax: float, ay: float):
    """Elongated lozenge with rounded ends (border cartouches)."""
    def f(dx, dy):
        q = (np.abs(dx) / ax) ** 1.6 + (np.abs(dy) / ay) ** 1.6
        return q < 1
    return f


def hexagon(ax: float, ay: float):
    """Elongated hexagon (Heriz 'turtle')."""
    def f(dx, dy):
        x, y = np.abs(dx), np.abs(dy)
        return (y < ay) & (x + 0.6 * ax * y / ay < ax)
    return f


def stepped(f, step: float):
    """Quantise a motif to a coarse grid (the stepped outlines of geometric weaving)."""
    def g(dx, dy):
        return f(np.round(dx / step) * step, np.round(dy / step) * step)
    return g


# ---------------------------------------------------------------------------------------------------------------
# Vines
# ---------------------------------------------------------------------------------------------------------------

def scroll(x0: float, y0: float, ang: float, length: float, curl: float, n: int = 40) -> list[tuple[float, float]]:
    """A curling vine: an arc whose curvature grows towards its tip."""
    pts = []
    x, y, a = x0, y0, ang
    ds = length / n
    for i in range(n + 1):
        pts.append((x, y))
        k = curl * (0.3 + 1.7 * i / n) / max(1.0, length) * 6
        a += k * ds
        x += math.cos(a) * ds
        y += math.sin(a) * ds
    return pts


def wave_line(x0: float, x1: float, y: float, amp: float, period: float, phase: float = 0.0, n: int = 200, vertical: bool = False) -> list[tuple[float, float]]:
    pts = []
    for i in range(n + 1):
        t = x0 + (x1 - x0) * i / n
        o = y + amp * math.sin(2 * math.pi * t / period + phase)
        pts.append((o, t) if vertical else (t, o))
    return pts


# ---------------------------------------------------------------------------------------------------------------
# Borders
# ---------------------------------------------------------------------------------------------------------------

def edge_fields(cv: Canvas):
    """Distance in knots from the outer edge (e), along-band coordinate (s) and which band (side or end)."""
    dxe = (cv.w - 1) / 2 - np.abs(cv.X)
    dye = (cv.h - 1) / 2 - np.abs(cv.Y)
    side = dxe < dye
    e = np.where(side, dxe, dye)
    s = np.where(side, cv.Y, cv.X)
    return e, s, side


def border_period(length_half: float, want: float) -> float:
    """Period that puts a motif at the centre and one at the corner square."""
    n = max(1, round(length_half / want))
    return length_half / n


def guard(cv: Canvas, e, s, e0: float, e1: float, ground: int, dot: int, line: int | None, period: float, kind: str = 'dots') -> None:
    band = (e >= e0) & (e < e1)
    if not band.any():
        return
    cv.idx[band] = ground
    wdt = e1 - e0
    t = e - e0 - wdt / 2
    ph = (s / period) % 1.0 - 0.5
    if kind == 'dots':
        m = band & ((ph * period) ** 2 + t ** 2 < (wdt * 0.32) ** 2)
    elif kind == 'reciprocal':
        m = band & (np.abs(ph * period) * 2 < (t + wdt / 2) * 1.0)
    elif kind == 'chain':
        m = band & (np.abs(np.abs(ph * period) - period * 0.25) + np.abs(t) < wdt * 0.42)
    elif kind == 'barber':
        m = band & ((((s + e * 1.0) / (period * 0.5)) % 2.0) < 1.0)
    else:
        m = np.zeros_like(band)
    cv.idx[m] = dot
    if line is not None:
        cv.idx[(e >= e0) & (e < e0 + 1)] = line
        cv.idx[(e >= e1 - 1) & (e < e1)] = line


def main_border(cv: Canvas, e, s, side, e0: float, e1: float, ground: int, vine: int, motifs: list[tuple[str, int, int | None]], period_side: float, period_end: float, outline: int | None, leaves: int | None = None) -> None:
    """Curvilinear main border: alternating motifs on a meandering vine, mitred corners with a rosette."""
    band = (e >= e0) & (e < e1)
    cv.idx[band] = ground
    B = e1 - e0
    t = e - e0 - B / 2
    P = np.where(side, period_side, period_end)
    ph = s / P
    k = np.round(ph)
    ds = (ph - k) * P
    # meandering vine (passes through each motif)
    tc = 0.30 * B * np.sin(math.pi * ph)
    vm = band & (np.abs(t - tc) < max(0.9, B * 0.055))
    cv.idx[vm] = vine
    if leaves is not None:
        # little leaves at the crests of the vine
        ph2 = ph - np.floor(ph) - 0.5
        sgn = np.where((np.floor(ph) % 2) == 0, 1.0, -1.0)
        lu = ph2 * P
        lv = t - sgn * 0.30 * B + sgn * 0.12 * B
        lm = band & ((lu / (0.22 * P)) ** 2 + (lv / (0.11 * B)) ** 2 < 1) & (np.abs(t) < B * 0.48)
        cv.idx[lm] = leaves
    kk = k.astype(np.int64) % len(motifs)
    for mi, mot in enumerate(motifs):
        kind, col, oc = mot[0], mot[1], mot[2]
        inner_c = mot[3] if len(mot) > 3 else vine
        sel = band & (kk == mi)
        if kind == 'rosette':
            r = np.hypot(ds, t)
            th = np.arctan2(t, ds)
            m = sel & (r < 0.36 * B * (1 - 0.35 * (1 - np.abs(np.cos(4 * th))) ** 1.2))
            inner = sel & (r < 0.2 * B * (1 - 0.3 * (1 - np.abs(np.cos(4 * th + 0.4))) ** 1.2)) & (r > 0.07 * B)
        elif kind == 'palmette':
            tb = t + 0.32 * B
            r = np.hypot(ds, tb)
            th = np.arctan2(ds, tb)
            m = sel & (np.abs(th) < 1.05) & (r < 0.68 * B * (0.72 + 0.28 * np.abs(np.cos(3.5 * th * math.pi / 2.1)))) & (tb > 0)
            m |= sel & ((ds / (0.18 * B)) ** 2 + ((t + 0.3 * B) / (0.12 * B)) ** 2 < 1)
            inner = sel & (np.abs(th) < 0.8) & (r < 0.38 * B * (0.7 + 0.3 * np.abs(np.cos(2.5 * th * math.pi / 1.6)))) & (tb > 0.05 * B)
        elif kind == 'cartouche':
            q = (np.abs(ds) / (0.42 * P)) ** 1.6 + (np.abs(t) / (0.36 * B)) ** 1.6
            m = sel & (q < 1)
            inner = sel & (q < 0.35)
        elif kind == 'turtle':
            x, y = np.abs(ds), np.abs(t)
            m = sel & (y < 0.34 * B) & (x + 0.5 * y < 0.42 * P)
            inner = sel & (y < 0.12 * B) & (x + 0.5 * y < 0.18 * P)
        else:
            continue
        if oc is not None:
            ring = ndi.binary_dilation(m, iterations=1) & ~m & band
            cv.idx[ring] = oc
        cv.idx[m] = col
        cv.idx[inner] = inner_c if kind != 'turtle' else (oc if oc is not None else vine)
    # corner squares: a rosette over the mitre
    if outline is not None:
        cv.idx[band & (np.abs(t) > B / 2 - 1)] = outline


# ---------------------------------------------------------------------------------------------------------------
# Colour
# ---------------------------------------------------------------------------------------------------------------

def colourise(rng: np.random.Generator, idx: np.ndarray, palette: list[str], abrash: dict[int, float] | None = None, jitter: float = 0.025, hue_jitter: float = 0.012) -> np.ndarray:
    pal = np.stack([hexrgb(c) for c in palette])
    rgb = pal[idx]
    h, w = idx.shape
    if abrash:
        for ci, amp in abrash.items():
            off = steps(rng, h, 12, max(14, h // 6), amp)
            # bands run across the width, with a slight wobble (the weaver's rows are not perfectly straight)
            wob = (value_noise(rng, h, w, max(8, w / 3)) * 3).astype(np.int32)
            rows = np.clip(np.arange(h)[:, None] + wob, 0, h - 1)
            f = 1.0 + off[rows]
            m = idx == ci
            rgb[m] *= f[m][:, None]
            # slight hue drift with the batch too
            rgb[m, 0] *= (1 + 0.4 * off[rows][m])
    rgb *= (1 + rng.normal(0, jitter, (h, w, 1))).astype(np.float32)
    rgb *= (1 + rng.normal(0, hue_jitter, (h, w, 3))).astype(np.float32)
    return np.clip(rgb, 0, 1)


def wear(rng: np.random.Generator, rgb: np.ndarray, amount: float, toward: str = '#d9ccb0', cell: float = 60) -> np.ndarray:
    """Washed / aged look: patches where the pile is lower and colours soften towards the foundation."""
    h, w, _ = rgb.shape
    n = fbm(rng, h, w, cell, 4)
    m = np.clip((n - 0.15) * 2.5, 0, 1)[..., None] * amount
    lum = rgb.mean(axis=2, keepdims=True)
    soft = rgb * 0.7 + lum * 0.3
    return np.clip(soft * (1 - m) + hexrgb(toward) * m * 0.55 + soft * m * 0.45, 0, 1)


def desaturate(rgb: np.ndarray, k: float) -> np.ndarray:
    lum = (rgb * np.array([0.2126, 0.7152, 0.0722], np.float32)).sum(axis=2, keepdims=True)
    return rgb * (1 - k) + lum * k


# ---------------------------------------------------------------------------------------------------------------
# Micro structure
# ---------------------------------------------------------------------------------------------------------------

def knot_dome(kp: int) -> np.ndarray:
    i = (np.arange(kp) + 0.5) / kp
    a = np.sin(np.pi * i)[:, None] ** 0.7 * np.sin(np.pi * i)[None, :] ** 0.55
    # a Persian knot shows as two little loops side by side: a faint groove down the middle
    groove = 1 - 0.18 * np.exp(-((i[None, :] - 0.5) ** 2) / 0.01) * np.ones((kp, 1))
    return (a * groove).astype(np.float32)


def expand_knots(rng: np.random.Generator, rgb: np.ndarray, kp: int, depth: float = 0.2, fibre: float = 0.045, lean: float = 0.035) -> np.ndarray:
    """Knot-resolution colour -> texture: each knot a dome of pile with fibre noise."""
    h, w, _ = rgb.shape
    H, W = h * kp, w * kp
    up = np.repeat(np.repeat(rgb, kp, axis=0), kp, axis=1)
    # wool fibres bleed a little across knot boundaries
    up = ndi.gaussian_filter(up, (kp * 0.22, kp * 0.22, 0))
    dome = np.tile(knot_dome(kp), (h, w))
    kj = np.repeat(np.repeat(rng.normal(0, 0.06, (h, w)).astype(np.float32), kp, 0), kp, 1)
    shade = (1 - depth) + depth * (dome * (1 + kj))
    fib = ndi.gaussian_filter(rng.standard_normal((H, W)).astype(np.float32), (1.1, 0.5))
    fib /= fib.std() + 1e-6
    shade *= 1 + fibre * fib
    shade *= 1 + lean * fbm(rng, H, W, W / 5, 3)
    return np.clip(up * shade[..., None] * (1 + depth * 0.45), 0, 1)


def expand_tufts(rng: np.random.Generator, rgb: np.ndarray, scale: int, fibre: float = 0.06, lean: float = 0.05) -> np.ndarray:
    """Cut-pile tufting: colour upsampled smoothly, tufts as soft random blobs."""
    h, w, _ = rgb.shape
    H, W = h * scale, w * scale
    up = np.asarray(Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC)).astype(np.float32) / 255
    t = tuft_height(rng, H, W, periodic=False)
    shade = 0.84 + 0.22 * t
    fib = ndi.gaussian_filter(rng.standard_normal((H, W)).astype(np.float32), (0.7, 0.7))
    fib /= fib.std() + 1e-6
    shade *= 1 + fibre * fib
    shade *= 1 + lean * fbm(rng, H, W, W / 4, 3)
    return np.clip(up * shade[..., None], 0, 1)


def tuft_height(rng: np.random.Generator, H: int, W: int, periodic: bool, pitch: float = 4.0) -> np.ndarray:
    """Rows of tufts (a tufting gun shoots rows) with random height and position: values in [0, 1]."""
    rows = int(round(H / pitch))
    cols = int(round(W / pitch))
    img = np.zeros((H, W), np.float32)
    jit = rng.uniform(-0.35, 0.35, (rows, cols, 2))
    hgt = rng.uniform(0.6, 1.0, (rows, cols))
    yy = ((np.arange(rows)[:, None] + 0.5 + jit[..., 0]) * pitch).astype(np.int64) % H
    xx = ((np.arange(cols)[None, :] + 0.5 + (np.arange(rows)[:, None] % 2) * 0.5 + jit[..., 1]) * pitch).astype(np.int64) % W
    img[yy.ravel(), xx.ravel()] = hgt.ravel()
    img = ndi.gaussian_filter(img, pitch * 0.38, mode='wrap' if periodic else 'reflect')
    img /= img.max() + 1e-6
    return np.clip(img * 1.4, 0, 1)


def weave_pattern(kp: int) -> np.ndarray:
    """Weft-faced plain weave: picks as slim horizontal ribs, offset every other pick (two units per weave cell)."""
    ph = kp // 2  # pick height in px
    cell = np.zeros((kp, kp * 2), np.float32)
    for r in range(kp):
        pick = r // ph
        rr = (r % ph + 0.5) / ph
        for c in range(kp * 2):
            off = (c + pick * kp) % (kp * 2)
            cc = (off + 0.5) / (kp * 2)
            cell[r, c] = math.sin(math.pi * rr) ** 0.6 * (0.75 + 0.25 * math.sin(math.pi * cc) ** 0.5)
    return cell


def expand_weave(rng: np.random.Generator, rgb: np.ndarray, kp: int, fibre: float = 0.05) -> np.ndarray:
    h, w, _ = rgb.shape
    H, W = h * kp, w * kp
    up = np.repeat(np.repeat(rgb, kp, axis=0), kp, axis=1)
    up = ndi.gaussian_filter(up, (0.35, kp * 0.18, 0))
    cell = weave_pattern(kp)
    pat = np.tile(cell, (h, (w + 1) // 2))[:, :W]
    shade = 0.80 + 0.26 * pat
    fib = ndi.gaussian_filter(rng.standard_normal((H, W)).astype(np.float32), (0.4, 1.6))
    fib /= fib.std() + 1e-6
    shade *= 1 + fibre * fib
    shade *= 1 + 0.03 * fbm(rng, H, W, W / 6, 3)
    return np.clip(up * shade[..., None], 0, 1)


def normal_from_height(hm: np.ndarray, strength: float) -> np.ndarray:
    """OpenGL-convention tangent-space normal map (+X right, +Y up in the image), wrap-around gradients."""
    dx = (np.roll(hm, -1, axis=1) - np.roll(hm, 1, axis=1)) * 0.5
    dy_down = (np.roll(hm, -1, axis=0) - np.roll(hm, 1, axis=0)) * 0.5
    nx = -dx * strength
    ny = dy_down * strength  # image rows grow downwards; +Y is up
    nz = np.ones_like(hm)
    n = np.stack([nx, ny, nz], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return ((n * 0.5 + 0.5) * 255 + 0.5).astype(np.uint8)


def knot_normal_tile(rng: np.random.Generator, size: int, kp: int, strength: float = 3.0) -> np.ndarray:
    k = size // kp
    dome = np.tile(knot_dome(kp), (k, k))
    kj = np.repeat(np.repeat(rng.normal(0, 0.12, (k, k)).astype(np.float32), kp, 0), kp, 1)
    fib = periodic_gauss(rng, size, size, 1.1, 0.5)
    hm = dome * (1 + kj) + 0.08 * fib
    return normal_from_height(hm, strength)


def tuft_normal_tile(rng: np.random.Generator, size: int, pitch: float, strength: float = 2.2) -> np.ndarray:
    hm = tuft_height(rng, size, size, True, pitch) + 0.10 * periodic_gauss(rng, size, size, 0.7, 0.7)
    return normal_from_height(hm, strength)


def weave_normal_tile(rng: np.random.Generator, size: int, kp: int, strength: float = 2.6) -> np.ndarray:
    cell = weave_pattern(kp)
    pat = np.tile(cell, (size // kp, size // (kp * 2)))
    hm = pat + 0.08 * periodic_gauss(rng, size, size, 0.4, 1.6)
    return normal_from_height(hm, strength)


def save_rgb(path: str, rgb: np.ndarray) -> None:
    Image.fromarray((np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8)).save(path)


def fringe_texture(rng: np.random.Generator, colour: str, w: int = 512, h: int = 192, strands: int = 48, knots: bool = True) -> np.ndarray:
    """RGBA fringe card: cotton warp strands, gathered in knotted bundles next to the rug (top of the image)."""
    img = np.zeros((h, w, 4), np.float32)
    base = hexrgb(colour)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    bundle = 4
    for i in range(strands):
        x0 = (i + 0.5) * w / strands + rng.normal(0, 0.8)
        g = (i // bundle + 0.5) * w / (strands / bundle)  # bundle centre
        knot_y = h * 0.16
        # strand path: from its own warp position to the bundle knot, then hanging free with a little drift
        drift = rng.normal(0, 2.0)
        x_at = np.where(yy < knot_y, x0 + (g - x0) * (yy / knot_y) * 0.7, g + (x0 - g) * 0.35 + drift * (yy - knot_y) / h)
        wid = 2.2 + rng.uniform(-0.3, 0.5)
        end = h * rng.uniform(0.86, 0.99)
        a = np.clip(1.2 - np.abs(xx - x_at) / (wid * 0.5), 0, 1) * (yy < end)
        twist = 0.88 + 0.12 * np.sin((yy * 0.9 + xx * 0.6) + i)
        col = base * twist[..., None] * rng.uniform(0.92, 1.04)
        img[..., :3] = np.where(a[..., None] > img[..., 3:4], col, img[..., :3])
        img[..., 3] = np.maximum(img[..., 3], a)
    if knots:
        for b in range(strands // bundle):
            g = (b + 0.5) * w / (strands / bundle)
            m = ((xx - g) / (w / strands * 1.6)) ** 2 + ((yy - h * 0.16) / 7) ** 2 < 1
            img[m, :3] = base * 0.86
            img[m, 3] = 1
    # warp continues into the rug: fully opaque first rows
    img[: int(h * 0.05), :, 3] = 1
    img[: int(h * 0.05), :, :3] = base * 0.9
    return img
