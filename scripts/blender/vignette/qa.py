"""Interpenetration / floating check for placed props (Blender-side, imported by scene scripts).

For every registered (object, support_name_prefix, kind) the lowest few percent of the object's evaluated vertices are
ray-cast straight down onto the scene. gap = vertex z - surface z beneath it. A prop passes when its lowest vertices touch
the support within `tol` (default 4 mm: nothing floats) and nothing sinks deeper than `sink` (default 12 mm).
"""
import bpy
from mathutils import Vector


def check(registry, tol=0.004, sink=0.012, verbose=True):
    dg = bpy.context.evaluated_depsgraph_get()
    sc = bpy.context.scene
    bad = []
    for ob, support, kind in registry:
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        pts = [ev.matrix_world @ v.co for v in me.vertices]
        ev.to_mesh_clear()
        if not pts:
            continue
        pts.sort(key=lambda p: p.z)
        low = pts[: max(6, len(pts) // 30)]
        gaps = []
        for p in low:
            o = Vector((p.x, p.y, p.z + 0.02))
            hit_z = None; other = None
            for _ in range(6):
                ok, loc, nrm, idx, hob, mw = sc.ray_cast(dg, o, Vector((0, 0, -1)), distance=0.3)
                if not ok:
                    break
                if hob.name == ob.name or hob.name.startswith(("Crumb", "Steam", "Coffee")):
                    o = Vector((loc.x, loc.y, loc.z - 1e-4))
                    continue
                other = hob.name
                if hob.name.startswith(support.rstrip("*")):
                    hit_z = loc.z
                break
            if hit_z is not None:
                gaps.append(p.z - hit_z)
        if not gaps:
            res = "NO-SUPPORT-HIT (under: %s)" % other
            ok_ = False
        else:
            lo, contact = min(gaps), min(abs(g) for g in gaps)
            ok_ = contact <= tol and lo >= -sink
            res = ("ok" if ok_ else "FAIL") + "  min-gap %.1f mm  contact %.1f mm" % (lo * 1000, contact * 1000)
        if verbose:
            print("QA %-14s on %-8s %s" % (ob.name, support, res))
        if not ok_:
            bad.append(ob.name)
    print("QA SUMMARY: %d props, %d failed %s" % (len(registry), len(bad), bad))
    return bad
