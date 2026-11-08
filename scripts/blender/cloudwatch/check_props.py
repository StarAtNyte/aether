"""Gate: no placed prop floats or is buried, and no prop sinks into another.

  blender -b <out>/cloudwatch.blend -P scripts/blender/cloudwatch/check_props.py -- [--tol 0.03] [--json <file>]

For every object with `cw_prop` (lanterns, signs, vending machines, bicycles, laundry, the mailbox, boats, people, the
crossing, the gate's lanterns, the lighthouse ...):
- contact: the vertices of its base (within 2 cm of its lowest point) are cast straight down onto the ground pieces (or
  the water for boats); the closest one must touch within `tol` (else it floats);
- burial: no base vertex may lie more than `tol` + the footprint's slope allowance under the ground (else it sinks);
- overlap: for every pair of props whose bounds meet, the deepest vertex of one inside the other must be within `tol`.
Exit code 1 on any failure; the report lists each prop with its gap, burial and worst overlap.
"""
import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from contact import base_contact, bvh_of_objects as bvh_of, inside, world_mesh  # noqa: E402  (shared with building/qa.py)

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--tol", type=float, default=0.03)
ap.add_argument("--json", default="")
A = ap.parse_args(argv)

GROUND = ("terrain", "roads", "stair", "lookout", "harbour", "railway")


def main():
    ground = bvh_of(GROUND)
    props = [o for o in bpy.data.objects if o.type == "MESH" and o.get("cw_prop")]
    rows = []
    failed = 0
    geo = {}
    for ob in props:
        verts, polys = world_mesh(ob)
        if not verts:
            continue
        geo[ob.name] = (verts, polys)
        zmin = min(v.z for v in verts)
        base = [v for v in verts if v.z < zmin + 0.02]
        tol = float(ob.get("cw_tolerance", A.tol))
        if ob.get("cw_float"):
            gaps = [v.z - 0.0 for v in base]
            gap = min(gaps)
            burial = 0.0
            ok_contact = gap <= 0.0  # a hull must reach into the water
            ok_burial = True
        else:
            def down(v):
                loc, nrm, idx, dist = ground.ray_cast(v + Vector((0, 0, 0.5)), Vector((0, 0, -1)))
                return None if loc is None else (v.z - loc.z, nrm)
            c = base_contact(verts, down, tol)
            if c is None:
                rows.append({"prop": ob.name, "error": "no ground under it"})
                failed += 1
                continue
            # (base_contact: the slope allowance, a footprint on a slope burying its uphill edge by width x tan(slope))
            gap, burial = c["gap"], c["burial"]
            ok_contact = gap <= tol
            ok_burial = burial <= tol + c["allow"]
        ok = ok_contact and ok_burial
        if not ok:
            failed += 1
        rows.append({"prop": ob.name, "gap": round(gap, 4), "burial": round(burial, 4), "ok": ok})
    # Pairwise overlaps between props.
    bvhs = {n: BVHTree.FromPolygons(v, p) for n, (v, p) in geo.items()}
    names = list(geo)
    worst_pairs = []
    for i, a in enumerate(names):
        va = geo[a][0]
        amin = Vector((min(v.x for v in va), min(v.y for v in va), min(v.z for v in va)))
        amax = Vector((max(v.x for v in va), max(v.y for v in va), max(v.z for v in va)))
        for b in names[i + 1:]:
            vb = geo[b][0]
            bmin = Vector((min(v.x for v in vb), min(v.y for v in vb), min(v.z for v in vb)))
            bmax = Vector((max(v.x for v in vb), max(v.y for v in vb), max(v.z for v in vb)))
            if amin.x > bmax.x or bmin.x > amax.x or amin.y > bmax.y or bmin.y > amax.y or amin.z > bmax.z or bmin.z > amax.z:
                continue
            if not bvhs[a].overlap(bvhs[b]):
                continue
            depth = 0.0
            for (src, dst) in ((a, b), (b, a)):
                for v in geo[src][0]:
                    if inside(bvhs[dst], v):
                        loc, nrm, idx, dist = bvhs[dst].find_nearest(v)
                        if dist is not None:
                            depth = max(depth, dist)
            if depth > A.tol:
                failed += 1
            worst_pairs.append({"a": a, "b": b, "depth": round(depth, 4), "ok": depth <= A.tol})
    report = {"props": len(rows), "failed": failed, "tolerance": A.tol, "rows": rows, "overlaps": worst_pairs}
    for r in rows:
        if not r.get("ok", False):
            print("AETHER_GATE_FAIL", json.dumps(r), flush=True)
    for p in worst_pairs:
        if not p["ok"]:
            print("AETHER_GATE_FAIL", json.dumps(p), flush=True)
    print(f"AETHER_GATE props={len(rows)} overlapping_pairs={len(worst_pairs)} failed={failed}", flush=True)
    if A.json:
        with open(A.json, "w") as f:
            json.dump(report, f, indent=1)
    sys.exit(1 if failed else 0)


main()
