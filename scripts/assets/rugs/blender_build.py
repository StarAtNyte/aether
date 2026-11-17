"""
Blender (headless, CPU) build of the rug and display-furniture GLBs from the textures made by textures.py.

    CUDA_VISIBLE_DEVICES= nice -n 10 blender -b --factory-startup -t 6 --python-exit-code 1 \
        -P scripts/assets/rugs/blender_build.py -- <work-dir> [id ...]

Writes `<work>/<id>.glb` (full textures), `<work>/<id>.lite.glb` (512 px textures, for the low quality tiers) and
`<work>/<id>.build.json` (size in metres, triangles). Library frame: metres, Y up, base on y = 0, centred on X / Z.
Rugs lie flat with their width along X and their length along Z; the top of the design (image row 0) is at -Z, so a
rug hung with local +Z pointing down reads upright and its fringe (wall rugs: bottom only) hangs at the bottom.
"""
import json
import math
import os
import random
import zlib
import sys

import bmesh
import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from specs import FURNITURE, RUGS  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
WORK = os.path.abspath(argv[0])
WANT = set(argv[1:])


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def load_image(path, colour=True):
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = 'sRGB' if colour else 'Non-Color'
    return img


def material(name, color_img=None, normal_img=None, normal_repeat=(1, 1), rough=0.9, rough_img=None, alpha=False, normal_strength=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Specular IOR Level'].default_value = 0.35
    if color_img is not None:
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = color_img
        tex.interpolation = 'Linear'
        nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        if alpha:
            # glTF alphaMode MASK (cutoff 0.5): the exporter reads a Round node on the alpha
            rnd = nt.nodes.new('ShaderNodeMath')
            rnd.operation = 'ROUND'
            nt.links.new(tex.outputs['Alpha'], rnd.inputs[0])
            nt.links.new(rnd.outputs[0], bsdf.inputs['Alpha'])
            m.use_backface_culling = False
    if not alpha:
        m.use_backface_culling = True
    if normal_img is not None:
        uv = nt.nodes.new('ShaderNodeUVMap')
        mp = nt.nodes.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = (normal_repeat[0], normal_repeat[1], 1)
        nt.links.new(uv.outputs['UV'], mp.inputs['Vector'])
        ntex = nt.nodes.new('ShaderNodeTexImage')
        ntex.image = normal_img
        ntex.extension = 'REPEAT'
        nt.links.new(mp.outputs['Vector'], ntex.inputs['Vector'])
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nm.inputs['Strength'].default_value = normal_strength
        nt.links.new(ntex.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    if rough_img is not None:
        rt = nt.nodes.new('ShaderNodeTexImage')
        rt.image = rough_img
        nt.links.new(rt.outputs['Color'], bsdf.inputs['Roughness'])
    return m


def obj_from_bmesh(name, bm, mat):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = True
    return ob


# ---------------------------------------------------------------------------------------------------------------
# Rugs
# ---------------------------------------------------------------------------------------------------------------

def rug_slab(name, W, L, t, mat, undulate, seed):
    """Grid -> solidify -> rim bevel; gentle undulation for floor rugs. Blender frame: X width, Y length, Z up."""
    nx, ny = (max(6, round(W / 0.075)), max(8, round(L / 0.075))) if undulate else (max(4, round(W / 0.2)), max(4, round(L / 0.2)))
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=nx, y_subdivisions=ny, size=1, calc_uvs=True)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = (W, L, 1)
    bpy.ops.object.transform_apply(scale=True)
    ob.data.materials.append(mat)
    so = ob.modifiers.new('solid', 'SOLIDIFY')
    so.thickness = t
    so.offset = 1.0
    so.use_rim = True
    so.use_even_offset = True
    bv = ob.modifiers.new('bevel', 'BEVEL')
    bv.width = t * 0.42
    bv.segments = 3
    bv.limit_method = 'ANGLE'
    bv.angle_limit = math.radians(60)
    bv.harden_normals = False
    bpy.ops.object.modifier_apply(modifier='solid')
    bpy.ops.object.modifier_apply(modifier='bevel')
    if undulate:
        rnd = random.Random(seed)
        waves = [(rnd.uniform(0.6, 1.4), rnd.uniform(0.6, 1.4), rnd.uniform(0, 6.28), rnd.uniform(0.0012, 0.0022)) for _ in range(3)]
        for v in ob.data.vertices:
            x, y, z = v.co
            u, w = x / W + 0.5, y / L + 0.5
            h = 0.0
            for fx, fy, ph, a in waves:
                h += a * (0.5 + 0.5 * math.sin(fx * u * 6.28 + fy * w * 4.0 + ph))
            # corners curl up a little, like a rug that has lived rolled
            cu = max(0.0, 1 - min(u, 1 - u) / 0.08) * max(0.0, 1 - min(w, 1 - w) / 0.08)
            h += 0.006 * cu ** 2
            v.co.z = z + h
        zmin = min(v.co.z for v in ob.data.vertices)
        for v in ob.data.vertices:
            v.co.z -= zmin
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def fringe(name, W, L, t, mat, ends, seed, flat=True):
    """Alpha-card fringes: the warps leave the rug mid-thickness and lie down onto the surface (or hang, on a wall)."""
    rnd = random.Random(seed)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    Lf = 0.075
    tile = 0.16  # metres of fringe per texture repeat
    nx, nl = max(4, round(W / 0.05)), 5
    for end in ends:  # +1: Blender +Y (top of the design), -1: -Y (bottom)
        y0 = end * (L / 2 - 0.004)
        grid = []
        for j in range(nl + 1):
            f = j / nl
            row = []
            for i in range(nx + 1):
                x = (i / nx - 0.5) * (W - 0.01)
                y = y0 + end * f * Lf * (1 + 0.15 * math.sin(x * 9 + seed + j * 0.3) * f)
                z = (t * 0.45) * max(0.0, 1 - f * 4) + 0.0012 + (0.0008 * rnd.random() * f if flat else 0)
                row.append(bm.verts.new((x, y, z)))
            grid.append(row)
        for j in range(nl):
            for i in range(nx):
                vs = (grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i])
                if end < 0:
                    vs = vs[::-1]
                face = bm.faces.new(vs)
                for loop in face.loops:
                    co = loop.vert.co
                    fpos = abs(co.y - y0) / Lf
                    loop[uvl].uv = ((co.x + W / 2) / tile, 1.0 - min(1.0, fpos))
    return obj_from_bmesh(name, bm, mat)


def build_rug(spec):
    rid, design, _name, wcm, lcm, t, fr, mount = spec
    meta = json.load(open(os.path.join(WORK, f'{rid}.json')))
    reset()
    W, L = wcm / 100.0, lcm / 100.0
    col = load_image(os.path.join(WORK, f'{rid}.color.png'))
    nrm = load_image(os.path.join(WORK, f'{rid}.normal.png'), False)
    rough_img = load_image(os.path.join(WORK, f'{rid}.rough.png'), False) if meta.get('rough') else None
    mat = material(f'{rid}-wool', col, nrm, meta['normalRepeat'], 0.9, rough_img, normal_strength=0.9 if meta['kind'] != 'weave' else 0.7)
    slab = rug_slab(rid, W, L, t, mat, mount == 'floor', zlib.crc32(rid.encode()) % 1000)
    objs = [slab]
    if fr:
        fimg = load_image(os.path.join(WORK, f'{rid}.fringe.png'))
        fmat = material(f'{rid}-fringe', fimg, None, rough=0.85, alpha=True)
        ends = (1, -1) if fr == 'both' else (-1,)
        objs.append(fringe(f'{rid}-fringe', W, L, t, fmat, ends, 7, mount == 'floor'))
    return export(rid, objs, [col, nrm] + ([rough_img] if rough_img else []), {'kind': 'rug', 'design': design, 'mount': mount})


# ---------------------------------------------------------------------------------------------------------------
# Display furniture
# ---------------------------------------------------------------------------------------------------------------

def box(bm, x0, y0, z0, x1, y1, z1, taper=0.0):
    """A box (optionally tapering in x / y towards z0) in a bmesh."""
    vs = []
    for z in (z0, z1):
        k = taper if z == z0 else 0.0
        for x, y in ((x0 + k, y0 + k), (x1 - k, y0 + k), (x1 - k, y1 - k), (x0 + k, y1 - k)):
            vs.append(bm.verts.new((x, y, z)))
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    out = [bm.faces.new([vs[i] for i in f]) for f in faces]
    return out


def bevel_all(bm, width, segments=2, faces=None):
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    edges = [e for e in bm.edges if (faces is None or any(f in faces for f in e.link_faces))]
    bmesh.ops.bevel(bm, geom=edges, offset=width, segments=segments, profile=0.5, affect='EDGES', clamp_overlap=True)


def wood_uv(bm, tile_u, tile_v, grain):
    """Box projection in metres; the grain (texture V) runs along `grain` ('x', 'y' or 'z')."""
    uvl = bm.loops.layers.uv.get('UVMap') or bm.loops.layers.uv.new('UVMap')
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for loop in f.loops:
            c = loop.vert.co
            plane = [i for i in range(3) if i != ax]
            g = 'xyz'.index(grain)
            if g in plane:
                vi = g
                ui = [i for i in plane if i != g][0]
            else:
                ui, vi = plane
            loop[uvl].uv = (c[ui] / tile_u + 0.37 * ax, c[vi] / tile_v + 0.21 * ax)


def build_table():
    reset()
    W, H, D = 1.0, 0.75, 3.3  # Blender: X width, Y length (glTF Z), Z up
    oak = material('oak', load_image(os.path.join(WORK, 'oak-light.color.png')), load_image(os.path.join(WORK, 'oak-light.normal.png'), False), (1, 1), 0.55, normal_strength=0.6)
    # top: 40 mm slab, chamfered underside
    bm = bmesh.new()
    box(bm, -W / 2, -D / 2, H - 0.04, W / 2, D / 2, H)
    bevel_all(bm, 0.004, 2)
    bm.normal_update()
    wood_uv(bm, 0.6, 1.2, 'y')
    top = obj_from_bmesh('table-top', bm, oak)
    # legs: tapered square legs, 58 mm under the top to 38 mm at the floor; apron rails
    bm = bmesh.new()
    inx, iny = W / 2 - 0.09, D / 2 - 0.16
    for sx in (-1, 1):
        for sy in (-1, 1):
            cx, cy = sx * inx, sy * iny
            box(bm, cx - 0.029, cy - 0.029, 0.0, cx + 0.029, cy + 0.029, H - 0.04, taper=0.010)
    for sx in (-1, 1):
        box(bm, sx * inx - 0.011, -iny + 0.029, H - 0.04 - 0.09, sx * inx + 0.011, iny - 0.029, H - 0.04)
    for sy in (-1, 1):
        box(bm, -inx + 0.029, sy * iny - 0.011, H - 0.04 - 0.09, inx - 0.029, sy * iny + 0.011, H - 0.04)
    bevel_all(bm, 0.0025, 1)
    bm.normal_update()
    wood_uv(bm, 0.6, 1.2, 'z')
    legs = obj_from_bmesh('table-base', bm, oak)
    return export('display-table-oak', [top, legs], [], {'kind': 'furniture'})


def build_plinth():
    reset()
    W, H, D = 3.1, 0.4, 2.4  # Blender: X, Y (glTF Z), Z up
    oak = material('oak-top', load_image(os.path.join(WORK, 'oak-light.color.png')), load_image(os.path.join(WORK, 'oak-light.normal.png'), False), (1, 1), 0.6, normal_strength=0.5)
    smoked = material('smoked-oak', load_image(os.path.join(WORK, 'oak-smoked.color.png')), load_image(os.path.join(WORK, 'oak-light.normal.png'), False), (1, 1), 0.5, normal_strength=0.5)
    black = material('plinth-kick', None, None, rough=0.7)
    black.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.02, 0.018, 0.016, 1)
    # top: 30 mm oak with a 10 mm overhang and a softly bevelled edge
    bm = bmesh.new()
    box(bm, -W / 2, -D / 2, H - 0.03, W / 2, D / 2, H)
    bevel_all(bm, 0.006, 3)
    bm.normal_update()
    wood_uv(bm, 0.6, 1.2, 'x')
    top = obj_from_bmesh('plinth-top', bm, oak)
    # body: smoked oak veneer
    bm = bmesh.new()
    box(bm, -W / 2 + 0.01, -D / 2 + 0.01, 0.07, W / 2 - 0.01, D / 2 - 0.01, H - 0.03)
    bevel_all(bm, 0.002, 1)
    bm.normal_update()
    wood_uv(bm, 0.6, 1.2, 'x')
    body = obj_from_bmesh('plinth-body', bm, smoked)
    # recessed toe kick: the plinth seems to float a little
    bm = bmesh.new()
    box(bm, -W / 2 + 0.06, -D / 2 + 0.06, 0.0, W / 2 - 0.06, D / 2 - 0.06, 0.07)
    bm.normal_update()
    kick = obj_from_bmesh('plinth-kick', bm, black)
    return export('display-plinth-oak', [top, body, kick], [], {'kind': 'furniture'})


# ---------------------------------------------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------------------------------------------

def tris_of(objs):
    n = 0
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        me = o.evaluated_get(dg).to_mesh()
        me.calc_loop_triangles()
        n += len(me.loop_triangles)
        o.evaluated_get(dg).to_mesh_clear()
    return n


def bounds(objs):
    lo = [1e9] * 3
    hi = [-1e9] * 3
    for o in objs:
        for v in o.data.vertices:
            c = o.matrix_world @ v.co
            for i in range(3):
                lo[i] = min(lo[i], c[i])
                hi[i] = max(hi[i], c[i])
    return lo, hi


def do_export(path, objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_image_format='WEBP', export_image_quality=90, export_cameras=False, export_lights=False,
                              export_extras=False, export_animations=False)


def export(aid, objs, big_images, extra):
    lo, hi = bounds(objs)
    # base on z = 0 (glTF y), centred on x / y (glTF x / z)
    cx, cy = (lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2
    for o in objs:
        o.location = (o.location[0] - cx, o.location[1] - cy, o.location[2] - lo[2])
    bpy.context.view_layer.update()
    lo, hi = bounds(objs)
    full = os.path.join(WORK, f'{aid}.glb')
    do_export(full, objs)
    # lite: 512 px textures
    for img in bpy.data.images:
        if img.size[0] > 512 or img.size[1] > 512:
            k = 512 / max(img.size)
            img.scale(max(4, round(img.size[0] * k)), max(4, round(img.size[1] * k)))
    lite = os.path.join(WORK, f'{aid}.lite.glb')
    do_export(lite, objs)
    info = dict(extra, id=aid, size=[round(hi[0] - lo[0], 4), round(hi[2] - lo[2], 4), round(hi[1] - lo[1], 4)], tris=tris_of(objs), bytes=os.path.getsize(full), liteBytes=os.path.getsize(lite))
    json.dump(info, open(os.path.join(WORK, f'{aid}.build.json'), 'w'), indent=1)
    print('built', json.dumps(info), flush=True)
    return info


for spec in RUGS:
    if WANT and spec[0] not in WANT:
        continue
    build_rug(spec)
if not WANT or 'display-table-oak' in WANT:
    build_table()
if not WANT or 'display-plinth-oak' in WANT:
    build_plinth()
