"""QA stills of a building from fixed cameras: front, three-quarter (from above, the way a town view sees roofs) and
street eye level (1.5 m, close, looking up the facade), composed into `stills.png`.

`anime` renders with Cloudwatch's light (its sun lamp and physical sky, the toon materials, an inverted-hull outline);
`realistic` with a higher sun on the physical sky (EEVEE, shadows on). Both on a ground plane; no textures, no HDRIs.
"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
CW = os.path.join(HERE, "..", "cloudwatch")
if CW not in sys.path:
    sys.path.insert(0, CW)


def setup_world(style, ground_z=0.0, extent=60.0):
    from common import toon_material
    import sky
    sun = sky.build_light()
    if style == "realistic":
        sun.rotation_quaternion = (Vector((0.45, 0.7, -0.55))).to_track_quat("-Z", "Y")
        sun.data.energy = 4.5
        sk = bpy.context.scene.world.node_tree.nodes["cw_sky"]
        sk.sun_elevation = math.radians(33)
        sk.sun_rotation = math.radians(214)
        bpy.context.scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.35
    me = bpy.data.meshes.new("bk_ground")
    e = extent
    me.from_pydata([(-e, -e, ground_z), (e, -e, ground_z), (e, e, ground_z), (-e, e, ground_z)], [], [(0, 1, 2, 3)])
    ob = bpy.data.objects.new("bk_ground", me)
    bpy.context.scene.collection.objects.link(ob)
    if style == "realistic":
        from materials import pbr_material
        me.materials.append(pbr_material("bk_ground_pbr", "#8d8a84", "ground", var="#7c7972"))
    else:
        me.materials.append(toon_material("bk_ground_toon", "#b9b4ab", var="#a9a49b", noise_scale=0.7))
    return ob


def add_outline(ob, width=0.03):
    """The inverted-hull outline as its own object (a linked copy: the solidify shell alone, masked by its shell
    group), which casts no shadow: a shell on the same object shadowed the whole building in EEVEE."""
    from common import line_material
    line = line_material()
    me = ob.data
    if line.name not in [m.name for m in me.materials]:
        me.materials.append(line)
    sh = bpy.data.objects.new(ob.name + "_outline", me)
    bpy.context.scene.collection.objects.link(sh)
    sh.matrix_world = ob.matrix_world
    sh.visible_shadow = False
    sh["bk_outline"] = 1
    vg_shell = sh.vertex_groups.new(name="bk_shell")
    mod = sh.modifiers.new("outline", "SOLIDIFY")
    mod.thickness = width
    mod.offset = 1.0
    mod.use_flip_normals = True
    mod.use_rim = False
    mod.material_offset = [m.name for m in me.materials].index(line.name)
    mod.shell_vertex_group = vg_shell.name
    nl = me.attributes.get("cw_noline")
    if nl is not None:
        vg = sh.vertex_groups.new(name="bk_line")
        vals = [0.0] * len(me.vertices)
        nl.data.foreach_get("value", vals)
        on = [i for i, v in enumerate(vals) if v < 0.5]
        vg.add(on, 1.0, "REPLACE")
        mod.vertex_group = vg.name
        mod.thickness_vertex_group = 0.0
    mk = sh.modifiers.new("shell_only", "MASK")
    mk.vertex_group = vg_shell.name
    return sh


def cameras(bmin, bmax):
    c = (bmin + bmax) / 2
    size = bmax - bmin
    R = max(size.x, size.y, size.z)
    fy = bmin.y
    return {
        "front": {"eye": Vector((c.x, fy - R * 1.6, bmin.z + size.z * 0.42)), "target": Vector((c.x, c.y, bmin.z + size.z * 0.42)), "lens": 35},
        "three_quarter": {"eye": c + Vector((-R * 1.25, -R * 1.45, R * 1.05)), "target": c + Vector((0, 0, -size.z * 0.08)), "lens": 35},
        "street": {"eye": Vector((c.x + size.x * 0.55, fy - 4.2, bmin.z + 1.5)), "target": Vector((c.x - size.x * 0.15, fy, bmin.z + size.z * 0.55)), "lens": 18},
    }


def render_stills(out, obs, style, size=(900, 700)):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE_NEXT"
    sc.render.resolution_x, sc.render.resolution_y = size
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = "Standard" if style == "anime" else "AgX"
    sc.view_settings.look = "None"
    sc.eevee.taa_render_samples = 24
    try:
        sc.eevee.use_shadows = True
        sc.eevee.shadow_ray_count = 1
        sc.eevee.shadow_step_count = 6
    except AttributeError:
        pass
    sc.render.image_settings.file_format = "PNG"
    pts = [o.matrix_world @ Vector(c) for o in obs for c in o.bound_box]
    bmin = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    bmax = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    paths = {}
    for name, c in cameras(bmin, bmax).items():
        cd = bpy.data.cameras.get(f"bk_{name}") or bpy.data.cameras.new(f"bk_{name}")
        cam = bpy.data.objects.get(f"bk_{name}") or bpy.data.objects.new(f"bk_{name}", cd)
        if cam.name not in sc.collection.objects:
            sc.collection.objects.link(cam)
        cam.location = c["eye"]
        cam.rotation_mode = "QUATERNION"
        cam.rotation_quaternion = (c["target"] - c["eye"]).to_track_quat("-Z", "Y")
        cd.lens = c["lens"]
        cd.sensor_width = 36
        cd.clip_start = 0.05
        cd.clip_end = 2000
        sc.camera = cam
        p = os.path.join(out, f"{name}.png")
        sc.render.filepath = p
        bpy.ops.render.render(write_still=True)
        paths[name] = p
    sheet = os.path.join(out, "stills.png")
    compose([paths["front"], paths["three_quarter"], paths["street"]], sheet)
    return paths, sheet


def compose(paths, out, gap=8):
    imgs = []
    for p in paths:
        im = bpy.data.images.load(p, check_existing=False)
        w, h = im.size
        a = np.empty(w * h * 4, np.float32)
        im.pixels.foreach_get(a)
        imgs.append(a.reshape(h, w, 4))
        bpy.data.images.remove(im)
    H = max(i.shape[0] for i in imgs)
    W = sum(i.shape[1] for i in imgs) + gap * (len(imgs) - 1)
    canvas = np.ones((H, W, 4), np.float32) * np.array([0.92, 0.92, 0.93, 1.0], np.float32)
    x = 0
    for i in imgs:
        canvas[H - i.shape[0]:, x:x + i.shape[1]] = i
        x += i.shape[1] + gap
    im = bpy.data.images.new("bk_sheet", W, H, alpha=True)
    im.pixels.foreach_set(canvas.reshape(-1))
    im.filepath_raw = out
    im.file_format = "PNG"
    im.save()
    bpy.data.images.remove(im)
