"""Roofs of the building kit: gable, hip, hip-and-gable (irimoya), shed, flat (parapet and deck) and the pent roofs
(hisashi) along walls.

Pitched roofs are a sheathing slab (its eave edge, verge ends and soffit in the trim colour) under real tile courses:
each course a wedge whose butt stands off the course below, so the rows catch the low sun and draw a shadow line; on hip
roofs the courses are clipped by the hip lines. At the eave the first course ends in round-nosed eave tiles (hero detail),
the ridge carries a layered cap (a base course, a rounded cap, end tiles), hips their own caps, verges a barge board.
Half-round gutters run under the eaves and the downpipe positions are returned for the facade pass. Moss (`bk_moss`) is
written on the low courses, more on the slope that faces away from the sun.
"""
import math


def _moss(K, wear, frac_up, north, rnd):
    """Moss amount for a course: thick at the eave, gone a third of the way up; more on north slopes."""
    if wear <= 0.05:
        return 0.0
    base = max(0.0, 1.0 - frac_up / 0.38)
    return min(1.0, base * (0.55 + 0.45 * north) * (0.6 + 0.8 * rnd))


def courses(K, P3, span_fn, a, c, z_eave, z_ridge, mi, wear, north, r, eave_tiles=False):
    """Tile courses on one slope, from the eave line `a` (at z_eave, on the slab's top) up to the ridge line `c`.
    span_fn(run) gives the (e0, e1) range along the slope's axis at a plan distance `run` from the eave."""
    dx, dz = c - a, z_ridge - z_eave
    Ls = math.hypot(dx, dz)
    ux, uz = dx / Ls, dz / Ls
    nx, nz = (-uz, ux) if ux > 0 else (uz, -ux)
    step, lip = 0.3, 0.038
    n = int((Ls - 0.3) / step)
    with K.no_outline():
        for k in range(n):
            t0, t1 = 0.04 + k * step, 0.04 + (k + 1) * step
            e0, e1 = span_fn(abs(ux) * t1)
            if e1 - e0 < 0.25:
                break
            lo = (a + ux * t0, z_eave + uz * t0)
            hi = (lo[0] + nx * lip, lo[1] + nz * lip)
            up = (a + ux * t1, z_eave + uz * t1)
            sec = [(p[0] - nx * 0.006, p[1] - nz * 0.006) for p in (lo, hi, up)]
            moss = _moss(K, wear, t0 / Ls, north, r.random())
            if k == 0 and eave_tiles:
                _eave_course(K, P3, e0, e1, lo, up, (nx, nz), mi, moss)
                continue
            A = [K._v(P3(e0 + 0.03, p[0], p[1]), moss=moss) for p in sec]
            B = [K._v(P3(e1 - 0.03, p[0], p[1]), moss=moss) for p in sec]
            for fv in ((A[0], B[0], B[1], A[1]), (A[1], B[1], B[2], A[2]), (A[2], B[2], B[0], A[0]), (A[0], A[1], A[2]), (B[2], B[1], B[0])):
                K.recalc.append(K._f(fv, mi))  # closed wedges: their normals are made consistent in K.finish


def _eave_course(K, P3, e0, e1, lo, up, nrm, mi, moss):
    """The eave course: round-nosed eave tiles (a roll and a pan per 0.3 m), the rolls standing 6 cm proud."""
    nx, nz = nrm
    period = 0.3
    m = max(2, int((e1 - e0) / (period / 2)))
    w = (e1 - e0) / m
    hi_l, lo_l = 0.075, 0.03
    for i in range(m):
        s0, s1 = e0 + i * w, e0 + (i + 1) * w
        lip = hi_l if i % 2 == 0 else lo_l
        a0 = K._v(P3(s0, lo[0] - nx * 0.006, lo[1] - nz * 0.006), moss=moss)
        a1 = K._v(P3(s1, lo[0] - nx * 0.006, lo[1] - nz * 0.006), moss=moss)
        b0 = K._v(P3(s0, lo[0] + nx * lip, lo[1] + nz * lip), moss=moss)
        b1 = K._v(P3(s1, lo[0] + nx * lip, lo[1] + nz * lip), moss=moss)
        c0 = K._v(P3(s0, up[0] - nx * 0.006, up[1] - nz * 0.006), moss=moss)
        c1 = K._v(P3(s1, up[0] - nx * 0.006, up[1] - nz * 0.006), moss=moss)
        for fv in ((a0, a1, b1, b0), (b0, b1, c1, c0), (c0, c1, a1, a0), (a0, b0, c0), (c1, b1, a1)):
            K.recalc.append(K._f(fv, mi))


def gutter(K, P3, e0, e1, a, s, z, info):
    """A half-round gutter along an eave (on the slope's axis from e0 to e1), hung just outside the fascia."""
    L = e1 - e0
    g = K.lib("gutter")
    with K.no_outline(K.tier != "hero"):
        K.beam(P3(e0 + 0.05, a + s * 0.07, z), P3(e1 - 0.05, a + s * 0.07, z), 0.065, g, seg=6)
    info.setdefault("gutters", []).append({"e0": e0, "e1": e1, "a": a + s * 0.07, "z": z})


def ridge_cap(K, P3, e0, e1, c, z, detail):
    """A layered ridge: a base course, a rounded cap and, on the hero detail, end tiles with a disc."""
    rd = K.lib("ridge")
    L = e1 - e0
    m = (e0 + e1) / 2
    if detail == "far":
        K.box(P3(m, c, z + 0.06), _sz(P3, L, 0.32, 0.2), rd)
        return z + 0.16
    K.box(P3(m, c, z + 0.05), _sz(P3, L, 0.34, 0.12), rd)
    K.box(P3(m, c, z + 0.13), _sz(P3, L - 0.06, 0.26, 0.06), rd)
    ax = P3(1, 0, 0)
    K.cyl(P3(e0, c, z + 0.17), 0.1, L, rd, axis=ax, seg=6)
    if detail == "hero":
        for e, sgn in ((e0, -1), (e1, 1)):
            K.box(P3(e + sgn * 0.03, c, z + 0.22), _sz(P3, 0.12, 0.42, 0.42), rd)
            K.cyl(P3(e + sgn * 0.09, c, z + 0.26), 0.11, 0.03, rd, axis=tuple(sgn * v for v in ax), seg=8)
    return z + 0.44 if detail == "hero" else z + 0.27


def _sz(P3, along, across, h):
    p = P3(along, across, h)
    return (abs(p[0]), abs(p[1]), abs(p[2]))


def gable(K, b, axis, pitch_deg, eaves, verge, plan):
    """Gable roof over block b with its ridge along `axis`. Returns (top z, info for gutters, downpipes, gear)."""
    x0, x1, y0, y1, top = b["x0"], b["x1"], b["y0"], b["y1"], b["z1"]
    tp = math.tan(math.radians(pitch_deg))
    ov, ovg, th = eaves, verge, 0.16
    if axis == "x":
        c, half = (y0 + y1) / 2, (y1 - y0) / 2
        e0, e1 = x0 - ovg, x1 + ovg
    else:
        c, half = (x0 + x1) / 2, (x1 - x0) / 2
        e0, e1 = y0 - ovg, y1 + ovg
    zr = top + half * tp
    ze = top - ov * tp
    mat = K.lib("tile", axis)
    trim = K.lib("fascia")

    def P3(al, ac, z):
        return (al, ac, z) if axis == "x" else (ac, al, z)

    info = {"axis": axis, "c": c, "half": half, "ov": ov, "ze": ze, "zr": zr, "th": th, "tp": tp, "e0": e0, "e1": e1, "kind": "gable"}
    sun = plan["sun"]
    for s in (-1, 1):
        a = c + s * (half + ov)
        poly = [P3(e0, a, ze), P3(e1, a, ze), P3(e1, c, zr), P3(e0, c, zr)]
        fs = K.prism(poly, (0, 0, th), mat)
        for k in (0, 2, 3, 4, 5):  # soffit, eave edge, verge ends (the ridge edge hides under the cap)
            fs[k].material_index = trim
        if plan["tiles"]:
            north = _away(sun, P3(0, s, 0))
            courses(K, P3, lambda run: (e0, e1), a, c, ze + th, zr + th, mat, plan["wear"], north, plan["r"], eave_tiles=plan["eave_tiles"])
        gutter(K, P3, e0, e1, a, s, ze - 0.02, info)
        # Fascia board under the slab's eave edge.
        K.box(P3((e0 + e1) / 2, a + s * 0.01, ze - 0.06), _sz(P3, e1 - e0, 0.04, 0.16), trim)
    # Gable walls (closed triangles flush with the end walls), barge boards along the verges, a vent on hero walls.
    for se, xe in ((-1, x0 if axis == "x" else y0), (1, x1 if axis == "x" else y1)):
        poly = [P3(xe, c - half, top), P3(xe, c + half, top), P3(xe, c, zr)]
        off = (-se * 0.12, 0, 0) if axis == "x" else (0, -se * 0.12, 0)
        K.prism(poly, off, plan["gable_wall"])
        ev = e0 if se < 0 else e1
        for s in (-1, 1):
            a = c + s * (half + ov)
            p0, p1 = P3(ev + se * 0.02, a, ze + th * 0.5), P3(ev + se * 0.02, c, zr + th * 0.5)
            K.beam(p0, p1, 0.07 if K.tier != "far" else 0.05, trim, seg=4)
        if plan["detail"] == "hero" and half > 2.2:
            vz = top + half * tp * 0.45
            K.box(P3(xe + se * 0.03, c, vz), _sz(P3, 0.08, 0.55, 0.4), K.lib("shutter"))
    rz = zr + th
    info["ridge_z"] = ridge_cap(K, P3, e0 - 0.05, e1 + 0.05, c, rz, plan["detail"])
    return info["ridge_z"], info


def _away(sun, n):
    """0 for a slope facing the sun, 1 facing away."""
    d = sun[0] * n[0] + sun[1] * n[1]
    return max(0.0, min(1.0, 0.5 - 0.5 * d))


def hip(K, b, pitch_deg, eaves, plan, irimoya=False):
    """Hipped (or hip-and-gable) roof with the ridge along the block's longer side, tile courses clipped by the hips."""
    x0, x1, y0, y1, top = b["x0"], b["x1"], b["y0"], b["y1"], b["z1"]
    tp = math.tan(math.radians(pitch_deg))
    ov, th = eaves, 0.16
    along_x = (x1 - x0) >= (y1 - y0)
    if along_x:
        A0, A1, C0, C1 = x0 - ov, x1 + ov, y0 - ov, y1 + ov
    else:
        A0, A1, C0, C1 = y0 - ov, y1 + ov, x0 - ov, x1 + ov
    c = (C0 + C1) / 2
    hw = (C1 - C0) / 2
    rh = hw * tp
    ze = top - ov * tp
    zr = ze + rh
    ra0 = min((A0 + A1) / 2 - 0.3, A0 + hw)
    ra1 = max((A0 + A1) / 2 + 0.3, A1 - hw)
    axis = "x" if along_x else "y"
    mat = K.lib("tile", axis)
    mat2 = K.lib("tile", "y" if along_x else "x")
    trim = K.lib("fascia")

    def P3(al, ac, z):
        return (al, ac, z) if along_x else (ac, al, z)

    def Q3(ac, al, z):  # the end slopes: their own axis is the across one
        return P3(al, ac, z)

    v = K._v
    T = [v(P3(A0, C0, ze + th)), v(P3(A1, C0, ze + th)), v(P3(A1, C1, ze + th)), v(P3(A0, C1, ze + th))]
    B = [v(P3(A0, C0, ze)), v(P3(A1, C0, ze)), v(P3(A1, C1, ze)), v(P3(A0, C1, ze))]
    faces = []
    f = 0.5
    if not irimoya:
        Ra, Rb = v(P3(ra0, c, zr + th)), v(P3(ra1, c, zr + th))
        faces += [((T[0], T[1], Rb, Ra), mat), ((T[2], T[3], Ra, Rb), mat), ((T[1], T[2], Rb), mat2), ((T[3], T[0], Ra), mat2)]
    else:
        xb0, xb1 = A0 + f * (ra0 - A0), A1 + f * (ra1 - A1)
        cs, cn, zb = C0 + f * (c - C0), C1 + f * (c - C1), ze + f * rh + th
        Bs0, Bn0, Bs1, Bn1 = v(P3(xb0, cs, zb)), v(P3(xb0, cn, zb)), v(P3(xb1, cs, zb)), v(P3(xb1, cn, zb))
        R0, R1 = v(P3(xb0, c, zr + th)), v(P3(xb1, c, zr + th))
        faces += [((T[0], T[1], Bs1, R1, R0, Bs0), mat), ((T[2], T[3], Bn0, R0, R1, Bn1), mat),
                  ((T[3], T[0], Bs0, Bn0), mat2), ((T[1], T[2], Bn1, Bs1), mat2),
                  ((Bs0, R0, Bn0), plan["gable_wall"]), ((Bn1, R1, Bs1), plan["gable_wall"])]
    for i in range(4):
        j = (i + 1) % 4
        faces.append(((B[i], B[j], T[j], T[i]), trim))
    faces.append(((B[3], B[2], B[1], B[0]), trim))
    for fv, mi in faces:
        K.recalc.append(K._f(fv, mi))
    run_max = hw
    sun = plan["sun"]
    if plan["tiles"]:
        lim = f * hw if irimoya else 1e9
        for s, cc in ((-1, C0), (1, C1)):
            north = _away(sun, P3(0, s, 0))
            courses(K, P3, lambda run: (A0 + min(run, lim), A1 - min(run, lim)), cc, c, ze + th, zr + th, mat, plan["wear"], north, plan["r"],
                    eave_tiles=plan["eave_tiles"])
        for s, aa in ((-1, A0), (1, A1)):
            north = _away(sun, P3(s, 0, 0))
            ridge_a = ra0 if s < 0 else ra1
            zr_end = zr + th if not irimoya else ze + f * rh + th
            end_c = ridge_a if not irimoya else (A0 + f * (ra0 - A0) if s < 0 else A1 + f * (ra1 - A1))
            courses(K, Q3, lambda run: (C0 + run, C1 - run), aa, end_c, ze + th, zr_end, mat2, plan["wear"], north, plan["r"])
    info = {"axis": axis, "c": c, "half": hw - ov, "ov": ov, "ze": ze, "zr": zr, "th": th, "tp": tp, "e0": A0, "e1": A1, "r0": ra0, "r1": ra1, "hip": True, "kind": "hip"}
    for s, cc in ((-1, C0), (1, C1)):
        gutter(K, P3, A0 + 0.1, A1 - 0.1, cc, s, ze - 0.02, info)
    rd = K.lib("ridge")
    # Hip caps from the eave corners up to the ridge ends (or to the gable's foot on an irimoya).
    if not irimoya:
        for (ea, ec, ra) in ((A0, C0, ra0), (A0, C1, ra0), (A1, C0, ra1), (A1, C1, ra1)):
            K.beam(P3(ea, ec, ze + th + 0.03), P3(ra, c, zr + th + 0.06), 0.09, rd, seg=4)
        info["ridge_z"] = ridge_cap(K, P3, ra0, ra1, c, zr + th, plan["detail"])
    else:
        xb0, xb1 = A0 + f * (ra0 - A0), A1 + f * (ra1 - A1)
        cs, cn, zb = C0 + f * (c - C0), C1 + f * (c - C1), ze + f * rh + th
        for (ea, ec, xa, xc) in ((A0, C0, xb0, cs), (A0, C1, xb0, cn), (A1, C0, xb1, cs), (A1, C1, xb1, cn)):
            K.beam(P3(ea, ec, ze + th + 0.03), P3(xa, xc, zb + 0.05), 0.09, rd, seg=4)
        for xa in (xb0, xb1):
            for xc in (cs, cn):
                K.beam(P3(xa, xc, zb + 0.04), P3(xa, c, zr + th + 0.04), 0.07, trim, seg=4)
        info["ridge_z"] = ridge_cap(K, P3, xb0 - 0.05, xb1 + 0.05, c, zr + th, plan["detail"])
    return info["ridge_z"], info


def shed(K, b, high, pitch_deg, eaves, plan, walls=True, mat=None):
    """Single-slope roof over block b, high along side `high` ('n', 's', 'e', 'w'); fills the end walls up to it."""
    x0, x1, y0, y1, top = b["x0"], b["x1"], b["y0"], b["y1"], b["z1"]
    tp = math.tan(math.radians(pitch_deg))
    th = 0.12
    ov = eaves
    trim = K.lib("fascia")
    if high in ("n", "s"):
        span = y1 - y0
        lo_y = y0 - ov if high == "n" else y1 + ov
        hi_y = y1 + 0.12 if high == "n" else y0 - 0.12
        zl, zh = top - ov * tp, top + span * tp
        mat = K.lib("tile", "x") if mat is None else mat
        K.prism([(x0 - ov, lo_y, zl), (x1 + ov, lo_y, zl), (x1 + ov, hi_y, zh), (x0 - ov, hi_y, zh)], (0, 0, th), mat)
        K.box(((x0 + x1) / 2, lo_y + (-0.03 if high == "n" else 0.03), zl + th / 2 - 0.04), (x1 - x0 + 2 * ov, 0.06, th + 0.1), trim)
        if walls:
            ylo, yhi = (y0, y1) if high == "n" else (y1, y0)
            for xe, s in ((x0, 1), (x1, -1)):
                K.prism([(xe, ylo, top), (xe, yhi, top), (xe, yhi, top + span * tp)], (s * 0.12, 0, 0), plan["gable_wall"])
    else:
        span = x1 - x0
        lo_x = x0 - ov if high == "e" else x1 + ov
        hi_x = x1 + 0.12 if high == "e" else x0 - 0.12
        zl, zh = top - ov * tp, top + span * tp
        mat = K.lib("tile", "y") if mat is None else mat
        K.prism([(lo_x, y0 - ov, zl), (lo_x, y1 + ov, zl), (hi_x, y1 + ov, zh), (hi_x, y0 - ov, zh)], (0, 0, th), mat)
        K.box((lo_x + (-0.03 if high == "e" else 0.03), (y0 + y1) / 2, zl + th / 2 - 0.04), (0.06, y1 - y0 + 2 * ov, th + 0.1), trim)
        if walls:
            xlo, xhi = (x0, x1) if high == "e" else (x1, x0)
            for ye, s in ((y0, 1), (y1, -1)):
                K.prism([(xlo, ye, top), (xhi, ye, top), (xhi, ye, top + span * tp)], (0, s * 0.12, 0), plan["gable_wall"])
    return top + span * tp + th


def pent(K, face, z, depth, u0, u1, plan):
    """A narrow lean-to roof (hisashi) along a wall face at height z, sloping outward, on its fascia."""
    drop = depth * 0.3
    pts = [face.pt(u, zz, o) for (u, o, zz) in ((u0, 0.0, z), (u1, 0.0, z), (u1, depth, z - drop), (u0, depth, z - drop))]
    K.prism(pts, (0, 0, 0.1), K.lib("tile", face.axis))
    K.fbox(face, (u0 + u1) / 2, z - drop + 0.02, u1 - u0, 0.05, 0.14, depth + 0.025, K.lib("fascia"))
    with K.no_outline():
        K.fbox(face, (u0 + u1) / 2, z + 0.14, u1 - u0 - 0.1, 0.03, 0.05, 0.015, K.lib("crease"))
        if plan["tiles"] and depth > 0.5:
            # Two courses on it, so it reads as tiled like the main roof.
            for k, t in enumerate((0.33, 0.66)):
                zz = z - drop * t + 0.1
                K.fbox(face, (u0 + u1) / 2, zz + 0.012, u1 - u0 - 0.06, 0.05, 0.025, depth * t + 0.0, K.lib("tile", face.axis))


def flat(K, b, plan, rail=False):
    """Parapet, coping and a deck on a flat roof, with a roof drain. Returns the deck height."""
    x0, x1, y0, y1, top = b["x0"], b["x1"], b["y0"], b["y1"], b["z1"]
    t, ph = 0.18, 0.55
    wall = b["wall"]
    white = K.lib("trim")
    for (cx, cy, sx, sy) in (((x0 + x1) / 2, y0 + t / 2, x1 - x0, t), ((x0 + x1) / 2, y1 - t / 2, x1 - x0, t),
                             (x0 + t / 2, (y0 + y1) / 2, t, y1 - y0 - 2 * t), (x1 - t / 2, (y0 + y1) / 2, t, y1 - y0 - 2 * t)):
        K.box((cx, cy, top + ph / 2), (sx, sy, ph), wall, skip=("bottom",), grime=0.0)
        K.box((cx, cy, top + ph + 0.04), (sx + 0.08, sy + 0.08, 0.08), white)
    K.box(((x0 + x1) / 2, (y0 + y1) / 2, top + 0.02), (x1 - x0 - 2 * t, y1 - y0 - 2 * t, 0.04), K.lib("deck"), skip=("bottom",), grime=0.25)
    with K.no_outline():
        for (cx, cy, sx, sy) in (((x0 + x1) / 2, y0 - 0.01, x1 - x0, 0.03), ((x0 + x1) / 2, y1 + 0.01, x1 - x0, 0.03),
                                 (x0 - 0.01, (y0 + y1) / 2, 0.03, y1 - y0), (x1 + 0.01, (y0 + y1) / 2, 0.03, y1 - y0)):
            K.box((cx, cy, top + ph - 0.06), (sx, sy, 0.07), K.lib("crease"))
    if rail:
        rz = top + ph + 0.08
        rl = K.lib("rail")
        with K.no_outline():
            for (ax, ay, bx, by) in ((x0 + 0.1, y0 + 0.1, x1 - 0.1, y0 + 0.1), (x0 + 0.1, y1 - 0.1, x1 - 0.1, y1 - 0.1)):
                K.beam((ax, ay, rz + 0.75), (bx, by, rz + 0.75), 0.025, rl, seg=5)
                n = max(2, int(abs(bx - ax) / 1.4) + 1)
                for k in range(n):
                    px = ax + (bx - ax) * k / (n - 1)
                    K.beam((px, ay, rz), (px, ay, rz + 0.75), 0.02, rl, seg=4)
    return top + 0.04
