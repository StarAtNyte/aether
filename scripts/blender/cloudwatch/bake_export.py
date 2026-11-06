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

PIECES = {
    "terrain": {"match": lambda n: n in ("terrain", "roads", "road_lines"), "tex": 2048, "dissolve": 1.5},
    "town": {"match": lambda n: n.startswith("house_") or n in ("shop", "shrine_hall", "shrine_gate", "block_walls"), "tex": 4096},
    "infra": {"match": lambda n: n in ("stair", "lookout", "harbour", "lighthouse", "railway", "crossing", "poles_wires") or n.startswith("tunnel_portal"), "tex": 2048},
    "props": {"match": lambda n: n.startswith(("stone_lantern", "stair_lantern", "vending", "bicycle", "laundry", "sign_", "boat_")) or n in ("pots", "ac_units", "mailbox"), "tex": 2048},
    "people": {"match": lambda n: n.startswith("person_"), "tex": 512},
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


def unwrap(ob, uv_name="bake"):
    me = ob.data
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    me.uv_layers.new(name=uv_name)
    select_only([ob])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.003, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(margin=0.002, rotate=True)
    bpy.ops.object.mode_set(mode="OBJECT")


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
    unwrap(j)
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
    print(f"AETHER_STATS {key} light mean={float(np.nanmean(L)):.4f} max={float(np.nanmax(L)):.4f} albedo mean={float(np.nanmean(Al)):.4f} nan={int(np.isnan(L).sum())}", flush=True)
    Lb = blur(lum(L), 1)
    final = Al * ramp_np(Lb)
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
    """Clouds shaded per vertex in Python with the cloud material's ramp, base tint and rim (view from the lookout)."""
    from sky import EYE, sun_dir
    obs = [o for o in bpy.data.objects if o.name.startswith("cloud") and o.type == "MESH" and not o.name.endswith("__c")]
    sd = sun_dir()
    stops = [(0.0, P["cloud_deep"]), (0.16, P["cloud_shadow"]), (0.24, "#b08fbe"), (0.40, "#e2a7b4"), (0.48, P["cloud_lit2"]), (0.72, P["cloud_lit2"]), (0.78, P["cloud_lit"]), (1.0, "#fff4e4")]
    xs = np.array([s[0] for s in stops])
    cs = np.array([srgb(s[1])[:3] for s in stops])
    sun_strength = bpy.data.objects["sun"].data.energy
    parts = []
    for o in obs:
        c = joined_copy([o], o.name + "_web")
        nf = len(c.data.polygons)
        md = c.modifiers.new("dec", "DECIMATE")
        budget = 14000 if o.name == "cloud_tower" else 5000 if ("tower" in o.name or o.name == "cloud_north0") else 900
        md.ratio = min(1.0, budget / max(1, nf))
        select_only([c])
        bpy.ops.object.modifier_apply(modifier=md.name)
        me = c.data
        me.calc_normals_split() if hasattr(me, "calc_normals_split") else None
        n = len(me.vertices)
        co = np.empty(n * 3, np.float32)
        me.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        nr = np.empty(n * 3, np.float32)
        me.vertices.foreach_get("normal", nr)
        nr = nr.reshape(-1, 3)
        sdv = np.array([sd.x, sd.y, sd.z])
        Lv = np.clip(nr @ sdv, 0, None) * sun_strength / math.pi + 0.06
        col = np.stack([np.interp(np.clip(Lv, 0, 1), xs, cs[:, k]) for k in range(3)], axis=1)
        z0, z1 = co[:, 2].min(), co[:, 2].max()
        base = np.clip((z0 + (z1 - z0) * 0.22 - co[:, 2]) / max(1e-3, (z1 - z0) * 0.22), 0, 1)
        base = base * base * (3 - 2 * base) * 0.55
        col = col * (1 - base[:, None]) + np.array(srgb(P["cloud_base"])[:3]) * base[:, None]
        V = co - np.array([EYE.x, EYE.y, EYE.z])
        V /= np.linalg.norm(V, axis=1, keepdims=True)
        facing = 1 - np.abs(np.sum(nr * -V, axis=1))
        back = np.clip((V @ sdv - 0.35) / 0.6, 0, 1)
        back = back * back * (3 - 2 * back)
        rim = np.clip(facing ** 4 * back * 2.5, 0, 1)
        col = col * (1 - rim[:, None]) + np.array(srgb("#ffd79a")[:3]) * rim[:, None]
        for a in list(me.color_attributes):
            me.color_attributes.remove(a)
        attr = me.color_attributes.new("cw_color", "BYTE_COLOR", "POINT")
        attr.data.foreach_set("color", np.concatenate([col, np.ones((n, 1))], axis=1).astype(np.float32).ravel())
        me.color_attributes.active_color = attr
        parts.append(c)
    select_only(parts)
    bpy.ops.object.join()
    j = bpy.context.view_layer.objects.active
    j.name = "piece_clouds"
    j.data.materials.clear()
    j.data.materials.append(unlit_color_material("vc_clouds", attribute="cw_color"))
    scale_about_eye(j)
    print(f"AETHER_BAKED clouds faces={len(j.data.polygons)}", flush=True)
    return j


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
    widths = {"town": 0.045, "infra": 0.03, "props": 0.014, "people": 0.012}
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
        j = emission_piece("sky", "sky_dome", 2048, 1024, scale_sky=True)
        export_glb(j, "sky", report)
    if want("sun"):
        export_glb(sun_piece(), "sun", report)
    if want("sea"):
        j = emission_piece("sea", "sea", 2048, 2048, uv_from_top=True)
        export_glb(j, "sea", report)
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
