"""
Review renders of the rugs (Cycles, CPU only, low samples + denoise):

    CUDA_VISIBLE_DEVICES= nice -n 10 blender -b --factory-startup -t 6 --python-exit-code 1 \
        -P scripts/assets/rugs/blender_render.py -- <work-dir> <out-dir> sheet|closeup|thumbs|hall [args]

- sheet:   all thirteen rugs laid out flat in two rows, seen from above at an angle
- closeup: one rug (arg: id) at a grazing angle: knots, pile and fringe
- thumbs:  192 px library thumbnails of every asset (`<work>/<id>.thumb.png`)
- hall:    the exhibition hall from a world dump (scripts/assets/rugs/world-dump.ts) plus the asset entities (args: dump
           dir, world json, camera 'top' | 'eye' | 'eye2' | 'lobby')
"""
import json
import math
import os
import struct
import sys

import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from specs import FURNITURE, RUGS  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:]
WORK, OUT, MODE = os.path.abspath(argv[0]), os.path.abspath(argv[1]), argv[2]
ARGS = argv[3:]
os.makedirs(OUT, exist_ok=True)


def setup(res=(1600, 1000), samples=24):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.threads_mode = 'FIXED'
    sc.render.threads = 6
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Base Contrast'
    w = bpy.data.worlds.new('w')
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.55, 0.57, 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.35
    sc.world = w
    return sc


def import_glb(path, loc=(0, 0, 0), rot_gltf=(0, 0, 0), scale=(1, 1, 1)):
    """Import a GLB and place it with a glTF-frame (Y up) transform given in metres / Euler XYZ degrees."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    root = bpy.data.objects.new('root', None)
    bpy.context.scene.collection.objects.link(root)
    for o in new:
        if o.parent is None:
            o.parent = root
    # glTF (x, y, z) -> Blender (x, -z, y); rotations: conjugate by the axis change
    q = Euler([math.radians(a) for a in rot_gltf], 'XYZ').to_quaternion()
    C = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))
    R = C @ q.to_matrix() @ C.transposed()
    S = Matrix.Diagonal((scale[0], scale[2], scale[1]))
    root.matrix_world = Matrix.Translation((loc[0], -loc[2], loc[1])) @ R.to_4x4() @ S.to_4x4()
    return root, new


def floor(size=40, colour=(0.42, 0.40, 0.37)):
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, -0.001))
    p = bpy.context.active_object
    m = bpy.data.materials.new('floor')
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*colour, 1)
    m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.8
    p.data.materials.append(m)


def area(loc, rot, size, power, colour=(1, 0.95, 0.88)):
    l = bpy.data.lights.new('a', 'AREA')
    l.size = size
    l.energy = power
    l.color = colour
    o = bpy.data.objects.new('a', l)
    o.location = loc
    o.rotation_euler = rot
    bpy.context.scene.collection.objects.link(o)


def sun(rot, strength, colour=(1, 0.96, 0.9)):
    l = bpy.data.lights.new('s', 'SUN')
    l.energy = strength
    l.color = colour
    l.angle = math.radians(8)
    o = bpy.data.objects.new('s', l)
    o.rotation_euler = rot
    bpy.context.scene.collection.objects.link(o)


def camera(loc, look_at, lens=35, ortho=None):
    c = bpy.data.cameras.new('c')
    c.lens = lens
    c.clip_end = 300
    if ortho:
        c.type = 'ORTHO'
        c.ortho_scale = ortho
    o = bpy.data.objects.new('c', c)
    o.location = loc
    d = Vector(look_at) - Vector(loc)
    o.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.collection.objects.link(o)
    bpy.context.scene.camera = o


def render(name):
    sc = bpy.context.scene
    sc.render.filepath = os.path.join(OUT, name)
    sc.render.image_settings.file_format = 'PNG'
    bpy.ops.render.render(write_still=True)
    print('wrote', sc.render.filepath, flush=True)


def label(text, loc, size=0.16):
    bpy.ops.object.text_add(location=loc)
    t = bpy.context.active_object
    t.data.body = text
    t.data.size = size
    t.data.align_x = 'CENTER'
    m = bpy.data.materials.new('lbl')
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.92, 0.92, 0.9, 1)
    t.data.materials.append(m)


if MODE == 'sheet':
    setup((2400, 1500), 32)
    floor()
    x = 0.0
    rows = [RUGS[:7], RUGS[7:]]
    for r, row in enumerate(rows):
        x = -sum(s[3] / 100 + 0.35 for s in row) / 2
        for s in row:
            w, l = s[3] / 100, s[4] / 100
            cx = x + w / 2
            cz = (r - 0.5) * 4.0
            import_glb(os.path.join(WORK, f'{s[0]}.glb'), (cx, 0, cz))
            label(s[0].replace('rug-', ''), (cx, -cz - 1.85, 0.002))
            x += w + 0.35
    sun((math.radians(35), math.radians(10), math.radians(30)), 2.2)
    area((0, -6, 9), (math.radians(30), 0, 0), 10, 1800)
    camera((0, -7.2, 9.2), (0, -0.25, 0), 30)
    render('contact-sheet.png')

elif MODE == 'closeup':
    rid = ARGS[0] if ARGS else 'rug-kashan-heirloom'
    setup((1600, 1000), 48)
    floor(colour=(0.35, 0.3, 0.26))
    s = next(s for s in RUGS if s[0] == rid)
    import_glb(os.path.join(WORK, f'{rid}.glb'), (0, 0, 0))
    w, l = s[3] / 100, s[4] / 100
    sun((math.radians(62), 0, math.radians(-40)), 3.0)
    area((-1, 1.5, 1.5), (math.radians(-50), 0, 0), 2, 120)
    corner = (-w / 2 + 0.25, l / 2 - 0.2, 0)
    camera((corner[0] + 0.45, corner[1] - 0.75, 0.38), (corner[0] - 0.05, corner[1] + 0.1, 0.0), 50)
    render(f'closeup-{rid}.png')
    camera((0.15, -0.25, 0.42), (0, 0, 0), 50)
    render(f'closeup-centre-{rid}.png')

elif MODE == 'thumbs':
    for aid in [s[0] for s in RUGS] + [f[0] for f in FURNITURE]:
        setup((384, 384), 24)
        sc = bpy.context.scene
        sc.render.film_transparent = True
        root, objs = import_glb(os.path.join(WORK, f'{aid}.glb'))
        info = json.load(open(os.path.join(WORK, f'{aid}.build.json')))
        sx, sy, sz = info['size']
        r = max(sx, sy, sz)
        sun((math.radians(40), math.radians(10), math.radians(35)), 3.0)
        area((0, -2 * r, 2 * r), (math.radians(45), 0, 0), r * 2, 60 * r * r)
        if aid.startswith('rug'):
            camera((0, -r * 1.05, r * 1.45), (0, 0, 0), 50)
        else:
            camera((r * 0.9, -r * 1.2, r * 0.75 + sy * 0.5), (0, 0, sy * 0.45), 50)
        sc.render.filepath = os.path.join(WORK, f'{aid}.thumb.png')
        bpy.ops.render.render(write_still=True)

elif MODE == 'hall':
    dump, world_path, cam = ARGS[0], ARGS[1], ARGS[2]
    setup((1920, 1080), int(ARGS[3]) if len(ARGS) > 3 else 24)
    g = json.load(open(os.path.join(dump, 'geo.json')))
    blob = open(os.path.join(dump, 'geo.bin'), 'rb').read()
    mats = {}

    def mat_for(p):
        key = (p['color'], p['opacity'] < 1, bool(p['emissive']))
        if key in mats:
            return mats[key]
        m = bpy.data.materials.new('m')
        m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']
        h = p['color'].lstrip('#')
        lin = [((int(h[i:i + 2], 16) / 255) ** 2.2) for i in (0, 2, 4)]
        b.inputs['Base Color'].default_value = (*lin, 1)
        b.inputs['Roughness'].default_value = p['rough']
        b.inputs['Metallic'].default_value = p['metal']
        if p['opacity'] < 1:
            b.inputs['Alpha'].default_value = max(0.15, p['opacity'])
        if p['emissive']:
            e = p['emissive'].lstrip('#')
            b.inputs['Emission Color'].default_value = (*[int(e[i:i + 2], 16) / 255 for i in (0, 2, 4)], 1)
            b.inputs['Emission Strength'].default_value = 2.0
        mats[key] = m
        return m

    import numpy as np
    for p in g['parts']:
        o, n = p['pos']
        io, ni = p['idx']
        pos = np.frombuffer(blob, np.float32, n * 3, o).reshape(-1, 3)
        idx = np.frombuffer(blob, np.uint32, ni, io).reshape(-1, 3)
        verts = [(float(x), float(-z), float(y)) for x, y, z in pos]
        me = bpy.data.meshes.new(p['entity'])
        me.from_pydata(verts, [], [tuple(int(i) for i in t) for t in idx])
        me.materials.append(mat_for(p))
        ob = bpy.data.objects.new(p['entity'], me)
        bpy.context.scene.collection.objects.link(ob)
    # primitives (boxes) and asset entities from the world file
    world = json.load(open(world_path))['world']
    lib = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../../assets')
    cat = {e['id']: e for e in json.load(open(os.path.join(lib, 'catalog.json')))['entries']}
    for eid, e in world['entities'].items():
        s = e['shape']
        t = e['transform']
        if s['kind'] == 'primitive' and s.get('primitive') == 'box':
            bpy.ops.mesh.primitive_cube_add(size=1)
            ob = bpy.context.active_object
            sz = s['size']
            q = Euler([math.radians(a) for a in t['rotation']], 'XYZ').to_quaternion()
            C = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))
            R = C @ q.to_matrix() @ C.transposed()
            p = t['position']
            ob.matrix_world = Matrix.Translation((p[0], -p[2], p[1])) @ R.to_4x4() @ Matrix.Diagonal((sz[0], sz[2], sz[1], 1))
            ob.data.materials.append(mat_for({'color': (e.get('material') or {}).get('color', '#e8e4dc'), 'opacity': 1, 'emissive': None, 'rough': 0.8, 'metal': 0}))
        elif s['kind'] == 'asset':
            aid = s['id']
            f = os.path.join(WORK, f'{aid}.glb')
            if not os.path.exists(f) and aid in cat and cat[aid].get('file'):
                f = os.path.join(lib, 'lib', cat[aid]['file'])
            if os.path.exists(f):
                import_glb(f, t['position'], t['rotation'], t['scale'])
            else:
                print('missing asset', aid)
    # lights: the world's point / spot lights as warm area-ish points
    for eid, e in world['entities'].items():
        L = e.get('light')
        if not L:
            continue
        p = e['transform']['position']
        kind = L.get('type', 'point')
        if kind in ('point', 'spot'):
            ld = bpy.data.lights.new(eid, 'POINT')
            ld.energy = min(400.0, L.get('intensity', 1) * 40)
            ld.shadow_soft_size = 0.2
            h = (L.get('color') or '#fff2e0').lstrip('#')
            ld.color = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
            lo = bpy.data.objects.new(eid, ld)
            lo.location = (p[0], -p[2], p[1])
            bpy.context.scene.collection.objects.link(lo)
    sun((math.radians(50), 0, math.radians(30)), 1.0)
    bpy.context.scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6
    if cam == 'top':
        # cut the roof / ceiling away for the plan view
        for ob in list(bpy.data.objects):
            if any(k in ob.name for k in ('roof', 'ceil', 'parapet', 'baffle', 'portico', 'cornice')):
                bpy.data.objects.remove(ob)
        camera((15, -10.2, 40), (15, -10.2, 0), 35, ortho=37.5)
    elif cam == 'eye':
        camera((10.6, -13.9, 1.65), (15, -0.3, 1.9), 22)
    elif cam == 'eye2':
        camera((27.5, -11.5, 1.65), (10, -5.0, 1.2), 24)
    elif cam == 'north':
        camera((15, -7.5, 1.65), (15, 0, 2.1), 20)
    elif cam == 'lobby':
        camera((15, -18.8, 1.65), (24.5, -17.2, 0.7), 24)
    render(f'hall-{cam}{ARGS[4] if len(ARGS) > 4 else ""}.png')
