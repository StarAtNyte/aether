"""Service drops: the wire from a house to its power pole, planned once the town's poles stand.

Each kit house records where a drop may land (`rec["service"]`: the meter's bracket and a point under the eaves of each
outer wall, with the wall's outward normal). `plan` pairs every house with a pole insulator: candidates are the
(anchor, insulator) pairs within `MAX_SPAN` whose wire leaves the wall outward, nearest first (an eave anchor costs a few
metres more than the meter's own bracket); each is hung as a true catenary (`common.catenary`) at a few sags and kept
when it clears everything: no part of the wire nearer than `CLEAR` to any surface (walls, roofs, eaves, trees, poles,
the other drops) outside `END_FREE` of its two ends, and at least `GROUND_CLEAR` above the ground or a roof below it.
A house with no clear drop is reported, not forced. `build` makes the wires (thin tubes) and, at an eave anchor, the
wall bracket with its insulator.
"""
import math

import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree

MAX_SPAN = 34.0
CLEAR = 0.12
END_FREE = 0.45
GROUND_CLEAR = 2.3
EAVE_COST = 4.0


def obstacles(objects, depsgraph):
    """One BVH over the evaluated meshes of `objects`, in world space."""
    verts, polys = [], []
    for ob in objects:
        ev = ob.evaluated_get(depsgraph)
        me = ev.to_mesh()
        mw = ob.matrix_world
        base = len(verts)
        verts.extend(mw @ v.co for v in me.vertices)
        polys.extend([base + i for i in p.vertices] for p in me.polygons)
        ev.to_mesh_clear()
    return BVHTree.FromPolygons(verts, polys) if polys else None


def _clear(pts, bvh, extra):
    """Minimum clearance of a polyline (outside the end zones) against the BVH and the extra polylines; None if it hits."""
    a, b = pts[0], pts[-1]
    worst = 1e9
    for i in range(len(pts) - 1):
        p, q = pts[i], pts[i + 1]
        d = q - p
        ln = d.length
        steps = max(1, int(ln / 0.2))
        for k in range(steps + 1):
            s = p + d * (k / steps)
            if (s - a).length < END_FREE or (s - b).length < END_FREE:
                continue
            loc, _n, _i, dist = bvh.find_nearest(s)
            if loc is not None:
                if dist < CLEAR:
                    return None
                worst = min(worst, dist)
            hit = bvh.ray_cast(s, Vector((0, 0, -1)), GROUND_CLEAR)
            if hit[0] is not None and min((s - a).length, (s - b).length) > 1.5:
                return None
            for line in extra:
                for e in line:
                    if (e - s).length < CLEAR * 2:
                        return None
    return worst


def plan(houses, insulators, bvh, catenary):
    """houses: [(name, [anchor dicts {at, n, kind}])]; insulators: [Vector]. Returns (drops, report rows)."""
    drops, rows, done = [], [], []
    for name, anchors in houses:
        cands = []
        for an in anchors:
            A = Vector(an["at"])
            n = Vector(an["n"])
            for B in insulators:
                h = Vector((B.x - A.x, B.y - A.y, 0.0))
                span = h.length
                if span < 3.0 or span > MAX_SPAN or h.normalized().dot(n) < 0.25:
                    continue
                cands.append((span + (EAVE_COST if an["kind"] != "meter" else 0.0), an, A, B, span))
        cands.sort(key=lambda c: c[0])
        got = None
        tried = 0
        for cost, an, A, B, span in cands[:40]:
            for sag in (0.012 * span + 0.12, 0.02 * span + 0.15, 0.006 * span + 0.06):
                tried += 1
                pts = catenary(A, B, sag, max(10, int(span / 0.6)))
                c = _clear(pts, bvh, done)
                if c is not None:
                    got = {"house": name, "anchor": an, "a": A, "b": B, "span": round(span, 2), "sag": round(sag, 2), "pts": pts, "clear": round(c, 2)}
                    break
            if got:
                break
        if got:
            drops.append(got)
            done.append(got["pts"])
            rows.append({"house": name, "anchor": got["anchor"]["kind"], "span_m": got["span"], "sag_m": got["sag"], "min_clearance_m": got["clear"]})
        else:
            rows.append({"house": name, "anchor": None, "reason": "no pole within %.0f m" % MAX_SPAN if not cands else f"no clear wire ({tried} tried)"})
    return drops, rows


def build(drops, bm, add_cylinder, add_box, mats, radius=0.011):
    """The drops into `bm`: a tube along each wire (mats['wire']) and, at an eave anchor, a wall bracket (mats['metal'])
    with an insulator (mats['insulator']) the wire ends on."""
    for d in drops:
        pts = d["pts"]
        for k in range(len(pts) - 1):
            p, q = pts[k], pts[k + 1]
            v = q - p
            add_cylinder(bm, p, radius, v.length, segments=4, mat_index=mats["wire"], axis=v, cap=False)
        if d["anchor"]["kind"] != "meter":
            A, n = d["a"], Vector(d["anchor"]["n"])
            back = A - n * 0.16  # the wall plane
            mid = back + n * 0.08
            rot = math.atan2(n.y, n.x)
            add_box(bm, (mid.x, mid.y, A.z - 0.08), (0.16, 0.05, 0.05), mat_index=mats["metal"], rot_z=rot)
            add_box(bm, (back.x + n.x * 0.01, back.y + n.y * 0.01, A.z - 0.08), (0.02, 0.12, 0.16), mat_index=mats["metal"], rot_z=rot)
            add_cylinder(bm, (A.x, A.y, A.z - 0.08), 0.03, 0.08, segments=6, mat_index=mats["insulator"])
