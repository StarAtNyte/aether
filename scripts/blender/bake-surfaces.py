"""
Tileable PBR surfaces baked by Blender (Cycles) headless: real modelled relief (setts, Roman roof tiles, ashlar blocks, pebbles,
weathered plaster) baked from a high-poly 1 x 1 m tile onto a flat tile, so the normal map, the ambient occlusion and the cavity
dirt come from geometry, not from guessing at a colour image. Every surface is periodic by construction (pieces near an edge are
also placed one tile over, noise is a sum of whole-period sines), so the maps repeat without seams.

  blender -b -P scripts/blender/bake-surfaces.py -- --out <dir> [--size 1024] [--samples 48] [--only cobble,roof-tile]

Writes <dir>/<surface>/{albedo,rough,ao,normal}.png. scripts/blender/pack-surfaces.ts turns them into the studio's texture sets.
Blender is an external tool here (GPL); only the baked images are used.
"""
import argparse
import math
import os
import random
import sys

import bpy
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("--size", type=int, default=1024)
ap.add_argument("--samples", type=int, default=48)
ap.add_argument("--only", default="")
A = ap.parse_args(argv)


# ---------------------------------------------------------------------------------------------------------------------- helpers

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = A.samples
    sc.render.bake.margin = 6
    sc.render.bake.use_selected_to_active = True
    sc.render.bake.cage_extrusion = 0.25
    sc.render.bake.max_ray_distance = 0.5
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    sc.world = world


def periodic_noise(n, seed, octaves=((2, 1.0), (4, 0.5), (8, 0.25), (16, 0.12), (32, 0.06))):
    """A seamless height field in [0, 1]: random-phase sines whose frequencies are whole cycles per tile."""
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:n, 0:n] / n
    h = np.zeros((n, n))
    for f, amp in octaves:
        for _ in range(4):
            kx, ky = rng.integers(-f, f + 1, 2)
            if kx == 0 and ky == 0:
                continue
            h += amp * np.sin(2 * math.pi * (kx * x + ky * y) + rng.uniform(0, 2 * math.pi))
    h -= h.min()
    return h / max(h.max(), 1e-9)


def image_from(arr, name):
    n = arr.shape[0]
    img = bpy.data.images.new(name, n, n, float_buffer=True)
    rgba = np.ones((n, n, 4), dtype=np.float32)
    for c in range(3):
        rgba[:, :, c] = arr
    img.pixels.foreach_set(rgba.ravel())
    img.colorspace_settings.name = "Non-Color"
    return img


def material(name, color_fn, rough=0.8):
    """A material whose base colour is `color_fn(nodes, links) -> socket` and whose roughness is `rough` (float or socket)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    col = color_fn(nt.nodes, nt.links)
    if col is not None:
        nt.links.new(col, bsdf.inputs["Base Color"])
    if isinstance(rough, (int, float)):
        bsdf.inputs["Roughness"].default_value = rough
    else:
        nt.links.new(rough(nt.nodes, nt.links), bsdf.inputs["Roughness"])
    return m


def random_colour(a, b, variance_obj=True):
    """Base colour between `a` and `b` (sRGB tuples) chosen per object (Object Info random), times a fine noise."""
    def build(nodes, links):
        info = nodes.new("ShaderNodeObjectInfo")
        ramp = nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].color = (*srgb_to_lin(a), 1)
        ramp.color_ramp.elements[1].color = (*srgb_to_lin(b), 1)
        links.new(info.outputs["Random"], ramp.inputs["Fac"])
        noise = nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 60
        mul = nodes.new("ShaderNodeMix")
        mul.data_type = "RGBA"
        mul.blend_type = "MULTIPLY"
        mul.inputs["Factor"].default_value = 0.25
        links.new(ramp.outputs["Color"], mul.inputs["A"])
        links.new(noise.outputs["Color"], mul.inputs["B"])
        return mul.outputs["Result"]
    return build


def srgb_to_lin(c):
    return tuple(((v / 255) / 12.92 if v / 255 <= 0.04045 else (((v / 255) + 0.055) / 1.055) ** 2.4) for v in c)


def flat_colour(c):
    def build(nodes, links):
        rgb = nodes.new("ShaderNodeRGB")
        rgb.outputs[0].default_value = (*srgb_to_lin(c), 1)
        return rgb.outputs[0]
    return build


def tiled(obj_fn, x, y, near=0.3):
    """Place a piece at (x, y) in the tile and its copies one tile over when it reaches an edge (seamless tiling)."""
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            px, py = x + dx, y + dy
            if -0.5 - near <= px <= 0.5 + near and -0.5 - near <= py <= 0.5 + near:
                obj_fn(px, py)


def rounded_box(w, d, h, bevel, mat, x, y, z=0.0, rot=0.0, segs=3):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z + h / 2))
    o = bpy.context.object
    o.scale = (w, d, h)
    o.rotation_euler[2] = rot
    bpy.ops.object.transform_apply(scale=True)
    b = o.modifiers.new("bevel", "BEVEL")
    b.width = bevel
    b.segments = segs
    o.data.materials.append(mat)
    return o


def sample(height, x, y):
    """Bilinear, wrapping sample of a periodic height field at tile coordinates (x, y in metres, the tile spans -0.5..0.5)."""
    n = height.shape[0]
    u, v = (x + 0.5) * n, (y + 0.5) * n
    i, j = math.floor(u), math.floor(v)
    fu, fv = u - i, v - j
    a, b = height[j % n, i % n], height[j % n, (i + 1) % n]
    c, d = height[(j + 1) % n, i % n], height[(j + 1) % n, (i + 1) % n]
    return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv


def displace(obj, height, amp):
    """Raise each vertex of `obj` by the periodic field at its world position (a modifier-free displacement)."""
    mw = obj.matrix_world
    for v in obj.data.vertices:
        w = mw @ v.co
        v.co.z += amp * sample(height, w.x, w.y)


def ground(mat, height=None, amp=0.0, res=256):
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 0))
    g = bpy.context.object
    if height is not None and amp > 0:
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.subdivide(number_cuts=res - 1)
        bpy.ops.object.mode_set(mode="OBJECT")
        displace(g, height, amp)
    g.data.materials.append(mat)
    return g


def bake(name, high):
    """Bake the high-poly pieces onto a flat 1 x 1 m tile: albedo (colour only), roughness, AO and tangent normals."""
    n = A.size
    out = os.path.join(A.out, name)
    os.makedirs(out, exist_ok=True)
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 0.0))
    low = bpy.context.object
    low.name = "low"
    m = bpy.data.materials.new("bake")
    m.use_nodes = True
    node = m.node_tree.nodes.new("ShaderNodeTexImage")
    low.data.materials.append(m)
    m.node_tree.nodes.active = node
    sc = bpy.context.scene
    for kind, file, pass_filter, colorspace in (
        ("DIFFUSE", "albedo", {"COLOR"}, "sRGB"),
        ("ROUGHNESS", "rough", None, "Non-Color"),
        ("AO", "ao", None, "Non-Color"),
        ("NORMAL", "normal", None, "Non-Color"),
    ):
        img = bpy.data.images.new(f"{name}-{file}", n, n, alpha=False)
        img.colorspace_settings.name = colorspace
        node.image = img
        bpy.ops.object.select_all(action="DESELECT")
        for o in high:
            o.select_set(True)
        low.select_set(True)
        bpy.context.view_layer.objects.active = low
        if pass_filter:
            sc.render.bake.use_pass_direct = False
            sc.render.bake.use_pass_indirect = False
            sc.render.bake.use_pass_color = True
        bpy.ops.object.bake(type=kind)
        img.filepath_raw = os.path.join(out, f"{file}.png")
        img.file_format = "PNG"
        img.save()
        print("baked", name, file, flush=True)


# ---------------------------------------------------------------------------------------------------------------------- surfaces

def cobble():
    """Granite setts in a grid with jitter, rounded tops, dark joints between them."""
    reset()
    rnd = random.Random(11)
    stone = material("sett", random_colour((122, 118, 112), (168, 160, 150)), rough=0.72)
    joint = material("joint", flat_colour((62, 58, 52)), rough=0.95)
    high = [ground(joint, periodic_noise(64, 3), 0.004, 64)]
    k, cell = 6, 1 / 6
    for i in range(k):
        for j in range(k):
            x = -0.5 + (i + 0.5) * cell + rnd.uniform(-0.008, 0.008)
            y = -0.5 + (j + 0.5) * cell + rnd.uniform(-0.008, 0.008)
            w, d, h = cell * rnd.uniform(0.82, 0.9), cell * rnd.uniform(0.82, 0.9), rnd.uniform(0.025, 0.04)
            r = rnd.uniform(-0.08, 0.08)
            tiled(lambda px, py: high.append(rounded_box(w, d, h, 0.012, stone, px, py, 0, r)), x, y)
    bake("cobble", high)


def roof_tile():
    """Roman (barrel) roof tiles: courses of half-cylinders overlapping down the slope, terracotta with per-tile variation."""
    reset()
    rnd = random.Random(5)
    clay = material("clay", random_colour((150, 72, 46), (196, 108, 70)), rough=0.78)
    under = material("under", flat_colour((90, 44, 30)), rough=0.9)
    high = [ground(under)]
    cols, rows = 5, 4
    for i in range(cols):
        for j in range(rows):
            x = -0.5 + (i + 0.5) / cols
            y = -0.5 + (j + 0.5) / rows
            def piece(px, py, j=j):
                bpy.ops.mesh.primitive_cylinder_add(radius=0.5 / cols * 0.92, depth=1 / rows * 1.12, vertices=24, location=(px, py, 0), rotation=(math.pi / 2, 0, 0))
                o = bpy.context.object
                o.scale[2] = 1.0
                o.location[2] = 0.006 * (j % 2)
                o.rotation_euler[0] = math.pi / 2 + 0.06
                o.data.materials.append(clay)
                high.append(o)
            tiled(piece, x, y)
    bake("roof-tile", high)


def limestone():
    """Ashlar: limestone blocks in running bond with bevelled arrises and recessed mortar."""
    reset()
    rnd = random.Random(9)
    block = material("block", random_colour((196, 186, 164), (222, 212, 190)), rough=0.82)
    mortar = material("mortar", flat_colour((168, 160, 142)), rough=0.95)
    high = [ground(mortar)]
    rows, cols = 4, 2
    for j in range(rows):
        for i in range(cols + 1):
            x = -0.5 + (i + (0.5 if j % 2 else 0)) / cols
            y = -0.5 + (j + 0.5) / rows
            h = rnd.uniform(0.014, 0.022)
            tiled(lambda px, py, h=h: high.append(rounded_box(1 / cols - 0.012, 1 / rows - 0.012, h, 0.006, block, px, py)), x, y)
    bake("limestone", high)


def plaster():
    """Weathered lime plaster: a trowelled, lumpy surface with fine pits."""
    reset()
    h = 0.7 * periodic_noise(256, 21) + 0.3 * periodic_noise(256, 22, ((24, 1.0), (48, 0.6), (96, 0.3)))
    mat = material("plaster", flat_colour((232, 226, 214)), rough=0.9)
    high = [ground(mat, h, 0.012, 384)]
    bake("plaster", high)


def regolith():
    """Mars ground: fine dust with scattered pebbles and small stones."""
    reset()
    rnd = random.Random(31)
    dust = material("dust", flat_colour((168, 92, 58)), rough=0.95)
    rock = material("rock", random_colour((96, 52, 38), (150, 86, 60)), rough=0.85)
    high = [ground(dust, periodic_noise(256, 41, ((4, 1.0), (8, 0.5), (16, 0.3), (48, 0.15), (96, 0.08))), 0.03, 256)]
    for _ in range(70):
        x, y, s = rnd.uniform(-0.5, 0.5), rnd.uniform(-0.5, 0.5), rnd.uniform(0.008, 0.035)
        def pebble(px, py, s=s):
            bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=s, location=(px, py, s * 0.35))
            o = bpy.context.object
            o.scale = (1, rnd.uniform(0.6, 1), rnd.uniform(0.4, 0.7))
            o.data.materials.append(rock)
            high.append(o)
        tiled(pebble, x, y, 0.05)
    bake("regolith", high)


def concrete():
    """Cast concrete pads: panels with tooled joints, pores and faint shuttering marks."""
    reset()
    h = 0.6 * periodic_noise(256, 51, ((16, 1.0), (32, 0.5), (64, 0.3))) + 0.4 * periodic_noise(256, 52, ((2, 1.0), (4, 0.4)))
    slab = material("slab", flat_colour((178, 172, 162)), rough=0.85)
    joint = material("joint", flat_colour((120, 116, 108)), rough=0.95)
    high = [ground(joint)]
    for i in range(2):
        for j in range(2):
            x, y = -0.25 + i * 0.5, -0.25 + j * 0.5
            def panel(px, py):
                bpy.ops.mesh.primitive_plane_add(size=0.49, location=(px, py, 0.004))
                o = bpy.context.object
                bpy.ops.object.mode_set(mode="EDIT")
                bpy.ops.mesh.subdivide(number_cuts=95)
                bpy.ops.object.mode_set(mode="OBJECT")
                displace(o, h, 0.003)
                o.data.materials.append(slab)
                high.append(o)
            tiled(panel, x, y, 0.0)
    bake("concrete", high)


SURFACES = {"cobble": cobble, "roof-tile": roof_tile, "limestone": limestone, "plaster": plaster, "regolith": regolith, "concrete": concrete}
only = [s for s in A.only.split(",") if s and s in SURFACES] if A.only else list(SURFACES)
for name in only:
    SURFACES[name]()
print("done", flush=True)
