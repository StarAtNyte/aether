"""The building kit's mesh builder: one bmesh per building, primitives in world metres, and the bookkeeping the QA reads.

- Wear layers: `bk_grime` (0..1, darkens any material, `materials._wear_nodes`) and `bk_moss` (roof tiles) are vertex
  floats; `cw_noline` marks vertices that get no outline shell (tile courses, balusters, small fittings).
- Parts: every attached fitting (an outdoor unit, a meter, a pot, a stair) is built inside `with K.part(name, support)`,
  which records its faces. The QA checks each part against the body (walls and roofs) and the ground: its base or back
  must touch what carries it within 3 cm, and nothing may sink more than 3 cm into the body or another part.
"""
import math
from contextlib import contextmanager

import bmesh
from mathutils import Vector


class Face:
    """One wall face of a block: outward normal (nx, ny), plane coordinate, the range along it (u) and its height."""

    def __init__(self, n, p, u0, u1, z0, z1):
        self.n, self.p, self.u0, self.u1, self.z0, self.z1 = n, p, u0, u1, z0, z1

    @property
    def length(self):
        return self.u1 - self.u0

    @property
    def axis(self):
        """The world axis along the face ('x' or 'y')."""
        return "x" if self.n[1] else "y"

    def pt(self, u, z, off=0.0):
        nx, ny = self.n
        if ny:
            return (u, self.p + ny * off, z)
        return (self.p + nx * off, u, z)

    def tangent(self):
        """Unit vector along +u."""
        return (1.0, 0.0, 0.0) if self.n[1] else (0.0, 1.0, 0.0)


class K:
    """The builder of one building (or of many sharing a mesh: the town builds each house into its own)."""

    def __init__(self, lib, tier="hero"):
        self.bm = bmesh.new()
        self.lib = lib
        self.tier = tier
        self.grime = self.bm.verts.layers.float.new("bk_grime")
        self.moss = self.bm.verts.layers.float.new("bk_moss")
        self.noline = self.bm.verts.layers.float.new("cw_noline")
        self.parts = []
        self.recalc = []  # faces of closed solids built in no particular winding (normals fixed in `finish`)
        self._part = None
        self._noline = False
        self._grime_v = 0.0

    # -------------------------------------------------------------------------------------------------------- state

    @contextmanager
    def part(self, name, support="below", normal=None):
        """Record the faces built inside as one part. support: 'below' (it stands on something), 'back' (it hangs on a
        wall: `normal` is the wall's outward normal), 'none' (not checked for contact)."""
        rec = {"name": name, "support": support, "normal": normal, "faces": []}
        prev = self._part
        self._part = rec
        try:
            yield rec
        finally:
            self._part = prev
            self.parts.append(rec)

    @contextmanager
    def no_outline(self, on=True):
        prev = self._noline
        self._noline = on or prev
        try:
            yield
        finally:
            self._noline = prev

    def _v(self, co, grime=None, moss=0.0):
        v = self.bm.verts.new(co)
        v[self.grime] = self._grime_v if grime is None else grime
        v[self.moss] = moss
        if self._noline:
            v[self.noline] = 1.0
        return v

    def _f(self, vs, mi):
        f = self.bm.faces.new(vs)
        f.material_index = mi
        if self._part is not None:
            self._part["faces"].append(f)
        return f

    @property
    def seg(self):
        return {"hero": 8, "mid": 6}.get(self.tier, 5)

    # -------------------------------------------------------------------------------------------------------- primitives

    def quad(self, a, b, c, d, mi, grime=None):
        """A quad a-b-c-d (counter-clockwise seen from its front). `grime`: per-corner values or one value."""
        g = grime if isinstance(grime, (list, tuple)) else [grime] * 4
        return self._f([self._v(p, g[i]) for i, p in enumerate((a, b, c, d))], mi)

    def poly(self, pts, mi, grime=None):
        return self._f([self._v(p, grime) for p in pts], mi)

    def box(self, center, size, mi, skip=(), grime=None):
        """An axis box. `skip`: faces to leave out, of 'bottom', 'top', '-x', '+x', '-y', '+y'."""
        cx, cy, cz = center
        sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
        vs = []
        for dz in (-sz, sz):
            for dx, dy in ((-sx, -sy), (sx, -sy), (sx, sy), (-sx, sy)):
                vs.append(self._v((cx + dx, cy + dy, cz + dz), grime))
        idx = {"bottom": (0, 3, 2, 1), "top": (4, 5, 6, 7), "-y": (0, 1, 5, 4), "+x": (1, 2, 6, 5), "+y": (2, 3, 7, 6), "-x": (3, 0, 4, 7)}
        out = []
        for k, f in idx.items():
            if k in skip:
                continue
            out.append(self._f([vs[i] for i in f], mi))
        # Unused corner vertices (a fully skipped side) are removed at the end (`finish`).
        return out

    def fbox(self, face, u, z, su, sn, sz, off, mi, bottom=True, top=True, grime=None, skip=()):
        """A box on a wall face: su along it, sn out of it (its centre `off` out of the wall plane), sz high. The side
        against the wall is left out when it touches the wall. `skip` also takes 'back', 'front' (toward and away from
        the wall) and 'sides' (both ends along it)."""
        size = (su, sn, sz) if face.n[1] else (sn, su, sz)
        back = {(0, -1): "+y", (0, 1): "-y", (-1, 0): "+x", (1, 0): "-x"}[face.n]
        skip = set(skip)
        if "back" in skip:
            skip.discard("back")
            skip.add(back)
        if "front" in skip:
            skip.discard("front")
            skip.add({"+y": "-y", "-y": "+y", "+x": "-x", "-x": "+x"}[back])
        if "sides" in skip:
            skip.discard("sides")
            skip |= {"-x", "+x"} if face.n[1] else {"-y", "+y"}
        if abs(off - sn / 2) < 0.004:
            skip.add(back)
        if not bottom:
            skip.add("bottom")
        if not top:
            skip.add("top")
        return self.box(face.pt(u, z, off), size, mi, skip=skip, grime=grime)

    def prism(self, poly, off, mi, caps=True):
        """A closed prism: the planar polygon `poly` swept by the vector `off` (faces outward whatever the winding)."""
        n = Vector((0.0, 0.0, 0.0))
        for i in range(len(poly)):
            p, q = Vector(poly[i]), Vector(poly[(i + 1) % len(poly)])
            n += Vector(((p.y - q.y) * (p.z + q.z), (p.z - q.z) * (p.x + q.x), (p.x - q.x) * (p.y + q.y)))
        if n.dot(Vector(off)) < 0:
            poly = list(reversed(poly))
        a = [self._v(p) for p in poly]
        b = [self._v((p[0] + off[0], p[1] + off[1], p[2] + off[2])) for p in poly]
        n = len(poly)
        fs = []
        if caps:
            fs += [self._f(list(reversed(a)), mi), self._f(b, mi)]
        for i in range(n):
            j = (i + 1) % n
            fs.append(self._f((a[i], a[j], b[j], b[i]), mi))
        return fs

    def cyl(self, base, radius, height, mi, axis=None, seg=None, radius_top=None, cap=True, cap0=None, cap1=None):
        seg = seg or self.seg
        rt = radius if radius_top is None else radius_top
        base = Vector(base)
        ax = Vector((0, 0, 1)) if axis is None else Vector(axis).normalized()
        ref = Vector((1, 0, 0)) if abs(ax.x) < 0.9 else Vector((0, 1, 0))
        u = ax.cross(ref).normalized()
        v = ax.cross(u).normalized()
        bot, top = [], []
        for i in range(seg):
            a = 2 * math.pi * (i + 0.5) / seg
            d = u * math.cos(a) + v * math.sin(a)
            bot.append(self._v(base + d * radius))
            top.append(self._v(base + ax * height + d * rt))
        for i in range(seg):
            j = (i + 1) % seg
            self._f((bot[i], bot[j], top[j], top[i]), mi)
        if cap if cap0 is None else cap0:
            self._f(list(reversed(bot)), mi)
        if cap if cap1 is None else cap1:
            self._f(top, mi)
        return bot, top

    def beam(self, a, b, r, mi, seg=None, cap=True):
        d = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
        ln = math.sqrt(d[0] ** 2 + d[1] ** 2 + d[2] ** 2)
        if ln < 1e-6:
            return None
        return self.cyl(a, r, ln, mi, axis=d, seg=seg, cap=cap)

    def pipe(self, pts, r, mi, seg=None):
        """A bent pipe through `pts`, one ring per point (mitred), capped at both ends."""
        seg = seg or max(5, self.seg - 2)
        P = [Vector(p) for p in pts]
        rings = []
        for i, p in enumerate(P):
            if i == 0:
                t = (P[1] - P[0]).normalized()
            elif i == len(P) - 1:
                t = (P[-1] - P[-2]).normalized()
            else:
                t = ((P[i] - P[i - 1]).normalized() + (P[i + 1] - P[i]).normalized()).normalized()
            if i == 0:
                ref = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
                u = t.cross(ref).normalized()
            else:
                u = (u - t * u.dot(t)).normalized()
            v = t.cross(u).normalized()
            ring = []
            for k in range(seg):
                a = 2 * math.pi * k / seg
                ring.append(self._v(p + (u * math.cos(a) + v * math.sin(a)) * r))
            rings.append(ring)
        for i in range(len(rings) - 1):
            a, b = rings[i], rings[i + 1]
            for k in range(seg):
                j = (k + 1) % seg
                self._f((a[k], a[j], b[j], b[k]), mi)
        self._f(list(reversed(rings[0])), mi)
        self._f(rings[-1], mi)

    def sphere(self, center, radius, mi, scale=(1, 1, 1), subdiv=1):
        r = bmesh.ops.create_icosphere(self.bm, subdivisions=subdiv, radius=radius)
        c = Vector(center)
        for v in r["verts"]:
            v.co = c + Vector((v.co.x * scale[0], v.co.y * scale[1], v.co.z * scale[2]))
            v[self.grime] = self._grime_v
            if self._noline:
                v[self.noline] = 1.0
        fs = {f for v in r["verts"] for f in v.link_faces}
        for f in fs:
            f.material_index = mi
            if self._part is not None:
                self._part["faces"].append(f)
        return list(fs)

    # -------------------------------------------------------------------------------------------------------- finish

    def finish(self):
        """Make the closed solids' normals consistent (everything else is built facing out) and drop vertices no face
        uses (skipped box sides)."""
        faces = [f for f in self.recalc if f.is_valid]
        if faces:
            bmesh.ops.recalc_face_normals(self.bm, faces=faces)
        self.recalc = []
        loose = [v for v in self.bm.verts if not v.link_faces]
        bmesh.ops.delete(self.bm, geom=loose, context="VERTS")

    def triangles(self):
        return sum(len(f.verts) - 2 for f in self.bm.faces)
