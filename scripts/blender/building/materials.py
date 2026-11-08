"""The building kit's materials: one library per build, a material per role (wall, trim, tile, glass, ...), in one of two
styles.

- `anime`: the painted toon materials of Cloudwatch Harbour (`cloudwatch/common.toon_material`: the diffuse light through
  the shared toon ramp times a painted albedo, brush strokes, haze), so a kit building sits in that world's look and its
  bake (`bake_export.py` reads the ALBEDO node).
- `realistic`: Principled BSDF (PBR) with a noise-broken albedo and per-role roughness and metalness.

Wear is the same in both: every material's albedo is darkened by the mesh attribute `bk_grime` (0..1, written by the kit
on the wall foot, the streaks under sills and the soot under eaves) times a streaky noise, and roof tiles mix toward moss
by `bk_moss`. The amount follows the brief's `wear` (0 new, 1 old). No image textures.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CW = os.path.join(HERE, "..", "cloudwatch")
if CW not in sys.path:
    sys.path.insert(0, CW)

import bpy  # noqa: E402

from common import srgb, toon_material  # noqa: E402

# Default colours per role (anime palette of the Cloudwatch town; the brief's palette overrides wall, wall2, trim, roof,
# accent).
ROLE_COLOURS = {
    "wall": "#efe2c8", "wall2": "#8a6448", "plinth": "#9d978c", "trim": "#ece6da", "fascia": "#ece6da",
    "tile": "#4a4d5c", "ridge": "#2b3044", "gutter": "#8b8d96", "pipe": "#a9abb3", "metal": "#7d808a", "rail": "#e2ded6",
    "glass": "#3b4f7a", "glass_lit": "#ffcf7a", "sheen": "#7f98c4", "curtain": "#e9dcc4", "curtain2": "#b9cbe0",
    "sash": "#b4b6bd", "door": "#8a5a3c", "frost": "#c9ced6", "shutter": "#b7b8be", "shutter_box": "#a9abb3",
    "amado": "#c3bdb0", "grille": "#4a4650", "blind": "#c9ad7a", "slab": "#c9c4ba", "panel": "#c9ced6",
    "ac": "#e8e5dc", "ac_fan": "#56545c", "duct": "#d8d0bc", "meter": "#c8c8c2", "meter_face": "#e9efe8",
    "wire": "#2f2a35", "sign": "#2f5d8a", "ink": "#fff4dc", "pot": "#b5653e", "pot2": "#dfe3e6", "leaf": "#4f8a4a",
    "leaf2": "#7aa04e", "soil": "#5a4636", "stone": "#b9b4ab", "lamp": "#ffd59a", "crease": "#3a3046",
    "awning": "#c8483c", "noren": "#2f4d7a", "deck": "#a6a29b", "concrete": "#c4bfb6", "moss": "#6f8a4a",
    "shop_glass": "#ffe2a8",
}
EMISSIVE = {"glass_lit": 2.2, "lamp": 3.0, "shop_glass": 2.4}
# Roles drawn with stripes (axis in object space, period m, line colour factor, width).
STRIPES = {
    "wall2": ("z", 0.21, 0.78, 0.16),         # clapboard / siding
    "shutter": ("z", 0.09, 0.78, 0.3),        # roll-up slats
    "blind": ("z", 0.06, 0.82, 0.3),
    "deck": ("x", 1.2, 0.9, 0.03),
    "awning": ("x", 0.6, None, 0.5),
    "amado": ("z", 0.3, 0.86, 0.05),
}
# Realistic: (roughness, metallic) per role.
PBR = {"glass": (0.05, 0.0), "glass_lit": (0.2, 0.0), "sheen": (0.05, 0.0), "metal": (0.45, 0.7), "gutter": (0.4, 0.6), "pipe": (0.4, 0.5),
       "sash": (0.35, 0.8), "rail": (0.4, 0.6), "shutter": (0.45, 0.7), "shutter_box": (0.45, 0.6), "ac_fan": (0.5, 0.4),
       "tile": (0.55, 0.0), "ridge": (0.5, 0.0), "grille": (0.4, 0.7), "wire": (0.6, 0.0), "meter": (0.4, 0.3)}


def _darker(hexstr, f):
    h = hexstr.lstrip("#")
    return "#" + "".join(f"{max(0, min(255, int(int(h[i:i + 2], 16) * f))):02x}" for i in (0, 2, 4))


def _wear_nodes(m, wear, moss=False):
    """Darken the albedo (before the ALBEDO reroute) by attribute `bk_grime` x streak noise x wear; mix toward moss by
    `bk_moss` x patch noise x wear on roofs."""
    if wear <= 0.01 or m.get("bk_wear") is not None:
        return
    nt = m.node_tree
    alb = nt.nodes.get("ALBEDO")
    if alb is None or not alb.inputs[0].links:
        return
    src = alb.inputs[0].links[0].from_socket
    attr = nt.nodes.new("ShaderNodeAttribute")
    attr.attribute_name = "bk_grime"
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (6.0, 6.0, 0.6)  # long vertical streaks
    nt.links.new(geo.outputs["Position"], mp.inputs[0])
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 3.0
    nz.inputs["Detail"].default_value = 3.0
    nt.links.new(mp.outputs[0], nz.inputs["Vector"])
    st = nt.nodes.new("ShaderNodeMapRange")
    st.inputs["From Min"].default_value = 0.3
    st.inputs["From Max"].default_value = 0.7
    st.inputs["To Min"].default_value = 0.45
    nt.links.new(nz.outputs["Fac"], st.inputs["Value"])
    mul = nt.nodes.new("ShaderNodeMath")
    mul.operation = "MULTIPLY"
    nt.links.new(attr.outputs["Fac"], mul.inputs[0])
    nt.links.new(st.outputs["Result"], mul.inputs[1])
    k = nt.nodes.new("ShaderNodeMath")
    k.operation = "MULTIPLY"
    k.use_clamp = True
    k.inputs[1].default_value = 0.42 * wear
    nt.links.new(mul.outputs[0], k.inputs[0])
    dark = nt.nodes.new("ShaderNodeMix")
    dark.data_type = "RGBA"
    dark.blend_type = "MULTIPLY"
    nt.links.new(k.outputs[0], dark.inputs["Factor"])
    nt.links.new(src, dark.inputs[6])
    dark.inputs[7].default_value = srgb("#5b5262")  # grime is a cool, violet-grey dark (the painted shadow family)
    out = dark.outputs[2]
    if moss:
        am = nt.nodes.new("ShaderNodeAttribute")
        am.attribute_name = "bk_moss"
        n2 = nt.nodes.new("ShaderNodeTexNoise")
        n2.inputs["Scale"].default_value = 1.6
        n2.inputs["Detail"].default_value = 4.0
        n2.inputs["Roughness"].default_value = 0.65
        nt.links.new(geo.outputs["Position"], n2.inputs["Vector"])
        s2 = nt.nodes.new("ShaderNodeMapRange")
        s2.inputs["From Min"].default_value = 0.48
        s2.inputs["From Max"].default_value = 0.62
        nt.links.new(n2.outputs["Fac"], s2.inputs["Value"])
        m2 = nt.nodes.new("ShaderNodeMath")
        m2.operation = "MULTIPLY"
        nt.links.new(am.outputs["Fac"], m2.inputs[0])
        nt.links.new(s2.outputs["Result"], m2.inputs[1])
        k2 = nt.nodes.new("ShaderNodeMath")
        k2.operation = "MULTIPLY"
        k2.use_clamp = True
        k2.inputs[1].default_value = 0.85 * min(1.0, wear * 1.3)
        nt.links.new(m2.outputs[0], k2.inputs[0])
        mm = nt.nodes.new("ShaderNodeMix")
        mm.data_type = "RGBA"
        nt.links.new(k2.outputs[0], mm.inputs["Factor"])
        nt.links.new(out, mm.inputs[6])
        mm.inputs[7].default_value = srgb(ROLE_COLOURS["moss"])
        out = mm.outputs[2]
    nt.links.new(out, alb.inputs[0])
    m["bk_wear"] = wear


def pbr_material(name, base, role, var=None, emission=None, emission_strength=0.0, stripes=None):
    """A Principled material whose albedo goes through an ALBEDO reroute (so wear and bakes treat both styles alike)."""
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    rgb = nt.nodes.new("ShaderNodeRGB")
    rgb.outputs[0].default_value = srgb(base)
    sock = rgb.outputs[0]
    if var:
        tc = nt.nodes.new("ShaderNodeTexCoord")
        nz = nt.nodes.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = 2.5
        nz.inputs["Detail"].default_value = 6.0
        nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
        v = nt.nodes.new("ShaderNodeRGB")
        v.outputs[0].default_value = srgb(var)
        mx = nt.nodes.new("ShaderNodeMix")
        mx.data_type = "RGBA"
        nt.links.new(nz.outputs["Fac"], mx.inputs["Factor"])
        nt.links.new(sock, mx.inputs[6])
        nt.links.new(v.outputs[0], mx.inputs[7])
        sock = mx.outputs[2]
    if stripes:
        axis, period, col, width = stripes
        tc = nt.nodes.new("ShaderNodeTexCoord")
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(tc.outputs["Object"], sep.inputs[0])
        dv = nt.nodes.new("ShaderNodeMath")
        dv.operation = "DIVIDE"
        dv.inputs[1].default_value = period
        nt.links.new(sep.outputs[{"x": 0, "y": 1, "z": 2}[axis]], dv.inputs[0])
        fr = nt.nodes.new("ShaderNodeMath")
        fr.operation = "FRACT"
        nt.links.new(dv.outputs[0], fr.inputs[0])
        lt = nt.nodes.new("ShaderNodeMath")
        lt.operation = "LESS_THAN"
        lt.inputs[1].default_value = width
        nt.links.new(fr.outputs[0], lt.inputs[0])
        lc = nt.nodes.new("ShaderNodeRGB")
        lc.outputs[0].default_value = srgb(col)
        mx = nt.nodes.new("ShaderNodeMix")
        mx.data_type = "RGBA"
        nt.links.new(lt.outputs[0], mx.inputs["Factor"])
        nt.links.new(sock, mx.inputs[6])
        nt.links.new(lc.outputs[0], mx.inputs[7])
        sock = mx.outputs[2]
    alb = nt.nodes.new("NodeReroute")
    alb.name = "ALBEDO"
    alb.label = "ALBEDO"
    nt.links.new(sock, alb.inputs[0])
    nt.links.new(alb.outputs[0], bsdf.inputs["Base Color"])
    rough, metal = PBR.get(role, (0.75, 0.0))
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emission:
        bsdf.inputs["Emission Color"].default_value = srgb(emission)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
        m["cw_emissive"] = emission
        m["cw_emissive_strength"] = emission_strength
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    m["cw_base"] = base
    return m


class Library:
    """Materials of one build, by role. `register(material) -> slot index` puts a material into the caller's slot list
    (the town shares one list over all its houses); by default the library keeps its own."""

    def __init__(self, style="anime", palette=None, wear=0.4, prefix="bk", register=None):
        self.style = style
        self.wear = float(wear)
        self.prefix = prefix
        self.colours = dict(ROLE_COLOURS)
        for k, v in (palette or {}).items():
            if isinstance(v, str) and v.startswith("#") and len(v) == 7:
                self.colours[k] = v
        if "roof" in (palette or {}):
            self.colours["tile"] = palette["roof"]
        if "accent" in (palette or {}):
            self.colours["sign"] = palette["accent"]
            self.colours["awning"] = palette["accent"]
        if "trim" in (palette or {}):
            self.colours["fascia"] = palette["trim"]
        self.mats = []
        self._idx = {}
        self._register = register

    def _slot(self, m):
        if self._register is not None:
            return self._register(m)
        if m.name not in self._idx:
            self._idx[m.name] = len(self.mats)
            self.mats.append(m)
        return self._idx[m.name]

    def slot(self, m):
        """The slot of a material made elsewhere (a sign's decal)."""
        return self._slot(m)

    def colour(self, role):
        return self.colours.get(role, "#ff00ff")

    def __call__(self, role, axis=None):
        """The slot of a role's material. `axis` ('x'/'y') picks the tile rows' direction on a roof slope."""
        c = self.colour(role)
        key = f"{self.prefix}_{self.style[0]}_{role}_{c[1:]}" + (f"_{axis}" if axis else "") + f"_w{int(self.wear * 10)}"
        m = bpy.data.materials.get(key)
        if m is None:
            m = self._make(key, role, c, axis)
        return self._slot(m)

    def _make(self, key, role, c, axis):
        em = EMISSIVE.get(role)
        stripes = None
        if role in STRIPES:
            ax, period, f, width = STRIPES[role]
            line = self.colours["ink"] if role == "awning" else _darker(c, f)
            if role == "awning":
                line = "#f1ead9"
            stripes = (ax, period, line, width)
        if role == "tile":
            # Tile rows: a dark line between courses (z) and the joints across them (along the slope's other axis).
            stripes = ("z", 0.2, _darker(c, 0.8), 0.22)
        var = None
        if role in ("wall", "wall2", "plinth", "slab", "concrete", "tile", "stone", "deck", "leaf", "leaf2"):
            var = _darker(c, 0.93 if role != "tile" else 1.08)
        if self.style == "realistic":
            m = pbr_material(key, c, role, var=var, emission=c if em else None, emission_strength=em or 0.0, stripes=stripes)
        else:
            m = toon_material(key, c, var=var, noise_scale=0.5 if role.startswith("wall") else 0.25 if role == "tile" else 1.5,
                              emission=c if em else None, emission_strength=em or 0.0, stripes=stripes)
            if role == "tile" and axis:
                _joint_stripe(m, axis, 0.42, _darker(c, 0.62), 0.2)
        if not em:
            _wear_nodes(m, self.wear, moss=role in ("tile", "ridge"))
        m["bk_role"] = role
        return m


def _joint_stripe(m, axis, period, col, width):
    """Mix a second stripe set (object coordinates, the tile joints) into a painted albedo, before ALBEDO."""
    nt = m.node_tree
    alb = nt.nodes["ALBEDO"]
    src = alb.inputs[0].links[0].from_socket
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Object"], sep.inputs[0])
    dv = nt.nodes.new("ShaderNodeMath")
    dv.operation = "DIVIDE"
    dv.inputs[1].default_value = period
    nt.links.new(sep.outputs[{"x": 0, "y": 1}[axis]], dv.inputs[0])
    fr = nt.nodes.new("ShaderNodeMath")
    fr.operation = "FRACT"
    nt.links.new(dv.outputs[0], fr.inputs[0])
    lt = nt.nodes.new("ShaderNodeMath")
    lt.operation = "LESS_THAN"
    lt.inputs[1].default_value = width
    nt.links.new(fr.outputs[0], lt.inputs[0])
    rgb = nt.nodes.new("ShaderNodeRGB")
    rgb.outputs[0].default_value = srgb(col)
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    nt.links.new(lt.outputs[0], mix.inputs["Factor"])
    nt.links.new(src, mix.inputs[6])
    nt.links.new(rgb.outputs[0], mix.inputs[7])
    nt.links.new(mix.outputs[2], alb.inputs[0])
