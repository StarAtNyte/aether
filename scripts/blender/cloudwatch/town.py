"""Town: houses on the four terraces, a small shop by the crossing. Each house is a few blocks (L-shapes, stepped upper
storeys, flat-roofed concrete blocks with parapets, tall narrow houses) under gabled, hipped, hip-and-gable, shed, or
corrugated roofs with fascia boards, verge boards, ridge caps, gutters and downpipes; walls carry framed windows with
sills, shutter boxes, grilles, hoods and blinds, pent roofs between storeys, balconies with railings, external steel
stairs, entrance canopies and dark crease strips under the eaves. Roof gear (antennas, water tanks on stands, solar
water heaters) goes into one thin-lined prop object, `roof_gear`.

Every house records its footprint (the bounds of its blocks) so the props can lean on walls and avoid doors, plus the
spots the prop pass dresses: balconies (laundry, plants, outdoor units), window sills (plants) and wall spots for
air-conditioner units."""
import math

import bmesh

from common import P, add_box, add_cylinder, bm_object, cove_z, rng, toon_material
from land import terrace_ranges

HOUSES = []  # dicts: name, x, y, w, d, z, h, storeys, front, door_x, roof_top, shop?, kind, balconies, sills, ac_spots, gap_w, gap_e

PLASTER = ["#f1e2c8", "#e8d6bd", "#d9dccf", "#efcfb8", "#dfe1de", "#e6dcc0", "#d6cdbb", "#ead8c8", "#cfd6d8", "#e3e0cf",
           "#cfe0d2", "#dde5ee", "#f2e2ad", "#e8c4b2", "#c9d3c0", "#f0d9c0"]
TILES = {"slate": ("#3d4b6b", "#4a5878"), "ibushi": ("#4a4d5c", "#565a6a"), "brick": ("#7a3f36", "#86493d"),
         "teal": ("#2f5d5a", "#386864"), "grey": ("#55566a", "#61627a"), "navy": ("#33456a", "#3e5178")}
CORR = {"rust": "#8d5a46", "blue": "#58779a", "green": "#5d7a5c", "silver": "#9a9ca6"}

MATS = []
IDX = {}


def _add_stripe(m, axis, period, col, width):
    """Mix a second stripe set (object coordinates) into a toon material's painted albedo, before the ALBEDO node."""
    from common import srgb
    if m.get("cw_stripe2"):
        return m
    nt = m.node_tree
    alb = nt.nodes["ALBEDO"]
    src = alb.inputs[0].links[0].from_socket
    coord = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(coord.outputs["Object"], sep.inputs[0])
    div = nt.nodes.new("ShaderNodeMath")
    div.operation = "DIVIDE"
    div.inputs[1].default_value = period
    nt.links.new(sep.outputs[{"x": 0, "y": 1, "z": 2}[axis]], div.inputs[0])
    fr = nt.nodes.new("ShaderNodeMath")
    fr.operation = "FRACT"
    nt.links.new(div.outputs[0], fr.inputs[0])
    lt = nt.nodes.new("ShaderNodeMath")
    lt.operation = "LESS_THAN"
    lt.inputs[1].default_value = width
    nt.links.new(fr.outputs[0], lt.inputs[0])
    rgb = nt.nodes.new("ShaderNodeRGB")
    rgb.outputs[0].default_value = srgb(col)
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    nt.links.new(lt.outputs[0], mix.inputs["Factor"])
    nt.links.new(src, mix.inputs[6])
    nt.links.new(rgb.outputs[0], mix.inputs[7])
    nt.links.new(mix.outputs[2], alb.inputs[0])
    m["cw_stripe2"] = 1
    return m


def _darker(hexstr, f):
    h = hexstr.lstrip("#")
    return "#" + "".join(f"{max(0, min(255, int(int(h[i:i + 2], 16) * f))):02x}" for i in (0, 2, 4))


def _reg(m):
    if m.name not in IDX:
        IDX[m.name] = len(MATS)
        MATS.append(m)
    return IDX[m.name]


def _init_mats():
    if MATS:
        return
    for i, c in enumerate(PLASTER):
        _reg(toon_material(f"wall{i}", c, var=_darker(c, 0.94), noise_scale=0.5))
    _reg(toon_material("clap_dark", "#5e4434", stripes=("z", 0.21, "#43302a", 0.16)))
    _reg(toon_material("clap_wood", "#8a6448", stripes=("z", 0.21, "#6b4a36", 0.14)))
    _reg(toon_material("siding_blue", "#9db3c2", stripes=("z", 0.11, "#829aab", 0.4)))
    _reg(toon_material("siding_cream", "#e2d6b4", stripes=("z", 0.11, "#c9bc9a", 0.4)))
    _reg(toon_material("concrete0", "#c4bfb6", var="#aaa49b", noise_scale=0.7, stripes=("z", 0.9, "#b0aaa1", 0.03)))
    _reg(toon_material("concrete1", "#d3cdc0", var="#b9b2a5", noise_scale=0.7, stripes=("z", 0.9, "#bdb6a9", 0.03)))
    for k, (c, v) in TILES.items():
        dark = _darker(c, 0.62)
        for ax in ("x", "y"):
            m = toon_material(f"tile_{k}_{ax}", c, var=v, noise_scale=0.25, stripes=("z", 0.2, _darker(c, 0.8), 0.22))
            _add_stripe(m, ax, 0.42, dark, 0.2)
            _reg(m)
    for k, c in CORR.items():
        for ax in ("x", "y"):
            _reg(toon_material(f"corr_{k}_{ax}", c, var=_darker(c, 0.9), noise_scale=0.4, stripes=(ax, 0.2, _darker(c, 0.7), 0.35)))
    _reg(toon_material("flat_deck", "#a6a29b", var="#959189", noise_scale=0.6, stripes=("x", 1.2, "#8d8981", 0.03)))
    _reg(toon_material("trim_wood", P["wood_dark"]))
    _reg(toon_material("trim_white", "#ece6da"))
    _reg(toon_material("trim_alu", "#b4b6bd"))
    _reg(toon_material("trim_dark", "#3d3a44"))
    _reg(toon_material("window_glass", "#3b4f7a", var="#4f6a96", noise_scale=3))
    _reg(toon_material("window_lit", P["window_lit"], emission=P["window_lit"], emission_strength=2.2))
    _reg(toon_material("door_wood", P["wood"], stripes=("z", 0.25, "#6e4630", 0.12)))
    _reg(toon_material("door_alu", "#9aa0aa", stripes=("x", 0.45, "#6b707c", 0.08)))
    _reg(toon_material("house_base", "#9d978c"))
    _reg(toon_material("roof_ridge", "#2b3044"))
    _reg(toon_material("crease", "#3a3046"))
    _reg(toon_material("metal_grey", "#7d808a"))
    _reg(toon_material("gutter", "#8b8d96"))
    _reg(toon_material("rail_white", "#e2ded6"))
    _reg(toon_material("panel_frost", "#c9ced6", var="#b8bfca", noise_scale=1.5))
    _reg(toon_material("shutter_metal", "#b7b8be", stripes=("z", 0.09, "#8f9099", 0.3)))
    _reg(toon_material("awning", "#c8483c", stripes=("x", 0.6, "#f1ead9", 0.5)))
    _reg(toon_material("blind_tan", "#c9ad7a", stripes=("z", 0.06, "#a88c5e", 0.3)))
    _reg(toon_material("noren", "#2f4d7a"))
    for ax in ("x", "y"):
        _reg(toon_material(f"bars_{ax}", "#dcd8cf", stripes=(ax, 0.13, "#5a5568", 0.55)))
        _reg(toon_material(f"grille_{ax}", "#4a4650", stripes=(ax, 0.12, "#40557f", 0.62)))


def M(name):
    return IDX[name]


# ---------------------------------------------------------------------------------------------------------------- helpers

def prism(bm, poly, off, mi):
    """A closed prism: the planar polygon `poly` extruded by the vector `off`."""
    a = [bm.verts.new(p) for p in poly]
    b = [bm.verts.new((p[0] + off[0], p[1] + off[1], p[2] + off[2])) for p in poly]
    n = len(poly)
    fs = [bm.faces.new(list(reversed(a))), bm.faces.new(b)]
    for i in range(n):
        j = (i + 1) % n
        fs.append(bm.faces.new((a[i], a[j], b[j], b[i])))
    for f in fs:
        f.material_index = mi
    return fs


def beam(bm, a, b, r, mi, seg=4):
    d = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
    ln = math.sqrt(d[0] ** 2 + d[1] ** 2 + d[2] ** 2)
    add_cylinder(bm, a, r, ln, segments=seg, mat_index=mi, axis=d)


class Face:
    """One wall face of a block: outward normal (nx, ny), plane coordinate, the range along it (u) and its height."""

    def __init__(self, n, p, u0, u1, z0, z1):
        self.n, self.p, self.u0, self.u1, self.z0, self.z1 = n, p, u0, u1, z0, z1

    @property
    def length(self):
        return self.u1 - self.u0

    def pt(self, u, z, off=0.0):
        nx, ny = self.n
        if ny:
            return (u, self.p + ny * off, z)
        return (self.p + nx * off, u, z)

    def box(self, bm, u, z, su, sn, sz, off, mi, bottom=True):
        """A box on this face: su along it, sn out of it (its centre `off` out of the wall plane), sz high.
        bottom=False leaves out the underside too (small wall trim nobody sees from below)."""
        size = (su, sn, sz) if self.n[1] else (sn, su, sz)
        fs = add_box(bm, self.pt(u, z, off), size, mat_index=mi)
        if off - sn / 2 < 0.02:
            # The face against the wall is never seen: leave it out.
            bm.faces.remove(fs[{(0, -1): 4, (0, 1): 2, (-1, 0): 3, (1, 0): 5}[self.n]])
        if not bottom:
            bm.faces.remove(fs[0])
        return fs


def block_faces(b):
    return {
        "s": Face((0, -1), b["y0"], b["x0"], b["x1"], b["z0"], b["z1"]),
        "n": Face((0, 1), b["y1"], b["x0"], b["x1"], b["z0"], b["z1"]),
        "w": Face((-1, 0), b["x0"], b["y0"], b["y1"], b["z0"], b["z1"]),
        "e": Face((1, 0), b["x1"], b["y0"], b["y1"], b["z0"], b["z1"]),
    }


def _inside_other(blocks, me, x, y, z, pad=0.05):
    for b in blocks:
        if b is me:
            continue
        if b["x0"] - pad < x < b["x1"] + pad and b["y0"] - pad < y < b["y1"] + pad and b["z0"] - 0.1 < z < b["z1"] + 2.5:
            return True
    return False


def _clear(blocks, me, face, u, z, half, reserved):
    for uu in (u - half, u, u + half):
        x, y, _ = face.pt(uu, z, 0.45)
        if _inside_other(blocks, me, x, y, z):
            return False
        for (rx0, rx1, ry0, ry1, rz0, rz1) in reserved:
            if rx0 < x < rx1 and ry0 < y < ry1 and rz0 < z < rz1:
                return False
    return True


# ---------------------------------------------------------------------------------------------------------------- roofs

TILE_COURSE = 0.3   # m up the slope per course of tiles
TILE_LIP = 0.038    # m: the butt of each course standing off the one below


def mat_is_corr(mi):
    return MATS[mi].name.startswith("corr_")


def tile_courses(bm, P3, e0, e1, a, c, z_eave, z_ridge, mi):
    """Courses of tiles on one slope (from the eave line `a` at z_eave up to the ridge line `c` at z_ridge): each a wedge
    whose butt stands TILE_LIP off the slope, so the rows catch the low sun and throw a thin shadow line on the course
    below. Their vertices go into the `cw_noline` layer: no outline shell along every course."""
    nl = bm.verts.layers.float.get("cw_noline") or bm.verts.layers.float.new("cw_noline")
    dx, dz = c - a, z_ridge - z_eave
    Ls = math.hypot(dx, dz)
    ux, uz = dx / Ls, dz / Ls          # up the slope
    nx, nz = (-uz, ux) if ux > 0 else (uz, -ux)  # out of the slope (upward)
    n = int((Ls - 0.35) / TILE_COURSE)
    for k in range(n):
        t0, t1 = 0.04 + k * TILE_COURSE, 0.04 + (k + 1) * TILE_COURSE
        lo = (a + ux * t0, z_eave + uz * t0)
        hi = (lo[0] + nx * TILE_LIP, lo[1] + nz * TILE_LIP)
        up = (a + ux * t1, z_eave + uz * t1)
        # Sunk 6 mm into the slab, so no face lies in the slab's top plane (no z-fighting in a double-sided draw).
        sec = [(p[0] - nx * 0.006, p[1] - nz * 0.006) for p in (lo, hi, up)]
        A = [bm.verts.new(P3(e0 + 0.03, p[0], p[1])) for p in sec]
        B = [bm.verts.new(P3(e1 - 0.03, p[0], p[1])) for p in sec]
        faces = [(A[0], B[0], B[1], A[1]), (A[1], B[1], B[2], A[2]), (A[2], B[2], B[0], A[0]), (A[0], A[1], A[2]), (B[2], B[1], B[0])]
        for fv in faces:
            f = bm.faces.new(fv)
            f.material_index = mi
        for v in A + B:
            v[nl] = 1.0


def roof_gable(bm, gear, b, axis, mat, r, trim, gutters=True):
    """Gable roof over block b with its ridge along `axis` ('x' or 'y'). Returns (ridge_top_z, info)."""
    x0, x1, y0, y1, top = b["x0"], b["x1"], b["y0"], b["y1"], b["z1"]
    pitch = math.radians(r.uniform(24, 31))
    tp = math.tan(pitch)
    ov, ovg, th = 0.6, 0.45, 0.24
    if axis == "x":
        c, half = (y0 + y1) / 2, (y1 - y0) / 2
        e0, e1 = x0 - ovg, x1 + ovg
    else:
        c, half = (x0 + x1) / 2, (x1 - x0) / 2
        e0, e1 = y0 - ovg, y1 + ovg
    zr = top + half * tp
    ze = top - ov * tp

    def P3(along, across, z):
        return (along, across, z) if axis == "x" else (across, along, z)

    for s in (-1, 1):
        a = c + s * (half + ov)
        poly = [P3(e0, a, ze), P3(e1, a, ze), P3(e1, c, zr), P3(e0, c, zr)]
        fs = prism(bm, poly, (0, 0, th), mat)
        # The slab's eave edge, verge ends and underside in the trim colour: fascia and verge boards with thickness.
        for k in (0, 2, 3, 5):
            fs[k].material_index = trim
        L = e1 - e0
        mid = (e0 + e1) / 2
        if not mat_is_corr(mat):
            tile_courses(bm, P3, e0, e1, a, c, ze + th, zr + th, mat)
        if gutters:
            gs = (L - 0.1, 0.13, 0.11) if axis == "x" else (0.13, L - 0.1, 0.11)
            add_box(bm, P3(mid, a + s * 0.065, ze - 0.03), gs, mat_index=M("gutter"))
    # Gable walls (closed triangles flush with the end walls).
    for se, xe in ((-1, x0 if axis == "x" else y0), (1, x1 if axis == "x" else y1)):
        poly = [P3(xe, c - half, top), P3(xe, c + half, top), P3(xe, c, zr)]
        off = (-se * 0.12, 0, 0) if axis == "x" else (0, -se * 0.12, 0)
        prism(bm, poly, off, b["wall"])
    # Ridge cap with end blocks.
    L = e1 - e0 + 0.1
    rz = zr + th + 0.08
    add_box(bm, P3((e0 + e1) / 2, c, rz), (L, 0.32, 0.22) if axis == "x" else (0.32, L, 0.22), mat_index=M("roof_ridge"))
    info = {"axis": axis, "c": c, "half": half, "ov": ov, "ze": ze, "zr": zr, "th": th, "tp": tp, "e0": e0, "e1": e1,
            "ridge_z": rz + 0.11}
    return zr + th + 0.19, info


def roof_hip(bm, gear, b, mat, r, trim, irimoya=False):
    """Hipped (or hip-and-gable) roof with the ridge along the block's longer side. Closed solid with a fascia skirt."""
    x0, x1, y0, y1, top = b["x0"], b["x1"], b["y0"], b["y1"], b["z1"]
    pitch = math.radians(r.uniform(24, 30))
    tp = math.tan(pitch)
    ov, th = 0.6, 0.2
    along_x = (x1 - x0) >= (y1 - y0)
    if along_x:
        A0, A1, C0, C1 = x0 - ov, x1 + ov, y0 - ov, y1 + ov
    else:
        A0, A1, C0, C1 = y0 - ov, y1 + ov, x0 - ov, x1 + ov
    c = (C0 + C1) / 2
    hw = (C1 - C0) / 2
    rh = hw * tp
    ze = top - ov * tp
    zr = ze + rh
    ra0 = min((A0 + A1) / 2 - 0.3, A0 + hw)
    ra1 = max((A0 + A1) / 2 + 0.3, A1 - hw)

    def P3(al, ac, z):
        return (al, ac, z) if along_x else (ac, al, z)

    v = bm.verts.new
    T = [v(P3(A0, C0, ze + th)), v(P3(A1, C0, ze + th)), v(P3(A1, C1, ze + th)), v(P3(A0, C1, ze + th))]
    B = [v(P3(A0, C0, ze)), v(P3(A1, C0, ze)), v(P3(A1, C1, ze)), v(P3(A0, C1, ze))]
    faces = []
    if not irimoya:
        Ra, Rb = v(P3(ra0, c, zr + th)), v(P3(ra1, c, zr + th))
        faces += [(T[0], T[1], Rb, Ra, mat), (T[2], T[3], Ra, Rb, mat), (T[1], T[2], Rb, mat), (T[3], T[0], Ra, mat)]
    else:
        f = 0.5
        xb0, xb1 = A0 + f * (ra0 - A0), A1 + f * (ra1 - A1)
        cs, cn, zb = C0 + f * (c - C0), C1 + f * (c - C1), ze + f * rh + th
        Bs0, Bn0, Bs1, Bn1 = v(P3(xb0, cs, zb)), v(P3(xb0, cn, zb)), v(P3(xb1, cs, zb)), v(P3(xb1, cn, zb))
        R0, R1 = v(P3(xb0, c, zr + th)), v(P3(xb1, c, zr + th))
        faces += [(T[0], T[1], Bs1, R1, R0, Bs0, mat), (T[2], T[3], Bn0, R0, R1, Bn1, mat),
                  (T[3], T[0], Bs0, Bn0, mat), (T[1], T[2], Bn1, Bs1, mat),
                  (Bs0, R0, Bn0, M("trim_wood")), (Bn1, R1, Bs1, M("trim_wood"))]
    for i in range(4):
        j = (i + 1) % 4
        faces.append((B[i], B[j], T[j], T[i], trim))
    faces.append((B[3], B[2], B[1], B[0], mat))
    for fv in faces:
        fc = bm.faces.new(fv[:-1])
        fc.material_index = fv[-1]
    # Gutters on the two long eaves.
    L = A1 - A0
    for s, cc in ((-1, C0), (1, C1)):
        gs = (L - 0.2, 0.13, 0.11) if along_x else (0.13, L - 0.2, 0.11)
        add_box(bm, P3((A0 + A1) / 2, cc + s * 0.07, ze - 0.03), gs, mat_index=M("gutter"))
    rl = (ra1 - ra0) if not irimoya else (A1 - A0) * 0.5 + (ra1 - ra0) * 0.5
    rz = zr + th + 0.07
    add_box(bm, P3((ra0 + ra1) / 2, c, rz), (rl + 0.3, 0.3, 0.18) if along_x else (0.3, rl + 0.3, 0.18), mat_index=M("roof_ridge"))
    info = {"axis": "x" if along_x else "y", "c": c, "half": hw - ov, "ov": ov, "ze": ze, "zr": zr, "th": th, "tp": tp,
            "e0": A0, "e1": A1, "r0": ra0, "r1": ra1, "ridge_z": rz + 0.09, "hip": True}
    return zr + th + 0.16, info


def roof_shed(bm, b, mat, high, trim, ov=0.45, pitch_deg=12.0, walls=True):
    """Single-slope roof over block b, high along side `high` ('n','s','e','w'); fills the end walls up to it."""
    x0, x1, y0, y1, top = b["x0"], b["x1"], b["y0"], b["y1"], b["z1"]
    tp = math.tan(math.radians(pitch_deg))
    th = 0.14
    if high in ("n", "s"):
        span = y1 - y0
        lo_y = y0 - ov if high == "n" else y1 + ov
        hi_y = y1 + 0.15 if high == "n" else y0 - 0.15
        zl = top - ov * tp
        zh = top + span * tp
        poly = [(x0 - ov, lo_y, zl), (x1 + ov, lo_y, zl), (x1 + ov, hi_y, zh), (x0 - ov, hi_y, zh)]
        prism(bm, poly, (0, 0, th), mat)
        add_box(bm, ((x0 + x1) / 2, lo_y + (-0.035 if high == "n" else 0.035), zl + th / 2 - 0.04), (x1 - x0 + 2 * ov, 0.07, th + 0.1), mat_index=trim)
        if walls:
            ylo, yhi = (y0, y1) if high == "n" else (y1, y0)
            for xe, s in ((x0, 1), (x1, -1)):
                prism(bm, [(xe, ylo, top), (xe, yhi, top), (xe, yhi, top + span * tp)], (s * 0.12, 0, 0), b["wall"])
    else:
        span = x1 - x0
        lo_x = x0 - ov if high == "e" else x1 + ov
        hi_x = x1 + 0.15 if high == "e" else x0 - 0.15
        zl = top - ov * tp
        zh = top + span * tp
        poly = [(lo_x, y0 - ov, zl), (lo_x, y1 + ov, zl), (hi_x, y1 + ov, zh), (hi_x, y0 - ov, zh)]
        prism(bm, poly, (0, 0, th), mat)
        add_box(bm, (lo_x + (-0.035 if high == "e" else 0.035), (y0 + y1) / 2, zl + th / 2 - 0.04), (0.07, y1 - y0 + 2 * ov, th + 0.1), mat_index=trim)
        if walls:
            xlo, xhi = (x0, x1) if high == "e" else (x1, x0)
            for ye, s in ((y0, 1), (y1, -1)):
                prism(bm, [(xlo, ye, top), (xhi, ye, top), (xhi, ye, top + span * tp)], (0, s * 0.12, 0), b["wall"])
    return top + span * tp + th


def pent_roof(bm, face, z, depth, mat, trim, u0=None, u1=None):
    """A narrow lean-to roof (hisashi) along a wall face at height z, sloping outward."""
    u0 = face.u0 - 0.15 if u0 is None else u0
    u1 = face.u1 + 0.15 if u1 is None else u1
    drop = depth * 0.32
    nx, ny = face.n
    pts = []
    for (u, o, zz) in ((u0, 0.0, z), (u1, 0.0, z), (u1, depth, z - drop), (u0, depth, z - drop)):
        pts.append(face.pt(u, zz, o))
    prism(bm, pts, (0, 0, 0.12), mat)
    face.box(bm, (u0 + u1) / 2, z - drop + 0.03, u1 - u0, 0.06, 0.16, depth + 0.03, trim)
    # The dark line where it meets the wall.
    face.box(bm, (u0 + u1) / 2, z + 0.16, u1 - u0 - 0.1, 0.03, 0.06, 0.015, M("crease"))


def skirt_roofs(bm, lo, up, roof_mat, trim):
    """Lean-to roofs over the parts of a lower block that the (set back) upper block leaves open."""
    top = lo["z1"]
    strips = []
    if lo["y1"] - up["y1"] > 0.3:
        strips.append(((lo["x0"], lo["x1"], up["y1"], lo["y1"]), "s"))
    if up["y0"] - lo["y0"] > 0.3:
        strips.append(((lo["x0"], lo["x1"], lo["y0"], up["y0"]), "n"))
    if up["x0"] - lo["x0"] > 0.3:
        strips.append(((lo["x0"], up["x0"], up["y0"], up["y1"]), "e"))
    if lo["x1"] - up["x1"] > 0.3:
        strips.append(((up["x1"], lo["x1"], up["y0"], up["y1"]), "w"))
    t = top
    for (x0, x1, y0, y1), high in strips:
        sb = {"x0": x0, "x1": x1, "y0": y0, "y1": y1, "z1": top, "wall": lo["wall"]}
        t = max(t, roof_shed(bm, sb, roof_mat("x" if high in ("n", "s") else "y"), high, trim, ov=0.5, pitch_deg=16.0,
                             walls=high in ("n", "s")))
    return t


def rect_of(face, u, half, out0, out1):
    """World xy rectangle of a strip on a face: half-width `half` along it, from `out0` to `out1` out of the wall."""
    xa, ya, _ = face.pt(u - half, 0, out0)
    xb, yb, _ = face.pt(u + half, 0, out1)
    return (min(xa, xb), max(xa, xb), min(ya, yb), max(ya, yb))


def flat_top(bm, b, rail=False):
    """Parapet, coping and a deck on a flat roof. Returns the deck height."""
    x0, x1, y0, y1, top = b["x0"], b["x1"], b["y0"], b["y1"], b["z1"]
    t, ph = 0.18, 0.55
    for (cx, cy, sx, sy) in (((x0 + x1) / 2, y0 + t / 2, x1 - x0, t), ((x0 + x1) / 2, y1 - t / 2, x1 - x0, t),
                             (x0 + t / 2, (y0 + y1) / 2, t, y1 - y0 - 2 * t), (x1 - t / 2, (y0 + y1) / 2, t, y1 - y0 - 2 * t)):
        add_box(bm, (cx, cy, top + ph / 2), (sx, sy, ph), mat_index=b["wall"])
        add_box(bm, (cx, cy, top + ph + 0.04), (sx + 0.08 if sx > t else sx + 0.08, sy + 0.08, 0.08), mat_index=M("trim_white"))
    add_box(bm, ((x0 + x1) / 2, (y0 + y1) / 2, top + 0.02), (x1 - x0 - 2 * t, y1 - y0 - 2 * t, 0.04), mat_index=M("flat_deck"))
    # Crease line under the coping.
    for (cx, cy, sx, sy) in (((x0 + x1) / 2, y0 - 0.01, x1 - x0, 0.03), ((x0 + x1) / 2, y1 + 0.01, x1 - x0, 0.03),
                             (x0 - 0.01, (y0 + y1) / 2, 0.03, y1 - y0), (x1 + 0.01, (y0 + y1) / 2, 0.03, y1 - y0)):
        add_box(bm, (cx, cy, top + ph - 0.06), (sx, sy, 0.07), mat_index=M("crease"))
    if rail:
        rz = top + ph + 0.08
        for (ax, ay, bx, by) in ((x0 + 0.1, y0 + 0.1, x1 - 0.1, y0 + 0.1), (x0 + 0.1, y1 - 0.1, x1 - 0.1, y1 - 0.1)):
            beam(gear_bm(), (ax, ay, rz + 0.75), (bx, by, rz + 0.75), 0.025, GEAR["rail"])
            n = max(2, int(abs(bx - ax) / 1.4) + 1)
            for k in range(n):
                px = ax + (bx - ax) * k / (n - 1)
                beam(gear_bm(), (px, ay, rz), (px, ay, rz + 0.75), 0.02, GEAR["rail"])
    return top + 0.04


# ---------------------------------------------------------------------------------------------------------------- roof gear

_GEAR = {"bm": None}
GEAR = {}


def gear_bm():
    if _GEAR["bm"] is None:
        _GEAR["bm"] = bmesh.new()
        mats = [toon_material("gear_metal", "#6f727c"), toon_material("tank_blue", "#4f7fae", var="#5d8cba", noise_scale=2),
                toon_material("tank_white", "#e6e4dc"), toon_material("solar_panel", "#27345a", stripes=("x", 0.25, "#4a5d8a", 0.12)),
                toon_material("rail_white", "#e2ded6"), toon_material("ac_body", "#e8e5dc"), toon_material("ac_fan", "#56545c")]
        _GEAR["mats"] = mats
        GEAR.update({"metal": 0, "tank_blue": 1, "tank_white": 2, "solar": 3, "rail": 4, "ac": 5, "fan": 6})
    return _GEAR["bm"]


def antenna(x, y, z, r):
    bm = gear_bm()
    h = r.uniform(1.8, 2.8)
    add_cylinder(bm, (x, y, z - 0.02), 0.03, h, segments=5, mat_index=GEAR["metal"])
    yaw = r.uniform(-0.5, 0.5) + (0 if r.random() < 0.5 else math.pi / 2)
    c, s = math.cos(yaw), math.sin(yaw)
    zb = z + h - 0.15
    boom = 1.6
    beam(bm, (x - c * 0.2, y - s * 0.2, zb), (x + c * boom, y + s * boom, zb), 0.018, GEAR["metal"])
    for k in range(5):
        t = 0.0 + k * 0.33
        half = 0.55 - k * 0.07
        px, py = x + c * t, y + s * t
        beam(bm, (px + s * half, py - c * half, zb), (px - s * half, py + c * half, zb), 0.012, GEAR["metal"], seg=3)
    if r.random() < 0.5:  # a second, lower array
        z2 = z + h * 0.55
        beam(bm, (x, y, z2), (x - s * 1.0, y + c * 1.0, z2), 0.016, GEAR["metal"])
        for k in range(3):
            px, py = x - s * (0.15 + k * 0.35), y + c * (0.15 + k * 0.35)
            beam(bm, (px - c * 0.35, py - s * 0.35, z2), (px + c * 0.35, py + s * 0.35, z2), 0.011, GEAR["metal"], seg=3)


def water_tank(x, y, z, r, legs=0.9):
    bm = gear_bm()
    rad = r.uniform(0.45, 0.6)
    hh = r.uniform(0.9, 1.3)
    for dx in (-1, 1):
        for dy in (-1, 1):
            add_box(bm, (x + dx * rad * 0.7, y + dy * rad * 0.7, z + legs / 2), (0.08, 0.08, legs), mat_index=GEAR["metal"])
    add_box(bm, (x, y, z + legs + 0.04), (rad * 1.8, rad * 1.8, 0.08), mat_index=GEAR["metal"])
    beam(bm, (x - rad * 0.7, y - rad * 0.7, z + 0.1), (x + rad * 0.7, y + rad * 0.7, z + legs - 0.05), 0.02, GEAR["metal"], seg=3)
    mat = GEAR["tank_blue"] if r.random() < 0.6 else GEAR["tank_white"]
    add_cylinder(bm, (x, y, z + legs + 0.08), rad, hh, segments=10, mat_index=mat)
    add_cylinder(bm, (x, y, z + legs + 0.08 + hh), rad * 0.95, 0.12, segments=10, mat_index=mat, radius_top=rad * 0.35)


def solar_heater(info, s, u, r):
    """A solar water heater on a gable slope (side s = -1 south / +1 north) centred at u along the ridge."""
    bm = gear_bm()
    ax = info["axis"]
    tp = info["tp"]
    p = math.atan(tp)
    a = info["c"] + s * (info["half"] + info["ov"])

    def surf(along, dist_from_ridge):
        acr = info["c"] + s * dist_from_ridge
        z = info["zr"] + info["th"] - dist_from_ridge * tp
        return (along, acr, z) if ax == "x" else (acr, along, z)

    nrm = (0, s * math.sin(p), math.cos(p)) if ax == "x" else (s * math.sin(p), 0, math.cos(p))
    w = 1.0
    d0, d1 = 0.75, 2.15
    lift = 0.04
    poly = []
    for (al, dd) in ((u - w, d1), (u + w, d1), (u + w, d0), (u - w, d0)):
        q = surf(al, dd)
        poly.append((q[0] + nrm[0] * lift, q[1] + nrm[1] * lift, q[2] + nrm[2] * lift))
    prism(bm, poly, (nrm[0] * 0.07, nrm[1] * 0.07, nrm[2] * 0.07), GEAR["solar"])
    q = surf(u - w - 0.05, d0 - 0.25)
    cen = (q[0] + nrm[0] * 0.25, q[1] + nrm[1] * 0.25, q[2] + nrm[2] * 0.25)
    axis = (1, 0, 0) if ax == "x" else (0, 1, 0)
    add_cylinder(bm, cen, 0.22, 2 * w + 0.1, segments=8, mat_index=GEAR["tank_white"], axis=axis)
    # Feet from the tank down to the slope.
    for al in (u - w + 0.2, u + w - 0.2):
        q = surf(al, d0 - 0.25)
        beam(bm, q, (q[0] + nrm[0] * 0.08, q[1] + nrm[1] * 0.08, q[2] + nrm[2] * 0.08), 0.03, GEAR["metal"], seg=4)


def finish_gear():
    if _GEAR["bm"] is None:
        return None
    ob = bm_object("roof_gear", _GEAR["bm"], "props", mats=_GEAR["mats"], outline=True)
    ob["cw_line_w"] = 0.012
    _GEAR["bm"] = None
    return ob


# ---------------------------------------------------------------------------------------------------------------- walls

def window(bm, face, u, zc, ww, wh, style, lit, trim, wall, sill=True):
    ax = "x" if face.n[1] else "y"
    # The glass sits just off the wall; a frame of four bars stands 0.1 m proud of it (the head 0.14 m), so the pane reads
    # as set back in a reveal: the bake's contact occlusion darkens its edges and the low sun draws the bars' shadows.
    fw = 0.08
    face.box(bm, u, zc, ww, 0.02, wh, 0.012, M("window_lit") if lit else M("window_glass"), bottom=False)
    face.box(bm, u, zc + wh / 2 + fw / 2, ww + 2 * fw, 0.14, fw, 0.07, trim)
    face.box(bm, u, zc - wh / 2 - fw / 2, ww + 2 * fw, 0.1, fw, 0.05, trim)
    for s in (-1, 1):
        face.box(bm, u + s * (ww / 2 + fw / 2), zc, fw, 0.1, wh, 0.05, trim, bottom=False)
    if ww > 1.3:
        face.box(bm, u, zc, 0.05, 0.06, wh, 0.05, trim, bottom=False)
    if wh > 0.8 and sill:
        face.box(bm, u, zc - wh / 2 - 0.1, ww + 0.26, 0.15, 0.05, 0.075, trim)
    if style == "shutter":
        side = 1 if (int(u * 7) % 2) else -1
        face.box(bm, u + side * (ww / 2 + 0.33), zc + 0.04, 0.44, 0.14, wh + 0.32, 0.07, wall if wall != trim else M("trim_alu"), bottom=False)
        face.box(bm, u, zc + wh / 2 + 0.12, ww + 0.9, 0.09, 0.06, 0.07, trim, bottom=False)
    elif style == "grille" and not lit:
        face.box(bm, u, zc, ww + 0.06, 0.12, wh + 0.06, 0.11, M(f"grille_{ax}"))
    elif style == "hood":
        face.box(bm, u, zc + wh / 2 + 0.2, ww + 0.45, 0.42, 0.07, 0.21, trim)
        face.box(bm, u, zc + wh / 2 + 0.15, ww + 0.45, 0.02, 0.03, 0.42, M("crease"))
    elif style == "blind":
        face.box(bm, u, zc + wh * 0.18, ww + 0.08, 0.025, wh * 0.66, 0.085, M("blind_tan"))


def door(bm, face, u, z0, trim, r, kind, canopy=True):
    face.box(bm, u, z0 + 1.08, 1.24, 0.06, 2.2, 0.03, trim)
    face.box(bm, u, z0 + 1.02, 1.04, 0.08, 2.04, 0.05, M("door_alu") if kind else M("door_wood"))
    # Entrance canopy: a flat hood on brackets, or a little tiled lean-to.
    c = r.random()
    if not canopy:
        return
    if c < 0.5:
        face.box(bm, u, z0 + 2.45, 1.8, 0.85, 0.09, 0.43, trim)
        face.box(bm, u, z0 + 2.39, 1.8, 0.03, 0.03, 0.86, M("crease"))
        for s in (-0.8, 0.8):
            face.box(bm, u + s, z0 + 2.3, 0.06, 0.5, 0.18, 0.25, trim)
    else:
        f2 = Face(face.n, face.p, u - 1.0, u + 1.0, z0, z0 + 2.6)
        pent_roof(bm, f2, z0 + 2.75, 0.9, CUR["roof"], trim, u - 1.0, u + 1.0)


CUR = {}


def house(name, lot, z, seed, kind=None, lit_frac=0.25, shop=False, reserved_side=None, extra=None):
    """Build one house on the lot (x0, x1, y0, y1): its blocks, roofs, walls and dressing. Returns the HOUSES record."""
    _init_mats()
    r = rng(seed)
    X0, X1, Y0, Y1 = lot
    W, D = X1 - X0, Y1 - Y0
    if kind is None:
        kind = r.choices(["simple", "L", "stepped", "flat", "narrow"], weights=[2.2, 2.0, 2.8, 1.5, 1.5])[0]
        if kind == "narrow" and W > 6.8:
            kind = "simple"
    plaster = [M(f"wall{i}") for i in range(len(PLASTER))]
    wall = r.choice(plaster)
    wall2 = r.choice(plaster + [M("clap_dark"), M("clap_wood"), M("siding_blue"), M("siding_cream")])
    tile = r.choice(["slate", "ibushi", "ibushi", "brick", "brick", "teal", "teal", "grey", "navy"])
    corr = r.choice(list(CORR))
    trim = r.choice([M("trim_wood"), M("trim_white"), M("trim_white"), M("trim_alu"), M("trim_dark")])
    wstyle = r.choice(["plain", "shutter", "shutter", "hood", "blind", "plain"])
    corrugated = r.random() < 0.18 and not shop
    CUR["roof"] = M(f"tile_{tile}_x")

    def roof_mat(axis):
        return M(f"corr_{corr}_{axis}") if corrugated else M(f"tile_{tile}_{axis}")

    blocks = []

    def B(x0, x1, y0, y1, z0, storeys, w=None, roof="gable_x"):
        b = {"x0": x0, "x1": x1, "y0": y0, "y1": y1, "z0": z0, "z1": z0 + 0.3 + 2.9 * storeys, "storeys": storeys,
             "wall": wall if w is None else w, "roof": roof}
        blocks.append(b)
        return b

    st = r.choices([1, 2, 3], weights=[0.27, 0.6, 0.13])[0]
    if kind == "simple":
        B(X0, X1, Y0, Y1, z, st, roof=r.choice(["gable_x", "gable_x", "hip", "irimoya"]))
    elif kind == "narrow":
        B(X0, X1, Y0, Y1, z, 3 if r.random() < 0.6 else 2, roof="gable_y")
    elif kind == "L":
        dm = D * r.uniform(0.52, 0.62)
        B(X0, X1, Y0, Y0 + dm, z, max(st, 2), roof=r.choice(["gable_x", "irimoya", "hip"]))
        ww = W * r.uniform(0.42, 0.55)
        if r.random() < 0.5:
            B(X0, X0 + ww, Y0 + dm, Y1, z, r.choice([1, 2]), roof="gable_y")
        else:
            B(X1 - ww, X1, Y0 + dm, Y1, z, r.choice([1, 2]), roof="gable_y")
    elif kind == "stepped":
        lo = B(X0, X1, Y0, Y1, z, 1, roof="hip")
        sb = r.uniform(1.6, 2.6)
        xi = r.uniform(0, 1.4)
        if r.random() < 0.5:
            up = B(X0 + xi, X1 - (1.4 - xi) * 0.5, Y0, Y1 - sb, lo["z1"] - 0.3, r.choice([1, 1, 2]), roof=r.choice(["gable_x", "hip"]))
        else:
            up = B(X0 + xi, X1 - 0.2, Y0 + sb * 0.5, Y1 - sb * 0.5, lo["z1"] - 0.3, 1, roof=r.choice(["gable_x", "irimoya"]))
        up["z0"] = lo["z1"]
        up["z1"] = up["z0"] + 2.9 * up["storeys"]
        up["upper"] = True
        lo["roof"] = "terrace" if r.random() < 0.4 else "skirt"
        lo["up"] = up
    elif kind == "flat":
        cw = r.choice([M("concrete0"), M("concrete1"), wall])
        st3 = 3 if r.random() < 0.45 else 2
        main = B(X0, X1, Y0, Y1 - (0 if r.random() < 0.6 else 1.6), z, st3, w=cw, roof="flat")
        if main["y1"] < Y1 - 0.5:
            B(X0 + 0.6, X0 + W * 0.55, main["y1"], Y1, z, 1, w=wall2 if wall2 not in plaster else cw, roof="shed_s")
    # Lower storey cladding variety: wood or metal siding under plaster.
    two_tone = r.random() < 0.4 and kind not in ("flat",)
    if shop:
        blocks.clear()
        B(X0, X1, Y0, Y1, z, 2, roof="gable_x")
        two_tone = False

    bm = bmesh.new()
    roof_top = z
    infos = []
    # Walls, plinths, crease strips under the eaves, storey bands.
    for b in blocks:
        x0, x1, y0, y1, z0, z1 = b["x0"], b["x1"], b["y0"], b["y1"], b["z0"], b["z1"]
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        if not b.get("upper"):
            add_box(bm, (cx, cy, z0 + 0.15), (x1 - x0 + 0.1, y1 - y0 + 0.1, 0.3), mat_index=M("house_base"))
            zb = z0 + 0.3
        else:
            zb = z0
        if two_tone and b["storeys"] >= 2 and not b.get("upper"):
            add_box(bm, (cx, cy, (zb + z0 + 3.1) / 2), (x1 - x0, y1 - y0, z0 + 3.1 - zb), mat_index=wall2)
            add_box(bm, (cx, cy, (z0 + 3.1 + z1) / 2), (x1 - x0, y1 - y0, z1 - z0 - 3.1), mat_index=b["wall"])
        elif two_tone and b["storeys"] == 1 and not b.get("upper"):
            add_box(bm, (cx, cy, (zb + z1) / 2), (x1 - x0, y1 - y0, z1 - zb), mat_index=wall2)
        else:
            add_box(bm, (cx, cy, (zb + z1) / 2), (x1 - x0, y1 - y0, z1 - zb), mat_index=b["wall"])
        if b["roof"] not in ("flat", "terrace"):
            for f in block_faces(b).values():
                f.box(bm, (f.u0 + f.u1) / 2, z1 - 0.07, f.length + 0.03, 0.03, 0.13, 0.012, M("crease"), bottom=False)
        for s in range(1, b["storeys"]):
            zz = z0 + 0.3 + 2.9 * s - 0.15 if not b.get("upper") else z0 + 2.9 * s - 0.15
            for f in block_faces(b).values():
                f.box(bm, (f.u0 + f.u1) / 2, zz, f.length + 0.12, 0.06, 0.12, 0.03, trim if b["roof"] != "flat" else M("trim_white"))
    # Roofs.
    for b in blocks:
        kr = b["roof"]
        if kr in ("gable_x", "gable_y"):
            ax = kr[-1]
            t, info = roof_gable(bm, None, b, ax, roof_mat(ax), r, trim)
            infos.append((b, info))
        elif kr in ("hip", "irimoya"):
            along_x = (b["x1"] - b["x0"]) >= (b["y1"] - b["y0"])
            t, info = roof_hip(bm, None, b, roof_mat("x" if along_x else "y"), r, trim, irimoya=(kr == "irimoya"))
            infos.append((b, info))
        elif kr == "flat":
            t = flat_top(bm, b, rail=r.random() < 0.4)
            b["deck"] = t
        elif kr == "terrace":
            t = flat_top(bm, b, rail=False)
            b["deck"] = t
        elif kr.startswith("shed"):
            t = roof_shed(bm, b, M(f"corr_{corr}_x"), kr[-1], trim)
        elif kr == "skirt":
            t = skirt_roofs(bm, b, b["up"], roof_mat, trim)
        roof_top = max(roof_top, t)

    rec = {"name": name, "x": (X0 + X1) / 2, "y": (Y0 + Y1) / 2, "w": W, "d": D, "z": z, "front": -1, "kind": kind,
           "balconies": [], "sills": [], "ac_spots": [], "blocks": [(b["x0"], b["x1"], b["y0"], b["y1"], b["z1"]) for b in blocks]}
    reserved = []
    # External steel stair up a side wall (flat blocks and some two-storey houses).
    main = blocks[0]
    stair = None
    if reserved_side and main["storeys"] >= 2 and (kind == "flat" or r.random() < 0.35) and (main["y1"] - main["y0"]) > 6.2:
        stair = reserved_side
    # Door on the front of the block that faces the lane.
    fronts = [b for b in blocks if abs(b["y0"] - Y0) < 0.01 and not b.get("upper")]
    fb = max(fronts, key=lambda b: b["x1"] - b["x0"])
    fw = fb["x1"] - fb["x0"]
    door_x = (fb["x0"] + fb["x1"]) / 2 + r.uniform(-fw / 4, fw / 4)
    if shop:
        door_x = fb["x0"] + fw * 0.3
    ff = block_faces(fb)["s"]
    door(bm, ff, door_x, z + 0.3, trim, r, kind in ("flat",) or r.random() < 0.4, canopy=not shop)
    reserved.append((door_x - 1.1, door_x + 1.1, Y0 - 1.5, Y0 + 0.5, z, z + 3.1))
    # Balconies: on an upper storey, mostly on the back (the side the lookout sees), some on the front.
    for b in blocks:
        if b["storeys"] < 2 and not b.get("upper"):
            continue
        if b.get("upper") and b["storeys"] < 1:
            continue
        faces = block_faces(b)
        for side in ("n", "s"):
            if r.random() > (0.62 if side == "n" else 0.3):
                continue
            f = faces[side]
            if f.length < 3.0:
                continue
            ln = min(f.length - 0.8, r.uniform(2.4, 4.4))
            u = r.uniform(f.u0 + 0.4 + ln / 2, f.u1 - 0.4 - ln / 2)
            s_idx = 1 if not b.get("upper") else 0
            if b.get("upper"):
                zf = b["z0"] + 0.05 + (2.9 if b["storeys"] > 1 and r.random() < 0.5 else 0)
                if zf < b["z0"] + 1.0:
                    continue  # the upper block's ground floor sits on the lower roof: no balcony there
            else:
                zf = b["z0"] + 0.3 + 2.9 * s_idx + (2.9 if b["storeys"] > 2 and r.random() < 0.5 else 0)
            x, y, _ = f.pt(u, zf, 0.45)
            if _inside_other(blocks, b, x, y, zf + 1.0):
                continue
            dep = 0.95
            solid = b["roof"] == "flat" or r.random() < 0.4
            f.box(bm, u, zf - 0.08, ln, dep, 0.16, dep / 2, M("concrete1") if solid else trim)
            f.box(bm, u, zf - 0.2, ln, 0.03, 0.05, dep - 0.02, M("crease"))
            if solid:
                f.box(bm, u, zf + 0.5, ln, 0.1, 0.84, dep - 0.05, M("panel_frost") if b["roof"] != "flat" else b["wall"])
                for su in (-1, 1):
                    f.box(bm, u + su * (ln / 2 - 0.05), zf + 0.5, 0.1, dep - 0.1, 0.84, dep / 2 - 0.05, M("panel_frost") if b["roof"] != "flat" else b["wall"])
                f.box(bm, u, zf + 0.96, ln + 0.04, 0.12, 0.06, dep - 0.05, M("trim_white"))
            else:
                rail = M("rail_white") if trim != M("trim_white") else M("trim_dark")
                ax = "x" if f.n[1] else "y"
                ax2 = "y" if f.n[1] else "x"
                f.box(bm, u, zf + 0.5, ln - 0.04, 0.03, 0.86, dep - 0.04, M(f"bars_{ax}"))
                f.box(bm, u, zf + 0.97, ln + 0.02, 0.07, 0.07, dep - 0.04, rail)
                for su in (-1, 1):
                    f.box(bm, u + su * (ln / 2 - 0.02), zf + 0.5, 0.03, dep - 0.06, 0.86, dep / 2 - 0.03, M(f"bars_{ax2}"))
                    f.box(bm, u + su * ln / 2, zf + 0.97, 0.07, dep - 0.02, 0.07, dep / 2, rail)
            # A tall sliding door onto it.
            dw = min(ln - 0.6, 1.8)
            f.box(bm, u, zf + 1.0, dw + 0.14, 0.06, 2.0, 0.03, trim)
            f.box(bm, u, zf + 0.98, dw, 0.04, 1.9, 0.05, M("window_lit") if r.random() < lit_frac else M("window_glass"))
            f.box(bm, u, zf + 0.98, 0.05, 0.03, 1.9, 0.075, trim)
            reserved.append((*rect_of(f, u, ln / 2 + 0.3, -0.5, dep + 0.3), zf - 0.5, zf + 2.4))
            nx, ny = f.n
            cxb, cyb, _ = f.pt(u, zf, dep / 2)
            rec["balconies"].append({"x": cxb, "y": cyb, "z": zf, "len": ln, "dep": dep, "nx": nx, "ny": ny, "solid": solid})
            break
    # The external stair (reserved before the windows so none land behind it).
    if stair:
        sd = 1 if stair == "e" else -1
        xw = main["x1"] if sd > 0 else main["x0"]
        xs = xw + sd * 0.5
        zt = main["z0"] + 0.3 + 2.9 - 0.05
        yl0, yl1 = main["y0"] + 0.5, main["y0"] + 1.6
        nst = 11
        rise = (zt - main["z0"]) / nst
        tread = 0.36
        ytop = yl1
        for k in range(nst - 1):
            yy = ytop + (nst - 1 - k) * tread - tread / 2
            add_box(bm, (xs, yy, main["z0"] + (k + 1) * rise - 0.02), (0.8, tread + 0.02, 0.05), mat_index=M("metal_grey"))
        ybot = ytop + (nst - 1) * tread
        for o in (-0.43, 0.43):
            beam(bm, (xs + o, ybot + 0.05, main["z0"]), (xs + o, ytop, zt - 0.05), 0.06, M("metal_grey"))
        o = sd * 0.43
        beam(bm, (xs + o, ybot, main["z0"] + 0.9), (xs + o, ytop, zt + 0.9), 0.025, M("rail_white"))
        for t in (0.0, 0.5, 1.0):
            yy = ybot + (ytop - ybot) * t
            zz = main["z0"] + (zt - main["z0"]) * t
            beam(bm, (xs + o, yy, zz), (xs + o, yy, zz + 0.92), 0.02, M("rail_white"))
        # Landing on a post, with a railing and a door into the side wall.
        add_box(bm, (xs, (yl0 + yl1) / 2, zt - 0.06), (0.95, yl1 - yl0 + 0.02, 0.12), mat_index=M("metal_grey"))
        add_box(bm, (xs + sd * 0.42, yl0 + 0.05, (main["z0"] + zt) / 2), (0.1, 0.1, zt - main["z0"]), mat_index=M("metal_grey"))
        beam(bm, (xs + o, yl0, zt + 0.9), (xs + o, yl1, zt + 0.9), 0.025, M("rail_white"))
        beam(bm, (xs - o, yl0, zt + 0.9), (xs + o, yl0, zt + 0.9), 0.025, M("rail_white"))
        for yy in (yl0, (yl0 + yl1) / 2):
            beam(bm, (xs + o, yy, zt), (xs + o, yy, zt + 0.92), 0.02, M("rail_white"))
        fs = block_faces(main)["e" if sd > 0 else "w"]
        fs.box(bm, (yl0 + yl1) / 2, zt + 1.05, 0.9, 0.08, 2.0, 0.04, M("door_alu"))
        fs.box(bm, (yl0 + yl1) / 2, zt + 2.2, 1.3, 0.6, 0.08, 0.3, trim)
        reserved.append((xw - 1.2 if sd < 0 else xw - 0.2, xw + 1.2 if sd > 0 else xw + 0.2, main["y0"], ybot + 0.3, main["z0"] - 1, zt + 3))
        rec["stair_side"] = stair
    # Pent roofs over the ground floor on some two-storey walls without a balcony.
    for b in blocks:
        if b["storeys"] < 2 or b["roof"] == "flat" or b.get("upper"):
            continue
        for side, f in block_faces(b).items():
            if side == "s" and b is fb:
                continue
            if r.random() > 0.35:
                continue
            zp = b["z0"] + 0.3 + 2.9 - 0.12
            u0, u1 = f.u0 - 0.1, f.u1 + 0.1
            pr = rect_of(f, (u0 + u1) / 2, (u1 - u0) / 2, 0.0, 0.8)
            if any(rz0 < zp + 0.2 and zp - 0.4 < rz1 and pr[0] < rx1 and rx0 < pr[1] and pr[2] < ry1 and ry0 < pr[3]
                   for (rx0, rx1, ry0, ry1, rz0, rz1) in reserved):
                continue
            if any(_inside_other(blocks, b, *f.pt(u, zp, 0.3)) for u in (u0 + 0.3, (u0 + u1) / 2, u1 - 0.3)):
                continue
            pent_roof(bm, f, zp, 0.7, roof_mat("x" if f.n[1] else "y"), trim, u0, u1)
            reserved.append((*rect_of(f, (u0 + u1) / 2, (u1 - u0) / 2, -0.3, 0.9), zp - 0.35, zp + 0.3))
    # Windows on every free wall, storey by storey.
    for bi, b in enumerate(blocks):
        faces = block_faces(b)
        for side, f in faces.items():
            for s in range(b["storeys"]):
                zb = b["z0"] + (0.3 if not b.get("upper") else 0.0) + 2.9 * s
                n = max(1, int((f.length + 0.2) / 3.2))
                for k in range(n):
                    if r.random() < 0.2 and n > 1:
                        continue
                    u = f.u0 + (k + 0.5) * f.length / n + r.uniform(-0.2, 0.2)
                    big = r.random()
                    ww, wh, zc = (1.6, 1.15, zb + 1.5) if big < 0.4 else (1.1, 1.15, zb + 1.5) if big < 0.75 else (0.7, 0.55, zb + 1.85)
                    if ww > f.length / n - 0.5:
                        ww = max(0.6, f.length / n - 0.6)
                    if not _clear(blocks, b, f, u, zc, ww / 2 + 0.2, reserved):
                        continue
                    if side == "s" and b is fb and s == 0 and abs(u - door_x) < ww / 2 + 0.9:
                        continue
                    if shop and side == "s" and s == 0:
                        continue
                    style = wstyle
                    if s == 0 and side == "s" and r.random() < 0.4:
                        style = "grille"
                    elif r.random() < 0.25:
                        style = r.choice(["plain", "hood", "blind", "shutter"])
                    if style == "shutter" and ww > 1.4:
                        style = "plain"
                    lit = r.random() < lit_frac
                    sill = wh > 0.8 and r.random() < 0.4
                    window(bm, f, u, zc, ww, wh, style, lit, trim, b["wall"], sill=sill)
                    if sill:
                        sx, sy, sz = f.pt(u, zc - wh / 2 - 0.075, 0.13)
                        rec["sills"].append({"x": sx, "y": sy, "z": sz, "len": ww + 0.26, "nx": f.n[0], "ny": f.n[1]})
            # Air-conditioner spots on the wall between the upper windows (ground ones are set by the prop pass).
            if b["storeys"] >= 2 and side in ("n", "e", "w") and r.random() < 0.4 and len(rec["ac_spots"]) < 2:
                zc = b["z0"] + (0.3 if not b.get("upper") else 0) + 2.9 + 0.5
                for tries in range(5):
                    u = r.uniform(f.u0 + 0.6, f.u1 - 0.6)
                    if _clear(blocks, b, f, u, zc, 0.6, reserved) and not _hits_window(bm, f, u, zc):
                        x, y, _ = f.pt(u, zc, 0.0)
                        rec["ac_spots"].append({"x": x, "y": y, "z": zc, "nx": f.n[0], "ny": f.n[1]})
                        reserved.append((x - 0.6, x + 0.6, y - 0.6, y + 0.6, zc - 0.5, zc + 0.5))
                        break
    # Downpipes at the back corners of each pitched main block.
    for b, info in infos:
        if b.get("upper"):
            continue
        if info["axis"] == "x":
            ya = info["c"] + (info["half"] + info["ov"]) + 0.07
            xs = b["x1"] - 0.25 if r.random() < 0.5 else b["x0"] + 0.25
            yw = b["y1"] + 0.11
            if _inside_other(blocks, b, xs, yw + 0.3, b["z0"] + 1):
                continue
            add_cylinder(bm, (xs, yw, b["z0"]), 0.055, info["ze"] - 0.35 - b["z0"], segments=6, mat_index=M("gutter"))
            beam(bm, (xs, yw, info["ze"] - 0.36), (xs, ya, info["ze"] - 0.06), 0.055, M("gutter"), seg=6)
        else:
            xa = info["c"] + (info["half"] + info["ov"]) + 0.07
            yb = b["y1"] - 0.25
            xw = b["x1"] + 0.11
            if _inside_other(blocks, b, xw + 0.3, yb, b["z0"] + 1):
                continue
            add_cylinder(bm, (xw, yb, b["z0"]), 0.055, info["ze"] - 0.35 - b["z0"], segments=6, mat_index=M("gutter"))
            beam(bm, (xw, yb, info["ze"] - 0.36), (xa, yb, info["ze"] - 0.06), 0.055, M("gutter"), seg=6)
    # Roof gear: antennas on the ridges, water tanks on stands on flat roofs, solar heaters on some slopes.
    for b, info in infos:
        if r.random() < 0.5:
            t = r.uniform(0.15, 0.4)
            e0, e1 = (info["r0"], info["r1"]) if info.get("hip") else (info["e0"] + 0.6, info["e1"] - 0.6)
            al = e0 + (e1 - e0) * (t if r.random() < 0.5 else 1 - t)
            pos = (al, info["c"]) if info["axis"] == "x" else (info["c"], al)
            antenna(pos[0], pos[1], info["ridge_z"], r)
        if not info.get("hip") and r.random() < 0.28 and info["e1"] - info["e0"] > 4.0 and info["half"] > 2.3:
            s = 1 if r.random() < 0.55 else -1
            mid = (info["e0"] + info["e1"]) / 2 + r.uniform(-0.8, 0.8)
            solar_heater(info, s, mid, r)
    for b in blocks:
        if "deck" not in b or b["roof"] != "flat":
            continue
        x0, x1, y0, y1 = b["x0"] + 0.9, b["x1"] - 0.9, b["y0"] + 0.9, b["y1"] - 0.9
        if x1 - x0 < 1 or y1 - y0 < 1:
            continue
        # A stair house on the deck, a tank on its stand, an antenna.
        sx = x0 + 0.6 if r.random() < 0.5 else x1 - 0.6
        hb = {"x0": sx - 1.1, "x1": sx + 1.1, "y0": y1 - 2.0, "y1": y1 + 0.5, "z0": b["deck"], "z1": b["deck"] + 2.4, "wall": b["wall"]}
        add_box(bm, ((hb["x0"] + hb["x1"]) / 2, (hb["y0"] + hb["y1"]) / 2, hb["z0"] + 1.2), (2.2, 2.5, 2.4), mat_index=b["wall"])
        add_box(bm, ((hb["x0"] + hb["x1"]) / 2, (hb["y0"] + hb["y1"]) / 2, hb["z1"] + 0.06), (2.4, 2.7, 0.12), mat_index=M("trim_white"))
        Face((0, -1), hb["y0"], hb["x0"], hb["x1"], hb["z0"], hb["z1"]).box(bm, sx, hb["z0"] + 1.0, 0.85, 0.06, 1.95, 0.03, M("door_alu"))
        Face((0, -1), hb["y0"], hb["x0"], hb["x1"], hb["z0"], hb["z1"]).box(bm, sx, hb["z1"] - 0.07, 2.2, 0.03, 0.1, 0.012, M("crease"))
        tx = x1 - 0.4 if sx < (x0 + x1) / 2 else x0 + 0.4
        water_tank(tx, (y0 + y1) / 2 - 0.3, b["deck"], r)
        if r.random() < 0.8:
            antenna(sx, (hb["y0"] + hb["y1"]) / 2, hb["z1"] + 0.12, r)
        roof_top = max(roof_top, hb["z1"] + 0.12)
        rec["deck_ac"] = ((x0 + x1) / 2, y0 + 0.3, b["deck"])
    for b in blocks:
        if b["roof"] == "terrace":
            # The lower roof is a deck: an outdoor unit and a laundry rack go there.
            rec["balconies"].append({"x": (b["x0"] + b["x1"]) / 2, "y": b["y1"] - 0.9, "z": b["deck"], "len": min(3.0, b["x1"] - b["x0"] - 1.2),
                                     "dep": 1.4, "nx": 0, "ny": 1, "solid": True, "deck": True})
    rec["door_x"] = door_x
    if extra is not None:
        extra(bm, rec)
    ob = bm_object(name, bm, "town", mats=MATS, outline=True)
    rec.update({"h": max(b["z1"] for b in blocks) - z, "storeys": max(b["storeys"] for b in blocks), "door_x": door_x, "roof_top": roof_top})
    HOUSES.append(rec)
    return ob, rec


def _hits_window(bm, f, u, zc):
    return False


def build():
    _init_mats()
    r = rng(42)
    tr = terrace_ranges()
    n = 0
    lots = []
    for ti, (y_from, y_to, z) in enumerate(tr[1:5]):
        lane_end = y_from + (6.5 if ti == 0 else 4.0)
        depth_room = (y_to - 0.8) - lane_end
        x = -88.0 + r.uniform(0, 3)
        prev = None
        while x < 88:
            w = r.uniform(5.2, 8.6)
            if abs(x + w / 2) < 6.0 or (abs(x) < 6.0) or (x < 6.0 < x + w):
                x = 6.5
                prev = None
                continue
            if ti == 2 and 5 < x + w and x < 22:
                x = 22.5
                prev = None
                continue
            if ti == 0 and -16 < x + w and x < -6:
                x = -5.9
                prev = None
                continue
            d = min(depth_room, r.uniform(6.0, 9.4))
            if d < 5.0:
                break
            y0 = lane_end + 0.6
            # Keep clear of the cove's rising sides.
            if cove_z(x + w, y0) > 0.05 or cove_z(x + w, y0 + d) > 0.05 or cove_z(x, y0) > 0.05 or cove_z(x, y0 + d) > 0.05:
                break
            lots.append([ti, x, x + w, y0, y0 + d, z])
            gap = r.uniform(0.9, 2.8)
            x += w + gap
    # The shop's lot counts as a neighbour on the first terrace.
    tr1 = terrace_ranges()[1]
    shop_lot = [0, -15.0, -7.0, tr1[0] + 7.1, tr1[0] + 14.1, tr1[2]]
    # Gaps to the neighbours (for the side stairs and ground outdoor units).
    for L in lots:
        gw = ge = 99.0
        for M2 in lots + [shop_lot]:
            if M2 is L or M2[0] != L[0]:
                continue
            if M2[2] <= L[1] + 1e-6:
                gw = min(gw, L[1] - M2[2])
            if M2[1] >= L[2] - 1e-6:
                ge = min(ge, M2[1] - L[2])
        L += [gw, ge]
    prev_east = False
    prev_ti = None
    for (ti, x0, x1, y0, y1, z, gw, ge) in lots:
        if ti != prev_ti:
            prev_east = False
            prev_ti = ti
        side = None
        if ge > 2.3:
            side = "e"
        elif gw > 2.3 and not prev_east:
            side = "w"
        ob, rec = house(f"house_{ti}_{n}", (x0, x1, y0, y1), z, seed=1000 + n, reserved_side=side)
        prev_east = rec.get("stair_side") == "e"
        rec["gap_w"], rec["gap_e"] = gw, ge
        n += 1
    _shop()
    finish_gear()
    return n


def _shop():
    """A small corner shop by the crossing (first terrace, west of the stair): a lit shop front with a roll-up shutter
    on one bay, a striped awning, the upper floor lived in."""
    tr = terrace_ranges()
    y_from, y_to, z = tr[1]
    x, w, d = -11.0, 8.0, 7.0
    y0 = y_from + 6.5 + 0.6
    _init_mats()

    def front(bm, rec):
        f = Face((0, -1), y0, x - w / 2, x + w / 2, z, z + 6.1)
        zb = z + 0.3
        dx = rec["door_x"]
        # A glazed bay and a shuttered one beside the door.
        for (u, kind) in ((x + 0.6, "glass"), (x + w / 2 - 1.4, "shutter")):
            if kind == "glass":
                f.box(bm, u, zb + 1.15, 2.4, 0.06, 2.1, 0.03, M("trim_alu"))
                f.box(bm, u, zb + 1.2, 2.2, 0.05, 1.8, 0.05, M("window_lit"))
                for k in (-0.55, 0.0, 0.55):
                    f.box(bm, u + k, zb + 1.2, 0.05, 0.03, 1.8, 0.08, M("trim_alu"))
            else:
                f.box(bm, u, zb + 1.1, 2.2, 0.08, 2.2, 0.05, M("shutter_metal"))
                f.box(bm, u, zb + 2.35, 2.4, 0.32, 0.32, 0.16, M("trim_alu"))
                f.box(bm, u, zb + 0.02, 2.2, 0.1, 0.06, 0.06, M("trim_dark"))
        # A noren curtain over the door and the striped awning across the front.
        f.box(bm, dx, zb + 1.9, 1.1, 0.03, 0.42, 0.12, M("noren"))
        f.box(bm, dx, zb + 2.13, 1.3, 0.05, 0.05, 0.12, M("trim_wood"))
        zt, zl, dep = zb + 2.6, zb + 2.2, 1.15
        pts = [f.pt(x - w / 2 + 0.1, zt, 0.0), f.pt(x + w / 2 - 0.1, zt, 0.0), f.pt(x + w / 2 - 0.1, zl, dep), f.pt(x - w / 2 + 0.1, zl, dep)]
        prism(bm, pts, (0, 0, 0.05), M("awning"))
        f.box(bm, x, zl - 0.12, w - 0.2, 0.03, 0.25, dep + 0.015, M("awning"))
        for k in range(5):
            f.box(bm, x - w / 2 + 0.3 + k * (w - 0.6) / 4, (zt + zl) / 2, 0.03, dep, 0.03, dep / 2, M("trim_dark"))

    ob, rec = house("shop", (x - w / 2, x + w / 2, y0, y0 + d), z, seed=77, kind="simple", lit_frac=0.6, shop=True, extra=front)
    rec["shop"] = True
    rec["gap_w"], rec["gap_e"] = 1.0, 1.0
    return ob
