"""Stone kitchen corner, early morning: a worked example of the photoreal-vignette recipe (see docs/BLENDER-HARNESS.md).

  blender -b -P scripts/blender/vignette/kitchen.py -- --frame 120 --out /tmp/t.png [--res 1920x1080] [--samples 128]
  blender -b -P scripts/blender/vignette/kitchen.py -- --anim 1 288 --out /tmp/frames/f_ [--mode viewport]   (resumable)
  ... --save scene.blend   writes the scene instead of rendering.

Everything is built from code: metres, Z up. Back wall (stone, y = 2.0 inner face) with a deep window, oak table in front of
it, a loaf on a board, a mug of coffee with steam, a basil pot on the sill, flagstone floor, oak beams. Sun travels in -y
through the window and lands on the table. Built in world coordinates so per-object procedural textures never repeat.
"""
import argparse
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector, noise

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import matlib as M  # noqa: E402
import rig  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--frame", type=int, default=100)
ap.add_argument("--anim", nargs=2, type=int)
ap.add_argument("--out", default="/tmp/kitchen.png")
ap.add_argument("--res", default="1920x1080")
ap.add_argument("--samples", type=int, default=128)
ap.add_argument("--mode", default="final", choices=["final", "viewport"])
ap.add_argument("--save")
ap.add_argument("--qa", action="store_true")
ap.add_argument("--cam", help="override camera 'x,y,z:tx,ty,tz' (static)")
ap.add_argument("--exposure", type=float, default=0.0)
ap.add_argument("--device", default="OPTIX")
A = ap.parse_args(argv)

rng = random.Random(11)
bpy.ops.wm.read_factory_settings(use_empty=True)
SC = bpy.context.scene
COL = SC.collection
REG = []  # (object, support_name, kind) for the interpenetration check


# ------------------------------------------------------------------ geometry helpers
def link(ob):
    COL.objects.link(ob)
    return ob


def mesh_obj(name, bm, mat=None, loc=(0, 0, 0), smooth=True, subsurf=0, bevel=0.0, bevel_seg=2):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.location = loc
    link(ob)
    if mat:
        ob.data.materials.append(mat)
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    if bevel:
        m = ob.modifiers.new("Bevel", "BEVEL")
        m.width = bevel
        m.segments = bevel_seg
        m.limit_method = "ANGLE"
        m.angle_limit = math.radians(35)
        m.harden_normals = False
    if subsurf:
        m = ob.modifiers.new("Subsurf", "SUBSURF")
        m.levels = subsurf
        m.render_levels = subsurf
    return ob


def box_bm(x0, x1, y0, y1, z0, z1, cuts=0, jitter=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0, calc_uvs=True)
    for v in bm.verts:
        v.co = Vector((x0 if v.co.x < 0 else x1, y0 if v.co.y < 0 else y1, z0 if v.co.z < 0 else z1))
    if cuts:
        bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=cuts, use_grid_fill=True)
    if jitter:
        for v in bm.verts:
            v.co += Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * jitter
    return bm


def grid_bm(sx, sy, nx, ny, z=0.0):
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    verts = [[bm.verts.new(((i / nx - 0.5) * sx, (j / ny - 0.5) * sy, z)) for j in range(ny + 1)] for i in range(nx + 1)]
    for i in range(nx):
        for j in range(ny):
            f = bm.faces.new((verts[i][j], verts[i + 1][j], verts[i + 1][j + 1], verts[i][j + 1]))
            for l, (a, b) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                l[uv].uv = (a / nx, b / ny)
    return bm


def revolve(profile, steps=64):
    """profile: list of (r, z) from bottom axis outward and around; returns bmesh revolved about Z."""
    bm = bmesh.new()
    vs = [bm.verts.new((r, 0, z)) for r, z in profile]
    for a, b in zip(vs, vs[1:]):
        bm.edges.new((a, b))
    bmesh.ops.spin(bm, geom=list(bm.verts) + list(bm.edges), axis=(0, 0, 1), cent=(0, 0, 0), angle=math.tau, steps=steps)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    return bm


def reg(ob, support, kind="rest"):
    REG.append((ob, support, kind))
    return ob


# ------------------------------------------------------------------ materials
mat = {
    "stone": M.stone("StoneWall", tint=(0.6, 0.55, 0.47), whitewash=0.3),
    "stone_dark": M.stone("StoneDark", tint=(0.32, 0.29, 0.25)),
    "mortar": M.mortar(),
    "plaster": M.plaster("PlasterWall", (0.76, 0.70, 0.60), grime=0.7),
    "plaster_reveal": M.plaster("PlasterReveal", (0.82, 0.77, 0.68), grime=0.8, scale=2.0),
    "oak": M.wood("OakTable", (0.46, 0.30, 0.16), (0.2, 0.11, 0.05), grain_axis=0, wear=0.8),
    "oak_dark": M.wood("OakBeam", (0.24, 0.15, 0.08), (0.09, 0.05, 0.025), grain_axis=0, wear=0.5, scale=0.7),
    "frame": M.wood("WindowFrame", (0.5, 0.35, 0.2), (0.25, 0.15, 0.08), grain_axis=2, paint=(0.42, 0.50, 0.44), wear=0.9, scale=1.5),
    "maple": M.wood("Board", (0.74, 0.58, 0.38), (0.5, 0.35, 0.2), grain_axis=0, wear=0.3, scale=1.3, gloss=0.4),
    "glass": M.glass(),
    "linen": M.linen(color=(0.62, 0.54, 0.40)),
    "crust": M.bread_crust(),
    "crumb": M.crumb(),
    "glaze": M.ceramic("MugGlaze", (0.20, 0.42, 0.42), (0.04, 0.13, 0.17), height=0.0915),
    "coffee": M.liquid(),
    "terra": M.terracotta(),
    "soil": M.soil(),
    "leaf": M.leaf(),
    "steel": M.metal("Steel", (0.7, 0.7, 0.72), 0.25, 0.2),
    "brass": M.metal("Brass", (0.78, 0.55, 0.25), 0.28, 0.5),
    "flag": M.flagstone(),
    "air": M.dust_air(density=0.005, aniso=0.75),
    "shaft": M.dust_air(density=0.03, aniso=0.8, edge_fade=True),
    "steam": M.steam_volume(density=16.0),
    "mote": M.mote(),
    "paper": M.paper(),
    "lemon": M.lemon(),
}
mat["mote"].node_tree.nodes["Principled BSDF"].inputs["Emission Color"].default_value = (1.0, 0.9, 0.7, 1.0)
mat["mote"].node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 0.0

# ------------------------------------------------------------------ room
STONE_TEX = bpy.data.textures.new('StoneRough', 'CLOUDS')
STONE_TEX.noise_scale = 0.07
STONE_TEX.noise_depth = 4
X0, X1, YF, YB, Z1 = -1.9, 1.9, -1.6, 2.0, 2.55
WX0, WX1, WZ0, WZ1 = -0.5, 0.5, 0.95, 2.15  # window opening in the back wall
WT = 0.5  # wall thickness


def wavy(bm, amp=0.012, freq=2.0, axis_skip=None):
    for v in bm.verts:
        n = noise.noise(Vector(v.co) * freq) * amp
        n2 = noise.noise(Vector(v.co) * freq * 4 + Vector((9, 9, 9))) * amp * 0.3
        d = n + n2
        if axis_skip == "y":
            v.co.x += d
            v.co.z += d * 0.6
        elif axis_skip == "x":
            v.co.y += d
            v.co.z += d * 0.6
        else:
            v.co.z += d


def plane_wall(name, origin, u, v, su, sv, normal, material, amp=0.01, n=90):
    """Subdivided plane wall, displaced along its normal by noise."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    nu, nv = int(su * 26), int(sv * 26)
    vs = [[None] * (nv + 1) for _ in range(nu + 1)]
    for i in range(nu + 1):
        for j in range(nv + 1):
            p = Vector(origin) + Vector(u) * (i / nu * su) + Vector(v) * (j / nv * sv)
            p += Vector(normal) * (noise.noise(p * 1.6) * amp + noise.noise(p * 7 + Vector((5, 1, 3))) * amp * 0.25)
            vs[i][j] = bm.verts.new(p)
    for i in range(nu):
        for j in range(nv):
            f = bm.faces.new((vs[i][j], vs[i + 1][j], vs[i + 1][j + 1], vs[i][j + 1]))
            for l, (a, b) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                l[uvl].uv = (a / nu, b / nv)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    # ensure normal faces toward +normal
    nrm = Vector(normal)
    if bm.faces[0].normal.dot(nrm) < 0:
        bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
    return mesh_obj(name, bm, material)


def build_room():
    # floor: mortar bed + flagstones in rough courses
    bm = box_bm(X0, X1, YF, YB, -0.06, -0.01)
    mesh_obj("FloorBed", bm, mat["mortar"], smooth=False)
    y = YF
    while y < YB:
        h = rng.uniform(0.38, 0.62)
        y1 = min(y + h, YB)
        x = X0 + rng.uniform(0, 0.15)
        xs = X0
        while xs < X1:
            w = rng.uniform(0.38, 0.75)
            xe = min(xs + w, X1)
            g = 0.012
            top = rng.uniform(0.0, 0.012)
            bm = box_bm(xs + g, xe - g, y + g, y1 - g, -0.03, top, cuts=2, jitter=0.0)
            for v in bm.verts:
                if v.co.z > 0.0 - 1e-6:
                    v.co.z += noise.noise(Vector((v.co.x, v.co.y, 0)) * 9) * 0.004
            mesh_obj("Flag", bm, mat["flag"], smooth=False, bevel=0.008, bevel_seg=3)
            xs = xe
        y = y1
    # side walls, front wall, ceiling (plaster); front wall hidden from camera by position
    plane_wall("WallW", (X0, YF, 0), (0, 1, 0), (0, 0, 1), YB - YF, Z1, (1, 0, 0), mat["plaster"], amp=0.012)
    plane_wall("WallE", (X1, YF, 0), (0, 1, 0), (0, 0, 1), YB - YF, Z1, (-1, 0, 0), mat["plaster"], amp=0.012)
    plane_wall("WallF", (X0, YF, 0), (1, 0, 0), (0, 0, 1), X1 - X0, Z1, (0, 1, 0), mat["plaster"], amp=0.012)
    plane_wall("Ceiling", (X0, YF, Z1), (1, 0, 0), (0, 1, 0), X1 - X0, YB - YF, (0, 0, -1), mat["plaster"], amp=0.01)
    # beams
    for by in (-0.55, 0.65, 1.75):
        bm = box_bm(X0, X1, by - 0.09, by + 0.09, Z1 - 0.2, Z1 - 0.005, cuts=1, jitter=0.002)
        mesh_obj("Beam", bm, mat["oak_dark"], smooth=False, bevel=0.012, bevel_seg=2)
    # skirting-less base: stone plinth strip along the west wall
    # back wall: dark mortar core with opening, then stones in front
    core = [
        (X0, X1, YB + 0.05, YB + WT, 0.0, Z1),  # full back sheet behind everything except window
    ]
    # split the core around the opening so the window shows through
    parts = [
        (X0, WX0, YB, YB + WT, 0.0, Z1),
        (WX1, X1, YB, YB + WT, 0.0, Z1),
        (WX0, WX1, YB, YB + WT, 0.0, WZ0),
        (WX0, WX1, YB, YB + WT, WZ1, Z1),
    ]
    for p in parts:
        mesh_obj("WallCore", box_bm(*p), mat["mortar"], smooth=False)
    # stones: coursed rubble on the room face, y from YB-d to YB
    z = 0.0
    k = 0
    while z < Z1 - 0.01:
        h = rng.uniform(0.17, 0.27)
        if z + h > Z1:
            h = Z1 - z
        x = X0
        while x < X1 - 0.02:
            w = rng.uniform(0.24, 0.55)
            xe = min(x + w, X1)
            if X1 - xe < 0.2:
                xe = X1
            segs = [(x, xe)]
            if z + h > WZ0 - 0.02 and z < WZ1 + 0.1 and xe > WX0 and x < WX1:
                segs = []
                if x < WX0:
                    segs.append((x, WX0))
                if xe > WX1:
                    segs.append((WX1, xe))
            if z < WZ1 + 0.1 and z + h > WZ1 and False:
                pass
            for a, b in segs:
                if b - a < 0.06:
                    continue
                g = 0.018
                d = rng.uniform(0.13, 0.30)
                fy = YB - rng.uniform(0.0, 0.035)
                bm = box_bm(a + g, b - g, fy - d * 0.2 + 0.0, YB + 0.12, z + g, z + h - g, cuts=3, jitter=0.009)
                # push front face outwards with a lumpy bulge toward the room
                for v in bm.verts:
                    if v.co.y < YB:
                        v.co.y = fy - d * 0.1 + noise.noise(Vector((v.co.x, v.co.z, 0)) * 6) * 0.02
                st = mesh_obj("Stone", bm, mat["stone"], smooth=True, subsurf=2)
                dm = st.modifiers.new("Rough", "DISPLACE")
                dm.texture = STONE_TEX
                dm.strength = 0.018
                dm.mid_level = 0.5
                dm.texture_coords = "GLOBAL"
                k += 1
            x = xe
        z += h
    # window reveals (plaster, splayed slightly) + oak lintel + sill
    mesh_obj("RevealL", box_bm(WX0 - 0.03, WX0, YB, YB + WT, WZ0, WZ1, cuts=2), mat["plaster_reveal"], smooth=False)
    mesh_obj("RevealR", box_bm(WX1, WX1 + 0.03, YB, YB + WT, WZ0, WZ1, cuts=2), mat["plaster_reveal"], smooth=False)
    mesh_obj("RevealTop", box_bm(WX0, WX1, YB, YB + WT, WZ1, WZ1 + 0.03, cuts=2), mat["plaster_reveal"], smooth=False)
    mesh_obj("Lintel", box_bm(WX0 - 0.35, WX1 + 0.35, YB - 0.06, YB + 0.22, WZ1 + 0.03, WZ1 + 0.2, cuts=1, jitter=0.002), mat["oak_dark"], smooth=False, bevel=0.01, bevel_seg=2)
    sill = mesh_obj("Sill", box_bm(WX0 - 0.25, WX1 + 0.25, YB - 0.1, YB + WT + 0.02, WZ0 - 0.07, WZ0, cuts=1, jitter=0.002), mat["stone_dark"], smooth=False, bevel=0.012, bevel_seg=3)
    # window: frame, mullion, transom, glass
    fy0, fy1 = YB + 0.28, YB + 0.34
    ft = 0.045
    fr = []
    fr.append(box_bm(WX0 + 0.0, WX1, fy0, fy1, WZ0, WZ0 + ft))
    fr.append(box_bm(WX0 + 0.0, WX1, fy0, fy1, WZ1 - ft, WZ1))
    fr.append(box_bm(WX0, WX0 + ft, fy0, fy1, WZ0, WZ1))
    fr.append(box_bm(WX1 - ft, WX1, fy0, fy1, WZ0, WZ1))
    fr.append(box_bm((WX0 + WX1) / 2 - 0.02, (WX0 + WX1) / 2 + 0.02, fy0 + 0.01, fy1 - 0.01, WZ0, WZ1))
    fr.append(box_bm(WX0, WX1, fy0 + 0.01, fy1 - 0.01, (WZ0 + WZ1) / 2 + 0.15, (WZ0 + WZ1) / 2 + 0.18))
    for i, b in enumerate(fr):
        mesh_obj("Frame%d" % i, b, mat["frame"], smooth=False, bevel=0.004, bevel_seg=2)
    gl = box_bm(WX0 + 0.02, WX1 - 0.02, (fy0 + fy1) / 2 - 0.002, (fy0 + fy1) / 2 + 0.002, WZ0 + 0.02, WZ1 - 0.02)
    mesh_obj("Glass", gl, mat["glass"], smooth=False)
    return sill


# ------------------------------------------------------------------ table and props
TX0, TX1, TY0, TY1, TZ = -0.68, 0.68, 1.20, 1.97, 0.78


def build_table():
    top = []
    pw = (TX1 - TX0) / 3
    for i in range(3):
        a, b = TX0 + i * pw, TX0 + (i + 1) * pw
        # planks run along y (grain along y): rotate grain axis by using separate material copy for y grain
        bm = box_bm(a + 0.0006, b - 0.0006, TY0, TY1, TZ - 0.045 + rng.uniform(-0.0006, 0.0006), TZ, cuts=1)
        top.append(mesh_obj("Plank%d" % i, bm, mat["oak_y"], smooth=False, bevel=0.005, bevel_seg=3))
    # frame and legs
    lg = 0.075
    for lx in (TX0 + 0.05, TX1 - 0.05 - lg):
        for ly in (TY0 + 0.05, TY1 - 0.05 - lg):
            mesh_obj("Leg", box_bm(lx, lx + lg, ly, ly + lg, 0.0, TZ - 0.045, cuts=1, jitter=0.0008), mat["oak_dark"], smooth=False, bevel=0.007, bevel_seg=2)
    mesh_obj("ApronF", box_bm(TX0 + 0.05, TX1 - 0.05, TY0 + 0.05, TY0 + 0.075, TZ - 0.17, TZ - 0.045, cuts=1), mat["oak_dark"], smooth=False, bevel=0.005)
    mesh_obj("ApronL", box_bm(TX0 + 0.05, TX0 + 0.075, TY0 + 0.05, TY1 - 0.05, TZ - 0.17, TZ - 0.045, cuts=1), mat["oak_dark"], smooth=False, bevel=0.005)
    mesh_obj("ApronR", box_bm(TX1 - 0.075, TX1 - 0.05, TY0 + 0.05, TY1 - 0.05, TZ - 0.17, TZ - 0.045, cuts=1), mat["oak_dark"], smooth=False, bevel=0.005)
    return top


def build_runner():
    """Folded striped linen tea towel on the table: soft wrinkles on top, rounded fold edges, 1.2 cm thick."""
    bm = box_bm(-0.13, 0.13, -0.09, 0.09, 0.0, 0.013, cuts=6)
    for v in bm.verts:
        if v.co.z > 0.006:
            v.co.z += noise.noise(Vector((v.co.x * 14, v.co.y * 14, 1))) * 0.0022 + noise.noise(Vector((v.co.x * 40, v.co.y * 40, 3))) * 0.0007
        v.co.x += noise.noise(Vector((v.co.y * 9, v.co.z * 9, 5))) * 0.003
    ob = mesh_obj("Runner", bm, mat["linen"], loc=(-0.52, 1.64, TZ + 0.0006), smooth=True, subsurf=1)
    ob.rotation_euler = (0, 0, math.radians(17))
    return ob


def build_board_and_bread():
    # board
    bx, by, brot = -0.20, 1.55, math.radians(-14)
    bm = box_bm(-0.25, 0.25, -0.125, 0.125, 0.0, 0.022, cuts=1)
    for v in bm.verts:  # hand-hewn: gentle bow
        v.co.z += noise.noise(Vector((v.co.x * 4, v.co.y * 4, 2))) * 0.0008
    board = mesh_obj("Board", bm, mat["maple"], loc=(bx, by, TZ + 0.0008), smooth=False, bevel=0.007, bevel_seg=3)
    board.rotation_euler = (0, 0, brot)
    reg(board, "Plank*", "rest")
    btop = TZ + 0.0008 + 0.022

    def bw(lx, ly):
        c, sn = math.cos(brot), math.sin(brot)
        return bx + lx * c - ly * sn, by + lx * sn + ly * c

    # loaf
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=180, v_segments=90, radius=1.0)
    rx, ry, rz = 0.155, 0.11, 0.072
    lumps = []
    for v in bm.verts:
        p = v.co.copy()
        z = p.z
        if z < 0:
            z *= 0.18
        base = Vector((p.x * rx, p.y * ry, z * rz))
        n = noise.noise(Vector((p.x * 2.2, p.y * 2.2, p.z * 2.2)) + Vector((3, 4, 5))) * 0.006
        n += noise.noise(Vector((p.x * 7, p.y * 7, p.z * 7))) * 0.0015
        base += p.normalized() * n
        v.co = base
    grooves = []
    ga = [(-0.08, 0.0), (0.0, 0.0), (0.08, 0.0)]
    cl = bm.verts.layers.float.new("groove") if False else None
    attr = bm.verts.layers.float_color.new("groove") if hasattr(bm.verts.layers, "float_color") else None
    for v in bm.verts:
        co = v.co
        gval = 0.0
        if co.z > 0.02:
            for cx, _ in ga:
                # slash: diagonal line x = cx + 0.45*y, length limited to |y| < 0.075
                dist = abs(co.x - (cx + 0.5 * co.y)) / math.sqrt(1 + 0.25)
                along = abs(co.y)
                if along < 0.082:
                    fall = max(0.0, 1.0 - dist / 0.0065)
                    lip = max(0.0, 1.0 - abs(dist - 0.011) / 0.005) * 0.4
                    end = max(0.0, min(1.0, (0.082 - along) / 0.02))
                    gval = max(gval, fall * end)
                    co.z += (-0.011 * fall + 0.0028 * lip) * end
        if attr:
            v[attr] = (gval, gval, gval, 1.0)
    bm.normal_update()
    loaf = mesh_obj("Loaf", bm, mat["crust"], loc=(*bw(-0.07, 0.0), btop - 0.0005), smooth=True, subsurf=1)
    loaf.rotation_euler = (0, 0, brot + math.radians(18))
    # push the loaf so its flat base sits on the board: base z = 0 (z<0 squashed at 0.18*rz)
    # lowest point = -rz*0.18 = -0.013 -> raise
    loaf.location.z = btop + 0.0125
    reg(loaf, "Board", "rest")
    # cut slice (crumb face up) lying on the board to the left
    pts = []
    for i in range(0, 25):
        t = math.pi * i / 24
        pts.append((math.cos(t) * 0.068, math.sin(t) * 0.058 + 0.0))
    sbm = bmesh.new()
    vs = [sbm.verts.new((x, y, 0)) for x, y in pts]
    f = sbm.faces.new(vs)
    res = bmesh.ops.extrude_face_region(sbm, geom=[f])
    vt = [e for e in res["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(sbm, vec=(0, 0, 0.016), verts=vt)
    bmesh.ops.recalc_face_normals(sbm, faces=list(sbm.faces))
    for v in sbm.verts:  # soft, slightly irregular edge
        v.co.x += noise.noise(Vector((v.co.x * 20, v.co.y * 20, 0))) * 0.0015
    sl = mesh_obj("Slice", sbm, mat["crumb"], loc=(*bw(0.17, -0.01), btop + 0.0), smooth=False)
    sl.rotation_euler = (0, 0, brot + math.radians(75))
    # crust rim material on side faces
    sl.data.materials.append(mat["crust"])
    for p in sl.data.polygons:
        if abs(p.normal.z) < 0.5:
            p.material_index = 1
    m = sl.modifiers.new("Bevel", "BEVEL")
    m.width = 0.0025
    m.segments = 2
    reg(sl, "Board", "rest")
    # bread knife lying on the board
    kb = box_bm(0.0, 0.2, -0.011, 0.011, 0.0, 0.0016)
    for v in kb.verts:  # tapered tip
        if v.co.x > 0.15:
            v.co.y *= max(0.05, 1.0 - (v.co.x - 0.15) / 0.05 * 0.9)
    kn = mesh_obj("KnifeBlade", kb, mat["steel"], loc=(*bw(-0.10, -0.205), TZ + 0.0003), smooth=False)
    kn.rotation_euler = (0, 0, brot + math.radians(5))
    kh = box_bm(-0.11, 0.0, -0.011, 0.011, 0.0, 0.016, cuts=1)
    kh_o = mesh_obj("KnifeHandle", kh, mat["oak_dark"], loc=kn.location.copy(), smooth=False, bevel=0.004, bevel_seg=2)
    kh_o.rotation_euler = kn.rotation_euler.copy()
    reg(kn, "Plank*", "rest")
    reg(kh_o, "Plank*", "rest")
    # crumbs and flour specks on the board and cloth
    for i in range(60):
        a = rng.uniform(0, math.tau)
        rr = rng.uniform(0.02, 0.19)
        cx = bx + math.cos(a) * rr * 0.9
        cy = by + math.sin(a) * rr * 0.45
        s = rng.uniform(0.0008, 0.0025)
        cb = bmesh.new()
        bmesh.ops.create_icosphere(cb, subdivisions=1, radius=s)
        for v in cb.verts:
            v.co.z *= 0.6
            v.co += Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * s * 0.3
        o = mesh_obj("Crumb", cb, mat["crumb"], loc=(cx, cy, btop + s * 0.5), smooth=False)
    return board, loaf


def build_mug(x, y):
    prof = [(0.0, 0.0), (0.030, 0.0), (0.036, 0.0025), (0.0415, 0.016), (0.0430, 0.05), (0.0425, 0.085), (0.0412, 0.0905),
            (0.0392, 0.0915), (0.0375, 0.0895), (0.0365, 0.082), (0.0355, 0.02), (0.030, 0.008), (0.0, 0.0075)]
    bm = revolve(prof, 72)
    for v in bm.verts:  # hand-thrown wobble
        a = math.atan2(v.co.y, v.co.x)
        r = math.hypot(v.co.x, v.co.y)
        f = 1.0 + 0.008 * math.sin(2 * a + 1.0) + 0.003 * math.sin(3 * a + v.co.z * 12)
        v.co.x *= f
        v.co.y *= f
    mug = mesh_obj("Mug", bm, mat["glaze"], loc=(x, y, TZ + 0.0011 + 0.0), smooth=True, subsurf=1)
    mug.rotation_euler = (0, 0, math.radians(30))
    # handle: bevelled bezier loop
    cv = bpy.data.curves.new("MugHandle", "CURVE")
    cv.dimensions = "3D"
    cv.bevel_depth = 0.0065
    cv.bevel_resolution = 4
    cv.resolution_u = 14
    cv.use_fill_caps = True
    sp = cv.splines.new("BEZIER")
    sp.bezier_points.add(2)
    pts = [(0.041, 0, 0.078, (0.0, 0, 0.012)), (0.073, 0, 0.052, (0.0, 0, 0.014)), (0.040, 0, 0.022, (0.0, 0, -0.01))]
    for bp, (px, py, pz, _h) in zip(sp.bezier_points, pts):
        bp.co = (px, py, pz)
        bp.handle_left_type = bp.handle_right_type = "AUTO"
    ho = bpy.data.objects.new("MugHandle", cv)
    ho.location = mug.location
    ho.rotation_euler = mug.rotation_euler
    link(ho)
    ho.data.materials.append(mat["glaze"])
    reg(mug, "Plank*", "rest")
    # coffee surface
    cb = bmesh.new()
    bmesh.ops.create_circle(cb, cap_ends=True, segments=64, radius=0.0368)
    c = mesh_obj("Coffee", cb, mat["coffee"], loc=(x, y, TZ + 0.0011 + 0.0775), smooth=True)
    # steam volume
    sb = bmesh.new()
    bmesh.ops.create_cube(sb, size=1.0)
    for v in sb.verts:
        v.co.z += 0.5
    st = mesh_obj("Steam", sb, mat["steam"], loc=(x, y, TZ + 0.0011 + 0.082), smooth=False)
    st.scale = (0.14, 0.14, 0.28)
    st.visible_shadow = False
    return mug


def leaf_mesh(name="LeafMesh", L=0.055, W=0.036):
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    nu, nv = 6, 12
    vs = [[None] * (nv + 1) for _ in range(nu + 1)]
    for i in range(nu + 1):
        s = i / nu * 2 - 1
        for j in range(nv + 1):
            t = j / nv
            w = W * (math.sin(math.pi * min(1.0, t ** 0.75)) * (1 - 0.15 * t)) / 2
            x = s * w
            y = t * L
            z = -0.18 * L * t * t + 0.35 * (s * w) ** 2 / max(W, 1e-3) * 4 + 0.002 * math.sin(t * 9 + s)
            vs[i][j] = bm.verts.new((x, y, z))
    for i in range(nu):
        for j in range(nv):
            f = bm.faces.new((vs[i][j], vs[i + 1][j], vs[i + 1][j + 1], vs[i][j + 1]))
            for l, (a, b) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                l[uvl].uv = (a / nu, b / nv)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(mat["leaf"])
    return me


def build_basil(cx, cy, cz):
    """Terracotta pot on the sill with a bushy basil plant: stems with leaf pairs, instanced from one leaf mesh."""
    prof = [(0.0, 0.0), (0.038, 0.0), (0.046, 0.002), (0.056, 0.09), (0.0585, 0.098), (0.062, 0.106), (0.062, 0.122), (0.058, 0.124), (0.0575, 0.112), (0.052, 0.1), (0.0, 0.1)]
    bm = revolve(prof, 56)
    pot = mesh_obj("Pot", bm, mat["terra"], loc=(cx, cy, cz), smooth=True, subsurf=1)
    reg(pot, "Sill", "rest")
    sb = bmesh.new()
    bmesh.ops.create_circle(sb, cap_ends=True, segments=40, radius=0.054)
    for v in sb.verts:
        v.co.z = 0.105 + noise.noise(Vector((v.co.x * 90, v.co.y * 90, 0))) * 0.003
    mesh_obj("Soil", sb, mat["soil"], loc=(cx, cy, cz), smooth=True)
    lm = leaf_mesh()
    r = random.Random(5)
    stem_mat = M.simple("Stem", (0.2, 0.32, 0.08), 0.5)
    nleaves = 0
    for si in range(7):
        a = si / 7 * math.tau + r.uniform(-0.3, 0.3)
        rad = r.uniform(0.0, 0.028)
        base = Vector((cx + math.cos(a) * rad, cy + math.sin(a) * rad, cz + 0.105))
        height = r.uniform(0.14, 0.24)
        lean = Vector((math.cos(a), math.sin(a), 0)) * r.uniform(0.02, 0.07)
        pts = []
        for k in range(8):
            t = k / 7
            pts.append(base + Vector((0, 0, height * t)) + lean * t * t)
        cv = bpy.data.curves.new("Stem", "CURVE")
        cv.dimensions = "3D"
        cv.bevel_depth = 0.0016
        cv.bevel_resolution = 2
        sp = cv.splines.new("POLY")
        sp.points.add(len(pts) - 1)
        for p, q in zip(sp.points, pts):
            p.co = (q.x, q.y, q.z, 1.0)
        so = bpy.data.objects.new("Stem", cv)
        link(so)
        cv.materials.append(stem_mat)
        for k in range(2, 8):
            t = k / 7
            size = (1.0 - t * 0.6) * r.uniform(0.85, 1.2)
            for side in (-1, 1):
                ang = a + math.radians(90) * side + r.uniform(-0.4, 0.4) + k * 0.9
                lo = bpy.data.objects.new("Leaf", lm)
                link(lo)
                lo.location = pts[k]
                # leaf points outward and up: rotate about z by ang, tilt (pitch) up from horizontal
                pitch = math.radians(r.uniform(-15, 35)) - 0.0
                lo.rotation_euler = Euler((math.radians(90) - pitch - math.radians(r.uniform(0, 20)), 0, ang - math.pi / 2), "XYZ")
                lo.scale = (size,) * 3
                nleaves += 1
        # top bud: two small leaves
        for side in (-1, 1):
            lo = bpy.data.objects.new("Leaf", lm)
            link(lo)
            lo.location = pts[-1]
            lo.rotation_euler = Euler((math.radians(40), 0, a + side * 1.2), "XYZ")
            lo.scale = (0.45,) * 3
    return pot


def build_bottle(x, y, z):
    """Small glass oil bottle with olive oil, on the sill."""
    prof = [(0.0, 0.0), (0.03, 0.0), (0.034, 0.004), (0.036, 0.04), (0.035, 0.1), (0.028, 0.13), (0.013, 0.15), (0.0125, 0.19),
            (0.0145, 0.196), (0.0145, 0.2), (0.0115, 0.2), (0.0105, 0.19), (0.0105, 0.15), (0.0255, 0.128), (0.031, 0.1), (0.0325, 0.04), (0.0305, 0.01), (0.0, 0.01)]
    bm = revolve(prof, 48)
    gm = bpy.data.materials.new("BottleGlass")
    gm.use_nodes = True
    n = gm.node_tree.nodes
    n.clear()
    out = n.new("ShaderNodeOutputMaterial")
    gl = n.new("ShaderNodeBsdfGlass")
    gl.inputs["Color"].default_value = (0.55, 0.78, 0.35, 1.0)
    gl.inputs["IOR"].default_value = 1.5
    gl.inputs["Roughness"].default_value = 0.01
    ls = n.new("ShaderNodeLightPath")
    tr = n.new("ShaderNodeBsdfTransparent")
    tr.inputs["Color"].default_value = (0.75, 0.9, 0.5, 1.0)
    mx = n.new("ShaderNodeMixShader")
    gm.node_tree.links.new(ls.outputs["Is Shadow Ray"], mx.inputs["Fac"])
    gm.node_tree.links.new(gl.outputs[0], mx.inputs[1])
    gm.node_tree.links.new(tr.outputs[0], mx.inputs[2])
    gm.node_tree.links.new(mx.outputs[0], out.inputs["Surface"])
    b = mesh_obj("Bottle", bm, gm, loc=(x, y, z), smooth=True, subsurf=1)
    reg(b, "Sill", "rest")
    return b


def build_motes(n=260):
    r = random.Random(99)
    me = bpy.data.meshes.new("MoteMesh")
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat["mote"])
    motes = []
    for i in range(n):
        o = bpy.data.objects.new("Mote", me)
        link(o)
        p = Vector((r.uniform(-0.5, 1.1), r.uniform(1.0, 1.95), r.uniform(0.85, 2.0)))
        s = r.uniform(0.0010, 0.0026)
        o.scale = (s, s, s)
        o.location = p
        o.keyframe_insert("location", frame=1)
        drift = Vector((r.uniform(-0.12, 0.12), r.uniform(-0.1, 0.1), r.uniform(-0.22, 0.05)))
        o.location = p + drift
        o.keyframe_insert("location", frame=300)
        for fc in o.animation_data.action.fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = "LINEAR"
            m = fc.modifiers.new("NOISE")
            m.scale = r.uniform(30, 70)
            m.strength = r.uniform(0.01, 0.035)
            m.phase = r.uniform(0, 100)
        o.visible_shadow = False
        o["is_mote"] = 1
        motes.append(o)
    return motes



def build_shelf():
    sx0, sx1, sy0, sy1, sz = -1.18, -0.62, 1.76, 1.97, 1.45
    sh = mesh_obj("Shelf", box_bm(sx0, sx1, sy0, sy1, sz, sz + 0.03, cuts=1, jitter=0.0008), mat["oak_dark"], smooth=False, bevel=0.006, bevel_seg=2)
    for bx in (sx0 + 0.06, sx1 - 0.06):
        bm = bmesh.new()
        pts = [(sy1, sz), (sy1 - 0.17, sz), (sy1, sz - 0.17)]
        vs = [bm.verts.new((bx - 0.012, y, z)) for y, z in pts] + [bm.verts.new((bx + 0.012, y, z)) for y, z in pts]
        bm.faces.new(vs[0:3]); bm.faces.new(vs[3:6][::-1])
        for a, b in ((0, 1), (1, 2), (2, 0)):
            bm.faces.new((vs[a], vs[b], vs[b + 3], vs[a + 3]))
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        mesh_obj("Bracket", bm, mat["steel"], smooth=False, bevel=0.002)
    jars = [(-1.04, 1.86, 0.062, 0.17, (0.62, 0.66, 0.62), (0.22, 0.30, 0.30)),
            (-0.88, 1.87, 0.048, 0.12, (0.84, 0.80, 0.70), (0.45, 0.32, 0.20)),
            (-0.74, 1.85, 0.055, 0.145, (0.30, 0.40, 0.45), (0.12, 0.18, 0.24))]
    top = sz + 0.03
    for (x, y, r, h, c1, c2) in jars:
        prof = [(0.0, 0.0), (r * 0.8, 0.0), (r * 0.96, 0.006), (r, h * 0.35), (r * 0.97, h * 0.8), (r * 0.7, h * 0.92), (r * 0.55, h * 0.96), (r * 0.55, h), (r * 0.5, h), (r * 0.5, h * 0.9), (0.0, h * 0.9)]
        jo = mesh_obj("Jar", revolve(prof, 48), M.ceramic("Jar", c1, c2), loc=(x, y, top), smooth=True, subsurf=1)
        reg(jo, "Shelf", "rest")
        lid = mesh_obj("Cork", revolve([(0, 0), (r * 0.5, 0), (r * 0.5, 0.02), (0, 0.02)], 32), mat["maple"], loc=(x, y, top + h - 0.004), smooth=False)
    return sh



def build_lemons():
    """Two lemons on the table: tapered ellipsoids with a nipple, dimpled rind (voronoi bump), subsurface."""
    for (x, y, rot, s) in ((0.02, 1.62, 40, 1.0), (0.10, 1.70, -20, 0.92)):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=32, radius=1.0)
        for v in bm.verts:
            u = v.co.x
            taper = 1.0 - 0.28 * abs(u) ** 2
            v.co = Vector((u * 0.048, v.co.y * 0.034 * taper, v.co.z * 0.034 * taper))
            if abs(u) > 0.96:
                v.co.x += math.copysign(0.004, u) * (abs(u) - 0.96) / 0.04
        o = mesh_obj("Lemon", bm, mat["lemon"], loc=(x, y, TZ + 0.0011 + 0.034 * s * 0.98), smooth=True)
        o.scale = (s,) * 3
        o.rotation_euler = (0, 0, math.radians(rot))
        reg(o, "Plank*", "rest")


def build_exterior():
    """Soft spring garden seen through the window: ground, a hedge line, blossom trees. Heavily out of focus, so form not detail."""
    gm = M.grass()
    bm = grid_bm(80, 60, 40, 30, 0.0)
    for v in bm.verts:
        v.co += Vector((0, 0, 0))
    g = mesh_obj("Ground", bm, gm, loc=(0, 22, 0.0))
    # wall of a neighbouring barn and trees
    tm = M.simple("Foliage", (0.12, 0.28, 0.05), 0.8)
    bl = M.simple("Blossom", (0.95, 0.85, 0.88), 0.7)
    r = random.Random(3)
    for i in range(14):
        x = r.uniform(-14, 14)
        y = r.uniform(7, 22)
        s = r.uniform(1.2, 2.6)
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=3, radius=s)
        for v in bm.verts:
            v.co *= 1.0 + noise.noise(v.co * 0.9) * 0.35
        o = mesh_obj("Tree", bm, bl if i % 6 == 0 else tm, loc=(x, y, s * 0.9 + 1.2), smooth=True)
        tb = box_bm(-0.12, 0.12, -0.12, 0.12, 0.0, 1.3)
        mesh_obj("Trunk", tb, M.simple("Bark", (0.15, 0.1, 0.07), 0.9), loc=(x, y, 0), smooth=False)
    # a low garden wall close to the window, a pale blur
    sb = box_bm(-4, 4, 3.6, 4.0, 0.0, 0.7)
    mesh_obj("GardenWall", sb, mat["stone_dark"], smooth=False)


def build_viewport_proxy():
    """Plain grey 'viewport' look: used only in --mode viewport. Camera pyramid proxy drawn as a mesh."""
    pass


# ------------------------------------------------------------------ build
mat["oak_y"] = M.wood("OakTableY", (0.38, 0.23, 0.115), (0.14, 0.075, 0.032), grain_axis=1, wear=0.9, gloss=0.5)
sill = build_room()
build_table()
runner = build_runner()
reg(runner, "Plank*", "rest")
board, loaf = build_board_and_bread()
build_mug(0.22, 1.47)
build_basil(-0.20, 2.13, WZ0)
build_bottle(0.27, 2.17, WZ0)
build_shelf()
build_lemons()
motes = build_motes(170)
build_exterior()

# room air volume, a little inside the walls
vb = box_bm(X0 + 0.02, X1 - 0.02, YF + 0.02, YB - 0.001, 0.01, Z1 - 0.02)
mesh_obj("Air", vb, mat["air"], smooth=False)
sb_ = box_bm(-0.5, 0.5, -0.5, 0.5, -0.5, 0.5)
shaft = mesh_obj("Shaft", sb_, mat["shaft"], loc=(0.25, 1.55, 1.45), smooth=False)
shaft.scale = (2.2, 1.9, 1.4)

# ------------------------------------------------------------------ light, camera
SUN_DIR = (0.26, -1.0, -0.37)
if A.mode == "final":
    rig.world_sky(sun_elev_deg=20.0, sun_rot_deg=float(os.environ.get("SUNROT", "0")), strength=1.4)
    rig.sun(SUN_DIR, strength=float(os.environ.get("SUNSTR", "6.5")), color=(1.0, 0.76, 0.52), angle_deg=1.1)
    rig.area("Portal", (0, YB + 0.55, 1.55), 1.2, 1, target=(0, 0, 1.4), portal=True, size_y=1.3)
    rig.area("Fill", (1.5, -1.3, 1.9), 2.0, 4.0, color=(0.6, 0.72, 1.0), target=(0.0, 1.6, 0.8))

cam = rig.camera(lens=50.0, fstop=2.4)
tgt = rig.empty("Target", (0.16, 1.55, 0.86))
focus = rig.empty("Focus", (0.33, 1.42, 0.84))
cam.data.dof.focus_object = focus
trk = cam.constraints.new("TRACK_TO")
trk.target = tgt
trk.track_axis = "TRACK_NEGATIVE_Z"
trk.up_axis = "UP_Y"
F0, F1 = 1, 240
rig.key(cam, F0, (0.95, 0.38, 1.30))
rig.key(cam, F1, (0.66, 0.90, 1.07))
rig.key(tgt, F0, (0.12, 1.55, 0.90))
rig.key(tgt, 125, (0.16, 1.52, 0.90))
rig.key(tgt, F1, (0.20, 1.50, 0.91))
rig.key(focus, F0, (-0.20, 1.55, 0.84))   # loaf
rig.key(focus, 65, (-0.20, 1.55, 0.84))
rig.key(focus, 140, (0.22, 1.47, 0.86))  # mug and steam
rig.key(focus, F1, (0.22, 1.47, 0.89))
for o in (cam, tgt, focus):
    rig.smooth_fcurves(o, noise=0.004 if o is cam else 0.0015, noise_scale=55, seed=3)
SC.frame_start, SC.frame_end = F0, F1

if A.cam:
    a, b = A.cam.split(":")
    cam.animation_data_clear()
    cam.location = Vector([float(v) for v in a.split(",")])
    tgt.animation_data_clear()
    tgt.location = Vector([float(v) for v in b.split(",")])

W, H = (int(v) for v in A.res.split("x"))
if A.mode == "final":
    rig.render_setup((W, H), A.samples, exposure=A.exposure, device=A.device)
    rig.compositor()
else:
    # workbench "viewport" look of the rough scene: single grey, studio light, cavity
    SC.render.engine = "BLENDER_WORKBENCH"
    SC.render.resolution_x, SC.render.resolution_y = W, H
    sh = SC.display.shading
    sh.light = "STUDIO"
    sh.color_type = "OBJECT"
    sh.show_cavity = True
    sh.cavity_type = "BOTH"
    sh.show_shadows = True
    sh.shadow_intensity = 0.35
    sh.background_type = "VIEWPORT"
    sh.background_color = (0.24, 0.24, 0.25)
    SC.view_settings.view_transform = "Standard"
    for o in bpy.data.objects:
        if o.type in ("MESH", "CURVE"):
            o.color = (0.66, 0.66, 0.66, 1.0)
        if (o.get("is_mote") or o.name in ("Air", "Shaft", "Steam", "Glass", "Ground", "WallF", "WallE", "Ceiling")
                or o.name.startswith(("Tree", "Trunk", "Crumb", "Beam", "Leaf", "Stem"))):
            o.hide_render = True
    # orbiting overview camera + a small camera-frustum proxy that follows the real shot camera
    ov = bpy.data.objects.new("OverCam", bpy.data.cameras.new("OverCam"))
    ov.data.lens = 32
    link(ov)
    tg = rig.empty("OverTarget", (0.0, 1.3, 0.95))
    tc_ = ov.constraints.new("TRACK_TO")
    tc_.target = tg
    tc_.track_axis = "TRACK_NEGATIVE_Z"
    tc_.up_axis = "UP_Y"
    rig.key(ov, 1, (3.3, -1.55, 2.45))
    rig.key(ov, F1, (2.6, -1.9, 2.2))
    rig.smooth_fcurves(ov)
    SC.camera = ov
    pb = bmesh.new()
    ap_ = pb.verts.new((0, 0, 0))
    cs = [pb.verts.new((x, y, -0.12)) for x, y in ((-0.075, -0.05), (0.075, -0.05), (0.075, 0.05), (-0.075, 0.05))]
    for i in range(4):
        pb.faces.new((ap_, cs[i], cs[(i + 1) % 4]))
    pb.faces.new(cs[::-1])
    bmesh.ops.recalc_face_normals(pb, faces=list(pb.faces))
    proxy = mesh_obj("CamProxy", pb, None, smooth=False)
    proxy.color = (0.95, 0.5, 0.1, 1.0)
    cp = proxy.constraints.new("COPY_TRANSFORMS")
    cp.target = cam
    SC.render.image_settings.file_format = "PNG"

SC.render.image_settings.color_mode = "RGB"

if A.qa:
    import qa
    qa.check(REG)
elif A.save:
    bpy.ops.wm.save_as_mainfile(filepath=A.save)
    print("SAVED", A.save)
elif A.anim:
    SC.frame_start, SC.frame_end = A.anim
    SC.render.filepath = A.out
    SC.render.use_overwrite = False
    SC.render.use_placeholder = True
    bpy.ops.render.render(animation=True)
else:
    SC.frame_set(A.frame)
    SC.render.filepath = A.out
    bpy.ops.render.render(write_still=True)
