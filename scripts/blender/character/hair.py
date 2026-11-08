"""The hair library: sculpted clump styles with parameters, accessories, and their spring chains.

A clump is a lens-section lock lofted along a guide path that lies on the hair shell (the head's surface pushed out by
the hair's volume) from its root to where it leaves the scalp, then falls (gravity, a flare, the style's tip: a bob's
inward curl, a straight cut, a point). Its wide axis is tangent to the shell, so neighbouring clumps overlap like
painted clumps and the inverted-hull outline draws their edges. Under them a cap (the scalp inside the hairline,
pushed out) closes the gaps.

Styles: `bob` (chin length, inward curl, side or centre parting, bangs laid on the forehead), `long` (straight to the
back with a fringe), `ponytail` (tied at the back of the head), `short` (cropped, for men or under a cap), `bald`.
Accessories: `braid` (behind an ear, with a `charm`: seashell or bead), `hairband`, `knit cap`, and a `beard`.

UV v follows height on the head, so the highlight band of the hair strip (paint.paint_hair) lines up into one ring.
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from common import Part, catmull, catmull_tangent, lerp, new_object, shade_smooth, smoothstep
from skeleton import add_secondary


class Shell:
    """Points on the head's surface by polar angle phi (0 = top) and azimuth theta (0 = front, 90 = her left)."""

    def __init__(self, form, centre):
        self.form = form
        self.c = np.array(centre)

    def dir(self, phi, theta):
        return np.array([math.sin(phi) * math.sin(theta), -math.sin(phi) * math.cos(theta), math.cos(phi)])

    def radius(self, d):
        ts = np.linspace(0.02, 0.25, 116)
        P = self.c + np.outer(ts, d)
        s = self.form.sdf(P)
        i = int(np.argmax(s > 0))
        if i == 0:
            return 0.1
        t0, t1 = ts[i - 1], ts[i]
        return t0 + (t1 - t0) * (-s[i - 1] / (s[i] - s[i - 1]))

    def point(self, phi, theta, out=0.0):
        d = self.dir(phi, theta)
        return Vector(self.c + d * (self.radius(d) + out))


def to_b(v):
    return Vector(v)


class Hair:
    def __init__(self, spec, J, form, chin, atlas, bones, body_bvh):
        self.spec = spec
        self.h = spec['hair']
        self.u = form.u
        self.form = form
        self.chin = Vector(chin)
        self.centre = Vector(chin) + Vector(form.cran_c)
        self.shell = Shell(form, self.centre)
        self.top = self.shell.point(0.0, 0.0).z
        self.atlas = atlas
        self.bones = bones
        self.J = J
        self.bvh = body_bvh
        self.parts = []
        self.springs = []
        self.verts, self.faces, self.uvs, self.weights = [], [], [], []
        grey = self.h.get('grey', 0)
        atlas_name = 'hair'
        from paint import paint_hair
        paint_hair(atlas, atlas_name, self.h['colour'], grey)
        self.cell = atlas_name
        self.ring_z = self.top - 0.05 * self.u

    # --- geometry --------------------------------------------------------------------------------------------------
    def v_of(self, z):
        return float(np.clip(0.79 + (z - self.ring_z) / (0.07 * self.u) * 0.21, 0.03, 0.98))

    strands = False
    strand_k = 0

    def clump(self, path, width, thick, tip='point', weights=None, around=10, along=20, centre_hint=None, flat=1.0):
        """Loft a lens-section clump along the Catmull-Rom `path` (Vectors)."""
        base = len(self.verts)
        hub = centre_hint if centre_hint is not None else self.centre
        rings = []
        for i in range(along + 1):
            t = i / along
            p = catmull(path, t)
            T = catmull_tangent(path, t)
            out = p - hub
            if p.z < self.chin.z + 0.06 * self.u:
                out = Vector((p.x - hub.x, p.y - hub.y, 0))
            N = (out - T * out.dot(T))
            if N.length < 1e-6:
                N = Vector((0, -1, 0))
            N.normalize()
            Bv = T.cross(N).normalized()
            wf = smoothstep(0.0, 0.18, t) * 0.55 + 0.45
            if tip == 'point':
                wf *= 1 - smoothstep(0.55, 1.0, t) * 0.97
            elif tip == 'longpoint':
                # a long lock's end: full most of the way, then a short point
                wf *= 1 - smoothstep(0.8, 1.0, t) * 0.95
            elif tip == 'curl':
                # a bob's lock: a rounded, turned-in end (a short point, not a spike)
                wf *= 1 - smoothstep(0.66, 1.0, t) * 0.92
            elif tip == 'cut':
                wf *= 1 - smoothstep(0.85, 1.0, t) * 0.5
            tf = wf ** 0.7
            w = width * wf
            th = thick * tf
            ring = []
            for k in range(around):
                a = 2 * math.pi * k / around
                x = math.cos(a) * w / 2
                y = math.sin(a) * th / 2 * (0.55 + 0.45 * abs(math.sin(a))) * flat
                ring.append(p + Bv * x + N * y)
            rings.append((ring, p, t))
        for i, (ring, p, t) in enumerate(rings):
            for k, q in enumerate(ring):
                self.verts.append(q)
                uu = 0.5 + 0.5 * math.cos(2 * math.pi * k / around)
                self.uvs.append(self.atlas.uv(self.cell, 0.08 + 0.84 * uu, self.v_of(p.z) if t < 0.999 else 0.03))
                self.weights.append(weights(p, t) if weights else {'Bip01_Head': 1.0})
        for i in range(along):
            for k in range(around):
                a = base + i * around + k
                b = base + i * around + (k + 1) % around
                self.faces.append((a, b, b + around, a + around))
        # caps: the root closed, the tip closed
        self.faces.append(tuple(base + k for k in range(around))[::-1])
        last = base + along * around
        self.faces.append(tuple(last + k for k in range(around)))

    def push_out(self, p, margin):
        """Keep a path point out of the body and head (BVH), by `margin`."""
        if self.bvh is None:
            return p
        loc, n, _, d = self.bvh.find_nearest(p)
        if loc is None:
            return p
        inside = (p - loc).dot(n) < 0
        if inside or d < margin:
            return loc + n * margin
        return p

    def lock(self, theta, phi_root, phi_leave, tip_z, width, thick, out, tip='curl', curl=0.02, flare=0.01, weights=None, swirl=0.0, theta_root=None, around=10, along=20):
        """A clump from a root on the shell over the scalp to its hanging end at height `tip_z`."""
        th_r = theta if theta_root is None else theta_root
        pts = []
        n_on = 5
        for i in range(n_on):
            f = i / (n_on - 1)
            ph = lerp(phi_root, phi_leave, f)
            tt = lerp(th_r, theta + swirl, f)
            pts.append(self.shell.point(ph, tt, out * (0.15 + 0.85 * smoothstep(0.0, 0.5, f))))
        leave = pts[-1]
        radial = Vector((leave.x - self.centre.x, leave.y - self.centre.y, 0))
        radial = radial.normalized() if radial.length > 1e-6 else Vector((0, 1, 0))
        drop = leave.z - tip_z
        if drop > 0.004:
            # (finely sampled, so pushing the path out of the clothes under it holds between its points)
            n_h = max(2, int(drop / (0.018 * self.u)) + 2)
            for i in range(1, n_h + 1):
                f = i / n_h
                z = leave.z - drop * f
                fl = flare * math.sin(min(1.0, f * 1.3) * math.pi * 0.5)
                if tip == 'curl':
                    fl -= curl * smoothstep(0.6, 1.0, f)
                q = Vector((leave.x, leave.y, z)) + radial * fl
                q = self.push_out(q, thick * 0.6 + 0.004 * self.u)
                pts.append(q)
        if tip == 'curl' and drop > 0.02:
            # the end turns in under the mass (a short, smooth hook: a bigger one bunches the tip into a knot)
            last = pts[-1]
            pts.append(last + Vector((0, 0, -0.002 * self.u)) - radial * curl * 0.3)
        self.clump(pts, width, thick, tip=tip, weights=weights, around=around, along=along)
        if self.strands and drop > 0.04 and width > 0.045 * self.u:
            # strands: two thin pointed locks along the clump's edges (wide axis tangent to the shell), one shorter and
            # one longer, so the ends separate into points the way a painted lock's ends do
            k = self.strand_k
            self.strand_k += 1
            for sgn, dl in ((1, -0.012 - 0.01 * (0.5 + 0.5 * math.sin(k * 2.1))), (-1, -0.03 - 0.015 * (0.5 + 0.5 * math.cos(k * 1.7)))):
                side = radial.cross(Vector((0, 0, 1))).normalized() * sgn * width * 0.34
                sp = [q + side * smoothstep(0.0, 0.5, i / max(1, len(pts) - 1)) for i, q in enumerate(pts)]
                end = sp[-1] + Vector((0, 0, -dl * self.u)) + radial * 0.002 * self.u
                sp = sp[:-1] + [end]
                sp = [sp[0]] + [self.push_out(q, thick * 0.4 + 0.003 * self.u) for q in sp[1:]]
                self.clump(sp, width * 0.3, thick * 0.55, tip='point', weights=weights, around=6, along=max(8, along // 2))
        return pts

    def cap(self, head, hairline):
        """The scalp inside the hairline, pushed out: hair colour under the clumps."""
        bm = bmesh.new()
        bm.from_mesh(head.data)
        bm.verts.ensure_lookup_table()
        keep = set()
        for v in bm.verts:
            d = (v.co - self.centre)
            r = d.length
            phi = math.acos(max(-1, min(1, d.z / r)))
            theta = math.atan2(d.x, -d.y)
            if phi < hairline(theta):
                keep.add(v.index)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.index not in keep], context='VERTS')
        for v in bm.verts:
            v.co = v.co + v.normal * 0.0035 * self.u
        me = bpy.data.meshes.new('hair-cap')
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new('hair-cap', me)
        bpy.context.scene.collection.objects.link(ob)
        shade_smooth(ob)
        uv = self.atlas.uv(self.cell, 0.5, 0.86)
        uvl = me.uv_layers.new(name='UVMap')
        for l in uvl.data:
            l.uv = uv
        self.parts.append(Part(ob, 'hair', toon=(0.4, 0.0, 0.6, 0.0), bones={'Bip01_Head': 1.0}))

    def finish(self, name='hair', toon=(1.15, 0.0, 1.0, 0.0)):
        if not self.verts:
            return
        ob = new_object(name, self.verts, self.faces)
        shade_smooth(ob)
        uvl = ob.data.uv_layers.new(name='UVMap')
        for poly in ob.data.polygons:
            for li in poly.loop_indices:
                uvl.data[li].uv = self.uvs[ob.data.loops[li].vertex_index]
        for i, w in enumerate(self.weights):
            for b, x in w.items():
                g = ob.vertex_groups.get(b) or ob.vertex_groups.new(name=b)
                g.add([i], x, 'REPLACE')
        self.parts.append(Part(ob, 'hair', toon=toon, bones='groups'))
        self.verts, self.faces, self.uvs, self.weights = [], [], [], []

    # --- springs ---------------------------------------------------------------------------------------------------
    def chain(self, prefix, path_pts, ts, stiffness=0.3, drag=0.2, gravity=0.35, radius=0.012, limit=0.7, parent='Bip01_Head'):
        """Spring bones along a guide path at parameters `ts`; returns a weight function over the path parameter."""
        from common import b2g_point
        names = []
        pos = []
        for i, t in enumerate(ts):
            nm = f'{prefix}_{i + 1}'
            p = catmull(path_pts, t)
            add_secondary(self.bones, nm, parent if i == 0 else names[-1], b2g_point(p))
            names.append(nm)
            pos.append(p)
        tip = catmull(path_pts, 1.0)
        d = b2g_point(tip - pos[-1])
        self.springs.append({'name': prefix.lower().replace('hair_', ''), 'bones': names, 'tip': d, 'stiffness': stiffness, 'drag': drag, 'gravity': gravity, 'radius': radius, 'limit': limit})
        return names, ts


def chain_weights(names, ts, head='Bip01_Head', start=None):
    """Weights along a clump's parameter t: the head above the first bone, then a blend down the chain."""
    knots = [start if start is not None else max(0.0, ts[0] - 0.2)] + list(ts)
    bones = [head] + list(names)

    def f(p, t):
        if t <= knots[0]:
            return {head: 1.0}
        for i in range(len(knots) - 1):
            if t <= knots[i + 1]:
                a = (t - knots[i]) / (knots[i + 1] - knots[i])
                a = a * a * (3 - 2 * a)
                return {bones[i]: 1 - a, bones[i + 1]: a}
        return {bones[-1]: 1.0}
    return f


# ---------------------------------------------------------------------------------------------------------------------
# Styles.

def build_hair(spec, J, head, form, chin, atlas, bones, body_bvh):
    H = Hair(spec, J, form, chin, atlas, bones, body_bvh)
    st = H.h['style']
    if st == 'bald':
        return H
    u = H.u
    vol = 0.014 * u * H.h['volume']
    part = H.h['parting']
    part_theta = math.radians(22) if 'left' in part else math.radians(-22) if 'right' in part else 0.0
    # hairline: polar angle by azimuth (front higher, nape lower)
    def hairline(theta):
        c = math.cos(theta)
        return math.radians(lerp(112, 68, (c + 1) / 2)) if st != 'short' else math.radians(lerp(108, 66, (c + 1) / 2))
    H.cap(head, hairline)
    # thin strands at the locks' edges for the styles that hang (spec['hair_strands'] false turns them off)
    H.strands = st in ('bob', 'long') and spec.get('hair_strands', True)
    chin_z = H.chin.z
    top = H.top
    if st in ('bob', 'long', 'ponytail'):
        bangs(H, part_theta, vol, st)
    if st == 'bob':
        tip_front = chin_z + 0.004 * u - (H.h['length'] - 0.25) * 0.5
        n = 13
        for i in range(n):
            # azimuth around the sides and back, skipping the face
            theta = math.radians(lerp(62, 298, i / (n - 1)))
            back = (1 - math.cos(theta)) / 2
            tz = lerp(tip_front, tip_front - 0.012 * u, back)
            w = 0.066 * u
            phi_leave = math.radians(lerp(92, 108, back))
            H.lock(theta, math.radians(10), phi_leave, tz, w, 0.018 * u, vol * (1.3 - 0.25 * back), tip='curl', curl=0.022 * u, flare=0.018 * u,
                   theta_root=math.radians(180) + (theta - math.radians(180)) * 0.2)
        side_locks(H, vol, chin_z + 0.0 * u, 'curl')
        # the back mass swings a little
    elif st == 'long':
        length = H.h['length']
        tip = top - length
        # two layers of clumps: an outer layer of broad locks with pointed ends at staggered lengths, and under it a
        # second layer between them (so the mass reads as clumps with depth, not one sheet)
        n = 15
        for layer_k, (nn, off, wk, outk) in enumerate(((n, 0.0, 1.0, 1.0), (n - 1, 0.5, 0.8, 0.55))):
            for i in range(nn):
                theta = math.radians(lerp(58, 302, (i + off) / (n - 1)))
                back = (1 - math.cos(theta)) / 2
                tz = tip + 0.03 * (1 - back) * u + 0.035 * u * (0.5 + 0.5 * math.sin(i * 2.3 + layer_k)) + 0.02 * u * layer_k
                phi_leave = math.radians(lerp(102, 118, back))
                side = 'L' if math.sin(theta) > 0.3 else 'R' if math.sin(theta) < -0.3 else 'C'
                H.lock(theta, math.radians(10), phi_leave, tz, 0.058 * u * wk, 0.013 * u, vol * outk, tip='longpoint', flare=0.012 * u * outk,
                       theta_root=math.radians(180) + (theta - math.radians(180)) * 0.25, weights=long_weights(H, side), swirl=0.03 * math.sin(i * 1.3),
                       around=8, along=13 if layer_k else 15)
        side_locks(H, vol, top - min(length, 0.42) + 0.02, 'cut')
    elif st == 'ponytail':
        for i in range(9):
            theta = math.radians(lerp(65, 295, i / 8))
            H.lock(theta, math.radians(10), math.radians(98), H.shell.point(math.radians(98), theta).z + 0.01, 0.06 * u, 0.012 * u, vol * 0.7, tip='point')
        tie = H.shell.point(math.radians(80), math.radians(180), vol)
        path = [tie, tie + Vector((0, 0.04, -0.02)) * u, tie + Vector((0, 0.05, -0.12)) * u, tie + Vector((0, 0.03, -H.h['length'] + 0.0))]
        names, ts = H.chain('Hair_Tail', path, [0.25, 0.6], stiffness=0.25, gravity=0.6, limit=0.9)
        for k in range(5):
            off = Vector((math.cos(k * 1.3) * 0.012, math.sin(k * 1.3) * 0.01, 0)) * u
            H.clump([p + off * (0.3 + 0.7 * i / 3) for i, p in enumerate(path)], 0.04 * u, 0.02 * u, tip='point', weights=chain_weights(names, ts))
        side_locks(H, vol * 0.7, chin_z + 0.01, 'point')
    elif st == 'short':
        n = 12
        for i in range(n):
            theta = math.radians(lerp(0, 360, i / n))
            phi_leave = math.radians(lerp(114, 64, (math.cos(theta) + 1) / 2))
            H.lock(theta, math.radians(8), phi_leave, H.shell.point(phi_leave, theta).z - 0.004 * u, 0.06 * u, 0.008 * u, 0.006 * u, tip='point', theta_root=theta)
    H.finish()
    for acc in H.h['accessories']:
        it = acc.get('item', '')
        if 'braid' in it:
            braid(H, acc)
        elif 'band' in it:
            hairband(H, acc)
        elif 'cap' in it or 'beanie' in it:
            knit_cap(H, acc)
    if H.h.get('beard'):
        beard(H, H.h['beard'])
    return H


def bangs(H, part_theta, vol, st):
    """Bangs from the parting over the front, laid on the forehead; tips at the brows, side-swept from a side parting."""
    u = H.u
    brow_z = H.chin.z + 0.128 * u
    n = 7 if st == 'bob' else 9 if st == 'long' else 7
    sweep = -0.35 if part_theta > 0 else 0.35 if part_theta < 0 else 0.0
    for i in range(n):
        f = i / (n - 1)
        theta = math.radians(lerp(-58, 58, f))
        root_theta = part_theta + (theta - part_theta) * 0.25
        tip_theta = theta + sweep * 0.35 * (1 - abs(f - 0.5) * 2)
        length_k = 1 - 0.25 * abs(f - 0.5) * 2
        tz = brow_z - 0.004 * u * length_k + 0.012 * u * abs(f - 0.5) * 2 - H.spec.get('fringe_drop', 0.0) * length_k
        pts = []
        for k in range(7):
            g = k / 6
            ph = lerp(math.radians(14), math.radians(78), g)
            th = lerp(root_theta, tip_theta, g)
            pts.append(H.shell.point(ph, th, (vol * (1 - 0.55 * g) + 0.002 * u) * (0.2 + 0.8 * smoothstep(0.0, 0.35, g))))
        # down to the tip height, on the forehead
        last = pts[-1]
        if last.z > tz:
            q = H.shell.point(math.radians(78), tip_theta, 0.003 * u)
            dz = last.z - tz
            pts.append(Vector((q.x, q.y - 0.002 * u, last.z - dz * 0.6)))
            q2 = q.copy()
            q2.z = tz
            q2 = H.push_out(q2, 0.003 * u) if H.bvh else q2
            pts.append(Vector((q2.x, q2.y - 0.0015 * u, tz)))
        bw = 0.03 if n == 9 else (0.048 if abs(f - 0.5) < 0.3 else 0.042) if st == 'bob' else (0.034 if abs(f - 0.5) < 0.3 else 0.03)
        # a long style's fringe is soft: rounded, overlapping ends (a bob's bangs are a few large points)
        H.clump(pts, (bw * 1.15 if n == 9 else bw) * u, 0.01 * u, tip='curl' if n == 9 else 'point')
        if st == 'bob' and 0 < i < n - 1:
            # a thin point between two bangs, a little shorter: the fringe's edge breaks into strands
            mid_t = theta + math.radians(58 * 2 / (n - 1)) * 0.5
            q = [H.shell.point(lerp(math.radians(30), math.radians(80), g), lerp(root_theta, mid_t, g), (vol * (1 - 0.5 * g) + 0.0035 * u)) for g in (0.0, 0.35, 0.7, 1.0)]
            q.append(Vector((q[-1].x, q[-1].y - 0.002 * u, tz + 0.012 * u)))
            H.clump(q, 0.018 * u, 0.006 * u, tip='point')


def side_locks(H, vol, tip_z, tip):
    """Locks in front of the ears framing the face, on spring chains."""
    u = H.u
    for side, sx in (('L', 1), ('R', -1)):
        theta = math.radians(sx * 50)
        pts = [H.shell.point(math.radians(20), theta * 0.4, vol * 0.2), H.shell.point(math.radians(55), theta * 0.85, vol), H.shell.point(math.radians(85), theta, vol * 0.9)]
        leave = pts[-1]
        drop = leave.z - tip_z
        for k in range(1, 4):
            q = Vector((leave.x + sx * 0.004 * u * k / 3, leave.y - 0.004 * u * k / 3, leave.z - drop * k / 3))
            q = H.push_out(q, 0.008 * u)
            pts.append(q)
        names, ts = H.chain(f'Hair_Side{side}', pts, [0.55, 0.8], stiffness=0.3, drag=0.2, gravity=0.35, radius=0.012, limit=0.7)
        H.clump(pts, 0.036 * u, 0.012 * u, tip='point' if tip != 'cut' else 'cut', weights=chain_weights(names, ts, start=0.4))


def long_weights(H, side):
    """Long hair falls on three chains (left, centre, right) below the head."""
    key = f'Hair_Back{side}'
    if key not in H.__dict__.setdefault('_chains', {}):
        u = H.u
        theta = {'L': 120, 'C': 180, 'R': 240}[side]
        p0 = H.shell.point(math.radians(112), math.radians(theta), 0.014 * u)
        tip_z = H.top - H.h['length']
        pts = [p0 + Vector((0, 0, 0.04 * u)), p0, Vector((p0.x, p0.y + 0.01, (p0.z + tip_z) / 2)), Vector((p0.x, p0.y + 0.012, tip_z))]
        pts = [H.push_out(p, 0.02 * u) for p in pts]
        names, ts = H.chain(key, pts, [0.33, 0.62, 0.85], stiffness=0.26, drag=0.2, gravity=0.45, radius=0.02, limit=0.6)
        H._chains[key] = (names, pts)
    names, pts = H._chains[key]
    z = [p.z for p in pts]
    z1, z2, z3 = catmull(pts, 0.33).z, catmull(pts, 0.62).z, catmull(pts, 0.85).z
    head_z = z1 + 0.05

    def f(p, t):
        zz = p.z
        knots = [head_z, z1, z2, z3]
        bones = ['Bip01_Head'] + list(names)
        if zz >= knots[0]:
            return {'Bip01_Head': 1.0}
        for i in range(3):
            if zz >= knots[i + 1]:
                a = (knots[i] - zz) / (knots[i] - knots[i + 1])
                a = a * a * (3 - 2 * a)
                return {bones[i]: 1 - a, bones[i + 1]: a}
        return {bones[-1]: 1.0}
    return f


def braid(H, acc):
    """A thin braid behind an ear: alternating lobes down a short chain, ending in a charm."""
    u = H.u
    sx = 1 if acc.get('side', 'left') == 'left' else -1
    az = float(acc.get('azimuth', 84))
    root = H.shell.point(math.radians(80), math.radians(sx * az), 0.006 * u)
    p1 = root + Vector((sx * 0.006, -0.002, -0.03)) * u
    p2 = root + Vector((sx * 0.01, -0.003, -0.08)) * u
    p3 = root + Vector((sx * 0.011, -0.004, -0.125)) * u
    path = [root + Vector((0, -0.004, 0.02)) * u, root, p1, p2, p3]
    path = [H.push_out(p, 0.012 * u) for p in path]
    # over the hair already made (the bob's side locks), not under it
    hair_obs = [p.ob for p in H.parts if p.kind == 'hair']
    if hair_obs:
        vs, ps = [], []
        for o in hair_obs:
            b0 = len(vs)
            vs += [v.co.copy() for v in o.data.vertices]
            ps += [[b0 + i for i in pl.vertices] for pl in o.data.polygons]
        hb = BVHTree.FromPolygons(vs, ps)
        out_dir = Vector((sx, -0.25, 0)).normalized()
        moved = []
        for k, p in enumerate(path):
            if k < 2:
                moved.append(p)
                continue
            hit = hb.ray_cast(p + out_dir * 0.2, -out_dir, 0.25)
            if hit[0] is not None and (hit[0] - p).dot(out_dir) > -0.004 * u:
                p = hit[0] + out_dir * 0.007 * u
            moved.append(p)
        path = moved
    names, ts = H.chain('Hair_Braid', path, [0.45, 0.74], stiffness=0.22, drag=0.18, gravity=0.6, radius=0.012, limit=0.9)
    wfun = chain_weights(names, ts, start=0.3)
    lobes = 9
    for i in range(lobes):
        t0 = 0.15 + 0.85 * i / lobes
        t1 = 0.15 + 0.85 * (i + 1.25) / lobes
        a = catmull(path, t0)
        b = catmull(path, min(1.0, t1))
        side = Vector((1, 0, 0)) if i % 2 else Vector((-1, 0, 0))
        sx2 = (1 if i % 2 else -1) * 0.0028 * u
        mid = (a + b) / 2
        pts = [a + Vector((sx2, 0, 0)), mid - Vector((sx2 * 0.3, 0, 0)), b - Vector((sx2, 0, 0))]
        H.clump(pts, 0.011 * u * (1 - 0.25 * i / lobes), 0.008 * u, tip='point', weights=lambda p, t, t0=t0: wfun(p, t0 + 0.1 * t), around=8, along=6)
    H.finish('braid', toon=(0.8, 0.0, 1.0, 0.0))
    # tie and charm
    end = catmull(path, 1.0)
    charm = acc.get('charm', 'bead')
    col = __import__('common').colour(acc.get('charm_colour'), '#f1e6cf')
    gold = __import__('common').colour('#c9a24a')
    tie_uv = H.atlas.swatch('charm_gold', gold)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=0.0035 * u)
    bmesh.ops.translate(bm, verts=bm.verts, vec=end + Vector((0, 0, -0.002 * u)))
    me = bpy.data.meshes.new('charm-tie')
    bm.to_mesh(me)
    bm.free()
    ob_tie = bpy.data.objects.new('charm-tie', me)
    bpy.context.scene.collection.objects.link(ob_tie)
    set_uv(ob_tie, tie_uv)
    shade_smooth(ob_tie)
    from paint import paint_shell
    paint_shell(H.atlas, 'shell', col)
    # seashell: a fan with ribs (atlas), slightly cupped
    verts, faces, uvs = [], [], []
    nf, nr = 12, 5
    hinge = end + Vector((0, 0, -0.005 * u))
    size = 0.017 * u
    for j in range(nr + 1):
        for i in range(nf + 1):
            a = math.radians(lerp(-62, 62, i / nf))
            r = size * (0.15 + 0.85 * j / nr) * (1 - 0.08 * math.cos(a * 9) ** 2 * (j / nr))
            x = math.sin(a) * r
            z = -math.cos(a) * r
            y = -0.003 * u * math.sin(math.pi * j / nr) * math.cos(a) - 0.0015 * u
            verts.append(hinge + Vector((x * 0.95, y, z)).copy() if sx > 0 else hinge + Vector((x, y, z)))
            uvs.append(H.atlas.uv('shell', 0.5 + math.sin(a) * 0.45 * (j / nr), 0.05 + 0.9 * j / nr * math.cos(a) * 0.95))
    for j in range(nr):
        for i in range(nf):
            k = j * (nf + 1) + i
            faces.append((k, k + 1, k + nf + 2, k + nf + 1))
    ob = new_object('charm', verts, faces)
    sol = ob.modifiers.new('s', 'SOLIDIFY')
    sol.thickness = 0.002 * u
    sol.offset = 0
    shade_smooth(ob)
    uvl = ob.data.uv_layers.new(name='UVMap')
    for poly in ob.data.polygons:
        for li in poly.loop_indices:
            uvl.data[li].uv = uvs[ob.data.loops[li].vertex_index]
    from common import apply_modifiers
    apply_modifiers(ob)
    wl = {names[-1]: 1.0}
    H.parts.append(Part(ob, 'acc', toon=(0.6, 0.1, 1.0, 0.0), bones=wl))
    H.parts.append(Part(ob_tie, 'acc', toon=(0.5, 0.1, 1.0, 0.0), bones=wl))


def set_uv(ob, uv):
    uvl = ob.data.uv_layers.new(name='UVMap')
    for l in uvl.data:
        l.uv = uv


def hairband(H, acc):
    """A thin band over the head from ear to ear, just behind the fringe, lying on the hair (cast onto the clumps),
    its ends tucked under the hair behind the ears."""
    from common import colour
    u = H.u
    col = colour(acc.get('colour'), '#f4f1f2')
    uv = H.atlas.swatch('hairband', col)
    hair_obs = [p.ob for p in H.parts if p.kind == 'hair']
    vs, ps = [], []
    for o in hair_obs:
        base = len(vs)
        vs += [v.co.copy() for v in o.data.vertices]
        ps += [[base + i for i in pl.vertices] for pl in o.data.polygons]
    bvh = BVHTree.FromPolygons(vs, ps) if vs else None
    rings = []
    n = 24
    for i in range(n + 1):
        f = i / n
        th = math.radians(lerp(-84, 84, f))
        ph = abs(th)
        az = 90 if th > 0 else -90
        p = H.shell.point(ph * 0.98, math.radians(az) * 1.0, 0.0)
        p = p + Vector((0, -0.03 * u, 0)) * math.cos(th)
        d = (p - H.centre).normalized()
        q = H.centre + d * ((p - H.centre).length + 0.019 * u * H.h['volume'])
        tuck = smoothstep(0.8, 1.0, abs(2 * f - 1))
        r_shell = (p - H.centre).length
        if bvh is not None:
            hit = bvh.ray_cast(H.centre + d * 0.5, -d, 0.6)
            r_hit = (hit[0] - H.centre).length if hit[0] is not None else None
            # on the hair, 1.5 mm proud, but only where the hair is the head's own cover (not a lock hanging out to
            # the side); the last fifth at each end sinks under it
            lo, hi = r_shell + 0.004 * u, r_shell + 0.03 * u * max(1.0, H.h['volume'])
            r = min(hi, max(lo, r_hit)) if r_hit is not None else r_shell + 0.019 * u * H.h['volume']
            q = H.centre + d * (r + 0.0015 * u - 0.012 * u * tuck)
        rings.append(q)
    verts, faces = [], []
    for i, q in enumerate(rings):
        d = (q - H.centre).normalized()
        t = (rings[min(n, i + 1)] - rings[max(0, i - 1)]).normalized()
        side = t.cross(d).normalized()
        for a in range(6):
            ang = 2 * math.pi * a / 6
            verts.append(q + side * math.cos(ang) * 0.0085 * u + d * math.sin(ang) * 0.0025 * u)
    for i in range(n):
        for a in range(6):
            k = i * 6 + a
            k2 = i * 6 + (a + 1) % 6
            faces.append((k, k2, k2 + 6, k + 6))
    ob = new_object('hairband', verts, faces)
    shade_smooth(ob)
    set_uv(ob, uv)
    H.parts.append(Part(ob, 'acc', toon=(0.7, 0.05, 1.0, 0.0), bones={'Bip01_Head': 1.0}))


def knit_cap(H, acc):
    """A rolled knit cap over the crown: the shell pushed out, with a folded brim and ribs."""
    from common import colour
    u = H.u
    col = colour(acc.get('colour'), '#9a4a2a')
    uv = H.atlas.swatch('cap', col)
    uv2 = H.atlas.swatch('cap_dark', tuple(c * 0.7 for c in col))
    verts, faces, uvs = [], [], []
    na, nr = 32, 10
    for j in range(nr + 1):
        ph = math.radians(lerp(2, 84, j / nr))
        for i in range(na):
            th = 2 * math.pi * i / na
            cuff = j >= nr - 3
            out = 0.024 * u + 0.008 * u * cuff - 0.006 * u * (j == nr) + 0.0008 * u * math.cos(i * 2 * math.pi / 3) * (not cuff)
            p = H.shell.point(ph, th, out)
            verts.append(p)
            uvs.append(uv2 if j >= nr - 3 else uv)
    for j in range(nr):
        for i in range(na):
            k = j * na + i
            k2 = j * na + (i + 1) % na
            faces.append((k, k2, k2 + na, k + na))
    c = len(verts)
    verts.append(H.shell.point(0, 0, 0.025 * u))
    uvs.append(uv)
    for i in range(na):
        faces.append((c, (i + 1) % na, i))
    ob = new_object('knit-cap', verts, faces)
    shade_smooth(ob)
    uvl = ob.data.uv_layers.new(name='UVMap')
    for poly in ob.data.polygons:
        for li in poly.loop_indices:
            uvl.data[li].uv = uvs[ob.data.loops[li].vertex_index]
    from common import subdivide
    subdivide(ob, 1)
    H.parts.append(Part(ob, 'acc', toon=(1.0, 0.0, 1.0, 0.0), bones={'Bip01_Head': 1.0}))


def beard(H, b):
    """A short beard and moustache: clumps over the jaw and upper lip."""
    from common import colour
    u = H.u
    save = H.cell
    from paint import paint_hair
    paint_hair(H.atlas, 'beard', colour(b.get('colour'), '#c9c6c2'))
    H.cell = 'beard'
    L = float(b.get('length', 0.04))
    c = H.chin
    n = 9
    L = min(L, 0.03)
    for i in range(n):
        f = i / (n - 1)
        a = math.radians(lerp(-72, 72, f))
        # along the jaw line, from below the ear to the chin, lying on it
        start = c + Vector((math.sin(a) * 0.046 * u, -0.012 * u - math.cos(a) * 0.033 * u, 0.055 * u - 0.035 * u * math.cos(a)))
        start = H.push_out(start, 0.003 * u) if H.bvh else start
        mid = start + Vector((-math.sin(a) * 0.004 * u, -0.004 * u * math.cos(a), -L * 0.55))
        mid = H.push_out(mid, 0.003 * u) if H.bvh else mid
        end = mid + Vector((-math.sin(a) * 0.004 * u, 0.002 * u, -L * 0.45))
        H.clump([start, mid, end], 0.026 * u, 0.008 * u, tip='point', around=8, along=8)
    # moustache
    for sx in (1, -1):
        p0 = c + Vector((sx * 0.002 * u, -0.072 * u, 0.055 * u))
        pts = [p0, p0 + Vector((sx * 0.012 * u, 0.002 * u, -0.004 * u)), p0 + Vector((sx * 0.022 * u, 0.012 * u, -0.012 * u))]
        H.clump([H.push_out(p, 0.003 * u) for p in pts], 0.012 * u, 0.006 * u, tip='point', around=8, along=8)
    H.finish('beard', toon=(0.8, 0.0, 0.8, 0.0))
    H.cell = save
