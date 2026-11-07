"""Sky: the painted gradient dome (horizon glow band, sun halo, high cirrus streaks in perspective), the cloudscape
(cel-shaded billow masses built from many overlapping spheres: a towering cumulonimbus with an anvil, satellite cumulus
at several depths, a broken bank on the horizon), the sun lamp and the ambient world light."""
import math

import bmesh
import bpy
from mathutils import Vector

from common import P, _ico_template, collection, rng, srgb

SUN_AZ = 214.0  # degrees from north (+Y), clockwise (east = +X): low over the sea, inside the opening view
SUN_EL = 6.5
DOME_R = 2600.0
EYE = Vector((0.0, 133.0, 46.0))  # the lookout: clouds are placed around it


def sun_dir():
    az, el = math.radians(SUN_AZ), math.radians(SUN_EL)
    return Vector((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)))


def cloud_light_dir():
    """The light the clouds are painted with: from the sun's side, but swung 110 degrees toward the lookout and raised, so
    the towers read three-quarter lit (a painter's cheat; the true sun still draws the silver rims)."""
    az, el = math.radians(SUN_AZ + 110.0), math.radians(34.0)
    return Vector((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)))


# ---------------------------------------------------------------------------------------------------------------- node helpers

class Nodes:
    """Tiny builder for shader node trees: every call returns an output socket."""

    def __init__(self, mat):
        mat.use_nodes = True
        self.nt = mat.node_tree
        for n in list(self.nt.nodes):
            self.nt.nodes.remove(n)
        self.out = self.nt.nodes.new("ShaderNodeOutputMaterial")

    def _in(self, sock, value):
        if isinstance(value, bpy.types.NodeSocket):
            self.nt.links.new(value, sock)
        elif value is not None:
            sock.default_value = value

    def node(self, kind, **props):
        n = self.nt.nodes.new(kind)
        for k, v in props.items():
            setattr(n, k, v)
        return n

    def math(self, op, a, b=None, clamp=False):
        n = self.node("ShaderNodeMath", operation=op, use_clamp=clamp)
        self._in(n.inputs[0], a)
        if b is not None:
            self._in(n.inputs[1], b)
        return n.outputs[0]

    def vmath(self, op, a, b=None, scale=None):
        n = self.node("ShaderNodeVectorMath", operation=op)
        self._in(n.inputs[0], a)
        if b is not None:
            self._in(n.inputs[1], b)
        if scale is not None:
            self._in(n.inputs["Scale"], scale)
        return n.outputs["Value"] if op in ("DOT_PRODUCT", "LENGTH", "DISTANCE") else n.outputs["Vector"]

    def remap(self, v, f0, f1, t0=0.0, t1=1.0, smooth=False):
        n = self.node("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP" if smooth else "LINEAR")
        self._in(n.inputs["Value"], v)
        self._in(n.inputs["From Min"], f0)
        self._in(n.inputs["From Max"], f1)
        self._in(n.inputs["To Min"], t0)
        self._in(n.inputs["To Max"], t1)
        return n.outputs[0]

    def mix(self, fac, a, b, blend="MIX"):
        n = self.node("ShaderNodeMix", data_type="RGBA", blend_type=blend, clamp_factor=True)
        self._in(n.inputs["Factor"], fac)
        self._in(n.inputs[6], srgb(a) if isinstance(a, str) else a)
        self._in(n.inputs[7], srgb(b) if isinstance(b, str) else b)
        return n.outputs[2]

    def ramp(self, v, stops, interp="LINEAR"):
        n = self.node("ShaderNodeValToRGB")
        cr = n.color_ramp
        cr.interpolation = interp
        cr.elements[0].position, cr.elements[0].color = stops[0][0], srgb(stops[0][1])
        cr.elements[1].position, cr.elements[1].color = stops[-1][0], srgb(stops[-1][1])
        for pos, col in stops[1:-1]:
            e = cr.elements.new(pos)
            e.color = srgb(col)
        self._in(n.inputs[0], v)
        return n.outputs["Color"]

    def sep(self, v):
        n = self.node("ShaderNodeSeparateXYZ")
        self._in(n.inputs[0], v)
        return n.outputs

    def combine(self, x, y, z):
        n = self.node("ShaderNodeCombineXYZ")
        self._in(n.inputs[0], x)
        self._in(n.inputs[1], y)
        self._in(n.inputs[2], z)
        return n.outputs[0]

    def emit(self, color, strength=1.0):
        n = self.node("ShaderNodeEmission")
        self._in(n.inputs["Color"], srgb(color) if isinstance(color, str) else color)
        self._in(n.inputs["Strength"], strength)
        return n.outputs[0]

    def add_shader(self, a, b):
        n = self.node("ShaderNodeAddShader")
        self.nt.links.new(a, n.inputs[0])
        self.nt.links.new(b, n.inputs[1])
        return n.outputs[0]

    def output(self, shader):
        self.nt.links.new(shader, self.out.inputs[0])


# ---------------------------------------------------------------------------------------------------------------- dome

# Far coast painted on the dome above the sea line, in layers that grow paler and bluer with distance (atmospheric
# perspective): (azimuth from, to, feather (degrees), base height, height swing (radians of elevation), wiggle frequency,
# seed, colour, a town's lights along its foot). The sea's far edge is about 1.1 degrees under the eye's level.
RIDGE_FOOT = -0.022
RIDGES = [
    (124.0, 199.0, 16.0, 0.013, 0.020, 0.11, 1.0, "#c9b8d8", False),   # a far peninsula under the cloud tower
    (136.0, 182.0, 10.0, 0.007, 0.012, 0.16, 5.0, "#a3a2d2", True),     # a nearer one, with a far town at its foot
    (224.0, 306.0, 18.0, 0.016, 0.026, 0.09, 9.0, "#c2b4da", False),   # far ranges west, beyond the headland
    (240.0, 284.0, 11.0, 0.008, 0.016, 0.14, 13.0, "#9b9dce", False),
]


def _far_ridges(b, col, dz, dx, dy):
    az = b.math("MULTIPLY", b.math("ARCTAN2", dx, dy), 180.0 / math.pi)
    az = b.math("ADD", az, b.math("MULTIPLY", b.math("LESS_THAN", az, 0.0), 360.0))  # 0..360 from north, clockwise
    for (a0, a1, fe, h0, hv, fq, seed, hexcol, town) in RIDGES:
        mask = b.math("MULTIPLY", b.remap(az, a0, a0 + fe, 0.0, 1.0, smooth=True), b.remap(az, a1, a1 - fe, 0.0, 1.0, smooth=True))
        nz = b.node("ShaderNodeTexNoise", noise_dimensions="1D")
        nz.inputs["Scale"].default_value = 1.0
        nz.inputs["Detail"].default_value = 6.0
        nz.inputs["Roughness"].default_value = 0.58
        b._in(nz.inputs["W"], b.math("ADD", b.math("MULTIPLY", az, fq), seed * 17.0))
        wig = b.remap(nz.outputs["Fac"], 0.3, 0.7, 0.0, 1.0)
        top = b.math("ADD", RIDGE_FOOT, b.math("MULTIPLY", mask, b.math("ADD", h0, b.math("MULTIPLY", wig, hv))))
        # Inside the silhouette, with an edge a fraction of a texel soft.
        inside = b.math("MULTIPLY", b.remap(dz, top, b.math("SUBTRACT", top, 0.0007), 0.0, 1.0), b.math("GREATER_THAN", mask, 0.02))
        # Paler at the foot, where the haze over the sea is thickest; a faint lit edge along the top.
        foot = b.remap(dz, RIDGE_FOOT + 0.012, RIDGE_FOOT, 0.0, 1.0, smooth=True)
        rc = b.mix(b.math("MULTIPLY", foot, 0.45), hexcol, "#f2c6b4")
        col = b.mix(inside, col, rc)
        if town:
            vo = b.node("ShaderNodeTexVoronoi", feature="F1")
            vo.inputs["Scale"].default_value = 1.0
            vo.inputs["Randomness"].default_value = 0.9
            b._in(vo.inputs["Vector"], b.combine(b.math("MULTIPLY", az, 5.0), b.math("MULTIPLY", dz, 57.3 * 9.0), 0.0))
            dot = b.remap(vo.outputs["Distance"], 0.16, 0.08, 0.0, 1.0)
            pick = b.math("GREATER_THAN", vo.outputs["Color"], 0.55)
            band = b.math("MULTIPLY", b.remap(dz, RIDGE_FOOT + 0.0045, RIDGE_FOOT + 0.002, 0.0, 1.0), b.remap(mask, 0.5, 0.8, 0.0, 1.0))
            lit = b.math("MULTIPLY", b.math("MULTIPLY", dot, pick), b.math("MULTIPLY", band, inside))
            col = b.mix(lit, col, "#ffe2a0")
    return col


def _dome_material():
    m = bpy.data.materials.new("cw_sky")
    b = Nodes(m)
    tc = b.node("ShaderNodeTexCoord")
    d = b.vmath("NORMALIZE", tc.outputs["Object"])
    dx, dy, dz = b.sep(d)
    e = b.math("MAXIMUM", dz, 0.0)
    sd = sun_dir()
    hs = Vector((sd.x, sd.y, 0)).normalized()
    # Sunward factor: 1 toward the sun's azimuth, 0 opposite.
    dh = b.vmath("NORMALIZE", b.combine(dx, dy, 0.0))
    sun_az = b.math("MULTIPLY", b.math("ADD", b.vmath("DOT_PRODUCT", dh, (hs.x, hs.y, 0.0)), 1.0), 0.5)
    sunward = b.math("POWER", sun_az, 2.0)
    cosang = b.vmath("DOT_PRODUCT", d, (sd.x, sd.y, sd.z))
    # Elevation gradient: the sun side warm and bright, the far side cooler and pinker.
    # More steps than a two-tone wash: a lemon-gold rim, apricot, coral rose, a lilac turn, then periwinkle into a
    # saturated cobalt (the upper sky carries the picture's strongest blue).
    warm = b.ramp(e, [(0.0, "#ffe2a4"), (0.014, "#ffc68a"), (0.04, "#f9a585"), (0.08, "#e88f9a"), (0.13, "#c08bbd"),
                      (0.20, "#928ad0"), (0.31, "#6c78cf"), (0.46, "#5064c2"), (0.68, "#3a4ea6"), (1.0, "#26377e")], "EASE")
    cool = b.ramp(e, [(0.0, "#f4b896"), (0.03, "#eba2a2"), (0.075, "#d093b6"), (0.14, "#a48ccc"), (0.24, "#7e82d0"),
                      (0.38, "#5d6dc6"), (0.58, "#4255aa"), (0.8, "#32448f"), (1.0, "#26377e")], "EASE")
    col = b.mix(sunward, cool, warm)
    # Soft brush strokes across the wash: long level strokes a little lighter or darker (a painted sky, not a vector fill).
    bs = b.node("ShaderNodeMapping")
    bs.inputs["Scale"].default_value = (1.0, 1.0, 7.0)
    b._in(bs.inputs[0], d)
    bn = b.node("ShaderNodeTexNoise")
    bn.inputs["Scale"].default_value = 2.2
    bn.inputs["Detail"].default_value = 5.0
    bn.inputs["Roughness"].default_value = 0.6
    bn.inputs["Distortion"].default_value = 0.8
    b._in(bn.inputs["Vector"], bs.outputs[0])
    stroke = b.remap(bn.outputs["Fac"], 0.34, 0.66, 0.955, 1.045, smooth=True)
    col = b.vmath("SCALE", col, scale=stroke)
    # The horizon glow band: a thin, bright apricot-gold strip hugging the sea line, strongest under the sun.
    band = b.math("POWER", b.remap(e, 0.0, 0.07, 1.0, 0.0, smooth=True), 2.2)
    band_w = b.math("MULTIPLY", band, b.math("ADD", b.math("MULTIPLY", sunward, 0.75), 0.25))
    col = b.mix(band_w, col, "#ffe0a6", blend="SCREEN")
    # A second, wider rose glow above it.
    rose = b.math("MULTIPLY", b.remap(e, 0.02, 0.2, 1.0, 0.0, smooth=True), b.math("MULTIPLY", sunward, 0.35))
    col = b.mix(rose, col, "#ff9e8a", blend="SCREEN")
    # Sun halo: wide warm halo, weighted to the horizon, plus a tight core glow.
    wide = b.math("POWER", b.remap(cosang, 0.55, 1.0, 0.0, 1.0, smooth=True), 2.4)
    halo = b.math("MULTIPLY", wide, b.remap(e, 0.45, 0.0))
    col = b.mix(halo, col, P["horizon_sun"], blend="SCREEN")
    # Cirrus: long thin strands drawn on a high cloud plane, so they converge toward the horizon (perspective depth).
    inv = b.math("DIVIDE", 1.0, b.math("ADD", dz, 0.06))
    plane = b.combine(b.math("MULTIPLY", dx, inv), b.math("MULTIPLY", dy, inv), 0.0)
    mp = b.node("ShaderNodeMapping")
    mp.inputs["Rotation"].default_value = (0.0, 0.0, math.radians(-28))
    mp.inputs["Scale"].default_value = (1.0, 1.0, 1.0)
    b._in(mp.inputs[0], plane)
    warp = b.node("ShaderNodeTexNoise")
    warp.inputs["Scale"].default_value = 0.9
    warp.inputs["Detail"].default_value = 3.0
    b._in(warp.inputs["Vector"], mp.outputs[0])
    st = b.node("ShaderNodeMapping")
    st.inputs["Scale"].default_value = (0.35, 6.0, 1.0)
    b._in(st.inputs[0], b.vmath("ADD", mp.outputs[0], b.vmath("SCALE", warp.outputs["Color"], scale=0.25)))
    streak = b.node("ShaderNodeTexNoise")
    streak.inputs["Scale"].default_value = 1.6
    streak.inputs["Detail"].default_value = 4.0
    streak.inputs["Roughness"].default_value = 0.55
    b._in(streak.inputs["Vector"], st.outputs[0])
    wave = streak  # (the strands' source; named for the veil below)
    strand = b.remap(streak.outputs["Fac"], 0.57, 0.68, 0.0, 1.0, smooth=True)
    clump = b.node("ShaderNodeTexNoise")
    clump.inputs["Scale"].default_value = 0.55
    clump.inputs["Detail"].default_value = 2.0
    b._in(clump.inputs["Vector"], mp.outputs[0])
    clumpm = b.remap(clump.outputs["Fac"], 0.42, 0.58, 0.0, 1.0, smooth=True)
    fade = b.math("MULTIPLY", b.remap(e, 0.05, 0.16, 0.0, 1.0, smooth=True), b.remap(e, 0.85, 0.55, 0.0, 1.0, smooth=True))
    cir = b.math("MULTIPLY", b.math("MULTIPLY", strand, clumpm), fade)
    cir_col = b.mix(b.math("POWER", sun_az, 3.0), "#e6a3c4", "#ffd8a8")
    col = b.mix(b.math("MULTIPLY", cir, 0.85), col, cir_col)
    # A fainter, broader veil beside each strand (the brush's dry edge).
    veil = b.math("MULTIPLY", b.math("MULTIPLY", b.remap(wave.outputs["Fac"], 0.52, 0.66, 0.0, 1.0, smooth=True), clumpm), fade)
    col = b.mix(b.math("MULTIPLY", veil, 0.18), col, cir_col, blend="SCREEN")
    col = _far_ridges(b, col, dz, dx, dy)
    sky = b.emit(col)
    # The sun disc and its tight glow (bright: blooms).
    core = b.remap(cosang, 0.99990, 0.99995)
    ch = b.math("POWER", b.remap(cosang, 0.9975, 1.0, 0.0, 1.0, smooth=True), 3.0)
    sun = b.emit(P["sun"], b.math("MULTIPLY", b.math("ADD", core, ch), 3.0))
    b.output(b.add_shader(sky, sun))
    m["cw_sky"] = 1
    return m


def build_dome():
    bm = bmesh.new()
    bm.loops.layers.uv.new("UVMap")
    bmesh.ops.create_uvsphere(bm, u_segments=96, v_segments=48, radius=DOME_R, calc_uvs=True)
    bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new("sky_dome")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("sky_dome", me)
    collection("sky").objects.link(ob)
    ob.location = EYE
    me.materials.append(_dome_material())
    for p in me.polygons:
        p.use_smooth = True
    ob["cw_piece"] = "sky"
    ob.visible_shadow = False
    return ob


# ---------------------------------------------------------------------------------------------------------------- cloud shading

CLOUD_BANDS = [  # light value -> colour, hard steps (cel bands): core shadow, shadow, a thin warm terminator, lit, sunlit crowns
    (0.0, "#6a63a8"),
    (0.21, "#7d75b5"),
    (0.40, "#e99aa2"),
    (0.43, "#ffc39c"),
    (0.80, "#fff0dc"),
]


def _cloud_material():
    if "cw_cloud" in bpy.data.materials:
        return bpy.data.materials["cw_cloud"]
    m = bpy.data.materials.new("cw_cloud")
    b = Nodes(m)
    geo = b.node("ShaderNodeNewGeometry")
    n = geo.outputs["Normal"]
    nx, ny, nz = b.sep(n)
    # The light value comes per vertex from realize() (`cw_light`, full float), from the blended form/billow normals.
    # (Staircases along the billow creases at 4K are a depth-precision effect of sphere-on-sphere intersections 2 km out:
    # the stills render the clouds in their own pass with a far near plane, shots._render_layered, and so do the cards.)
    light = b.node("ShaderNodeAttribute", attribute_type="GEOMETRY", attribute_name="cw_light").outputs["Fac"]
    # (No ambient-occlusion crease term: its screen-space noise, stepped by the bands, serrated every terminator at 4K.
    # The creases come from the billows' own normals meeting where they intersect.)
    # Painted band edges: the light is nudged by a brush noise (tens of metres across) so each band's edge wanders and
    # breaks the way a loaded brush leaves it, instead of following the geometry exactly.
    bnz = b.node("ShaderNodeTexNoise")
    bnz.inputs["Scale"].default_value = 0.013
    bnz.inputs["Detail"].default_value = 1.0
    bnz.inputs["Roughness"].default_value = 0.62
    bnz.inputs["Distortion"].default_value = 0.6
    b._in(bnz.inputs["Vector"], geo.outputs["Position"])
    light = b.math("ADD", light, b.remap(bnz.outputs["Fac"], 0.3, 0.7, -0.035, 0.035))
    col = b.ramp(light, CLOUD_BANDS, "CONSTANT")
    # Soft inner glow: the shadow side lifts toward a warm lilac as it nears the terminator (light scattered inside the
    # cloud), the one soft gradient among the hard bands.
    glow = b.math("MULTIPLY", b.remap(light, 0.22, 0.40, 0.0, 1.0, smooth=True), b.math("LESS_THAN", light, 0.40))
    col = b.mix(b.math("MULTIPLY", glow, 0.6), col, "#b190c6")
    # Cool underside: faces turned down toward the sea go deep blue-lavender, with a faint pink bounce at the very base.
    attr_base = b.node("ShaderNodeAttribute", attribute_type="OBJECT", attribute_name="cw_base_z")
    attr_h = b.node("ShaderNodeAttribute", attribute_type="OBJECT", attribute_name="cw_height")
    pz = b.sep(geo.outputs["Position"])[2]
    rel = b.math("DIVIDE", b.math("SUBTRACT", pz, attr_base.outputs["Fac"]), attr_h.outputs["Fac"])
    low = b.remap(rel, 0.16, 0.02, 0.0, 1.0, smooth=True)
    down = b.remap(nz, -0.15, -0.55, 0.0, 1.0)
    under = b.math("MAXIMUM", b.math("MULTIPLY", down, 0.85), b.math("MULTIPLY", low, b.remap(nz, 0.3, -0.2)))
    col = b.mix(b.math("MULTIPLY", under, 0.8), col, "#5b5f9c")
    col = b.mix(b.math("MULTIPLY", b.math("MULTIPLY", low, b.remap(nz, -0.1, -0.8)), 0.35), col, "#c98aa8")
    # Silver lining: silhouettes on the true sun's side burn gold (crisp, slightly over white so bloom finds it).
    sd = sun_dir()
    lw = b.node("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.35
    sil = b.remap(lw.outputs["Facing"], 0.50, 0.58, 0.0, 1.0)
    sunside = b.remap(b.vmath("DOT_PRODUCT", n, (sd.x, sd.y, sd.z)), 0.02, 0.12, 0.0, 1.0)
    rim = b.math("MULTIPLY", sil, sunside)
    rim = b.math("MULTIPLY", rim, b.math("SUBTRACT", 1.0, b.math("MULTIPLY", under, 0.8)))
    col = b.mix(rim, col, "#fff0c6")
    # Sun-bleached edge: the silhouettes of the lit side burn out to near white, a crisp line inside the outline.
    bleach = b.math("MULTIPLY", b.remap(lw.outputs["Facing"], 0.44, 0.52, 0.0, 1.0), b.math("GREATER_THAN", light, 0.56))
    bleach = b.math("MULTIPLY", bleach, b.math("SUBTRACT", 1.0, under))
    col = b.mix(bleach, col, "#fffaf0")
    rim = b.math("MAXIMUM", rim, b.math("MULTIPLY", bleach, 0.6))
    # Aerial depth: farther clouds take on the horizon's haze (per object).
    attr_hz = b.node("ShaderNodeAttribute", attribute_type="OBJECT", attribute_name="cw_haze")
    col = b.mix(attr_hz.outputs["Fac"], col, "#e9b0a8")
    strength = b.math("ADD", 1.0, b.math("MULTIPLY", rim, 0.35))
    b.output(b.emit(col, strength))
    m["cw_cloud"] = 1
    return m


# ---------------------------------------------------------------------------------------------------------------- cloud forms

class Billows:
    """Spheres (centre in a local frame u right / v away from the lookout / w up, radius, z squash) for one cloud."""

    def __init__(self, seed):
        self.r = rng(seed)
        self.s = []

    def add(self, u, v, w, rad, squash=1.0):
        self.s.append((u, v, w, rad, squash))
        return (u, v, w, rad, squash)

    def sprout(self, parent, count, lo, hi, reach=0.82, up=0.55, side=None):
        """Smaller billows on the outer and upper surface of `parent` (cauliflower)."""
        r = self.r
        u, v, w, rad, sq = parent
        out = []
        for _ in range(count):
            a = r.uniform(0, 2 * math.pi) if side is None else side + r.uniform(-1.1, 1.1)
            el = r.uniform(-0.15, 1.25) * up + (1 - up) * r.uniform(-0.2, 0.6)
            d = Vector((math.cos(a) * math.cos(el), math.sin(a) * math.cos(el), math.sin(el)))
            rr = rad * r.uniform(lo, hi)
            out.append(self.add(u + d.x * rad * reach, v + d.y * rad * reach, w + d.z * rad * reach * sq, rr, sq))
        return out


def _head(B, u, v, w, R, crowns=5, fine=2, up=0.85, squash=1.0):
    """One cauliflower head: a big dome, a ring of crowns on its upper face (half to two-thirds its size) and, on the
    crowns that face up, a few fine billows. The sizes step down by about half at each level, so the eye reads a few big
    masses carrying smaller lumps (a uniform field of similar billows reads as scales)."""
    r = B.r
    p = B.add(u, v, w, R, squash)
    for c in B.sprout(p, crowns, 0.5, 0.68, reach=0.8, up=up):
        if fine and (c[2] - w) > 0.25 * R:
            B.sprout(c, fine, 0.42, 0.55, reach=0.82, up=0.95)
    return p


def cumulonimbus(seed, W, H, lean=-0.10, anvil_shift=-0.55):
    """A towering cumulonimbus rising from the horizon haze: a broad base of congestus heads, a massive column of stacked
    cauliflower heads narrowing upward, flaring into a flat-topped anvil that spreads downwind (the lookout's left) with an
    overshooting dome above it. Sizes in metres; w = 0 is the cloud base."""
    B = Billows(seed)
    r = B.r
    # Base: a wide flat shelf just above the horizon, its lobes long and squashed.
    for k in range(9):
        t = k / 8 - 0.5
        B.add(t * W * 1.35 + r.uniform(-20, 20), r.uniform(-0.15, 0.1) * W, 0.04 * H, W * r.uniform(0.16, 0.21), 0.4)
    # Lower body: congestus heads of different heights side by side, the middle ones tallest, a few stepping toward the
    # lookout so the mass has depth.
    for (ou, ov, top, rr) in ((-0.62, 0.12, 0.13, 0.17), (-0.40, 0.02, 0.22, 0.21), (-0.16, 0.04, 0.30, 0.25),
                              (0.12, -0.16, 0.27, 0.24), (0.36, 0.0, 0.20, 0.21), (0.58, -0.08, 0.12, 0.16)):
        _head(B, ou * W, ov * W, top * H, rr * W * r.uniform(0.92, 1.08), crowns=5, fine=1)
    # Column: stacked heads, each a little off the axis, narrowing upward and leaning downwind.
    levels = 7
    for k in range(levels):
        t = k / (levels - 1)
        w = H * (0.36 + 0.42 * t)
        rad = W * (0.30 - 0.09 * t)
        uc = lean * H * t
        B.add(uc, 0.08 * W, w - 0.04 * H, rad * 1.05)  # the core, behind the heads
        side = 1 if k % 2 else -1
        _head(B, uc + side * rad * 0.42, -rad * 0.3, w, rad * r.uniform(0.74, 0.84), crowns=5, fine=2)
        if k % 2 == 0:
            _head(B, uc - side * rad * 0.55, rad * 0.05, w - 0.03 * H, rad * 0.62, crowns=4, fine=1)
    # Turrets: towers growing out of the sunlit shoulder (right) and one on the left.
    for (side_u, t0, t1, frac) in ((1.0, 0.30, 0.60, 0.44), (-1.0, 0.40, 0.58, 0.38)):
        R0 = W * (0.30 - 0.09 * t0)
        base_u = lean * H * t0 + side_u * R0 * 0.95
        for s in range(3):
            f = s / 2
            w = H * (0.36 + 0.42 * (t0 + (t1 - t0) * f))
            _head(B, base_u + side_u * 0.02 * W * f, -0.12 * W, w, R0 * frac * (1.0 - 0.25 * f), crowns=4, fine=2 if s == 2 else 1)
    # The flare under the anvil: the column widens where it meets the shelf above.
    top_u = lean * H
    for k in range(5):
        f = k / 4 * 0.75 - 0.6  # toward the downwind side only: an upwind flare reads as a hat brim
        B.add(top_u + f * W * 0.7, r.uniform(-0.1, 0.1) * W, H * 0.80, W * 0.2, 0.6)
    # Anvil: a flat top (all lobes share one ceiling), thick and soft over the column, thinning to a long downwind tip and a
    # short upwind edge.
    ceil = H * 0.93
    cx = top_u + anvil_shift * W
    for k in range(13):
        f = k / 12  # 0 = the upwind edge (right), 1 = the downwind tip (left)
        uu = top_u + 0.08 * W - f * (0.08 * W - (cx - 1.0 * W))
        rad = W * (0.34 - 0.17 * f) * r.uniform(0.92, 1.08)
        sq = 0.30 - 0.17 * f
        B.add(uu + r.uniform(-0.04, 0.04) * W, r.uniform(0.0, 0.08) * W, ceil - rad * sq, rad, sq)
    # The overshooting top: a dome punching through the anvil over the column.
    _head(B, top_u + 0.06 * W, 0.0, H * 0.92, W * 0.16, crowns=5, fine=2)
    return B


def cumulus(seed, W, H, domes=5, flat=True, turret=0.0):
    """A cumulus mass: a flat base, a row of domes with cauliflower crowns."""
    B = Billows(seed)
    r = B.r
    if flat:
        nb = max(3, int(W / (H * 0.55)))
        for k in range(nb):
            t = (k + 0.5) / nb - 0.5
            B.add(t * W * 0.95, r.uniform(-0.1, 0.1) * W, H * 0.12, H * r.uniform(0.28, 0.36), 0.45)
    for k in range(domes):
        t = (k + 0.5) / domes - 0.5
        hump = 1.0 - (2 * abs(t)) ** 1.6
        rad = H * (0.26 + 0.2 * hump) * r.uniform(0.85, 1.15)
        p = B.add(t * W * 0.85 + r.uniform(-0.05, 0.05) * W, r.uniform(-0.12, 0.12) * W, H * (0.22 + 0.32 * hump), rad)
        for c in B.sprout(p, 3, 0.5, 0.66, up=0.85):
            if c[2] > p[2]:
                B.sprout(c, 1, 0.45, 0.55, up=0.95)
    if turret > 0:
        u0 = r.uniform(-0.2, 0.2) * W
        for s in range(4):
            f = s / 3
            p = B.add(u0, 0, H * (0.4 + turret * f), H * (0.34 - 0.08 * f))
            B.sprout(p, 3, 0.4, 0.6, up=0.85)
    return B


def place(az_deg, dist, alt):
    a = math.radians(az_deg)
    return (EYE.x + math.sin(a) * dist, EYE.y + math.cos(a) * dist, alt)


def _cull_hidden(spheres):
    """Drop spheres that sit wholly inside a bigger one (they cost triangles and add nothing)."""
    keep = []
    order = sorted(spheres, key=lambda s: -s[3] * min(1.0, s[4]))
    for s in order:
        u, v, w, rad, sq = s
        inside = False
        for (u2, v2, w2, r2, sq2) in keep:
            if sq2 < 0.99 or sq < 0.99:
                continue
            if math.sqrt((u - u2) ** 2 + (v - v2) ** 2 + (w - w2) ** 2) + rad < r2 * 0.98:
                inside = True
                break
        if not inside:
            keep.append(s)
    return keep


def _field_normals(V, centres, radii, squash, widen=1.7, chunk=8000):
    """Outward normals of a smooth blobby field (a Gaussian per billow, wider than the billow): the big form the billows
    belong to. Shading with these (blended with each billow's own normal) makes the light fall across the whole mass, with
    the terminator wobbling over the lumps, instead of every sphere carrying its own."""
    import numpy as np
    C = np.asarray(centres, np.float32)
    S = (np.asarray(radii, np.float32) * widen) ** 2
    Q = np.asarray(squash, np.float32)
    out = np.empty_like(V)
    for i in range(0, len(V), chunk):
        D = V[i:i + chunk, None, :] - C[None]
        D[..., 2] /= Q[None]
        w = np.exp(-np.sum(D * D, axis=2) / S[None]) / S[None]
        D[..., 2] /= Q[None]  # the gradient of an ellipsoidal Gaussian: z divided by the squash twice
        g = np.einsum("nm,nmk->nk", w, D)
        out[i:i + chunk] = g
    n = np.linalg.norm(out, axis=1, keepdims=True)
    return out / np.maximum(n, 1e-9)


def realize(name, billows, az_deg, dist, base_alt, haze=0.0, form=0.62):
    """Billows -> one mesh in the world, its local frame facing the lookout (u right, v away). `form` is how much of the
    shading normal comes from the big form (the rest from each billow)."""
    import numpy as np
    a = math.radians(az_deg)
    f = Vector((math.sin(a), math.cos(a), 0.0))
    rgt = Vector((math.cos(a), -math.sin(a), 0.0))
    cx, cy, cz = place(az_deg, dist, base_alt)
    spheres = _cull_hidden(billows.s)
    hmax = max(w + rad * sq for (u, v, w, rad, sq) in spheres)
    verts, nrm, faces = [], [], []
    centres, radii, sqs = [], [], []
    for (u, v, w, rad, sq) in spheres:
        sub = 3 if rad > 0.05 * hmax else 2
        tv, tf = _ico_template(sub)
        c = Vector((cx, cy, cz)) + rgt * u + f * v + Vector((0, 0, w))
        base = len(verts)
        for p in tv:
            verts.append((c.x + p.x * rad, c.y + p.y * rad, c.z + p.z * rad * sq))
            nn = Vector((p.x, p.y, p.z / max(sq, 1e-3))).normalized()
            nrm.append((nn.x, nn.y, nn.z))
        faces += [tuple(base + i for i in fc) for fc in tf]
        centres.append((c.x, c.y, c.z))
        radii.append(rad)
        sqs.append(sq)
    V = np.asarray(verts, np.float32)
    Ns = np.asarray(nrm, np.float32)
    # Light in four scales: the whole mass (a wide field), the heads (a narrower one), the billows softened where they meet
    # (a tight field) and each billow's own sphere. The big two give the light and the terminator; the small two add only
    # detail, and that detail brightens far more than it darkens and only on the lit side: with every sphere drawing its
    # own lit cap and dark crescent everywhere, the column was tiled like fish scales. Shadow sides stay broad lavender
    # shapes, the lit side reads as cauliflower crowns in the two light bands, as painted.
    def unit(n):
        return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
    lf = cloud_light_dir()
    L = np.array([lf.x, lf.y, lf.z], np.float32)

    def shade(n):
        return (n @ L) * 0.78 + n[:, 2] * 0.14 + 0.12
    Nl = _field_normals(V, centres, radii, sqs, widen=3.2)
    Nm = _field_normals(V, centres, radii, sqs, widen=1.7)
    Nt = _field_normals(V, centres, radii, sqs, widen=1.0)
    base = shade(Nl) * 0.5 + shade(Nm) * 0.5
    up = (shade(Nt) - base) * 0.8 + (shade(Ns) - base) * 0.2
    down = np.minimum(shade(Nt) - base, 0.0)  # creases between heads only, never between the small billows
    lit = np.clip((base - 0.3) / 0.35, 0.0, 1.0)
    lit = lit * lit * (3 - 2 * lit)
    k = 1 - form
    crown = np.clip((Nt[:, 2] + 0.15) / 0.55, 0.0, 1.0)  # highlights gather on the tops of the billows
    lv = base + np.maximum(up, 0.0) * k * (0.4 + 1.4 * lit) * crown + down * k * (0.3 + 1.3 * lit)
    # The flat base stays in shadow, whatever the field says about its lobes.
    low = np.clip(((V[:, 2] - cz) / hmax - 0.1) / 0.1, 0.0, 1.0)
    lv = np.minimum(lv, 0.36 + low * 2.0)
    Nb = unit(unit(Nl + Nm) * 0.75 + Nt * 0.25)
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    for p in me.polygons:
        p.use_smooth = True
    me.normals_split_custom_set_from_vertices([tuple(x) for x in Nb.tolist()])
    at = me.attributes.new("cw_light", "FLOAT", "POINT")
    at.data.foreach_set("value", lv.astype(np.float32))
    ob = bpy.data.objects.new(name, me)
    collection("sky").objects.link(ob)
    me.materials.append(_cloud_material())
    ob["cw_piece"] = "sky"
    ob["cw_cloud_az"] = az_deg
    ob["cw_base_z"] = cz
    ob["cw_height"] = hmax
    ob["cw_haze"] = haze
    ob.visible_shadow = False
    return ob


def build_clouds():
    obs = []
    # The hero: a towering cumulonimbus over the sea, left third of the opening view, lit from the right.
    obs.append(realize("cloud_tower", cumulonimbus(7, 620, 780), 170, 2400, 48, haze=0.0))
    # Satellites at several depths around it: nearer small cumulus, farther hazier ones.
    sats = [  # az, dist, alt, W, H, domes, haze, turret
        (190, 1300, 150, 150, 60, 4, 0.0, 0.0),
        (152, 1600, 190, 180, 70, 5, 0.06, 0.0),
        (198, 1800, 360, 90, 35, 3, 0.08, 0.0),
        (140, 2000, 110, 300, 140, 5, 0.12, 0.7),
        (202, 2300, 70, 340, 130, 6, 0.2, 0.0),
        (128, 2400, 70, 380, 160, 6, 0.22, 0.0),
    ]
    for i, (az, d, alt, w, h, domes, hz, tur) in enumerate(sats):
        obs.append(realize(f"cloud_sat{i}", cumulus(200 + i, w, h, domes=domes, turret=tur), az, d, alt, haze=hz))
    # The horizon bank: low broken cumulus from east to west, hazier with distance (keeps the sun's azimuth open).
    r = rng(5)
    for i, az in enumerate([96, 106, 117, 128, 140, 152, 190, 232, 243, 256, 268, 281, 294]):
        d = 2350 + r.uniform(-100, 150)
        w = r.uniform(240, 420)
        h = r.uniform(80, 150)
        obs.append(realize(f"cloud_bank{i}", cumulus(100 + i, w, h, domes=r.randint(4, 7), turret=r.choice((0, 0, 0.5))), az, d, r.uniform(20, 45), haze=0.25))
    # Behind the town (north and east): sunlit cumulus over the hills, seen from the stair and the harbour.
    for i, (az, d, alt, w, h, tur) in enumerate([(5, 1900, 120, 520, 260, 1.4), (40, 2000, 90, 420, 220, 0.8), (330, 2050, 140, 380, 200, 0.6), (70, 2100, 70, 300, 140, 0.0), (300, 2100, 100, 260, 130, 0.0)]):
        obs.append(realize(f"cloud_north{i}", cumulus(300 + i, w, h, domes=6, turret=tur), az, d, alt, haze=0.12))
    return obs


def build_light():
    sd = sun_dir()
    ld = bpy.data.lights.new("sun", "SUN")
    ld.energy = 8.0
    ld.color = srgb("#ffc48a")[:3]
    ld.angle = math.radians(0.6)
    ob = bpy.data.objects.new("sun", ld)
    collection("lights").objects.link(ob)
    ob.rotation_mode = "QUATERNION"
    ob.rotation_quaternion = (-sd).to_track_quat("-Z", "Y")
    ob["cw_piece"] = "light"
    w = bpy.context.scene.world or bpy.data.worlds.new("World")
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = srgb("#9a93c8")
    bg.inputs["Strength"].default_value = 0.22
    return ob


def build():
    build_dome()
    build_light()
    build_clouds()
