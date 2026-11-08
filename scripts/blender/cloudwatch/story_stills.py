"""Blender stills from the film's own cameras (the story's shots, as Aether poses), for before/after comparisons of the
town: the EEVEE toon look of the .blend, or (with --glb) the baked pieces the browser draws.

  blender -b <dir>/cloudwatch.blend -P scripts/blender/cloudwatch/story_stills.py -- --cams <cams.json> --out <dir>
          [--shots 5,7,14] [--size 960x540] [--at 0.0] [--prefix after-]
  blender -b --factory-startup -P scripts/blender/cloudwatch/story_stills.py -- --glb <web> --cams <cams.json> --out <dir> ...

`cams.json` lists the shots with `camera` and `cameraTo` (position, target in Aether coordinates, vertical fov in
degrees), e.g. dumped from story.ts's STORY. `--at` blends from `camera` (0) to `cameraTo` (1).
"""
import argparse
import glob
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--cams", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--glb", default="")
ap.add_argument("--shots", default="")
ap.add_argument("--size", default="960x540")
ap.add_argument("--at", type=float, default=0.0)
ap.add_argument("--prefix", default="")
A = ap.parse_args(argv)

if A.glb:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for path in sorted(glob.glob(os.path.join(A.glb, "*.glb"))):
        bpy.ops.import_scene.gltf(filepath=path)
    w = bpy.data.worlds.new("black")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0, 0, 0, 1)
    bpy.context.scene.world = w

import shots  # noqa: E402


def to_blender(p):
    return Vector((p[0], -p[2], p[1]))


def lerp(a, b, t):
    return [a[i] + (b[i] - a[i]) * t for i in range(3)]


with open(A.cams) as f:
    cams = json.load(f)
want = {int(x) for x in A.shots.split(",")} if A.shots else None
W, H = (int(v) for v in A.size.split("x"))
os.makedirs(A.out, exist_ok=True)
shots.setup_render(W, H)
sc = bpy.context.scene
for s in cams:
    if want is not None and s["i"] not in want:
        continue
    c0, c1 = s["camera"], s.get("cameraTo") or s["camera"]
    pos = lerp(c0["position"], c1["position"], A.at)
    tgt = lerp(c0["target"], c1["target"], A.at)
    fov = c0["fov"] + (c1["fov"] - c0["fov"]) * A.at
    cam = shots.camera(f"story_{s['i']}", tuple(to_blender(pos)), tuple(to_blender(tgt)), 35)
    cam.data.sensor_fit = "VERTICAL"
    cam.data.angle_y = math.radians(fov)
    if c0.get("roll"):
        cam.rotation_quaternion = cam.rotation_quaternion @ __import__("mathutils").Quaternion((0, 0, 1), math.radians(-c0["roll"]))
    sc.camera = cam
    path = os.path.join(A.out, f"{A.prefix}s{s['i']:02d}.png")
    if A.glb:
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
    else:
        shots._render_layered(path, cam)
    print("AETHER_SHOT", path, flush=True)
