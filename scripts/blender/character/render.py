"""Turnaround and close-up renders (EEVEE, orthographic, fixed cameras) and image helpers (numpy <-> PNG)."""
import math
import os

import bpy
import numpy as np
from mathutils import Vector


def save_png(path, rgba):
    """Write an RGBA float array (h, w, 4), top row first, as PNG."""
    h, w = rgba.shape[:2]
    img = bpy.data.images.new('out', w, h, alpha=True)
    img.pixels.foreach_set(np.ascontiguousarray(rgba[::-1]).astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)


def load_image(path):
    """An image file as an RGBA float array (h, w, 4), top row first (sRGB values as stored)."""
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = 'Non-Color'
    w, h = img.size
    a = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(h, w, 4)[::-1].copy()


def setup_scene(engine='BLENDER_EEVEE_NEXT', res=(512, 1024), transparent=True):
    sc = bpy.context.scene
    sc.render.engine = engine
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = transparent
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    if engine == 'BLENDER_EEVEE_NEXT':
        sc.eevee.taa_render_samples = 16
    if sc.world is None:
        sc.world = bpy.data.worlds.new('w')
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes.get('Background')
    if bg:
        bg.inputs[0].default_value = (0.75, 0.75, 0.77, 1)
        bg.inputs[1].default_value = 0.6
    return sc


def camera(name='qa-cam'):
    cam = bpy.data.objects.get(name)
    if cam is None:
        cd = bpy.data.cameras.new(name)
        cam = bpy.data.objects.new(name, cd)
        bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    return cam


def look_at(cam, eye, target):
    cam.location = Vector(eye)
    d = Vector(target) - Vector(eye)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def render_view(path, azimuth, height, centre_z, ortho=None, res=(512, 1024), persp_lens=None, dist=6.0, elev=0.0, target=None):
    """Render from a direction around the character (azimuth 0 = front, from -Y; 90 = her left side)."""
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = res
    cam = camera()
    a = math.radians(azimuth)
    tgt = Vector(target) if target is not None else Vector((0, 0, centre_z))
    eye = tgt + Vector((math.sin(a) * dist, -math.cos(a) * dist, elev * dist))
    look_at(cam, eye, tgt)
    if persp_lens:
        cam.data.type = 'PERSP'
        cam.data.lens = persp_lens
    else:
        cam.data.type = 'ORTHO'
        cam.data.ortho_scale = ortho or height * 1.06
    cam.data.clip_start = 0.05
    cam.data.clip_end = 50
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return load_image(path)


def side_by_side(images, bg=(0.78, 0.78, 0.8)):
    h = max(i.shape[0] for i in images)
    out = []
    for im in images:
        a = im[..., 3:4]
        rgb = im[..., :3] * a + np.array(bg) * (1 - a)
        pad = np.ones((h - im.shape[0], im.shape[1], 3)) * np.array(bg)
        out.append(np.concatenate([rgb, pad], 0))
    rgb = np.concatenate(out, 1)
    return np.concatenate([rgb, np.ones(rgb.shape[:2] + (1,))], 2)
