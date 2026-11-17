"""
The thirteen rug designs of the Rug Exhibition Hall, painted at knot resolution (see rugkit.py).

Each design returns a `Design`: the colour image at knot (or weave-unit) resolution and how to expand it (knotted pile,
tufted pile or flatweave), plus an optional silk mask (Isfahan). Designs follow the products' descriptions:

  vinton-teal      Persian medallion, deep teal field, ivory medallion and border, hand-finished fringes
  vinton-rust      allover rust and terracotta florals (herati lattice), washed antique look, worn patches
  motion-denim     modern tufted: loose dry-brush bands in faded denim blues on ivory
  motion-marine    modern tufted: abstract waves in marine blues and sand, sand flecks
  heriz-runner     coarse geometric Heriz: teal field, angular medallions, brick red border with turtles
  tabriz-runner    fine Tabriz: cream and pale gold allover florals
  isfahan          ivory field with teal medallion and spandrels, fine arabesques, silk highlights
  motion-wall-*    the Motion designs at wall size
  farmhouse-border navy and cream flatweave with a border, heathered undyed ground
  farmhouse-stripe navy stripes on undyed wool, hand-loom irregularities, whipped edges
  kashan           heirloom: rust field, indigo medallion and spandrels, ivory, softened with age
  mahal            open, relaxed florals in rust and soft blue, strong vegetable-dye abrash
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
from scipy import ndimage as ndi

import rugkit as K


@dataclass
class Design:
    rgb: np.ndarray                      # knot-resolution colour (h, w, 3)
    kind: str                            # 'knot' | 'tuft' | 'weave'
    kp: int                              # texture pixels per knot / weave unit
    silk: np.ndarray | None = None       # knot-resolution silk mask (lower roughness)
    notes: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------------------------------------------
# Persian (curvilinear) builder
# ---------------------------------------------------------------------------------------------------------------

@dataclass
class PersianSpec:
    palette: list[str]
    field: int
    outline: int
    vine: int
    motif_cols: list[int]
    motif_outline: int
    medallion: list[tuple[float, int, int | None]] | None   # (scale, colour, outline) outer -> inner
    med_size: tuple[float, float] = (0.30, 0.22)            # semi-axes as fractions of the field width / height
    med_lobes: int = 16
    med_depth: float = 0.16
    med_diamond: float = 0.35
    spandrel: tuple[int, int] | None = None                 # (colour, outline)
    spandrel_size: float = 0.36
    fill: str = 'floral'                                    # floral | herati | open
    density: float = 1.0
    border: dict = field(default_factory=dict)
    abrash: dict = field(default_factory=dict)
    end_band: int = 0                                       # palette index of the flatwoven end band (kilim)
    detail: dict = field(default_factory=dict)              # region colour -> (vine, flower, centre) of the fine filler


def fill_floral(cv: K.Canvas, rng, sp: PersianSpec, fx: float, fy: float) -> None:
    """Scrolling vines with rosettes, palmettes and leaves over the top-left quadrant of the field."""
    unit = cv.unit  # sizes are tuned for a 768-knot-wide rug
    step = 26 * unit / math.sqrt(sp.density)
    vines = []
    nx, ny = int(fx / step) + 2, int(fy / step) + 2
    for j in range(ny):
        for i in range(nx):
            x = -fx + (i + rng.uniform(0.1, 0.9)) * step
            y = -fy + (j + rng.uniform(0.1, 0.9)) * step
            if x > 2 or y > 2:
                continue
            ang = rng.uniform(0, 2 * math.pi)
            vines.append(K.scroll(x, y, ang, step * rng.uniform(1.0, 1.7), rng.choice([-1, 1]) * rng.uniform(0.6, 1.2)))
    cv.lines(vines, sp.vine, max(1.0, 2.0 * unit))
    # leaves along the vines
    for pl in vines:
        for t in (0.35, 0.7):
            k = int(len(pl) * t)
            (x0, y0), (x1, y1) = pl[k], pl[min(len(pl) - 1, k + 1)]
            a = math.atan2(y1 - y0, x1 - x0) + rng.choice([-1, 1]) * 0.9
            s = rng.uniform(4.5, 6.5) * unit
            cv.stamp(x0 + math.cos(a) * s * 0.9, y0 + math.sin(a) * s * 0.9, s, K.leaf(s, a), sp.motif_cols[-1], sp.motif_outline)
    # flowers at the vine tips and on the grid
    cols = sp.motif_cols
    for n, pl in enumerate(vines):
        x, y = pl[-1]
        (xa, ya) = pl[-6]
        a = math.atan2(y - ya, x - xa)
        kind = n % 3
        if kind == 0:
            s = rng.uniform(8, 12) * unit
            cv.stamp(x, y, s, K.rosette(s, int(rng.choice([6, 8])), 0.4, rng.uniform(0, 1)), cols[n % len(cols)], sp.motif_outline)
            cv.stamp(x, y, s * 0.4, K.disc(s * 0.38), cols[(n + 1) % len(cols)], None)
        elif kind == 1:
            s = rng.uniform(11, 16) * unit
            cv.stamp(x, y, s, K.palmette(s, a), cols[(n + 2) % len(cols)], sp.motif_outline)
            cv.stamp(x + math.cos(a) * s * 0.35, y + math.sin(a) * s * 0.35, s * 0.4, K.palmette(s * 0.45, a, 5), cols[(n + 3) % len(cols)], None)
        else:
            s = rng.uniform(4, 6) * unit
            cv.stamp(x, y, s, K.rosette(s, 5, 0.45), cols[(n + 1) % len(cols)], sp.motif_outline)


def fill_herati(cv: K.Canvas, rng, sp: PersianSpec, fx: float, fy: float) -> None:
    """Herati: a diamond lattice with a rosette in each diamond and four curved 'fish' leaves around it."""
    unit = cv.unit
    cw = 52 * unit / math.sqrt(sp.density)
    ch = cw * 1.3
    nx, ny = int(fx / cw) + 2, int(fy / ch) + 2
    lines = []
    for j in range(-1, ny + 1):
        for i in range(-1, nx + 1):
            cx = -fx + (i + 0.5) * cw
            cy = -fy + (j + 0.5) * ch
            # lattice: diamond around the cell centre (slightly curved sides)
            pts = []
            for k in range(41):
                t = k / 40 * 2 * math.pi
                r = 1.0 / (abs(math.cos(t)) + abs(math.sin(t)))
                r *= 1 + 0.08 * math.cos(4 * t)
                pts.append((cx + math.cos(t) * r * cw * 0.5, cy + math.sin(t) * r * ch * 0.5))
            lines.append(pts)
    cv.lines(lines, sp.vine, max(1.0, 2.4 * unit), sp.motif_outline)
    cols = sp.motif_cols
    for j in range(-1, ny + 1):
        for i in range(-1, nx + 1):
            cx = -fx + (i + 0.5) * cw
            cy = -fy + (j + 0.5) * ch
            for q in range(4):
                a = q * math.pi / 2 + math.pi / 4
                lx, ly = cx + math.cos(a) * cw * 0.23, cy + math.sin(a) * ch * 0.23
                s = cw * 0.3
                cv.stamp(lx, ly, s, K.leaf(s, a + math.pi / 2, 0.36, 0.3), cols[(i + j + 1) % len(cols)], sp.motif_outline)
            s = cw * 0.24
            cv.stamp(cx, cy, s, K.rosette(s, 8, 0.38), cols[(i + j) % len(cols)], sp.motif_outline)
            cv.stamp(cx, cy, s * 0.45, K.disc(s * 0.4), cols[(i + j + 2) % len(cols)], None)
            # small rosettes at the lattice nodes
            s2 = cw * 0.07
            cv.stamp(cx - cw * 0.5, cy, s2, K.rosette(s2, 6, 0.4), cols[(i + 2) % len(cols)], sp.motif_outline)


def fill_open(cv: K.Canvas, rng, sp: PersianSpec, fx: float, fy: float) -> None:
    """Mahal: large, widely spaced palmettes and rosettes on bold, relaxed vines; plenty of open ground."""
    unit = cv.unit
    cw = 112 * unit / math.sqrt(sp.density)
    ch = cw * 1.12
    nx, ny = int(fx / cw) + 2, int(fy / ch) + 2
    vines = []
    for j in range(ny + 1):
        y = -fy + j * ch
        vines.append(K.wave_line(-fx - 10, 4, y + ch * 0.5, ch * 0.32, cw * 2, phase=j * 1.3, n=120))
    for i in range(nx + 1):
        x = -fx + i * cw
        vines.append(K.wave_line(-fy - 10, 4, x + cw * 0.5, cw * 0.25, ch * 2, phase=i * 0.9, n=120, vertical=True))
    cv.lines(vines, sp.vine, 3.0 * unit, sp.motif_outline)
    cols = sp.motif_cols
    for j in range(ny + 1):
        for i in range(nx + 1):
            cx = -fx + (i + 0.5) * cw + rng.uniform(-6, 6) * unit
            cy = -fy + (j + 0.5) * ch + rng.uniform(-6, 6) * unit
            if (i + j) % 2 == 0:
                s = cw * 0.30
                a = -math.pi / 2 + rng.uniform(-0.4, 0.4)
                cv.stamp(cx, cy, s, K.palmette(s, a, 7, 1.15), cols[(i + 2 * j) % len(cols)], sp.motif_outline, 2)
                cv.stamp(cx + math.cos(a) * s * 0.3, cy + math.sin(a) * s * 0.3, s * 0.5, K.palmette(s * 0.5, a, 5), cols[(i + 2 * j + 1) % len(cols)], sp.motif_outline)
                cv.stamp(cx - math.cos(a) * s * 0.05, cy - math.sin(a) * s * 0.05, s * 0.18, K.disc(s * 0.16), cols[(i + 2 * j + 2) % len(cols)], None)
            else:
                s = cw * 0.2
                cv.stamp(cx, cy, s, K.rosette(s, 8, 0.42, 0.2), cols[(i + 2 * j + 1) % len(cols)], sp.motif_outline, 2)
                cv.stamp(cx, cy, s * 0.6, K.rosette(s * 0.55, 8, 0.3, 0.6), cols[(i + 2 * j + 3) % len(cols)], sp.motif_outline)
                cv.stamp(cx, cy, s * 0.25, K.disc(s * 0.2), cols[(i + 2 * j) % len(cols)], None)
            for q in range(2):
                a = rng.uniform(0, 2 * math.pi)
                s = cw * 0.12
                cv.stamp(cx + math.cos(a) * cw * 0.4, cy + math.sin(a) * ch * 0.4, s, K.leaf(s, a + 1.2, 0.33, 0.25), cols[-1], sp.motif_outline)


def pattern_layer(W: int, H: int, seed: int, unit: float, step: float = 16.0) -> np.ndarray:
    """A fine floral filler (tiny vines and flowers) in symbolic colours: 255 none, 0 vine, 1 flower, 2 flower centre / leaf."""
    rng = np.random.default_rng(seed)
    cv = K.Canvas(W, H, 255)
    cv.unit = unit
    st = step * unit
    vines = []
    for j in range(int(H / st) + 2):
        for i in range(int(W / st) + 2):
            x = -W / 2 + (i + rng.uniform(0, 1)) * st
            y = -H / 2 + (j + rng.uniform(0, 1)) * st
            vines.append(K.scroll(x, y, rng.uniform(0, 6.3), st * rng.uniform(0.9, 1.4), rng.choice([-1, 1]) * 0.9, 16))
    cv.lines(vines, 0, max(1.0, 1.0 * unit))
    for n, pl in enumerate(vines):
        x, y = pl[-1]
        s = rng.uniform(2.6, 3.8) * unit
        cv.stamp(x, y, s, K.rosette(s, 6, 0.45, rng.uniform(0, 1)), 1, None)
        cv.stamp(x, y, s * 0.4, K.disc(max(0.8, s * 0.35)), 2, None)
        x, y = pl[len(pl) // 2]
        a = rng.uniform(0, 6.3)
        cv.stamp(x, y, 3 * unit, K.leaf(3 * unit, a), 2, None)
    return cv.idx


def detail(cv: K.Canvas, region: np.ndarray, layer: np.ndarray, cols: tuple[int, int, int]) -> None:
    for sym, c in enumerate(cols):
        cv.idx[region & (layer == sym)] = c


def persian(W: int, H: int, seed: int, sp: PersianSpec, medallions: int = 1) -> tuple[np.ndarray, np.ndarray]:
    """Returns (palette-index canvas, field mask)."""
    rng = np.random.default_rng(seed)
    cv = K.Canvas(W, H, sp.field)
    b = sp.border
    unit = W / 768.0 if W >= H * 0.6 else W / 360.0
    cv.unit = unit
    Eb = b.get('binding', 3)
    g1 = b.get('outer', 14) * unit
    mb = b.get('main', 56) * unit
    g2 = b.get('inner', 14) * unit
    E = Eb + g1 + mb + g2 + 2
    fx, fy = (W - 1) / 2 - E, (H - 1) / 2 - E
    {'floral': fill_floral, 'herati': fill_herati, 'open': fill_open}[sp.fill](cv, rng, sp, fx, fy)
    # spandrels (corner quarter medallions)
    if sp.spandrel:
        sc, so = sp.spandrel
        ax, ay = fx * sp.spandrel_size * 1.25, fy * sp.spandrel_size * 0.95
        dxc, dyc = cv.X + fx, cv.Y + fy
        m = (dxc >= 0) & (dyc >= 0) & K.lobed(dxc, dyc, ax, ay, 12, 0.18, 1.4)
        cv.put(m, sc, so, 2)
        inner = (dxc >= 0) & (dyc >= 0) & K.lobed(dxc, dyc, ax * 0.78, ay * 0.78, 12, 0.14, 1.4)
        cv.put(inner, sc, so, 1)
        lay = pattern_layer(W, H, seed + 11, unit, 15)
        if sc in sp.detail:
            detail(cv, inner, lay, sp.detail[sc])
        # a few larger blossoms inside the spandrel
        sub = np.random.default_rng(seed + 7)
        for k in range(6):
            a = (k + 0.5) / 6 * 1.5708
            x, y = -fx + math.cos(a) * ax * 0.5, -fy + math.sin(a) * ay * 0.5
            s = 7 * unit
            cv.stamp(x, y, s, K.rosette(s, 8, 0.4), sp.motif_cols[k % len(sp.motif_cols)], so)
            cv.stamp(x, y, s * 0.4, K.disc(s * 0.35), sp.motif_cols[(k + 2) % len(sp.motif_cols)], None)
    # medallion(s)
    if sp.medallion:
        centres = [0.0] if medallions == 1 else [(-(H - 1) / 2 + E) + (k + 0.5) * (2 * fy / medallions) for k in range(medallions)]
        for cy in centres:
            if cy > 1:
                continue
            ax, ay = fx * sp.med_size[0] * 2, fy * sp.med_size[1] * 2 if medallions == 1 else min(fy / medallions * 0.8, fx * 1.2)
            dx, dy = cv.X, cv.Y - cy
            u, v = dx / ax, dy / ay
            rr = np.hypot(u, v) * (1 - sp.med_diamond) + (np.abs(u) + np.abs(v)) / 1.25 * sp.med_diamond
            th = np.arctan2(v, u)
            lay = pattern_layer(W, H, seed + 13, unit, 13)
            for li, (scale, col, oc) in enumerate(sp.medallion):
                edge = scale * (1 - sp.med_depth * (1 - np.abs(np.cos(sp.med_lobes * th / 2))) ** 1.4)
                m = rr < edge
                cv.put(m, col, oc, 2 if li == 0 else 1)
                if col in sp.detail:
                    detail(cv, m, lay, sp.detail[col])
                # a ring of small rosettes inside each layer
                if li < len(sp.medallion) - 1:
                    nxt = sp.medallion[li + 1][0]
                    rm = (scale + nxt) / 2
                    n = 8 + 4 * li
                    for k in range(n):
                        t = (k + 0.5) / n * 2 * math.pi
                        x, y = math.cos(t) * rm * ax * 0.95, cy + math.sin(t) * rm * ay * 0.95
                        s = max(2.5, (scale - nxt) * min(ax, ay) * 0.28)
                        cv.stamp(x, y, s, K.rosette(s, 6, 0.4), sp.motif_cols[(k + li) % len(sp.motif_cols)], sp.motif_outline)
            # centre rosette
            s = min(ax, ay) * sp.medallion[-1][0] * 0.55
            cv.stamp(0, cy, s, K.rosette(s, 8, 0.38), sp.motif_cols[0], sp.motif_outline)
            cv.stamp(0, cy, s * 0.5, K.rosette(s * 0.45, 8, 0.3, 0.4), sp.medallion[0][1], sp.motif_outline)
            # pendants and finial along the long axis
            py = cy - ay * sp.medallion[0][0] * 1.02
            pl = ay * 0.32
            cv.stamp(0, py - pl * 0.45, pl, K.cartouche(ax * 0.13, pl * 0.5), sp.medallion[0][1], sp.medallion[0][2])
            cv.stamp(0, py - pl * 0.45, pl * 0.6, K.cartouche(ax * 0.06, pl * 0.26), sp.medallion[-1][1], None)
            fs = pl * 0.5
            cv.stamp(0, py - pl * 0.95, fs, K.palmette(fs, -math.pi / 2, 5, 0.9), sp.medallion[1][1] if len(sp.medallion) > 1 else sp.motif_cols[0], sp.medallion[0][2])
    cv.mirror4()
    # field frame and border bands (symmetric by construction)
    e, s, side = K.edge_fields(cv)
    cv.idx[e < Eb] = sp.outline
    ps = K.border_period((H - 1) / 2 - Eb - g1 - mb / 2, mb * 1.15)
    pe = K.border_period((W - 1) / 2 - Eb - g1 - mb / 2, mb * 1.15)
    gp = g1 * 1.25
    K.guard(cv, e, s, Eb, Eb + g1, b['guard_ground'], b['guard_dot'], b.get('guard_line', sp.outline), gp, b.get('guard_kind', 'dots'))
    K.main_border(cv, e, s, side, Eb + g1, Eb + g1 + mb, b['ground'], b['vine'], b['motifs'], ps, pe, sp.outline, b.get('leaves'))
    K.guard(cv, e, s, Eb + g1 + mb, Eb + g1 + mb + g2, b.get('guard2_ground', b['guard_ground']), b.get('guard2_dot', b['guard_dot']), b.get('guard_line', sp.outline), g2 * 1.25, b.get('guard2_kind', b.get('guard_kind', 'dots')))
    cv.idx[(e >= E - 2) & (e < E)] = sp.outline
    # corner rosettes of the main border
    for sx in (-1, 1):
        for sy in (-1, 1):
            cx = sx * ((W - 1) / 2 - Eb - g1 - mb / 2)
            cy = sy * ((H - 1) / 2 - Eb - g1 - mb / 2)
            r = mb * 0.42
            m0, _ = b['motifs'][0][1], None
            cv.stamp(cx, cy, r, K.rosette(r, 8, 0.32), b['motifs'][0][1], sp.outline)
            cv.stamp(cx, cy, r * 0.45, K.rosette(r * 0.4, 8, 0.3), b['vine'], None)
    field_mask = e >= E
    return cv.idx, field_mask


def end_band(rgb: np.ndarray, rows: int, colour: str, rng) -> np.ndarray:
    """The flatwoven end (kilim) where the warps leave the pile: a few rows of warp-coloured weave."""
    c = K.hexrgb(colour)
    for r in range(rows):
        f = 0.92 + 0.08 * rng.uniform(size=(rgb.shape[1], 1))
        rgb[r] = c * f
        rgb[-1 - r] = c * f
    return rgb


# ---------------------------------------------------------------------------------------------------------------
# The designs
# ---------------------------------------------------------------------------------------------------------------

def vinton_teal() -> Design:
    P = ['#1d5558', '#e6dbc2', '#172632', '#a4462f', '#c7a05b', '#5f9893', '#2b7276', '#8c5a3c']
    #     0 field     1 ivory    2 outline  3 rust     4 gold     5 lt teal  6 teal2    7 brown
    sp = PersianSpec(P, field=0, outline=2, vine=5, motif_cols=[1, 3, 4, 6, 1, 5], motif_outline=2,
                     medallion=[(1.0, 1, 2), (0.78, 6, 2), (0.55, 3, 2), (0.32, 1, 2)], med_size=(0.30, 0.22), med_lobes=18,
                     spandrel=(1, 2), fill='floral', density=1.0, detail={1: (5, 3, 6), 6: (1, 4, 3), 3: (4, 1, 6)},
                     border=dict(ground=1, vine=6, motifs=[('rosette', 3, 2, 4), ('palmette', 6, 2, 3)], leaves=5, guard_ground=3, guard_dot=1, guard_kind='reciprocal', guard2_kind='dots'),
                     abrash={0: 0.035, 1: 0.02})
    idx, fm = persian(768, 1024, 101, sp)
    rng = np.random.default_rng(1)
    rgb = K.colourise(rng, idx, P, sp.abrash)
    rgb = end_band(rgb, 5, '#e8e0cc', rng)
    return Design(rgb, 'knot', 4, notes=['teal field, ivory 18-lobed medallion with teal, rust and ivory rings, ivory spandrels', 'ivory main border with rust rosettes and teal palmettes on a vine, rust reciprocal outer guard'])


def vinton_rust() -> Design:
    P = ['#93402a', '#c46a43', '#e0cfae', '#2b3350', '#3a2219', '#c29454', '#868b66', '#b5553a']
    #    0 rust     1 terracotta 2 cream  3 navy     4 outline  5 gold     6 sage     7 red
    sp = PersianSpec(P, field=0, outline=4, vine=5, motif_cols=[2, 1, 3, 7, 6, 2], motif_outline=4,
                     medallion=None, fill='herati', density=0.8,
                     border=dict(ground=3, vine=1, motifs=[('rosette', 2, 4, 0), ('cartouche', 1, 4, 2)], leaves=5, guard_ground=2, guard_dot=0, guard_kind='chain', guard2_ground=1, guard2_dot=2),
                     abrash={0: 0.05, 1: 0.03})
    idx, fm = persian(768, 1024, 202, sp)
    rng = np.random.default_rng(2)
    rgb = K.colourise(rng, idx, P, sp.abrash)
    rgb = K.desaturate(rgb, 0.18)
    rgb = K.wear(rng, rgb, 0.2, '#d8c6a4', 40)
    rgb = end_band(rgb, 5, '#ddd2bb', rng)
    return Design(rgb, 'knot', 4, notes=['allover herati lattice: rosettes in curved diamonds, four fish leaves each, rust and terracotta on rust', 'navy main border; antique wash: 18 % desaturated, soft worn patches towards the foundation'])


def kashan() -> Design:
    P = ['#963a27', '#22305a', '#e4d9c0', '#141b30', '#c08c50', '#6c7a57', '#c06a5a', '#7b95b3', '#b04b33']
    #    0 rust     1 indigo   2 ivory    3 outline  4 camel    5 green    6 rose     7 lt blue  8 red
    sp = PersianSpec(P, field=0, outline=3, vine=4, motif_cols=[2, 7, 6, 4, 1, 5], motif_outline=3,
                     medallion=[(1.0, 1, 3), (0.8, 2, 3), (0.6, 8, 3), (0.38, 1, 3), (0.2, 2, 3)], med_size=(0.30, 0.2), med_lobes=16, med_depth=0.18,
                     spandrel=(1, 3), spandrel_size=0.38, fill='floral', density=1.5, detail={1: (7, 2, 8), 2: (5, 8, 1), 8: (4, 2, 1)},
                     border=dict(ground=1, vine=4, motifs=[('palmette', 8, 3, 2), ('rosette', 2, 3, 8)], leaves=5, guard_ground=2, guard_dot=0, guard_kind='reciprocal', guard2_ground=8, guard2_dot=2, guard2_kind='dots'),
                     abrash={0: 0.045, 1: 0.03, 2: 0.02})
    idx, fm = persian(768, 1024, 303, sp)
    rng = np.random.default_rng(3)
    rgb = K.colourise(rng, idx, P, sp.abrash)
    rgb = K.desaturate(rgb, 0.1)
    rgb = K.wear(rng, rgb, 0.22, '#cdbb9a', 90)
    rgb = end_band(rgb, 6, '#e2d8c2', rng)
    return Design(rgb, 'knot', 4, notes=['rust field densely filled with scrolling florals; indigo 16-lobed medallion with ivory, red and indigo rings and pendants', 'indigo spandrels, indigo main border with red palmettes and ivory rosettes; softened with age (desaturated, faint wear)'])


def isfahan() -> Design:
    P = ['#ebe2cf', '#2a6a6b', '#16454a', '#bf9a5c', '#9b4a33', '#20303f', '#7fa2a4', '#c78b7c', '#f4eee0']
    #    0 ivory    1 teal     2 dk teal  3 gold     4 rust     5 outline  6 lt teal  7 rose     8 silk white
    sp = PersianSpec(P, field=0, outline=5, vine=6, motif_cols=[1, 2, 4, 3, 6, 1], motif_outline=5,
                     medallion=[(1.0, 1, 5), (0.8, 8, 5), (0.62, 2, 5), (0.42, 3, 5), (0.24, 8, 5)], med_size=(0.32, 0.22), med_lobes=20, med_depth=0.2, med_diamond=0.5,
                     spandrel=(1, 5), spandrel_size=0.34, fill='floral', density=1.6, detail={1: (6, 8, 4), 8: (6, 1, 4), 2: (3, 8, 4), 3: (2, 8, 4)},
                     border=dict(ground=1, vine=3, motifs=[('palmette', 8, 5, 4), ('rosette', 4, 5, 3)], leaves=6, guard_ground=0, guard_dot=4, guard_kind='chain', guard2_ground=2, guard2_dot=3),
                     abrash={1: 0.02})
    idx, fm = persian(768, 1024, 404, sp)
    rng = np.random.default_rng(4)
    rgb = K.colourise(rng, idx, P, sp.abrash, jitter=0.018)
    rgb = end_band(rgb, 5, '#efe8d8', rng)
    silk = np.isin(idx, [0, 8, 3]).astype(np.float32)
    return Design(rgb, 'knot', 4, silk=silk, notes=['ivory field with dense fine teal arabesques, teal 20-lobed medallion with silk-white, deep teal and gold rings', 'silk mask on ivory, white and gold (roughness 0.42 there, 0.9 on wool) for the sheen at an angle'])


def mahal() -> Design:
    P = ['#9e472d', '#6e8ea7', '#e2d2b0', '#2e3d5c', '#c3994d', '#787847', '#3a2520', '#b5634a']
    #    0 rust     1 soft blue 2 cream   3 indigo   4 ochre    5 olive    6 outline  7 coral
    sp = PersianSpec(P, field=0, outline=6, vine=5, motif_cols=[1, 2, 4, 3, 7, 5], motif_outline=6,
                     medallion=None, fill='open', density=1.0,
                     border=dict(main=64, ground=1, vine=2, motifs=[('palmette', 0, 6, 4), ('rosette', 2, 6, 0)], leaves=5, guard_ground=2, guard_dot=0, guard_kind='barber', guard2_ground=3, guard2_dot=2),
                     abrash={0: 0.08, 1: 0.05, 2: 0.03})
    idx, fm = persian(768, 1024, 505, sp)
    rng = np.random.default_rng(5)
    rgb = K.colourise(rng, idx, P, sp.abrash)
    rgb = end_band(rgb, 5, '#e0d5bf', rng)
    return Design(rgb, 'knot', 4, notes=['open Mahal field: large palmettes and double rosettes far apart on bold wavy vines, rust ground', 'soft blue main border with rust palmettes; strong vegetable-dye abrash (8 % bands in the field)'])


def tabriz_runner() -> Design:
    P = ['#ebe0c6', '#d3b577', '#b28c4c', '#c49585', '#98a383', '#9cadb1', '#7a6550', '#f3ecdb']
    #    0 cream    1 pale gold 2 gold    3 rose     4 sage     5 blue-grey 6 outline 7 light
    sp = PersianSpec(P, field=0, outline=6, vine=1, motif_cols=[3, 2, 4, 5, 1, 4], motif_outline=6,
                     medallion=[(1.0, 1, 6), (0.7, 7, 6), (0.42, 3, 6)], med_size=(0.36, 0.06), med_lobes=14,
                     fill='floral', density=1.6, detail={1: (2, 7, 3), 7: (4, 3, 2)},
                     border=dict(binding=2, outer=9, main=40, inner=9, ground=1, vine=2, motifs=[('rosette', 7, 6, 3), ('palmette', 3, 6, 7)], leaves=4, guard_ground=0, guard_dot=2, guard_kind='dots'),
                     abrash={0: 0.02})
    idx, fm = persian(328, 1024, 606, sp, medallions=3)
    rng = np.random.default_rng(6)
    rgb = K.colourise(rng, idx, P, sp.abrash, jitter=0.02)
    rgb = end_band(rgb, 5, '#efe7d6', rng)
    return Design(rgb, 'knot', 4, notes=['fine Tabriz runner (about 2.9 mm knots): cream field with scrolling florals in rose, gold, sage and blue-grey', 'three pale gold medallions along the length, pale gold main border with cream rosettes'])


def heriz_runner() -> Design:
    """Coarse geometric Heriz: angular medallions with latch hooks, stepped outlines, turtle border."""
    P = ['#2a6366', '#a63f2b', '#e7dbbf', '#1d2b42', '#2a1d19', '#7db0aa', '#c28b53', '#8f3424']
    #    0 teal     1 brick    2 ivory    3 navy     4 outline  5 lt teal  6 camel    7 dk red
    W, H = 137, 512
    rng = np.random.default_rng(707)
    cv = K.Canvas(W, H, 0)
    Eb, g1, mb, g2 = 2, 6, 20, 5
    E = Eb + g1 + mb + g2 + 1
    fx, fy = (W - 1) / 2 - E, (H - 1) / 2 - E
    # field: angular vines (zigzags) and small geometric flowers
    for j in range(0, int(fy * 2), 26):
        y = -fy + j + 10
        pts = []
        for k in range(0, int(fx) + 6, 6):
            pts.append((-fx + k, y + (6 if (k // 6) % 2 else -6)))
        cv.lines([pts], 5, 1.0)
    for j in range(0, int(fy * 2), 26):
        for i in range(0, int(fx) + 1, 16):
            x, y = -fx + i + 6, -fy + j + 10
            cv.stamp(x, y, 4, K.stepped(K.diamond(4, 4), 1.0), 6 if (i // 16 + j // 26) % 2 else 2, 4)
            cv.stamp(x, y, 1.5, K.diamond(1.6, 1.6), 1, None)
    # three medallions along the runner (stepped octagons with hooks)
    n = 3
    for k in range(n):
        cy = -fy + (k + 0.5) * (2 * fy / n)
        if cy > 1:
            continue
        a, bb = fx * 0.92, fy / n * 0.78

        def med(dx, dy, a=a, bb=bb):
            q = np.abs(dx) / a + np.abs(dy) / bb
            box = (np.abs(dx) < a * 0.78) & (np.abs(dy) < bb * 0.72)
            hooks = (q < 1.06) & ((np.floor(np.abs(dy) / 3) % 2) == 0) & (q > 0.94)
            return ((q < 0.94) & box) | ((q < 0.8)) | hooks
        cv.stamp(0, cy, max(a, bb), K.stepped(med, 1.0), 1, 4)
        cv.stamp(0, cy, max(a, bb) * 0.7, K.stepped(K.diamond(a * 0.62, bb * 0.6), 1.0), 3, 4)
        cv.stamp(0, cy, max(a, bb) * 0.5, K.stepped(K.diamond(a * 0.42, bb * 0.4), 1.0), 2, 4)
        cv.stamp(0, cy, max(a, bb) * 0.3, K.stepped(K.diamond(a * 0.22, bb * 0.2), 1.0), 0, 4)
        cv.stamp(0, cy, 3, K.diamond(3, 3), 6, None)
        # pendants
        cv.stamp(0, cy - bb * 1.02, 6, K.stepped(K.diamond(6, 5), 1.0), 2, 4)
        cv.stamp(0, cy - bb * 1.02, 2, K.diamond(2.5, 2.5), 1, None)
    cv.mirror4()
    e, s, side = K.edge_fields(cv)
    cv.idx[e < Eb] = 4
    K.guard(cv, e, s, Eb, Eb + g1, 2, 1, 4, 6, 'reciprocal')
    ps = K.border_period((H - 1) / 2 - Eb - g1 - mb / 2, mb * 1.3)
    pe = K.border_period((W - 1) / 2 - Eb - g1 - mb / 2, mb * 1.3)
    K.main_border(cv, e, s, side, Eb + g1, Eb + g1 + mb, 1, 7, [('turtle', 2, 4), ('turtle', 3, 4)], ps, pe, 4, None)
    K.guard(cv, e, s, Eb + g1 + mb, Eb + g1 + mb + g2, 6, 3, 4, 5, 'barber')
    cv.idx[(e >= E - 1) & (e < E)] = 4
    for sx in (-1, 1):
        for sy in (-1, 1):
            cx, cy = sx * ((W - 1) / 2 - Eb - g1 - mb / 2), sy * ((H - 1) / 2 - Eb - g1 - mb / 2)
            cv.stamp(cx, cy, mb * 0.45, K.stepped(K.diamond(mb * 0.42, mb * 0.42), 1.0), 2, 4)
    rgb = K.colourise(rng, cv.idx, P, {0: 0.06, 1: 0.04})
    rgb = end_band(rgb, 3, '#e6dcc6', rng)
    return Design(rgb, 'knot', 8, notes=['coarse Heriz (about 5.9 mm knots): teal field with zigzag vines, three stepped medallions with latch hooks', 'brick red main border with ivory and navy turtles, ivory reciprocal outer guard; strong abrash'])


# Modern tufted -------------------------------------------------------------------------------------------------

def motion_denim(w: int, h: int, seed: int) -> Design:
    """Loose dry-brush bands across the rug in faded denims on ivory. Colour at half the texture resolution."""
    rng = np.random.default_rng(seed)
    ground = K.hexrgb('#e7e3da')
    blues = [K.hexrgb(c) for c in ['#5b7896', '#7f9bb8', '#3d5674', '#a7bbcf', '#4c6886']]
    img = np.tile(ground, (h, w, 1)).astype(np.float32)
    img *= (1 + 0.025 * K.fbm(rng, h, w, w / 6, 4))[..., None]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    y = rng.uniform(0.02, 0.08) * h
    n = 0
    while y < h * 0.98:
        bw = rng.uniform(0.03, 0.085) * h
        col = blues[n % len(blues)]
        n += 1
        edge_a = y + K.value_noise(rng, 1, w, w / 3)[0] * bw * 0.35 + K.value_noise(rng, 1, w, w / 60)[0] * bw * 0.05
        edge_b = y + bw + K.value_noise(rng, 1, w, w / 3)[0] * bw * 0.35 + K.value_noise(rng, 1, w, w / 60)[0] * bw * 0.07
        # stroke extent across the width (some strokes start or end before the edge, with a dry, broken end)
        x0 = rng.uniform(-0.35, 0.12) * w
        x1 = rng.uniform(0.88, 1.35) * w
        if rng.uniform() < 0.5:
            x0, x1 = w - x1, w - x0
        # bristle streaks run along the stroke (across the rug); each row of bristles runs dry at its own point
        sr = K.value_noise(rng, h, 1, max(2, bw / 10)) * 0.6 + K.value_noise(rng, h, 1, 1.6) * 0.4
        sr = (sr - sr.min()) / (np.ptp(sr) + 1e-6)
        inband = np.clip(np.minimum(yy - edge_a[None, :], edge_b[None, :] - yy) / (bw * 0.08), 0, 1)
        taper = np.clip(np.minimum(xx - x0, x1 - xx) / (w * 0.22), 0, 1)
        a = inband * np.clip((taper * 1.5 - (1 - sr) * 0.9) * 3.0, 0, 1)
        load = 0.55 + 0.45 * np.clip(taper * 1.2, 0, 1)  # paint thins out towards the dry end
        a = a * (0.6 + 0.4 * sr) * load
        tone = 1 + 0.10 * (sr - 0.5)
        img = img * (1 - a[..., None]) + (col * tone[..., None]) * a[..., None]
        y += bw * rng.uniform(0.55, 1.0) + rng.uniform(-0.01, 0.07) * h
    # tape binding round the edge
    bind = 0.008 * w
    m = (xx < bind) | (xx > w - 1 - bind) | (yy < bind) | (yy > h - 1 - bind)
    img[m] = K.hexrgb('#cfcac0')
    return Design(np.clip(img, 0, 1), 'tuft', 2, notes=['tufted: dry-brush bands in five faded denims on ivory, streaked along the stroke, broken ends', 'bound edge, no fringe'])


def motion_marine(w: int, h: int, seed: int) -> Design:
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = xx / w, yy / w
    warp = K.fbm(rng, h, w, w / 3, 4)
    f = v * 9 + 0.55 * np.sin(u * 5.2 + v * 2.1 + warp * 2.2) + 0.35 * np.sin(u * 11 - v * 3 + 1.3) + warp * 0.6
    band = np.floor(f).astype(np.int64)
    frac = f - np.floor(f)
    cols = [K.hexrgb(c) for c in ['#1d3a5b', '#2c5276', '#d8c6a1', '#16304d', '#4b73a0', '#20446a', '#c9b48c', '#335f88']]
    pick = rng.integers(0, len(cols), 64)
    img = np.stack([c for c in cols])[pick[band % 64]]
    # thin sand outline between some bands
    line = (frac < 0.06) & ((band % 3) == 0)
    img[line] = K.hexrgb('#e1d1ad')
    # sand flecks through the blue
    fl = (rng.uniform(size=(h, w)) < 0.0035)
    fl = ndi.binary_dilation(fl, iterations=1) & (ndi.gaussian_filter(rng.uniform(size=(h, w)).astype(np.float32), 1.0) > 0.5)
    blue = img[..., 2] > img[..., 0] + 0.1
    img[fl & blue] = K.hexrgb('#d9c8a2') * 0.95
    img = img * (1 + 0.04 * K.fbm(rng, h, w, w / 8, 3))[..., None]
    bind = 0.008 * w
    m = (xx < bind) | (xx > w - 1 - bind) | (yy < bind) | (yy > h - 1 - bind)
    img[m] = K.hexrgb('#1a2e47')
    return Design(np.clip(img, 0, 1).astype(np.float32), 'tuft', 2, notes=['tufted: abstract flowing wave bands in marine blues with sand bands and thin sand lines', 'sand flecks through the blue, navy bound edge'])


# Flatweaves ------------------------------------------------------------------------------------------------------

def heather(rng, h, w, base: str, amount: float = 0.07) -> np.ndarray:
    """Undyed wool: a heathered mix of near-whites and greys, varying weft by weft."""
    c = K.hexrgb(base)
    rows = rng.normal(0, amount * 0.6, (h, 1))
    speck = rng.normal(0, amount, (h, w)) * (rng.uniform(size=(h, w)) < 0.35)
    f = 1 + rows + ndi.gaussian_filter1d(speck, 2.0, axis=1) + 0.03 * K.fbm(rng, h, w, w / 5, 3)
    return np.clip(c[None, None, :] * f[..., None], 0, 1).astype(np.float32)


def farmhouse_border() -> Design:
    w, h = 768, 1024
    rng = np.random.default_rng(909)
    img = heather(rng, h, w, '#e6dcc6', 0.06)
    navy = heather(rng, h, w, '#1f2a47', 0.10)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    e = np.minimum(np.minimum(xx, w - 1 - xx), np.minimum(yy, h - 1 - yy))
    # weft wobble: a hand loom's rows are not perfectly straight
    wob = K.value_noise(rng, h, 1, 30)[:, :1] * 1.5
    e2 = e + wob
    m = ((e2 > 22) & (e2 < 92)) | ((e2 > 112) & (e2 < 124))
    img[m] = navy[m]
    # thin cream pinstripe inside the wide border
    ps = (e2 > 52) & (e2 < 58)
    img[ps] = K.hexrgb('#e6dcc6') * 0.97
    return Design(img, 'weave', 4, notes=['flat-woven: heathered undyed cream field, a wide navy border band with a cream pinstripe and a thin navy line inside', 'weft-faced weave texture, gentle hand-loom wobble'])


def farmhouse_stripe() -> Design:
    w, h = 768, 1024
    rng = np.random.default_rng(1010)
    img = heather(rng, h, w, '#ddd2bb', 0.07)
    navy = heather(rng, h, w, '#22304f', 0.10)
    # stripe groups along the length: a wide stripe flanked by thin ones, repeated, symmetrical about the centre
    unit = [(0, 10, 'g'), (10, 40, 'n'), (40, 52, 'g'), (52, 58, 'n'), (58, 68, 'g'), (68, 74, 'n'), (74, 128, 'g')]
    period = 128
    yy = np.arange(h)
    d = np.abs(yy - (h - 1) / 2)
    ph = (d + 40) % period
    stripe = np.zeros(h, bool)
    for a, b, k in unit:
        if k == 'n':
            stripe |= (ph >= a) & (ph < b)
    wob = (K.value_noise(rng, h, w, 40) * 1.2).astype(np.int64)
    rows = np.clip(yy[:, None] + wob, 0, h - 1)
    m = stripe[rows]
    img[m] = navy[m]
    # whipped edges: diagonal overcast stitches along all four sides
    xx = np.arange(w)[None, :]
    edge = np.minimum(np.minimum(xx, w - 1 - xx), np.minimum(yy[:, None], h - 1 - yy[:, None]))
    stitch = (edge < 6) & ((((yy[:, None] + xx) // 3) % 2) == 0)
    img[stitch] = K.hexrgb('#1c2846')
    img[(edge < 6) & ~stitch] = K.hexrgb('#d6cab2')
    return Design(img, 'weave', 4, notes=['flat-woven: navy stripe groups (wide + two thin) on heathered undyed wool, symmetrical about the centre', 'whipped edges: navy diagonal overcast stitching round all four sides; slight weft wobble'])


DESIGNS = {
    'vinton-teal': vinton_teal,
    'vinton-rust': vinton_rust,
    'motion-denim': lambda: motion_denim(1536, 2048, 31),
    'motion-marine': lambda: motion_marine(1536, 2048, 41),
    'heriz-runner': heriz_runner,
    'tabriz-runner': tabriz_runner,
    'isfahan': isfahan,
    'motion-wall-denim': lambda: motion_denim(1536, 2048, 37),
    'farmhouse-border': farmhouse_border,
    'kashan': kashan,
    'farmhouse-stripe': farmhouse_stripe,
    'mahal': mahal,
    'motion-wall-marine': lambda: motion_marine(1536, 2048, 47),
}
