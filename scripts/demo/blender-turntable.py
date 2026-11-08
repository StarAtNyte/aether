"""A turntable of a character built by the local Blender harness, for the product film: the build's own .blend, its
atlas through the harness's cel preview material (shading.toon_preview_material) with the inverted-hull outline,
rendered by EEVEE frame by frame as transparent PNGs (the edit lays them on its own backdrop).

  blender -b --factory-startup -P scripts/demo/blender-turntable.py -- --dir <build dir> --id mio --out <frames dir>
          [--frames 180] [--size 1080x1080] [--clip <action name>] [--degrees 360]

  blender -b --factory-startup -P scripts/demo/blender-turntable.py -- --dir <building dir> --id harbour-shop --out <dir>
          --orbit 70 [--start -30] [--frames 210] [--size 1920x1080]
     a building from the kit (scripts/blender/building/build.py), as built: its sky, sun and materials; the camera arcs
     `--orbit` degrees round it, easing in and out, opaque frames.

Note: build the character with "install": false in its brief (a copy of the brief), or the build installs it into the
asset library of this checkout.

The character turns once about its feet (the camera is still, slightly above the eye line, a long lens); with --clip
the armature plays that action (looped) while it turns.
"""
import math
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'blender', 'character'))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import shading  # noqa: E402


def args():
    a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    o = {'frames': '180', 'size': '1080x1080', 'clip': '', 'degrees': '360'}
    for i, k in enumerate(a):
        if k.startswith('--') and i + 1 < len(a):
            o[k[2:]] = a[i + 1]
    return o


A = args()
bpy.ops.wm.open_mainfile(filepath=os.path.join(A['dir'], f"{A['id']}.blend"))
sc = bpy.context.scene

if A.get('orbit'):
    # A building from the kit: its own sky, sun and materials as built; the camera arcs `--orbit` degrees round it.
    meshes = [o for o in sc.objects if o.type == 'MESH' and o.visible_get() and max(o.dimensions) < 60]
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    c = (lo + hi) / 2
    size = max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z)
    w, h = (int(v) for v in A['size'].split('x'))
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = w, h, 100
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'
    cd = bpy.data.cameras.new('orbit')
    cam = bpy.data.objects.new('orbit', cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    cd.lens = 40
    cd.clip_start, cd.clip_end = 0.1, 2000
    n = int(A['frames'])
    a0 = math.radians(float(A.get('start', '-30')))
    span = math.radians(float(A['orbit']))
    tgt = Vector((c.x, c.y, lo.z + (hi.z - lo.z) * 0.5))
    os.makedirs(A['out'], exist_ok=True)
    for i in range(n):
        u = i / max(1, n - 1)
        e = u * u * (3 - 2 * u)
        a = a0 + span * (0.15 * u + 0.85 * e)
        dist = size * (3.0 - 0.35 * e)
        eye = tgt + Vector((math.sin(a) * dist, -math.cos(a) * dist, size * (0.32 - 0.12 * e)))
        cam.location = eye
        cam.rotation_euler = (tgt - eye).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(A['out'], f'f{i:04d}.png')
        bpy.ops.render.render(write_still=True)
    print('orbit done', n)
    raise SystemExit(0)

arm = next(o for o in sc.objects if o.type == 'ARMATURE')
meshes = [o for o in sc.objects if o.type == 'MESH' and o.visible_get()]
body = max(meshes, key=lambda o: len(o.data.vertices))
for o in list(sc.objects):
    if o.type in ('CAMERA', 'LIGHT'):
        bpy.data.objects.remove(o)

# the harness's cel preview: its material on the atlas, the outline, its sun
img = bpy.data.images.load(os.path.join(A['dir'], f"{A['id']}.atlas.png"))
mat = shading.toon_preview_material(img)
body.data.materials.clear()
body.data.materials.append(mat)
if not body.modifiers.get('outline'):
    shading.add_outline(body, width=0.0012)

w, h = (int(v) for v in A['size'].split('x'))
sc.render.engine = 'BLENDER_EEVEE_NEXT'
sc.eevee.taa_render_samples = 32
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = w, h, 100
sc.render.film_transparent = True
sc.render.image_settings.file_format = 'PNG'
sc.render.image_settings.color_mode = 'RGBA'
sc.view_settings.view_transform = 'Standard'
sc.view_settings.look = 'None'
if sc.world is None:
    sc.world = bpy.data.worlds.new('w')
sc.world.use_nodes = True
sc.world.node_tree.nodes['Background'].inputs[1].default_value = 0.0
shading.sun()

# the figure's height from the body's bounds (rest pose)
zs = [(body.matrix_world @ Vector(c)).z for c in body.bound_box]
height = max(zs) - min(zs)
cd = bpy.data.cameras.new('tt')
cam = bpy.data.objects.new('tt', cd)
sc.collection.objects.link(cam)
sc.camera = cam
cd.lens = 85
cd.clip_start, cd.clip_end = 0.05, 100
tgt = Vector((0, 0, min(zs) + height * 0.52))
dist = height * 2.7
eye = tgt + Vector((0, -dist, height * 0.12))
cam.location = eye
cam.rotation_euler = (tgt - eye).to_track_quat('-Z', 'Y').to_euler()

n = int(A['frames'])
sc.frame_start, sc.frame_end = 1, n
if A['clip']:
    act = bpy.data.actions.get(A['clip'])
    if act is None:
        print('actions:', [a.name for a in bpy.data.actions])
        raise SystemExit(f"no action {A['clip']}")
    arm.animation_data_create()
    arm.animation_data.action = act
    f0, f1 = act.frame_range
    span = max(1, int(f1 - f0))
else:
    span = 0
rot0 = arm.rotation_euler.z
os.makedirs(A['out'], exist_ok=True)
for i in range(n):
    if span:
        sc.frame_set(int(f0 + (i % span)))
    arm.rotation_euler.z = rot0 + math.radians(float(A['degrees'])) * i / n
    sc.render.filepath = os.path.join(A['out'], f'f{i:04d}.png')
    bpy.ops.render.render(write_still=True)
print('turntable done', n)
