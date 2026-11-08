"""Walls and what is set in them: the building kit's facade pass.

A wall face is a grid of quads cut around its openings, so every window and door is a real hole with a reveal (the
wall's thickness, 10-35 cm), its frame and glass set back in it: the low sun draws the reveal's shadow on the glass and
the bake's contact occlusion darkens the corners, which is most of what makes a facade read as built. The grid also
carries the wear: `bk_grime` is 1 at the wall's foot fading out over 0.6 m (splash), and rises again under the eaves
(soot and damp), so the painted materials darken there.

Windows: sliding sashes (two panes on two tracks, the meeting stiles, the outer frame), sills with a drip, a head
flashing; per style storm-shutter boxes (amado) on their rails, a lattice grille (real bars), a hood on brackets, a
bamboo blind; curtains and a sheen on the glass. Doors: the genkan's sliding doors in a porch recess (frosted glass in
a lattice, a transom, the step, a lamp, a name plate and intercom, a mailbox), a plain steel door, a shop front (a lit
glazed bay, a roll-up shutter in its box and guides). Balconies: a slab with a drip, a railing of posts, rails and
balusters (or a solid parapet), the sliding door onto it. External steel stairs with stringers, treads, a landing and
railings.
"""
import math

from mathutils import Vector

from kit import Face


def oq(K, pts, want, mi, grime=None):
    """A planar polygon wound so its normal points along `want`."""
    p = [Vector(x) for x in pts]
    n = (p[1] - p[0]).cross(p[2] - p[0])
    if n.length < 1e-12 and len(p) > 3:
        n = (p[2] - p[0]).cross(p[3] - p[0])
    if n.dot(Vector(want)) < 0:
        pts = list(reversed(pts))
        if isinstance(grime, (list, tuple)):
            grime = list(reversed(grime))
    return K.poly(pts, mi, grime) if not isinstance(grime, (list, tuple)) else K._f([K._v(q, grime[i]) for i, q in enumerate(pts)], mi)


def nrm(face):
    return (face.n[0], face.n[1], 0.0)


# ---------------------------------------------------------------------------------------------------------------- walls

def wall(K, face, zb, z1, openings, mat_at, hidden, soot=True, foot_grime=True):
    """The wall face from zb to z1 as quads around `openings` (dicts with u0, u1, z0, z1). mat_at(z) gives the slot of
    the cladding at a height (two-tone walls), hidden(u, z) the cells another block covers."""
    gh = 0.6
    us = {face.u0, face.u1}
    zs = {zb, z1}
    if foot_grime:
        zs.add(min(z1, zb + gh))
    zsoot = z1 - 0.45 if soot and z1 - zb > 1.6 else None
    if zsoot:
        zs.add(zsoot)
    for zsplit in getattr(mat_at, "splits", ()):
        if zb < zsplit < z1:
            zs.add(zsplit)
    for o in openings:
        us |= {max(face.u0, o["u0"]), min(face.u1, o["u1"])}
        zs |= {max(zb, o["z0"]), min(z1, o["z1"])}
    us = sorted(us)
    zs = sorted(zs)

    def g(z):
        v = max(0.0, 1.0 - (z - zb) / gh) if foot_grime else 0.0
        if zsoot and z > zsoot:
            v = max(v, 0.55 * (z - zsoot) / max(1e-6, z1 - zsoot))
        return v

    cache = {}

    def V(u, z):
        key = (round(u, 4), round(z, 4))
        v = cache.get(key)
        if v is None:
            v = cache[key] = K._v(face.pt(u, z, 0.0), grime=g(z))
        return v

    rev = face.n in ((0, 1), (-1, 0))
    for i in range(len(us) - 1):
        for j in range(len(zs) - 1):
            uc, zc = (us[i] + us[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2
            if us[i + 1] - us[i] < 1e-4 or zs[j + 1] - zs[j] < 1e-4:
                continue
            if any(o["u0"] < uc < o["u1"] and o["z0"] < zc < o["z1"] for o in openings):
                continue
            if hidden(uc, zc):
                continue
            vs = [V(us[i], zs[j]), V(us[i + 1], zs[j]), V(us[i + 1], zs[j + 1]), V(us[i], zs[j + 1])]
            K._f(list(reversed(vs)) if rev else vs, mat_at(zc))


def reveal(K, face, o, mi, floor_mi=None):
    """The four sides of an opening's hole, from the wall plane back to its depth."""
    d = o["depth"]
    u0, u1, z0, z1 = o["u0"], o["u1"], o["z0"], o["z1"]
    t = face.tangent()
    P = face.pt
    oq(K, [P(u0, z0, 0), P(u1, z0, 0), P(u1, z0, -d), P(u0, z0, -d)], (0, 0, 1), floor_mi if floor_mi is not None else mi, grime=0.35)
    oq(K, [P(u0, z1, 0), P(u1, z1, 0), P(u1, z1, -d), P(u0, z1, -d)], (0, 0, -1), mi, grime=0.0)
    oq(K, [P(u0, z0, 0), P(u0, z0, -d), P(u0, z1, -d), P(u0, z1, 0)], t, mi, grime=0.0)
    oq(K, [P(u1, z0, 0), P(u1, z0, -d), P(u1, z1, -d), P(u1, z1, 0)], tuple(-x for x in t), mi, grime=0.0)


def frame_ring(K, face, u0, u1, z0, z1, w, depth, off, mi, sides=True):
    """Four bars of a frame (w wide, `depth` deep, centred `off` out of the wall plane) just inside a rectangle."""
    uc = (u0 + u1) / 2
    K.fbox(face, uc, z1 - w / 2, u1 - u0, depth, w, off, mi, skip=("back",))
    K.fbox(face, uc, z0 + w / 2, u1 - u0, depth, w, off, mi, skip=("back",))
    if sides:
        K.fbox(face, u0 + w / 2, (z0 + z1) / 2, w, depth, z1 - z0 - 2 * w, off, mi, bottom=False, top=False, skip=("back",))
        K.fbox(face, u1 - w / 2, (z0 + z1) / 2, w, depth, z1 - z0 - 2 * w, off, mi, bottom=False, top=False, skip=("back",))


def pane(K, face, u0, u1, z0, z1, off, glass_mi, r, plan, lit=False, curtain=True):
    """A pane of glass at `off` (negative: set back) with what shows on it: a curtain drawn from one side, a sheen."""
    P = face.pt
    n = nrm(face)
    oq(K, [P(u0, z0, off), P(u1, z0, off), P(u1, z1, off), P(u0, z1, off)], n, glass_mi, grime=0.0)
    w = u1 - u0
    if K.tier == "far":
        return
    with K.no_outline():
        if curtain and r.random() < plan["curtains"]:
            side = r.choice((-1, 1))
            cw = w * r.uniform(0.3, 0.58)
            a, b = (u0, u0 + cw) if side < 0 else (u1 - cw, u1)
            role = "curtain" if r.random() < 0.6 else "curtain2"
            oq(K, [P(a, z0 + 0.03, off + 0.004), P(b, z0 + 0.03, off + 0.004), P(b, z1 - 0.02, off + 0.004), P(a, z1 - 0.02, off + 0.004)], n, K.lib(role), grime=0.0)
        elif not lit and K.tier == "hero" and r.random() < 0.75:
            # A diagonal sheen across the glass (the painted reflection of the sky).
            h = z1 - z0
            s0 = u0 + w * r.uniform(0.1, 0.4)
            sw = min(0.16, w * 0.22)
            k = h * 0.5
            pts = [P(s0, z0 + 0.02, off + 0.003), P(s0 + sw, z0 + 0.02, off + 0.003), P(min(u1 - 0.01, s0 + sw + k), z1 - 0.02, off + 0.003), P(min(u1 - 0.01, s0 + k) , z1 - 0.02, off + 0.003)]
            oq(K, pts, n, K.lib("sheen"), grime=0.0)


def window(K, face, o, style, lit, plan, r, wall_mi):
    """A window in opening `o`: reveal, outer frame, two sliding sashes, sill, head flashing, and its style's gear."""
    d = o["depth"]
    u0, u1, z0, z1 = o["u0"], o["u1"], o["z0"], o["z1"]
    uc = (u0 + u1) / 2
    ww, wh = u1 - u0, z1 - z0
    sash = K.lib("sash")
    trim = K.lib("trim")
    glass = K.lib("glass_lit") if lit else K.lib("glass")
    with K.no_outline():  # inside the opening: no outline shell (seen only through the hole)
        reveal(K, face, o, wall_mi)
        fw = 0.045
        fo = -d + 0.03
        frame_ring(K, face, u0, u1, z0, z1, fw, 0.06, fo, sash)
        if K.tier == "far":
            pane(K, face, u0 + fw, u1 - fw, z0 + fw, z1 - fw, -d + 0.01, glass, r, plan, lit)
            K.fbox(face, uc, (z0 + z1) / 2, 0.04, 0.05, wh - 2 * fw, fo, sash, bottom=False, top=False, skip=("back",))
        elif ww < 0.75:
            # A small window: one fixed or hopper pane.
            pane(K, face, u0 + fw, u1 - fw, z0 + fw, z1 - fw, -d + 0.012, glass, r, plan, lit, curtain=False)
        else:
            # Two sashes on two tracks: the inner one 3 cm deeper, overlapping at the middle by the meeting stiles.
            sw = 0.035
            for k, (a, b, off) in enumerate(((u0 + fw, uc + 0.02, -d + 0.012), (uc - 0.02, u1 - fw, -d + 0.042))):
                pane(K, face, a, b, z0 + fw, z1 - fw, off, glass, r, plan, lit)
                with K.no_outline(K.tier != "hero"):
                    K.fbox(face, uc + (0.02 - sw / 2 if k == 0 else -0.02 + sw / 2), (z0 + z1) / 2, sw, 0.03, wh - 2 * fw, off + 0.016, sash, bottom=False, top=False, skip=("back",))
                    if K.tier == "hero":
                        K.fbox(face, (a + b) / 2, z0 + fw + 0.015, b - a, 0.03, 0.03, off + 0.016, sash, skip=("back",))
                        K.fbox(face, (a + b) / 2, z1 - fw - 0.015, b - a, 0.03, 0.03, off + 0.016, sash, skip=("back",))
    with K.no_outline(K.tier == "far"):
        if style != "shutter" and wh > 0.6:
            # Sill with a drip, standing 8 cm out of the wall.
            K.fbox(face, uc, z0 - 0.022, ww + 0.1, 0.1 + d, 0.035, (0.1 - d) / 2 + 0.0, trim, skip=())
        if K.tier == "hero":
            K.fbox(face, uc, z1 + 0.018, ww + 0.06, 0.035, 0.03, 0.0175, sash)
    if style == "shutter":
        side = o.get("shutter_side", 1)
        bw = ww / 2 + 0.12
        bu = (u1 + bw / 2 + 0.03) if side > 0 else (u0 - bw / 2 - 0.03)
        am = K.lib("amado")
        with K.part(f"shutter_box_{len(K.parts)}", "back", normal=nrm(face)):
            K.fbox(face, bu, (z0 + z1) / 2 + 0.03, bw, 0.15, wh + 0.3, 0.075, am)
        with K.no_outline(K.tier != "hero"):
            ra, rb = (u0 - 0.04, bu + bw / 2) if side > 0 else (bu - bw / 2, u1 + 0.04)
            K.fbox(face, (ra + rb) / 2, z1 + 0.06, rb - ra, 0.13, 0.05, 0.065, K.lib("sash"))
            K.fbox(face, (ra + rb) / 2, z0 - 0.05, rb - ra, 0.13, 0.04, 0.065, K.lib("sash"))
    elif style == "grille" and not lit:
        gr = K.lib("grille")
        with K.part(f"grille_{len(K.parts)}", "back", normal=nrm(face)):
            frame_ring(K, face, u0 - 0.04, u1 + 0.04, z0 + 0.0, z1 + 0.04, 0.03, 0.09, 0.045, gr)
            if K.tier == "far":
                K.fbox(face, uc, (z0 + z1) / 2, ww, 0.02, wh, 0.07, K.lib("grille"))
            else:
                with K.no_outline():
                    n = max(3, int(ww / 0.1))
                    for i in range(1, n):
                        u = u0 - 0.04 + (ww + 0.08) * i / n
                        K.fbox(face, u, (z0 + z1 + 0.04) / 2, 0.018, 0.018, wh - 0.02, 0.07, gr, bottom=False, top=False)
                    K.fbox(face, uc, (z0 + z1 + 0.04) / 2, ww + 0.06, 0.02, 0.02, 0.07, gr, skip=("sides",))
    elif style == "hood":
        f = K.lib("fascia")
        zt = z1 + 0.16
        pts = [face.pt(u0 - 0.2, zt, 0.0), face.pt(u1 + 0.2, zt, 0.0), face.pt(u1 + 0.2, zt - 0.09, 0.42), face.pt(u0 - 0.2, zt - 0.09, 0.42)]
        K.prism(pts, (0, 0, 0.06), f)
        with K.no_outline():
            K.fbox(face, uc, zt - 0.035, ww + 0.36, 0.02, 0.025, 0.012, K.lib("crease"))
        for su in (u0 - 0.1, u1 + 0.1):
            K.prism([face.pt(su - 0.02, zt, 0.0), face.pt(su - 0.02, zt, 0.32), face.pt(su - 0.02, zt - 0.22, 0.0)], tuple(v * 0.04 for v in face.tangent()), f)
    elif style == "blind" and not lit:
        with K.part(f"blind_{len(K.parts)}", "none"):
            K.fbox(face, uc, z1 - wh * 0.33, ww + 0.12, 0.02, wh * 0.64, 0.07, K.lib("blind"))
            K.fbox(face, uc, z1 + 0.03, ww + 0.2, 0.04, 0.04, 0.03, K.lib("trim"))
    if K.tier != "far" and style != "shutter" and wh > 0.6 and plan["wear"] > 0.1 and r.random() < 0.8:
        streak(K, face, uc, z0 - 0.04, ww * r.uniform(0.6, 0.95), r.uniform(0.5, 1.2) * (0.6 + plan["wear"]), wall_mi, r, o.get("zb", z0 - 2))


def streak(K, face, u, ztop, w, h, mi, r, zfloor):
    """Rain streaks under a sill: a quad 3 mm off the wall in the wall's own material, darkened by `bk_grime` from the
    sill (1) to nothing (0) at its foot, so it fades into the wall."""
    zb = max(zfloor + 0.05, ztop - h)
    if ztop - zb < 0.15:
        return
    P = face.pt
    g = min(1.0, 0.7 + 0.3 * r.random())
    with K.no_outline():
        oq(K, [P(u - w / 2, zb, 0.003), P(u + w / 2, zb, 0.003), P(u + w / 2 * 0.9, ztop, 0.003), P(u - w / 2 * 0.9, ztop, 0.003)], nrm(face), mi, grime=[0.0, 0.0, g, g])


# ---------------------------------------------------------------------------------------------------------------- doors

def genkan(K, face, o, plan, r, wall_mi, ground):
    """The entrance: a porch recess with two sliding doors (frosted glass in a lattice) under a transom, the step, a
    lamp, a name plate and intercom, a mailbox. `ground(x, y)` gives the terrain height for the step."""
    d = o["depth"]
    u0, u1, z0, z1 = o["u0"], o["u1"], o["z0"], o["z1"]
    uc = (u0 + u1) / 2
    w = u1 - u0
    n = nrm(face)
    frame = K.lib("door") if plan["door_wood"] else K.lib("sash")
    with K.no_outline():  # inside the opening: no outline shell (seen only through the hole)
        reveal(K, face, o, wall_mi, floor_mi=K.lib("stone"))
        zt = z1 - 0.32
        back = -d
        # Door frame, the transom bar and glass.
        frame_ring(K, face, u0, u1, z0, z1, 0.06, 0.08, back + 0.04, frame)
        K.fbox(face, uc, zt, w - 0.12, 0.08, 0.05, back + 0.04, frame, skip=("back",))
        pane(K, face, u0 + 0.06, u1 - 0.06, zt + 0.025, z1 - 0.06, back + 0.01, K.lib("glass_lit") if r.random() < plan["lit"] else K.lib("glass"), r, plan, curtain=False)
        # Two door leaves on two tracks.
        lw = (w - 0.12) / 2 + 0.03
        for k in range(2):
            a = u0 + 0.06 + k * (lw - 0.06)
            b = a + lw
            off = back + 0.012 + (0.035 if k else 0.0)
            oq(K, [face.pt(a, z0 + 0.03, off), face.pt(b, z0 + 0.03, off), face.pt(b, zt - 0.025, off), face.pt(a, zt - 0.025, off)], n, K.lib("frost"), grime=0.0)
            with K.no_outline(K.tier != "hero"):
                frame_ring(K, face, a, b, z0 + 0.03, zt - 0.025, 0.05, 0.035, off + 0.018, frame)
                bars = {"hero": 7, "mid": 3}.get(K.tier, 0)
                for i in range(1, bars + 1):
                    zz = z0 + 0.03 + (zt - z0 - 0.055) * i / (bars + 1)
                    K.fbox(face, (a + b) / 2, zz, b - a - 0.1, 0.02, 0.022, off + 0.012, frame, skip=("back", "sides"))
                if K.tier == "hero":
                    for i in (1, 2):
                        K.fbox(face, a + (b - a) * i / 3, (z0 + zt) / 2, 0.022, 0.02, zt - z0 - 0.15, off + 0.012, frame, bottom=False, top=False, skip=("back",))
                # The pull.
                K.fbox(face, b - 0.09 if k == 0 else a + 0.09, z0 + 1.0, 0.025, 0.03, 0.22, off + 0.03, K.lib("metal"))
    # The step (a concrete block on the ground in front of the porch).
    sx, sy, _ = face.pt(uc, 0, 0.3)
    zg = ground(sx, sy)
    zs = min(z0 - 0.12, zg + 0.16)
    with K.part(f"step_{len(K.parts)}", "below"):
        hb = zs - zg + 0.02
        K.fbox(face, uc, zg - 0.02 + hb / 2, w + 0.3, 0.5, hb, 0.31, K.lib("stone"), grime=0.15)  # clear of the plinth
    # Lamp beside the door, name plate and intercom on the other side, the mailbox.
    side = 1 if r.random() < 0.5 else -1
    lu = (u1 + 0.28) if side > 0 else (u0 - 0.28)
    with K.part(f"door_lamp_{len(K.parts)}", "back", normal=n):
        K.fbox(face, lu, z0 + 1.95, 0.16, 0.025, 0.24, 0.0125, K.lib("metal"))
        K.fbox(face, lu, z0 + 1.95, 0.12, 0.11, 0.18, 0.08, K.lib("lamp"))
    pu = (u0 - 0.24) if side > 0 else (u1 + 0.24)
    with K.part(f"name_plate_{len(K.parts)}", "back", normal=n):
        K.fbox(face, pu, z0 + 1.5, 0.22, 0.02, 0.09, 0.01, K.lib("sign"))
        K.fbox(face, pu, z0 + 1.28, 0.1, 0.035, 0.14, 0.0175, K.lib("meter"))
    if r.random() < 0.7:
        with K.part(f"mailbox_{len(K.parts)}", "back", normal=n):
            K.fbox(face, pu, z0 + 0.95, 0.34, 0.12, 0.3, 0.06, K.lib("metal"))
            K.fbox(face, pu, z0 + 1.05, 0.24, 0.01, 0.03, 0.125, K.lib("crease"))
    return {"lamp_u": lu, "plate_u": pu, "step_top": zs}


def steel_door(K, face, o, plan, wall_mi):
    d = o["depth"]
    u0, u1, z0, z1 = o["u0"], o["u1"], o["z0"], o["z1"]
    with K.no_outline():  # inside the opening: no outline shell (seen only through the hole)
        reveal(K, face, o, wall_mi)
        frame_ring(K, face, u0, u1, z0, z1, 0.05, 0.06, -d + 0.03, K.lib("sash"))
        oq(K, [face.pt(u0 + 0.05, z0, -d + 0.01), face.pt(u1 - 0.05, z0, -d + 0.01), face.pt(u1 - 0.05, z1 - 0.05, -d + 0.01), face.pt(u0 + 0.05, z1 - 0.05, -d + 0.01)], nrm(face), K.lib("shutter_box"), grime=0.0)
        K.fbox(face, u1 - 0.15, z0 + 1.0, 0.12, 0.05, 0.03, -d + 0.035, K.lib("metal"))


def shop_front(K, face, bays, z0, plan, r, wall_mi):
    """Shop bays on the ground floor: dicts with u0, u1, z0, z1, kind ('glass' or 'shutter'), depth."""
    for o in bays:
        u0, u1, zb, zt = o["u0"], o["u1"], o["z0"], o["z1"]
        uc = (u0 + u1) / 2
        reveal(K, face, o, wall_mi, floor_mi=K.lib("stone"))
        d = o["depth"]
        if o["kind"] == "glass":
            frame_ring(K, face, u0, u1, zb, zt, 0.06, 0.07, -d + 0.035, K.lib("sash"))
            oq(K, [face.pt(u0 + 0.06, zb + 0.06, -d + 0.01), face.pt(u1 - 0.06, zb + 0.06, -d + 0.01), face.pt(u1 - 0.06, zt - 0.06, -d + 0.01), face.pt(u0 + 0.06, zt - 0.06, -d + 0.01)], nrm(face), K.lib("shop_glass"), grime=0.0)
            n = max(2, int((u1 - u0) / 0.9))
            for i in range(1, n):
                K.fbox(face, u0 + (u1 - u0) * i / n, (zb + zt) / 2, 0.05, 0.05, zt - zb - 0.12, -d + 0.035, K.lib("sash"), bottom=False, top=False, skip=("back",))
            K.fbox(face, uc, zb + 0.75, u1 - u0 - 0.12, 0.05, 0.05, -d + 0.035, K.lib("sash"), skip=("back", "sides"))
        else:
            # A roll-up shutter down in its guides, the box above it.
            oq(K, [face.pt(u0, zb, -d + 0.02), face.pt(u1, zb, -d + 0.02), face.pt(u1, zt, -d + 0.02), face.pt(u0, zt, -d + 0.02)], nrm(face), K.lib("shutter"), grime=[0.4, 0.4, 0.0, 0.0])
            for su in (u0 + 0.03, u1 - 0.03):
                K.fbox(face, su, (zb + zt) / 2, 0.06, 0.07, zt - zb, -d + 0.035, K.lib("sash"), bottom=False, skip=("back",))
            with K.part(f"shutter_case_{len(K.parts)}", "back", normal=nrm(face)):
                K.fbox(face, uc, zt + 0.19, u1 - u0 + 0.12, 0.34, 0.38, 0.17, K.lib("shutter_box"))
            K.fbox(face, uc, zb + 0.03, u1 - u0, 0.08, 0.06, -d + 0.04, K.lib("metal"), skip=("back", "sides"))


def awning(K, face, u0, u1, zt, zl, dep, plan):
    pts = [face.pt(u0, zt, 0.0), face.pt(u1, zt, 0.0), face.pt(u1, zl, dep), face.pt(u0, zl, dep)]
    K.prism(pts, (0, 0, 0.05), K.lib("awning"))
    K.fbox(face, (u0 + u1) / 2, zl - 0.12, u1 - u0, 0.03, 0.25, dep + 0.015, K.lib("awning"))
    with K.no_outline():
        n = max(2, int((u1 - u0) / 1.6) + 1)
        for k in range(n):
            u = u0 + 0.15 + (u1 - u0 - 0.3) * k / (n - 1)
            K.beam(face.pt(u, zl + 0.02, dep - 0.02), face.pt(u, zt - 0.3, 0.0), 0.015, K.lib("metal"), seg=4)


def noren(K, face, u, z, w, plan):
    with K.part(f"noren_{len(K.parts)}", "none"):
        K.fbox(face, u, z + 0.25, w + 0.1, 0.03, 0.03, 0.14, K.lib("door"))
        n = 3
        for k in range(n):
            a = u - w / 2 + k * w / n + 0.01
            K.fbox(face, a + w / n / 2 - 0.01, z, w / n - 0.02, 0.012, 0.48, 0.14, K.lib("noren"))


def canopy(K, face, u, z, w, dep, plan):
    """A flat concrete hood over a door on two brackets, its drip line underneath."""
    tr = K.lib("slab")
    K.fbox(face, u, z, w, dep, 0.1, dep / 2, tr, grime=0.0)
    with K.no_outline():
        K.fbox(face, u, z - 0.055, w - 0.06, 0.025, 0.012, dep - 0.04, K.lib("crease"))


# ---------------------------------------------------------------------------------------------------------------- balconies

def balcony(K, face, u, zf, ln, dep, solid, plan, r, wall_mi, lit):
    """A balcony slab with a railing (or parapet) and the sliding door onto it. Returns its record for the dressing."""
    n = nrm(face)
    slab = K.lib("slab")
    K.fbox(face, u, zf - 0.075, ln, dep, 0.15, dep / 2, slab, grime=0.0)
    with K.no_outline():
        K.fbox(face, u, zf - 0.155, ln - 0.06, 0.02, 0.012, dep - 0.05, K.lib("crease"))
    if solid:
        pm = K.lib("panel") if plan["style_panel"] else slab
        K.fbox(face, u, zf + 0.5, ln, 0.1, 0.84, dep - 0.05, pm, bottom=False)
        for su in (-1, 1):
            K.fbox(face, u + su * (ln / 2 - 0.05), zf + 0.5, 0.1, dep - 0.1, 0.84, dep / 2 - 0.05, pm, bottom=False)
        K.fbox(face, u, zf + 0.96, ln + 0.04, 0.12, 0.06, dep - 0.05, K.lib("trim"))
    else:
        rl = K.lib("rail")
        top = zf + 1.0
        with K.no_outline(K.tier != "hero"):
            # Front: posts, top and bottom rails.
            npost = max(2, int(ln / 1.0) + 1)
            for k in range(npost):
                pu = u - ln / 2 + 0.03 + (ln - 0.06) * k / (npost - 1)
                K.fbox(face, pu, zf + 0.5, 0.045, 0.045, 1.0, dep - 0.03, rl, bottom=False)
            K.fbox(face, u, top + 0.025, ln + 0.02, 0.07, 0.05, dep - 0.03, rl)
            K.fbox(face, u, zf + 0.1, ln - 0.06, 0.03, 0.03, dep - 0.03, rl, skip=("sides",))
            for su in (-1, 1):
                ue = u + su * (ln / 2 - 0.015)
                K.fbox(face, ue, top + 0.025, 0.06, dep - 0.03, 0.05, (dep - 0.03) / 2, rl)
                K.fbox(face, ue, zf + 0.1, 0.03, dep - 0.06, 0.03, (dep - 0.06) / 2, rl, skip=("front",))
        if K.tier == "hero":
            with K.no_outline():
                nb = int(ln / 0.11)
                for k in range(1, nb):
                    pu = u - ln / 2 + ln * k / nb
                    K.fbox(face, pu, zf + 0.57, 0.018, 0.018, 0.86, dep - 0.03, rl, bottom=False, top=False)
                for su in (-1, 1):
                    ue = u + su * (ln / 2 - 0.015)
                    m = int(dep / 0.11)
                    for k in range(1, m):
                        K.fbox(face, ue, zf + 0.57, 0.018, 0.018, 0.86, dep * k / m, rl, bottom=False, top=False)
        else:
            ax = face.axis
            K.fbox(face, u, zf + 0.57, ln - 0.06, 0.02, 0.86, dep - 0.03, K.lib("grille"), bottom=False, top=False)
    # The tall sliding door onto it.
    dw = min(ln - 0.5, 1.8)
    o = {"u0": u - dw / 2, "u1": u + dw / 2, "z0": zf + 0.02, "z1": zf + 1.95, "depth": 0.1}
    return o


def sliding_door(K, face, o, plan, r, wall_mi, lit):
    """Two tall glazed sashes on two tracks (the door onto a balcony)."""
    d = o["depth"]
    u0, u1, z0, z1 = o["u0"], o["u1"], o["z0"], o["z1"]
    uc = (u0 + u1) / 2
    with K.no_outline():  # inside the opening: no outline shell (seen only through the hole)
        reveal(K, face, o, wall_mi)
        fw = 0.05
        frame_ring(K, face, u0, u1, z0, z1, fw, 0.06, -d + 0.03, K.lib("sash"))
        glass = K.lib("glass_lit") if lit else K.lib("glass")
        for k, (a, b, off) in enumerate(((u0 + fw, uc + 0.02, -d + 0.012), (uc - 0.02, u1 - fw, -d + 0.042))):
            pane(K, face, a, b, z0 + fw, z1 - fw, off, glass, r, plan, lit)
            with K.no_outline(K.tier != "hero"):
                K.fbox(face, uc + (0.0025 if k == 0 else -0.0025), (z0 + z1) / 2, 0.035, 0.03, z1 - z0 - 2 * fw, off + 0.016, K.lib("sash"), bottom=False, top=False, skip=("back",))


# ---------------------------------------------------------------------------------------------------------------- stairs

def steel_stair(K, main, side, plan, ground, zt):
    """An external steel stair up a side wall to a landing and a door at height zt: two channel stringers, treads with
    nosings, a landing on a post, railings on posts. Returns the reserved box (world) and the landing's door face."""
    sd = 1 if side == "e" else -1
    xw = main["x1"] if sd > 0 else main["x0"]
    xs = xw + sd * 0.5
    z0 = ground(xs, main["y0"] + 3.0)
    yl0, yl1 = main["y0"] + 0.5, main["y0"] + 1.6
    rise_total = zt - z0
    nst = max(6, int(round(rise_total / 0.2)))
    rise = rise_total / nst
    tread = 0.26
    ytop = yl1
    ybot = ytop + (nst - 1) * tread
    metal = K.lib("metal")
    rl = K.lib("rail")
    with K.part(f"stair_{side}", "below"):
        for k in range(nst - 1):
            yy = ytop + (nst - 1 - k) * tread - tread / 2
            K.box((xs, yy, z0 + (k + 1) * rise - 0.02), (0.8, tread + 0.03, 0.04), metal)
            if K.tier == "hero":
                with K.no_outline():
                    K.box((xs, yy - tread / 2 + 0.01, z0 + (k + 1) * rise - 0.045), (0.8, 0.02, 0.05), metal, skip=("top",))
        for o in (-0.43, 0.43):
            # Channel stringers (deep, thin) from the ground to the landing.
            a = Vector((xs + o, ybot + 0.12, z0 + 0.13))
            b = Vector((xs + o, ytop, zt - 0.05))
            dvec = (b - a)
            L = dvec.length
            up = Vector((0, 0, 1))
            t = dvec.normalized()
            nn = t.cross(Vector((1, 0, 0))).normalized() * 0.11
            side_v = Vector((0.025, 0, 0))
            pts = [a - nn - side_v, b - nn - side_v, b + nn - side_v, a + nn - side_v]
            K.prism([tuple(p) for p in pts], (0.05, 0, 0), metal)
        # A foot plate under each stringer.
        K.box((xs, ybot + 0.1, z0 + 0.01), (0.95, 0.25, 0.04), metal, skip=("bottom",))
        K.box((xs, (yl0 + yl1) / 2, zt - 0.06), (0.95, yl1 - yl0 + 0.02, 0.12), metal)
        K.box((xs + sd * 0.42, yl0 + 0.05, (z0 + zt) / 2 - 0.03), (0.09, 0.09, zt - z0 - 0.06), metal)
        o = sd * 0.43
        with K.no_outline(K.tier != "hero"):
            K.beam((xs + o, ybot, z0 + 0.92), (xs + o, ytop, zt + 0.92), 0.022, rl, seg=5)
            K.beam((xs + o, ybot, z0 + 0.45), (xs + o, ytop, zt + 0.45), 0.012, rl, seg=4)
            for tt in (0.0, 0.33, 0.66, 1.0):
                yy = ybot + (ytop - ybot) * tt
                zz = z0 + (zt - z0) * tt
                K.beam((xs + o, yy, zz), (xs + o, yy, zz + 0.93), 0.018, rl, seg=4)
            K.beam((xs + o, yl0, zt + 0.92), (xs + o, yl1, zt + 0.92), 0.022, rl, seg=5)
            K.beam((xs - o, yl0, zt + 0.92), (xs + o, yl0, zt + 0.92), 0.022, rl, seg=5)
            for yy in (yl0, (yl0 + yl1) / 2):
                K.beam((xs + o, yy, zt), (xs + o, yy, zt + 0.93), 0.018, rl, seg=4)
    res = (xw - 1.2 if sd < 0 else xw - 0.2, xw + 1.2 if sd > 0 else xw + 0.2, main["y0"], ybot + 0.3, z0 - 1, zt + 3)
    return res, (yl0 + yl1) / 2
