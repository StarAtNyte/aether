"""Contact and interpenetration tests shared by the gates: Cloudwatch's placed props (`cloudwatch/check_props.py`) and
the building kit's fittings (`building/qa.py`).

The rule is the same everywhere: what stands on something touches it (its base within `tol`, 3 cm by default, of what
is under it), what hangs on a wall touches the wall the same way, and nothing sinks more than `tol` into anything else.
"""
import math

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

TOL = 0.03


def world_mesh(ob, outline=False):
    """Evaluated world-space vertices and polygons of an object, with the outline shell left out."""
    for md in ob.modifiers:
        if md.name == "outline":
            md.show_viewport = outline
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    mw = ob.matrix_world
    verts = [mw @ v.co for v in me.vertices]
    polys = [tuple(p.vertices) for p in me.polygons]
    ev.to_mesh_clear()
    return verts, polys


def bvh_of_objects(names):
    verts, polys = [], []
    for n in names:
        ob = bpy.data.objects.get(n)
        if ob is None:
            continue
        v, p = world_mesh(ob)
        base = len(verts)
        verts += v
        polys += [tuple(base + i for i in q) for q in p]
    return BVHTree.FromPolygons(verts, polys)


def inside(bvh, p):
    """Point-in-mesh by ray parity along +Z (closed meshes)."""
    hits = 0
    o = p.copy()
    d = Vector((0.0, 0.0, 1.0))
    for _ in range(64):
        loc, nrm, idx, dist = bvh.ray_cast(o, d)
        if loc is None:
            break
        hits += 1
        o = loc + d * 1e-4
    return hits % 2 == 1


def depth_behind(bvh, p, reach=0.6):
    """How far `p` lies behind the nearest surface of `bvh` (0 when in front of it): for meshes whose faces point out
    (open shells too: a wall's face, a box without its back)."""
    loc, nrm, idx, dist = bvh.find_nearest(p, reach)
    if loc is None:
        return 0.0
    if (p - loc).dot(nrm) < -1e-5:
        return dist
    return 0.0


def base_contact(verts, down_hit, tol=TOL, band=0.02):
    """The base of a standing thing: its vertices within `band` of the lowest, each cast down by `down_hit(v) ->
    (distance below, normal) | None`. Returns gap (closest base vertex's height over what is under it), burial (deepest
    under it) and the slope allowance (a footprint on a slope buries its uphill edge by width x tan(slope))."""
    zmin = min(v.z for v in verts)
    base = [v for v in verts if v.z < zmin + band]
    downs = [h for h in (down_hit(v) for v in base) if h is not None]
    if not downs:
        return None
    gap = min(d for d, _ in downs)
    xs = [v.x for v in base]
    ys = [v.y for v in base]
    width = max(max(xs) - min(xs), max(ys) - min(ys))
    nz = min(max(0.2, n.z) for _, n in downs)
    allow = width * math.tan(math.acos(min(1.0, nz)))
    burial = max(0.0, -min(d for d, _ in downs))
    return {"gap": gap, "burial": burial, "allow": allow, "ok": gap <= tol and burial <= tol + allow}


def back_contact(verts, normal, bvh, tol=TOL, band=0.02):
    """The back of a thing hung on a wall (outward normal `normal`): its vertices within `band` of the innermost, each
    cast along -normal onto `bvh` (from 0.5 m out). Returns the gap of the closest one."""
    n = Vector(normal).normalized()
    ds = [v.dot(n) for v in verts]
    dmin = min(ds)
    back = [v for v, d in zip(verts, ds) if d < dmin + band]
    best = None
    for v in back:
        loc, nrm, idx, dist = bvh.ray_cast(v + n * 0.5, -n, 1.5)
        if loc is not None:
            g = dist - 0.5
            best = g if best is None else min(best, g)
    if best is None:
        return None
    return {"gap": best, "ok": best <= tol}


def overlap_depth(va, bvh_b, reach=0.5):
    """Deepest vertex of `va` behind the surface of the mesh in `bvh_b`."""
    d = 0.0
    for v in va:
        d = max(d, depth_behind(bvh_b, v, reach))
    return d


def bounds(verts):
    return (Vector((min(v.x for v in verts), min(v.y for v in verts), min(v.z for v in verts))),
            Vector((max(v.x for v in verts), max(v.y for v in verts), max(v.z for v in verts))))


def boxes_meet(a, b, pad=0.0):
    (amin, amax), (bmin, bmax) = a, b
    return not (amin.x > bmax.x + pad or bmin.x > amax.x + pad or amin.y > bmax.y + pad or bmin.y > amax.y + pad or amin.z > bmax.z + pad or bmin.z > amax.z + pad)
