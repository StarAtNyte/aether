"""
Hero stills of a world exported as .glb, path-traced by Blender (Cycles) headless. An offline build step for gallery thumbnails
and demo footage; the product itself renders in the browser. Blender is used as an external tool, only its images are shipped.

  blender -b -P scripts/blender/hero.py -- --glb world.glb --out out_dir [--samples 96] [--size 1600x900]
        [--cam "x,y,z:tx,ty,tz" ...] [--sun-elev 24] [--sun-azim 215]
"""
import argparse
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--glb", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--samples", type=int, default=96)
ap.add_argument("--size", default="1600x900")
ap.add_argument("--cam", action="append", default=[])
ap.add_argument("--sun-elev", type=float, default=24.0)
ap.add_argument("--sun-azim", type=float, default=215.0)
a = ap.parse_args(argv)
W, H = (int(v) for v in a.size.split("x"))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=a.glb)

sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.samples = a.samples
sc.cycles.use_denoising = True
sc.cycles.device = "CPU"
sc.render.resolution_x, sc.render.resolution_y = W, H
sc.render.image_settings.file_format = "PNG"
sc.view_settings.view_transform = "AgX"
sc.view_settings.look = "AgX - Medium High Contrast"

# Physical sky with a low late-afternoon sun.
world = bpy.data.worlds.new("sky")
world.use_nodes = True
nt = world.node_tree
for n in list(nt.nodes):
    nt.nodes.remove(n)
sky = nt.nodes.new("ShaderNodeTexSky")
sky.sky_type = "NISHITA"
sky.sun_elevation = math.radians(a.sun_elev)
sky.sun_rotation = math.radians(a.sun_azim)
sky.air_density = 1.2
sky.dust_density = 2.5
bg = nt.nodes.new("ShaderNodeBackground")
bg.inputs["Strength"].default_value = 1.0
out = nt.nodes.new("ShaderNodeOutputWorld")
nt.links.new(sky.outputs["Color"], bg.inputs["Color"])
nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
sc.world = world

cams = []
for spec in a.cam:
    p, t = spec.split(":")
    cams.append((Vector(float(v) for v in p.split(",")), Vector(float(v) for v in t.split(","))))
if not cams:
    cams = [(Vector((0, 90, 190)), Vector((0, 15, 60)))]

os.makedirs(a.out, exist_ok=True)
for i, (pos, target) in enumerate(cams):
    cd = bpy.data.cameras.new(f"cam{i}")
    cd.lens = 28
    co = bpy.data.objects.new(f"cam{i}", cd)
    sc.collection.objects.link(co)
    co.location = pos
    co.rotation_euler = (target - pos).to_track_quat("-Z", "Y").to_euler()
    sc.camera = co
    sc.render.filepath = os.path.join(a.out, f"hero-{i + 1}.png")
    bpy.ops.render.render(write_still=True)
    print("wrote", sc.render.filepath)
