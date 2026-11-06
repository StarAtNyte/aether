"""Build Cloudwatch Harbour in Blender, save the .blend and render the fixed shot list.

  blender -b --factory-startup -P scripts/blender/cloudwatch/build.py -- --out <dir> [--stage light|form|detail|finish]
        [--shots A,B,C,D] [--size 1600x900] [--no-render]

Stages accumulate: light (sky, sun, land, town blocks, toon ramp), form (+ railway, gate, trees, boats),
detail (+ lived-in props, people, poles and wires), finish (+ line art).
"""
import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("--stage", default="finish")
ap.add_argument("--shots", default="A,B,C,D")
ap.add_argument("--size", default="1600x900")
ap.add_argument("--no-render", action="store_true")
ap.add_argument("--prefix", default="")
A = ap.parse_args(argv)
STAGES = ["light", "form", "detail", "finish"]
level = STAGES.index(A.stage)

bpy.ops.wm.read_factory_settings(use_empty=True)

import land  # noqa: E402
import shots  # noqa: E402
import sky  # noqa: E402
import town  # noqa: E402

sky.build()
land.build()
town.build()
if level >= 1:
    import form  # noqa: E402
    form.build()
if level >= 2:
    import detail  # noqa: E402
    detail.build()
if level >= 3:
    import finish  # noqa: E402
    finish.build()

os.makedirs(A.out, exist_ok=True)
blend = os.path.join(A.out, "cloudwatch.blend")
bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
print("AETHER_BLEND", blend, flush=True)
if not A.no_render:
    W, H = (int(v) for v in A.size.split("x"))
    shots.render_shots(A.out, W, H, only=set(A.shots.split(",")), prefix=A.prefix)
