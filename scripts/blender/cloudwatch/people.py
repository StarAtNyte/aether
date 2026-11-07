"""People of Cloudwatch Harbour: small stylised human figures in the anime-background manner, built procedurally.

Each figure is posed from a few joints (pelvis, spine, shoulders, hips) with two-bone IK for arms and legs, then skinned
with smooth lofted shapes: a superellipse torso (chest, waist, hips), tapered limbs with knees and elbows, mitten hands,
shoes with flat soles, a jawed head with hair built as a shaped shell (bob, ponytail, long, short spiky), and clothes as
colour blocks (sleeves, collars, a sailor collar, pleated skirt, shorts, trousers, hats, a satchel strap, a tote).

Local frame of a figure: origin on the ground between the feet, front -Y, left +X, up +Z. The object's yaw turns it.
Every figure is one object named person_*, smooth shaded, with cw_person = 1, prop = True and outline = True.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

from common import LOOKOUT_Y, P, bm_object, toon_material
from form import TRACK_Y, TRACK_Z

# ----------------------------------------------------------------------------------------------------------- materials

SLOTS = ("skin", "hair", "top", "bottom", "shoes", "accent", "accent2", "socks", "extra", "eyes")


def _materials(outfit):
    cols = {
        "skin": outfit.get("skin", P["skin"]), "hair": outfit["hair"], "top": outfit["top"], "bottom": outfit["bottom"],
        "shoes": outfit.get("shoes", "#3a3440"), "accent": outfit.get("accent", "#2f3d66"),
        "accent2": outfit.get("accent2", "#e9dcb4"), "socks": outfit.get("socks", "#f2efe8"),
        "extra": outfit.get("extra", "#c8423a"), "eyes": outfit.get("eye_col", "#3a2a30"),
    }
    out = []
    for slot in SLOTS:
        c = cols[slot]
        nm = "skin" if slot == "skin" and c == P["skin"] else f"ppl_{slot}_{c[1:]}"
        out.append(toon_material(nm, c))
    return out


SKIN, HAIR, TOP, BOTTOM, SHOES, ACCENT, ACCENT2, SOCKS, EXTRA, EYES = range(10)

# ----------------------------------------------------------------------------------------------------------- mesh helpers


def _smoothstep(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def ellipsoid(bm, c, radii, R=None, mat=0, seg=10, rings=7, deform=None):
    """UV ellipsoid; `deform(v)` edits the local point (before the radii scale is applied? no: after) in place."""
    R = R or Matrix.Identity(3)
    c = Vector(c)
    rx, ry, rz = radii

    def P_(sp, cp, st, ct):
        v = Vector((rx * sp * ct, ry * sp * st, rz * cp))
        if deform:
            v = deform(v)
        return bm.verts.new(c + R @ v)

    top = P_(0, 1, 0, 1)
    rows = []
    for i in range(1, rings):
        ph = math.pi * i / rings
        rows.append([P_(math.sin(ph), math.cos(ph), math.sin(2 * math.pi * j / seg), math.cos(2 * math.pi * j / seg)) for j in range(seg)])
    bot = P_(0, -1, 0, 1)
    for j in range(seg):
        k = (j + 1) % seg
        bm.faces.new((top, rows[0][j], rows[0][k])).material_index = mat
        for i in range(len(rows) - 1):
            bm.faces.new((rows[i][j], rows[i + 1][j], rows[i + 1][k], rows[i][k])).material_index = mat
        bm.faces.new((rows[-1][j], bot, rows[-1][k])).material_index = mat


def tube(bm, pts, radii, mats, seg=8, caps=(True, True), round_caps=(True, True), ell=None, ref=None):
    """A smooth tube through `pts`; `mats[i]` colours segment i; `ell[i]` = (sx, sy) squashes ring i."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    tans = []
    for i in range(n):
        a = pts[max(0, i - 1)]
        b = pts[min(n - 1, i + 1)]
        t = b - a
        if t.length < 1e-6:
            t = pts[-1] - pts[0]
        tans.append(t.normalized())
    ref = Vector(ref) if ref is not None else Vector((0, 0, 1))
    nrm = ref - tans[0] * ref.dot(tans[0])
    if nrm.length < 1e-4:
        nrm = Vector((1, 0, 0)) - tans[0] * tans[0].x
    nrm.normalize()
    rings = []
    for i in range(n):
        if i > 0:
            nrm = nrm - tans[i] * nrm.dot(tans[i])
            if nrm.length < 1e-6:
                nrm = tans[i].orthogonal()
            nrm.normalize()
        bi = tans[i].cross(nrm)
        sx, sy = ell[i] if ell else (1.0, 1.0)
        r = radii[i]
        ring = []
        for j in range(seg):
            a = 2 * math.pi * j / seg
            ring.append(bm.verts.new(pts[i] + nrm * (math.cos(a) * r * sx) + bi * (math.sin(a) * r * sy)))
        rings.append(ring)
    for i in range(n - 1):
        for j in range(seg):
            k = (j + 1) % seg
            bm.faces.new((rings[i][j], rings[i][k], rings[i + 1][k], rings[i + 1][j])).material_index = mats[min(i, len(mats) - 1)]
    for end, (do, rnd) in enumerate(zip(caps, round_caps)):
        if not do:
            continue
        i = 0 if end == 0 else n - 1
        sgn = -1 if end == 0 else 1
        cen = bm.verts.new(pts[i] + tans[i] * sgn * (radii[i] * 0.55 if rnd else 0.0))
        m = mats[0] if end == 0 else mats[min(n - 2, len(mats) - 1)]
        for j in range(seg):
            k = (j + 1) % seg
            f = (rings[i][k], rings[i][j], cen) if end == 0 else (rings[i][j], rings[i][k], cen)
            bm.faces.new(f).material_index = m


def revolve(bm, profile, c, R=None, mat=0, seg=16, mats=None, closed=False, radial=None):
    """Revolve a (r, z) profile about the local Z axis; r = 0 ends close in a pole. `radial(a, r, z)` reshapes rings."""
    R = R or Matrix.Identity(3)
    c = Vector(c)
    rings = []
    for (r, z) in profile:
        if r <= 1e-6 and not closed:
            rings.append(bm.verts.new(c + R @ Vector((0, 0, z))))
            continue
        ring = []
        for j in range(seg):
            a = 2 * math.pi * j / seg
            rr = radial(a, r, z) if radial else r
            ring.append(bm.verts.new(c + R @ Vector((math.cos(a) * rr, math.sin(a) * rr, z))))
        rings.append(ring)
    n = len(rings)
    for i in range(n if closed else n - 1):
        A, B = rings[i], rings[(i + 1) % n]
        m = mats[i] if mats else mat
        for j in range(seg):
            k = (j + 1) % seg
            if isinstance(A, list) and isinstance(B, list):
                bm.faces.new((A[j], A[k], B[k], B[j])).material_index = m
            elif isinstance(A, list):
                bm.faces.new((A[j], A[k], B)).material_index = m
            else:
                bm.faces.new((A, B[k], B[j])).material_index = m
    for idx in ((0, -1) if not closed else ()):
        ring = rings[idx]
        if isinstance(ring, list):
            cen = bm.verts.new(c + R @ Vector((0, 0, profile[idx][1])))
            m = (mats[0] if mats else mat) if idx == 0 else (mats[-1] if mats else mat)
            for j in range(seg):
                k = (j + 1) % seg
                bm.faces.new((ring[k], ring[j], cen) if idx == 0 else (ring[j], ring[k], cen)).material_index = m


def box(bm, c, size, R=None, mat=0):
    R = R or Matrix.Identity(3)
    c = Vector(c)
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    vs = [bm.verts.new(c + R @ Vector((sx * hx, sy * hy, sz * hz))) for sz in (-1, 1) for (sx, sy) in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        bm.faces.new([vs[i] for i in f]).material_index = mat


def frame(fwd, up):
    """Rotation whose local -Y is `fwd` and local +Z is as close to `up` as possible (a part facing a direction)."""
    f = Vector(fwd).normalized()
    u = Vector(up) - f * Vector(up).dot(f)
    if u.length < 1e-5:
        u = f.orthogonal()
    u.normalize()
    x = (-f).cross(u)  # local +X
    return Matrix((x, -f, u)).transposed()


def ik(a, t, l1, l2, pole):
    """Two-bone IK: the middle joint from root `a` to target `t`, bending toward `pole`."""
    a, t, pole = Vector(a), Vector(t), Vector(pole)
    d = t - a
    L = min(d.length, (l1 + l2) * 0.999)
    L = max(L, abs(l1 - l2) + 1e-3)
    dirn = d.normalized()
    x = (l1 * l1 - l2 * l2 + L * L) / (2 * L)
    h = math.sqrt(max(0.0, l1 * l1 - x * x))
    pd = pole - dirn * pole.dot(dirn)
    pd = pd.normalized() if pd.length > 1e-6 else dirn.orthogonal().normalized()
    return a + dirn * x + pd * h, a + dirn * L


# ----------------------------------------------------------------------------------------------------------- bodies

# Torso rings: (fraction of the body height under the chin, half-width, half-depth, forward offset (+ = back)) in head units.
TORSO = {
    "f": [(0.545, 0.36, 0.34, 0.0), (0.58, 0.62, 0.46, 0.02), (0.615, 0.72, 0.52, 0.04), (0.665, 0.64, 0.47, 0.02),
          (0.73, 0.50, 0.40, 0.0), (0.79, 0.56, 0.44, -0.02), (0.84, 0.62, 0.50, -0.05), (0.88, 0.66, 0.45, -0.01),
          (0.905, 0.72, 0.40, 0.02), (0.935, 0.64, 0.34, 0.03), (0.958, 0.46, 0.29, 0.03), (0.978, 0.26, 0.24, 0.03)],
    "m": [(0.545, 0.36, 0.34, 0.0), (0.58, 0.58, 0.44, 0.02), (0.615, 0.64, 0.47, 0.03), (0.665, 0.62, 0.45, 0.02),
          (0.73, 0.60, 0.44, 0.0), (0.79, 0.68, 0.50, -0.02), (0.84, 0.78, 0.54, -0.03), (0.88, 0.84, 0.50, 0.0),
          (0.905, 0.90, 0.44, 0.02), (0.935, 0.80, 0.38, 0.03), (0.958, 0.56, 0.32, 0.03), (0.978, 0.30, 0.27, 0.03)],
    "k": [(0.50, 0.34, 0.32, 0.0), (0.54, 0.50, 0.40, 0.02), (0.58, 0.54, 0.42, 0.02), (0.64, 0.52, 0.43, 0.0),
          (0.71, 0.50, 0.44, -0.02), (0.78, 0.54, 0.42, -0.02), (0.84, 0.57, 0.40, 0.0), (0.885, 0.58, 0.34, 0.02),
          (0.92, 0.50, 0.30, 0.03), (0.95, 0.36, 0.26, 0.03), (0.97, 0.24, 0.22, 0.03)],
}


class Body:
    """Measurements of one figure from its height, head count and build ('f', 'm' or 'k')."""

    def __init__(self, height, heads, kind):
        self.H = height
        self.kind = kind
        self.hh = hh = height / heads
        self.B = B = height - hh  # chin height
        self.rings = [(f * B, a * hh, b * hh, y * hh) for (f, a, b, y) in TORSO[kind]]
        kid = kind == "k"
        self.crotch = self.rings[0][0]
        self.waist = (0.70 if kid else 0.73) * B
        self.chest = (0.84 if kid else 0.85) * B
        self.armpit = (0.86 if kid else 0.88) * B
        self.top = self.rings[-1][0]
        self.hip_x = (0.30 if kid else (0.36 if kind == "f" else 0.34)) * hh
        self.hip_z = self.crotch + (0.06 if kid else 0.05) * B
        self.sh_x = {"f": 0.60, "m": 0.74, "k": 0.44}[kind] * hh
        self.sh_z = (0.915 if kid else 0.925) * B
        self.ankle_h = (0.22 if kid else 0.25) * hh
        legs = self.hip_z - self.ankle_h
        self.thigh = legs * 0.5
        self.shin = legs * 0.5
        self.upper = (0.88 if kid else 1.30) * hh
        self.fore = (0.74 if kid else 1.10) * hh
        self.hand = (0.50 if kid else 0.72) * hh
        self.foot = (0.78 if kid else 1.0) * hh
        r = {"f": (0.37, 0.19, 0.235, 0.115, 0.19, 0.13, 0.14, 0.09), "m": (0.36, 0.21, 0.25, 0.13, 0.22, 0.15, 0.16, 0.10),
             "k": (0.30, 0.19, 0.21, 0.12, 0.17, 0.13, 0.13, 0.09)}[kind]
        (self.r_thigh, self.r_knee, self.r_calf, self.r_ankle, self.r_upper, self.r_elbow, self.r_fore, self.r_wrist) = (v * hh for v in r)
        self.skull = (0.40 * hh, 0.43 * hh, 0.47 * hh)
        self.head_c = Vector((0, 0.02 * hh, self.B + 0.47 * hh))

    def ring_at(self, z):
        rs = self.rings
        if z <= rs[0][0]:
            return rs[0][1:]
        for (z0, a0, b0, y0), (z1, a1, b1, y1) in zip(rs, rs[1:]):
            if z <= z1:
                t = (z - z0) / (z1 - z0)
                t = t * t * (3 - 2 * t) * 0.5 + t * 0.5
                return (a0 + (a1 - a0) * t, b0 + (b1 - b0) * t, y0 + (y1 - y0) * t)
        return rs[-1][1:]


SE = 2.6  # superellipse exponent of the torso's cross-section (a little square at the shoulders and hips)


def _se(a):
    c, s = math.cos(a), math.sin(a)
    return math.copysign(abs(c) ** (2 / SE), c), math.copysign(abs(s) ** (2 / SE), s)


class Pose:
    """Where the body's parts go: an upper-body transform from the pelvis and spine, plus targets for hands and feet."""

    def __init__(self, body, lean=0.0, spine=0.0, twist=0.0, roll=0.0, shift=(0, 0), dz=0.0, head=(0.0, 0.0, 0.0)):
        self.b = body
        self.lean, self.spine, self.twist, self.roll = lean, spine, twist, roll
        self.shift = Vector((shift[0], shift[1], 0))
        self.dz = dz
        self.head = head  # yaw, pitch, roll

    def R_pelvis(self):
        return Matrix.Rotation(self.twist * 0.3, 3, "Z") @ Matrix.Rotation(self.roll, 3, "Y") @ Matrix.Rotation(self.lean, 3, "X")

    def R_spine(self, f):
        return Matrix.Rotation(self.twist * 0.7 * f, 3, "Z") @ Matrix.Rotation(self.spine * f, 3, "X")

    def f_of(self, z):
        b = self.b
        return _smoothstep(b.waist, b.chest + 0.03 * b.B, z)

    def T(self, p, f=None):
        b = self.b
        p = Vector(p)
        if f is None:
            f = self.f_of(p.z)
        hipc = Vector((0, 0, b.hip_z))
        waist = Vector((0, 0, b.waist))
        q = p - waist
        q = self.R_spine(f) @ q + (waist - hipc)
        q = self.R_pelvis() @ q
        return hipc + self.shift + Vector((0, 0, self.dz)) + q

    def R_upper(self):
        return self.R_pelvis() @ self.R_spine(1.0)

    def hip(self, side):
        b = self.b
        return self.T(Vector((side * b.hip_x, 0, b.hip_z)), 0.0)

    def shoulder(self, side):
        b = self.b
        return self.T(Vector((side * b.sh_x, 0.03 * b.hh, b.sh_z)), 1.0)


# ----------------------------------------------------------------------------------------------------------- the figure


class Figure:
    def __init__(self, body, outfit, pose):
        self.b, self.o, self.p = body, outfit, pose
        self.bm = bmesh.new()

    # -- torso and clothes on it

    def surf(self, z, a, off=0.0, f=None):
        b = self.b
        ra, rb, yo = b.ring_at(z)
        cx, cy = _se(a)
        return self.p.T(Vector(((ra + off) * cx, yo + (rb + off) * cy, z)), f)

    def torso(self):
        b, o = self.b, self.o
        seg = 20
        zs = []
        rz = [r[0] for r in b.rings]
        for z0, z1 in zip(rz, rz[1:]):
            n = 2 if z1 - z0 > 0.045 * b.B else 1
            zs += [z0 + (z1 - z0) * k / n for k in range(n)]
        zs.append(rz[-1])
        hem = b.waist + 0.004 * b.B if o.get("skirt") and not o.get("dress") else o.get("hem", b.waist - 0.10 * b.B)
        rows = [[self.bm.verts.new(self.surf(z, 2 * math.pi * j / seg)) for j in range(seg)] for z in zs]
        for i in range(len(rows) - 1):
            zc = (zs[i] + zs[i + 1]) / 2
            m = TOP if zc > hem else BOTTOM
            if o.get("dress"):
                m = TOP
            for j in range(seg):
                k = (j + 1) % seg
                self.bm.faces.new((rows[i][j], rows[i][k], rows[i + 1][k], rows[i + 1][j])).material_index = m
        for idx, z in ((0, zs[0]), (-1, zs[-1])):
            cen = self.bm.verts.new(self.p.T(Vector((0, b.ring_at(z)[2], z + (-0.03 if idx == 0 else 0.01) * b.hh))))
            m = BOTTOM if idx == 0 and not o.get("dress") else TOP
            for j in range(seg):
                k = (j + 1) % seg
                r = rows[idx]
                self.bm.faces.new((r[k], r[j], cen) if idx == 0 else (r[j], r[k], cen)).material_index = m
        # A hem lip where the shirt ends over the trousers or skirt.
        if not o.get("dress") and not o.get("skirt") and o.get("untucked", True):
            ring = [self.surf(hem + 0.012 * b.B, 2 * math.pi * j / seg, 0.03 * b.hh) for j in range(seg)]
            ring2 = [self.surf(hem - 0.012 * b.B, 2 * math.pi * j / seg, 0.05 * b.hh) for j in range(seg)]
            self._band(ring, ring2, TOP)

    def _band(self, ring_top, ring_bot, mat, thick=None):
        """A closed annular band between two rings (a short sleeve of cloth around the body)."""
        n = len(ring_top)
        t = [self.bm.verts.new(v) for v in ring_top]
        bt = [self.bm.verts.new(v) for v in ring_bot]
        cen_t = sum(ring_top, Vector()) / n
        cen_b = sum(ring_bot, Vector()) / n
        ti = [self.bm.verts.new(cen_t + (v - cen_t) * 0.82) for v in ring_top]
        bi = [self.bm.verts.new(cen_b + (v - cen_b) * 0.82) for v in ring_bot]
        for j in range(n):
            k = (j + 1) % n
            for (A, B) in ((t, bt), (bt, bi), (bi, ti), (ti, t)):
                self.bm.faces.new((A[j], A[k], B[k], B[j])).material_index = mat

    def shell(self, inside, z0, z1, off, mat_of, nz=10, na=48):
        """A cloth patch lying on the torso: the grid cells (z, angle) for which `inside` holds, raised by `off`."""
        b = self.b
        verts = {}

        def V(i, j, lift):
            key = (i, j % na, lift)
            if key not in verts:
                z = z0 + (z1 - z0) * i / nz
                verts[key] = self.bm.verts.new(self.surf(z, 2 * math.pi * j / na, off + lift))
            return verts[key]

        cells = {(i, j) for i in range(nz) for j in range(na) if inside(z0 + (z1 - z0) * (i + 0.5) / nz, 2 * math.pi * (j + 0.5) / na)}
        th = 0.022 * b.hh
        for (i, j) in cells:
            m = mat_of(i, j, cells)
            self.bm.faces.new((V(i, j, th), V(i, j + 1, th), V(i + 1, j + 1, th), V(i + 1, j, th))).material_index = m
            self.bm.faces.new((V(i, j, 0), V(i + 1, j, 0), V(i + 1, j + 1, 0), V(i, j + 1, 0))).material_index = m
            for (di, dj, e) in ((-1, 0, ((i, j), (i, j + 1))), (1, 0, ((i + 1, j + 1), (i + 1, j))), (0, -1, ((i + 1, j), (i, j))), (0, 1, ((i, j + 1), (i + 1, j + 1)))):
                if ((i + di), (j + dj) % na) not in cells:
                    (a1, a2) = e
                    self.bm.faces.new((V(a1[0], a1[1], 0), V(a2[0], a2[1], 0), V(a2[0], a2[1], th), V(a1[0], a1[1], th))).material_index = m

    def sailor_collar(self):
        b = self.b
        zt = b.top
        zv = b.chest - 0.02 * b.B
        zb = b.armpit - 0.11 * b.B

        def front_dist(a):
            return abs(math.cos(a))  # 0 at the centre front/back, 1 at the sides

        def inside(z, a):
            back = math.sin(a) > 0.25
            if back:
                return z > zb and front_dist(a) < 0.86
            if z < zv:
                return False
            t = (z - zv) / (zt - zv)  # 0 at the V's point, 1 at the neck
            lo = 0.2 * t
            return lo < front_dist(a) < lo + 0.3 + 0.6 * t

        def mat_of(i, j, cells):
            na = 64
            edge = any(((i + di), (j + dj) % na) not in cells for di, dj in ((-1, 0), (0, -1), (0, 1)))
            return ACCENT2 if edge else ACCENT

        self.shell(inside, zb - 0.01 * b.B, zt + 0.004 * b.B, 0.014 * b.hh, mat_of, nz=14, na=64)
        # The scarf knot at the V.
        Ru = self.p.R_upper()
        sm = self.o.get("scarf_mat", SOCKS)
        c = self.surf(zv + 0.012 * b.B, -math.pi / 2, 0.035 * b.hh)
        ellipsoid(self.bm, c, (0.07 * b.hh, 0.035 * b.hh, 0.06 * b.hh), Ru, mat=sm, seg=8, rings=5)
        for s in (-1, 1):
            # bow loops either side of the knot, and a short tail below
            ellipsoid(self.bm, c + Ru @ Vector((s * 0.13 * b.hh, 0.0, 0.01 * b.hh)), (0.11 * b.hh, 0.03 * b.hh, 0.06 * b.hh), Ru @ Matrix.Rotation(s * 0.25, 3, "Y"), mat=sm, seg=8, rings=5)
        tail = self.surf(zv - 0.035 * b.B, -math.pi / 2, 0.035 * b.hh)
        tube(self.bm, [c, tail], [0.05 * b.hh, 0.06 * b.hh], [sm], seg=6, ell=[(1.0, 0.4), (1.0, 0.4)], ref=Ru @ Vector((1, 0, 0)))

    def shirt_collar(self):
        b = self.b
        zt = b.top

        def inside(z, a):
            fd = abs(math.cos(a))
            front = math.sin(a) < 0
            if not front:
                return z > zt - 0.03 * b.B
            # Two points coming down the front, open at the throat.
            return 0.1 < fd < 0.6 and z > zt - (0.03 + 0.035 * max(0.0, 1.0 - abs(fd - 0.3) / 0.18)) * b.B

        self.shell(inside, zt - 0.075 * b.B, zt + 0.004 * b.B, 0.01 * b.hh, lambda i, j, c: self.o.get("collar_mat", TOP), nz=8, na=48)

    def strap(self, side=1):
        """A satchel strap from one shoulder across the chest to the other hip, and the bag."""
        b = self.b
        pts = []
        z_hi, z_lo = b.top - 0.03 * b.B, b.hip_z + 0.03 * b.B
        for k in range(17):
            a = 2 * math.pi * k / 16
            # angle 0 = this shoulder; the strap's plane tilts down to the far hip
            ca = math.cos(a)
            z = (z_hi + z_lo) / 2 + ca * (z_hi - z_lo) / 2
            ang = a * 1.0 + (0 if side > 0 else math.pi)
            pts.append(self.surf(z, ang, 0.03 * b.hh))
        tube(self.bm, pts[:-1] + [pts[0]], [0.022 * b.hh] * 17, [ACCENT2], seg=5, caps=(False, False))
        # Bag on the far hip, hanging on the side.
        c = self.surf(b.hip_z - 0.02 * b.B, math.pi if side > 0 else 0.0, 0.14 * b.hh, f=0.0)
        R = self.p.R_pelvis() @ Matrix.Rotation(math.pi / 2, 3, "Z")
        box(self.bm, c, (0.95 * b.hh, 0.22 * b.hh, 0.75 * b.hh), R, ACCENT2)
        box(self.bm, c + R @ Vector((0, -0.12 * b.hh, 0.14 * b.hh)), (0.97 * b.hh, 0.04 * b.hh, 0.5 * b.hh), R, ACCENT)

    def skirt(self, length, flare, pleats=True, mat=BOTTOM):
        b = self.b
        z_top = b.waist
        z_bot = z_top - length
        seg = 24
        ra, rb, yo = b.ring_at(b.hip_z + 0.06 * b.B)
        prof = []
        n = 5
        for k in range(n + 1):
            t = k / n
            z = z_top + (z_bot - z_top) * t
            if z >= b.crotch:
                a_, b_, y_ = b.ring_at(z)
                a_ = max(a_, ra * min(1.0, t * 3)) + (0.035 + 0.12 * t) * b.hh
                b_ = max(b_, rb * min(1.0, t * 3)) + (0.035 + 0.12 * t) * b.hh
            else:
                a_, b_, y_ = ra + 0.16 * b.hh, rb + 0.2 * b.hh, yo
            grow = 1.0 + flare * max(0.0, t - 0.25) / 0.75
            prof.append((z, a_ * grow, b_ * grow, y_))
        rows = []
        for i, (z, a_, b_, y_) in enumerate(prof):
            row = []
            for j in range(seg):
                ang = 2 * math.pi * j / seg
                pl = 1.0 + (0.045 * (1 if j % 2 else -1) * (i / n) if pleats else 0.0)
                cx, cy = math.cos(ang), math.sin(ang)
                p = Vector((a_ * pl * cx, y_ + b_ * pl * cy, z))
                f = 0.0 if i > 0 else self.p.f_of(z)
                row.append(self.bm.verts.new(self.p.T(p, f)))
            rows.append(row)
        inner = [self.bm.verts.new(self.p.T(Vector((prof[-1][1] * 0.9 * math.cos(2 * math.pi * j / seg), prof[-1][3] + prof[-1][2] * 0.9 * math.sin(2 * math.pi * j / seg), z_bot + 0.03 * b.hh)), 0.0)) for j in range(seg)]
        rows.append(inner)
        for i in range(len(rows) - 1):
            for j in range(seg):
                k = (j + 1) % seg
                self.bm.faces.new((rows[i][j], rows[i][k], rows[i + 1][k], rows[i + 1][j])).material_index = mat
        cen = self.bm.verts.new(self.p.T(Vector((0, 0, z_top + 0.01)), self.p.f_of(z_top)))
        for j in range(seg):
            k = (j + 1) % seg
            self.bm.faces.new((rows[0][k], rows[0][j], cen)).material_index = mat
        cen2 = self.bm.verts.new(self.p.T(Vector((0, prof[-1][3], z_bot + 0.06 * b.hh)), 0.0))
        for j in range(seg):
            k = (j + 1) % seg
            self.bm.faces.new((inner[j], inner[k], cen2)).material_index = mat

    # -- limbs

    def leg(self, side, ankle, knee_pole, foot_fwd, foot_pitch=0.0):
        b, o = self.b, self.o
        hip = self.p.hip(side)
        knee, ank = ik(hip, ankle, b.thigh, b.shin, knee_pole)
        up = self.p.R_pelvis() @ Vector((0, 0, 1))
        start = hip + up * 0.22 * b.hh - self.p.R_pelvis() @ Vector((side * 0.06 * b.hh, 0, 0))
        th = knee - hip
        sh = ank - knee
        pts = [start, hip, hip + th * 0.3, hip + th * 0.65, knee, knee + sh * 0.28, knee + sh * 0.62, ank, ank - Vector((0, 0, 0.1 * b.hh))]
        rad = [b.r_thigh * 0.95, b.r_thigh, b.r_thigh * 0.93, b.r_thigh * 0.78, b.r_knee, b.r_calf, b.r_calf * 0.78, b.r_ankle, b.r_ankle]
        mats = [SKIN] * 8
        legwear = o.get("legs", "skin")  # skin | trousers | shorts
        if legwear == "trousers":
            rad = [max(r, w * b.hh) for r, w in zip(rad, (0.42, 0.44, 0.42, 0.36, 0.28, 0.29, 0.27, 0.25, 0.22))]
            mats = [BOTTOM] * 8
        elif legwear == "shorts":
            k = 3  # hem after the third point
            hem = pts[2] + (pts[3] - pts[2]) * 0.55
            pts = pts[:3] + [hem, hem + (pts[3] - pts[2]).normalized() * 0.012 * b.hh] + pts[3:]
            rad = [r * 1.22 + 0.03 * b.hh for r in rad[:3]] + [rad[2] * 1.18 + 0.03 * b.hh, rad[2] * 0.9] + rad[3:]
            mats = [BOTTOM, BOTTOM, BOTTOM, BOTTOM] + [SKIN] * 6
        if o.get("socks_to") is not None:
            # Socks from below the knee (or ankle socks) to the shoe.
            t = o["socks_to"]
            n = len(pts)
            for i in range(n - 1):
                if i >= n - 1 - t:
                    mats[i] = SOCKS
                    rad[i + 1] = rad[i + 1] * 1.04
        tube(self.bm, pts, rad, mats, seg=10, ref=Vector((0, -1, 0)))
        self.shoe(ank, foot_fwd, foot_pitch)
        return knee, ank

    def shoe(self, ank, fwd, pitch):
        """Shoe below the ankle: flat sole at the ankle height under it (before pitch), toe forward."""
        b = self.b
        fl = b.foot
        f = Vector((fwd[0], fwd[1], 0)).normalized()
        R = frame(f, (0, 0, 1)) @ Matrix.Rotation(pitch, 3, "X")
        ah = b.ankle_h
        c = Vector((0, -0.22 * fl, -ah + 0.15 * fl))

        def deform(v):
            v = v.copy()
            t = max(0.0, -v.y / (0.5 * fl))  # toward the toe
            if v.z > 0:
                v.z *= 1.0 - 0.45 * t
            v.z = max(v.z, -0.15 * fl + 0.0)  # flat sole
            return v

        ellipsoid(self.bm, ank + R @ c, (0.19 * fl, 0.52 * fl, 0.17 * fl), R, mat=SHOES, seg=10, rings=7,
                  deform=lambda v: deform(v))

    def arm(self, side, wrist, elbow_pole, palm, mode="relaxed", hand_fwd=None, elbow=None):
        b, o = self.b, self.o
        sh = self.p.shoulder(side)
        if elbow is None:
            el, wr = ik(sh, wrist, b.upper, b.fore, elbow_pole)
        else:
            el, wr = Vector(elbow), Vector(wrist)
        inward = self.p.R_upper() @ Vector((-side * 0.12 * b.hh, 0, 0.02 * b.hh))
        start = sh + inward
        ua, fa = el - sh, wr - el
        pts = [start, sh, sh + ua * 0.45, el, el + fa * 0.3, el + fa * 0.7, wr]
        rad = [b.r_upper * 1.05, b.r_upper, b.r_upper * 0.9, b.r_elbow, b.r_fore, b.r_fore * 0.8, b.r_wrist]
        mats = [SKIN] * 6
        sleeve = o.get("sleeve", "short")
        if sleeve == "long":
            rad = [r * 1.18 + 0.02 * b.hh for r in rad]
            mats = [TOP] * 6
        tube(self.bm, pts, rad, mats, seg=8, ref=self.p.R_upper() @ Vector((side, 0, 0)))
        if sleeve in ("short", "mid"):
            L = 0.5 if sleeve == "short" else 0.75
            sp = [start - (ua.normalized() * 0.04 * b.hh), sh, sh + ua * L * 0.6, sh + ua * L]
            sr = [b.r_upper * 1.25 + 0.02 * b.hh, b.r_upper * 1.3 + 0.03 * b.hh, b.r_upper * 1.25 + 0.03 * b.hh, b.r_upper * 1.22 + 0.035 * b.hh]
            tube(self.bm, sp, sr, [TOP], seg=8, round_caps=(True, False), ref=self.p.R_upper() @ Vector((side, 0, 0)))
        elif sleeve == "long":
            cuff = wr - fa.normalized() * 0.05 * b.hh
            tube(self.bm, [cuff - fa.normalized() * 0.12 * b.hh, cuff], [rad[-1] * 1.08, rad[-1] * 1.1], [o.get("cuff_mat", TOP)], seg=8, round_caps=(False, False))
        self.hand(wr, hand_fwd if hand_fwd is not None else fa, palm, mode)
        return el, wr

    def hand(self, wr, fwd, palm, mode):
        """Mitten hand: palm, closed fingers, thumb; 'point' sticks the index finger out."""
        b = self.b
        hl = b.hand
        f = Vector(fwd).normalized()
        R = frame(f, palm)  # local -Y along the fingers, local +Z = out of the palm
        palm_c = wr + f * 0.32 * hl
        ellipsoid(self.bm, palm_c, (0.2 * hl, 0.3 * hl, 0.1 * hl), R, mat=SKIN, seg=8, rings=5)
        if mode == "point":
            ellipsoid(self.bm, palm_c + f * 0.14 * hl + R @ Vector((0, 0, 0.06 * hl)), (0.17 * hl, 0.14 * hl, 0.11 * hl), R, mat=SKIN, seg=8, rings=5)
            side_v = R @ Vector((1, 0, 0))
            tip = palm_c + f * 0.78 * hl + side_v * 0.08 * hl
            tube(self.bm, [palm_c + f * 0.2 * hl + side_v * 0.08 * hl, tip], [0.065 * hl, 0.055 * hl], [SKIN], seg=6)
        elif mode == "grip":
            ellipsoid(self.bm, palm_c + f * 0.2 * hl + R @ Vector((0, 0, 0.1 * hl)), (0.19 * hl, 0.16 * hl, 0.13 * hl), R, mat=SKIN, seg=8, rings=5)
        else:
            ellipsoid(self.bm, palm_c + f * 0.36 * hl + R @ Vector((0, 0, 0.02 * hl)), (0.18 * hl, 0.24 * hl, 0.085 * hl), R, mat=SKIN, seg=8, rings=5)
        thumb_side = R @ Vector((1, 0, 0))
        tc = palm_c + thumb_side * 0.18 * hl + f * 0.02 * hl + R @ Vector((0, 0, 0.06 * hl))
        tube(self.bm, [tc - f * 0.1 * hl, tc + f * 0.18 * hl + thumb_side * 0.03 * hl], [0.07 * hl, 0.055 * hl], [SKIN], seg=6)

    # -- head

    def head(self, hair_style):
        b, o = self.b, self.o
        hy, hp, hr = self.p.head
        Rb = self.p.R_upper()
        Rh = Rb @ Matrix.Rotation(hy, 3, "Z") @ Matrix.Rotation(-hp, 3, "X") @ Matrix.Rotation(hr, 3, "Y")
        neck_base = self.p.T(Vector((0, 0.04 * b.hh, b.top - 0.05 * b.B)), 1.0)
        hc_canon = b.head_c
        pivot = self.p.T(Vector((0, 0.04 * b.hh, b.top + 0.02 * b.B)), 1.0)
        hc = pivot + Rh @ (hc_canon - Vector((0, 0.04 * b.hh, b.top + 0.02 * b.B)))
        self.head_c, self.Rh = hc, Rh
        tube(self.bm, [neck_base, pivot, hc + Rh @ Vector((0, 0.06 * b.hh, -0.22 * b.hh))], [0.2 * b.hh, 0.17 * b.hh, 0.16 * b.hh], [SKIN], seg=8)
        sx, sy, sz = b.skull

        def jaw(v):
            v = v.copy()
            if v.z < 0:
                t = -v.z / sz
                v.x *= 1.0 - 0.32 * t * t
                v.y *= 1.0 - 0.18 * t * t
                if v.y < 0:
                    v.y -= 0.04 * b.hh * t  # a softly pointed chin
            if v.y < 0 and v.z > -0.3 * sz:
                v.y *= 0.94  # flatter face plane
            return v

        ellipsoid(self.bm, hc, (sx, sy, sz), Rh, mat=SKIN, seg=14, rings=10, deform=jaw)
        if o.get("eyes", True):
            for s in (-1, 1):
                ex, ez = s * 0.16 * b.hh, -0.07 * b.hh
                # On the (jawed, flattened) face surface: find the skin depth there, then sit a thin oval on it.
                v = jaw(Vector((ex, -sy * math.sqrt(max(0.0, 1 - (ex / sx) ** 2 - (ez / sz) ** 2)), ez)))
                Re = Rh @ Matrix.Rotation(s * 0.38, 3, "Z") @ Matrix.Rotation(0.08, 3, "X")
                ellipsoid(self.bm, hc + Rh @ (v + Vector((0, 0.002, 0))), (0.042 * b.hh, 0.006, 0.068 * b.hh), Re, mat=EYES, seg=8, rings=4)
        if hair_style in ("short", "spiky", "old", "cap"):
            for s in (-1, 1):
                ellipsoid(self.bm, hc + Rh @ Vector((s * sx * 0.98, 0.03 * b.hh, -0.06 * b.hh)), (0.05 * b.hh, 0.1 * b.hh, 0.14 * b.hh), Rh, mat=SKIN, seg=6, rings=4)
        self.hair(hair_style)
        hat = o.get("hat")
        if hat == "straw":
            c = hc + Rh @ Vector((0, 0.02 * b.hh, sz * 0.62))
            Rt = Rh @ Matrix.Rotation(-0.12, 3, "X")
            revolve(self.bm, [(0.5 * b.hh, 0.0), (0.49 * b.hh, 0.22 * b.hh), (0.42 * b.hh, 0.36 * b.hh), (0.0, 0.4 * b.hh)], c, Rt, seg=16, mats=[ACCENT, ACCENT2, ACCENT2])
            revolve(self.bm, [(0.45 * b.hh, 0.03 * b.hh), (1.05 * b.hh, -0.07 * b.hh), (1.06 * b.hh, -0.1 * b.hh), (0.45 * b.hh, -0.02 * b.hh)], c, Rt, mat=ACCENT2, seg=20, closed=True)
        elif hat in ("cap", "flatcap"):
            flat = hat == "flatcap"
            c = hc + Rh @ Vector((0, 0.03 * b.hh, sz * 0.25))
            prof = [(sx * 1.12, 0.0), (sx * 1.1, 0.16 * b.hh), (sx * (0.95 if flat else 0.85), 0.32 * b.hh), (0.0, (0.38 if flat else 0.46) * b.hh)]
            revolve(self.bm, prof, c, Rh, mat=ACCENT2, seg=14,
                    radial=(lambda a, r, z: r * (1.0 + (0.1 if flat else 0.0) * max(0.0, -math.sin(a)))) if flat else None)
            ellipsoid(self.bm, c + Rh @ Vector((0, -sy * 1.15, 0.04 * b.hh)), (0.36 * b.hh, 0.28 * b.hh, 0.03 * b.hh), Rh @ Matrix.Rotation(-0.12, 3, "X"), mat=ACCENT2, seg=10, rings=5)

    def hair(self, style):
        """Hair as a shell around the skull: covered regions sit out, the face is cut free, bobs hang straight."""
        b = self.b
        hc, Rh = self.head_c, self.Rh
        sx, sy, sz = b.skull
        thick = {"short": 0.07, "spiky": 0.09, "old": 0.04, "cap": 0.05}.get(style, 0.09) * b.hh
        seg, rings = 22, 14
        bm = self.bm

        def placed(d):
            """d = unit direction (local, -Y = face). Returns the local point of the hair surface."""
            az = math.atan2(d.x, -d.y)  # 0 at the face, +-pi at the back
            fa = abs(az)
            base = Vector((d.x * sx, d.y * sy, d.z * sz))
            hidden = base * 0.86
            if style in ("short", "spiky", "old", "cap"):
                fringe = 0.42 + 0.08 * math.cos(az * 9) if style != "old" else 0.55
                low = 0.42 if fa < 0.75 else (0.0 if fa < 1.75 else -0.5)
                lim = fringe if fa < 0.75 else low
                if d.z < lim:
                    return hidden
                r = 1.0 + thick / sz
                if style == "spiky":
                    r += 0.16 * max(0.0, math.sin(az * 5 + 0.5) * math.sin(d.z * 7)) * max(0.0, d.z)
                if style == "old":
                    r = 1.0 + 0.03 if d.z < 0.75 else 1.0
                return base * r
            # Long styles: fringe at the brow with a zigzag, sides and back down.
            fringe = 0.32 + 0.1 * abs(math.sin(az * 6))
            if fa < 0.62:
                if d.z < fringe:
                    return hidden
            elif fa < 1.05:
                if d.z < 0.1 and style == "ponytail":
                    return hidden
            r = 1.0 + thick / min(sx, sz)
            p = base * r
            if d.z < 0 and style in ("bob", "long"):
                # Hang straight: keep the full width below the equator, longer at the back.
                horiz = Vector((d.x * sx, d.y * sy, 0)) * r
                hl = horiz.length
                w = math.sqrt(max(0.0, 1 - d.z * d.z))
                widen = (1.0 / max(w, 0.35)) * (1.0 - 0.15 * (-d.z))
                horiz = horiz * widen if hl > 0 else horiz
                p = Vector((horiz.x, horiz.y, d.z * sz * (1.45 if style == "bob" else 1.6)))
                if fa < 0.62:
                    return hidden
            elif d.z < 0 and style == "ponytail":
                if d.z < -0.45:
                    return hidden
            return p

        top = bm.verts.new(hc + Rh @ placed(Vector((0, 0, 1))))
        rows = []
        for i in range(1, rings):
            ph = math.pi * i / rings
            row = []
            for j in range(seg):
                th = 2 * math.pi * j / seg
                d = Vector((math.sin(ph) * math.cos(th), math.sin(ph) * math.sin(th), math.cos(ph)))
                row.append(bm.verts.new(hc + Rh @ placed(d)))
            rows.append(row)
        bot = bm.verts.new(hc + Rh @ Vector((0, 0, -sz * 0.8)))
        for j in range(seg):
            k = (j + 1) % seg
            bm.faces.new((top, rows[0][j], rows[0][k])).material_index = HAIR
            for i in range(len(rows) - 1):
                bm.faces.new((rows[i][j], rows[i + 1][j], rows[i + 1][k], rows[i][k])).material_index = HAIR
            bm.faces.new((rows[-1][j], bot, rows[-1][k])).material_index = HAIR
        if style == "ponytail":
            base = hc + Rh @ Vector((0, sy * 1.02, 0.15 * sz))
            down = self.p.R_upper() @ Vector((0, 0.05, -1))
            pts = [base - Rh @ Vector((0, 0.1 * b.hh, 0)), base + Rh @ Vector((0, 0.12 * b.hh, -0.05 * b.hh)), base + Rh @ Vector((0, 0.22 * b.hh, -0.3 * b.hh)),
                   base + Rh @ Vector((0, 0.2 * b.hh, -0.65 * b.hh)) + down * 0.05 * b.hh, base + Rh @ Vector((0, 0.16 * b.hh, -1.0 * b.hh)) + down * 0.1 * b.hh]
            tube(bm, pts, [0.1 * b.hh, 0.15 * b.hh, 0.19 * b.hh, 0.15 * b.hh, 0.05 * b.hh], [HAIR], seg=8)
            tube(bm, [pts[1] - Rh @ Vector((0, 0.05 * b.hh, 0)), pts[1] + Rh @ Vector((0, 0.04 * b.hh, 0))], [0.12 * b.hh, 0.12 * b.hh], [ACCENT], seg=8)
        if style == "long":
            # A curtain of hair down the back, following the body.
            ra = b.ring_at(b.armpit)
            pts, rad, ell = [], [], []
            z0 = hc.z
            for k, t in enumerate((0.0, 0.25, 0.5, 0.75, 1.0)):
                if k == 0:
                    pts.append(hc + Rh @ Vector((0, sy * 0.55, -0.1 * sz)))
                else:
                    zc = b.top - (b.top - (b.chest - 0.06 * b.B)) * t
                    q = self.surf(zc, math.pi / 2, 0.06 * b.hh + 0.03 * b.hh * t, f=1.0)
                    pts.append(q)
                w = (sx * 1.15) * (1.0 - 0.25 * t)
                rad.append(w)
                ell.append((1.0, 0.35 if k else 0.8))
            tube(bm, pts, rad, [HAIR], seg=10, ell=ell, ref=self.p.R_upper() @ Vector((1, 0, 0)))


# ----------------------------------------------------------------------------------------------------------- placement


def _to_local(pt, loc, yaw):
    return Matrix.Rotation(-yaw, 3, "Z") @ (Vector(pt) - Vector(loc))


def _finish(name, fig, loc, yaw, extra_mats=()):
    mats = _materials(fig.o) + list(extra_mats)
    zmin = min(v.co.z for v in fig.bm.verts)
    for v in fig.bm.verts:
        v.co.z -= zmin
    ob = bm_object(name, fig.bm, "people", mats=mats, smooth=True, prop=True, outline=True, recalc=True)
    ob.location = loc
    ob.rotation_euler = (0, 0, yaw)
    ob["cw_person"] = 1
    return ob


def _settle(body, pose, feet):
    """Lower the pelvis so each foot target is reachable with a hair of knee bend."""
    dz = 0.0
    for side, ank in feet:
        hip = pose.hip(side)
        d = Vector(ank) - hip
        hor = Vector((d.x, d.y, 0)).length
        reach = (body.thigh + body.shin) * 0.996
        v_need = math.sqrt(max(0.0, reach * reach - hor * hor))
        dz = min(dz, v_need - (hip.z - ank[2]))
    pose.dz += dz


def standing(body, outfit, pose, support=1, arms=None, feet=None):
    """A figure standing with its weight on the `support` leg; `arms[side]` = dict(wrist, pole, palm, mode, ...)."""
    b = body
    fig = Figure(b, outfit, pose)
    if feet is None:
        feet = {
            support: dict(ank=Vector((support * 0.32 * b.hh + pose.shift.x * 0.6, 0.05 * b.hh, b.ankle_h)), fwd=(support * 0.15, -1), pitch=0.0),
            -support: dict(ank=Vector((-support * 0.55 * b.hh, -0.28 * b.hh, b.ankle_h)), fwd=(-support * 0.35, -1), pitch=0.0),
        }
    _settle(b, pose, [(s, f["ank"]) for s, f in feet.items()])
    for s, f in feet.items():
        fig.leg(s, f["ank"], f.get("pole", Vector((s * 0.15, -1, 0))), f["fwd"], f.get("pitch", 0.0))
    fig.torso()
    sk = outfit.get("skirt")
    if sk:
        fig.skirt(sk[0] * b.B, sk[1], pleats=sk[2])
    if outfit.get("collar") == "sailor":
        fig.sailor_collar()
    elif outfit.get("collar") == "shirt":
        fig.shirt_collar()
    for side in (-1, 1):
        a = (arms or {}).get(side)
        if a is None:
            sh = pose.shoulder(side)
            reach = b.upper + b.fore
            wr = sh + Vector((side * 0.1 * b.hh, -0.12 * b.hh, -reach * 0.94))
            a = dict(wrist=wr, pole=Vector((side * 0.4, 1, 0)), palm=Vector((-side, 0.15, 0)))
        fig.arm(side, a["wrist"], a.get("pole", Vector((side * 0.3, 1, 0))), a.get("palm", Vector((-side, 0, 0))), a.get("mode", "relaxed"),
                a.get("fwd"), a.get("elbow"))
    if outfit.get("satchel"):
        fig.strap(outfit["satchel"])
    fig.head(outfit.get("hair_style", "short"))
    return fig


def foot_walk(b, side, y, front):
    """A foot in a stride: the front one strikes with its heel (toe up), the back one pushes off its toe (heel up)."""
    fl = b.foot
    if front:
        pitch = -0.22
        heel = Vector((side * 0.3 * b.hh, y + 0.28 * fl, 0.0))
        # ankle above the heel contact, rotated with the foot about the heel
        rel = Vector((0, -0.28 * fl, b.ankle_h))  # ankle relative to heel when flat
        rel = Matrix.Rotation(pitch, 3, "X") @ rel
        ank = heel + rel
    else:
        pitch = 0.42
        toe = Vector((side * 0.3 * b.hh, y - 0.68 * fl, 0.0))
        rel = Vector((0, 0.68 * fl, b.ankle_h))
        rel = Matrix.Rotation(pitch, 3, "X") @ rel
        ank = toe + rel
    return dict(ank=ank, fwd=(0, -1), pitch=pitch, pole=Vector((0, -1, 0)))


def walking(body, outfit, stride=0.9, lead=1, arms=None, **pose_kw):
    b = body
    pose = Pose(b, lean=0.05, twist=0.12 * lead, shift=(0, 0), head=pose_kw.pop("head", (0.0, -0.02, 0.0)), **pose_kw)
    s = stride * b.hh
    feet = {lead: foot_walk(b, lead, -s * 0.5, True), -lead: foot_walk(b, -lead, s * 0.5, False)}
    if arms is None:
        arms = {}
    for side in (-1, 1):
        if side in arms:
            continue
        sh = pose.shoulder(side)
        swing = -1 if side == -lead else 1  # the arm opposite the leading leg swings forward
        reach = (b.upper + b.fore) * 0.93
        wr = sh + Vector((side * 0.12 * b.hh, swing * -0.55 * b.hh if swing < 0 else 0.5 * b.hh, -reach * 0.92))
        arms[side] = dict(wrist=wr, pole=Vector((side * 0.3, 1, 0.2)), palm=Vector((-side, 0, 0)))
    return standing(b, outfit, pose, arms=arms, feet=feet)


# ----------------------------------------------------------------------------------------------------------- the cast


def _ground(x, y, r):
    from detail import drop_min
    return drop_min(x, y, r, r)


def lookout_girl():
    """A schoolgirl in a sailor uniform, forearms on the lookout's railing, looking out to sea (-Y)."""
    x, y = -2.2, LOOKOUT_Y[0] + 0.62
    z = _ground(x, y, 0.2)
    b = Body(1.56, 6.8, "f")
    outfit = {"hair": "#2f2630", "hair_style": "long", "top": P["shirt_white"], "bottom": P["skirt_navy"], "accent": "#2f3d66",
              "accent2": "#f4f1ea", "socks": "#2a2b3a", "socks_to": 2, "shoes": "#3a2a26", "skirt": (0.20, 0.28, True),
              "collar": "sailor", "scarf_mat": None, "hem": b.waist + 0.01 * b.B, "untucked": True}
    outfit["scarf_mat"] = EXTRA
    rail_y = (LOOKOUT_Y[0] + 0.15) - y  # local: rail centre 0.47 m in front (-Y) ... (world y grows inland; front is -Y)
    rail_top = 1.07
    # Lean the upper body from the hips until the elbows rest on the railing.
    elbow = {s: Vector((s * 0.55 * b.hh, rail_y + 0.02, rail_top + b.r_elbow * 0.9)) for s in (-1, 1)}
    best = None
    for k in range(60):
        lean = math.radians(k)
        pose = Pose(b, lean=lean * 0.75, spine=lean * 0.25, roll=0.05, shift=(0.12 * b.hh, rail_y + 0.37), head=(0.12, lean * 0.75 - 0.05, 0.06))
        d = (pose.shoulder(1) - elbow[1]).length
        if d <= b.upper * 1.0:
            best = pose
            break
    pose = best or pose
    arms = {}
    for s in (-1, 1):
        wr = elbow[s] + Vector((-s * 0.85 * b.fore, -0.25 * b.fore, 0.02 * b.hh))
        wr = elbow[s] + (wr - elbow[s]).normalized() * b.fore
        arms[s] = dict(wrist=wr, elbow=elbow[s], palm=Vector((0, 0, -1)), fwd=(wr - elbow[s]))
    feet = {
        1: dict(ank=Vector((0.34 * b.hh, rail_y + 0.42, b.ankle_h)), fwd=(0.12, -1), pitch=0.0),
        -1: dict(ank=Vector((-0.3 * b.hh, rail_y + 0.24, b.ankle_h)), fwd=(-0.1, -1), pitch=0.0),
    }
    fig = standing(b, outfit, pose, arms=arms, feet=feet)
    return _finish("person_lookout", fig, (x, y, z), 0.0)


def stair_walker():
    """A man in a straw hat and an open-collared shirt walking up the stair (+Y), mid-stride, a satchel across him."""
    x, y = -0.55, 24.0
    z = _ground(x, y, 0.3)
    b = Body(1.72, 7.0, "m")
    outfit = {"hair": "#2a2a30", "hair_style": "short", "top": "#f2efe8", "bottom": "#3d4250", "legs": "trousers", "hat": "straw",
              "accent": "#7a3f36", "accent2": "#e6cf8c", "collar": "shirt", "sleeve": "short", "satchel": 1, "shoes": "#5a3a2c",
              "hem": b.waist - 0.08 * b.B}
    outfit["accent2"] = "#e6cf8c"
    fig = walking(b, outfit, stride=1.6, lead=1)
    # satchel/strap use ACCENT2 straw colour: give them the bag colour instead by a separate slot? keep straw tone (canvas bag).
    return _finish("person_stair", fig, (x, y, z), math.pi)


def crossing_pair():
    """A mother and child waiting at the lowered barrier: hand in hand, the child pointing across the track."""
    mx, my = -0.6, TRACK_Y - 3.05
    kx, ky = 0.28, TRACK_Y - 3.2
    mz = _ground(mx, my, 0.25)
    kz = _ground(kx, ky, 0.2)
    myaw, kyaw = math.pi + 0.08, math.pi + 0.35
    bm_ = Body(1.62, 6.8, "f")
    bk = Body(1.16, 5.2, "k")
    # Where the hands meet (world).
    meet = Vector(((mx + kx) / 2 + 0.02, (my + ky) / 2 - 0.04, mz + 0.70))
    mother = {"hair": "#4a3530", "hair_style": "ponytail", "top": "#e8b4a0", "bottom": "#5a6a8a", "skirt": (0.42, 0.3, False),
              "accent": "#d8d0c0", "accent2": "#c9b28a", "collar": "shirt", "collar_mat": TOP, "sleeve": "mid", "shoes": "#efe8dc",
              "hem": bm_.waist - 0.02 * bm_.B}
    kid = {"hair": "#3a2a28", "hair_style": "cap", "top": "#f5d76e", "bottom": "#4f78b0", "legs": "shorts", "hat": "cap",
           "accent2": "#d84a3c", "shoes": "#e9e4d6", "socks": "#f4f1ea", "socks_to": 1, "eyes": True}
    # Mother: right hand (-X local) holds the child, left hand carries a tote.
    pose_m = Pose(bm_, roll=-0.05, shift=(-0.1 * bm_.hh, 0), head=(-0.4, -0.22, 0.0), twist=-0.06)
    loc_m = Vector((mx, my, mz))
    m_meet = _to_local(meet, loc_m, myaw)
    sh = pose_m.shoulder(-1)
    d = (m_meet - sh).normalized()
    arms_m = {
        -1: dict(wrist=m_meet - d * 0.3 * bm_.hand + Vector((0.02, 0, 0)), pole=Vector((-0.3, 1, 0)), palm=Vector((-0.3, 0.2, 0)), mode="grip", fwd=d),
        1: dict(wrist=pose_m.shoulder(1) + Vector((0.18 * bm_.hh, 0.05 * bm_.hh, -(bm_.upper + bm_.fore) * 0.97)), pole=Vector((0.2, 1, 0)), palm=Vector((-1, 0, 0)), mode="grip"),
    }
    fig = standing(bm_, mother, pose_m, support=1, arms=arms_m)
    # Tote bag hanging from the left hand.
    wl = pose_m.shoulder(1) + Vector((0.18 * bm_.hh, 0.05 * bm_.hh, -(bm_.upper + bm_.fore) * 0.97))
    hand_c = wl + Vector((0, 0, -0.32 * bm_.hand))
    bag_c = hand_c + Vector((0.2 * bm_.hh, 0, -0.62 * bm_.hh))
    box(fig.bm, bag_c, (0.18 * bm_.hh, 1.0 * bm_.hh, 0.95 * bm_.hh), None, ACCENT)
    for dy in (-0.25, 0.25):
        tube(fig.bm, [bag_c + Vector((0.0, dy * bm_.hh, 0.45 * bm_.hh)), hand_c + Vector((0, dy * 0.3 * bm_.hh, -0.02)), bag_c + Vector((0.0, dy * bm_.hh * 0.2, 0.45 * bm_.hh))],
             [0.025 * bm_.hh] * 3, [ACCENT2], seg=5)
    _finish("person_cross_0", fig, tuple(loc_m), myaw)
    # Child: left hand (+X local) holds the mother, right hand points across the track at the far signal.
    pose_k = Pose(bk, lean=-0.06, spine=-0.04, roll=0.04, shift=(0.05 * bk.hh, 0), head=(-0.15, 0.3, 0.0))
    loc_k = Vector((kx, ky, kz))
    k_meet = _to_local(meet, loc_k, kyaw)
    shk = pose_k.shoulder(1)
    dk = (k_meet - shk).normalized()
    target = _to_local(Vector((1.9, TRACK_Y + 2.4, TRACK_Z + 2.55)), loc_k, kyaw)
    shr = pose_k.shoulder(-1)
    pd = (target - shr).normalized()
    wr_r = shr + pd * (bk.upper + bk.fore) * 0.96
    arms_k = {
        1: dict(wrist=k_meet - dk * 0.3 * bk.hand, pole=Vector((0.4, 1, 0)), palm=Vector((0.3, -0.2, 0)), mode="grip", fwd=dk),
        -1: dict(wrist=wr_r, pole=Vector((-1, 0.3, -0.5)), palm=Vector((0.6, 0, -1)), mode="point", fwd=pd),
    }
    figk = standing(bk, kid, pose_k, support=-1, arms=arms_k)
    _finish("person_cross_1", figk, tuple(loc_k), kyaw)


def shop_boy():
    """A boy by the shop with his bicycle, one hand on the handlebar's near grip."""
    b = Body(1.66, 6.8, "m")
    outfit = {"hair": "#3a2c28", "hair_style": "spiky", "top": P["shirt_blue"], "bottom": P["shorts"], "legs": "shorts",
              "collar": "shirt", "collar_mat": TOP, "socks": "#f4f1ea", "socks_to": 1, "shoes": "#e9e4d6", "sleeve": "short",
              "hem": b.waist - 0.09 * b.B}
    bike = bpy.data.objects.get("bicycle_0")
    if bike is None:
        from town import HOUSES
        shop = next((h for h in HOUSES if h.get("shop")), None)
        x, y = shop["x"] - shop["w"] / 2 + 2.1, shop["y"] - shop["d"] / 2 - 1.3
        z = _ground(x, y, 0.3)
        fig = standing(b, outfit, Pose(b, roll=0.05, shift=(0.1 * b.hh, 0)))
        return _finish("person_shop", fig, (x, y, z), -0.6)
    by = bike.rotation_euler.z
    Rb = Matrix.Rotation(by, 3, "Z")
    bl = bike.location
    # Stand at the bike's near (-Y) side by the front wheel, facing the way it points.
    pos = bl + Rb @ Vector((0.22, -0.62, 0))
    yaw = by + math.pi / 2
    z = _ground(pos.x, pos.y, 0.3)
    loc = Vector((pos.x, pos.y, z))
    grip = Vector(bl) + Rb @ Vector((0.36, -0.28, 0.98))  # the bike's handlebar end (its local frame)
    g_local = _to_local(grip + Vector((0, 0, 0.03)), loc, yaw)
    pose = Pose(b, roll=-0.04, shift=(0.08 * b.hh, 0), twist=0.1, head=(0.5, 0.05, 0.0))
    sh = pose.shoulder(1)
    d = (g_local - sh)
    hand_fwd = Vector((0.3, -1, 0))
    arms = {1: dict(wrist=g_local - hand_fwd.normalized() * 0.3 * b.hand + Vector((0, 0, 0.04 * b.hh)), pole=Vector((0.6, 1, -0.2)), palm=Vector((0, 0, -1)), mode="grip", fwd=hand_fwd)}
    fig = standing(b, outfit, pose, support=1, arms=arms)
    return _finish("person_shop", fig, tuple(loc), yaw)


def harbour_walker():
    """A woman in a sundress and straw hat strolling along the harbour road toward the town's east end."""
    x, y = -12.0, -23.45
    z = _ground(x, y, 0.3)
    b = Body(1.6, 6.8, "f")
    outfit = {"hair": "#5a3a2e", "hair_style": "bob", "top": "#f3eadb", "bottom": "#f3eadb", "dress": True, "skirt": (0.47, 0.32, False),
              "sleeve": "none", "hat": "straw", "accent": "#3a6ea5", "accent2": "#e6cf8c", "shoes": "#8a5a3c"}
    fig = walking(b, outfit, stride=1.4, lead=-1)
    return _finish("person_harbour", fig, (x, y, z), math.pi / 2)


def bench_elder():
    """An old man sitting on a bench at the lookout, hands on his knees, facing the sea. The bench is part of him."""
    x, y = 6.2, LOOKOUT_Y[0] + 1.25
    z = _ground(x, y, 0.8)
    b = Body(1.64, 7.0, "m")
    outfit = {"hair": "#c9c4bc", "hair_style": "old", "top": "#8a9a7a", "bottom": "#5a5560", "legs": "trousers", "hat": "flatcap",
              "accent2": "#6a6058", "sleeve": "long", "shoes": "#3a2e2a", "collar": "shirt", "collar_mat": TOP, "socks": "#f2efe8",
              "hem": b.waist - 0.1 * b.B}
    # Sit: hips at seat height with thighs level and shins down to the ground.
    knee_fwd = b.thigh * 0.97
    ank_y = -knee_fwd - 0.12 * b.hh
    hip_z = b.ankle_h + math.sqrt(b.shin ** 2 - (0.12 * b.hh) ** 2) * 0.99
    pose = Pose(b, lean=0.16, spine=0.14, dz=hip_z - b.hip_z, shift=(0, 0.04), head=(0.0, 0.12, 0.0))
    fig = Figure(b, outfit, pose)
    knees = {}
    for s in (-1, 1):
        hip = pose.hip(s)
        ank = Vector((s * 0.55 * b.hh, hip.y + ank_y, b.ankle_h))
        knee_target = Vector((s * 0.5 * b.hh, hip.y - knee_fwd, hip.z + 0.02))
        # Pole forward and up: the knee sits in front of the hip.
        kn, _ = fig.leg(s, ank, Vector((0, -1, 1.2)), (s * 0.1, -1), 0.0)
        knees[s] = kn
    fig.torso()
    fig.shirt_collar()
    for s in (-1, 1):
        k = knees[s]
        wr = k + Vector((-s * 0.02, 0.18 * b.hh, b.r_knee + 0.14 * b.hh))
        fig.arm(s, wr, Vector((s * 0.6, 1, 0)), Vector((0, 0, -1)), "relaxed", Vector((0, -1, -0.5)))
    fig.head("old")
    # Bench under him: the seat's top at the lowest point of his seat (thigh undersides).
    seat_top = min(pose.hip(s).z for s in (-1, 1)) - b.r_thigh * 1.0
    benches = toon_material("bench_wood", P["wood"], var="#9a6a48", noise_scale=2)
    iron = toon_material("bench_iron", "#3a3a44")
    seat_y0 = pose.hip(1).y - 0.06
    W = 1.5
    for k in range(4):
        box(fig.bm, (0.2, seat_y0 - 0.17 + k * 0.105, seat_top - 0.02), (W, 0.09, 0.04), None, 10)
    for k in range(2):
        box(fig.bm, (0.2, seat_y0 + 0.24 + 0.03 * k, seat_top + 0.22 + k * 0.17), (W, 0.035, 0.12), Matrix.Rotation(-0.18, 3, "X"), 10)
    for sx in (0.2 - W / 2 + 0.12, 0.2 + W / 2 - 0.12):
        box(fig.bm, (sx, seat_y0 - 0.15, (seat_top - 0.04) / 2), (0.06, 0.06, seat_top - 0.04), None, 11)
        box(fig.bm, (sx, seat_y0 + 0.2, (seat_top + 0.45) / 2), (0.06, 0.06, seat_top + 0.45), None, 11)
        box(fig.bm, (sx, seat_y0 + 0.02, seat_top - 0.07), (0.06, 0.44, 0.05), None, 11)
    return _finish("person_bench", fig, (x, y, z), 0.0, extra_mats=(benches, iron))


def build():
    # (No static girl at the lookout rail: the world's animated girl walks there and stands at the railing.)
    stair_walker()
    crossing_pair()
    shop_boy()
    harbour_walker()
    bench_elder()
