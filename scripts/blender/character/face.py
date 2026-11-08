"""The head and the face.

The head is a quad sphere projected onto a smooth union of anatomical forms (cranium, the face's cone down to a soft
chin, cheeks), subdivided and projected again, with a nose bridge and tip pushed out of the surface. For the anime style
its front takes normals from an ellipsoid proxy (Data Transfer), so the cel shadow across the face is one clean curve.

The face's features are decals laid on the surface (grids cast onto the head, a fraction of a millimetre out) with
their own cells of the atlas: eyes, brows, mouths, nose, blush, tears, marks. Expressions are morph targets moving the
decals: a feature that only shows in an expression (a smile's open mouth, the closed eye of a blink) is collapsed to a
point at rest and opens in its morph.
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from common import Part, activate, apply_modifiers, new_object, shade_smooth, smoothstep

HEAD_BIAS = {}   # head object name -> per-vertex shade bias (face_bias)
HEAD_RIM = {}    # head object name -> per-vertex rim strength

EXPRESSIONS = ['smile', 'sad', 'surprised', 'teary', 'blink', 'mouth_open', 'determined']


class HeadForm:
    """Signed distance of the head (Blender axes, metres), origin at the chin point."""

    def __init__(self, spec, origin):
        u = spec['head_h'] / 0.237
        self.u = u
        self.o = np.array(origin)
        male = spec['gender'] == 'male'
        anime = spec['style'] == 'anime'
        old = spec['old']
        self.cran_c = np.array([0, 0.02, 0.128]) * u
        self.cran_r = np.array([0.078 + 0.004 * male, 0.097, 0.095]) * u
        jaw_w = 0.06 + 0.008 * male + 0.004 * old
        self.jaw_a = np.array([0, -0.012, 0.086]) * u
        self.jaw_b = np.array([0, -0.05 - 0.004 * male, 0.019 + 0.004 * male + (0.008 if anime and not male else 0)]) * u
        self.jaw_ra = jaw_w * u
        # the chin: soft and round for an anime girl, squarer for men
        # (an anime girl's chin is a short, round curve under the mouth, not a point: a wider end of the jaw's cone)
        self.jaw_rb = (0.018 + 0.012 * male + (0.011 if anime and not male else 0)) * u
        self.cheek_c = np.array([0.037 + 0.004 * male, -0.036, 0.07]) * u
        self.cheek_r = 0.026 * u
        self.k = 0.03 * u
        self.chin_c = np.array([0, -0.04, 0.03]) * u
        self.brow_c = np.array([0, -0.018, 0.148]) * u
        self.brow_r = np.array([0.07, 0.062, 0.07]) * u

    def sdf(self, P):
        p = P - self.o
        e = (p - self.cran_c) / self.cran_r
        k_e = np.linalg.norm(e, axis=1)
        d_cran = (k_e - 1) * np.min(self.cran_r) * 1.0
        # round cone A -> B, with the depth scaled (the face is narrower front to back than across)
        q = p.copy()
        q[:, 1] = q[:, 1] / 1.1
        a = self.jaw_a.copy()
        a[1] /= 1.1
        b = self.jaw_b.copy()
        b[1] /= 1.1
        ba = b - a
        L = np.linalg.norm(ba)
        t = np.clip(((q - a) @ ba) / (L * L), 0, 1)
        r = self.jaw_ra + (self.jaw_rb - self.jaw_ra) * t
        d_jaw = np.linalg.norm(q - (a + np.outer(t, ba)), axis=1) - r
        px = p.copy()
        px[:, 0] = np.abs(px[:, 0])
        d_cheek = np.linalg.norm(px - self.cheek_c, axis=1) - self.cheek_r
        eb = np.linalg.norm((p - self.brow_c) / self.brow_r, axis=1)
        d_brow = (eb - 1) * np.min(self.brow_r)
        d = smin(d_cran, d_jaw, self.k)
        d = smin(d, d_brow, self.k)
        d = smin(d, d_cheek, self.k * 1.2)
        return d


def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b + (a - b) * h - k * h * (1 - h)


def project(form, P, iters=6):
    for _ in range(iters):
        d = form.sdf(P)
        e = 1e-4
        g = np.stack([(form.sdf(P + np.array([e, 0, 0])) - d) / e, (form.sdf(P + np.array([0, e, 0])) - d) / e, (form.sdf(P + np.array([0, 0, e])) - d) / e], 1)
        g /= np.linalg.norm(g, axis=1, keepdims=True) + 1e-12
        P = P - g * d[:, None]
    return P


def quad_sphere(name, cuts):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=2)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
    for v in bm.verts:
        v.co = v.co.normalized()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def build_head(J, spec):
    hh = spec['head_h']
    hd = J['Bip01_Head']
    chin = Vector((0, hd.y - 0.004 * hh / 0.237, hd.z - 0.16 * hh))
    form = HeadForm(spec, chin)
    u = form.u
    ob = quad_sphere('head', 12)
    centre = np.array(chin) + np.array([0, 0.0, 0.11]) * u
    co = np.array([v.co[:] for v in ob.data.vertices])
    # ray-march each direction from the centre to the surface
    dirs = co / np.linalg.norm(co, axis=1, keepdims=True)
    ts = np.linspace(0.0, 0.3 * u, 301)
    best = np.zeros(len(dirs))
    prev = form.sdf(centre + dirs * ts[0])
    for t0, t1 in zip(ts[:-1], ts[1:]):
        cur = form.sdf(centre + dirs * t1)
        hit = (prev < 0) & (cur >= 0) & (best == 0)
        best[hit] = t0 + (t1 - t0) * (-prev[hit] / (cur[hit] - prev[hit] + 1e-12))
        prev = cur
    best[best == 0] = 0.1 * u
    co = centre + dirs * best[:, None]
    for v, c in zip(ob.data.vertices, co):
        v.co = c
    m = ob.modifiers.new('sub', 'SUBSURF')
    m.levels = 1
    apply_modifiers(ob)
    co = np.array([v.co[:] for v in ob.data.vertices])
    co = project(form, co)
    co = face_template(co, chin, u, spec.get('face_fit') or {})
    # nose: a soft bridge and a small tip, pushed out along the surface normal
    nose_z = chin.z + 0.07 * u
    for v, c in zip(ob.data.vertices, co):
        v.co = c
    ob.data.update()
    nrm = np.array([v.normal[:] for v in ob.data.vertices])
    p = co - np.array(chin)
    front = -nrm[:, 1]
    tip = np.exp(-((p[:, 0] / (0.007 * u)) ** 2 + ((p[:, 2] - 0.072 * u) / (0.008 * u)) ** 2))
    bridge = np.exp(-(p[:, 0] / (0.0055 * u)) ** 2) * np.clip((p[:, 2] - 0.072 * u) / (0.03 * u), 0, 1) * np.clip((0.112 * u - p[:, 2]) / (0.012 * u), 0, 1)
    lip = np.exp(-((p[:, 0] / (0.012 * u)) ** 2 + ((p[:, 2] - 0.05 * u) / (0.004 * u)) ** 2))
    old = spec['old']
    push = (0.0035 + 0.004 * (spec['gender'] == 'male') + (0.004 if spec['style'] != 'anime' else 0)) * u * tip + 0.0012 * u * bridge + 0.0006 * u * lip
    push = push * np.clip(front * 2, 0, 1)
    co = co + nrm * push[:, None]
    for v, c in zip(ob.data.vertices, co):
        v.co = c
    ob.data.update()
    shade_smooth(ob)
    if spec['style'] == 'anime':
        face_normals(ob, chin, u, keep=True)
    HEAD_BIAS[ob.name] = face_bias(ob, chin, u, spec)
    ears = build_ears(form, chin, u, spec)
    return ob, ears, form, chin


FACE_KEYS = {
    # the face template's shape keys: each widens (value > 1) or narrows the face across x in a band of heights over
    # the chin (in head units), fading out toward the back of the head; the build fits their values to the sheet
    'jaw': (0.01, 0.085, 0.045),     # from just over the chin to the jaw's corner (broad and soft)
    'chin': (-0.01, 0.03, 0.025),    # the chin's point
    'cheek': (0.055, 0.1, 0.03),     # the cheeks under the eyes
}


def face_template(co, chin, u, fit):
    """The head with its template keys mixed in (fit: {key: width factor})."""
    if not fit:
        return co
    p = co - np.array(chin)
    front = np.clip((-p[:, 1] + 0.02 * u) / (0.05 * u), 0, 1)
    out = co.copy()
    for k, (z0, z1, soft) in FACE_KEYS.items():
        f = float(fit.get(k, 1.0))
        if abs(f - 1) < 1e-4:
            continue
        zz = p[:, 2] / u
        w = np.clip((zz - (z0 - soft)) / soft, 0, 1) * np.clip(((z1 + soft) - zz) / soft, 0, 1)
        w = w * w * (3 - 2 * w) * front
        out[:, 0] += p[:, 0] * (f - 1) * w
    return out


def nss(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def face_bias(ob, chin, u, spec):
    """Per-vertex shade bias of the head (the toon shader adds it to N.L).

    Anime faces are lit as one shape: the face sits in the lit band unless the light comes from well behind its side
    (bias +0.55 over the face, fading to the head's 0.1 at the jaw, temples and hairline); a soft band under the bangs
    and the underside of the jaw take a negative bias, so they fall into shadow first (the bangs' and the chin's cast
    shadows). Realistic heads keep a flat bias."""
    co = np.array([v.co[:] for v in ob.data.vertices])
    nrm = np.array([v.normal[:] for v in ob.data.vertices])
    p = co - np.array(chin)
    if spec['style'] != 'anime':
        return np.full(len(co), 0.05)
    front = nss(-0.15, 0.5, -nrm[:, 1])
    zone = front * nss(0.004 * u, 0.03 * u, p[:, 2]) * (1 - nss(0.16 * u, 0.2 * u, p[:, 2]))
    zone *= 1 - nss(0.062 * u, 0.08 * u, np.abs(p[:, 0]))
    bias = 0.1 + 0.45 * zone
    # under the bangs: the forehead above the brows, its lower edge in points like the bangs' tips
    ez = eye_z(spec)
    lo = (ez + 0.024) * u + 0.004 * u * np.abs(np.sin(p[:, 0] / (0.018 * u) * math.pi))
    bang = nss(lo, lo + 0.008 * u, p[:, 2]) * front
    bias = bias - 0.72 * bang
    # under the jaw
    jaw = nss(0.15, 0.6, -nrm[:, 2]) * (1 - nss(0.02 * u, 0.05 * u, p[:, 2]))
    bias = bias * (1 - jaw) - 0.35 * jaw
    # no warm rim over the face (it would draw a second shape along the cheek); the head's sides keep it
    HEAD_RIM[ob.name] = 1 - zone
    return bias


def face_normals(ob, chin, u, keep=False):
    """Normals of the face's front from an ellipsoid (a clean cel shadow), fading out at the jaw and temples."""
    proxy = bpy.data.objects.new('face-proxy', bpy.data.meshes.new('face-proxy'))
    bpy.context.scene.collection.objects.link(proxy)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=32, radius=1)
    bm.to_mesh(proxy.data)
    bm.free()
    proxy.scale = (0.078 * u, 0.1 * u, 0.115 * u)
    proxy.location = Vector(chin) + Vector((0, 0.03 * u, 0.1 * u))
    for p in proxy.data.polygons:
        p.use_smooth = True
    g = ob.vertex_groups.new(name='face_front')
    for v in ob.data.vertices:
        p = v.co - Vector(chin)
        w = smoothstep(0.0, 0.5, -v.normal.y) * smoothstep(0.01 * u, 0.04 * u, p.z) * (1 - smoothstep(0.15 * u, 0.18 * u, p.z))
        w *= 1 - smoothstep(0.05 * u, 0.068 * u, abs(p.x))
        if w > 0.001:
            g.add([v.index], w, 'REPLACE')
    m = ob.modifiers.new('normals', 'DATA_TRANSFER')
    m.object = proxy
    m.use_loop_data = True
    m.data_types_loops = {'CUSTOM_NORMAL'}
    m.loop_mapping = 'POLYINTERP_NEAREST'
    m.vertex_group = 'face_front'
    m.mix_mode = 'REPLACE'
    m.mix_factor = 1.0
    apply_modifiers(ob)
    if not keep:
        bpy.data.objects.remove(proxy)


def build_ears(form, chin, u, spec):
    bm = bmesh.new()
    obs = []
    for side in (1, -1):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=1)
        for v in bm.verts:
            x, y, z = v.co
            # a cupped shell: flat, its front edge curling in
            v.co = Vector((x * 0.006 * u + 0.004 * u * (1 - z * z) * (y < 0), y * 0.016 * u, z * 0.024 * u))
        me = bpy.data.meshes.new('ear')
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new('ear', me)
        bpy.context.scene.collection.objects.link(ob)
        ob.location = Vector(chin) + Vector((side * (form.cran_r[0] - 0.006 * u), 0.012 * u, 0.098 * u))
        ob.rotation_euler = (math.radians(-12), 0, math.radians(side * -14))
        apply_transform(ob)
        shade_smooth(ob)
        obs.append(ob)
    return obs


def apply_transform(ob):
    activate(ob)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


# ---------------------------------------------------------------------------------------------------------------------
# Decals.

def eye_z(spec):
    """Height of the eyes' centre above the chin (head units): anime girls' eyes sit a little lower, under a taller forehead."""
    if spec['old'] > 0.3:
        return 0.104
    return 0.094 if spec['style'] == 'anime' and spec['gender'] != 'male' else 0.098


def decal_layout(spec):
    """Feature decals: name, atlas cell, centre (x, z from the chin, head units), size (w, h), offset (m), rest visible."""
    old = spec['old']
    male = spec['gender'] == 'male'
    ex = 0.035 + 0.002 * male
    ez = eye_z(spec)
    ew = (0.048 if not male else 0.035) if spec['style'] == 'anime' else 0.026
    if old > 0.3:
        ew *= 0.9
    ew *= spec.get('eye_scale', 1.0)
    out = []
    for side, sx in (('L', 1), ('R', -1)):
        out += [
            (f'eye_{side}', 'eye', (sx * ex, ez), (ew, ew), 0.0005, True, sx),
            (f'eyec_{side}', 'eye_closed', (sx * ex, ez - 0.004), (ew * 1.02, ew * 0.5), 0.0008, False, sx),
            (f'brow_{side}', 'brow', (sx * (ex + 0.002), ez + 0.027 + 0.002 * male), (ew * 0.95, ew * 0.26 * (1.4 if old > 0.3 else 1)), 0.0005, True, sx),
            (f'blush_{side}', 'blush', (sx * (ex + 0.012), ez - 0.024), (0.026, 0.013), 0.0004, False, sx),
            (f'tear_{side}', 'tear', (sx * ex, ez - 0.013), (ew * 0.9, ew * 0.42), 0.0011, False, sx),
        ]
    out += [
        ('nose', 'nose', (0, 0.069), (0.011, 0.011), 0.0004, True, 1),
        ('mouth', 'mouth', (0, 0.041), (0.034, 0.0255), 0.0005, True, 1),
        ('mouth_smile', 'mouth_smile', (0, 0.039), (0.04, 0.03), 0.0007, False, 1),
        ('mouth_sad', 'mouth_sad', (0, 0.04), (0.034, 0.0255), 0.0007, False, 1),
        ('mouth_o', 'mouth_o', (0, 0.039), (0.034, 0.0255), 0.0007, False, 1),
        ('mouth_open', 'mouth_open', (0, 0.039), (0.036, 0.027), 0.0007, False, 1),
        ('mouth_set', 'mouth_set', (0, 0.041), (0.034, 0.0255), 0.0007, False, 1),
    ]
    if spec.get('beauty_mark'):
        out.append(('mark', 'mark', (ex + 0.013, ez - 0.022), (0.0045, 0.0045), 0.0004, True, 1))
    if old > 0.3:
        out.append(('wrinkle', 'wrinkle', (0, 0.168), (0.05, 0.022), 0.0004, True, 1))
    return out


def build_decals(head, chin, u, atlas, spec):
    """The feature decals as one object per feature, with UVs and their expression shape keys."""
    bvh = BVHTree.FromObject(head, bpy.context.evaluated_depsgraph_get())
    parts = []
    for name, cell, (cx, cz), (w, h), off, visible, sx in decal_layout(spec):
        nx, nz = 6, 6
        if cell == 'eye':
            nx, nz = 8, 8
        verts, uvs, faces = [], [], []
        for j in range(nz + 1):
            for i in range(nx + 1):
                a, b = i / nx, j / nz
                x = chin.x + (cx + (a - 0.5) * w) * u
                z = chin.z + (cz + (b - 0.5) * h) * u
                hit = bvh.ray_cast(Vector((x, chin.y - 0.4, z)), Vector((0, 1, 0)))
                if hit[0] is None:
                    p = Vector((x, chin.y - 0.06 * u, z))
                    n = Vector((0, -1, 0))
                else:
                    p, n = hit[0], hit[1]
                verts.append(p + n * off)
                uu = a if sx > 0 else 1 - a
                uvs.append(atlas.uv(cell, uu, b))
        for j in range(nz):
            for i in range(nx):
                k = j * (nx + 1) + i
                faces.append((k, k + 1, k + nx + 2, k + nx + 1))
        ob = new_object(f'decal-{name}', verts, faces)
        shade_smooth(ob)
        uvl = ob.data.uv_layers.new(name='UVMap')
        for poly in ob.data.polygons:
            for li in poly.loop_indices:
                uvl.data[li].uv = uvs[ob.data.loops[li].vertex_index]
        # the head's own (final) normals under each decal, so a decal's skin margin shades exactly like the skin
        m = ob.modifiers.new('n', 'DATA_TRANSFER')
        m.object = head
        m.use_loop_data = True
        m.data_types_loops = {'CUSTOM_NORMAL'}
        m.loop_mapping = 'POLYINTERP_NEAREST'
        apply_modifiers(ob)
        layout = [v.co.copy() for v in ob.data.vertices]
        grid = [(i / nx, j / nz) for j in range(nz + 1) for i in range(nx + 1)]
        keys = expression_keys(name, layout, grid, w * u, h * u, sx, u)
        centre = layout[len(layout) // 2]
        rest = layout if visible else [centre.copy() for _ in layout]
        for v, c in zip(ob.data.vertices, rest):
            v.co = c
        ob.shape_key_add(name='Basis')
        for ex in EXPRESSIONS:
            k = ob.shape_key_add(name=ex)
            target = keys.get(ex)
            if target is None:
                target = rest
            for i, c in enumerate(target):
                k.data[i].co = c
        part = Part(ob, 'decal', toon=(0.0, 0.1, 0.0, 0.0), bones={'Bip01_Head': 1.0})
        # and the head's shade bias at the same place (rim off, no outline: the decal sits flush in the face)
        bias = head_bias_at(head, layout)
        rim = head_bias_at(head, layout, HEAD_RIM)
        part.toon_v = np.stack([np.zeros(len(layout)), bias, rim, np.zeros(len(layout))], 1)
        parts.append(part)
    proxy = bpy.data.objects.get('face-proxy')
    if proxy:
        bpy.data.objects.remove(proxy)
    return parts


def head_bias_at(head, pts, table=None):
    """The head's per-vertex shade bias (or another per-vertex table) interpolated at points near its surface
    (inverse distance, 4 nearest)."""
    from mathutils import kdtree
    bias = (HEAD_BIAS if table is None else table).get(head.name)
    if bias is None:
        return np.full(len(pts), 0.1 if table is None else 0.0)
    kd = kdtree.KDTree(len(head.data.vertices))
    for v in head.data.vertices:
        kd.insert(v.co, v.index)
    kd.balance()
    out = []
    for p in pts:
        hits = kd.find_n(p, 4)
        w = np.array([1.0 / (1e-5 + d) for _, _, d in hits])
        out.append(float((w * np.array([bias[i] for _, i, _ in hits])).sum() / w.sum()))
    return np.array(out)


def expression_keys(name, layout, grid, w, h, sx, u):
    """Target positions per expression for one decal (missing: the rest position)."""
    c = layout[len(layout) // 2]
    up = Vector((0, 0, 1))
    mm = 0.001 * u

    def collapse():
        return [c.copy() for _ in layout]

    def moved(f):
        return [p + f(p, g) for p, g in zip(layout, grid)]

    out = {}
    kind = name.split('_')[0]
    if kind == 'eye':
        top = layout[-1].z
        bot = layout[0].z
        lash = c + up * (h * 0.28)
        out['blink'] = [Vector((p.x, p.y, lash.z)) for p in layout]
        out['smile'] = moved(lambda p, g: up * ((1 - g[1]) * h * 0.18))
        out['surprised'] = [c + (p - c) * 1.1 for p in layout]
        out['determined'] = moved(lambda p, g: -up * (g[1] * h * 0.14) + up * ((1 - g[1]) * h * 0.04))
        out['teary'] = moved(lambda p, g: -up * (g[1] * h * 0.04))
        out['sad'] = moved(lambda p, g: -up * (g[1] * h * 0.06 * (0.3 + 0.7 * (g[0] if sx > 0 else 1 - g[0]))))
    elif kind == 'eyec':
        out['blink'] = list(layout)
    elif kind == 'brow':
        # inner end (toward the nose) is g0 = 0 on the left (sx > 0) brow
        inner = lambda g: (1 - g[0]) if sx > 0 else g[0]
        out['smile'] = moved(lambda p, g: up * 1.2 * mm)
        out['surprised'] = moved(lambda p, g: up * (4.0 * mm + 0.8 * mm * inner(g)))
        out['sad'] = moved(lambda p, g: up * (3.0 * mm * inner(g) - 0.8 * mm))
        out['teary'] = moved(lambda p, g: up * (2.0 * mm * inner(g)))
        out['determined'] = moved(lambda p, g: -up * (2.6 * mm * inner(g) - 0.4 * mm))
    elif kind == 'blush':
        out['smile'] = list(layout)
        out['teary'] = list(layout)
    elif kind == 'tear':
        out['teary'] = list(layout)
    elif name == 'mouth':
        for ex in ('smile', 'sad', 'surprised', 'mouth_open', 'determined'):
            out[ex] = collapse()
    elif name == 'mouth_smile':
        out['smile'] = list(layout)
    elif name == 'mouth_sad':
        out['sad'] = list(layout)
    elif name == 'mouth_o':
        out['surprised'] = list(layout)
    elif name == 'mouth_open':
        out['mouth_open'] = list(layout)
    elif name == 'mouth_set':
        out['determined'] = list(layout)
    return out
