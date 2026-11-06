"""The fixed shot list (design doc: A hero, B stair, C crossing, D harbour) and the EEVEE still renderer."""
import math
import os

import bpy
from mathutils import Vector

from common import collection, profile_z


def _breakwater_end():
    ob = bpy.data.objects.get("lighthouse")
    if ob is None:
        return Vector((40.0, -90.0, 3.0))
    bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    c = sum(bb, Vector()) / 8
    return Vector((c.x, c.y, 3.0))


def shot_list():
    end = _breakwater_end()
    return {
        "A": {"eye": (2.0, 130.9, 45.65), "target": (-50.1, -163.2, 24.6), "lens": 20},
        "B": {"eye": (-0.6, 39.0, profile_z(39.0) + 1.5), "target": (0.5, 130.0, 52.0), "lens": 24},
        "C": {"eye": (3.6, -13.4, 7.55), "target": (-177.7, -97.9, 18.0), "lens": 22},
        "D": {"eye": (end.x - 6.0, end.y + 6.0, 3.2), "target": (0.0, 40.0, 16.0), "lens": 40},
        # The sunset itself (not in the design's list: a check of the sun, its bloom and the glitter path).
        "S": {"eye": (2.0, 130.9, 45.65), "target": (-81.9, 7.8, 40.4), "lens": 30},
        # The mother and child at the crossing, from across the track (a check of the people).
        "P": {"eye": (-2.6, -5.6, 7.45), "target": (0.2, -12.6, 6.9), "lens": 35},
    }


def camera(name, eye, target, lens):
    cam = bpy.data.objects.get(name)
    if cam is None:
        cd = bpy.data.cameras.new(name)
        cam = bpy.data.objects.new(name, cd)
        collection("cameras").objects.link(cam)
    cam.location = eye
    d = Vector(target) - Vector(eye)
    cam.rotation_mode = "QUATERNION"
    cam.rotation_quaternion = d.to_track_quat("-Z", "Y")
    cam.data.lens = lens
    cam.data.sensor_width = 36
    cam.data.clip_start = 0.1
    cam.data.clip_end = 6000
    return cam


def setup_render(width, height, engine="BLENDER_EEVEE_NEXT"):
    sc = bpy.context.scene
    sc.render.engine = engine
    sc.render.resolution_x = width
    sc.render.resolution_y = height
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.view_settings.exposure = 0.0
    sc.view_settings.gamma = 1.0
    sc.render.image_settings.file_format = "PNG"
    if engine.startswith("BLENDER_EEVEE"):
        ee = sc.eevee
        ee.taa_render_samples = 32
        try:
            ee.use_shadows = True
            ee.shadow_ray_count = 1
            ee.shadow_step_count = 6
            ee.shadow_resolution_scale = 1.0
        except AttributeError:
            pass
    # Compositor: glare (bloom) on what is brighter than white.
    sc.use_nodes = True
    nt = sc.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    rl = nt.nodes.new("CompositorNodeRLayers")
    glare = nt.nodes.new("CompositorNodeGlare")
    glare.glare_type = "FOG_GLOW"
    glare.quality = "HIGH"
    glare.threshold = 0.92
    glare.size = 8
    glare.mix = -0.55
    glare2 = nt.nodes.new("CompositorNodeGlare")
    glare2.glare_type = "STREAKS"
    glare2.quality = "MEDIUM"
    glare2.threshold = 2.5
    glare2.streaks = 6
    glare2.angle_offset = math.radians(12)
    glare2.fade = 0.9
    glare2.mix = -0.8
    comp = nt.nodes.new("CompositorNodeComposite")
    nt.links.new(rl.outputs["Image"], glare.inputs["Image"])
    nt.links.new(glare.outputs["Image"], glare2.inputs["Image"])
    nt.links.new(glare2.outputs["Image"], comp.inputs["Image"])


def _glare_chain(nt, src):
    glare = nt.nodes.new("CompositorNodeGlare")
    glare.glare_type = "FOG_GLOW"
    glare.quality = "HIGH"
    glare.threshold = 0.92
    glare.size = 8
    glare.mix = -0.55
    glare2 = nt.nodes.new("CompositorNodeGlare")
    glare2.glare_type = "STREAKS"
    glare2.quality = "MEDIUM"
    glare2.threshold = 2.5
    glare2.streaks = 6
    glare2.angle_offset = math.radians(12)
    glare2.fade = 0.9
    glare2.mix = -0.8
    comp = nt.nodes.new("CompositorNodeComposite")
    nt.links.new(src, glare.inputs["Image"])
    nt.links.new(glare.outputs["Image"], glare2.inputs["Image"])
    nt.links.new(glare2.outputs["Image"], comp.inputs["Image"])


def _render_layered(path, cam):
    """One still in three passes, composited: the scene without clouds; the clouds alone, with the near clip pushed out to
    300 m (sphere-on-sphere billow creases 2 km away otherwise come out as depth-precision staircases); and the coverage
    of everything in front of the sky, which holds the clouds out. Then the glare."""
    sc = bpy.context.scene
    tmp = os.path.dirname(path)
    clouds = [o for o in bpy.data.objects if o.name.startswith("cloud") and o.type == "MESH"]
    others = [o for o in bpy.data.objects if o.type in ("MESH", "CURVE", "FONT", "META") and o not in clouds and not o.hide_render]
    dome = bpy.data.objects.get("sky_dome")
    fmt = sc.render.image_settings
    fmt.file_format, fmt.color_depth, fmt.color_mode = "OPEN_EXR", "32", "RGBA"
    sc.render.use_compositing = False
    clip0 = cam.data.clip_start

    def shot(name, hide, transparent, clip):
        for o in clouds + others:
            o.hide_render = o in hide
        sc.render.film_transparent = transparent
        cam.data.clip_start = clip
        f = os.path.join(tmp, f"_{name}.exr")
        sc.render.filepath = f
        bpy.ops.render.render(write_still=True)
        return f
    base = shot("base", set(clouds), False, clip0)
    cloud = shot("cloud", set(others), True, 300.0)
    mask = shot("mask", set(clouds) | ({dome} if dome else set()), True, clip0)
    for o in others:
        o.hide_render = True
    for o in clouds:
        o.hide_render = True
    nt = sc.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    imgs = []
    for f in (base, cloud, mask):
        im = bpy.data.images.load(f, check_existing=False)
        n = nt.nodes.new("CompositorNodeImage")
        n.image = im
        imgs.append((n, im))
    inv = nt.nodes.new("CompositorNodeMath")
    inv.operation = "SUBTRACT"
    inv.inputs[0].default_value = 1.0
    nt.links.new(imgs[2][0].outputs["Alpha"], inv.inputs[1])
    over = nt.nodes.new("CompositorNodeAlphaOver")
    over.use_premultiply = False
    nt.links.new(inv.outputs[0], over.inputs[0])
    nt.links.new(imgs[0][0].outputs["Image"], over.inputs[1])
    nt.links.new(imgs[1][0].outputs["Image"], over.inputs[2])
    _glare_chain(nt, over.outputs["Image"])
    sc.render.use_compositing = True
    sc.render.film_transparent = False
    fmt.file_format, fmt.color_depth, fmt.color_mode = "PNG", "8", "RGB"
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for o in clouds + others:
        o.hide_render = False
    cam.data.clip_start = clip0
    for _, im in imgs:
        bpy.data.images.remove(im)
    for f in (base, cloud, mask):
        os.remove(f)


def render_shots(out_dir, width=1600, height=900, only=None, prefix=""):
    only = only or {"A", "B", "C", "D"}
    os.makedirs(out_dir, exist_ok=True)
    setup_render(width, height)
    sc = bpy.context.scene
    paths = []
    for key, s in shot_list().items():
        if only and key not in only:
            continue
        cam = camera(f"cam_{key}", s["eye"], s["target"], s["lens"])
        sc.camera = cam
        path = os.path.join(out_dir, f"{prefix}{key}.png")
        _render_layered(path, cam)
        paths.append(path)
        print("AETHER_SHOT", path, flush=True)
    return paths
