"""The building pipeline: a brief in, a detailed, worn, checked building out.

  blender -b --factory-startup -P scripts/blender/building/build.py -- --brief <dir>/brief.json --out <dir>
          [--revise <dir>/report.json] [--review] [--no-export] [--size 900x700]

Writes in <dir>: report.json (the QA), stills.png (front, three-quarter, street eye level) and the three stills,
<id>.glb (LOD0: the albedo with its wear baked into one atlas), <id>.lod1.glb (decimated to 40 %), <id>.blend (for
--review and --revise).

Stages (modules beside this file): brief -> light and colour (the style's sky and sun, `render.setup_world`) ->
materials (`materials.Library`: the style's node materials with wear) -> form (`house`: massing, roofs, the facade
plan, walls cut around real openings) -> lived-in detail (`lived`: outdoor units, pipes, meters, plants, signs) ->
finishing (QA, outline, stills, the bake, LODs). The QA loop (`qa.py`) moves fittings that float or sink onto their
support, removes one that still overlaps another, and rebuilds a detail tier lower when over the triangle budget;
it keeps the best build. See docs/BLENDER-HARNESS.md ("Buildings").
"""
import json
import os
import sys
import time

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402

import brief as BRIEF  # noqa: E402
import export as EXPORT  # noqa: E402
import house as HOUSE  # noqa: E402
import materials as MATS  # noqa: E402
import qa as QA  # noqa: E402
import render as RENDER  # noqa: E402

T0 = time.time()
TIERS = ["far", "mid", "hero"]


def log(s):
    print(f"[building {time.time() - T0:6.1f}s] {s}", flush=True)


def args():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {"review": "--review" in a, "no_export": "--no-export" in a}
    for k in ("brief", "out", "revise", "size"):
        if f"--{k}" in a:
            out[k] = a[a.index(f"--{k}") + 1]
    return out


def make(spec):
    """One build into a fresh scene: (object, K, rec, contact report)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    import common  # Cloudwatch's toon materials cache their materials by name: a fresh scene needs a fresh cache
    common._mats.clear()
    common._coll_cache.clear()
    lib = MATS.Library(spec["style"], spec["palette"], spec["wear"], prefix=spec["id"][:12])
    z = spec["lot"][4]
    ground = lambda x, y: z  # noqa: E731
    K, rec = HOUSE.build(spec, lib, ground=ground, gear=spec["features"]["gear"])
    contact = QA.check(K, ground)
    rep = QA.report(spec, K, rec, contact, lib)
    me = bpy.data.meshes.new(spec["id"])
    K.bm.to_mesh(me)
    K.bm.free()
    for m in lib.mats:
        me.materials.append(m)
    for p in me.polygons:
        p.use_smooth = False
    ob = bpy.data.objects.new(spec["id"], me)
    bpy.context.scene.collection.objects.link(ob)
    return ob, rep, rec, contact


def main():
    a = args()
    out = os.path.abspath(a.get("out", "."))
    os.makedirs(out, exist_ok=True)
    brief = BRIEF.load(a["brief"])
    spec = BRIEF.spec_of(brief)
    history = []
    applied = []
    if a.get("revise") and os.path.exists(a["revise"]):
        with open(a["revise"]) as f:
            last = json.load(f)
        history = last.get("history", [])
        for k in ("tier", "seed"):
            if k in last.get("params", {}):
                spec[k] = last["params"][k]
        applied = BRIEF.apply_notes(spec, brief.get("revision_notes", ""))
        log(f"revise: {applied}")
    size = tuple(int(v) for v in a.get("size", "900x700").split("x"))
    if a.get("review"):
        bpy.ops.wm.open_mainfile(filepath=os.path.join(out, f"{spec['id']}.blend"))
        prev = json.load(open(os.path.join(out, "report.json")))
        obs = [o for o in bpy.data.objects if o.get("bk_building")]
        RENDER.render_stills(out, obs, spec["style"], size)
        prev["reviewed"] = True
        write_report(out, prev)
        log("reviewed")
        return
    best = None
    it = 0
    while it < 3:
        it += 1
        log(f"iteration {it}: tier {spec['tier']}, seed {spec['seed']}")
        ob, rep, rec, contact = make(spec)
        score = len(rep["issues"]) * 10 + max(0, rep["triangles"] - spec["budget"]) / 1000
        history.append({"iteration": it, "params": {"tier": spec["tier"], "seed": spec["seed"]}, "score": round(score, 3), "issues": rep["issues"][:8],
                        "triangles": rep["triangles"], "fixes": contact["fixes"][:12]})
        log(f"triangles {rep['triangles']} / {spec['budget']}, parts {contact['parts']}, fixes {len(contact['fixes'])}, issues {rep['issues']}")
        if best is None or score < best[0]:
            best = (score, dict(spec), rep)
        if rep["triangles"] > spec["budget"] and TIERS.index(spec["tier"]) > 0:
            spec["tier"] = TIERS[TIERS.index(spec["tier"]) - 1]
            continue
        break
    score, spec, rep = best
    if spec["tier"] != history[-1]["params"]["tier"]:
        ob, rep, rec, contact = make(spec)
    ob["bk_building"] = 1
    ob["cw_outline"] = 1
    RENDER.setup_world(spec["style"], spec["lot"][4])
    if spec["style"] == "anime":
        RENDER.add_outline(ob, 0.028)
    log("stills")
    paths, sheet = RENDER.render_stills(out, [ob], spec["style"], size)
    for o in [o for o in bpy.data.objects if o.get("bk_outline")]:
        bpy.data.objects.remove(o)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, f"{spec['id']}.blend"), compress=True)
    if not a.get("no_export"):
        log("export")
        EXPORT.bake_albedo(ob, 2048 if spec["tier"] == "hero" else 1024)
        b0 = EXPORT.export_glb(ob, os.path.join(out, f"{spec['id']}.glb"))
        lo = EXPORT.lod(ob, 0.4)
        b1 = EXPORT.export_glb(lo, os.path.join(out, f"{spec['id']}.lod1.glb"))
        rep["glb"] = f"{spec['id']}.glb"
        rep["bytes"] = b0
        rep["lods"] = [{"level": 0, "triangles": EXPORT.triangles(ob), "bytes": b0, "file": f"{spec['id']}.glb"},
                       {"level": 1, "triangles": EXPORT.triangles(lo), "bytes": b1, "file": f"{spec['id']}.lod1.glb"}]
    rep["iterations"] = it
    rep["history"] = history
    rep["params"] = {"tier": spec["tier"], "seed": spec["seed"]}
    rep["revision_applied"] = applied
    rep["stills"] = {k: os.path.basename(v) for k, v in paths.items()} | {"sheet": "stills.png"}
    rep["passed"] = not rep["issues"]
    write_report(out, rep)
    log("done")


def write_report(out, rep):
    with open(os.path.join(out, "report.json"), "w") as f:
        json.dump(rep, f, indent=1, default=lambda o: list(o) if hasattr(o, "__iter__") else str(o))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        traceback.print_exc()
        out = args().get("out", ".")
        try:
            with open(os.path.join(out, "report.json"), "w") as f:
                json.dump({"passed": False, "issues": [f"the pipeline failed: {e}"], "trace": traceback.format_exc()[-3000:]}, f, indent=1)
        except Exception:
            pass
        sys.exit(1)
