"""The building kit's house generator: a spec (from a brief, `brief.py`) in, one building's mesh (`kit.K`) and its record
out.

Order (the method's): massing (blocks from the footprint, storeys and kind) -> roofs -> the facade plan (every opening
and wall fitting placed on a face before anything is built, so nothing lands on anything: a door, shop bays, balconies
and their doors, a stair and its landing door, downpipes at the gutter ends, wall units, meters, then windows storey by
storey in what is left) -> walls cut around the openings -> what is set in them -> lived-in detail.

The record matches what Cloudwatch's prop pass reads (`town.HOUSES`): footprint, door, blocks, balconies (laundry goes
on them), `kit: True` (the kit placed its own outdoor units, plants and meters), the roofs' ridge lines for roof gear.
"""
import math
import random

import facade as F
import lived as L
import roofs as R
from kit import Face, K as Builder

STOREY = 2.9
PLINTH = 0.3
# The low sun of Cloudwatch (az 214 degrees): its horizontal direction, for the moss on the shaded slopes.
SUN = (math.sin(math.radians(214.0)), math.cos(math.radians(214.0)))

TIER_BUDGET = {"hero": 16000, "mid": 7000, "far": 3500}


def block_faces(b):
    return {
        "s": Face((0, -1), b["y0"], b["x0"], b["x1"], b["z0"], b["z1"]),
        "n": Face((0, 1), b["y1"], b["x0"], b["x1"], b["z0"], b["z1"]),
        "w": Face((-1, 0), b["x0"], b["y0"], b["y1"], b["z0"], b["z1"]),
        "e": Face((1, 0), b["x1"], b["y0"], b["y1"], b["z0"], b["z1"]),
    }


def _inside(blocks, me, x, y, z, pad=0.05, above=2.5):
    for b in blocks:
        if b is me:
            continue
        if b["x0"] - pad < x < b["x1"] + pad and b["y0"] - pad < y < b["y1"] + pad and b["z0"] - 0.1 < z < b["z1"] + above:
            return True
    return False


def _strictly_inside(blocks, me, x, y, z):
    for b in blocks:
        if b is me:
            continue
        if b["x0"] < x < b["x1"] and b["y0"] < y < b["y1"] and b["z0"] <= z < b["z1"]:
            return True
    return False


# ---------------------------------------------------------------------------------------------------------------- massing

def massing(spec, r):
    X0, X1, Y0, Y1 = spec["lot"][:4]
    z = spec["lot"][4]
    W, D = X1 - X0, Y1 - Y0
    kind = spec["kind"]
    st = spec["storeys"]
    roof = spec["roof"]["type"]
    blocks = []

    def B(x0, x1, y0, y1, z0, storeys, roof="gable_x", wall="wall", upper=False):
        zb = z0 + (0 if upper else PLINTH)
        b = {"x0": x0, "x1": x1, "y0": y0, "y1": y1, "z0": z0, "zb": zb, "z1": zb + STOREY * storeys, "storeys": storeys, "roof": roof,
             "wall_role": wall, "upper": upper}
        blocks.append(b)
        return b

    def pitched(default_axis="x"):
        if roof == "gable":
            return "gable_" + spec["roof"].get("axis", default_axis)
        if roof == "shed":
            return "shed_n"
        return roof

    if kind == "simple":
        B(X0, X1, Y0, Y1, z, st, roof=pitched())
    elif kind == "narrow":
        B(X0, X1, Y0, Y1, z, st, roof="gable_y" if roof == "gable" else pitched("y"))
    elif kind == "L":
        dm = D * r.uniform(0.52, 0.62)
        B(X0, X1, Y0, Y0 + dm, z, max(st, 2), roof=pitched())
        ww = W * r.uniform(0.42, 0.55)
        st2 = max(1, st - 1) if r.random() < 0.6 else st
        if r.random() < 0.5:
            B(X0, X0 + ww, Y0 + dm, Y1, z, st2, roof="gable_y")
        else:
            B(X1 - ww, X1, Y0 + dm, Y1, z, st2, roof="gable_y")
    elif kind == "stepped":
        lo = B(X0, X1, Y0, Y1, z, 1, roof="hip")
        sb = r.uniform(1.6, 2.6)
        xi = r.uniform(0, 1.4)
        up_st = max(1, st - 1)
        if r.random() < 0.5:
            up = B(X0 + xi, X1 - (1.4 - xi) * 0.5, Y0, Y1 - sb, lo["z1"], up_st, roof=pitched(), upper=True)
        else:
            up = B(X0 + xi, X1 - 0.2, Y0 + sb * 0.5, Y1 - sb * 0.5, lo["z1"], up_st, roof=pitched(), upper=True)
        lo["roof"] = "terrace" if r.random() < 0.4 else "skirt"
        lo["up"] = up
    elif kind == "flat":
        main = B(X0, X1, Y0, Y1 - (0 if r.random() < 0.6 else 1.6), z, st, roof="flat", wall="concrete" if spec["palette_concrete"] else "wall")
        if main["y1"] < Y1 - 0.5:
            B(X0 + 0.6, X0 + W * 0.55, main["y1"], Y1, z, 1, roof="shed_s", wall="wall2")
    elif kind == "shop":
        B(X0, X1, Y0, Y1, z, max(2, st), roof=pitched())
    else:
        raise ValueError(f"unknown kind {kind}")
    return blocks


# ---------------------------------------------------------------------------------------------------------------- the plan

class FacePlan:
    """The openings and fittings of one wall face, as (u0, u1, z0, z1) rectangles."""

    def __init__(self, face, block):
        self.face, self.block = face, block
        self.openings = []
        self.taken = []

    def free(self, u0, u1, z0, z1, margin=0.2):
        f = self.face
        if u0 < f.u0 + 0.25 or u1 > f.u1 - 0.25:
            return False
        for (a, b, c, d) in self.taken:
            if u0 < b + margin and a - margin < u1 and z0 < d + margin and c - margin < z1:
                return False
        return True

    def take(self, u0, u1, z0, z1):
        self.taken.append((u0, u1, z0, z1))

    def open(self, o):
        o.setdefault("depth", 0.12)
        self.openings.append(o)
        self.take(o["u0"], o["u1"], o["z0"], o["z1"])
        return o


def build(spec, lib, ground=None, service_to=None, gear=True):
    """Build one building. `ground(x, y)` gives the terrain height (default: the lot's level); `service_to` a point a
    service wire runs to (a pole's insulator); `gear`: antennas and the like (the town places its own)."""
    r = random.Random(spec["seed"])
    tier = spec["tier"]
    K = Builder(lib, tier)
    z = spec["lot"][4]
    X0, X1, Y0, Y1 = spec["lot"][:4]
    ground = ground or (lambda x, y: z)
    feats = spec["features"]
    blocks = massing(spec, r)
    for b in blocks:
        b["wall"] = lib(b["wall_role"])
    two_tone = feats["two_tone"] and spec["kind"] not in ("flat",)
    plan = {
        "r": r, "sun": SUN, "wear": spec["wear"], "tiles": tier != "far" or spec["roof"].get("tiles", True), "eave_tiles": tier == "hero",
        "detail": tier, "gable_wall": lib("wall"), "curtains": 0.55, "lit": feats["lit"], "door_wood": feats["door_wood"],
        "style_panel": r.random() < 0.6,
    }
    rec = {"name": spec["id"], "x": (X0 + X1) / 2, "y": (Y0 + Y1) / 2, "w": X1 - X0, "d": Y1 - Y0, "z": z, "front": -1,
           "kind": spec["kind"], "balconies": [], "sills": [], "ac_spots": [], "kit": True, "tier": tier,
           "blocks": [(b["x0"], b["x1"], b["y0"], b["y1"], b["z1"]) for b in blocks]}

    def mat_for(b):
        def at(zc):
            if two_tone and not b["upper"] and b["storeys"] >= 2 and zc < b["zb"] + STOREY:
                return lib("wall2")
            if two_tone and not b["upper"] and b["storeys"] == 1:
                return lib("wall2")
            return b["wall"]
        at.splits = (b["zb"] + STOREY,) if two_tone and not b["upper"] and b["storeys"] >= 2 else ()
        return at

    # ------------------------------------------------------------------------------------------------ roofs
    roof_top = z
    infos = []
    pitch = spec["roof"]["pitch"]
    eaves = spec["roof"]["eaves"]
    verge = spec["roof"]["verge"]
    for b in blocks:
        kr = b["roof"]
        plan["gable_wall"] = b["wall"]
        if kr in ("gable_x", "gable_y"):
            t, info = R.gable(K, b, kr[-1], pitch + r.uniform(-2, 2), eaves, verge, plan)
            infos.append((b, info))
        elif kr in ("hip", "irimoya"):
            t, info = R.hip(K, b, pitch + r.uniform(-2, 1), eaves, plan, irimoya=(kr == "irimoya"))
            infos.append((b, info))
        elif kr == "flat":
            t = R.flat(K, b, plan, rail=r.random() < 0.4)
            b["deck"] = t
        elif kr == "terrace":
            t = R.flat(K, b, plan, rail=False)
            b["deck"] = t
        elif kr.startswith("shed"):
            t = R.shed(K, b, kr[-1], 12.0, 0.45, plan)
        elif kr == "skirt":
            t = _skirts(K, b, b["up"], plan)
        else:
            t = b["z1"]
        roof_top = max(roof_top, t)

    # ------------------------------------------------------------------------------------------------ facade plan
    fps = {}
    for bi, b in enumerate(blocks):
        for side, f in block_faces(b).items():
            f.z0 = b["zb"]
            fps[(bi, side)] = FacePlan(f, b)
    reserved = []  # world boxes (x0, x1, y0, y1, z0, z1) of what stands out of the walls

    def clear_world(f, b, u, zc, half, out=0.45):
        for uu in (u - half, u, u + half):
            x, y, _ = f.pt(uu, zc, out)
            if _inside(blocks, b, x, y, zc):
                return False
            for (rx0, rx1, ry0, ry1, rz0, rz1) in reserved:
                if rx0 < x < rx1 and ry0 < y < ry1 and rz0 < zc < rz1:
                    return False
        return True

    fronts = [(bi, b) for bi, b in enumerate(blocks) if abs(b["y0"] - Y0) < 0.01 and not b["upper"]]
    fbi, fb = max(fronts, key=lambda t: t[1]["x1"] - t[1]["x0"])
    fw = fb["x1"] - fb["x0"]
    ffp = fps[(fbi, "s")]
    zb = fb["zb"]
    door = None
    shop_bays = []
    if spec["kind"] == "shop" or feats["shop_front"]:
        # A glazed bay (lit), the door, a roll-up shutter on what is left.
        gw = max(1.6, min(3.2, fw * 0.36))
        a = fb["x0"] + 0.45
        shop_bays.append(ffp.open({"u0": a, "u1": a + gw, "z0": zb + 0.08, "z1": zb + 2.3, "depth": 0.18, "kind": "glass"}))
        dx = a + gw + 0.25 + 0.75
        door = ffp.open({"u0": dx - 0.75, "u1": dx + 0.75, "z0": zb, "z1": zb + 2.35, "depth": 0.3, "kind": "genkan"})
        b2 = fb["x1"] - 0.45
        if b2 - (dx + 1.0) > 1.3:
            shop_bays.append(ffp.open({"u0": dx + 1.0, "u1": b2, "z0": zb, "z1": zb + 2.3, "depth": 0.12, "kind": "shutter" if r.random() < 0.7 else "glass"}))
        door_x = dx
        ffp.take(fb["x0"], fb["x1"], zb, zb + 2.7)
    else:
        door_x = (fb["x0"] + fb["x1"]) / 2 + r.uniform(-fw / 4, fw / 4)
        door_x = max(fb["x0"] + 1.4, min(fb["x1"] - 1.4, door_x))
        kind = "steel" if spec["kind"] == "flat" and r.random() < 0.5 else "genkan"
        if kind == "genkan":
            door = ffp.open({"u0": door_x - 0.85, "u1": door_x + 0.85, "z0": zb, "z1": zb + 2.35, "depth": 0.3, "kind": "genkan"})
        else:
            door = ffp.open({"u0": door_x - 0.48, "u1": door_x + 0.48, "z0": zb, "z1": zb + 2.05, "depth": 0.12, "kind": "steel"})
        ffp.take(door_x - 1.25, door_x + 1.25, zb, zb + 2.75)  # lamp, plate, canopy
    reserved.append((door_x - 1.3, door_x + 1.3, Y0 - 1.0, Y0 + 0.4, z, zb + 3.1))
    rec["door_x"] = door_x

    # Balconies on upper storeys: mostly on the back (the side the lookout sees), some on the front.
    balconies = []
    nbal = feats["balconies"]
    for bi, b in enumerate(blocks):
        if len(balconies) >= nbal:
            break
        if b["storeys"] < 2 and not b["upper"]:
            continue
        for side in ("n", "s"):
            if len(balconies) >= nbal:
                break
            if r.random() > (0.75 if side == "n" else 0.45):
                continue
            fp = fps[(bi, side)]
            f = fp.face
            if f.length < 3.0:
                continue
            ln = min(f.length - 0.9, r.uniform(2.4, 4.4))
            u = r.uniform(f.u0 + 0.45 + ln / 2, f.u1 - 0.45 - ln / 2)
            if b["upper"]:
                if b["storeys"] < 2:
                    continue
                zf = b["zb"] + STOREY
            else:
                zf = b["zb"] + STOREY * (1 if b["storeys"] < 3 or r.random() < 0.5 else 2)
            if not clear_world(f, b, u, zf + 1.0, ln / 2):
                continue
            if not fp.free(u - ln / 2, u + ln / 2, zf - 0.3, zf + 2.0, margin=0.1):
                continue
            dep = 0.95
            fp.take(u - ln / 2 - 0.1, u + ln / 2 + 0.1, zf - 0.35, zf + 2.1)
            balconies.append((fp, u, zf, ln, dep, b["roof"] == "flat" or r.random() < 0.35))
            reserved.append(_rect(f, u, ln / 2 + 0.3, -0.5, dep + 0.3) + (zf - 0.5, zf + 2.4))
            break

    # The external stair up a side wall (flat blocks and some two-storey houses) to a landing door.
    main = blocks[0]
    stair = None
    side = feats["stair"]
    if side and main["storeys"] >= 2 and (main["y1"] - main["y0"]) > 6.2:
        gap = spec["gaps"].get(side, 99)
        if gap > 2.3:
            stair = side
    if stair:
        sfp = fps[(0, stair)]
        zt = main["zb"] + STOREY - 0.05
        yl = main["y0"] + 1.05
        sfp.open({"u0": yl - 0.45, "u1": yl + 0.45, "z0": zt, "z1": zt + 2.0, "depth": 0.1, "kind": "steel"})
        sfp.take(main["y0"], main["y1"], main["z0"], zt + 2.3)

    # Downpipes at the gutter ends of the pitched ground blocks (one at the back, one at a front corner on hero).
    pipes = []
    for b, info in infos:
        if b["upper"]:
            continue
        bi = blocks.index(b)
        for g in info.get("gutters", []):
            if info["axis"] == "x":
                side_ = "n" if g["a"] > (b["y0"] + b["y1"]) / 2 else "s"
                if side_ == "s" and tier != "hero":
                    continue
                cand = [b["x1"] - 0.3, b["x0"] + 0.3]
            else:
                side_ = "e" if g["a"] > (b["x0"] + b["x1"]) / 2 else "w"
                cand = [b["y1"] - 0.3, b["y0"] + 0.3]
            if stair == side_ and bi == 0:
                continue  # the stair runs up that wall
            fp = fps[(bi, side_)]
            off = abs(g["a"] - fp.face.p)
            r.shuffle(cand)
            for u in cand:
                if abs(u - door_x) < 1.6 and side_ == "s":
                    continue
                x, y, _ = fp.face.pt(u, b["zb"] + 1.0, 0.3)
                if _inside(blocks, b, x, y, b["zb"] + 1.0) or any(rx0 < x < rx1 and ry0 < y < ry1 for (rx0, rx1, ry0, ry1, _, _) in reserved):
                    continue
                fp.take(u - 0.12, u + 0.12, b["z0"], g["z"])
                pipes.append((fp, u, g["z"], off))
                break

    # Outdoor units on the walls of the upper storeys (with their pipe covers), meters by the door.
    acs = []
    for (bi, sd), fp in fps.items():
        b = fp.block
        if len(acs) >= feats["ac_wall"]:
            break
        if b["storeys"] < 2 or sd == "s" and r.random() < 0.6:
            continue
        zc = b["zb"] + STOREY + 0.55
        f = fp.face
        for _ in range(6):
            u = r.uniform(f.u0 + 0.8, f.u1 - 0.8)
            if fp.free(u - 0.55, u + 0.95, zc - 0.75, zc + 1.4, margin=0.15) and clear_world(f, b, u, zc, 0.5):
                fp.take(u - 0.55, u + 0.95, zc - 0.75, zc + 1.4)
                acs.append((fp, u, zc))
                break
    ground_acs = []
    for (bi, sd), fp in fps.items():
        if len(ground_acs) >= feats["ac_ground"]:
            break
        b = fp.block
        if b["upper"] or sd == "s":
            continue
        if sd in ("e", "w") and (spec["gaps"].get(sd, 99) < 1.6 or stair == sd):
            continue
        f = fp.face
        H = 0.58
        for _ in range(5):
            u = r.uniform(f.u0 + 0.8, f.u1 - 0.8)
            zg = ground(*f.pt(u, 0, 0.2)[:2])
            zc = zg + 0.18 + H / 2
            if fp.free(u - 0.55, u + 0.95, b["z0"] - 0.1, zc + 1.3, margin=0.1) and clear_world(f, b, u, zc, 0.5, out=0.25):
                fp.take(u - 0.55, u + 0.95, b["z0"] - 0.1, zc + 1.3)
                ground_acs.append((fp, u, zc))
                reserved.append(_rect(f, u, 0.55, 0.0, 0.5) + (z - 0.5, zc + 0.5))
                break
    meter = None
    if feats["meters"] and tier != "far":
        for sd in ("e", "w", "s"):
            fp = fps.get((fbi, sd))
            f = fp.face
            u = (f.u0 + 0.75) if sd in ("e",) else (f.u1 - 0.75) if sd == "w" else (door_x + (1.9 if door_x + 2.4 < f.u1 else -1.9))
            if sd in ("e", "w") and (spec["gaps"].get(sd, 99) < 1.2 or stair == sd):
                continue
            if fp.free(u - 0.35, u + 0.35, zb + 0.6, zb + 2.0, margin=0.05) and fp.free(u - 0.95, u + 0.95, zb + 1.4, zb + 2.0, margin=0.0):
                fp.take(u - 0.95, u + 0.95, zb + 0.5, zb + 2.1)
                meter = (fp, u)
                break

    # Pent roofs over the ground floor on some two-storey walls (not the front block's front).
    pents = []
    for bi, b in enumerate(blocks):
        if b["storeys"] < 2 or b["roof"] == "flat" or b["upper"]:
            continue
        for sd, fp in ((s_, fps[(bi, s_)]) for s_ in ("s", "n", "e", "w")):
            if sd == "s" and b is fb:
                continue
            if r.random() > feats["pent_roofs"]:
                continue
            f = fp.face
            zp = b["zb"] + STOREY - 0.12
            if not fp.free(f.u0 + 0.26, f.u1 - 0.26, zp - 0.2, zp + 0.3, margin=0.0):
                continue
            if any(_inside(blocks, b, *f.pt(u, zp, 0.3)) for u in (f.u0 + 0.3, (f.u0 + f.u1) / 2, f.u1 - 0.3)):
                continue
            pr = _rect(f, (f.u0 + f.u1) / 2, f.length / 2 + 0.1, 0.0, 0.8)
            if any(rz0 < zp + 0.2 and zp - 0.4 < rz1 and pr[0] < rx1 and rx0 < pr[1] and pr[2] < ry1 and ry0 < pr[3] for (rx0, rx1, ry0, ry1, rz0, rz1) in reserved):
                continue
            fp.take(f.u0, f.u1, zp - 0.3, zp + 0.25)
            pents.append((fp, zp))
            reserved.append(pr + (zp - 0.35, zp + 0.3))

    def _try_window(fp, f, b, u, ww, wh, zc, zst, s, sd):
        style = wstyle if wstyle != "mixed" else r.choice(["plain", "shutter", "shutter", "hood", "blind", "plain"])
        if s == 0 and sd == "s" and r.random() < 0.45:
            style = "grille"
        elif r.random() < 0.2:
            style = r.choice(["plain", "hood", "blind", "shutter", "grille"])
        if style == "shutter" and ww > 1.4:
            style = "plain"
        if style == "grille" and ww > 1.3 and s > 0:
            style = "plain"
        lo, hi = u - ww / 2, u + ww / 2
        ext_lo, ext_hi = lo - 0.1, hi + 0.1
        shutter_side = 1
        if style == "shutter":
            if fp.free(lo - 0.1, hi + ww / 2 + 0.25, zc - wh / 2 - 0.25, zc + wh / 2 + 0.3):
                ext_hi = hi + ww / 2 + 0.25
            elif fp.free(lo - ww / 2 - 0.25, hi + 0.1, zc - wh / 2 - 0.25, zc + wh / 2 + 0.3):
                ext_lo, shutter_side = lo - ww / 2 - 0.25, -1
            else:
                style = "plain"
        if style == "hood":
            ext_lo, ext_hi = lo - 0.25, hi + 0.25
        if not fp.free(ext_lo, ext_hi, zc - wh / 2 - 0.12, zc + wh / 2 + (0.35 if style == "hood" else 0.12)):
            return False
        if not clear_world(f, b, u, zc, ww / 2 + 0.2):
            return False
        if any(_strictly_inside(blocks, b, *f.pt(uu, zz, 0.05)) for uu in (lo, hi) for zz in (zc - wh / 2, zc + wh / 2)):
            return False
        o = fp.open({"u0": lo, "u1": hi, "z0": zc - wh / 2, "z1": zc + wh / 2, "depth": 0.12 if tier != "far" else 0.08, "kind": "window",
                     "style": style, "shutter_side": shutter_side, "zb": zst})
        fp.take(ext_lo, ext_hi, zc - wh / 2 - 0.12, zc + wh / 2 + 0.12)
        windows.append((fp, o))
        return True

    # Windows on every free wall, storey by storey.
    wstyle = feats["window_style"]
    windows = []
    for (bi, sd), fp in fps.items():
        b = fp.block
        f = fp.face
        for s in range(b["storeys"]):
            zst = b["zb"] + STOREY * s
            n = max(1, int((f.length + 0.2) / (2.5 if tier == "hero" else 2.9)))
            for k in range(n):
                if r.random() < 0.1 and n > 1:
                    continue
                u = f.u0 + (k + 0.5) * f.length / n + r.uniform(-0.15, 0.15)
                big = r.random()
                sizes = [(1.65, 1.15, zst + 1.45), (1.2, 1.15, zst + 1.45), (0.62, 0.52, zst + 1.85)]
                first = 0 if big < 0.4 else 1 if big < 0.75 else 2
                # The chosen size first, then the smaller ones (a hero facade keeps its windows where a big one will not fit).
                for ww, wh, zc in sizes[first:] if tier == "hero" else sizes[first:first + 1]:
                    if ww > f.length / n - 0.6:
                        ww = max(0.6, f.length / n - 0.7)
                    if _try_window(fp, f, b, u, ww, wh, zc, zst, s, sd):
                        break

    # Openings of the balconies (their doors) go in before the walls are cut.
    bal_doors = []
    for (fp, u, zf, ln, dep, solid) in balconies:
        dw = min(ln - 0.5, 1.8)
        bal_doors.append(fp.open({"u0": u - dw / 2, "u1": u + dw / 2, "z0": zf + 0.02, "z1": zf + 1.95, "depth": 0.1, "kind": "balcony"}))

    # ------------------------------------------------------------------------------------------------ walls
    for bi, b in enumerate(blocks):
        if not b["upper"]:
            # Plinth.
            K.box(((b["x0"] + b["x1"]) / 2, (b["y0"] + b["y1"]) / 2, b["z0"] - 0.1 + (PLINTH + 0.1) / 2), (b["x1"] - b["x0"] + 0.1, b["y1"] - b["y0"] + 0.1, PLINTH + 0.1), lib("plinth"), skip=("bottom",), grime=0.8)
        mat_at = mat_for(b)
        pitched = b["roof"] not in ("flat", "terrace")
        for sd in ("s", "n", "w", "e"):
            fp = fps[(bi, sd)]
            f = fp.face

            def hidden(u, zz, f=f, b=b):
                return _strictly_inside(blocks, b, *f.pt(u, zz, 0.05))
            F.wall(K, f, b["zb"], b["z1"], fp.openings, mat_at, hidden, soot=pitched, foot_grime=not b["upper"])
            # The dark crease under the eaves and the storey bands.
            if pitched:
                with K.no_outline():
                    K.fbox(f, (f.u0 + f.u1) / 2, b["z1"] - 0.07, f.length + 0.02, 0.025, 0.12, 0.0125, lib("crease"), bottom=False)
            for s in range(1, b["storeys"]):
                zz = b["zb"] + STOREY * s - 0.15
                if hidden((f.u0 + f.u1) / 2, zz):
                    continue
                K.fbox(f, (f.u0 + f.u1) / 2, zz, f.length + 0.12, 0.06, 0.12, 0.03, lib("trim"))
            if feats["corner_boards"] and tier != "far":
                for cu in (f.u0 + 0.05, f.u1 - 0.05):
                    if not hidden(cu, b["zb"] + 1.0):
                        K.fbox(f, cu, (b["zb"] + b["z1"]) / 2, 0.1, 0.025, b["z1"] - b["zb"] - 0.15, 0.0125, lib("trim"), bottom=False)

    # ------------------------------------------------------------------------------------------------ set in the walls
    for fp, o in windows:
        lit = r.random() < feats["lit"]
        F.window(K, fp.face, o, o["style"], lit, plan, r, mat_for(fp.block)(o["z0"] + 0.01))
    gk = None
    if door["kind"] == "genkan":
        gk = F.genkan(K, ffp.face, door, plan, r, mat_for(fb)(zb + 0.5), ground)
        if not shop_bays:
            if r.random() < 0.55:
                F.canopy(K, ffp.face, door_x, zb + 2.62, 2.3, 0.85, plan)
            else:
                R.pent(K, ffp.face, zb + 2.85, 0.8, door_x - 1.2, door_x + 1.2, plan)
    else:
        F.steel_door(K, ffp.face, door, plan, mat_for(fb)(zb + 0.5))
        F.canopy(K, ffp.face, door_x, zb + 2.3, 1.5, 0.7, plan)
    if shop_bays:
        F.shop_front(K, ffp.face, shop_bays, zb, plan, r, mat_for(fb)(zb + 0.5))
        F.awning(K, ffp.face, fb["x0"] + 0.1, fb["x1"] - 0.1, zb + 2.75, zb + 2.35, 1.15, plan)
        F.noren(K, ffp.face, door_x, zb + 1.95, 1.2, plan)
    for (fp, u, zf, ln, dep, solid), o in zip(balconies, bal_doors):
        F.balcony(K, fp.face, u, zf, ln, dep, solid, plan, r, mat_for(fp.block)(zf + 0.5), False)
        F.sliding_door(K, fp.face, o, plan, r, mat_for(fp.block)(zf + 0.5), r.random() < feats["lit"])
        cx, cy, _ = fp.face.pt(u, zf, dep / 2)
        brec = {"x": cx, "y": cy, "z": zf, "len": ln, "dep": dep, "nx": fp.face.n[0], "ny": fp.face.n[1], "solid": solid}
        # An outdoor unit at one end of some balconies (the dressing hangs laundry clear of it).
        if r.random() < 0.55 and ln > 2.6:
            t = r.choice((-1, 1)) * (ln / 2 - 0.5)
            L.ac_unit(K, fp.face, u + t, zf + 0.07 + 0.29, plan, r, bracket=False, ground=None, pipe_to=zf + 1.6, side=1 if t > 0 else -1)
            brec["ac_at"] = t
        if tier != "far":
            for k in range(feats["plants_balcony"]):
                t = r.uniform(-ln / 2 + 0.35, ln / 2 - 0.35)
                if "ac_at" in brec and abs(t - brec["ac_at"]) < 0.8:
                    continue
                px, py, _ = fp.face.pt(u + t, zf, dep - 0.22)
                L.plant(K, (px, py, zf), r.choice(["shrub", "flowers", "tall"]), r, scale=r.uniform(0.75, 1.0))
        rec["balconies"].append(brec)
    if stair:
        res, yl = F.steel_stair(K, main, stair, plan, ground, main["zb"] + STOREY - 0.05)
        reserved.append(res)
        rec["stair_side"] = stair
        for o in fps[(0, stair)].openings:
            if o["kind"] == "steel":
                F.steel_door(K, fps[(0, stair)].face, o, plan, main["wall"])
                F.canopy(K, fps[(0, stair)].face, (o["u0"] + o["u1"]) / 2, o["z1"] + 0.25, 1.3, 0.6, plan)
    for fp, zp in pents:
        f = fp.face
        R.pent(K, f, zp, 0.7, f.u0 - 0.1, f.u1 + 0.1, plan)

    # ------------------------------------------------------------------------------------------------ lived-in detail
    for fp, u, zt, off in pipes:
        L.downpipe(K, fp.face, u, zt, fp.block["z0"], off, plan, ground(*fp.face.pt(u, 0, 0.2)[:2]))
    for fp, u, zc in acs:
        L.ac_unit(K, fp.face, u, zc, plan, r, bracket=True, pipe_to=zc + r.uniform(0.6, 1.3), side=1)
    for fp, u, zc in ground_acs:
        L.ac_unit(K, fp.face, u, zc, plan, r, bracket=False, ground=True, pipe_to=zc + 0.9, side=1)
    if meter:
        fp, u = meter
        eu = L.meters(K, fp.face, u, zb, plan, r, ground(*fp.face.pt(u, 0, 0.1)[:2]))
        top = fp.block["z1"] - 0.25
        L.conduit(K, fp.face, eu, zb + 1.84, top, plan)
        if service_to is not None and tier != "far":
            a = fp.face.pt(eu, top + 0.1, 0.16)
            L.wire(K, a, service_to, sag=0.35)
    # Plants by the door.
    if tier != "far":
        for k in range(feats["plants_door"]):
            side_ = 1 if k % 2 == 0 else -1
            u = door_x + side_ * (r.uniform(1.15, 1.45) + 0.6 * (k // 2))
            if u < fb["x0"] + 0.2 or u > fb["x1"] - 0.2:
                continue
            px, py, _ = ffp.face.pt(u, 0, 0.32 + 0.12 * (k // 2))
            L.plant(K, (px, py, ground(px, py)), r.choice(["shrub", "tall", "flowers"]), r, scale=r.uniform(0.85, 1.25))
    # Signage.
    if feats["signage"]:
        sz_ = zb + 2.62 + 0.55 if not shop_bays else zb + 3.1
        if fb["storeys"] >= 2 and not any(bd for bd in rec["balconies"] if bd["ny"] == -1):
            L.signboard(K, ffp.face, door_x if not shop_bays else (fb["x0"] + fb["x1"]) / 2, sz_, feats["signage"], plan, height=0.42 if shop_bays else 0.3,
                        max_w=fw - 0.8)
    # Roof gear (for buildings on their own; the town places its own on `rec["roofs"]`).
    rec["roofs"] = []
    for b, info in infos:
        rec["roofs"].append({k: info[k] for k in ("axis", "c", "half", "ov", "ze", "zr", "th", "tp", "e0", "e1", "ridge_z") if k in info} | ({"r0": info["r0"], "r1": info["r1"], "hip": True} if info.get("hip") else {}))
        if gear and feats["gear"] and r.random() < 0.6:
            t = r.uniform(0.15, 0.4)
            e0, e1 = (info["r0"], info["r1"]) if info.get("hip") else (info["e0"] + 0.6, info["e1"] - 0.6)
            al = e0 + (e1 - e0) * t
            pos = (al, info["c"]) if info["axis"] == "x" else (info["c"], al)
            L.antenna(K, pos[0], pos[1], info["ridge_z"] - 0.02, r)
    for b in blocks:
        if b["roof"] == "flat" and "deck" in b:
            x0, x1, y0, y1 = b["x0"] + 0.9, b["x1"] - 0.9, b["y0"] + 0.9, b["y1"] - 0.9
            if x1 - x0 > 1.5 and y1 - y0 > 1.5:
                # A stair house on the deck.
                sx = x0 + 0.6 if r.random() < 0.5 else x1 - 0.6
                K.box((sx, y1 - 0.75, b["deck"] + 1.2), (2.2, 2.5, 2.4), b["wall"], skip=("bottom",))
                K.box((sx, y1 - 0.75, b["deck"] + 2.46), (2.4, 2.7, 0.12), lib("trim"))
                hf = Face((0, -1), y1 - 2.0, sx - 1.1, sx + 1.1, b["deck"], b["deck"] + 2.4)
                F.steel_door(K, hf, {"u0": sx - 0.42, "u1": sx + 0.42, "z0": b["deck"], "z1": b["deck"] + 1.95, "depth": 0.06}, plan, b["wall"])
                roof_top = max(roof_top, b["deck"] + 2.52)
                rec["deck_free"] = ((x0 + x1) / 2, y0 + 0.3, b["deck"])
                # An outdoor unit on the deck.
                df = Face((0, 1), y0 - 0.9 + 0.18, x0, x1, b["deck"], b["deck"] + 1)
                L.ac_unit(K, df, (x0 + x1) / 2 + (1.2 if sx < (x0 + x1) / 2 else -1.2), b["deck"] + 0.07 + 0.29, plan, r, bracket=False, ground=None, pipe_to=None, duct=False)
        if b["roof"] == "terrace":
            rec["balconies"].append({"x": (b["x0"] + b["x1"]) / 2, "y": b["y1"] - 0.9, "z": b["deck"], "len": min(3.0, b["x1"] - b["x0"] - 1.2),
                                     "dep": 1.4, "nx": 0, "ny": 1, "solid": True, "deck": True})
    K.finish()
    rec.update({"h": max(b["z1"] for b in blocks) - z, "storeys": max(b["storeys"] for b in blocks), "roof_top": roof_top,
                "triangles": K.triangles(), "windows": len(windows), "lot": list(spec["lot"])})
    return K, rec


def _rect(face, u, half, out0, out1):
    xa, ya, _ = face.pt(u - half, 0, out0)
    xb, yb, _ = face.pt(u + half, 0, out1)
    return (min(xa, xb), max(xa, xb), min(ya, yb), max(ya, yb))


def _skirts(K, lo, up, plan):
    """Lean-to roofs over the parts of a lower block the (set back) upper block leaves open."""
    top = lo["z1"]
    strips = []
    if lo["y1"] - up["y1"] > 0.3:
        strips.append(((lo["x0"], lo["x1"], up["y1"], lo["y1"]), "s"))
    if up["y0"] - lo["y0"] > 0.3:
        strips.append(((lo["x0"], lo["x1"], lo["y0"], up["y0"]), "n"))
    if up["x0"] - lo["x0"] > 0.3:
        strips.append(((lo["x0"], up["x0"], up["y0"], up["y1"]), "e"))
    if lo["x1"] - up["x1"] > 0.3:
        strips.append(((up["x1"], lo["x1"], up["y0"], up["y1"]), "w"))
    t = top
    for (x0, x1, y0, y1), high in strips:
        sb = {"x0": x0, "x1": x1, "y0": y0, "y1": y1, "z1": top, "wall": lo["wall"]}
        t = max(t, R.shed(K, sb, high, 16.0, 0.5, plan, walls=high in ("n", "s")))
    return t
