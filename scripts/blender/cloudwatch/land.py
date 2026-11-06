"""Land: the cove's terrain with its terraces and stone banks, the harbour road, quay and breakwater, the sea, the stone
stair from the road to the lookout, and the lookout platform."""
import math

import bmesh
import bpy
from mathutils import Vector

from common import (LOOKOUT_Y, P, ROAD_Z, SEA_EDGE_Y, TERRACES, add_box, add_cylinder, bm_object, collection, cove_z, ground_z,
                    mesh_object, profile_z, rng, srgb, toon_material)

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
            if yc < SEA_EDGE_Y:
                mi = 4
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
    m = bpy.data.materials.new("cw_sea")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (1200, 0)
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    geo.location = (-1200, 0)
    # Distance from the town: near deep blue, far lavender (the sky's reflection).
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    sep.location = (-1000, 0)
    nt.links.new(geo.outputs["Position"], sep.inputs[0])
    dist = nt.nodes.new("ShaderNodeMapRange")
    dist.location = (-800, 0)
    dist.interpolation_type = "SMOOTHSTEP"
    dist.inputs["From Min"].default_value = SEA_EDGE_Y
    dist.inputs["From Max"].default_value = -1700.0
    nt.links.new(sep.outputs["Y"], dist.inputs["Value"])
    grad = nt.nodes.new("ShaderNodeValToRGB")
    grad.location = (-600, 0)
    cr = grad.color_ramp
    cr.elements[0].color = srgb(P["sea_near"])
    cr.elements[1].color = srgb(P["sea_far"])
    e = cr.elements.new(0.35)
    e.color = srgb("#3a5f98")
    e = cr.elements.new(0.8)
    e.color = srgb("#9a8fc4")
    cr.elements[1].position = 1.0
    nt.links.new(dist.outputs[0], grad.inputs[0])
    # Wave strokes: stretched noise -> light dashes.
    map_ = nt.nodes.new("ShaderNodeMapping")
    map_.location = (-1000, -400)
    map_.inputs["Scale"].default_value = (0.05, 0.5, 1.0)
    nt.links.new(geo.outputs["Position"], map_.inputs[0])
    vor = nt.nodes.new("ShaderNodeTexVoronoi")
    vor.location = (-800, -400)
    vor.feature = "F1"
    vor.inputs["Scale"].default_value = 2.5
    nt.links.new(map_.outputs[0], vor.inputs["Vector"])
    strk = nt.nodes.new("ShaderNodeMapRange")
    strk.location = (-600, -400)
    strk.inputs["From Min"].default_value = 0.08
    strk.inputs["From Max"].default_value = 0.0
    nt.links.new(vor.outputs["Distance"], strk.inputs["Value"])
    # Glitter: the sun's path on the water (toward the sun azimuth), dashes brighten there.
    from sky import sun_dir, EYE
    sd = sun_dir()
    rel = nt.nodes.new("ShaderNodeVectorMath")
    rel.operation = "SUBTRACT"
    rel.location = (-1000, -800)
    rel.inputs[1].default_value = (EYE.x, EYE.y, 0)
    nt.links.new(geo.outputs["Position"], rel.inputs[0])
    flat = nt.nodes.new("ShaderNodeVectorMath")
    flat.operation = "MULTIPLY"
    flat.inputs[1].default_value = (1, 1, 0)
    flat.location = (-850, -800)
    nt.links.new(rel.outputs[0], flat.inputs[0])
    nrm = nt.nodes.new("ShaderNodeVectorMath")
    nrm.operation = "NORMALIZE"
    nrm.location = (-700, -800)
    nt.links.new(flat.outputs[0], nrm.inputs[0])
    dot = nt.nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    hd = Vector((sd.x, sd.y, 0)).normalized()
    dot.inputs[1].default_value = (hd.x, hd.y, 0)
    dot.location = (-550, -800)
    nt.links.new(nrm.outputs[0], dot.inputs[0])
    path = nt.nodes.new("ShaderNodeMapRange")
    path.location = (-400, -800)
    path.interpolation_type = "SMOOTHSTEP"
    path.inputs["From Min"].default_value = 0.93
    path.inputs["From Max"].default_value = 0.995
    nt.links.new(dot.outputs["Value"], path.inputs["Value"])
    far = nt.nodes.new("ShaderNodeMapRange")
    far.location = (-400, -1000)
    far.inputs["From Min"].default_value = -60
    far.inputs["From Max"].default_value = -900
    nt.links.new(sep.outputs["Y"], far.inputs["Value"])
    pathf = nt.nodes.new("ShaderNodeMath")
    pathf.operation = "MULTIPLY"
    pathf.location = (-250, -900)
    nt.links.new(path.outputs[0], pathf.inputs[0])
    nt.links.new(far.outputs[0], pathf.inputs[1])
    # Strokes everywhere (soft), glitter where the path is.
    s_soft = nt.nodes.new("ShaderNodeMath")
    s_soft.operation = "MULTIPLY"
    s_soft.inputs[1].default_value = 0.25
    s_soft.location = (-250, -400)
    nt.links.new(strk.outputs[0], s_soft.inputs[0])
    mix1 = nt.nodes.new("ShaderNodeMix")
    mix1.data_type = "RGBA"
    mix1.location = (0, 0)
    nt.links.new(s_soft.outputs[0], mix1.inputs["Factor"])
    nt.links.new(grad.outputs[0], mix1.inputs[6])
    mix1.inputs[7].default_value = srgb("#a9b6e6")
    path_glow = nt.nodes.new("ShaderNodeMath")
    path_glow.operation = "MULTIPLY"
    path_glow.inputs[1].default_value = 0.45
    path_glow.location = (0, -700)
    nt.links.new(pathf.outputs[0], path_glow.inputs[0])
    mix2 = nt.nodes.new("ShaderNodeMix")
    mix2.data_type = "RGBA"
    mix2.blend_type = "SCREEN"
    mix2.location = (250, 0)
    nt.links.new(path_glow.outputs[0], mix2.inputs["Factor"])
    nt.links.new(mix1.outputs[2], mix2.inputs[6])
    mix2.inputs[7].default_value = srgb("#f6c39a")
    glit = nt.nodes.new("ShaderNodeMath")
    glit.operation = "MULTIPLY"
    glit.location = (250, -500)
    nt.links.new(strk.outputs[0], glit.inputs[0])
    nt.links.new(pathf.outputs[0], glit.inputs[1])
    em = nt.nodes.new("ShaderNodeEmission")
    em.location = (600, 0)
    nt.links.new(mix2.outputs[2], em.inputs["Color"])
    emg = nt.nodes.new("ShaderNodeEmission")
    emg.location = (600, -300)
    emg.inputs["Color"].default_value = srgb(P["glitter"])
    gs = nt.nodes.new("ShaderNodeMath")
    gs.operation = "MULTIPLY"
    gs.inputs[1].default_value = 4.0
    gs.location = (450, -500)
    nt.links.new(glit.outputs[0], gs.inputs[0])
    nt.links.new(gs.outputs[0], emg.inputs["Strength"])
    add = nt.nodes.new("ShaderNodeAddShader")
    add.location = (900, 0)
    nt.links.new(em.outputs[0], add.inputs[0])
    nt.links.new(emg.outputs[0], add.inputs[1])
    nt.links.new(add.outputs[0], out.inputs[0])
    m["cw_sea"] = 1
    return m


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


def build_stair():
    stone = toon_material("stair_stone", P["stone"], var="#d6cdbb", noise_scale=0.8)
    edge = toon_material("stair_edge", "#a99f91")
    rail = toon_material("handrail", "#7d8a8f")
    bm = bmesh.new()
    W = 2.4
    hw = W / 2
    # Steps on every bank and flat paving across each terrace, from the road to the lookout.
    tr = terrace_ranges()
    for i in range(1, len(TERRACES)):
        y0, z1 = TERRACES[i]
        z0 = TERRACES[i - 1][1]
        rise = z1 - z0
        n = int(round(rise / 0.16))
        rr = rise / n
        run = 2 * rise / n
        ys = y0 - 2 * rise
        for k in range(n):
            zt = z0 + rr * (k + 1)
            add_box(bm, (0, ys + run * (k + 0.5), (zt + z0 - 0.4) / 2), (W, run + 0.02, zt - z0 + 0.4), mat_index=0)
        # Low parapets along both sides of the run: one sloped prism each, 0.55 m over the nosings.
        for side in (-1, 1):
            xa, xb = side * hw, side * (hw + 0.36)
            za0, za1 = z0 - 0.6, z1 - 0.6
            zt0, zt1 = z0 + 0.55, z1 + 0.55
            v = [(xa, ys, za0), (xb, ys, za0), (xb, y0, za1), (xa, y0, za1), (xa, ys, zt0), (xb, ys, zt0), (xb, y0, zt1), (xa, y0, zt1)]
            vs = [bm.verts.new(p) for p in v]
            for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
                fc = bm.faces.new([vs[i] for i in (f if side > 0 else tuple(reversed(f)))])
                fc.material_index = 1
    # Paving across the flats (between the stair runs).
    for (y_from, y_to, z) in tr[1:]:
        add_box(bm, (0, (y_from + y_to) / 2, z - 0.05), (W, y_to - y_from, 0.14), mat_index=0)
    # Handrail down the middle of each run: posts and a sloped pipe.
    for i in range(1, len(TERRACES)):
        y0, z1 = TERRACES[i]
        z0 = TERRACES[i - 1][1]
        rise = z1 - z0
        ys = y0 - 2 * rise
        npost = max(2, int(2 * rise / 3.0))
        for k in range(npost + 1):
            t = k / npost
            yy = ys + 2 * rise * t
            zz = z0 + rise * t
            add_cylinder(bm, (0, yy, zz), 0.03, 0.9, segments=6, mat_index=2)
        a = Vector((0, ys, z0 + 0.9))
        b = Vector((0, y0, z1 + 0.9))
        add_cylinder(bm, a, 0.035, (b - a).length, segments=6, mat_index=2, axis=(b - a))
    ob = bm_object("stair", bm, "stair", mats=[stone, edge, rail], outline=True)
    return ob


def build_lookout():
    pave = toon_material("lookout_pave", "#d2c6b1", var="#c3b59e", noise_scale=1.2, stripes=("x", 0.9, "#b0a38f", 0.04))
    wood = toon_material("rail_wood", P["wood"], var="#9a6a48", noise_scale=2)
    metal = toon_material("lamp_metal", "#4a4d5a")
    bm = bmesh.new()
    ya, yb = LOOKOUT_Y[0], LOOKOUT_Y[0] + 10.0
    add_box(bm, (0, (ya + yb) / 2, 34.0 - 0.3), (16.0, yb - ya, 0.7), mat_index=0)
    # Railing along the south (sea) edge and the sides.
    posts = []
    for k in range(9):
        posts.append((-8.0 + 2.0 * k, ya + 0.15))
    for k in range(1, 5):
        posts.append((-7.85, ya + 2.0 * k))
        posts.append((7.85, ya + 2.0 * k))
    for (x, y) in posts:
        add_box(bm, (x, y, 34.05 + 0.525), (0.12, 0.12, 1.05), mat_index=1)
    add_box(bm, (0, ya + 0.15, 34.05 + 1.02), (16.1, 0.14, 0.1), mat_index=1)
    add_box(bm, (0, ya + 0.15, 34.05 + 0.55), (16.0, 0.06, 0.06), mat_index=1)
    for x in (-7.85, 7.85):
        add_box(bm, (x, ya + 4.15, 34.05 + 1.02), (0.14, 8.0, 0.1), mat_index=1)
    ob = bm_object("lookout", bm, "stair", mats=[pave, wood, metal], outline=True)
    return ob


def build():
    t = build_terrain()
    build_roads()
    build_harbour()
    build_sea()
    build_stair()
    build_lookout()
    return t
