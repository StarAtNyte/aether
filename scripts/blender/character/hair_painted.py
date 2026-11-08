"""`hair_style = painted`: the hair as a few smooth, simple shapes carrying a painted texture (painted.py).

- the cap (hair.py's scalp, one flat tone: the hair's shadow colour under the sheets);
- the mass: one sheet over the sides and back, hanging from the crown to its ends (a bob's inward curl, a long hair's
  straight fall on three spring chains blended across the azimuth), its ends and gaps cut by the texture's alpha;
- the fringe: one sheet over the forehead, a fan of painted locks from the parting;
- two face-framing locks (spring chains), as flat strips with a painted taper.

Every sheet is a single smooth surface (no per-lock geometry, no strand ribbons); the lock edges, shadows, highlight
ring, strand lines and flyaways are in the texture. The runtime outline has no width on these parts (toon x = 0): the
rim line painted round each lock is the outline, so only the shapes' silhouettes get one, never every card.
"""
import math

import numpy as np
from mathutils import Vector

from common import Part, catmull, catmull_tangent, lerp, new_object, shade_smooth, smoothstep
from hair import chain_weights, long_weights

SHEET_TOON = (0.0, 0.8, 0.35, 0.0)   # outline width 0 (the texture has the line), shade bias like the cap's, rim


def _flip_outward(H, verts, faces):
    """Wind the faces so their normals point away from the head's centre (the material draws front faces only)."""
    c = H.centre
    s = 0.0
    for f in faces:
        p = [verts[i] for i in f]
        n = (p[1] - p[0]).cross(p[2] - p[0])
        mid = sum(p, Vector()) / len(p)
        s += n.dot(mid - c)
    return [f[::-1] for f in faces] if s < 0 else faces


def _grid(H, name, nu, nv, pos, cell, weights=None, u_range=(0.0, 1.0)):
    """A (nu+1) x (nv+1) sheet: pos(fu, fr) -> Vector (fu across, fr down 0..1); UV into the atlas cell."""
    verts, uvs, wts = [], [], []
    for j in range(nv + 1):
        fr = j / nv
        for i in range(nu + 1):
            fu = i / nu
            p = pos(fu, fr)
            verts.append(p)
            uvs.append(H.atlas.uv(cell, lerp(u_range[0], u_range[1], fu), 1 - fr, inset=1.0))
            wts.append(weights(p, fu, fr) if weights else {'Bip01_Head': 1.0})
    faces = []
    for j in range(nv):
        for i in range(nu):
            a = j * (nu + 1) + i
            faces.append((a, a + 1, a + nu + 2, a + nu + 1))
    faces = _flip_outward(H, verts, faces)
    # a closed thin shell: an inner layer 2.5 mm under the outer one, faces reversed, the same UVs and weights, so a
    # sheet seen from inside (through a gap, the far side of the mass) draws hair, not the outline's back faces
    n0 = len(verts)
    for p, uv_, w_ in list(zip(verts, uvs, wts)):
        d = (p - H.centre)
        verts.append(p - d.normalized() * 0.0025 * H.u)
        uvs.append(uv_)
        wts.append(w_)
    faces = faces + [tuple(i + n0 for i in f[::-1]) for f in faces]
    ob = new_object(name, verts, faces)
    shade_smooth(ob)
    uvl = ob.data.uv_layers.new(name='UVMap')
    for poly in ob.data.polygons:
        for li in poly.loop_indices:
            uvl.data[li].uv = uvs[ob.data.loops[li].vertex_index]
    for k, w in enumerate(wts):
        for b, x in w.items():
            g = ob.vertex_groups.get(b) or ob.vertex_groups.new(name=b)
            g.add([k], x, 'REPLACE')
    H.parts.append(Part(ob, 'hair', toon=SHEET_TOON, bones='groups'))
    return ob


def prepare(H, part_theta):
    """Paint the cells (before the cap, which takes its flat tone from one)."""
    import painted as PT
    pal = PT.Hair_palette(H.h['colour'], H.spec)
    at = H.atlas
    PT.paint_mass(at, 'hp_mass', pal)
    part_u = float(np.clip((part_theta + math.radians(68)) / math.radians(136), 0.1, 0.9))
    PT.paint_fringe(at, 'hp_fringe', pal, part_u=part_u)
    PT.paint_side(at, 'hp_side', pal)
    at.cell('hp_cap', 16, 16)
    at.put('hp_cap', np.ones((32, 32, 3)) * pal.grade(pal.shade * 1.05), np.ones((32, 32)), 2)
    H.cap_uv = at.uv('hp_cap', 0.5, 0.5)


def build_painted(H, vol, part_theta, st):
    """Cap already built; the painted mass, fringe and side locks for style `st` (bob, long, short)."""
    u = H.u
    chin_z = H.chin.z
    top = H.top

    # --- the mass -----------------------------------------------------------------------------------------------
    th0, th1 = math.radians(52), math.radians(308)
    if st == 'bob':
        tip_front = chin_z + 0.004 * u - (H.h['length'] - 0.25) * 0.5
    elif st == 'long':
        tip_front = top - H.h['length']
    else:
        tip_front = chin_z + 0.11 * u
    K = 0.28     # rows over the scalp (to where the hair leaves the head); then it hangs; the average end is at row 0.74

    def mass_path(theta, fr):
        back = (1 - math.cos(theta)) / 2
        phi_leave = math.radians(lerp(92, 108, back)) if st != 'short' else math.radians(lerp(100, 104, back))
        v = vol * (1.3 - 0.25 * back)
        th_r = math.radians(180) + (theta - math.radians(180)) * 0.2
        if fr <= K:
            f = fr / K
            ph = lerp(math.radians(12), phi_leave, f)
            tt = lerp(th_r, theta, smoothstep(0.0, 1.0, f))
            return H.shell.point(ph, tt, v * (0.15 + 0.85 * smoothstep(0.0, 0.5, f)))
        leave = H.shell.point(phi_leave, theta, v)
        radial = Vector((leave.x - H.centre.x, leave.y - H.centre.y, 0)).normalized()
        tz = lerp(tip_front, tip_front - 0.012 * u, back) if st != 'long' else tip_front + 0.03 * u * (1 - back)
        drop = max(0.004, leave.z - tz)
        g = (fr - K) / (0.74 - K)
        z = leave.z - drop * g
        if st == 'bob':
            fl = 0.03 * u * math.sin(min(1.0, g * 1.3) * math.pi * 0.5) - 0.03 * u * smoothstep(0.6, 1.5, g)
        elif st == 'long':
            fl = 0.012 * u * math.sin(min(1.0, g * 1.3) * math.pi * 0.5)
        else:
            fl = 0.006 * u
        q = Vector((leave.x, leave.y, z)) + radial * fl
        return H.push_out(q, 0.004 * u)

    mass_w = None
    if st == 'long':
        fns = {k: long_weights(H, k) for k in 'LCR'}

        def mass_w(p, fu, fr):
            theta = math.degrees(lerp(th0, th1, fu))
            a = np.clip((theta - 110) / 70, 0, 1)         # 110 -> L, 180 -> C, 250 -> R
            b = np.clip((theta - 180) / 70, 0, 1)
            al = {'L': 1 - a, 'C': a * (1 - b) + 0.0, 'R': b}
            if theta > 180:
                al = {'L': 0.0, 'C': 1 - b, 'R': b}
            out = {}
            for k, wk in al.items():
                if wk <= 0:
                    continue
                for bone, x in fns[k](p, fr).items():
                    out[bone] = out.get(bone, 0.0) + wk * x
            s = sum(out.values()) or 1.0
            return {b_: x / s for b_, x in out.items()}

    _grid(H, 'hair-mass', 60, 30, lambda fu, fr: mass_path(lerp(th0, th1, fu), fr), 'hp_mass', weights=mass_w)

    # --- the fringe ----------------------------------------------------------------------------------------------
    brow_z = chin_z + 0.128 * u
    z_end = brow_z - 0.03 * u - H.spec.get('fringe_drop', 0.0)
    ph_end = math.radians(80)
    for deg in range(20, 135):
        if H.shell.point(math.radians(deg), 0.0).z <= z_end:
            ph_end = math.radians(deg)
            break
    t68 = math.radians(68)

    def fringe_pos(fu, fr):
        th = lerp(-t68, t68, fu)
        ph = lerp(math.radians(12), ph_end, fr)
        out = vol * 0.55 * (1 - fr) ** 1.5 + 0.009 * u
        return H.shell.point(ph, th, out)

    _grid(H, 'hair-fringe', 34, 22, fringe_pos, 'hp_fringe')

    # --- the face-framing locks (spring chains) ------------------------------------------------------------------
    tip_z = tip_front + 0.0 * u if st != 'long' else top - min(H.h['length'], 0.42) + 0.02
    for side, sx in (('L', 1), ('R', -1)):
        theta = math.radians(sx * 50)
        pts = [H.shell.point(math.radians(20), theta * 0.4, vol * 0.2), H.shell.point(math.radians(55), theta * 0.85, vol), H.shell.point(math.radians(85), theta, vol * 0.9)]
        leave = pts[-1]
        drop = leave.z - tip_z
        for k in range(1, 4):
            q = Vector((leave.x + sx * 0.004 * u * k / 3, leave.y - 0.004 * u * k / 3, leave.z - drop * k / 3))
            pts.append(H.push_out(q, 0.008 * u))
        names, ts = H.chain(f'Hair_Side{side}', pts, [0.55, 0.8], stiffness=0.3, drag=0.2, gravity=0.35, radius=0.012, limit=0.7)
        wf = chain_weights(names, ts, start=0.4)
        nrow = 20
        hw = 0.021 * u
        cols = []
        for j in range(nrow + 1):
            t = j / nrow
            p = catmull(pts, t)
            T = catmull_tangent(pts, t)
            out = Vector((p.x - H.centre.x, p.y - H.centre.y, 0))
            N = out - T * out.dot(T)
            N = N.normalized() if N.length > 1e-6 else Vector((0, -1, 0))
            B = T.cross(N).normalized()
            cols.append((p, B, min(1.0, j / nrow)))
        verts, uvs, wts, faces = [], [], [], []
        for j, (p, B, tp) in enumerate(cols):
            for s_, uu in ((-1, 0.0), (1, 1.0)):
                verts.append(p + B * hw * s_)
                uvs.append(H.atlas.uv('hp_side', uu, 1 - j / nrow, inset=1.0))
                wts.append(wf(p, tp))
        for j in range(nrow):
            a = j * 2
            faces.append((a, a + 1, a + 3, a + 2))
        faces = _flip_outward(H, verts, faces)
        n0 = len(verts)
        for p, uv_, w_ in list(zip(verts, uvs, wts)):
            verts.append(p - (p - H.centre).normalized() * 0.0025 * u)
            uvs.append(uv_)
            wts.append(w_)
        faces = faces + [tuple(i + n0 for i in f[::-1]) for f in faces]
        ob = new_object(f'hair-side{side}', verts, faces)
        shade_smooth(ob)
        uvl = ob.data.uv_layers.new(name='UVMap')
        for poly in ob.data.polygons:
            for li in poly.loop_indices:
                uvl.data[li].uv = uvs[ob.data.loops[li].vertex_index]
        for k, w in enumerate(wts):
            for b_, x in w.items():
                g = ob.vertex_groups.get(b_) or ob.vertex_groups.new(name=b_)
                g.add([k], x, 'REPLACE')
        H.parts.append(Part(ob, 'hair', toon=SHEET_TOON, bones='groups'))
