"""Shared helpers of the character pipeline: axes, colours, mesh building, the parts registry.

Blender is Z-up with the character facing -Y; glTF (and Aether) is Y-up with the character facing +Z. A point converts
as (x, y, z)_blender -> (x, z, -y)_gltf, a rotation or matrix by conjugation with that basis change.
"""
import math
import re

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

# Blender -> glTF basis change (3x3) and its inverse.
B2G = Matrix(((1, 0, 0), (0, 0, 1), (0, -1, 0)))
G2B = B2G.transposed()


def g2b_point(p):
    return Vector((p[0], -p[2], p[1]))


def b2g_point(p):
    return [p[0], p[2], -p[1]]


def g2b_matrix(m4):
    """A glTF world matrix (4x4) as the Blender matrix of the same frame."""
    r = G2B @ m4.to_3x3() @ B2G
    t = g2b_point(m4.translation)
    out = r.to_4x4()
    out.translation = t
    return out


# ---------------------------------------------------------------------------------------------------------------------
# Colours.

NAMED = {
    'white': '#f2eeee', 'off-white': '#e9e0e3', 'cream': '#efe3cc', 'ivory': '#f1ead8', 'black': '#26242a',
    'charcoal': '#383430', 'grey': '#8a8a90', 'gray': '#8a8a90', 'light grey': '#c4c4c8', 'dark grey': '#4a4a50',
    'navy': '#3d425a', 'blue': '#3f6cb0', 'sky blue': '#92a8cc', 'light blue': '#a8c4e0', 'denim': '#4a6286',
    'teal': '#396773', 'deep teal': '#396773', 'green': '#4d7a4a', 'olive': '#6b6b3a', 'mint': '#bfe3d0',
    'pale mint': '#c9eadb', 'red': '#b8383a', 'maroon': '#6a2a30', 'pink': '#e8a8b8', 'orange': '#d8783a',
    'yellow': '#e8c84a', 'mustard': '#c49a32', 'beige': '#d9c6a5', 'light beige': '#e3d3b6', 'khaki': '#b5a47a',
    'tan': '#c09a6a', 'brown': '#6c4b42', 'dark brown': '#4a3228', 'chestnut': '#644946', 'auburn': '#7a3e2e',
    'blonde': '#d9b878', 'silver': '#c8c8cc', 'gold': '#c9a24a', 'rust': '#9a4a2a', 'oilskin yellow': '#d9a92e',
    'fair': '#f6c8ac', 'light': '#f6c8ac', 'medium': '#d9a07a', 'tan skin': '#c98e64', 'weathered': '#c98e6a',
    'dark': '#8a5a3c', 'deep': '#6a4430', 'grey-brown': '#5a4c48', 'dark grey-brown': '#4a3e3a',
}


def colour(text, default='#808080'):
    """A brief's colour word or hex as linear RGB (tuple of 3 floats)."""
    s = (text or '').strip().lower()
    m = re.search(r'#([0-9a-f]{6})', s)
    if not m:
        best = None
        for k in sorted(NAMED, key=len, reverse=True):
            if k in s:
                best = NAMED[k]
                break
        h = best or default
    else:
        h = '#' + m.group(1)
    return srgb_hex(h)


def srgb_hex(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(srgb_to_linear(v) for v in c)


def srgb_to_linear(v):
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


def linear_to_srgb(v):
    v = max(0.0, min(1.0, v))
    return v * 12.92 if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055


def hex_of(lin):
    return '#' + ''.join('%02x' % round(linear_to_srgb(c) * 255) for c in lin[:3])


def lab(rgb_srgb01):
    """CIE Lab of an sRGB colour in 0..1 (D65)."""
    c = np.array([srgb_to_linear(float(v)) for v in rgb_srgb01])
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = m @ c / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.array([116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])])


def delta_e(a_srgb, b_srgb):
    return float(np.linalg.norm(lab(a_srgb) - lab(b_srgb)))


# ---------------------------------------------------------------------------------------------------------------------
# Mesh building.

def new_object(name, verts, faces, collection=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.update()
    ob = bpy.data.objects.new(name, me)
    (collection or bpy.context.scene.collection).objects.link(ob)
    return ob


def activate(ob):
    for o in bpy.context.selected_objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)


def apply_modifiers(ob):
    activate(ob)
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def subdivide(ob, levels=1):
    m = ob.modifiers.new('sub', 'SUBSURF')
    m.levels = levels
    m.render_levels = levels
    m.quality = 3
    apply_modifiers(ob)


def shade_smooth(ob):
    for p in ob.data.polygons:
        p.use_smooth = True


def loft(sections, closed=True, cap_start=False, cap_end=False):
    """Quads between rings of equal size (lists of Vectors). Returns verts, faces."""
    n = len(sections[0])
    verts = [v for ring in sections for v in ring]
    faces = []
    m = n if closed else n - 1
    for i in range(len(sections) - 1):
        for j in range(m):
            a = i * n + j
            b = i * n + (j + 1) % n
            faces.append((a, b, b + n, a + n))
    if cap_start and closed:
        c = len(verts)
        verts.append(sum(sections[0], Vector()) / n)
        for j in range(n):
            faces.append((c, (j + 1) % n, j))
    if cap_end and closed:
        c = len(verts)
        base = (len(sections) - 1) * n
        verts.append(sum(sections[-1], Vector()) / n)
        for j in range(n):
            faces.append((c, base + j, base + (j + 1) % n))
    return verts, faces


def frame_of(tangent, up_hint):
    t = tangent.normalized()
    u = (up_hint - t * up_hint.dot(t))
    if u.length < 1e-6:
        u = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
        u = u - t * u.dot(t)
    u.normalize()
    b = t.cross(u)
    return t, u, b


def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def catmull(points, t):
    """A point on a Catmull-Rom spline through `points` (Vectors) at t in 0..1."""
    n = len(points) - 1
    f = max(0.0, min(0.99999, t)) * n
    i = int(f)
    u = f - i
    p0 = points[max(0, i - 1)]
    p1 = points[i]
    p2 = points[min(n, i + 1)]
    p3 = points[min(n, i + 2)]
    return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u)


def catmull_tangent(points, t):
    e = 1e-3
    return (catmull(points, min(1, t + e)) - catmull(points, max(0, t - e))).normalized()


# ---------------------------------------------------------------------------------------------------------------------
# Parts: every mesh piece registers its role (for weights, the atlas, toon values and QA).

class Part:
    """A mesh piece of the character before the join."""

    def __init__(self, ob, kind, swatch=None, toon=(1.0, 0.0, 1.0, 0.0), bones=None, cloth=False, layer=0, role=None):
        self.ob = ob
        self.kind = kind          # 'skin', 'head', 'hair', 'cloth', 'decal', 'eye', 'acc'
        self.swatch = swatch      # atlas swatch name for flat UVs (None: the part has its own UVs)
        self.toon = toon          # outline width, shade bias, rim, spare
        self.bones = bones        # fixed weights: {bone: weight} or None (transferred / automatic)
        self.cloth = cloth        # checked against the body for interpenetration
        self.layer = layer        # clothing layer (0 inner)
        self.role = role or kind  # colour role (palette check)


def mean(vs):
    s = Vector()
    for v in vs:
        s += v
    return s / max(1, len(vs))


def bm_from(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    return bm


def triangles(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def rad(d):
    return d * math.pi / 180
