"""Stills of the baked pieces themselves: import every glb of a folder (what the browser draws: unlit textures, vertex
colours, emissive practicals) and render the fixed shots in EEVEE with the same glare as shots.py. This is the honest
before/after of a bake change (the EEVEE toon stills of build.py show the toon materials, not the bake).

  blender -b --factory-startup -P scripts/blender/cloudwatch/glb_shots.py -- --glb <dir> --out <dir> [--shots A,B,C,T]
        [--size 1600x900] [--prefix before-] [--frame 0]

Shot T is a close-up of the train's cab: the piece is moved out of the tunnel along the track for it.
"""
import argparse
import glob
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--glb", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--shots", default="A,B,C,T")
ap.add_argument("--size", default="1600x900")
ap.add_argument("--prefix", default="")
ap.add_argument("--frame", type=int, default=0)
A = ap.parse_args(argv)

bpy.ops.wm.read_factory_settings(use_empty=True)
import shots  # noqa: E402

pieces = {}
for path in sorted(glob.glob(os.path.join(A.glb, "*.glb"))):
    key = os.path.splitext(os.path.basename(path))[0]
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    pieces[key] = [o for o in bpy.data.objects if o not in before]
sc = bpy.context.scene
sc.frame_set(A.frame)
w = bpy.data.worlds.new("black")
w.use_nodes = True
w.node_tree.nodes["Background"].inputs["Color"].default_value = (0, 0, 0, 1)
sc.world = w

os.makedirs(A.out, exist_ok=True)
W, H = (int(v) for v in A.size.split("x"))
shots.setup_render(W, H)
sc.eevee.taa_render_samples = 32
cams = shots.shot_list()
# The train out of the tunnel, its cab end (-x) toward a camera by the track.
if ("T" in A.shots or "I" in A.shots) and "train" in pieces:
    tr = [o for o in pieces["train"] if o.type == "MESH"]
    xs = [(o.matrix_world @ Vector(c)).x for o in tr for c in o.bound_box]
    x0, x1 = min(xs), max(xs)
    dx = 30.0 - (x0 + x1) / 2
    for o in pieces["train"]:
        if o.parent is None:
            o.location.x += dx
    front = x0 + dx
    cams["T"] = {"eye": (front - 9.0, -15.6, 8.4), "target": (front + 6.0, -9.4, 8.2), "lens": 30}
    # The open saloon windows of the first car, from the sea side at the crossing camera's distance.
    cams["I"] = {"eye": (front + 10.0, -15.4, 8.6), "target": (front + 10.0, -9.4, 8.4), "lens": 35}
for key in A.shots.split(","):
    if key not in cams:
        continue
    s = cams[key]
    cam = shots.camera(f"cam_{key}", s["eye"], s["target"], s["lens"])
    sc.camera = cam
    sc.render.filepath = os.path.join(A.out, f"{A.prefix}{key}.png")
    bpy.ops.render.render(write_still=True)
    print("AETHER_SHOT", sc.render.filepath, flush=True)
