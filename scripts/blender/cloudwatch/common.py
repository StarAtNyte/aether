"""Shared helpers of the Cloudwatch Harbour build: palette, toon materials, mesh helpers, the terrain profile.

Every object the build places carries custom properties the later steps read:
  cw_piece   which exported glb piece it belongs to (terrain, town, harbour, props, people, sky, ...)
  cw_prop    1 for a placed prop the floating/interpenetration gate checks
  cw_outline 1 to get an inverted-hull outline
"""
import math
import random

import bmesh
import bpy
from mathutils import Vector

# ---------------------------------------------------------------------------------------------------------------- palette


def srgb(hexstr):
    """'#rrggbb' to a linear RGBA tuple (Blender colours are linear)."""
    h = hexstr.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (out[0], out[1], out[2], 1.0)


P = {
    "zenith": "#2c3f86", "upper": "#5d6fc4", "horizon": "#f6b27a", "horizon_sun": "#ffd9a0", "sun": "#fff3d6",
    "cloud_lit": "#ffe3c4", "cloud_lit2": "#ffc39a", "cloud_shadow": "#8e7fc0", "cloud_deep": "#6c6aa8", "cloud_base": "#e79aa6",
    "sea_near": "#1f4f7a", "sea_far": "#6f86c0", "glitter": "#ffe7b8",
    "wall": "#f1e2c8", "wall2": "#e8d6bd", "wall3": "#d9dccf", "wall4": "#efcfb8", "wood": "#8a5a3c", "wood_dark": "#5a3a2c",
    "roof_slate": "#3d4b6b", "roof_brick": "#7a3f36", "roof_teal": "#2f5d5a", "roof_grey": "#55566a",
    "leaf_lit": "#a8c25a", "leaf_mid": "#4f8a4a", "leaf_shadow": "#2b4d5a", "grass": "#7aa04e", "grass2": "#8fb05a",
    "stone": "#c9bfae", "stone2": "#b5ab9c", "asphalt": "#6d6a78", "concrete": "#b9b4ab", "gravel": "#8e8478",
    "gate": "#d8452f", "gate_cap": "#2a2730", "lantern": "#ffb25c", "signal": "#ff4a3a", "vending": "#d6f0ff", "window_lit": "#ffcf7a",
    "line": "#2a2235", "rail": "#5b5560", "sleeper": "#6b5240", "pole": "#8f8a85", "wire": "#2f2a35",
    "boat_white": "#eeeae0", "boat_blue": "#3a6ea5", "boat_red": "#c84a3c", "lighthouse": "#d64a3a",
    "skin": "#f2c8a8", "hair": "#2f2630", "shirt_white": "#f4f1ea", "skirt_navy": "#2f3d66", "shirt_blue": "#7fa7d6", "shorts": "#55606e",
}

# Physically based light (shared by sky.build_light, the EEVEE toon materials and the bake). The sun lamp and a Nishita
# sky (no disc: the lamp is the sun) light the scene; Cycles carries the bounce. Light is measured in units of LREF, the
# diffuse light of an open, level surface in shade (sky only), so the ramp below reads in exposure stops: 0 = open shade,
# about -1 = a wall in shade, +0.8 = level ground in the low sun, +2.5 = a wall turned to the sun.
LIGHT = {
    "sun_az": 214.0, "sun_el": 6.5, "sun_col": "#ffc48a",
    "sun_ratio": 6.0,      # sun-perpendicular diffuse light / open-shade light (a clear sky at 6.5 degrees: 5-7)
    "sky_up": 4.434,       # irradiance of a level surface under the Nishita sky at strength 1 (measured)
    "ao_dist": 1.1,        # contact occlusion reach, metres
    "ao_floor": 0.32,      # light kept in a fully occluded crease (L x (floor + (1 - floor) x AO))
}

# Toon ramp (shared with the bake) on x = log2(L / LREF) + the terminator break: five bands, each a multiplier of the
# painted albedo. Cool violet shadows in three values (contact, shade, open shade lifted by the sky and the bounce), a
# warm low-sun band and the lit band; the steps are soft by `w` stops, so cast shadows keep crisp painted edges.
RAMP = {
    "bands": ["#55508f", "#7b77bd", "#9d97cf", "#efc6aa", "#ffe8c8"],
    "edges": [-1.75, -0.25, 0.45, 1.75],
    "widths": [0.4, 0.6, 0.10, 0.08],  # soft within the shadow side, crisp at the sun's edges
    "x_range": (-3.0, 3.0),   # the EEVEE colour ramp node's 0..1 input spans these stops
    # Painted gradation inside a band: each band keeps a little of the light's own variation around its centre (the sky
    # side of a shadow wall a touch lighter than its foot, a lit wall warming toward the sun), so bands are not flat fills.
    "centres": [-2.4, -1.1, 0.0, 1.1, 2.5],
    "grad": 0.2,              # stops of brightness per stop of light inside a band (multiplier 2^(grad x dev))
    "grad_max": 1.0,          # deviation clamp, stops
    # The sun's direct light (units of lref) over which a surface steps from shadow into the sunlit bands: level ground
    # in the 6.5 degree sun gets 0.68, a face turned to it 6, so the step sits where the sun grazes a face at ~2 degrees.
    "sun_step": (0.16, 0.26),
    # Off in the shipped bake: choosing the sunlit bands by the sun's own light (bake_export bakes a sun-only pass for it)
    # is written but not yet judged against the stills.
    "sun_mask": False,
}


def lref():
    """Open-shade diffuse light in Cycles' units (a white surface's radiance: irradiance / pi) at the sky's strength."""
    return 1.0


def sky_strength():
    return math.pi * lref() / LIGHT["sky_up"]


def _bands_np(x, idx, edges, widths):
    """Blend of the bands `idx` (with the band edges and widths between them) on stops x, with the in-band gradation."""
    import numpy as np
    r = RAMP
    cols = [np.array(srgb(r["bands"][i])[:3]) for i in idx]
    ctrs = [r["centres"][i] for i in idx]
    out = cols[0] * np.ones_like(x)
    ctr = np.full_like(x, ctrs[0])
    for e, w, c, k in zip(edges, widths, cols[1:], ctrs[1:]):
        t = np.clip((x - (e - w / 2)) / w, 0.0, 1.0)
        out = out * (1 - t) + c * t
        ctr = ctr * (1 - t) + k * t
    return out * np.power(2.0, r["grad"] * np.clip(x - ctr, -r["grad_max"], r["grad_max"]))


def ramp_np(x, sun=None):
    """The toon ramp on stops x (array) -> band multiplier (..., 3), linear RGB. With `sun` (the sun's own direct
    light, the same units as the light, or None) the sunlit bands are chosen by the sun alone: a surface is in the low-sun
    or lit band only where the sun reaches it (sun_mask), and in one of the three shadow bands elsewhere however much
    bounce lifts it. So a cast shadow keeps the sun's exact shape and the bounce in the shade never flips into sunlight."""
    import numpy as np
    r = RAMP
    x = np.asarray(x, np.float32)[..., None]
    e, w = r["edges"], r["widths"]
    if sun is None:
        return _bands_np(x, range(5), e, w)
    shade = _bands_np(x, (0, 1, 2), e[:2], w[:2])
    lit = _bands_np(x, (3, 4), e[3:], w[3:])
    m = sun_mask_np(sun)[..., None]
    return shade * (1 - m) + lit * m


def sun_mask_np(sun):
    """0 in the sun's shadow (or turned from it), 1 in its light: a crisp step on the sun's direct light."""
    import numpy as np
    lo, hi = RAMP["sun_step"]
    return np.clip((np.asarray(sun, np.float32) / lref() - lo) / (hi - lo), 0.0, 1.0)


def stops_np(L, ao=None):
    """Light (array, Cycles units) and contact occlusion (0..1 or None) -> stops for the ramp."""
    import numpy as np
    L = np.asarray(L, np.float32)
    if ao is not None:
        f = LIGHT["ao_floor"]
        L = L * (f + (1 - f) * np.clip(np.asarray(ao, np.float32), 0, 1))
    return np.log2(np.maximum(L, 1e-4) / lref())


def denoise_np(img, tmpdir, albedo=None, normal=None, tile=2048, pad=48):
    """denoise_np in overlapping tiles (`tile` px, `pad` px of overlap kept out of each tile's result), so a 4096 px
    atlas denoises in a quarter of the memory."""
    import numpy as np
    a = np.asarray(img, np.float32)
    h, w = a.shape[:2]
    if h <= tile and w <= tile:
        return _denoise_np(a, tmpdir, albedo, normal)
    out = np.empty_like(a)
    for y0 in range(0, h, tile):
        for x0 in range(0, w, tile):
            ya, yb = max(0, y0 - pad), min(h, y0 + tile + pad)
            xa, xb = max(0, x0 - pad), min(w, x0 + tile + pad)
            sub = _denoise_np(a[ya:yb, xa:xb], tmpdir,
                              None if albedo is None else albedo[ya:yb, xa:xb],
                              None if normal is None else normal[ya:yb, xa:xb])
            out[y0:min(h, y0 + tile), x0:min(w, x0 + tile)] = sub[y0 - ya:y0 - ya + min(tile, h - y0), x0 - xa:x0 - xa + min(tile, w - x0)]
    return out


def _denoise_np(img, tmpdir, albedo=None, normal=None):
    """Open Image Denoise (the compositor's Denoise node) on an (H, W) or (H, W, 3) float array, rows bottom-up: takes
    the path tracer's grain off a baked light map or a render pass before the hard steps of the ramp, which would
    otherwise turn it into speckle along every band edge. Runs in a throwaway scene with no render layer (compositing
    only). `albedo` and `normal` ((H, W, 3) guides) keep the edges where neighbouring atlas islands or surfaces differ.
    """
    import os
    import numpy as np
    a = np.ascontiguousarray(img, np.float32)
    gray = a.ndim == 2
    rgb = np.repeat(a[..., None], 3, -1) if gray else a[..., :3]
    h, w, _ = rgb.shape
    src = bpy.data.images.new("cw_dn_src", w, h, alpha=False, float_buffer=True)
    src.colorspace_settings.name = "Non-Color"
    src.pixels.foreach_set(np.concatenate([rgb, np.ones((h, w, 1), np.float32)], -1).ravel())
    keep = bpy.context.window.scene if bpy.context.window else bpy.context.scene
    sc = bpy.data.scenes.new("cw_denoise")
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = w, h, 100
    sc.view_settings.view_transform = "Standard"
    sc.display_settings.display_device = "sRGB"
    sc.use_nodes = True
    nt = sc.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    im = nt.nodes.new("CompositorNodeImage")
    im.image = src
    dn = nt.nodes.new("CompositorNodeDenoise")
    dn.use_hdr = True
    try:
        dn.prefilter = "ACCURATE"
    except (AttributeError, TypeError):
        pass
    comp = nt.nodes.new("CompositorNodeComposite")
    nt.links.new(im.outputs["Image"], dn.inputs["Image"])
    guides = []
    for gname, g in (("Albedo", albedo), ("Normal", normal)):
        if g is None:
            continue
        gi = bpy.data.images.new(f"cw_dn_{gname}", w, h, alpha=False, float_buffer=True)
        gi.colorspace_settings.name = "Non-Color"
        gi.pixels.foreach_set(np.concatenate([np.asarray(g, np.float32)[..., :3], np.ones((h, w, 1), np.float32)], -1).ravel())
        gn = nt.nodes.new("CompositorNodeImage")
        gn.image = gi
        nt.links.new(gn.outputs["Image"], dn.inputs[gname])
        guides.append(gi)
    nt.links.new(dn.outputs["Image"], comp.inputs["Image"])
    sc.render.image_settings.file_format = "OPEN_EXR"
    sc.render.image_settings.color_depth = "32"
    sc.render.image_settings.color_management = "OVERRIDE"
    sc.render.image_settings.view_settings.view_transform = "Standard"
    os.makedirs(tmpdir, exist_ok=True)
    path = os.path.join(tmpdir, "_denoise.exr")
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True, scene=sc.name)
    out = bpy.data.images.load(path, check_existing=False)
    px = np.empty(w * h * 4, np.float32)
    out.pixels.foreach_get(px)
    bpy.data.images.remove(out)
    bpy.data.images.remove(src)
    for gi in guides:
        bpy.data.images.remove(gi)
    bpy.data.scenes.remove(sc)
    os.remove(path)
    if bpy.context.window:
        bpy.context.window.scene = keep
    px = px.reshape(h, w, 4)[..., :3]
    return px[..., 0] if gray else px


def finish_np(Al, L, ao, aux, sun=None):
    """The toon material's colour from the baked terms: albedo x ramp(stops(light x occlusion) + terminator break, the
    sun's direct light), hazed with distance. aux = (break noise 0..1, haze 0..1, -)."""
    import numpy as np
    brk = (aux[..., 0] - 0.5) * BRUSH["edge"]
    x = stops_np(L, ao) + brk
    if not RAMP["sun_mask"]:
        sun = None
    if sun is not None:
        sun = np.asarray(sun, np.float32) * np.power(2.0, brk)  # the break wobbles the shadow edge too
    col = Al * ramp_np(x, sun)
    hz = np.clip(aux[..., 1], 0.0, 1.0)[..., None]
    return col * (1 - hz) + np.array(srgb(HAZE["col"])[:3]) * hz

# Painterly finish (shared with the bake): brush strokes in the albedo and a broken terminator. Both are noise in world
# position (metres), so the EEVEE stills and the bake agree whatever object a surface was joined into.
BRUSH = {
    "scale": 0.55,        # stroke noise frequency, per metre (strokes about 1-2 m long)
    "stretch": 4.5,       # strokes run level: the noise is squeezed this much vertically
    "value": 0.08,        # albedo value swing across a stroke (x 1 -/+ value/2)
    "warm": "#fff1dc",    # tint of the light strokes
    "cool": "#e4e2f6",    # tint of the dark strokes
    "edge": 1.2,          # terminator break: stops +/- edge/2 before the toon ramp
    "edge_scale": 0.9,
}

# Atmospheric perspective (shared with the bake): surfaces far from the town (the ridges, the headlands, the forest beyond
# the cove) take on a blue-lavender haze, mixed over the shaded colour by horizontal distance from the town's middle.
HAZE = {"col": "#a9b0dc", "max": 0.62, "d0": 50.0, "d1": 450.0, "pow": 0.85, "centre": (0.0, 55.0)}


def haze_np(x, y):
    """The haze factor at world positions (arrays): the numpy twin of haze_socket."""
    import numpy as np
    h = HAZE
    d = np.hypot(np.asarray(x) - h["centre"][0], np.asarray(y) - h["centre"][1])
    t = np.clip((d - h["d0"]) / (h["d1"] - h["d0"]), 0.0, 1.0)
    return h["max"] * np.power(t, h["pow"])


# ---------------------------------------------------------------------------------------------------------------- terrain profile

# (y_start, z) of each terrace; transitions between terraces are 2 x rise deep (the stair's own slope, 0.16 / 0.32).
ROAD_Z = 1.6
TERRACES = [(-1e9, ROAD_Z), (-13.2, 6.0), (18.0, 12.0), (48.0, 18.0), (78.0, 25.0), (130.0, 44.0)]
SEA_EDGE_Y = -30.0
LOOKOUT_Y = (130.0, 141.0)


def profile_z(y):
    """Height of the town ground at y on the stair's centre line (terraces and their slopes)."""
    if y < SEA_EDGE_Y:
        return -3.0 + 0.0 * y
    z = ROAD_Z
    for i in range(1, len(TERRACES)):
        y0, zi = TERRACES[i]
        rise = zi - TERRACES[i - 1][1]
        ys = y0 - 2 * rise  # slope start
        if y >= y0:
            z = zi
        elif y > ys:
            t = (y - ys) / (2 * rise)
            return TERRACES[i - 1][1] + rise * t
        else:
            break
    if y > LOOKOUT_Y[1]:
        # The hill behind the lookout climbs into forest.
        return 44.0 + (y - LOOKOUT_Y[1]) * 0.30 + 5.0 * math.sin((y - LOOKOUT_Y[1]) / 30.0)
    return z


def cove_z(x, y):
    """Extra height at the sides: the town sits in a cove whose wooded ridges rise east and west."""
    ax = abs(x)
    edge = 94.0 + 6.0 * math.sin(y / 23.0)
    if ax < edge:
        return 0.0
    d = ax - edge
    return d * 0.32 + 0.0025 * d * d


def ground_z(x, y):
    base = profile_z(y)
    if y < SEA_EDGE_Y:
        # Sea floor slopes down; the cove's sides still rise as headlands.
        bed = -3.0 - (SEA_EDGE_Y - y) * 0.15
        fade = max(0.0, 1.0 - (SEA_EDGE_Y - y) / 110.0)
        head = (cove_z(x, y) - 1.0) * (fade * fade * (3 - 2 * fade))
        return max(bed, bed + head) if head > 0 else bed
    return base + cove_z(x, y)


# ---------------------------------------------------------------------------------------------------------------- scene helpers

_coll_cache = {}


def collection(name):
    if name in _coll_cache and _coll_cache[name].name in bpy.data.collections:
        return _coll_cache[name]
    c = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if c.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(c)
    _coll_cache[name] = c
    return c


def mesh_object(name, verts, faces, piece, mat=None, smooth=False, coll=None, prop=False, outline=False):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.validate(clean_customdata=False)
    me.update()
    ob = bpy.data.objects.new(name, me)
    collection(coll or piece).objects.link(ob)
    if mat is not None:
        me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = smooth
    ob["cw_piece"] = piece
    ob["cw_prop"] = 1 if prop else 0
    ob["cw_outline"] = 1 if outline else 0
    return ob


def bm_object(name, bm, piece, mats=(), smooth=False, coll=None, prop=False, outline=False, recalc=True):
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    for p in me.polygons:
        p.use_smooth = smooth
    ob = bpy.data.objects.new(name, me)
    collection(coll or piece).objects.link(ob)
    ob["cw_piece"] = piece
    ob["cw_prop"] = 1 if prop else 0
    ob["cw_outline"] = 1 if outline else 0
    return ob


def add_box(bm, center, size, mat_index=0, rot_z=0.0):
    """Append an axis box (optionally turned about Z) to a bmesh. Returns its faces."""
    cx, cy, cz = center
    sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
    c, s = math.cos(rot_z), math.sin(rot_z)
    vs = []
    for dz in (-sz, sz):
        for dx, dy in ((-sx, -sy), (sx, -sy), (sx, sy), (-sx, sy)):
            vs.append(bm.verts.new((cx + dx * c - dy * s, cy + dx * s + dy * c, cz + dz)))
    idx = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    faces = []
    for f in idx:
        face = bm.faces.new([vs[i] for i in f])
        face.material_index = mat_index
        faces.append(face)
    return faces


def rotate_faces(faces, center, angle, axis):
    """Rotate the vertices of `faces` about `center` (axis 'X', 'Y' or 'Z')."""
    from mathutils import Matrix
    m = Matrix.Rotation(angle, 3, axis)
    c = Vector(center)
    for v in {v for f in faces for v in f.verts}:
        v.co = c + m @ (v.co - c)


def add_cylinder(bm, base, radius, height, segments=10, mat_index=0, radius_top=None, cap=True, axis=None):
    """Append a cylinder (along +Z from base, or along `axis` vector) to a bmesh."""
    rt = radius if radius_top is None else radius_top
    base = Vector(base)
    ax = Vector((0, 0, 1)) if axis is None else Vector(axis).normalized()
    # Basis perpendicular to the axis.
    ref = Vector((1, 0, 0)) if abs(ax.x) < 0.9 else Vector((0, 1, 0))
    u = ax.cross(ref).normalized()
    v = ax.cross(u).normalized()
    bot, top = [], []
    for i in range(segments):
        a = 2 * math.pi * i / segments
        d = u * math.cos(a) + v * math.sin(a)
        bot.append(bm.verts.new(base + d * radius))
        top.append(bm.verts.new(base + ax * height + d * rt))
    for i in range(segments):
        j = (i + 1) % segments
        f = bm.faces.new((bot[i], bot[j], top[j], top[i]))
        f.material_index = mat_index
    if cap:
        f = bm.faces.new(list(reversed(bot)))
        f.material_index = mat_index
        f = bm.faces.new(top)
        f.material_index = mat_index
    return bot, top


_ico_cache = {}


def _ico_template(subdiv):
    """Unit icosphere (vertices, faces) built once per subdivision level in a throwaway bmesh."""
    if subdiv not in _ico_cache:
        tmp = bmesh.new()
        bmesh.ops.create_icosphere(tmp, subdivisions=subdiv, radius=1.0)
        verts = [v.co.copy() for v in tmp.verts]
        tmp.verts.index_update()
        faces = [tuple(v.index for v in f.verts) for f in tmp.faces]
        tmp.free()
        _ico_cache[subdiv] = (verts, faces)
    return _ico_cache[subdiv]


def add_sphere(bm, center, radius, mat_index=0, subdiv=2, scale=(1, 1, 1)):
    """Append an icosphere without a bmesh operator (operators scan the whole mesh: quadratic in a big forest)."""
    tv, tf = _ico_template(subdiv)
    cx, cy, cz = center
    vs = [bm.verts.new((v.x * radius * scale[0] + cx, v.y * radius * scale[1] + cy, v.z * radius * scale[2] + cz)) for v in tv]
    for f in tf:
        face = bm.faces.new([vs[i] for i in f])
        face.material_index = mat_index
    return vs


def catenary(a, b, sag, n=16):
    """Points of a hanging cable from a to b (Vectors) that sags `sag` m under the middle of its chord: a true catenary
    z = c + k cosh((u - u0) / k) over the horizontal distance u, with the parameter k set by the sag of a level span
    and u0 by the height difference of the ends."""
    a, b = Vector(a), Vector(b)
    D = math.hypot(b.x - a.x, b.y - a.y)
    if D < 1e-3 or sag <= 1e-4:
        return [a.lerp(b, i / n) for i in range(n + 1)]
    lo, hi = 1e-3, 1e7  # k(cosh(D / 2k) - 1) = sag, solved by bisection (it falls as k grows)
    for _ in range(80):
        k = math.sqrt(lo * hi)
        if k * (math.cosh(min(700.0, D / (2 * k))) - 1) > sag:
            lo = k
        else:
            hi = k
    h = b.z - a.z
    u0 = D / 2 - k * math.asinh(h / (2 * k * math.sinh(D / (2 * k))))
    c = a.z - k * math.cosh(-u0 / k)
    out = []
    for i in range(n + 1):
        t = i / n
        p = a.lerp(b, t)
        p.z = c + k * math.cosh((t * D - u0) / k)
        out.append(p)
    return out


# ---------------------------------------------------------------------------------------------------------------- materials

_mats = {}


def _ramp_node(nt, x, y, centres=False):
    """The toon ramp as a colour ramp node on (stops - x0) / (x1 - x0); with `centres`, the band centres in its alpha
    (as (centre - x0) / (x1 - x0)) for the in-band gradation."""
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.location = (x, y)
    cr = ramp.color_ramp
    cr.interpolation = "LINEAR"
    r = RAMP
    x0, x1 = r["x_range"]

    def p(x):
        return (x - x0) / (x1 - x0)
    if centres:
        b = [(1.0, 1.0, 1.0, p(c)) for c in r["centres"]]
    else:
        b = [srgb(c) for c in r["bands"]]
    stops = [(0.0, b[0])]
    for i, (e, w) in enumerate(zip(r["edges"], r["widths"])):
        stops += [(p(e - w / 2), b[i]), (p(e + w / 2), b[i + 1])]
    stops.append((1.0, b[-1]))
    cr.elements[0].position = stops[0][0]
    cr.elements[0].color = stops[0][1]
    cr.elements[1].position = stops[-1][0]
    cr.elements[1].color = stops[-1][1]
    for pos, col in stops[1:-1]:
        e = cr.elements.new(pos)
        e.color = col
    return ramp


def _world_pos(nt):
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    return geo.outputs["Position"]


def _stretched_noise(nt, pos, scale, stretch, detail=4.0, rough=0.55, distort=0.3):
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1.0, 1.0, stretch)
    nt.links.new(pos, mp.inputs[0])
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = scale
    nz.inputs["Detail"].default_value = detail
    nz.inputs["Roughness"].default_value = rough
    nz.inputs["Distortion"].default_value = distort
    nt.links.new(mp.outputs[0], nz.inputs["Vector"])
    return nz.outputs["Fac"]


def brush_edge_socket(nt):
    """Terminator break noise, 0..1 (world space): the bake's aux pass emits the same graph."""
    return _stretched_noise(nt, _world_pos(nt), BRUSH["edge_scale"], 1.8, detail=6.0, rough=0.7, distort=1.4)


def haze_socket(nt):
    """Haze factor (world space) as a node socket, the twin of haze_np."""
    h = HAZE
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(_world_pos(nt), sep.inputs[0])
    comb = nt.nodes.new("ShaderNodeCombineXYZ")
    for i in (0, 1):
        sm = nt.nodes.new("ShaderNodeMath")
        sm.operation = "SUBTRACT"
        nt.links.new(sep.outputs[i], sm.inputs[0])
        sm.inputs[1].default_value = h["centre"][i]
        nt.links.new(sm.outputs[0], comb.inputs[i])
    ln = nt.nodes.new("ShaderNodeVectorMath")
    ln.operation = "LENGTH"
    nt.links.new(comb.outputs[0], ln.inputs[0])
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = h["d0"]
    mr.inputs["From Max"].default_value = h["d1"]
    mr.clamp = True
    nt.links.new(ln.outputs["Value"], mr.inputs["Value"])
    pw = nt.nodes.new("ShaderNodeMath")
    pw.operation = "POWER"
    nt.links.new(mr.outputs["Result"], pw.inputs[0])
    pw.inputs[1].default_value = h["pow"]
    mu = nt.nodes.new("ShaderNodeMath")
    mu.operation = "MULTIPLY"
    nt.links.new(pw.outputs[0], mu.inputs[0])
    mu.inputs[1].default_value = h["max"]
    return mu.outputs[0]


def _brush_albedo(nt, albedo_socket, amount):
    """Brush strokes over a painted albedo: long level strokes a little lighter and warmer or darker and cooler, with a
    finer dry-brush grain inside them."""
    b = BRUSH
    pos = _world_pos(nt)
    big = _stretched_noise(nt, pos, b["scale"], b["stretch"])
    fine = _stretched_noise(nt, pos, b["scale"] * 6.0, b["stretch"] * 1.6, detail=3.0, rough=0.5, distort=0.4)
    mix_n = nt.nodes.new("ShaderNodeMix")
    mix_n.data_type = "FLOAT"
    mix_n.inputs["Factor"].default_value = 0.3
    nt.links.new(big, mix_n.inputs[2])
    nt.links.new(fine, mix_n.inputs[3])
    st = nt.nodes.new("ShaderNodeMapRange")
    st.inputs["From Min"].default_value = 0.36
    st.inputs["From Max"].default_value = 0.64
    st.interpolation_type = "SMOOTHSTEP"
    nt.links.new(mix_n.outputs[0], st.inputs["Value"])
    k = amount
    c0, c1 = srgb(b["cool"]), srgb(b["warm"])
    tint = nt.nodes.new("ShaderNodeMix")
    tint.data_type = "RGBA"
    nt.links.new(st.outputs["Result"], tint.inputs["Factor"])
    tint.inputs[6].default_value = tuple(1.0 + (c - 1.0) * k for c in c0[:3]) + (1.0,)
    tint.inputs[7].default_value = tuple(1.0 + (c - 1.0) * k for c in c1[:3]) + (1.0,)
    val = nt.nodes.new("ShaderNodeMapRange")
    val.inputs["To Min"].default_value = 1.0 - b["value"] * k / 2
    val.inputs["To Max"].default_value = 1.0 + b["value"] * k / 2
    nt.links.new(st.outputs["Result"], val.inputs["Value"])
    m1 = nt.nodes.new("ShaderNodeMix")
    m1.data_type = "RGBA"
    m1.blend_type = "MULTIPLY"
    m1.inputs["Factor"].default_value = 1.0
    nt.links.new(albedo_socket, m1.inputs[6])
    nt.links.new(tint.outputs[2], m1.inputs[7])
    m2 = nt.nodes.new("ShaderNodeVectorMath")
    m2.operation = "SCALE"
    nt.links.new(m1.outputs[2], m2.inputs[0])
    nt.links.new(val.outputs["Result"], m2.inputs["Scale"])
    return m2.outputs[0]


def toon_material(name, base, var=None, noise_scale=1.5, var_amount=0.35, emission=None, emission_strength=0.0, stripes=None, line=False, brush=1.0):
    """A cel-shaded material: diffuse light -> toon bands -> times a painted albedo, drawn as emission (EEVEE).

    The node named ALBEDO is the painted base colour; the bake reads it. `var` is a second colour mixed in by a soft noise
    (painted variation); `stripes` = (axis, period, colour, width) draws tile rows or boards.
    Emission materials (lamps, lit windows) skip the ramp and carry `cw_emissive` for the export.
    """
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (900, 0)

    # Painted albedo.
    base_rgb = nt.nodes.new("ShaderNodeRGB")
    base_rgb.outputs[0].default_value = srgb(base)
    base_rgb.location = (-900, 200)
    albedo_socket = base_rgb.outputs[0]
    if var is not None:
        coord = nt.nodes.new("ShaderNodeTexCoord")
        coord.location = (-1300, 0)
        noise = nt.nodes.new("ShaderNodeTexNoise")
        noise.location = (-1100, 0)
        noise.inputs["Scale"].default_value = noise_scale
        noise.inputs["Detail"].default_value = 3.0
        noise.inputs["Roughness"].default_value = 0.55
        nt.links.new(coord.outputs["Object"], noise.inputs["Vector"])
        ramp = nt.nodes.new("ShaderNodeMapRange")
        ramp.location = (-900, 0)
        ramp.inputs["From Min"].default_value = 0.5 - var_amount * 0.5
        ramp.inputs["From Max"].default_value = 0.5 + var_amount * 0.5
        nt.links.new(noise.outputs["Fac"], ramp.inputs["Value"])
        var_rgb = nt.nodes.new("ShaderNodeRGB")
        var_rgb.outputs[0].default_value = srgb(var)
        var_rgb.location = (-900, -200)
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.location = (-700, 100)
        nt.links.new(ramp.outputs["Result"], mix.inputs["Factor"])
        nt.links.new(base_rgb.outputs[0], mix.inputs[6])
        nt.links.new(var_rgb.outputs[0], mix.inputs[7])
        albedo_socket = mix.outputs[2]
    if stripes is not None:
        axis, period, col, width = stripes
        coord2 = nt.nodes.new("ShaderNodeTexCoord")
        coord2.location = (-1300, -400)
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        sep.location = (-1100, -400)
        nt.links.new(coord2.outputs["UV" if axis.startswith("uv") else "Object"], sep.inputs[0])
        comp = {"x": 0, "y": 1, "z": 2, "uvx": 0, "uvy": 1}[axis]
        wave = nt.nodes.new("ShaderNodeMath")
        wave.operation = "FRACT"
        wave.location = (-900, -400)
        div = nt.nodes.new("ShaderNodeMath")
        div.operation = "DIVIDE"
        div.inputs[1].default_value = period
        div.location = (-1000, -500)
        nt.links.new(sep.outputs[comp], div.inputs[0])
        nt.links.new(div.outputs[0], wave.inputs[0])
        lt = nt.nodes.new("ShaderNodeMath")
        lt.operation = "LESS_THAN"
        lt.inputs[1].default_value = width
        lt.location = (-800, -400)
        nt.links.new(wave.outputs[0], lt.inputs[0])
        srgb_line = nt.nodes.new("ShaderNodeRGB")
        srgb_line.outputs[0].default_value = srgb(col)
        srgb_line.location = (-800, -600)
        mix2 = nt.nodes.new("ShaderNodeMix")
        mix2.data_type = "RGBA"
        mix2.location = (-550, 0)
        nt.links.new(lt.outputs[0], mix2.inputs["Factor"])
        nt.links.new(albedo_socket, mix2.inputs[6])
        nt.links.new(srgb_line.outputs[0], mix2.inputs[7])
        albedo_socket = mix2.outputs[2]
    if brush > 0 and emission is None:
        albedo_socket = _brush_albedo(nt, albedo_socket, brush)
    alb = nt.nodes.new("NodeReroute")
    alb.name = "ALBEDO"
    alb.label = "ALBEDO"
    alb.location = (-350, 100)
    nt.links.new(albedo_socket, alb.inputs[0])

    if emission is not None:
        em = nt.nodes.new("ShaderNodeEmission")
        em.location = (600, 0)
        em.inputs["Color"].default_value = srgb(emission)
        em.inputs["Strength"].default_value = emission_strength
        nt.links.new(em.outputs[0], out.inputs[0])
        m["cw_emissive"] = emission
        m["cw_emissive_strength"] = emission_strength
    else:
        diff = nt.nodes.new("ShaderNodeBsdfDiffuse")
        diff.location = (-350, -200)
        diff.inputs["Color"].default_value = (1, 1, 1, 1)
        s2r = nt.nodes.new("ShaderNodeShaderToRGB")
        s2r.location = (-150, -200)
        nt.links.new(diff.outputs[0], s2r.inputs[0])
        bw = nt.nodes.new("ShaderNodeRGBToBW")
        bw.location = (50, -200)
        nt.links.new(s2r.outputs["Color"], bw.inputs[0])
        # Contact occlusion on the light, before the ramp (stops_np): L x (floor + (1 - floor) x AO).
        ao = nt.nodes.new("ShaderNodeAmbientOcclusion")
        ao.inputs["Distance"].default_value = LIGHT["ao_dist"]
        aof = nt.nodes.new("ShaderNodeMapRange")
        aof.inputs["To Min"].default_value = LIGHT["ao_floor"]
        nt.links.new(ao.outputs["AO"], aof.inputs["Value"])
        lao = nt.nodes.new("ShaderNodeMath")
        lao.operation = "MULTIPLY"
        nt.links.new(bw.outputs[0], lao.inputs[0])
        nt.links.new(aof.outputs["Result"], lao.inputs[1])
        lmx = nt.nodes.new("ShaderNodeMath")
        lmx.operation = "MAXIMUM"
        lmx.inputs[1].default_value = 1e-4 * lref()
        nt.links.new(lao.outputs[0], lmx.inputs[0])
        ldv = nt.nodes.new("ShaderNodeMath")
        ldv.operation = "DIVIDE"
        ldv.inputs[1].default_value = lref()
        nt.links.new(lmx.outputs[0], ldv.inputs[0])
        lg = nt.nodes.new("ShaderNodeMath")
        lg.operation = "LOGARITHM"
        lg.inputs[1].default_value = 2.0
        nt.links.new(ldv.outputs[0], lg.inputs[0])
        # Broken terminator: the stops are nudged by a brush noise before the ramp, so band edges wander like a brush.
        en = nt.nodes.new("ShaderNodeMapRange")
        en.inputs["To Min"].default_value = -BRUSH["edge"] / 2
        en.inputs["To Max"].default_value = BRUSH["edge"] / 2
        nt.links.new(brush_edge_socket(nt), en.inputs["Value"])
        lb = nt.nodes.new("ShaderNodeMath")
        lb.operation = "ADD"
        nt.links.new(lg.outputs[0], lb.inputs[0])
        nt.links.new(en.outputs["Result"], lb.inputs[1])
        xr = nt.nodes.new("ShaderNodeMapRange")
        xr.inputs["From Min"].default_value = RAMP["x_range"][0]
        xr.inputs["From Max"].default_value = RAMP["x_range"][1]
        nt.links.new(lb.outputs[0], xr.inputs["Value"])
        ramp = _ramp_node(nt, 200, -200)
        nt.links.new(xr.outputs["Result"], ramp.inputs[0])
        # In-band gradation (ramp_np): the band centre through a grey ramp, 2^(grad x clamp(x - centre)).
        cr = _ramp_node(nt, 200, -500, centres=True)
        nt.links.new(xr.outputs["Result"], cr.inputs[0])
        x0, x1 = RAMP["x_range"]
        cv = nt.nodes.new("ShaderNodeMapRange")
        cv.inputs["To Min"].default_value = x0
        cv.inputs["To Max"].default_value = x1
        nt.links.new(cr.outputs["Alpha"], cv.inputs["Value"])
        dv = nt.nodes.new("ShaderNodeMath")
        dv.operation = "SUBTRACT"
        nt.links.new(lb.outputs[0], dv.inputs[0])
        nt.links.new(cv.outputs["Result"], dv.inputs[1])
        cl = nt.nodes.new("ShaderNodeClamp")
        cl.inputs["Min"].default_value = -RAMP["grad_max"]
        cl.inputs["Max"].default_value = RAMP["grad_max"]
        nt.links.new(dv.outputs[0], cl.inputs["Value"])
        gm = nt.nodes.new("ShaderNodeMath")
        gm.operation = "MULTIPLY"
        gm.inputs[1].default_value = RAMP["grad"]
        nt.links.new(cl.outputs[0], gm.inputs[0])
        gp = nt.nodes.new("ShaderNodeMath")
        gp.operation = "POWER"
        gp.inputs[0].default_value = 2.0
        nt.links.new(gm.outputs[0], gp.inputs[1])
        gs = nt.nodes.new("ShaderNodeVectorMath")
        gs.operation = "SCALE"
        nt.links.new(ramp.outputs["Color"], gs.inputs[0])
        nt.links.new(gp.outputs[0], gs.inputs["Scale"])
        mul = nt.nodes.new("ShaderNodeMix")
        mul.data_type = "RGBA"
        mul.blend_type = "MULTIPLY"
        mul.inputs["Factor"].default_value = 1.0
        mul.location = (450, 0)
        nt.links.new(alb.outputs[0], mul.inputs[6])
        nt.links.new(gs.outputs[0], mul.inputs[7])
        # Atmospheric perspective over the shaded colour.
        hz = nt.nodes.new("ShaderNodeMix")
        hz.data_type = "RGBA"
        nt.links.new(haze_socket(nt), hz.inputs["Factor"])
        nt.links.new(mul.outputs[2], hz.inputs[6])
        hz.inputs[7].default_value = srgb(HAZE["col"])
        em = nt.nodes.new("ShaderNodeEmission")
        em.location = (650, 0)
        nt.links.new(hz.outputs[2], em.inputs["Color"])
        nt.links.new(em.outputs[0], out.inputs[0])
    m["cw_base"] = base
    _mats[name] = m
    return m


def line_material():
    name = "cw_line"
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = srgb(P["line"])
    nt.links.new(em.outputs[0], out.inputs[0])
    m.use_backface_culling = True
    m["cw_line"] = 1
    _mats[name] = m
    return m


# Cloth that sways in the wind (laundry lines, banners): built as `sway_<k>` objects whose origin is the line they hang
# from; the bake exports them as the `laundry` piece, one node per line rotating about that line in one looping clip.
SWAY = {"next": 0, "budget": 16}


def sway_object(name, bm, mats, pivot, axis, amp_deg, mean_deg=0.0, rot_z=0.0):
    """A swaying cloth object from `bm` (coordinates relative to `pivot`, in the object's frame turned by rot_z): it hangs
    from the axis (a unit vector in world space) through pivot, swings amp_deg either side of mean_deg."""
    k = SWAY["next"]
    SWAY["next"] += 1
    lay = bm.faces.layers.int.get("cw_sway_id") or bm.faces.layers.int.new("cw_sway_id")
    for f in bm.faces:
        f[lay] = k
    ob = bm_object(name, bm, "props", mats=mats, outline=True)
    ob.location = pivot
    ob.rotation_euler = (0.0, 0.0, rot_z)
    ob["cw_line_w"] = 0.014
    r = random.Random(k * 7 + 3)
    ob["cw_sway"] = {"id": k, "pivot": list(pivot), "axis": list(axis), "amp": amp_deg, "mean": mean_deg,
                     "phase": r.uniform(0, 2 * math.pi), "phase2": r.uniform(0, 2 * math.pi)}
    return ob


def sway_free():
    return SWAY["next"] < SWAY["budget"]


def rng(seed):
    return random.Random(seed)
