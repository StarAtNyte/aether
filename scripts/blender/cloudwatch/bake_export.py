"""Bake Cloudwatch Harbour's look into web-sized glb pieces.

  blender -b <out>/cloudwatch.blend -P scripts/blender/cloudwatch/bake_export.py -- --out <dir> [--samples 96] [--only town,props]
        [--scale 1.0] [--cpu]

For each atlas piece the objects are joined, unwrapped into one atlas and baked in Cycles twice: the diffuse light
(direct + indirect, no colour) and the painted albedo. NumPy runs the same toon ramp the EEVEE materials use on the light,
multiplies the albedo and writes one colour texture; the piece draws unlit (KHR_materials_unlit), so the browser shows the
painted look whatever its own lighting does. Foliage bakes into vertex colours the same way; clouds are shaded per vertex
in Python (their rim light depends on the view, which is the same from anywhere in the town at 1.5 km). Emissive surfaces
keep an emissive material (KHR_materials_emissive_strength) so bloom finds them. Outlines are applied as geometry.

Writes <out>/<piece>.glb and <out>/pieces.json (bounds in glTF coordinates, triangles, bytes).
"""
import argparse
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

from common import P, RAMP, srgb  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("--samples", type=int, default=96)
ap.add_argument("--only", default="")
ap.add_argument("--gpu", action="store_true", help="bake on the GPU (a busy shared GPU can return black bakes)")
ap.add_argument("--tex-scale", type=float, default=1.0)
A = ap.parse_args(argv)
os.makedirs(A.out, exist_ok=True)
ONLY = set(A.only.split(",")) if A.only else None

# Distances of the sky pieces in the browser: the dome and clouds are scaled about the lookout so the camera's far plane
# keeps them (angles from the town are unchanged).
SKY_SCALE = 0.58
# The near terrain's box (Blender x, y): the cove the town fills, from the quay to the lookout.
NEAR_X = 100.0
NEAR_Y = (-36.0, 146.0)
# Cloud impostor cards: their distance from the lookout in the browser (inside the dome, beyond the sea's far ring).
CARD_DIST = 1250.0

PIECES = {
    # The terrain in two atlases: the town's cove (seen at a few metres from the streets) gets a 4096 px texture to itself;
    # with one 2048 px atlas for the whole hillside a texel was 0.19 m, and the bank by the crossing showed the bake's light
    # (wire and pole shadows, sampling noise) as a blurred diagonal smear.
    "terrain": {"match": lambda n: n in ("terrain", "roads", "road_lines"), "tex": 4096, "dissolve": 1.5,
                "keep": lambda x, y: abs(x) < NEAR_X and NEAR_Y[0] < y < NEAR_Y[1]},
    "terrain_far": {"match": lambda n: n == "terrain", "tex": 2048, "dissolve": 1.5,
                    "keep": lambda x, y: not (abs(x) < NEAR_X and NEAR_Y[0] < y < NEAR_Y[1])},
    "town": {"match": lambda n: n.startswith("house_") or n in ("shop", "block_walls"), "tex": 4096},
    # The shrine on its own small atlas: in the dense town atlas the gate's round posts were thinner than a texel and
    # baked to nothing (black).
    "shrine": {"match": lambda n: n in ("shrine_hall", "shrine_gate"), "tex": 1024},
    "infra": {"match": lambda n: n in ("stair", "lookout", "harbour", "lighthouse", "railway", "crossing", "poles_wires") or n.startswith("tunnel_portal"), "tex": 2048},
    "props": {"match": lambda n: n.startswith(("stone_lantern", "stair_lantern", "vending", "bicycle", "laundry", "sign_", "boat_")) or n in ("pots", "ac_units", "mailbox", "roof_gear"), "tex": 2048},
    "people": {"match": lambda n: n.startswith("person_"), "tex": 1024},
}
VERTEX_PIECES = {
    "trees": {"match": lambda n: n in ("trees_town", "hedges")},
}


# ---------------------------------------------------------------------------------------------------------------- setup

def setup_cycles():
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = A.samples
    sc.cycles.use_denoising = False
    sc.render.bake.margin = 6
    sc.render.bake.use_clear = True
    if A.gpu:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        try:
            prefs.compute_device_type = "OPTIX"
            prefs.get_devices()
            for d in prefs.devices:
                d.use = d.type == "OPTIX"
            sc.cycles.device = "GPU"
        except Exception:  # noqa: BLE001
            sc.cycles.device = "CPU"
    else:
        sc.cycles.device = "CPU"
    # Emissive sky pieces must not light the scene in the bake (in EEVEE they do not either): only the sun and the world.
    for ob in bpy.data.objects:
        if ob.get("cw_piece") in ("sky", "sea") or ob.name.startswith("cloud"):
            ob.visible_diffuse = False
            ob.visible_glossy = False
            ob.visible_transmission = False
            ob.visible_volume_scatter = False
            ob.visible_shadow = False


def ramp_np(light):
    """The toon ramp of common.RAMP on a light array (H, W) -> band multiplier (H, W, 3), in linear RGB."""
    r = RAMP
    sh = np.array(srgb(r["shadow"])[:3])
    mid = np.array(srgb(r["mid"])[:3])
    lit = np.array(srgb(r["lit"])[:3])
    a0, a1 = r["t_shadow"], r["t_shadow"] + r["w_shadow"]
    b0, b1 = r["t_lit"], r["t_lit"] + r["w_lit"]
    t1 = np.clip((light - a0) / (a1 - a0), 0, 1)[..., None]
    t2 = np.clip((light - b0) / (b1 - b0), 0, 1)[..., None]
    return sh * (1 - t1) + mid * t1 * (1 - t2) + lit * t2


def blur(img, k=2):
    """Box blur (separable, k px radius) on (H, W) or (H, W, C): takes the bake noise off before the ramp."""
    out = img.astype(np.float32)
    for axis in (0, 1):
        acc = np.zeros_like(out)
        for d in range(-k, k + 1):
            acc += np.roll(out, d, axis=axis)
        out = acc / (2 * k + 1)
    return out


def lum(rgb):
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


# ---------------------------------------------------------------------------------------------------------------- materials

def bake_variant(mat, image=None):
    """A copy of a toon material for Cycles: Diffuse(ALBEDO) (+ its emission), with the bake image as the active node."""
    m = mat.copy()
    m.name = mat.name + "__bake"
    nt = m.node_tree
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    alb = nt.nodes.get("ALBEDO")
    diff = nt.nodes.new("ShaderNodeBsdfDiffuse")
    if alb is not None:
        nt.links.new(alb.outputs[0], diff.inputs["Color"])
    else:
        diff.inputs["Color"].default_value = (0.5, 0.5, 0.5, 1)
    nt.links.new(diff.outputs[0], out.inputs[0])
    if image is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = image
        nt.nodes.active = tex
    return m


def write_png(path, rgb01):
    """Write an (H, W, 3) array in 0..1 (top row last, Blender's order) as an 8-bit PNG and load it as an image."""
    import struct
    import zlib
    h, w, _ = rgb01.shape
    px = (np.clip(rgb01[::-1], 0, 1) * 255 + 0.5).astype(np.uint8)
    raw = b"".join(b"\x00" + px[y].tobytes() for y in range(h))

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = "sRGB"
    return img


def unlit_texture_material(name, image, uv="bake"):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = image
    tex.interpolation = "Linear"
    uvn = nt.nodes.new("ShaderNodeUVMap")
    uvn.uv_map = uv
    nt.links.new(uvn.outputs[0], tex.inputs[0])
    nt.links.new(tex.outputs["Color"], out.inputs[0])
    return m


def unlit_color_material(name, hexcol=None, attribute=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    if attribute:
        a = nt.nodes.new("ShaderNodeVertexColor")
        a.layer_name = attribute
        nt.links.new(a.outputs["Color"], out.inputs[0])
    else:
        rgb = nt.nodes.new("ShaderNodeRGB")
        rgb.outputs[0].default_value = srgb(hexcol)
        nt.links.new(rgb.outputs[0], out.inputs[0])
    return m


_emit_cache = {}


def emissive_export_material(src):
    """A Principled material with a dark base and the source's emission (glTF emissive + emissive_strength)."""
    if src.name in _emit_cache:
        return _emit_cache[src.name]
    m = bpy.data.materials.new(src.name + "__emit")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.02, 0.02, 0.02, 1)
    bsdf.inputs["Emission Color"].default_value = srgb(src["cw_emissive"])
    bsdf.inputs["Emission Strength"].default_value = float(src.get("cw_emissive_strength", 2.0))
    bsdf.inputs["Roughness"].default_value = 1.0
    _emit_cache[src.name] = m
    return m


# ---------------------------------------------------------------------------------------------------------------- geometry

def select_only(obs, active=None):
    bpy.ops.object.select_all(action="DESELECT")
    for o in obs:
        o.hide_set(False)
        o.hide_render = False
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or obs[0]


def joined_copy(obs, name, keep_outline=False):
    """Duplicate, apply modifiers (outlines off unless asked) and join into one mesh object."""
    copies = []
    dg = bpy.context.evaluated_depsgraph_get()
    for o in obs:
        if o.type != "MESH":
            continue
        for md in o.modifiers:
            if md.name == "outline":
                md.show_viewport = keep_outline
                md.show_render = keep_outline
    dg = bpy.context.evaluated_depsgraph_get()
    for o in obs:
        if o.type != "MESH":
            continue
        ev = o.evaluated_get(dg)
        me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
        c = bpy.data.objects.new(o.name + "__c", me)
        bpy.context.scene.collection.objects.link(c)
        c.matrix_world = o.matrix_world.copy()
        c["cw_outline"] = o.get("cw_outline", 0)
        copies.append(c)
    select_only(copies)
    bpy.ops.object.join()
    j = bpy.context.view_layer.objects.active
    j.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in obs:
        o.hide_render = True
        o.hide_set(True)
    return j


# Thin geometry (a pole, a barrier arm, a railing bar, a gutter) maps to UV islands under a texel wide in a dense atlas: no
# texel centre falls inside them, so the bake never writes them and they sample the cleared black or a neighbour's margin
# (they drew dark). Those islands are shaded per vertex instead (the same light and albedo bakes, to colour attributes)
# and their UVs collapsed onto one texel block of a palette band kept free at the top of the atlas. Few islands are that
# thin once the pack's margins are two texels.
PALETTE_ROWS = 32  # texels at the top of each atlas: 2 x 2 blocks, 16 rows of size/2 entries


def unwrap(ob, uv_name="bake", size=None):
    me = ob.data
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    me.uv_layers.new(name=uv_name)
    select_only([ob])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0005 if size else 0.003, area_weight=0.0, scale_to_bounds=False)
    if size:
        # Box packing with a two-texel margin. The default (concave shapes, a scaled margin) left the town's ~30k islands
        # as smart-project placed them: 0.8 % of the atlas covered, nearly every island under a texel wide (the walls and
        # roofs too, which then drew whatever the margin fill gave them). Boxes cover about 12 %, so walls and roofs get
        # real texels and only trims, poles and rails stay thin.
        bpy.ops.uv.pack_islands(shape_method="AABB", margin_method="FRACTION", margin=2.0 / size, rotate=True)
    else:
        bpy.ops.uv.pack_islands(margin=0.002, rotate=True)
    bpy.ops.object.mode_set(mode="OBJECT")
    if size:
        # Keep the palette band free: squeeze the packed atlas below it.
        keep = 1.0 - PALETTE_ROWS / size
        uv = np.empty(len(me.loops) * 2, np.float32)
        me.uv_layers[uv_name].data.foreach_get("uv", uv)
        uv[1::2] *= keep
        me.uv_layers[uv_name].data.foreach_set("uv", uv)


def thin_islands(ob, size, min_px=1.25, uv_name="bake"):
    """Islands whose narrow extent is under `min_px` texels: lists of loop indices."""
    from bpy_extras.bmesh_utils import bmesh_linked_uv_islands
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.index_update()
    uvl = bm.loops.layers.uv[uv_name]
    polys = ob.data.polygons
    out = []
    for faces in bmesh_linked_uv_islands(bm, uvl):
        loops = [lp for f in faces for lp in f.loops]
        uv = np.array([tuple(lp[uvl].uv) for lp in loops], np.float64)
        d = uv - uv.mean(axis=0)
        minor = np.linalg.eigh(d.T @ d)[1][:, 0]
        if float(np.ptp(d @ minor)) * size < min_px:
            # (A BMLoop's own index is not the mesh's loop index: take the loops from the mesh polygons.)
            out.append([li for f in faces for li in polys[f.index].loop_indices])
    bm.free()
    return out


def bake_vertex(ob, pass_filter, name):
    """Bake DIFFUSE with `pass_filter` into a float corner colour attribute; (n_loops, 3) linear RGB."""
    me = ob.data
    at = me.color_attributes.new(name, "FLOAT_COLOR", "CORNER")
    me.color_attributes.active_color = at
    run_bake(ob, "DIFFUSE", pass_filter, target="VERTEX_COLORS")
    a = np.empty(len(me.loops) * 4, np.float32)
    me.color_attributes[name].data.foreach_get("color", a)
    me.color_attributes.remove(me.color_attributes[name])
    return a.reshape(-1, 4)[:, :3]


def bake_image(name, size, float_buffer=True):
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=float_buffer)
    img.colorspace_settings.name = "Non-Color" if float_buffer else "sRGB"
    return img


def run_bake(ob, kind, pass_filter, target="IMAGE_TEXTURES"):
    select_only([ob])
    bpy.ops.object.bake(type=kind, pass_filter=pass_filter, target=target, margin=6, use_clear=True)


def image_np(img):
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)


def outline_after(ob, width_of):
    """Re-add the inverted-hull outline to the faces of objects that had one and apply it (as geometry)."""
    from common import line_material
    line = line_material()
    line_exp = unlit_color_material("line_unlit", P["line"])
    line_exp.use_backface_culling = True
    me = ob.data
    me.materials.append(line_exp)
    mod = ob.modifiers.new("outline", "SOLIDIFY")
    mod.thickness = width_of
    mod.offset = 1.0
    mod.use_flip_normals = True
    mod.use_rim = False
    mod.material_offset = len(me.materials) - 1
    vg = ob.vertex_groups.get("cw_outline")
    if vg is not None:
        mod.vertex_group = vg.name
    select_only([ob])
    bpy.ops.object.modifier_apply(modifier=mod.name)


# ---------------------------------------------------------------------------------------------------------------- atlas pieces

def atlas_piece(key, spec):
    obs = [o for o in bpy.data.objects if o.type == "MESH" and spec["match"](o.name) and not o.name.endswith("__c")]
    if not obs:
        return None
    outlined = {o.name for o in obs if o.get("cw_outline")}
    j = joined_copy(obs, f"piece_{key}")
    if spec.get("keep"):
        bm = bmesh.new()
        bm.from_mesh(j.data)
        drop = [f for f in bm.faces if not spec["keep"](*f.calc_center_median().xy)]
        bmesh.ops.delete(bm, geom=drop, context="FACES")
        bm.to_mesh(j.data)
        bm.free()
    if spec.get("dissolve"):
        # Flat terraces and gentle slopes need few triangles: merge faces within a small angle.
        md = j.modifiers.new("dissolve", "DECIMATE")
        md.decimate_type = "DISSOLVE"
        md.angle_limit = math.radians(spec["dissolve"])
        select_only([j])
        bpy.ops.object.modifier_apply(modifier=md.name)
        select_only([j])
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.quads_convert_to_tris(quad_method="BEAUTY", ngon_method="BEAUTY")
        bpy.ops.object.mode_set(mode="OBJECT")
    size = int(spec["tex"] * A.tex_scale)
    unwrap(j, size=size)
    thin = thin_islands(j, size)
    print(f"AETHER_UV {key} thin islands={len(thin)}", flush=True)
    light = bake_image(f"{key}_light", size)
    albedo = bake_image(f"{key}_albedo", size)
    srcs = list(j.data.materials)
    emissive_slots = {i for i, m in enumerate(srcs) if m and m.get("cw_emissive")}
    for i, m in enumerate(srcs):
        j.data.materials[i] = bake_variant(m, light)
    run_bake(j, "DIFFUSE", {"DIRECT", "INDIRECT"})
    for i, m in enumerate(srcs):
        j.data.materials[i] = bake_variant(m, albedo)
    run_bake(j, "DIFFUSE", {"COLOR"})
    L = image_np(light)[..., :3]
    Al = image_np(albedo)[..., :3]
    if thin:
        for i, m in enumerate(srcs):
            j.data.materials[i] = bake_variant(m)
        Lv = bake_vertex(j, {"DIRECT", "INDIRECT"}, "cw_light_v")
        Av = bake_vertex(j, {"COLOR"}, "cw_albedo_v")
    print(f"AETHER_STATS {key} light mean={float(np.nanmean(L)):.4f} max={float(np.nanmax(L)):.4f} albedo mean={float(np.nanmean(Al)):.4f} nan={int(np.isnan(L).sum())}", flush=True)
    Lb = blur(lum(L), 1)
    final = Al * ramp_np(Lb)
    if thin:
        # One colour per thin island (vertex light through the same ramp, times vertex albedo) in a 2 x 2 texel block of
        # the palette band, and the island's UVs on the block's centre.
        per = size // 2
        if len(thin) > per * (PALETTE_ROWS // 2):
            raise RuntimeError(f"{key}: {len(thin)} thin islands do not fit the palette")
        lv = lum(Lv)
        uv = np.empty(len(j.data.loops) * 2, np.float32)
        j.data.uv_layers["bake"].data.foreach_get("uv", uv)
        uv = uv.reshape(-1, 2)
        for n, loops in enumerate(thin):
            row = size - PALETTE_ROWS + 2 * (n // per)  # image rows are bottom-up, as are UVs
            col = 2 * (n % per)
            # The upper part of the island's corner light: corners where it meets other geometry are occluded.
            li = np.percentile(lv[loops], 70)
            final[row:row + 2, col:col + 2] = Av[loops].mean(axis=0) * ramp_np(np.array([li]))[0]
            uv[loops] = ((col + 1) / size, (row + 1) / size)
        j.data.uv_layers["bake"].data.foreach_set("uv", uv.reshape(-1))
    # Linear -> sRGB for an 8-bit texture.
    srgb_px = np.where(final <= 0.0031308, final * 12.92, 1.055 * np.power(np.clip(final, 0, None), 1 / 2.4) - 0.055)
    out = write_png(os.path.join(A.out, f"{key}.png"), np.clip(srgb_px, 0, 1))
    print(f"AETHER_STATS {key} final mean={float(final.mean()):.4f}", flush=True)
    baked = unlit_texture_material(f"baked_{key}", out)
    for i, m in enumerate(srcs):
        j.data.materials[i] = emissive_export_material(m) if i in emissive_slots else baked
    print(f"AETHER_BAKED {key} {size}px faces={len(j.data.polygons)}", flush=True)
    return j


# ---------------------------------------------------------------------------------------------------------------- vertex pieces

def vertex_piece(key, obs, decimate=None):
    j = joined_copy(obs, f"piece_{key}")
    if decimate:
        md = j.modifiers.new("dec", "DECIMATE")
        md.ratio = decimate
        select_only([j])
        bpy.ops.object.modifier_apply(modifier=md.name)
    me = j.data
    for a in list(me.color_attributes):
        me.color_attributes.remove(a)
    lca = me.color_attributes.new("cw_light", "FLOAT_COLOR", "POINT")
    me.color_attributes.active_color = lca
    srcs = list(me.materials)
    for i, m in enumerate(srcs):
        me.materials[i] = bake_variant(m)
    run_bake(j, "DIFFUSE", {"DIRECT", "INDIRECT"}, target="VERTEX_COLORS")
    light = np.empty(len(me.vertices) * 4, np.float32)
    me.color_attributes["cw_light"].data.foreach_get("color", light)
    aca = me.color_attributes.new("cw_albedo", "FLOAT_COLOR", "POINT")
    me.color_attributes.active_color = aca
    run_bake(j, "DIFFUSE", {"COLOR"}, target="VERTEX_COLORS")
    alb = np.empty(len(me.vertices) * 4, np.float32)
    me.color_attributes["cw_albedo"].data.foreach_get("color", alb)
    light = light.reshape(-1, 4)[:, :3]
    alb = alb.reshape(-1, 4)[:, :3]
    col = alb * ramp_np(lum(light))
    fin = me.color_attributes.new("cw_color", "BYTE_COLOR", "POINT")
    rgba = np.concatenate([col, np.ones((len(col), 1), np.float32)], axis=1)
    fin.data.foreach_set("color", rgba.astype(np.float32).ravel())
    me.color_attributes.remove(me.color_attributes["cw_light"])
    me.color_attributes.remove(me.color_attributes["cw_albedo"])
    me.color_attributes.active_color = me.color_attributes["cw_color"]
    mat = unlit_color_material(f"vc_{key}", attribute="cw_color")
    me.materials.clear()
    me.materials.append(mat)
    print(f"AETHER_BAKED {key} vertex faces={len(me.polygons)}", flush=True)
    return j


def forest_shell():
    """HLOD of the forest: the canopies voxel-remeshed into one lumpy shell, simplified, shaded per vertex."""
    src = bpy.data.objects.get("forest")
    if src is None:
        return None
    j = joined_copy([src], "forest_shell_src")
    md = j.modifiers.new("remesh", "REMESH")
    md.mode = "VOXEL"
    md.voxel_size = 1.1
    md.adaptivity = 0.0
    select_only([j])
    bpy.ops.object.modifier_apply(modifier=md.name)
    md = j.modifiers.new("dec", "DECIMATE")
    target = 50000
    md.ratio = min(1.0, target / max(1, len(j.data.polygons)))
    bpy.ops.object.modifier_apply(modifier=md.name)
    leaf = bpy.data.materials.get("leaf_b") or bpy.data.materials.get("leaf_a")
    j.data.materials.clear()
    j.data.materials.append(leaf)
    for p in j.data.polygons:
        p.use_smooth = True
    j.name = "forest_shell"
    j.hide_render = False
    return vertex_piece("forest", [j])


def clouds_piece():
    """The cloudscape as impostor cards. EEVEE renders the clouds alone from the lookout (transparent film, the sea held out
    so nothing below the horizon is kept) in eight 45-degree sectors; each render is cropped to its clouds and laid on a
    flat card that fills exactly that sector's frustum at CARD_DIST. From the lookout the cards are the Blender render pixel
    for pixel (crisp cel bands, rims, creases); elsewhere in the town (a few hundred metres off, the clouds 1-2 km away)
    the parallax is a few degrees. One unlit, alpha-blended texture per card."""
    from sky import EYE
    sc = bpy.context.scene
    keep_engine = sc.render.engine
    clouds = [o for o in bpy.data.objects if o.name.startswith("cloud") and o.type == "MESH" and not o.name.endswith("__c")]
    hidden = []
    for o in bpy.data.objects:
        if o.type in ("MESH", "CURVE", "META", "FONT") and o not in clouds and not o.hide_render:
            if o.name == "sea":
                o.is_holdout = True
                continue
            o.hide_render = True
            hidden.append(o)
    from shots import setup_render
    W = 2048
    half = math.radians(22.5)
    t = math.tan(half)
    lo, hi = -math.tan(math.radians(2.0)), math.tan(math.radians(32.0))
    H = int(round(W * (hi - lo) / (2 * t)))
    setup_render(W, H)
    sc.render.film_transparent = True
    sc.render.use_compositing = False
    sc.render.image_settings.color_mode = "RGBA"
    sc.eevee.taa_render_samples = 64
    cd = bpy.data.cameras.new("card_cam")
    cd.sensor_fit = "HORIZONTAL"
    cd.sensor_width = 36
    cd.lens = 18.0 / t
    cd.shift_y = ((hi + lo) / 2) / (2 * t)
    cd.clip_start = 400.0  # the nearest cloud is 1 km out: a far near plane keeps the billow creases free of depth steps
    cd.clip_end = 8000
    cam = bpy.data.objects.new("card_cam", cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("bake")
    mats = []
    dist = CARD_DIST / SKY_SCALE
    for i in range(8):
        az = math.radians(170.0 + 45.0 * i)
        f = Vector((math.sin(az), math.cos(az), 0.0))
        rgt = Vector((math.cos(az), -math.sin(az), 0.0))
        up = Vector((0, 0, 1))
        cam.location = EYE
        cam.rotation_mode = "QUATERNION"
        cam.rotation_quaternion = f.to_track_quat("-Z", "Y")
        path = os.path.join(A.out, f"card_{i}_full.png")
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(path, check_existing=False)
        px = image_np(img)  # rows bottom-up
        bpy.data.images.remove(img)
        alpha = px[..., 3]
        rows = np.where(alpha.max(axis=1) > 0.004)[0]
        cols = np.where(alpha.max(axis=0) > 0.004)[0]
        if len(rows) == 0:
            print(f"AETHER_CARD {i} empty", flush=True)
            continue
        r0, r1 = max(0, rows[0] - 3), min(H, rows[-1] + 4)
        c0, c1 = max(0, cols[0] - 3), min(W, cols[-1] + 4)
        crop = px[r0:r1, c0:c1]
        # Straight alpha; colour under fully clear pixels is spread from the nearest cloud so filtering keeps no dark fringe.
        rgb = crop[..., :3].copy()
        a_ = crop[..., 3:4]
        cov = (a_[..., 0] > 0.004).astype(np.float32)
        acc, wsum = rgb * cov[..., None], cov.copy()
        for _ in range(4):
            acc, wsum = blur(acc, 2), blur(wsum, 2)
        fill = acc / np.maximum(wsum[..., None], 1e-6)
        rgb = np.where(cov[..., None] > 0, rgb, fill)
        # (An 8-bit PNG's pixels come back sRGB-encoded, as written: no transfer to apply.)
        out = write_png_rgba(os.path.join(A.out, f"card_{i}.png"), np.concatenate([np.clip(rgb, 0, 1), a_], axis=2))
        m = unlit_alpha_material(f"cloud_card_{i}", out)
        mats.append(m)
        mi = len(mats) - 1

        def corner(cx, ry):
            xt = cx / W * 2 * t - t
            yt = lo + ry / H * (hi - lo)
            return EYE + (f + rgt * xt + up * yt) * dist
        cs = [corner(c0, r0), corner(c1, r0), corner(c1, r1), corner(c0, r1)]
        uvs = [(0, 0), (1, 0), (1, 1), (0, 1)]
        vs = [bm.verts.new(c) for c in cs]
        face = bm.faces.new(vs)
        face.material_index = mi
        for loop, uv in zip(face.loops, uvs):
            loop[uvl].uv = uv
        print(f"AETHER_CARD {i} {c1 - c0}x{r1 - r0}", flush=True)
    me = bpy.data.meshes.new("piece_clouds")
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    j = bpy.data.objects.new("piece_clouds", me)
    sc.collection.objects.link(j)
    # Faces toward the lookout.
    for p in me.polygons:
        c = p.center
        if p.normal.dot(EYE - c) < 0:
            p.flip()
    scale_about_eye(j)
    for o in hidden:
        o.hide_render = False
    bpy.data.objects["sea"].is_holdout = False
    sc.render.film_transparent = False
    sc.render.engine = keep_engine
    print(f"AETHER_BAKED clouds cards={len(mats)}", flush=True)
    return j


def write_png_rgba(path, rgba01):
    """Write an (H, W, 4) array in 0..1 (rows bottom-up) as an 8-bit RGBA PNG and load it as an image."""
    import struct
    import zlib
    h, w, _ = rgba01.shape
    px = (np.clip(rgba01[::-1], 0, 1) * 255 + 0.5).astype(np.uint8)
    raw = b"".join(b"\x00" + px[y].tobytes() for y in range(h))

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = "sRGB"
    img.alpha_mode = "STRAIGHT"
    return img


def unlit_alpha_material(name, image, uv="bake"):
    """Unlit with alpha (the glTF exporter's mix-with-transparent pattern -> KHR_materials_unlit, alphaMode BLEND)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = image
    tex.interpolation = "Linear"
    tex.extension = "EXTEND"
    uvn = nt.nodes.new("ShaderNodeUVMap")
    uvn.uv_map = uv
    nt.links.new(uvn.outputs[0], tex.inputs[0])
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(tex.outputs["Alpha"], mix.inputs[0])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(tex.outputs["Color"], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs[0])
    try:
        m.surface_render_method = "BLENDED"
    except AttributeError:
        m.blend_method = "BLEND"
    m.use_backface_culling = True
    return m


def glitter_export(report):
    """The sea glitter as four emissive meshes (one per twinkle group) with a looping visibility animation: each group is
    shown or collapsed (scale 0 about its centre) on its own 2-second pattern of quarter-second steps, so the path
    sparkles. Streaks beyond the browser sea's far ring are drawn in toward it (the ring is where its horizon is)."""
    from sky import EYE
    sc = bpy.context.scene
    lim = 2600.0 * SKY_SCALE * 0.92 - 15.0
    patterns = ["11011010", "01101101", "10110110", "11100011"]
    sc.render.fps = 24
    step = 6
    sc.frame_start = 0
    sc.frame_end = step * 8
    parts = []
    for i in range(4):
        src = bpy.data.objects.get(f"glitter_{i}")
        if src is None:
            continue
        me = src.data.copy()
        mw = src.matrix_world
        for v in me.vertices:
            p = mw @ v.co
            d = Vector((p.x - EYE.x, p.y - EYE.y))
            L = d.length
            if L > 1000.0:
                # 1000..2150 m -> 1000..lim, keeping order (the far streaks crowd toward the horizon).
                L2 = 1000.0 + (lim - 1000.0) * (1.0 - math.exp(-(L - 1000.0) / 420.0))
                d = d.normalized() * L2
            v.co = Vector((EYE.x + d.x, EYE.y + d.y, p.z))
        for k, m in enumerate(me.materials):
            me.materials[k] = emissive_export_material(m)
        c = sum((v.co for v in me.vertices), Vector()) / max(1, len(me.vertices))
        for v in me.vertices:
            v.co -= c
        ob = bpy.data.objects.new(f"glitter_{i}_web", me)
        sc.collection.objects.link(ob)
        ob.location = c
        ob.animation_data_create()
        act = bpy.data.actions.new(f"twinkle_{i}")
        ob.animation_data.action = act
        for axis in range(3):
            fc = act.fcurves.new("scale", index=axis)
            for k, on in enumerate(patterns[i] + patterns[i][0]):
                kp = fc.keyframe_points.insert(k * step, 1.0 if on == "1" else 0.0)
                kp.interpolation = "CONSTANT"
        parts.append(ob)
    select_only(parts)
    path = os.path.join(A.out, "glitter.glb")
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_apply=False, export_yup=True,
        export_texcoords=False, export_normals=False, export_tangents=False, export_materials="EXPORT",
        export_cameras=False, export_lights=False, export_extras=False, export_animations=True,
        export_animation_mode="ACTIVE_ACTIONS", export_force_sampling=True, export_frame_range=True,
    )
    pts = []
    tris = 0
    for ob in parts:
        for v in ob.data.vertices:
            pts.append(tuple(ob.location + v.co))
        tris += sum(len(p.vertices) - 2 for p in ob.data.polygons)
    co = np.asarray(pts, np.float32)
    g = np.stack([co[:, 0], co[:, 2], -co[:, 1]], axis=1)
    report["glitter"] = {"file": "glitter.glb", "bytes": os.path.getsize(path), "triangles": tris, "min": g.min(axis=0).tolist(), "max": g.max(axis=0).tolist()}
    print(f"AETHER_EXPORT glitter tris={tris} bytes={os.path.getsize(path)}", flush=True)


def scale_about_eye(ob):
    from sky import EYE
    for v in ob.data.vertices:
        v.co = EYE + (ob.matrix_world @ v.co - EYE) * SKY_SCALE
    ob.matrix_world.identity()


def emission_piece(key, src_name, size_w, size_h, uv_from_top=False, scale_sky=False):
    src = bpy.data.objects.get(src_name)
    if src is None:
        return None
    j = joined_copy([src], f"piece_{key}")
    me = j.data
    if uv_from_top:
        while me.uv_layers:
            me.uv_layers.remove(me.uv_layers[0])
        uv = me.uv_layers.new(name="bake")
        xs = [v.co.x for v in me.vertices]
        ys = [v.co.y for v in me.vertices]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        for loop in me.loops:
            v = me.vertices[loop.vertex_index].co
            # A square-root warp gives the near water more texels than the far.
            u = (v.x - x0) / (x1 - x0)
            t = (y1 - v.y) / (y1 - y0)
            uv.data[loop.index].uv = (u, 1 - math.sqrt(max(0.0, t)))
    elif me.uv_layers:
        me.uv_layers[0].name = "bake"
    else:
        from sky import EYE
        uv = me.uv_layers.new(name="bake")
        for loop in me.loops:
            v = me.vertices[loop.vertex_index].co - EYE
            r = v.length or 1.0
            uv.data[loop.index].uv = (math.atan2(v.y, v.x) / (2 * math.pi) + 0.5, math.asin(max(-1, min(1, v.z / r))) / math.pi + 0.5)
    img = bpy.data.images.new(f"{key}_emit", size_w, size_h, alpha=False, float_buffer=True)
    m = me.materials[0].copy()
    tex = m.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = img
    m.node_tree.nodes.active = tex
    me.materials[0] = m
    run_bake(j, "EMIT", set())
    px = image_np(img)[..., :3]
    px = np.clip(px, 0, 1)
    srgb_px = np.where(px <= 0.0031308, px * 12.92, 1.055 * np.power(px, 1 / 2.4) - 0.055)
    out = write_png(os.path.join(A.out, f"{key}.png"), srgb_px)
    me.materials[0] = unlit_texture_material(f"baked_{key}", out)
    if scale_sky:
        scale_about_eye(j)
    if uv_from_top:
        # Keep the water inside the sky dome: the far rings are pulled in toward the lookout (flat, so nothing moves up).
        from sky import EYE, DOME_R
        lim = DOME_R * SKY_SCALE * 0.92
        for v in j.data.vertices:
            p = j.matrix_world @ v.co
            d = Vector((p.x - EYE.x, p.y - EYE.y))
            if d.length > lim:
                d = d.normalized() * lim
                v.co = Vector((EYE.x + d.x, EYE.y + d.y, p.z))
    print(f"AETHER_BAKED {key} emit {size_w}x{size_h}", flush=True)
    return j


def sun_piece():
    """The sun's disc as an emissive sphere just inside the dome (the dome texture stops at white; bloom needs more)."""
    from sky import DOME_R, EYE, sun_dir
    from common import add_sphere
    d = sun_dir()
    dist = DOME_R * 0.94
    bm = bmesh.new()
    add_sphere(bm, EYE + d * dist, dist * math.tan(math.radians(0.75)), subdiv=2)
    me = bpy.data.meshes.new("piece_sun")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("piece_sun", me)
    bpy.context.scene.collection.objects.link(ob)
    m = bpy.data.materials.new("sun_disc")
    m["cw_emissive"] = P["sun"]
    m["cw_emissive_strength"] = 7.0
    me.materials.append(emissive_export_material(m))
    scale_about_eye(ob)
    return ob


# ---------------------------------------------------------------------------------------------------------------- export

def export_glb(ob, key, report):
    select_only([ob])
    path = os.path.join(A.out, f"{key}.glb")
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
        export_texcoords=True, export_normals=False, export_tangents=False, export_materials="EXPORT",
        export_vertex_color="MATERIAL", export_image_format="WEBP", export_image_quality=88,
        export_cameras=False, export_lights=False, export_extras=False, export_animations=False,
    )
    # Bounds in glTF coordinates (x, z, -y).
    co = np.empty(len(ob.data.vertices) * 3, np.float32)
    ob.data.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    g = np.stack([co[:, 0], co[:, 2], -co[:, 1]], axis=1)
    mn, mx = g.min(axis=0), g.max(axis=0)
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    report[key] = {"file": f"{key}.glb", "bytes": os.path.getsize(path), "triangles": tris, "min": mn.tolist(), "max": mx.tolist()}
    print(f"AETHER_EXPORT {key} tris={tris} bytes={os.path.getsize(path)}", flush=True)


def main():
    setup_cycles()
    report = {}
    want = (lambda k: ONLY is None or k in ONLY)
    widths = {"town": 0.06, "shrine": 0.035, "infra": 0.03, "props": 0.014, "people": 0.012}
    for key, spec in PIECES.items():
        if not want(key):
            continue
        j = atlas_piece(key, spec)
        if j is None:
            continue
        if key in widths:
            outline_after(j, widths[key])
        export_glb(j, key, report)
    if want("trees"):
        obs = [o for o in bpy.data.objects if VERTEX_PIECES["trees"]["match"](o.name)]
        j = vertex_piece("trees", obs, decimate=0.45)
        export_glb(j, "trees", report)
    if want("forest"):
        j = forest_shell()
        if j is not None:
            export_glb(j, "forest", report)
    if want("clouds"):
        export_glb(clouds_piece(), "clouds", report)
    if want("sky"):
        j = emission_piece("sky", "sky_dome", 4096, 2048, scale_sky=True)
        export_glb(j, "sky", report)
    if want("sun"):
        export_glb(sun_piece(), "sun", report)
    if want("sea"):
        j = emission_piece("sea", "sea", 2048, 2048, uv_from_top=True)
        export_glb(j, "sea", report)
    if want("glitter"):
        glitter_export(report)
    path = os.path.join(A.out, "pieces.json")
    old = {}
    if os.path.exists(path):
        with open(path) as f:
            old = json.load(f)
    old.update(report)
    with open(path, "w") as f:
        json.dump(old, f, indent=1)
    print("AETHER_PIECES", path, flush=True)


main()
