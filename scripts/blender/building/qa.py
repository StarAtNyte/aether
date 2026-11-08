"""The building kit's QA: every fitting against what carries it, the budgets, and the numbers of report.json.

Checks (on the kit's bmesh, before it becomes an object):
- contact: a part that stands (`support: below`) has its base on the body (walls, roofs, slabs) or the ground within
  3 cm; a part that hangs (`back`) has its back on the wall within 3 cm (`scripts/blender/contact.py`, the rule of
  Cloudwatch's prop gate);
- sinking: no part's vertex lies more than 3 cm behind the body's surface or another part's;
- budget: triangles against the tier's budget; materials (draws) counted.
The loop corrects what it can by itself: a part that floats or sinks by less than 30 cm is moved onto its support (a
`fixes` entry), a part that still overlaps another is removed (also listed), over budget the build is redone a tier
lower. Everything else is for the reviewer's eyes, with the stills.
"""
import os
import sys

import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from contact import TOL, back_contact, base_contact, bounds, boxes_meet, depth_behind  # noqa: E402


def _geom(faces):
    vmap, verts, polys = {}, [], []
    for f in faces:
        if not f.is_valid:
            continue
        idx = []
        for v in f.verts:
            if v.index not in vmap:
                vmap[v.index] = len(verts)
                verts.append(v.co.copy())
            idx.append(vmap[v.index])
        polys.append(idx)
    return verts, polys


REMOVABLE = ("ac_duct", "plant", "conduit", "wire", "downpipe", "name_plate", "mailbox", "door_lamp", "noren", "blind")


def check(K, ground, tol=TOL, fix=True):
    """Run the contact and sinking checks on the kit's parts (moving or removing what it can). Returns the report."""
    bm = K.bm
    bm.verts.index_update()
    part_faces = set()
    for p in K.parts:
        part_faces.update(f for f in p["faces"] if f.is_valid)
    body_faces = [f for f in bm.faces if f not in part_faces]
    bv, bp = _geom(body_faces)
    body = BVHTree.FromPolygons(bv, bp) if bp else None
    rows, fixes = [], []

    def down_hit(v):
        best = None
        if body is not None:
            loc, nrm, idx, dist = body.ray_cast(v + Vector((0, 0, 0.05)), Vector((0, 0, -1)), 3.0)
            if loc is not None:
                best = (v.z - loc.z, nrm)
        zg = ground(v.x, v.y)
        g = (v.z - zg, Vector((0, 0, 1)))
        if best is None or (g[0] < best[0] and g[0] > -0.5):
            best = g
        return best

    for p in K.parts:
        faces = [f for f in p["faces"] if f.is_valid]
        if not faces:
            continue
        verts, polys = _geom(faces)
        row = {"part": p["name"], "support": p["support"]}
        moved = None
        if p["support"] == "below":
            c = base_contact(verts, down_hit, tol)
            if c is not None:
                row.update(gap=round(c["gap"], 4), burial=round(c["burial"], 4))
                if fix and not c["ok"]:
                    dz = -c["gap"] if c["gap"] > tol else (c["burial"] - c["allow"] * 0.5)
                    if abs(dz) < 0.3:
                        moved = Vector((0, 0, dz))
        elif p["support"] == "back" and body is not None:
            c = back_contact(verts, p["normal"], body, tol)
            if c is not None:
                row.update(gap=round(c["gap"], 4))
                if fix and not c["ok"] and c["gap"] < 0.3:
                    moved = -Vector(p["normal"]).normalized() * c["gap"]
        # Sinking into the body.
        sink = 0.0
        if body is not None:
            for v in verts:
                sink = max(sink, depth_behind(body, v, 0.4))
        row["sink"] = round(sink, 4)
        if moved is not None:
            for v in {v for f in faces for v in f.verts}:
                v.co += moved
            fixes.append(f"moved {p['name']} by {tuple(round(x, 3) for x in moved)} onto its support")
            row["moved"] = [round(x, 3) for x in moved]
            verts = [v + moved for v in verts]
            if p["support"] == "below":
                c = base_contact(verts, down_hit, tol)
                if c:
                    row.update(gap=round(c["gap"], 4), burial=round(c["burial"], 4))
            elif p["support"] == "back":
                c = back_contact(verts, p["normal"], body, tol)
                if c:
                    row.update(gap=round(c["gap"], 4))
            sink = max([depth_behind(body, v, 0.4) for v in verts] + [0.0])
            row["sink"] = round(sink, 4)
        ok = sink <= tol
        if p["support"] == "below" and "gap" in row:
            ok = ok and row["gap"] <= tol and row.get("burial", 0) <= tol + 0.05
        if p["support"] == "back" and "gap" in row:
            ok = ok and row["gap"] <= tol
        row["ok"] = ok
        row["_verts"] = verts
        row["_faces"] = faces
        rows.append(row)
    # Parts against each other.
    overlaps = []
    trees = []
    for row in rows:
        v, pl = _geom(row["_faces"])
        trees.append((row, BVHTree.FromPolygons(v, pl) if pl else None, bounds(row["_verts"])))
    removed = set()
    for i, (ra, ta, ba) in enumerate(trees):
        for (rb, tb, bb) in trees[i + 1:]:
            if ta is None or tb is None or not boxes_meet(ba, bb) or rb["part"] in removed or ra["part"] in removed:
                continue
            if not ta.overlap(tb):
                continue
            d = max(max((depth_behind(tb, v, 0.3) for v in ra["_verts"]), default=0.0), max((depth_behind(ta, v, 0.3) for v in rb["_verts"]), default=0.0))
            if d > tol:
                if fix:
                    # The later part goes (it was placed into a spot the earlier one already took).
                    bmesh.ops.delete(K.bm, geom=[f for f in rb["_faces"] if f.is_valid], context="FACES")
                    removed.add(rb["part"])
                    fixes.append(f"removed {rb['part']}: it sank {d * 100:.1f} cm into {ra['part']}")
                    rb["ok"] = True
                    rb["removed"] = True
                overlaps.append({"a": ra["part"], "b": rb["part"], "depth": round(d, 4), "fixed": fix})
    # What still sinks or floats after the moves, and is only dressing (a pipe cover, a pot, a conduit, a wire), goes:
    # the building reads the same without it, and a fitting through a wall does not.
    if fix:
        for row in rows:
            if not row.get("ok") and not row.get("removed") and row["part"].startswith(REMOVABLE):
                bmesh.ops.delete(K.bm, geom=[f for f in row["_faces"] if f.is_valid], context="FACES")
                row["removed"] = True
                fixes.append(f"removed {row['part']}: it still sank {row.get('sink', 0) * 100:.1f} cm (gap {row.get('gap')})")
    for row in rows:
        row.pop("_verts", None)
        row.pop("_faces", None)
    if fixes:
        loose = [v for v in K.bm.verts if not v.link_faces]
        bmesh.ops.delete(K.bm, geom=loose, context="VERTS")
    failed = [r for r in rows if not r.get("ok") and not r.get("removed")]
    return {"parts": len(rows), "failed": len(failed), "tolerance": tol, "rows": rows, "overlaps": overlaps, "fixes": fixes,
            "worst_gap": max([r.get("gap", 0) for r in rows if not r.get("removed")] + [0]),
            "worst_sink": max([r.get("sink", 0) for r in rows if not r.get("removed")] + [0])}


def report(spec, K, rec, contact, lib, extra=None):
    tris = K.triangles()
    issues = []
    for r in contact["rows"]:
        if not r.get("ok") and not r.get("removed"):
            issues.append(f"interpenetration: {r['part']} (gap {r.get('gap')}, sink {r.get('sink')})")
    if tris > spec["budget"]:
        issues.append(f"triangles {tris} over the {spec['tier']} budget {spec['budget']}")
    used = sorted({f.material_index for f in K.bm.faces})
    out = {
        "id": spec["id"], "style": spec["style"], "tier": spec["tier"], "kind": spec["kind"], "storeys": rec["storeys"],
        "triangles": tris, "budget": spec["budget"], "materials": len(used), "windows": rec.get("windows"),
        "balconies": len(rec.get("balconies", [])), "parts": contact["parts"],
        "interpenetration": {k: contact[k] for k in ("parts", "failed", "tolerance", "worst_gap", "worst_sink", "overlaps", "fixes")},
        "contact_rows": contact["rows"], "height_m": round(rec["h"], 2), "roof_top_m": round(rec["roof_top"] - rec["z"], 2),
        "footprint_m": [round(rec["w"], 2), round(rec["d"], 2)], "wear": spec["wear"], "issues": issues,
    }
    if extra:
        out.update(extra)
    out["passed"] = not issues
    return out
