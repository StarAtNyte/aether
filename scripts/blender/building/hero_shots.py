"""Which buildings a film's shots show, and how big: the screen share of every object in every shot camera.

  blender -b <world>.blend -P scripts/blender/building/hero_shots.py -- --cams <cams.json> --out <hero.json>
          [--match house_,shop] [--grid 96x54]

`cams.json` is a list of shots, each with `camera` and `cameraTo` (and optional `via`) as Aether poses: `position` and
`target` in Aether coordinates (x, y up, z = -Blender y) and `fov` (vertical, degrees), as a world's story writes them.
For each pose a grid of rays is cast from the eye into the scene (everything that renders occludes); every hit counts
for the object it lands on. The result lists, for each matching object, its largest screen share over the shots and
the shot that gives it, sorted largest first: the buildings worth the most detail.
"""
import json
import math
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(k, d=None):
    return argv[argv.index(f"--{k}") + 1] if f"--{k}" in argv else d


def to_blender(p):
    return Vector((p[0], -p[2], p[1]))


def pose_rays(pose, gw, gh, aspect=16 / 9):
    eye = to_blender(pose["position"])
    tgt = to_blender(pose["target"])
    fwd = (tgt - eye).normalized()
    right = fwd.cross(Vector((0, 0, 1))).normalized()
    up = right.cross(fwd).normalized()
    th = math.tan(math.radians(pose["fov"]) / 2)
    tw = th * aspect
    for j in range(gh):
        for i in range(gw):
            sx = ((i + 0.5) / gw * 2 - 1) * tw
            sy = (1 - (j + 0.5) / gh * 2) * th
            yield eye, (fwd + right * sx + up * sy).normalized()


def main():
    with open(arg("cams")) as f:
        shots = json.load(f)
    match = tuple(arg("match", "house_,shop").split(","))
    gw, gh = (int(v) for v in arg("grid", "96x54").split("x"))
    dg = bpy.context.evaluated_depsgraph_get()
    sc = bpy.context.scene
    best = {}
    per_shot = []
    for s in shots:
        poses = [s[k] for k in ("camera", "cameraTo") if s.get(k)] + list(s.get("via") or [])
        shot_best = {}
        for pose in poses:
            counts = {}
            for eye, d in pose_rays(pose, gw, gh):
                hit, loc, nrm, idx, ob, mw = sc.ray_cast(dg, eye, d, distance=3000)
                if hit and ob is not None:
                    name = ob.name
                    if name.startswith(match):
                        dist = (loc - eye).length
                        c = counts.setdefault(name, [0, 1e9])
                        c[0] += 1
                        c[1] = min(c[1], dist)
            for name, (n, dist) in counts.items():
                share = n / (gw * gh)
                if share > shot_best.get(name, (0, 0))[0]:
                    shot_best[name] = (share, dist)
        for name, (share, dist) in shot_best.items():
            if share > best.get(name, {"share": 0})["share"]:
                best[name] = {"share": round(share, 4), "shot": s["i"], "nearest_m": round(dist, 1)}
        per_shot.append({"shot": s["i"], "objects": {k: round(v[0], 4) for k, v in sorted(shot_best.items(), key=lambda kv: -kv[1][0])[:12]}})
    rows = sorted(({"object": k, **v} for k, v in best.items()), key=lambda r: -r["share"])
    with open(arg("out"), "w") as f:
        json.dump({"objects": rows, "shots": per_shot}, f, indent=1)
    for r in rows[:30]:
        print("AETHER_HERO", json.dumps(r), flush=True)


main()
