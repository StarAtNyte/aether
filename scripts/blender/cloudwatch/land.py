"""Land: the cove's terrain with its terraces and stone banks, the harbour road, quay and breakwater, the sea, the stone
stair from the road to the lookout, and the lookout platform."""
import math

import bmesh
import bpy
from mathutils import Vector

from common import (LOOKOUT_Y, P, ROAD_Z, SEA_EDGE_Y, TERRACES, add_box, add_cylinder, bm_object, cove_z, ground_z,
                    mesh_object, rng, toon_material)

X0, X1 = -170.0, 170.0
Y0, Y1 = -150.0, 290.0


def terrace_ranges():
    """[(y_from, y_to, z)] of each flat terrace (road first)."""
    out = []
    for i, (y0, z) in enumerate(TERRACES):
        nxt = TERRACES[i + 1] if i + 1 < len(TERRACES) else None
        y_end = (nxt[0] - 2 * (nxt[1] - z)) if nxt else LOOKOUT_Y[1]
        out.append((max(y0, SEA_EDGE_Y), y_end, z))
    return out


def is_bank(y):
    for i in range(1, len(TERRACES)):
        y0, zi = TERRACES[i]
        rise = zi - TERRACES[i - 1][1]
        if y0 - 2 * rise < y < y0:
            return True
    return False


def build_terrain():
    mats = [
        toon_material("ground_town", "#93a860", var="#c4ad88", noise_scale=0.09, var_amount=0.22),   # 0 terrace earth
        toon_material("grass", P["grass"], var=P["grass2"], noise_scale=0.06, var_amount=0.6),     # 1 grass slopes
        toon_material("stone_bank", P["stone"], var=P["stone2"], noise_scale=0.4, stripes=("z", 0.55, "#9c9286", 0.08)),  # 2 stone banks
        toon_material("forest_floor", "#3f6b45", var="#507a48", noise_scale=0.04, var_amount=0.6),  # 3 wooded ridges
        toon_material("seabed", "#2a4f6a"),                                                          # 4 under water
        toon_material("shore_rock", "#8d8278", var="#6f6a74", noise_scale=0.3, var_amount=0.5),    # 5 rocky shore
    ]
    nx = int((X1 - X0) / 2.0) + 1
    ys = []
    y = Y0
    while y <= Y1 + 1e-6:
        ys.append(y)
        y += 1.0 if -40 < y < 145 else 3.0
    verts = []
    for y in ys:
        for i in range(nx):
            x = X0 + i * 2.0
            verts.append((x, y, ground_z(x, y)))
    faces, mat_idx = [], []
    for j in range(len(ys) - 1):
        for i in range(nx - 1):
            a = j * nx + i
            faces.append((a, a + 1, a + nx + 1, a + nx))
            x = X0 + (i + 0.5) * 2.0
            yc = (ys[j] + ys[j + 1]) / 2
            side = cove_z(x, yc) > 0.6
            zc = ground_z(x, yc)
            if yc < SEA_EDGE_Y and zc < 0.4:
                # Under water. (The headlands rise out of the sea south of the quay line: they are wooded ground, not
                # seabed; painting them with the seabed colour made a flat blue shape under the forest from the street.)
                mi = 4
            elif yc < SEA_EDGE_Y and zc < 2.5:
                mi = 5
            elif side or yc > LOOKOUT_Y[1] + 2:
                mi = 3
            elif is_bank(yc):
                mi = 2
            elif LOOKOUT_Y[0] - 18 < yc < LOOKOUT_Y[0]:
                mi = 1
            else:
                mi = 0
            mat_idx.append(mi)
    ob = mesh_object("terrain", verts, faces, "terrain")
    for m in mats:
        ob.data.materials.append(m)
    for p, mi in zip(ob.data.polygons, mat_idx):
        p.material_index = mi
    return ob


def build_roads():
    """Asphalt lanes along the front of each terrace and the harbour road."""
    mat = toon_material("asphalt", P["asphalt"], var="#7b7684", noise_scale=0.2)
    line = toon_material("road_line", "#e9e4d6")
    bm = bmesh.new()
    for (y_from, y_to, z) in terrace_ranges()[:5]:
        if z == 6.0:
            continue  # the railway terrace: the track takes the front strip
        if z == ROAD_Z:
            ya, yb = -29.0, -23.0
        else:
            ya, yb = y_from + 0.2, y_from + 3.6
        n = 60
        for k in range(n):
            xa = -92 + 184 * k / n
            xb = -92 + 184 * (k + 1) / n
            vs = [bm.verts.new((xa, ya, z + 0.03)), bm.verts.new((xb, ya, z + 0.03)), bm.verts.new((xb, yb, z + 0.03)), bm.verts.new((xa, yb, z + 0.03))]
            bm.faces.new(vs)
    ob = bm_object("roads", bm, "terrain", mats=[mat])
    # Harbour road centre dashes.
    bm2 = bmesh.new()
    for k in range(-30, 30):
        x = k * 3.0
        add_box(bm2, (x, -26.0, ROAD_Z + 0.04), (1.6, 0.14, 0.02))
    bm_object("road_lines", bm2, "terrain", mats=[line])
    return ob


def build_harbour():
    conc = toon_material("concrete", P["concrete"], var="#a7a29a", noise_scale=0.3, stripes=("x", 4.0, "#99938b", 0.02))
    bm = bmesh.new()
    # Quay wall along the sea edge.
    add_box(bm, (0, SEA_EDGE_Y - 0.6, (ROAD_Z - 2.6) / 2), (190, 1.6, ROAD_Z + 2.6))
    # Bollards.
    for k in range(-8, 9):
        add_cylinder(bm, (k * 10.0 + 3, SEA_EDGE_Y + 0.6, ROAD_Z), 0.18, 0.55, segments=8)
    # Breakwater: an arc from the east end of the quay curving south-west.
    pts = []
    for k in range(15):
        t = k / 14
        a = math.radians(-10 - 85 * t)
        pts.append(Vector((62 + 70 * math.cos(a) * 0.75, SEA_EDGE_Y - 4 + 70 * math.sin(a) * 0.9, 0)))
    for k in range(len(pts) - 1):
        p, q = pts[k], pts[k + 1]
        mid = (p + q) / 2
        d = q - p
        ang = math.atan2(d.y, d.x)
        add_box(bm, (mid.x, mid.y, -0.8), (d.length + 0.6, 6.0, 4.0), rot_z=ang)
    ob = bm_object("harbour", bm, "harbour", mats=[conc], outline=True)
    # Lighthouse at the breakwater's end.
    end = pts[-1]
    red = toon_material("lighthouse_red", P["lighthouse"], var="#c24434", noise_scale=1)
    white = toon_material("lighthouse_white", "#f2eee4")
    lamp = toon_material("lighthouse_lamp", "#fff1c8", emission="#ffe1a0", emission_strength=6.0)
    bm2 = bmesh.new()
    add_cylinder(bm2, (end.x, end.y, 1.2), 1.4, 1.0, segments=16, mat_index=1)
    add_cylinder(bm2, (end.x, end.y, 2.2), 1.15, 4.4, segments=16, mat_index=0, radius_top=0.95)
    add_cylinder(bm2, (end.x, end.y, 6.6), 1.25, 0.25, segments=16, mat_index=1)
    add_cylinder(bm2, (end.x, end.y, 6.85), 0.6, 0.9, segments=12, mat_index=2)
    add_cylinder(bm2, (end.x, end.y, 7.75), 0.85, 0.5, segments=12, mat_index=0, radius_top=0.1)
    lh = bm_object("lighthouse", bm2, "harbour", mats=[red, white, lamp], prop=True, outline=True)
    return ob, pts


def _sea_material():
    """The sea: deep blue near, the sky's lavender far; the horizon glow reflected on the far water under the sun; a soft
    warm column on the sun's path; painted wave strokes (light crests and dark troughs, long and thin, parallel to the
    shore, fading with distance). The glitter itself is geometry (build_glitter), so it can bloom and twinkle."""
    from sky import EYE, Nodes, sun_dir
    m = bpy.data.materials.new("cw_sea")
    b = Nodes(m)
    geo = b.node("ShaderNodeNewGeometry")
    pos = geo.outputs["Position"]
    px, py, pz = b.sep(pos)
    rel = b.combine(b.math("SUBTRACT", px, EYE.x), b.math("SUBTRACT", py, EYE.y), 0.0)
    dist = b.vmath("LENGTH", rel)
    sd = sun_dir()
    hd = Vector((sd.x, sd.y, 0)).normalized()
    toward = b.vmath("DOT_PRODUCT", b.vmath("NORMALIZE", rel), (hd.x, hd.y, 0.0))
    # Distance gradient.
    t = b.remap(dist, 140.0, 2300.0, 0.0, 1.0, smooth=True)
    col = b.ramp(t, [(0.0, P["sea_near"]), (0.3, "#2e5a8e"), (0.62, "#5d73b4"), (0.85, "#9a8fc4"), (1.0, "#c9a2b8")])
    # The horizon glow reflected on the far water, strongest toward the sun.
    far = b.remap(dist, 700.0, 2200.0, 0.0, 1.0, smooth=True)
    sunward = b.math("POWER", b.remap(toward, 0.2, 1.0, 0.0, 1.0, smooth=True), 2.0)
    refl = b.math("MULTIPLY", far, b.math("ADD", b.math("MULTIPLY", sunward, 0.65), 0.2))
    col = b.mix(refl, col, "#f0b092")
    # The sun's path: a warm column, narrow far and wider near.
    path = b.math("POWER", b.remap(toward, 0.982, 0.9995, 0.0, 1.0, smooth=True), 1.5)
    pathf = b.math("MULTIPLY", path, b.remap(dist, 60.0, 900.0, 0.2, 1.0))
    col = b.mix(b.math("MULTIPLY", pathf, 0.5), col, "#f7c89c", blend="SCREEN")
    halo = b.math("MULTIPLY", b.remap(toward, 0.9, 0.995, 0.0, 1.0, smooth=True), b.remap(dist, 300.0, 1800.0, 0.0, 1.0, smooth=True))
    col = b.mix(b.math("MULTIPLY", halo, 0.25), col, "#e9a98f", blend="SCREEN")
    # Wave strokes: wavy bands along the shore (x), broken into strokes by noise; light crests and dark troughs.
    mp = b.node("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (0.02, 0.32, 1.0)
    b._in(mp.inputs[0], pos)
    brk = b.node("ShaderNodeTexNoise")
    brk.inputs["Scale"].default_value = 3.0
    brk.inputs["Detail"].default_value = 2.0
    b._in(brk.inputs["Vector"], mp.outputs[0])
    wv = b.node("ShaderNodeTexWave", wave_type="BANDS", bands_direction="Y", wave_profile="SAW")
    wv.inputs["Scale"].default_value = 1.0
    wv.inputs["Distortion"].default_value = 3.0
    wv.inputs["Detail Scale"].default_value = 0.6
    mp2 = b.node("ShaderNodeMapping")
    mp2.inputs["Scale"].default_value = (0.012, 0.12, 1.0)
    b._in(mp2.inputs[0], pos)
    b._in(wv.inputs["Vector"], mp2.outputs[0])
    crest = b.math("MULTIPLY", b.remap(wv.outputs["Fac"], 0.90, 0.96, 0.0, 1.0), b.remap(brk.outputs["Fac"], 0.52, 0.6, 0.0, 1.0))
    trough = b.math("MULTIPLY", b.remap(wv.outputs["Fac"], 0.42, 0.5, 0.0, 1.0), b.remap(wv.outputs["Fac"], 0.58, 0.5, 0.0, 1.0))
    trough = b.math("MULTIPLY", trough, b.remap(brk.outputs["Fac"], 0.42, 0.34, 0.0, 1.0))
    fade = b.remap(dist, 900.0, 160.0, 0.0, 1.0)
    crest_c = b.mix(path, "#a6b6e8", "#ffe2b8")
    col = b.mix(b.math("MULTIPLY", crest, b.math("MULTIPLY", fade, 0.75)), col, crest_c)
    col = b.mix(b.math("MULTIPLY", trough, b.math("MULTIPLY", fade, 0.45)), col, "#163a62")
    b.output(b.emit(col))
    m["cw_sea"] = 1
    return m


def build_glitter():
    """The sun's glitter path: short horizontal streaks of light on the water, crowded under the sun near the horizon and
    scattered wider toward the town, as thin emissive quads lying on the sea. Four groups (glitter_0..3) twinkle in turn in
    the browser (the export keys their visibility)."""
    from sky import EYE, SUN_AZ
    r = rng(77)
    mat = toon_material("glitter", P["glitter"], emission="#fff0c8", emission_strength=3.6)
    mat_hot = toon_material("glitter_hot", P["glitter"], emission="#fffaf0", emission_strength=5.0)
    groups = [bmesh.new() for _ in range(4)]
    az0 = math.radians(SUN_AZ)
    n = 0
    tries = 0
    while n < 2300 and tries < 40000:
        tries += 1
        d = math.exp(r.uniform(math.log(70.0), math.log(2150.0)))
        width = math.radians(2.8 + 8.5 * (1.0 - min(1.0, d / 1200.0)) ** 2)
        off = r.gauss(0.0, width * 0.5)
        if abs(off) > width * 1.4:
            continue
        a = az0 + off
        x, y = EYE.x + math.sin(a) * d, EYE.y + math.cos(a) * d
        if y > SEA_EDGE_Y - 6 or ground_z(x, y) > -0.5:
            continue
        core = max(0.0, 1.0 - abs(off) / (width * 1.2))
        # Lengths along the view's tangent, thickness toward the eye sized so a streak stays a fine line on screen.
        length = d * r.uniform(0.004, 0.012) * (0.5 + core)
        thick = min(0.0011 * d * d / EYE.z * r.uniform(0.6, 1.2), d * 0.08) + 0.05
        tx, ty = math.cos(a), -math.sin(a)
        fx, fy = math.sin(a), math.cos(a)
        z = 0.05
        bm = groups[n % 4]
        vs = [bm.verts.new((x + tx * sx * length / 2 + fx * sy * thick / 2, y + ty * sx * length / 2 + fy * sy * thick / 2, z))
              for (sx, sy) in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        f = bm.faces.new(vs)
        f.material_index = 1 if (core > 0.45 and r.random() < 0.6) else 0
        n += 1
    obs = []
    for i, bm in enumerate(groups):
        ob = bm_object(f"glitter_{i}", bm, "glitter", mats=[mat, mat_hot], recalc=False)
        for p in ob.data.polygons:
            if p.normal.z < 0:
                p.flip()
        ob.visible_shadow = False
        obs.append(ob)
    return obs


def build_sea():
    verts, faces = [], []
    # A fan of rings so the near water has density and the far water stays cheap.
    rings = [0, 20, 50, 100, 200, 400, 800, 1400, 2200]
    seg = 64
    cx, cy = 0.0, SEA_EDGE_Y
    for r in rings:
        for s in range(seg + 1):
            a = math.pi + math.pi * s / seg  # the south half-disc
            verts.append((cx + math.cos(a) * (r * 1.3 + 150), cy + math.sin(a) * r, 0.0))
    for i in range(len(rings) - 1):
        for s in range(seg):
            a = i * (seg + 1) + s
            b = a + seg + 1
            faces.append((a, b, b + 1, a + 1))
    ob = mesh_object("sea", verts, faces, "sea", mat=_sea_material())
    ob.visible_shadow = False
    return ob


RISER = 0.17   # m: an outdoor public stair (the comfortable 2 x riser + tread = 0.63 m)
TREAD = 0.29
FLIGHT = 16    # steps at most between landings


def stair_profile(z0, z1, ys, length):
    """Steps of one bank (z0 -> z1 over `length` m from ys): flights of at most FLIGHT steps with level landings sharing
    what is left of the bank's length. Returns [(y_front, y_back, z_top)] for every tread and landing, in order."""
    rise = z1 - z0
    n = max(1, int(round(rise / RISER)))
    rr = rise / n
    m = max(0, -(-n // FLIGHT) - 1)  # landings inside the run
    tread = TREAD
    land = (length - n * tread) / m if m else 0.0
    if m and land < 0.8:
        # Too short for landings that deep: shorten the treads (never under 0.27 m).
        tread = max(0.27, (length - 0.8 * m) / n)
        land = (length - n * tread) / m
    if not m:
        tread = length / n
    per = [n // (m + 1) + (1 if i < n % (m + 1) else 0) for i in range(m + 1)]  # steps per flight
    out = []
    y, k = ys, 0
    for fi, cnt in enumerate(per):
        for _ in range(cnt):
            k += 1
            out.append((y, y + tread, z0 + rr * k, "step"))
            y += tread
        if fi < m:
            # The landing continues the last tread of the flight.
            yb, ye, zt, _ = out[-1]
            out[-1] = (yb, ye + land, zt, "landing")
            y += land
    return out, n


def stair_steps():
    """Every tread and landing of the whole stair, road to lookout: [(y_front, y_back, z_top, kind)] and the step count."""
    allp, total = [], 0
    for i in range(1, len(TERRACES)):
        y0, z1 = TERRACES[i]
        z0 = TERRACES[i - 1][1]
        rise = z1 - z0
        prof, n = stair_profile(z0, z1, y0 - 2 * rise, 2 * rise)
        allp.append((z0, z1, y0 - 2 * rise, y0, prof))
        total += n
    return allp, total


def build_stair():
    stone = toon_material("stair_stone", P["stone"], var="#d6cdbb", noise_scale=0.8)
    edge = toon_material("stair_edge", "#a99f91")
    rail = toon_material("handrail", "#7d8a8f")
    nose = toon_material("stair_nosing", "#b3a998")
    bm = bmesh.new()
    W = 2.4
    hw = W / 2
    # Steps on every bank (risers 0.17 m, treads 0.29 m, a level landing every 16 steps at most) and flat paving across
    # each terrace, from the road to the lookout. The top step of each bank is the terrace's own height.
    tr = terrace_ranges()
    runs, total = stair_steps()
    for (z0, z1, ys, ye, prof) in runs:
        for (ya, yb, zt, kind) in prof:
            add_box(bm, (0, (ya + yb) / 2, (zt + z0 - 0.4) / 2), (W, yb - ya + 0.01, zt - z0 + 0.4), mat_index=0)
            # A worn, slightly darker nosing strip on each step's front edge.
            add_box(bm, (0, ya + 0.03, zt + 0.004), (W - 0.04, 0.06, 0.012), mat_index=3)
        # Low parapets along both sides of the run: one sloped prism each, 0.55 m over the nosings on average.
        for side in (-1, 1):
            xa, xb = side * hw, side * (hw + 0.36)
            za0, za1 = z0 - 0.6, z1 - 0.6
            zt0, zt1 = z0 + 0.55, z1 + 0.55
            v = [(xa, ys, za0), (xb, ys, za0), (xb, ye, za1), (xa, ye, za1), (xa, ys, zt0), (xb, ys, zt0), (xb, ye, zt1), (xa, ye, zt1)]
            vs = [bm.verts.new(p) for p in v]
            for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
                fc = bm.faces.new([vs[i] for i in (f if side > 0 else tuple(reversed(f)))])
                fc.material_index = 1
        # Handrail down the middle: 0.9 m over the nosing line, a sloped pipe along each flight and a level one over each
        # landing, posts at the flight ends and every ~3 m.
        pts = [(ys, z0)]
        for (ya, yb, zt, kind) in prof:
            if kind == "landing":
                pts.append((ya, zt))
                pts.append((yb, zt))
        pts.append((ye, z1))
        for (ya, za), (yb, zb) in zip(pts[:-1], pts[1:]):
            a = Vector((0, ya, za + 0.9))
            b = Vector((0, yb, zb + 0.9))
            if (b - a).length < 0.05:
                continue
            add_cylinder(bm, a, 0.035, (b - a).length, segments=6, mat_index=2, axis=(b - a))
            npost = max(1, int((b - a).length / 3.0))
            for k in range(npost + 1):
                t = k / npost
                add_cylinder(bm, (0, ya + (yb - ya) * t, za + (zb - za) * t), 0.03, 0.9, segments=6, mat_index=2)
    # Paving across the flats (between the stair runs).
    for (y_from, y_to, z) in tr[1:]:
        add_box(bm, (0, (y_from + y_to) / 2, z - 0.05), (W, y_to - y_from, 0.14), mat_index=0)
    ob = bm_object("stair", bm, "stair", mats=[stone, edge, rail, nose], outline=True)
    ob["cw_steps"] = total
    return ob


LOOKOUT_Z = TERRACES[-1][1]  # the lookout terrace (the deck once sat at 34 m, buried 10 m under the 44 m ground)


def build_lookout():
    pave = toon_material("lookout_pave", "#d2c6b1", var="#c3b59e", noise_scale=1.2, stripes=("x", 0.9, "#b0a38f", 0.04))
    wood = toon_material("rail_wood", P["wood"], var="#9a6a48", noise_scale=2)
    metal = toon_material("lamp_metal", "#4a4d5a")
    bm = bmesh.new()
    ya, yb = LOOKOUT_Y[0], LOOKOUT_Y[0] + 10.0
    add_box(bm, (0, (ya + yb) / 2, LOOKOUT_Z - 0.3), (16.0, yb - ya, 0.7), mat_index=0)
    # Railing along the south (sea) edge and the sides.
    posts = []
    for k in range(9):
        if abs(-8.0 + 2.0 * k) > 1.5:  # the stair arrives through a gap in the middle
            posts.append((-8.0 + 2.0 * k, ya + 0.15))
    posts += [(-1.45, ya + 0.15), (1.45, ya + 0.15)]
    for k in range(1, 5):
        posts.append((-7.85, ya + 2.0 * k))
        posts.append((7.85, ya + 2.0 * k))
    for (x, y) in posts:
        add_box(bm, (x, y, LOOKOUT_Z + 0.05 + 0.525), (0.12, 0.12, 1.05), mat_index=1)
    for side in (-1, 1):
        add_box(bm, (side * 4.75, ya + 0.15, LOOKOUT_Z + 0.05 + 1.02), (6.7, 0.14, 0.1), mat_index=1)
        add_box(bm, (side * 4.75, ya + 0.15, LOOKOUT_Z + 0.05 + 0.55), (6.6, 0.06, 0.06), mat_index=1)
    for x in (-7.85, 7.85):
        add_box(bm, (x, ya + 4.15, LOOKOUT_Z + 0.05 + 1.02), (0.14, 8.0, 0.1), mat_index=1)
    ob = bm_object("lookout", bm, "stair", mats=[pave, wood, metal], outline=True)
    return ob


def build():
    t = build_terrain()
    build_roads()
    build_harbour()
    build_sea()
    build_glitter()
    build_stair()
    build_lookout()
    return t
