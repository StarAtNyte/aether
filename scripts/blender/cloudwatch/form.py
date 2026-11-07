"""Form pass: the railway (ballast, sleepers, rails, tunnel portals, the level crossing), the shrine gate with its stone
lanterns and hall, trees and the forest on the ridges, boats in the harbour."""
import math

import bmesh
import bpy
from mathutils import Vector, noise

from common import LOOKOUT_Y, P, rotate_faces, add_box, add_cylinder, add_sphere, bm_object, cove_z, ground_z, rng, toon_material
from town import HOUSES

TRACK_Y = -9.4
TRACK_Z = 6.0
PORTAL_X = 99.0
PROPS = []  # (name, kind) of placed props, read by the detail pass


def build_railway():
    ballast = toon_material("ballast", P["gravel"], var="#9a8f82", noise_scale=3)
    sleeper = toon_material("sleeper", P["sleeper"])
    rail = toon_material("rail", P["rail"])
    bm = bmesh.new()
    x0, x1 = -PORTAL_X - 2, PORTAL_X + 2
    # Ballast: a trapezoid prism.
    hw_b, hw_t, hb = 1.8, 1.25, 0.3
    prof = [(-hw_b, 0.0), (-hw_t, hb), (hw_t, hb), (hw_b, 0.0)]
    a = [bm.verts.new((x0, TRACK_Y + py, TRACK_Z + pz)) for (py, pz) in prof]
    b = [bm.verts.new((x1, TRACK_Y + py, TRACK_Z + pz)) for (py, pz) in prof]
    for i in range(3):
        f = bm.faces.new((a[i], b[i], b[i + 1], a[i + 1]))
        f.material_index = 0
    bm.faces.new((a[0], a[1], a[2], a[3])).material_index = 0
    bm.faces.new((b[3], b[2], b[1], b[0])).material_index = 0
    x = x0 + 0.3
    while x < x1:
        if abs(x) > 1.6:  # the crossing's panels replace sleepers
            add_box(bm, (x, TRACK_Y, TRACK_Z + hb + 0.06), (0.22, 2.0, 0.12), mat_index=1)
        x += 0.62
    for side in (-1, 1):
        add_box(bm, ((x0 + x1) / 2, TRACK_Y + side * 0.5335, TRACK_Z + hb + 0.12 + 0.08), (x1 - x0, 0.07, 0.16), mat_index=2)
    bm_object("railway", bm, "rail", mats=[ballast, sleeper, rail])
    # Tunnel portals where the ridges rise.
    conc = toon_material("portal_concrete", "#bdb6aa", var="#a9a297", noise_scale=0.5, stripes=("z", 1.2, "#9f988c", 0.03))
    dark = toon_material("tunnel_dark", "#1d1a26")
    for side in (-1, 1):
        bm2 = bmesh.new()
        px = side * PORTAL_X
        top = TRACK_Z + 8.5
        add_box(bm2, (px, TRACK_Y, (TRACK_Z - 1 + top) / 2), (2.0, 12.0, top - TRACK_Z + 1), mat_index=0)
        add_box(bm2, (px, TRACK_Y, top + 0.3), (2.6, 12.6, 0.6), mat_index=0)
        # The dark mouth: an arch of quads on the town-facing side.
        fx = px - side * 1.02
        seg = 12
        rr = 2.6
        base = TRACK_Z + 0.2
        spring = base + 3.2
        pts = [(TRACK_Y - rr, base)]
        for k in range(seg + 1):
            ang = math.pi - math.pi * k / seg
            pts.append((TRACK_Y + rr * math.cos(ang), spring + rr * math.sin(ang)))
        pts.append((TRACK_Y + rr, base))
        vs = [bm2.verts.new((fx, py, pz)) for (py, pz) in pts]
        f = bm2.faces.new(vs if side > 0 else list(reversed(vs)))
        f.material_index = 1
        bm_object(f"tunnel_portal_{'e' if side > 0 else 'w'}", bm2, "rail", mats=[conc, dark], outline=True, recalc=False)
        PROPS.append(f"tunnel_portal_{'e' if side > 0 else 'w'}")
    _crossing()


def _crossing():
    panel = toon_material("crossing_panel", "#4c4854", stripes=("x", 0.5, "#3c3944", 0.05))
    yellow = toon_material("hazard_yellow", "#f2c230", stripes=("z", 0.5, "#24202a", 0.5))
    pole = toon_material("signal_pole", "#d9d4cc", stripes=("z", 0.6, "#24202a", 0.5))
    black = toon_material("signal_black", "#2a2730")
    red_on = toon_material("signal_red_on", P["signal"], emission=P["signal"], emission_strength=5.0)
    red_off = toon_material("signal_red_off", "#6a2a2a")
    mats = [panel, yellow, pole, black, red_on, red_off]
    bm = bmesh.new()
    add_box(bm, (0, TRACK_Y, TRACK_Z + 0.36), (2.6, 2.4, 0.08), mat_index=0)
    for (sx, sy, facing) in ((-1.9, TRACK_Y - 2.4, -1), (1.9, TRACK_Y + 2.4, 1)):
        base = TRACK_Z
        add_cylinder(bm, (sx, sy, base), 0.07, 3.6, segments=8, mat_index=2)
        # Crossbuck (X) on top.
        for ang in (math.radians(35), math.radians(-35)):
            c = (sx, sy + facing * 0.06, base + 3.35)
            rotate_faces(add_box(bm, c, (1.05, 0.03, 0.16), mat_index=1), c, ang, "Y")
        # Lamps: two discs on a black backboard, one lit.
        add_box(bm, (sx, sy + facing * 0.08, base + 2.55), (0.9, 0.05, 0.36), mat_index=3)
        for k, lx in enumerate((-0.25, 0.25)):
            add_cylinder(bm, (sx + lx, sy + facing * 0.11, base + 2.55), 0.13, 0.05, segments=12, mat_index=4 if k == 0 else 5, axis=(0, facing, 0))
        # Barrier arm, lowered across the path (striped), with its box.
        add_box(bm, (sx + 0.0, sy - facing * 0.25, base + 0.55), (0.35, 0.3, 1.1), mat_index=3)
        add_box(bm, (sx - math.copysign(1.7, sx), sy - facing * 0.25, base + 0.95), (3.4, 0.07, 0.07), mat_index=1)
    ob = bm_object("crossing", bm, "rail", mats=mats, outline=True)
    PROPS.append("crossing")
    return ob


def build_shrine():
    gate = toon_material("gate_vermilion", P["gate"], var="#e0573c", noise_scale=1.5)
    cap = toon_material("gate_cap", P["gate_cap"])
    stone = toon_material("lantern_stone", "#bdb5a6", var="#a59e91", noise_scale=2)
    glow = toon_material("lantern_glow", P["lantern"], emission=P["lantern"], emission_strength=4.0)
    bm = bmesh.new()
    y, z = 49.6, 18.0
    for sx in (-2.3, 2.3):
        add_cylinder(bm, (sx, y, z), 0.19, 4.7, segments=14, mat_index=0, radius_top=0.17)
        add_cylinder(bm, (sx, y, z), 0.26, 0.35, segments=14, mat_index=1)
    add_box(bm, (0, y, z + 4.05), (5.6, 0.22, 0.3), mat_index=0)  # tie beam
    add_box(bm, (0, y, z + 4.62), (6.6, 0.34, 0.32), mat_index=0)  # upper lintel
    # Cap with upturned ends: a bent box in three parts.
    add_box(bm, (0, y, z + 4.9), (5.2, 0.42, 0.24), mat_index=1)
    for sx in (-1, 1):
        c = (sx * 3.2, y, z + 4.98)
        rotate_faces(add_box(bm, c, (1.4, 0.42, 0.22), mat_index=1), c, -sx * math.radians(9), "Y")
    add_box(bm, (0, y, z + 4.34), (0.22, 0.2, 0.5), mat_index=0)  # strut
    bm_object("shrine_gate", bm, "town", mats=[gate, cap], outline=True)
    PROPS.append("shrine_gate")
    # Stone lanterns beside the path.
    for k, sx in enumerate((-3.6, 3.6)):
        b2 = bmesh.new()
        ly = y + 2.6
        add_box(b2, (sx, ly, z + 0.15), (0.7, 0.7, 0.3), mat_index=0)
        add_cylinder(b2, (sx, ly, z + 0.3), 0.13, 0.75, segments=8, mat_index=0)
        add_box(b2, (sx, ly, z + 1.1), (0.55, 0.55, 0.12), mat_index=0)
        add_box(b2, (sx, ly, z + 1.38), (0.42, 0.42, 0.44), mat_index=1)
        add_box(b2, (sx, ly, z + 1.66), (0.8, 0.8, 0.12), mat_index=0)
        add_cylinder(b2, (sx, ly, z + 1.72), 0.42, 0.22, segments=8, mat_index=0, radius_top=0.05)
        bm_object(f"stone_lantern_{k}", b2, "props", mats=[stone, glow], prop=True, outline=True)
        PROPS.append(f"stone_lantern_{k}")
    # A small hall east of the path.
    wood = toon_material("hall_wood", "#8a4f36", var="#7a4430", noise_scale=1)
    roof = toon_material("hall_roof", "#3a3f52", stripes=("z", 0.28, "#262a38", 0.18))
    b3 = bmesh.new()
    hx, hy = 13.0, 57.0
    add_box(b3, (hx, hy, z + 0.4), (6.4, 5.4, 0.8), mat_index=2)
    add_box(b3, (hx, hy, z + 0.8 + 1.4), (5.4, 4.4, 2.8), mat_index=0)
    top = z + 3.6
    ov = 1.0
    for (ya, yb) in ((hy - 2.2 - ov, hy), (hy + 2.2 + ov, hy)):
        vs = [b3.verts.new(v) for v in ((hx - 3.4, ya, top - 0.2), (hx + 3.4, ya, top - 0.2), (hx + 3.0, yb, top + 1.9), (hx - 3.0, yb, top + 1.9))]
        b3.faces.new(vs).material_index = 1
    for xe in (hx - 2.7, hx + 2.7):
        vs = [b3.verts.new(v) for v in ((xe, hy - 2.2, top), (xe, hy + 2.2, top), (xe, hy, top + 1.7))]
        b3.faces.new(vs).material_index = 0
    add_box(b3, (hx, hy, top + 1.95), (6.4, 0.4, 0.25), mat_index=1)
    stone2 = toon_material("hall_base", "#a69d8f")
    bm_object("shrine_hall", b3, "town", mats=[wood, roof, stone2], outline=True, recalc=False)


# ------------------------------------------------------------------------------------------------------------------ trees

def _leaf_mats():
    return [
        toon_material("leaf_a", P["leaf_mid"], var=P["leaf_lit"], noise_scale=0.25, var_amount=0.5),
        toon_material("leaf_b", "#3f7a52", var="#5e9a4e", noise_scale=0.25, var_amount=0.5),
        toon_material("leaf_c", "#5c8a3c", var="#86a84a", noise_scale=0.25, var_amount=0.5),
        toon_material("trunk", "#5a4034"),
    ]


def tree(bm, base, height, crown, seed, mat=0, subdiv=2, clumps=7):
    """A broadleaf tree: a tapered trunk and a crown of displaced clumps (one shading normal per clump)."""
    r = rng(seed)
    bx, by, bz = base
    add_cylinder(bm, (bx, by, bz - 0.3), 0.08 * height ** 0.8 + 0.08, height * 0.62 + 0.3, segments=7, mat_index=3, radius_top=0.05 * height ** 0.6 + 0.03)
    cz = bz + height * 0.62
    for k in range(clumps):
        if k == 0:
            off = Vector((0, 0, crown * 0.55))
            rad = crown * 0.62
        else:
            a = r.random() * 2 * math.pi
            el = r.uniform(-0.15, 0.9)
            off = Vector((math.cos(a) * math.cos(el), math.sin(a) * math.cos(el), math.sin(el) * 0.8 + 0.6)) * crown * 0.62
            rad = crown * r.uniform(0.36, 0.52)
        c = Vector((bx, by, cz)) + off
        vs = add_sphere(bm, c, rad, mat_index=mat, subdiv=subdiv, scale=(1, 1, 0.82))
        # Scalloped silhouette: push vertices by a noise field.
        for v in vs:
            n = noise.noise(v.co * (1.6 / max(rad, 0.5)) + Vector((seed, 0, 0)))
            # Broken edges: a faster, ridged noise bites leaf-clump notches into the outline (a brush's dabs).
            n2 = 1.0 - 2.0 * abs(noise.noise(v.co * (5.2 / max(rad, 0.5)) + Vector((0, seed, 3.1))))
            v.co = c + (v.co - c) * (1.0 + 0.12 * n + 0.07 * n2)


def build_trees():
    mats = _leaf_mats()
    r = rng(9)
    # Garden and street trees in the town, away from houses and the stair.
    near = bmesh.new()
    placed = []

    def free(x, y, rad):
        if abs(x) < 4.5 + rad:
            return False
        for h in HOUSES:
            if abs(x - h["x"]) < h["w"] / 2 + rad + 0.6 and abs(y - h["y"]) < h["d"] / 2 + rad + 0.6:
                return False
        for (px, py, pr) in placed:
            if (px - x) ** 2 + (py - y) ** 2 < (pr + rad) ** 2 * 0.7:
                return False
        if -14.5 < y < -6.5:  # the railway strip
            return False
        if abs(x) < 9 and 46 < y < 56:  # the shrine gate
            return False
        if y > 96 and abs(x) < 34:  # the view from the lookout stays open
            return False
        return True

    for k in range(260):
        x = r.uniform(-90, 90)
        y = r.uniform(-12, LOOKOUT_Y[0] - 2)
        h = r.uniform(4.5, 8.5)
        crown = h * r.uniform(0.38, 0.5)
        if not free(x, y, crown * 0.7):
            continue
        z = ground_z(x, y)
        placed.append((x, y, crown * 0.7))
        tree(near, (x, y, z), h, crown, seed=500 + k, mat=r.randrange(3), subdiv=2, clumps=r.randint(5, 8))
    # The big tree at the lookout.
    tree(near, (17.0, LOOKOUT_Y[0] + 11.5, 44.0), 12.0, 5.6, seed=4242, mat=0, subdiv=3, clumps=11)
    bm_object("trees_town", near, "trees", mats=mats, smooth=True)
    # The forest on the ridges and the hill behind: big clumps along the slope.
    far = bmesh.new()
    count = 0
    for k in range(9000):
        x = r.uniform(-170, 170)
        y = r.uniform(-120, 285)
        side = cove_z(x, y) > 1.0
        behind = y > LOOKOUT_Y[1] + 3
        slope = LOOKOUT_Y[0] - 34 < y < LOOKOUT_Y[0] - 1 and abs(x) > 24
        if not (side or behind or slope):
            continue
        z = ground_z(x, y)
        if z < 0.5:
            continue
        if abs(x) < 70 and LOOKOUT_Y[0] - 36 < y < LOOKOUT_Y[1] + 4:
            continue  # keep the lookout and its view to the sunset clear
        if abs(x - PORTAL_X) < 8 or abs(x + PORTAL_X) < 8:
            if -20 < y < -2:
                continue
        h = r.uniform(8, 14)
        tree(far, (x, y, z), h, h * r.uniform(0.5, 0.66), seed=9000 + k, mat=r.randrange(3), subdiv=2, clumps=r.randint(4, 6))
        count += 1
        if count > 2600:
            break
    bm_object("forest", far, "forest", mats=mats, smooth=True)
    return len(placed), count


# ------------------------------------------------------------------------------------------------------------------ boats

def boat(name, pos, length, heading, seed):
    r = rng(seed)
    hull = toon_material("boat_hull_" + str(seed % 3), [P["boat_white"], P["boat_blue"], "#e9e2d0"][seed % 3])
    trim = toon_material("boat_trim_" + str(seed % 2), [P["boat_red"], P["boat_blue"]][seed % 2])
    cabin = toon_material("boat_cabin", "#f3efe6")
    glass = toon_material("boat_glass", "#334a70")
    mast = toon_material("boat_mast", "#7b7a80")
    bm = bmesh.new()
    L, W, D = length, length * 0.3, length * 0.16
    # Hull: lofted sections from stern to bow.
    secs = []
    n = 8
    for k in range(n + 1):
        t = k / n
        x = -L / 2 + L * t
        w = W / 2 * (1.0 if t < 0.6 else max(0.02, 1 - ((t - 0.6) / 0.4) ** 1.6))
        dz = D * (0.0 if t < 0.7 else 0.25 * (t - 0.7) / 0.3)
        sec = [(x, -w, D + dz), (x, -w * 0.82, D * 0.2), (x, 0, -D * 0.35), (x, w * 0.82, D * 0.2), (x, w, D + dz)]
        secs.append([bm.verts.new(p) for p in sec])
    for k in range(n):
        for j in range(4):
            f = bm.faces.new((secs[k][j], secs[k + 1][j], secs[k + 1][j + 1], secs[k][j + 1]))
            f.material_index = 0 if j in (1, 2) else 1
    bm.faces.new(list(reversed(secs[0]))).material_index = 0
    # Deck.
    deck = [secs[k][0] for k in range(n + 1)] + [secs[k][4] for k in range(n, -1, -1)]
    bm.faces.new(deck).material_index = 2
    # Wheelhouse and mast.
    add_box(bm, (-L * 0.12, 0, D + 0.9), (L * 0.22, W * 0.6, 1.6), mat_index=2)
    add_box(bm, (-L * 0.12 + L * 0.11 + 0.01, 0, D + 1.25), (0.02, W * 0.5, 0.5), mat_index=3)
    add_cylinder(bm, (L * 0.12, 0, D), 0.06, 4.5, segments=6, mat_index=4)
    add_cylinder(bm, (L * 0.12, 0, D + 3.2), 0.04, 2.0, segments=6, mat_index=4, axis=(1, 0, 0.0))
    ob = bm_object(name, bm, "harbour", mats=[hull, trim, cabin, glass, mast], prop=True, outline=True, recalc=False)
    ob.location = pos
    ob.rotation_euler = (0, 0, heading)
    ob["cw_float"] = 1  # floats on the sea (the gate checks it against the water, not the ground)
    PROPS.append(name)
    return ob


def build_boats():
    boat("boat_0", (-30, -33.2, 0.0), 8.0, 0.0, 1)
    boat("boat_1", (-18, -34.0, 0.0), 6.5, math.pi, 2)
    boat("boat_2", (24, -33.4, 0.0), 9.0, 0.05, 3)
    boat("boat_3", (48, -52.0, 0.0), 7.0, 2.2, 4)
    boat("boat_4", (-60, -95.0, 0.0), 7.5, 0.6, 5)


def build():
    build_railway()
    build_shrine()
    build_trees()
    build_boats()
