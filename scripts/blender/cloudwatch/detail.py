"""Lived-in detail: telegraph poles and sagging wires, stair lanterns, block walls and hedges, vending machines, bicycles,
laundry, air-conditioner units, roof water tanks, potted plants, a mailbox, signs with invented text, and people.

Every prop is dropped onto the surface under it by a ray cast against the ground pieces, so nothing floats or sinks."""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

from common import LOOKOUT_Y, P, ROAD_Z, add_box, add_cylinder, add_sphere, bm_object, collection, rng, rotate_faces, srgb, toon_material
from form import TRACK_Y, TRACK_Z
from land import terrace_ranges
from town import HOUSES

GROUND_OBJECTS = ("terrain", "roads", "stair", "lookout", "harbour")
_bvh = None


def ground_bvh():
    global _bvh
    if _bvh is not None:
        return _bvh
    verts, polys = [], []
    for name in GROUND_OBJECTS:
        ob = bpy.data.objects.get(name)
        if ob is None:
            continue
        mw = ob.matrix_world
        base = len(verts)
        verts += [mw @ v.co for v in ob.data.vertices]
        polys += [tuple(base + i for i in p.vertices) for p in ob.data.polygons]
    _bvh = BVHTree.FromPolygons(verts, polys)
    return _bvh


def drop(x, y, top=200.0):
    """Height of the ground surface under (x, y)."""
    hit = ground_bvh().ray_cast(Vector((x, y, top)), Vector((0, 0, -1)))
    return hit[0].z if hit[0] is not None else 0.0


def drop_min(x, y, rx, ry):
    """Lowest ground height under a footprint (a prop stands on its lowest corner, its base buried by the rest)."""
    return min(drop(x + dx, y + dy) for dx in (-rx, 0, rx) for dy in (-ry, 0, ry))


# ------------------------------------------------------------------------------------------------------------- poles, wires

POLE_H = 8.6


def pole(bm, x, y, z, arm_dir, mats, seed):
    """Concrete pole with two cross arms and insulators; returns the wire attachment points."""
    r = rng(seed)
    add_cylinder(bm, (x, y, z - 0.4), 0.17, POLE_H + 0.4, segments=8, mat_index=mats["pole"], radius_top=0.12)
    pts = []
    ax, ay = arm_dir
    px, py = -ay, ax  # arms run across the line
    for k, h in enumerate((POLE_H - 0.5, POLE_H - 1.4)):
        c = (x, y, z + h)
        half = 1.1 if k == 0 else 0.8
        faces = add_box(bm, c, (2 * half, 0.1, 0.1), mat_index=mats["metal"], rot_z=math.atan2(py, px))
        for t in (-1, 1) if k == 0 else (-1, 0, 1):
            ix, iy = x + px * half * 0.85 * t, y + py * half * 0.85 * t
            add_cylinder(bm, (ix, iy, z + h + 0.05), 0.05, 0.16, segments=6, mat_index=mats["insulator"])
            pts.append(Vector((ix, iy, z + h + 0.2)))
    if r.random() < 0.35:
        add_cylinder(bm, (x + px * 0.42, y + py * 0.42, z + POLE_H - 3.0), 0.26, 0.9, segments=10, mat_index=mats["metal"])
    # Step bolts.
    for k in range(6):
        hh = 2.4 + k * 0.45
        a = math.radians(90 * (k % 2))
        add_box(bm, (x + math.cos(a) * 0.2, y + math.sin(a) * 0.2, z + hh), (0.14, 0.03, 0.03), mat_index=mats["metal"], rot_z=a)
    return pts


def wire(bm, a, b, sag, mat_index, radius=0.022):
    """A sagging wire as a thin tube along a catenary-like curve."""
    n = 12
    pts = []
    for k in range(n + 1):
        t = k / n
        p = a.lerp(b, t)
        p.z -= sag * 4 * t * (1 - t)
        pts.append(p)
    prev = None
    for k in range(n):
        p, q = pts[k], pts[k + 1]
        d = q - p
        add_cylinder(bm, p, radius, d.length, segments=4, mat_index=mat_index, axis=d, cap=False)


def build_poles():
    mats_l = [toon_material("pole_concrete", P["pole"], var="#7f7a76", noise_scale=2), toon_material("pole_metal", "#5c5a62"), toon_material("insulator", "#e9e6df"), toon_material("wire", P["wire"])]
    mats = {"pole": 0, "metal": 1, "insulator": 2, "wire": 3}
    bm = bmesh.new()
    lines = []
    # Along the harbour road (inland side), along the track (north side) and up the east side of the stair.
    lines.append([(x, -22.6) for x in range(-90, 95, 30)])
    lines.append([(x + 12, TRACK_Y - 3.2) for x in range(-90, 95, 30)])
    stair = [(3.3, -16.0), (3.3, 3.0), (3.6, 22.0), (3.3, 40.0), (3.6, 60.0), (3.4, 82.0), (3.6, 104.0)]
    lines.append(stair)
    # A line climbing diagonally across the terraces (it crosses the sky in the stair and crossing shots).
    lines.append([(-28.0, -3.0), (-21.0, 20.0), (-14.5, 37.5), (-9.0, 58.0), (-4.2, 80.0)])
    attach = []
    for li, line in enumerate(lines):
        prev = None
        for k, (x, y) in enumerate(line):
            nxt = line[k + 1] if k + 1 < len(line) else line[k - 1]
            d = Vector((nxt[0] - x, nxt[1] - y)).normalized()
            z = drop_min(x, y, 0.2, 0.2)
            pts = pole(bm, x, y, z, (d.x, d.y), mats, seed=li * 100 + k)
            if prev is not None:
                for (pa, pb) in zip(prev, pts):
                    span = (pb - pa).length
                    wire(bm, pa, pb, sag=0.012 * span + 0.15, mat_index=3)
            prev = pts
            attach.append((x, y))
    ob = bm_object("poles_wires", bm, "poles", mats=mats_l, outline=False)
    ob["cw_prop"] = 0
    return attach


# ------------------------------------------------------------------------------------------------------------- lanterns

def build_lanterns():
    wood = toon_material("lantern_post", P["wood_dark"])
    paper = toon_material("lantern_paper", "#ffd8a0", emission="#ffb25c", emission_strength=3.5)
    cap = toon_material("lantern_cap", "#2a2730")
    out = []
    k = 0
    # Along the stair: every ~7 m on alternating sides, on the parapets' outer edge.
    y = -20.0
    side = 1
    while y < LOOKOUT_Y[0] - 1:
        x = side * 1.75
        z = drop(x, y)
        bm = bmesh.new()
        add_box(bm, (x, y, z + 0.05), (0.2, 0.2, 0.1), mat_index=2)  # footing
        add_cylinder(bm, (x, y, z + 0.1), 0.05, 1.85, segments=6, mat_index=0)
        add_box(bm, (x, y, z + 1.95), (0.08, 0.5, 0.06), mat_index=0)
        add_cylinder(bm, (x, y + 0.22, z + 1.5), 0.17, 0.42, segments=10, mat_index=1, radius_top=0.17)
        add_cylinder(bm, (x, y + 0.22, z + 1.92), 0.13, 0.06, segments=10, mat_index=2)
        add_cylinder(bm, (x, y + 0.22, z + 1.44), 0.12, 0.06, segments=10, mat_index=2)
        add_cylinder(bm, (x, y + 0.22, z + 1.92), 0.012, 0.03, segments=4, mat_index=0)
        ob = bm_object(f"stair_lantern_{k}", bm, "props", mats=[wood, paper, cap], prop=True, outline=True)
        out.append(ob)
        k += 1
        y += 7.0
        side = -side
    return out


# ------------------------------------------------------------------------------------------------------------- walls, hedges

def build_walls_hedges():
    block = toon_material("block_wall", "#cfc8bb", var="#bdb5a7", noise_scale=1.0, stripes=("z", 0.2, "#aaa294", 0.08))
    hedge = toon_material("hedge", "#4c8448", var="#6a9a4c", noise_scale=0.6, var_amount=0.6)
    r = rng(17)
    bmw = bmesh.new()
    bmh = bmesh.new()
    for h in HOUSES:
        # A low block wall along the lane in front of each house, open at the door.
        y = h["y"] - h["d"] / 2 - 1.1
        x0, x1 = h["x"] - h["w"] / 2 - 0.4, h["x"] + h["w"] / 2 + 0.4
        dx = h["door_x"]
        for (a, b) in ((x0, dx - 0.9), (dx + 0.9, x1)):
            if b - a < 0.4:
                continue
            n = max(1, int((b - a) / 1.6))
            for k in range(n):
                xa = a + (b - a) * k / n
                xb = a + (b - a) * (k + 1) / n
                xm = (xa + xb) / 2
                z = drop_min(xm, y, (xb - xa) / 2, 0.1)
                if r.random() < 0.5:
                    add_box(bmw, (xm, y, z + 0.55 - 0.15), (xb - xa, 0.15, 1.1 + 0.3), mat_index=0)
                else:
                    faces = add_box(bmh, (xm, y, z + 0.5 - 0.2), (xb - xa, 0.7, 1.0 + 0.4), mat_index=0)
        # Hedge clumps behind the back wall (seen from the lookout).
        if r.random() < 0.6:
            yb = h["y"] + h["d"] / 2 + 1.0
            for k in range(int(h["w"] / 1.4)):
                xx = h["x"] - h["w"] / 2 + 0.7 + k * 1.4
                z = drop(xx, yb)
                add_sphere(bmh, (xx, yb, z + 0.45), 0.75, mat_index=0, subdiv=2, scale=(1, 0.8, 0.75))
    bm_object("block_walls", bmw, "props", mats=[block], outline=True)
    bm_object("hedges", bmh, "trees", mats=[hedge], smooth=True)


# ------------------------------------------------------------------------------------------------------------- small props

def vending_machine(name, x, y, yaw, seed):
    body = toon_material("vend_body", ["#d94a3e", "#3d6fb0", "#f0ede6"][seed % 3])
    front = toon_material("vend_front", P["vending"], emission=P["vending"], emission_strength=3.0)
    rows = toon_material("vend_rows", "#9fd0f0", emission="#bfe6ff", emission_strength=1.6)
    bm = bmesh.new()
    z = drop_min(x, y, 0.5, 0.4)
    add_box(bm, (0, 0, 0.93), (1.0, 0.75, 1.86), mat_index=0)
    add_box(bm, (0, -0.38, 1.25), (0.82, 0.02, 0.95), mat_index=1)
    for k in range(3):
        add_box(bm, (0, -0.395, 0.95 + k * 0.3), (0.76, 0.02, 0.1), mat_index=2)
    add_box(bm, (0, -0.39, 0.35), (0.7, 0.04, 0.22), mat_index=0)
    ob = bm_object(name, bm, "props", mats=[body, front, rows], prop=True, outline=True)
    ob.location = (x, y, z)
    ob.rotation_euler = (0, 0, yaw)
    return ob


def bicycle(name, x, y, yaw, seed):
    frame = toon_material("bike_frame_" + str(seed % 3), ["#3a7ac0", "#c84a3c", "#e9e4d6"][seed % 3])
    black = toon_material("bike_black", "#26232c")
    bm = bmesh.new()
    R = 0.33
    for wx in (-0.52, 0.52):
        ring = bmesh.ops.create_circle(bm, cap_ends=False, radius=R, segments=16)
        # Thick tyre: a torus approximated by a tube around the circle.
        verts = ring["verts"]
        for v in verts:
            v.co = Vector((wx + v.co.x, 0, R + v.co.y))
        for v in verts:
            bm.verts.remove(v)
        for k in range(16):
            a0 = 2 * math.pi * k / 16
            a1 = 2 * math.pi * (k + 1) / 16
            p0 = Vector((wx + math.cos(a0) * R, 0, R + math.sin(a0) * R))
            p1 = Vector((wx + math.cos(a1) * R, 0, R + math.sin(a1) * R))
            add_cylinder(bm, p0, 0.025, (p1 - p0).length, segments=5, mat_index=1, axis=p1 - p0, cap=False)
    pts = {"rear": Vector((-0.52, 0, R)), "front": Vector((0.52, 0, R)), "seat": Vector((-0.2, 0, 0.82)), "bb": Vector((-0.05, 0, 0.32)), "head": Vector((0.38, 0, 0.84))}
    for (a, b) in (("rear", "seat"), ("seat", "bb"), ("bb", "rear"), ("bb", "head"), ("seat", "head"), ("head", "front")):
        d = pts[b] - pts[a]
        add_cylinder(bm, pts[a], 0.022, d.length, segments=5, mat_index=0, axis=d)
    add_box(bm, (-0.22, 0, 0.88), (0.24, 0.1, 0.05), mat_index=1)  # saddle
    add_cylinder(bm, (0.36, -0.28, 0.98), 0.018, 0.56, segments=5, mat_index=1, axis=(0, 1, 0))  # handlebar
    add_box(bm, (0.62, 0, 0.78), (0.3, 0.32, 0.2), mat_index=0)  # basket
    ob = bm_object(name, bm, "props", mats=[frame, black], prop=True, outline=True, recalc=False)
    z = drop_min(x, y, 0.6, 0.3)
    ob.location = (x, y, z)
    ob.rotation_euler = (math.radians(4), 0, yaw)  # leaning a little on its stand
    ob["cw_tolerance"] = 0.06
    return ob


def laundry(name, x, y, z, length, yaw, seed):
    r = rng(seed)
    cols = ["#f4f1ea", "#9cc3e6", "#f2b8c6", "#f5e29a", "#ffffff", "#c9e2b8"]
    mats = [toon_material("cloth_" + c[1:], c) for c in cols] + [toon_material("line_pole", "#9a9aa2")]
    bm = bmesh.new()
    for sx in (-length / 2, length / 2):
        add_cylinder(bm, (sx, 0, 0), 0.03, 1.9, segments=6, mat_index=len(cols))
    add_cylinder(bm, (-length / 2, 0, 1.85), 0.012, length, segments=4, mat_index=len(cols), axis=(1, 0, 0))
    xx = -length / 2 + 0.25
    while xx < length / 2 - 0.4:
        w = r.uniform(0.35, 0.7)
        h = r.uniform(0.45, 0.85)
        add_box(bm, (xx + w / 2, 0, 1.84 - h / 2), (w, 0.02, h), mat_index=r.randrange(len(cols)))
        xx += w + r.uniform(0.08, 0.2)
    ob = bm_object(name, bm, "props", mats=mats, prop=True, outline=False)
    ob.location = (x, y, z)
    ob.rotation_euler = (0, 0, yaw)
    return ob


def ac_unit(bm, x, y, z, nx, ny):
    add_box(bm, (x + nx * 0.2, y + ny * 0.2, z), (0.8 if ny else 0.35, 0.35 if ny else 0.8, 0.6), mat_index=0)
    add_cylinder(bm, (x + nx * 0.38, y + ny * 0.38, z), 0.22, 0.02, segments=12, mat_index=1, axis=(nx, ny, 0))


def build_small_props():
    r = rng(23)
    # Air conditioners on walls and water tanks on roofs.
    bm = bmesh.new()
    acm = [toon_material("ac_body", "#e8e5dc"), toon_material("ac_fan", "#56545c")]
    for h in HOUSES:
        for k in range(r.randint(0, 2)):
            side = r.choice(["n", "e", "w"])
            if side == "n":
                x, y, nx, ny = h["x"] + r.uniform(-h["w"] / 3, h["w"] / 3), h["y"] + h["d"] / 2, 0, 1
            elif side == "e":
                x, y, nx, ny = h["x"] + h["w"] / 2, h["y"] + r.uniform(-h["d"] / 3, h["d"] / 3), 1, 0
            else:
                x, y, nx, ny = h["x"] - h["w"] / 2, h["y"] + r.uniform(-h["d"] / 3, h["d"] / 3), -1, 0
            z = drop_min(x + nx * 0.25, y + ny * 0.25, 0.4, 0.4)
            add_box(bm, (x + nx * 0.25, y + ny * 0.25, z + 0.09), (0.7, 0.7, 0.18), mat_index=1)  # pad
            ac_unit(bm, x, y, z + 0.18 + 0.3, nx, ny)
    bm_object("ac_units", bm, "props", mats=acm, outline=True)
    # Laundry lines in back yards (seen from the lookout) and potted plants by doors.
    pot_m = [toon_material("pot", "#b5653e"), toon_material("plant", "#4f8a4a", var="#7aa04e", noise_scale=3)]
    bmp = bmesh.new()
    n = 0
    for i, h in enumerate(HOUSES):
        if r.random() < 0.35 and h.get("shop") is None:
            y = h["y"] + h["d"] / 2 + 1.7
            x = h["x"] + r.uniform(-h["w"] / 4, h["w"] / 4)
            z = drop_min(x, y, 1.5, 0.2)
            laundry(f"laundry_{n}", x, y, z, min(3.2, h["w"] - 1.5), 0.0, seed=n)
            n += 1
        for k in range(r.randint(0, 3)):
            x = h["door_x"] + r.choice((-1, 1)) * r.uniform(0.8, 1.6)
            y = h["y"] - h["d"] / 2 - 0.35
            z = drop_min(x, y, 0.2, 0.2)
            add_cylinder(bmp, (x, y, z - 0.02), 0.17, 0.34, segments=8, mat_index=0, radius_top=0.21)
            add_sphere(bmp, (x, y, z + 0.5), 0.26, mat_index=1, subdiv=1, scale=(1, 1, 1.1))
    bm_object("pots", bmp, "props", mats=pot_m, smooth=False, outline=True)
    # Vending machines: two by the shop, one on the third terrace's lane; bicycles; the mailbox.
    shop = next((h for h in HOUSES if h.get("shop")), None)
    if shop:
        y = shop["y"] - shop["d"] / 2 - 0.55
        vending_machine("vending_0", shop["x"] + shop["w"] / 2 - 0.6, y, 0.0, 0)
        vending_machine("vending_1", shop["x"] + shop["w"] / 2 - 1.75, y, 0.0, 1)
        bicycle("bicycle_0", shop["x"] - shop["w"] / 2 + 1.0, y - 0.2, 0.08, 0)
        mb = bmesh.new()
        add_cylinder(mb, (0, 0, 0), 0.06, 0.8, segments=8, mat_index=0)
        add_box(mb, (0, 0, 1.05), (0.45, 0.38, 0.5), mat_index=0)
        mz = drop_min(shop["x"] - 1.8, y - 0.3, 0.25, 0.2)
        ob = bm_object("mailbox", mb, "props", mats=[toon_material("mailbox_red", "#d23a30")], prop=True, outline=True)
        ob.location = (shop["x"] - 1.8, y - 0.3, mz)
        _sign("sign_shop", "SHIOKAZE  STORE", shop["x"], shop["y"] - shop["d"] / 2 - 0.12, shop["z"] + 3.35, 0.0, 0.42, "#2f5d8a", "#fff4dc")
    t3 = [h for h in HOUSES if abs(h["z"] - 18.0) < 0.1]
    if t3:
        h = min(t3, key=lambda q: abs(q["x"] + 10))
        vending_machine("vending_2", h["x"] + 1.5, h["y"] - h["d"] / 2 - 0.5, 0.0, 2)
        bicycle("bicycle_1", h["x"] - 1.2, h["y"] - h["d"] / 2 - 0.45, 0.0, 1)
    t2 = [h for h in HOUSES if abs(h["z"] - 12.0) < 0.1]
    if t2:
        h = min(t2, key=lambda q: abs(q["x"] - 14))
        bicycle("bicycle_2", h["x"] + 1.6, h["y"] - h["d"] / 2 - 0.45, 3.1, 2)
    # Signs: the crossing's notice, the stair's way-marker at the road, the lookout's name board.
    _sign("sign_crossing", "STOP  LOOK  LISTEN", -3.4, TRACK_Y - 3.0, TRACK_Z + 1.6, 0.0, 0.22, "#f4f1ea", "#c8332b", post=True)
    _sign("sign_stair", "LOOKOUT  320 STEPS", 2.6, -23.0, ROAD_Z + 1.9, 0.0, 0.2, "#2f5d5a", "#f4f1ea", post=True)
    _sign("sign_lookout", "CLOUDWATCH  HILL", -6.0, LOOKOUT_Y[0] + 1.0, 44.0 + 1.75, 0.0, 0.26, "#5a3a2c", "#f4e6c8", post=True)


def _sign(name, text, x, y, z, yaw, size, board, ink, post=False):
    """A board with invented text (Blender's built-in font, converted to mesh)."""
    cu = bpy.data.curves.new(name + "_txt", "FONT")
    cu.body = text
    cu.size = size
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.extrude = 0.004
    tob = bpy.data.objects.new(name + "_txt", cu)
    collection("props").objects.link(tob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tob.evaluated_get(dg))
    bpy.data.objects.remove(tob)
    bpy.data.curves.remove(cu)
    xs = [v.co.x for v in me.vertices]
    width = (max(xs) - min(xs)) if xs else 1.0
    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    # Text stands up in the XZ plane, just in front of the board (facing -Y).
    for v in bm.verts:
        v.co = Vector((v.co.x, -0.035 - v.co.z, v.co.y))
    for f in bm.faces:
        f.material_index = 1
    add_box(bm, (0, 0, 0), (width + size * 1.2, 0.05, size * 2.0), mat_index=0)
    if post:
        zb = drop(x, y)
        for sx in ((-width / 2 - size * 0.3, width / 2 + size * 0.3) if width > 1.2 else (0,)):
            add_box(bm, (sx, 0.04, zb - z + 0.04), (0.16, 0.16, 0.08), mat_index=2)  # footing
            add_cylinder(bm, (sx, 0.04, zb - z + 0.08), 0.04, (z - zb) - 0.08 - size, segments=6, mat_index=2)
    mats = [toon_material("sign_" + board[1:], board), toon_material("ink_" + ink[1:], ink), toon_material("sign_post", "#6a6870")]
    ob = bm_object(name, bm, "props", mats=mats, prop=post, outline=True, recalc=False)
    ob.location = (x, y, z)
    ob.rotation_euler = (0, 0, yaw)
    return ob


# ------------------------------------------------------------------------------------------------------------- people

def person(name, x, y, yaw, height, outfit, pose="stand", seed=0, z=None):
    """A small stylised person: legs, skirt or shorts, torso, arms, neck, head and hair. Static."""
    skin = toon_material("skin", P["skin"])
    hair = toon_material("hair_" + outfit["hair"][1:], outfit["hair"])
    top = toon_material("top_" + outfit["top"][1:], outfit["top"])
    bottom = toon_material("bottom_" + outfit["bottom"][1:], outfit["bottom"])
    shoes = toon_material("shoes", "#3a3440")
    mats = [skin, hair, top, bottom, shoes]
    s = height / 1.65
    bm = bmesh.new()
    leg_h = 0.78 * s
    hip = 0.86 * s
    for lx in (-0.085 * s, 0.085 * s):
        add_box(bm, (lx, 0.02 * s, 0.04 * s), (0.1 * s, 0.22 * s, 0.08 * s), mat_index=4)
        add_cylinder(bm, (lx, 0, 0.06 * s), 0.055 * s, leg_h, segments=8, mat_index=0, radius_top=0.07 * s)
    if outfit.get("skirt"):
        add_cylinder(bm, (0, 0, hip - 0.36 * s), 0.25 * s, 0.4 * s, segments=12, mat_index=3, radius_top=0.15 * s)
    else:
        for lx in (-0.085 * s, 0.085 * s):
            add_cylinder(bm, (lx, 0, hip - 0.3 * s), 0.085 * s, 0.32 * s, segments=8, mat_index=3)
        add_cylinder(bm, (0, 0, hip - 0.08 * s), 0.17 * s, 0.12 * s, segments=10, mat_index=3)
    # Torso.
    add_cylinder(bm, (0, 0, hip - 0.04 * s), 0.15 * s, 0.56 * s, segments=10, mat_index=2, radius_top=0.18 * s)
    shoulder = hip + 0.5 * s
    # Arms: down at the sides, or forward onto a railing.
    for side in (-1, 1):
        sh = Vector((side * 0.2 * s, 0, shoulder))
        if pose == "lean":
            hand = Vector((side * 0.17 * s, -0.42 * s, shoulder - 0.32 * s))
        elif pose == "bag" and side > 0:
            hand = Vector((side * 0.25 * s, 0.05 * s, shoulder - 0.6 * s))
        else:
            hand = Vector((side * 0.27 * s, 0.03 * s, shoulder - 0.62 * s))
        d = hand - sh
        add_cylinder(bm, sh, 0.05 * s, d.length * 0.55, segments=8, mat_index=2, axis=d, radius_top=0.045 * s)
        add_cylinder(bm, sh + d * 0.55, 0.042 * s, d.length * 0.45, segments=8, mat_index=0, axis=d, radius_top=0.035 * s)
    # Neck, head, hair.
    add_cylinder(bm, (0, 0, shoulder - 0.02 * s), 0.045 * s, 0.1 * s, segments=8, mat_index=0)
    hc = Vector((0, 0, shoulder + 0.17 * s))
    add_sphere(bm, hc, 0.11 * s, mat_index=0, subdiv=2, scale=(0.92, 0.98, 1.05))
    add_sphere(bm, hc + Vector((0, 0.02 * s, 0.025 * s)), 0.122 * s, mat_index=1, subdiv=2, scale=(0.95, 1.0, 1.0))
    if outfit.get("long_hair"):
        add_cylinder(bm, hc + Vector((0, 0.05 * s, -0.24 * s)), 0.1 * s, 0.26 * s, segments=10, mat_index=1, radius_top=0.115 * s)
    if outfit.get("hat"):
        add_cylinder(bm, hc + Vector((0, 0, 0.07 * s)), 0.2 * s, 0.02 * s, segments=14, mat_index=3)
        add_cylinder(bm, hc + Vector((0, 0, 0.07 * s)), 0.12 * s, 0.09 * s, segments=12, mat_index=3)
    ob = bm_object(name, bm, "people", mats=mats, prop=True, outline=True, recalc=False)
    if z is None:
        z = drop_min(x, y, 0.12 * s, 0.1 * s)
    ob.location = (x, y, z)
    ob.rotation_euler = (0, 0, yaw)
    ob["cw_person"] = 1
    return ob


def build_people():
    girl = {"hair": "#2f2630", "top": P["shirt_white"], "bottom": P["skirt_navy"], "skirt": True, "long_hair": True}
    boy = {"hair": "#3a2c28", "top": P["shirt_blue"], "bottom": P["shorts"]}
    woman = {"hair": "#4a3530", "top": "#e8b4a0", "bottom": "#5a6a8a", "skirt": True}
    man = {"hair": "#2a2a30", "top": "#f2efe8", "bottom": "#3d4250", "hat": True}
    child = {"hair": "#3a2a28", "top": "#f5d76e", "bottom": "#4f78b0"}
    # At the lookout railing, leaning, facing the sea.
    person("person_lookout", -2.2, LOOKOUT_Y[0] + 0.62, 0.0, 1.58, girl, pose="lean")
    # On the stair, climbing.
    person("person_stair", -0.55, 24.0, math.pi, 1.7, man)
    # Two waiting at the crossing.
    person("person_cross_0", -0.6, TRACK_Y - 3.05, math.pi, 1.62, woman, pose="bag")
    person("person_cross_1", 0.3, TRACK_Y - 3.15, math.pi + 0.3, 1.25, child)
    # By the bicycle at the shop.
    shop = next((h for h in HOUSES if h.get("shop")), None)
    if shop:
        y = shop["y"] - shop["d"] / 2 - 1.3
        person("person_shop", shop["x"] - shop["w"] / 2 + 2.1, y, -0.6, 1.72, boy)


def build():
    build_poles()
    build_lanterns()
    build_walls_hedges()
    build_small_props()
    build_people()
