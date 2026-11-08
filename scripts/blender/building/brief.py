"""A building brief (`BuildingBriefSchema` in packages/agent/src/bridge/blender-protocol.ts) to the kit's spec.

Brief fields (all but id, name and style optional):
  id, name, style ('anime' | 'realistic'), kind ('simple' | 'L' | 'stepped' | 'flat' | 'narrow' | 'shop'),
  footprint {w, d} in metres (or lot [x0, x1, y0, y1, z]: the town's lots), storeys (1-4),
  roof {type: gable | hip | irimoya | shed | flat, pitch_deg, eaves_m, verge_m, axis: x | y},
  palette {wall, wall2, trim, roof, accent} as #rrggbb (or a preset name), wear (0 new .. 1 old), seed,
  detail ('hero' | 'mid' | 'far': how much is modelled, the triangle budget), budget_tris,
  features {balconies, stair ('e' | 'w' | null), shop_front, ac_wall, ac_ground, meters, plants_door, plants_balcony,
            signage (text), window_style (plain | shutter | grille | hood | blind | mixed), lit (share of lit windows),
            two_tone, corner_boards, door_wood, pent_roofs (share of walls), gear},
  gaps {e, w}: metres to the neighbours (the town's), notes, revision_notes.
"""
import json
import random

PRESETS = {
    "harbour-cream": {"wall": "#efe2c8", "wall2": "#8a6448", "trim": "#ece6da", "roof": "#4a4d5c", "accent": "#2f5d8a"},
    "harbour-teal": {"wall": "#dfe1de", "wall2": "#9db3c2", "trim": "#ece6da", "roof": "#2f5d5a", "accent": "#c8483c"},
    "harbour-brick": {"wall": "#efcfb8", "wall2": "#5e4434", "trim": "#5a3a2c", "roof": "#7a3f36", "accent": "#2f3d66"},
    "concrete": {"wall": "#c4bfb6", "wall2": "#d3cdc0", "trim": "#e6e2d8", "roof": "#55566a", "accent": "#c8332b"},
    "realistic-plaster": {"wall": "#d9d2c3", "wall2": "#6b5545", "trim": "#e4e1da", "roof": "#3f4046", "accent": "#2b4c7e"},
}

KINDS = ("simple", "L", "stepped", "flat", "narrow", "shop")
ROOFS = ("gable", "hip", "irimoya", "shed", "flat")


def load(path):
    with open(path) as f:
        return json.load(f)


def _num(v, d, lo, hi):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return d
    return max(lo, min(hi, x))


def spec_of(brief, tier=None):
    b = brief
    r = random.Random(int(b.get("seed", 1)))
    style = b.get("style", "anime")
    kind = b.get("kind", "simple")
    if kind not in KINDS:
        kind = "simple"
    storeys = int(_num(b.get("storeys"), 2, 1, 4))
    if "lot" in b:
        lot = [float(v) for v in b["lot"]]
        if len(lot) == 4:
            lot.append(0.0)
    else:
        fp = b.get("footprint") or {}
        w = _num(fp.get("w"), 7.5, 3.5, 24)
        d = _num(fp.get("d"), 7.5, 3.5, 24)
        lot = [-w / 2, w / 2, -d / 2, d / 2, 0.0]
    rf = b.get("roof") or {}
    rtype = rf.get("type", "flat" if kind == "flat" else "gable")
    if rtype not in ROOFS:
        rtype = "gable"
    if kind == "flat":
        rtype = "flat"
    roof = {"type": rtype, "pitch": _num(rf.get("pitch_deg"), 27.0, 8, 45), "eaves": _num(rf.get("eaves_m"), 0.6, 0.15, 1.2),
            "verge": _num(rf.get("verge_m"), 0.45, 0.1, 1.0), "axis": rf.get("axis", "x") if rf.get("axis") in ("x", "y") else "x"}
    pal = b.get("palette") or "harbour-cream"
    palette = dict(PRESETS.get(pal, PRESETS["harbour-cream"])) if isinstance(pal, str) else dict(PRESETS["harbour-cream"], **{k: v for k, v in pal.items() if isinstance(v, str)})
    f = b.get("features") or {}
    tier = tier or b.get("detail", "hero")
    if tier not in ("hero", "mid", "far"):
        tier = "hero"
    feats = {
        "balconies": int(_num(f.get("balconies"), 1 if storeys >= 2 else 0, 0, 4)),
        "stair": f.get("stair") if f.get("stair") in ("e", "w") else None,
        "shop_front": bool(f.get("shop_front", kind == "shop")),
        "ac_wall": int(_num(f.get("ac_wall"), 1 if storeys >= 2 else 0, 0, 4)),
        "ac_ground": int(_num(f.get("ac_ground"), 1, 0, 3)),
        "meters": bool(f.get("meters", True)),
        "plants_door": int(_num(f.get("plants_door"), 2, 0, 6)),
        "plants_balcony": int(_num(f.get("plants_balcony"), 2, 0, 5)),
        "signage": str(f["signage"])[:28] if f.get("signage") else None,
        "window_style": f.get("window_style", "mixed") if f.get("window_style") in ("plain", "shutter", "grille", "hood", "blind", "mixed") else "mixed",
        "lit": _num(f.get("lit"), 0.25, 0, 1),
        "two_tone": bool(f.get("two_tone", r.random() < 0.4)),
        "corner_boards": bool(f.get("corner_boards", r.random() < 0.35)),
        "door_wood": bool(f.get("door_wood", r.random() < 0.5)),
        "pent_roofs": _num(f.get("pent_roofs"), 0.3, 0, 1),
        "gear": bool(f.get("gear", True)),
    }
    gaps = {k: float(v) for k, v in (b.get("gaps") or {}).items() if k in ("e", "w")}
    return {
        "id": b["id"], "name": b.get("name", b["id"]), "style": style if style in ("anime", "realistic") else "anime", "kind": kind,
        "storeys": storeys, "lot": lot, "roof": roof, "palette": palette, "palette_concrete": kind == "flat" and r.random() < 0.6,
        "wear": _num(b.get("wear"), 0.4, 0, 1), "seed": int(b.get("seed", 1)), "tier": tier,
        "budget": int(_num(b.get("budget_tris"), {"hero": 16000, "mid": 7000, "far": 3500}[tier], 1000, 200000)),
        "features": feats, "gaps": gaps, "notes": b.get("notes", ""),
    }


# Revision notes: plain directives a reviewer writes (the studio's assistant or a person).
DIRECTIVES = [
    (("more wear", "older", "dirtier", "more weathered"), ("wear", 0.2)), (("less wear", "newer", "cleaner"), ("wear", -0.2)),
    (("taller", "one more storey", "add a storey"), ("storeys", 1)), (("lower", "one storey less", "fewer storeys"), ("storeys", -1)),
    (("steeper roof",), ("pitch", 5.0)), (("flatter roof", "shallower roof"), ("pitch", -5.0)),
    (("deeper eaves",), ("eaves", 0.15)), (("shallower eaves", "shorter eaves"), ("eaves", -0.15)),
    (("more balconies", "add a balcony"), ("balconies", 1)), (("no balcon", "fewer balconies"), ("balconies", -1)),
    (("more plants", "greener"), ("plants", 2)), (("fewer plants", "no plants"), ("plants", -2)),
    (("more lit windows", "more lights"), ("lit", 0.15)), (("darker windows", "fewer lights"), ("lit", -0.15)),
    (("fewer triangles", "lighter", "cheaper"), ("tier", -1)), (("more detail",), ("tier", 1)),
    (("shutters",), ("window_style", "shutter")), (("grilles",), ("window_style", "grille")), (("plain windows",), ("window_style", "plain")),
    (("add a stair", "external stair"), ("stair", "e")), (("no stair",), ("stair", None)),
    (("another seed", "different layout", "reshuffle"), ("seed", 1)),
]


def apply_notes(spec, notes):
    n = (notes or "").lower()
    applied = []
    tiers = ["far", "mid", "hero"]
    for words, (key, val) in DIRECTIVES:
        if not any(w in n for w in words):
            continue
        applied.append(key)
        f = spec["features"]
        if key == "wear":
            spec["wear"] = max(0.0, min(1.0, spec["wear"] + val))
        elif key == "storeys":
            spec["storeys"] = max(1, min(4, spec["storeys"] + val))
        elif key == "pitch":
            spec["roof"]["pitch"] = max(8.0, min(45.0, spec["roof"]["pitch"] + val))
        elif key == "eaves":
            spec["roof"]["eaves"] = max(0.15, min(1.2, spec["roof"]["eaves"] + val))
        elif key == "balconies":
            f["balconies"] = max(0, min(4, f["balconies"] + val))
        elif key == "plants":
            f["plants_door"] = max(0, min(6, f["plants_door"] + val))
            f["plants_balcony"] = max(0, min(5, f["plants_balcony"] + val // 2))
        elif key == "lit":
            f["lit"] = max(0.0, min(1.0, f["lit"] + val))
        elif key == "tier":
            i = max(0, min(2, tiers.index(spec["tier"]) + val))
            spec["tier"] = tiers[i]
            spec["budget"] = {"hero": 16000, "mid": 7000, "far": 3500}[spec["tier"]]
        elif key == "window_style":
            f["window_style"] = val
        elif key == "stair":
            f["stair"] = val
        elif key == "seed":
            spec["seed"] += 1
    return applied
