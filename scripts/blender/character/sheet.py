"""Reading a concept sheet (a turnaround: front, her left side, back on a flat background), pure numpy.

Used twice: by the build, which fits parts to the sheet before modelling (the skirt's width and depth per height and its
hem, the face's width profile, the eyes' colours), and by the QA, which compares the model against the sheet
(silhouette IoU, colour regions, feature locations).

Segmentation is edge-based, not a colour threshold alone: a pale figure on a pale ground (a white T-shirt, a beige skirt
on light grey) has interiors the ground's colour, but its line art closes them. The figure is everything the
background cannot reach from the border without crossing an edge (the luminance gradient or a colour step) or a pixel
off the ground's colour; the sheet's guide lines (the floor line, the head-unit rulers' long strokes) are removed first
as long thin runs with ground on both sides, so the gap between the legs stays background.
"""
import numpy as np


# ---------------------------------------------------------------------------------------------------------------------
# Morphology and components (no scipy in Blender's Python).

def erode(m, k):
    out = m.copy()
    for d in range(1, k + 1):
        out[d:] &= m[:-d]; out[:-d] &= m[d:]; out[:, d:] &= m[:, :-d]; out[:, :-d] &= m[:, d:]
    return out


def dilate(m, k):
    out = m.copy()
    for d in range(1, k + 1):
        out[d:] |= m[:-d]; out[:-d] |= m[d:]; out[:, d:] |= m[:, :-d]; out[:, :-d] |= m[:, d:]
    return out


def label(m):
    """Connected components (4-neighbour) of a boolean mask by row runs and union-find. Returns (labels, count)."""
    h, w = m.shape
    parent = [0]

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    lab = np.zeros((h, w), np.int32)
    prev = []
    for y in range(h):
        row = m[y]
        if not row.any():
            prev = []
            continue
        d = np.diff(np.concatenate([[0], row.astype(np.int8), [0]]))
        starts = np.where(d == 1)[0]
        ends = np.where(d == -1)[0]
        cur = []
        j = 0
        for s, e in zip(starts, ends):
            ids = []
            while j < len(prev) and prev[j][1] <= s:
                j += 1
            k = j
            while k < len(prev) and prev[k][0] < e:
                ids.append(prev[k][2])
                k += 1
            if ids:
                r = find(ids[0])
                for o in ids[1:]:
                    ro = find(o)
                    if ro != r:
                        parent[ro] = r
                lid = r
            else:
                lid = len(parent)
                parent.append(lid)
            lab[y, s:e] = lid
            cur.append((s, e, lid))
        prev = cur
    roots = np.array([find(i) for i in range(len(parent))], np.int32)
    uniq, remap = np.unique(roots, return_inverse=True)
    out = remap.astype(np.int32)[lab]
    return out, len(uniq) - 1


def flood_from_border(passable):
    lab, n = label(passable)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    edge = edge[edge > 0]
    return np.isin(lab, edge)


def gradient(g):
    """Sobel magnitude of a (h, w) array."""
    p = np.pad(g, 1, mode='edge')
    gx = (p[:-2, 2:] + 2 * p[1:-1, 2:] + p[2:, 2:]) - (p[:-2, :-2] + 2 * p[1:-1, :-2] + p[2:, :-2])
    gy = (p[2:, :-2] + 2 * p[2:, 1:-1] + p[2:, 2:]) - (p[:-2, :-2] + 2 * p[:-2, 1:-1] + p[:-2, 2:])
    return np.hypot(gx, gy) / 8.0


def long_runs(m, axis, min_len):
    """Pixels of m in straight runs (along rows for axis=1, columns for axis=0) at least min_len long."""
    a = m if axis == 1 else m.T
    out = np.zeros_like(a)
    for y in range(a.shape[0]):
        row = a[y]
        if row.sum() < min_len:
            continue
        d = np.diff(np.concatenate([[0], row.astype(np.int8), [0]]))
        for s, e in zip(np.where(d == 1)[0], np.where(d == -1)[0]):
            if e - s >= min_len:
                out[y, s:e] = True
    return out if axis == 1 else out.T


# ---------------------------------------------------------------------------------------------------------------------
# Figure masks.

def background(rgb):
    border = np.concatenate([rgb[:8].reshape(-1, 3), rgb[:, :6].reshape(-1, 3), rgb[:, -6:].reshape(-1, 3)])
    return np.median(border, 0)


def figure_mask(rgb, bg=None, tol=0.09, edge_t=0.06):
    """The figures (holes included) of a sheet: the complement of what the ground floods from the border without
    crossing an edge. Returns (mask, bg)."""
    if bg is None:
        bg = background(rgb)
    h, w = rgb.shape[:2]
    off = np.abs(rgb - bg).max(2) > tol
    lum = rgb @ np.array([0.299, 0.587, 0.114])
    edges = gradient(lum) > edge_t
    # colour steps the luminance misses (a mint against a grey of the same value)
    edges |= gradient(rgb[..., 0]) > edge_t * 1.3
    edges |= gradient(rgb[..., 2]) > edge_t * 1.3
    barrier = off | edges
    # guide lines: long thin straight runs with ground on both sides (the floor, the rulers), dashes included as runs
    ground = ~barrier
    above = np.zeros_like(ground); above[4:] = ground[:-4]
    below = np.zeros_like(ground); below[:-4] = ground[4:]
    left = np.zeros_like(ground); left[:, 4:] = ground[:, :-4]
    right = np.zeros_like(ground); right[:, :-4] = ground[:, 4:]
    thin_h = barrier & above & below
    thin_v = barrier & left & right
    guides = long_runs(thin_h, 1, max(40, w // 30)) | long_runs(thin_v, 0, max(60, h // 12))
    # dashed guides: rows (columns) where thin strokes cover a good part of the width (height) are guides throughout
    gr = thin_h.sum(1) > w * 0.2
    guides[gr] |= thin_h[gr]
    gc = thin_v.sum(0) > h * 0.2
    guides[:, gc] |= thin_v[:, gc]
    barrier &= ~dilate(guides, 1)
    # close one-pixel gaps of the line art before the flood
    barrier = dilate(barrier, 1)
    reach = flood_from_border(~barrier)
    fg = ~reach
    # back to the line art's outer edge (the dilation grew it by one), thin leftovers out
    fg = erode(fg, 1)
    fg = dilate(erode(fg, 3), 3)
    # enclosed pockets of plain ground (between an arm and the body, under a hand on the skirt) are background:
    # large, the ground's own colour, no edges inside
    pocket = fg & ~off & ~dilate(edges, 2)
    lab, n = label(pocket)
    if n:
        sizes = np.bincount(lab.ravel())
        for i in range(1, n + 1):
            if sizes[i] < 400:
                continue
            sel = lab == i
            col = np.median(rgb[sel], 0)
            if np.abs(col - bg).max() < 0.025:
                fg &= ~sel
    return fg, bg


def views(rgb):
    """Split a sheet into figures left to right. Each: {'mask', 'x0', 'x1', 'rgb', 'top', 'floor', 'cx'} in sheet
    pixels (the crop's columns), keeping the largest component of each column band (labels and stray text out)."""
    fg, bg = figure_mask(rgb)
    h, w = fg.shape
    lab, n = label(fg)
    sizes = np.bincount(lab.ravel()) if n else np.zeros(1)
    out = []
    if not n:
        return out, bg
    for i in range(1, n + 1):
        if sizes[i] < h * w * 0.004:
            continue
        ys, xs = np.where(lab == i)
        if ys.max() - ys.min() < h * 0.3:
            continue
        out.append({'id': i, 'x0': int(xs.min()), 'x1': int(xs.max()) + 1, 'top': int(ys.min()), 'floor': int(ys.max()), 'area': int(sizes[i])})
    out.sort(key=lambda v: v['x0'])
    res = []
    for v in out:
        x0, x1 = max(0, v['x0'] - 20), min(w, v['x1'] + 20)
        m = (lab[:, x0:x1] == v['id'])
        cols = np.where(m.any(0))[0]
        res.append({'mask': m.astype(float), 'x0': x0, 'x1': x1, 'rgb': rgb[:, x0:x1], 'top': v['top'], 'floor': v['floor'],
                    'cx': float((m.sum(0) * np.arange(m.shape[1])).sum() / max(1, m.sum())), 'area': v['area'],
                    'aspect': (v['floor'] - v['top']) / max(1, v['x1'] - v['x0'])})
    return res, bg


def pick_figures(vs):
    """The three figures of a turnaround among the components (a head-unit ruler of ellipses is tall and narrow and
    has no colour; the figures are the three tallest of about the same height)."""
    if len(vs) <= 3:
        return vs
    hs = np.array([v['floor'] - v['top'] for v in vs], float)
    sat = []
    for v in vs:
        px = v['rgb'][v['mask'] > 0.5]
        sat.append(float(np.median(px.max(1) - px.min(1))) if len(px) else 0.0)
    score = hs / hs.max() + np.array(sat) * 2 + np.array([v['area'] for v in vs]) / max(v['area'] for v in vs)
    best = max(range(len(vs) - 2), key=lambda i: score[i:i + 3].sum() - np.ptp(hs[i:i + 3]) / hs.max())
    return vs[best:best + 3]


# ---------------------------------------------------------------------------------------------------------------------
# Measurements on a figure, in metres from the floor (the figure's height is the character's).

def colour_dist(a, b):
    return np.abs(a - b).max(-1)


def row_run(sel, x):
    """The run of True around column x in a boolean row (or (0, 0))."""
    x = int(round(x))
    if x < 0 or x >= len(sel) or not sel[x]:
        # nearest selected pixel within a few px
        near = np.where(sel[max(0, x - 6):x + 7])[0]
        if not len(near):
            return 0, 0
        x = max(0, x - 6) + int(near[len(near) // 2])
    a = x
    while a > 0 and sel[a - 1]:
        a -= 1
    b = x
    while b < len(sel) - 1 and sel[b + 1]:
        b += 1
    return a, b + 1


class Figure:
    def __init__(self, v, height):
        self.v = v
        self.m = v['mask'] > 0.5
        self.rgb = v['rgb'][..., :3]
        self.px = (v['floor'] - v['top'] + 1)
        self.k = height / self.px     # metres per pixel
        self.cx = v['cx']

    def row(self, z):
        return int(round(self.v['floor'] - z / self.k))

    def z(self, row):
        return (self.v['floor'] - row) * self.k

    def sample(self, z, dx=0.0, r=4):
        y = self.row(z)
        x = int(round(self.cx + dx / self.k))
        y0, y1 = max(0, y - r), min(self.rgb.shape[0], y + r + 1)
        x0, x1 = max(0, x - r), min(self.rgb.shape[1], x + r + 1)
        patch = self.rgb[y0:y1, x0:x1].reshape(-1, 3)
        mk = self.m[y0:y1, x0:x1].ravel()
        if mk.sum() < 3:
            return None
        return np.median(patch[mk], 0)

    def colour_run(self, z, col, tol=0.11, x=None, min_px=3, others=()):
        """The extent of pixels near a colour at height z, within the figure's run through column x (an arm or a bag
        over it does not cut it short), in metres from the figure's centre: (left, right)."""
        y = self.row(z)
        if y < 0 or y >= self.m.shape[0]:
            return None
        row = self.rgb[max(0, y - 1):y + 2].mean(0)
        a, b = row_run(self.m[y], self.cx if x is None else x)
        if b - a < 3:
            return None
        dc = colour_dist(row[a:b], col)
        sel = dc < tol
        for o in others:
            # nearer another garment's colour (a mint cardigan over a beige skirt): not this one
            sel &= dc <= colour_dist(row[a:b], np.array(o))
        if sel.sum() < min_px:
            return None
        xs = np.where(sel)[0]
        # the run's ends: clusters of at least 3 px (a stray anti-aliased pixel of a near colour does not count)
        ok = np.convolve(sel.astype(float), np.ones(3), 'same') >= 2
        xs = np.where(sel & ok)[0]
        if not len(xs):
            return None
        return ((a + xs.min() - self.cx) * self.k, (a + xs.max() + 1 - self.cx) * self.k)


def skirt_profile(rgb, height, col_srgb, z_range, others=()):
    """Per view the skirt's extent by height, from the sheet: {'front': [(z, left, right)], 'side': [...], 'back': [...],
    'hem': z, 'top': z, 'colour': sRGB}. z_range: (low, high) heights to search (below the knee to the waist)."""
    vs, bg = views(rgb)
    vs = pick_figures(vs)
    if len(vs) < 3:
        return None
    out = {}
    lo, hi = z_range
    fr = Figure(vs[0], height)
    # the skirt's own colour on this sheet: the figure's centre at mid-skirt, if it is near the brief's colour
    mid = fr.sample((lo + hi) / 2, 0.0, r=5)
    col = np.array(col_srgb)
    if mid is not None and colour_dist(mid, col) < 0.2:
        col = mid
    out['colour'] = [float(c) for c in col]
    hem, top = None, None
    for name, v in zip(('front', 'side', 'back'), vs):
        f = Figure(v, height)
        rows = []
        for z in np.arange(lo, hi, 0.01):
            r = f.colour_run(z, col, others=others)
            if r is None:
                continue
            rows.append((round(float(z), 3), round(float(r[0]), 4), round(float(r[1]), 4)))
        # keep the longest run of consecutive heights (the skirt), not a sock or a bag of a near colour
        if rows:
            best, cur = [], [rows[0]]
            for a, b in zip(rows, rows[1:]):
                if b[0] - a[0] < 0.025:
                    cur.append(b)
                else:
                    best = max(best, cur, key=len)
                    cur = [b]
            rows = max(best, cur, key=len)
        if name == 'front' and rows:
            hem, top = rows[0][0], rows[-1][0]
        # the hem's pleat points (the last 2.5 cm) narrow the run: the profile holds the faces' width down to the hem
        if rows:
            z0 = rows[0][0]
            keep = [r for r in rows if r[0] >= z0 + 0.025]
            if keep:
                ref = keep[0]
                rows = [(r[0], ref[1], ref[2]) if r[0] < z0 + 0.025 else r for r in rows]
        out[name] = rows
    if hem is None:
        return None
    out['hem'] = hem
    out['top'] = top
    return out


def garment_profile(rgb, height, col_srgb, z_range, others=()):
    """Any garment's extent by height in each view, by its colour (as skirt_profile: the longest run of heights, the
    colour taken from the sheet near the brief's): what the fitting of outer garments reads the side view's depth from."""
    return skirt_profile(rgb, height, col_srgb, z_range, others)


def garment_hem(rgb, height, col_srgb, z_range, others=(), dx=0.09):
    """The front view's lowest height at which a garment's colour still shows dx metres either side of the middle
    (a jacket's or cardigan's hem, past an open front and over what it covers)."""
    vs, bg = views(rgb)
    vs = pick_figures(vs)
    if not vs:
        return None
    f = Figure(vs[0], height)
    col = np.array(col_srgb)
    lo, hi = z_range
    found = None
    miss = 0
    for z in np.arange(hi, lo, -0.005):
        hit = False
        for sx in (1, -1):
            c = f.sample(z, sx * dx, r=2)
            if c is None:
                continue
            d = colour_dist(c, col)
            if d < 0.12 and all(d <= colour_dist(c, np.array(o)) for o in others):
                hit = True
        if hit:
            found, miss = float(z), 0
        elif found is not None:
            miss += 1
            if miss > 4:
                break
    return round(found, 3) if found is not None else None


def head_features(fig, chin_z, head_top_z, skin_srgb):
    """On a front view: the face's half-width by height (skin pixels around the centre), the hairline at the centre,
    the eyes (dark blobs in the upper face: centres, and the iris colours), the mouth's height. Heights in metres from
    the floor, widths in metres."""
    k = fig.k
    skin = np.array(skin_srgb)
    y_top, y_chin = fig.row(head_top_z), fig.row(chin_z)
    if y_chin - y_top < 12:
        return None
    rgb = fig.rgb
    # the sheet's own skin tone: the face's centre a third of the way up from the chin
    s = fig.sample(chin_z + (head_top_z - chin_z) * 0.22, 0.0, r=2)
    if s is not None and colour_dist(s, skin) < 0.18:
        skin = s
    is_skin = (colour_dist(rgb, skin) < 0.11) & fig.m
    prof = []
    for y in range(y_top, y_chin + 1):
        a, b = row_run(fig.m[y], fig.cx)
        xs = np.where(is_skin[y, a:b])[0]
        if len(xs) >= 2:
            prof.append((round(fig.z(y), 4), round((fig.cx - a - xs.min()) * k, 4), round((a + xs.max() + 1 - fig.cx) * k, 4)))
    # hairline: the highest skin row at the centre column band
    hair_z = None
    cxi = int(round(fig.cx))
    # (a parting shows a thin line of scalp: the forehead is where skin spans a good part of the face's width)
    wband = max(3, int((y_chin - y_top) * 0.06))
    band = is_skin[y_top:y_chin, cxi - wband:cxi + wband + 1].mean(1) > 0.6
    ys = np.where(band)[0]
    if len(ys):
        hair_z = round(fig.z(y_top + ys[0]), 4)
    # eyes: dark pixels in the face's upper half, left and right of the centre, inside the skin's extent
    face = np.zeros_like(fig.m)
    hh = y_chin - y_top
    ya, yb = y_top + int(hh * 0.35), y_top + int(hh * 0.78)
    face[ya:yb] = True
    lum = rgb @ np.array([0.299, 0.587, 0.114])
    skin_l = float(skin @ np.array([0.299, 0.587, 0.114]))
    dark = face & fig.m & (lum < skin_l * 0.62)
    # inside the face: between the skin's leftmost and rightmost at that row
    for y in range(ya, yb):
        xs = np.where(is_skin[y])[0]
        if len(xs) < 4:
            dark[y] = False
            continue
        dark[y, :xs.min() + 1] = False
        dark[y, xs.max():] = False
    eyes = []
    lab, n = label(dark)
    if n:
        sizes = np.bincount(lab.ravel())
        cand = []
        for i in range(1, n + 1):
            if sizes[i] < max(4, hh * hh * 0.002):
                continue
            yy, xx = np.where(lab == i)
            cand.append((sizes[i], float(xx.mean()), float(yy.mean()), i))
        for sgn in (-1, 1):
            side = [c for c in cand if (c[1] - fig.cx) * sgn > hh * 0.04]
            if side:
                c = max(side, key=lambda c: c[0])
                sel = lab == c[3]
                px = rgb[sel]
                pl = px @ np.array([0.299, 0.587, 0.114])
                # the iris: the eye's pixels brighter than its darkest quarter (pupil and lash line out), not white
                keep = (pl > np.percentile(pl, 35)) & (pl < 0.75)
                iris = np.median(px[keep], 0) if keep.sum() > 2 else np.median(px, 0)
                eyes.append({'side': 'R' if sgn < 0 else 'L', 'x': round((c[1] - fig.cx) * k, 4), 'z': round(fig.z(c[2]), 4),
                             'px': int(c[0]), 'iris': [round(float(x), 3) for x in iris],
                             'dark': [round(float(x), 3) for x in np.percentile(px, 10, axis=0)]})
    # the mouth: the lowest dark or red-ish blob near the centre below the eyes
    mouth_z = None
    yb2 = y_top + int(hh * 0.95)
    eye_y = max([fig.row(e['z']) for e in eyes], default=ya)
    col_reg = rgb[eye_y + int(hh * 0.12):yb2, cxi - int(hh * 0.12):cxi + int(hh * 0.12) + 1]
    if col_reg.size:
        cl = col_reg @ np.array([0.299, 0.587, 0.114])
        redish = (col_reg[..., 0] - col_reg[..., 2] > 0.18) & (cl < skin_l * 0.85)
        darkm = cl < skin_l * 0.7
        mm = redish | darkm
        rows_hit = np.where(mm.sum(1) >= 2)[0]
        if len(rows_hit):
            mouth_z = round(fig.z(eye_y + int(hh * 0.12) + int(np.median(rows_hit[-max(1, len(rows_hit) // 3):]))), 4)
    return {'profile': prof, 'hairline_z': hair_z, 'eyes': eyes, 'mouth_z': mouth_z, 'skin': [round(float(x), 3) for x in skin],
            'head_px': int(hh)}


def colour_regions(a_rgb, a_mask, b_rgb, b_mask, rows=12, cols=4):
    """Both figures cropped to their bounds and divided into a grid; per cell the median colour of the figure's
    pixels, compared (CIE76 delta E). Returns (cells, mean, worst)."""
    from_lab = _lab

    def grid(rgb, m):
        ys, xs = np.where(m)
        if not len(ys):
            return None
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        out = np.full((rows, cols, 3), np.nan)
        for r in range(rows):
            for c in range(cols):
                ya, yb = y0 + (y1 - y0) * r // rows, y0 + (y1 - y0) * (r + 1) // rows
                xa, xb = x0 + (x1 - x0) * c // cols, x0 + (x1 - x0) * (c + 1) // cols
                sel = m[ya:yb, xa:xb]
                if sel.sum() > max(6, sel.size * 0.25):
                    out[r, c] = np.median(rgb[ya:yb, xa:xb][sel], 0)
        return out

    ga, gb = grid(a_rgb, a_mask), grid(b_rgb, b_mask)
    if ga is None or gb is None:
        return [], None, None
    cells = []
    for r in range(rows):
        for c in range(cols):
            if np.isnan(ga[r, c]).any() or np.isnan(gb[r, c]).any():
                continue
            e = float(np.linalg.norm(from_lab(ga[r, c]) - from_lab(gb[r, c])))
            cells.append({'row': r, 'col': c, 'ours': _hex(ga[r, c]), 'sheet': _hex(gb[r, c]), 'delta_e': round(e, 1)})
    if not cells:
        return [], None, None
    es = [c['delta_e'] for c in cells]
    return cells, round(float(np.mean(es)), 1), max(cells, key=lambda c: c['delta_e'])


def _hex(c):
    return '#%02x%02x%02x' % tuple(int(round(max(0, min(1, x)) * 255)) for x in c)


def _lab(c):
    c = np.asarray(c, float)
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = M @ lin / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.array([116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])])
