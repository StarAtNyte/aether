"""Town: houses on the four terraces (walls, tiled roofs, windows, doors, balconies), a small shop by the crossing and
the shrine hall. Every house records its footprint so the props can lean on walls and avoid doors."""
import math

import bmesh

from common import P, add_box, bm_object, rng, toon_material
from land import terrace_ranges

WALLS = [P["wall"], P["wall2"], P["wall3"], P["wall4"]]
ROOFS = [P["roof_slate"], P["roof_slate"], P["roof_brick"], P["roof_teal"], P["roof_grey"]]
HOUSES = []  # dicts: x, y, w, d, z, h, storeys, front (y of the lane-side wall), roof


def _mats():
    walls = [toon_material(f"wall{i}", c, var=c, noise_scale=0.5) for i, c in enumerate(WALLS)]
    roofs = [toon_material(f"roof{i}", c, var="#4a5878" if i < 2 else c, noise_scale=0.3, stripes=("z", 0.32, "#262c40", 0.16)) for i, c in enumerate(ROOFS)]
    trim = toon_material("trim_wood", P["wood_dark"])
    glass = toon_material("window_glass", "#3b4f7a", var="#4f6a96", noise_scale=3)
    lit = toon_material("window_lit", P["window_lit"], emission=P["window_lit"], emission_strength=2.2)
    ridge = toon_material("roof_ridge", "#2b3044")
    door = toon_material("door_wood", P["wood"], stripes=("z", 0.25, "#6e4630", 0.12))
    base = toon_material("house_base", "#9d978c")
    return walls, roofs, trim, glass, lit, ridge, door, base


def _house(name, x, y, w, d, z, storeys, seed, lit_frac=0.25, front=-1, roof_kind="gable"):
    walls, roofs, trim, glass, lit, ridge, door, base = _mats()
    r = rng(seed)
    wall_m = r.choice(walls)
    roof_m = r.choice(roofs)
    mats = [wall_m, roof_m, trim, glass, lit, ridge, door, base]
    MI = {m.name: i for i, m in enumerate(mats)}
    h = 2.9 * storeys + 0.3
    bm = bmesh.new()
    # Plinth and walls.
    add_box(bm, (x, y, z + 0.15), (w + 0.1, d + 0.1, 0.3), mat_index=7)
    add_box(bm, (x, y, z + 0.3 + (h - 0.3) / 2), (w, d, h - 0.3), mat_index=0)
    # A storey band.
    if storeys > 1:
        add_box(bm, (x, y, z + 3.05), (w + 0.12, d + 0.12, 0.14), mat_index=2)
    # Roof: gable with the ridge along x (eaves over the lane and the back), or hipped (four slopes).
    ov = 0.55
    pitch = math.radians(r.uniform(24, 30))
    rh = (d / 2 + ov) * math.tan(pitch)
    top = z + h
    x0, x1 = x - w / 2 - ov, x + w / 2 + ov
    y0, y1 = y - d / 2 - ov, y + d / 2 + ov
    th = 0.16
    if roof_kind == "gable":
        for (ya, yb) in ((y0, y), (y1, y)):
            vs = [bm.verts.new(v) for v in ((x0, ya, top - 0.1), (x1, ya, top - 0.1), (x1, yb, top + rh), (x0, yb, top + rh),
                                            (x0, ya, top - 0.1 + th), (x1, ya, top - 0.1 + th), (x1, yb, top + rh + th), (x0, yb, top + rh + th))]
            for f in ((0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (3, 2, 6, 7), (0, 3, 7, 4)):
                fc = bm.faces.new([vs[i] for i in f])
                fc.material_index = 1
        # Gable walls (triangles) at both ends.
        for xe in (x - w / 2, x + w / 2):
            vs = [bm.verts.new(v) for v in ((xe, y - d / 2, top), (xe, y + d / 2, top), (xe, y, top + (d / 2) * math.tan(pitch)))]
            fc = bm.faces.new(vs if xe > x else list(reversed(vs)))
            fc.material_index = 0
        add_box(bm, (x, y, top + rh + th + 0.08), (w + 2 * ov + 0.1, 0.34, 0.2), mat_index=5)
    else:
        rx = max(0.6, w / 2 - d / 2)
        ring = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
        bot = [bm.verts.new((px, py, top - 0.1)) for (px, py) in ring]
        ra = bm.verts.new((x - rx, y, top + rh))
        rb = bm.verts.new((x + rx, y, top + rh))
        for f in ((bot[0], bot[1], rb, ra), (bot[2], bot[3], ra, rb), (bot[1], bot[2], rb), (bot[3], bot[0], ra)):
            fc = bm.faces.new(f)
            fc.material_index = 1
        fc = bm.faces.new(list(reversed(bot)))
        fc.material_index = 1
        add_box(bm, (x, y, top + rh + 0.06), (2 * rx + 0.3, 0.3, 0.16), mat_index=5)
    # Windows on all four sides, some lit.
    wins = []
    for s in range(storeys):
        zc = z + 0.3 + 1.55 + 2.9 * s
        nx = max(1, int((w - 1.2) / 2.2))
        for k in range(nx):
            wx = x - w / 2 + (k + 0.5) * w / nx
            for side in (-1, 1):
                wins.append((wx, y + side * (d / 2 + 0.02), zc, 1.1, 0.06, 1.2))
        ny = max(1, int((d - 1.2) / 2.6))
        for k in range(ny):
            wy = y - d / 2 + (k + 0.5) * d / ny
            for side in (-1, 1):
                wins.append((x + side * (w / 2 + 0.02), wy, zc, 0.06, 1.0, 1.2))
    for (wx, wy, wz, sx, sy, sz) in wins:
        lit_it = r.random() < lit_frac
        add_box(bm, (wx, wy, wz), (sx + 0.16 if sx > 0.5 else 0.1, sy + 0.16 if sy > 0.5 else 0.1, sz + 0.16), mat_index=2)
        add_box(bm, (wx + (0.03 if sx < 0.5 and wx > x else -0.03 if sx < 0.5 else 0), wy + (0.03 if sy < 0.5 and wy > y else -0.03 if sy < 0.5 else 0), wz), (sx, sy, sz), mat_index=4 if lit_it else 3)
    # Door on the lane side.
    dx = x + r.uniform(-w / 4, w / 4)
    dy = y + front * (d / 2 + 0.03)
    add_box(bm, (dx, dy, z + 0.3 + 1.0), (1.0, 0.08, 2.0), mat_index=6)
    add_box(bm, (dx, dy + front * 0.35, z + 2.55), (1.6, 0.8, 0.08), mat_index=2)  # door canopy
    ob = bm_object(name, bm, "town", mats=mats, outline=True)
    HOUSES.append({"name": name, "x": x, "y": y, "w": w, "d": d, "z": z, "h": h, "storeys": storeys, "front": front, "door_x": dx, "roof_top": top + rh})
    return ob


def build():
    r = rng(42)
    tr = terrace_ranges()
    n = 0
    for ti, (y_from, y_to, z) in enumerate(tr[1:5]):
        lane_end = y_from + (6.5 if ti == 0 else 4.0)
        depth_room = (y_to - 0.8) - lane_end
        x = -88.0 + r.uniform(0, 3)
        while x < 88:
            w = r.uniform(5.5, 8.5)
            if abs(x + w / 2) < 6.0 or (abs(x) < 6.0) or (x < 6.0 < x + w):
                x = 6.5
                continue
            # The shrine grounds on the third terrace, east of the stair; the shop by the crossing on the first.
            if ti == 2 and 5 < x + w and x < 22:
                x = 22.5
                continue
            if ti == 0 and -16 < x + w and x < -6:
                x = -5.9
                continue
            d = min(depth_room, r.uniform(6.0, 9.0))
            if d < 5.0:
                break
            yc = lane_end + 0.6 + d / 2
            storeys = 2 if r.random() < 0.55 else 1
            kind = "gable" if r.random() < 0.7 else "hip"
            _house(f"house_{ti}_{n}", x + w / 2, yc, w, d, z, storeys, seed=1000 + n, front=-1, roof_kind=kind)
            n += 1
            x += w + r.uniform(1.4, 4.0)
    _shop()
    return n


def _shop():
    """A small corner shop by the crossing (first terrace, west of the stair): an awning, a sign, a lit front."""
    tr = terrace_ranges()
    y_from, y_to, z = tr[1]
    x, w, d = -11.0, 8.0, 7.0
    yc = y_from + 6.5 + 0.6 + d / 2
    ob = _house("shop", x, yc, w, d, z, 2, seed=77, lit_frac=0.6, front=-1)
    HOUSES[-1]["shop"] = True
    return ob
