"""Export of a kit building: the painted albedo (with its wear) baked into one atlas, LOD0 and a decimated LOD1 as GLB.

The node materials do not survive glTF, so the albedo bake (Cycles, the DIFFUSE colour pass of every material: tile rows,
brush strokes, grime, moss) goes into one texture on a smart-projected atlas, and the building exports with one
textured material plus the emissive ones (lit windows, lamps, the shop glass) kept as emissive colours. LOD1 is a
collapse decimation of LOD0 to 40 % on the same atlas. Outlines are not exported (the engine's toon path draws its own).
"""
import math
import os
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import signs  # noqa: E402

SIGNAGE = []  # the last bake's decal checks (signs.check_atlas rows)


def select_only(obs, active=None):
    bpy.ops.object.select_all(action="DESELECT")
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or obs[0]


def _to_cpu(sc):
    """Bake on the CPU from now on: the device and the preferences' GPUs off (a CPU bake still opened a CUDA context,
    and failed with it, while another job held the GPU's memory)."""
    sc.cycles.device = "CPU"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    try:
        prefs.compute_device_type = "NONE"
    except TypeError:
        pass
    for d in getattr(prefs, "devices", []):
        d.use = d.type == "CPU"


def bake_albedo(ob, size=2048, gpu=True, out_dir=None):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    if gpu:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for dev in ("OPTIX", "CUDA"):
            try:
                prefs.compute_device_type = dev
                prefs.refresh_devices()
            except (TypeError, AttributeError):
                continue
            devs = [d for d in prefs.devices if d.type == dev]
            if devs:
                for d in prefs.devices:
                    d.use = d.type == dev
                sc.cycles.device = "GPU"
                break
    print(f"[building] albedo bake on {sc.cycles.device} ({getattr(prefs, 'compute_device_type', '-') if gpu else '-'})", flush=True)
    sc.cycles.samples = 8
    me = ob.data
    for uvl in [u for u in me.uv_layers if u.name != "decal"]:
        me.uv_layers.remove(uvl)
    bake_uv = me.uv_layers.new(name="UVMap")
    me.uv_layers.active = bake_uv
    bake_uv.active_render = True
    select_only([ob])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.002, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    # Painted signs (decal faces) stay out of the pack: they get their own band at the letters' density (signs.py).
    dec, slots = signs.decal_polys(me)
    rects, band = signs.layout_band(slots, size)
    me.polygons.foreach_set("select", (~dec).tolist())
    bpy.context.scene.tool_settings.use_uv_select_sync = True
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.uv.pack_islands(shape_method="AABB", margin_method="FRACTION", margin=2.0 / size, rotate=True)
    bpy.ops.object.mode_set(mode="OBJECT")
    slot_px = {}
    if rects:
        uv = np.empty(len(me.loops) * 2, np.float32)
        bake_uv.data.foreach_get("uv", uv)
        uv[1::2] *= 1.0 - band / size
        bake_uv.data.foreach_set("uv", uv)
        slot_px = signs.place_band(me, "UVMap", size, 0, rects, band)
    img = bpy.data.images.new(f"{ob.name}_albedo", size, size, alpha=False)
    srcs = list(me.materials)
    emissive = {i for i, m in enumerate(srcs) if m and m.get("cw_emissive")}
    variants = []
    for i, m in enumerate(srcs):
        v = m.copy()
        nt = v.node_tree
        out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
        alb = nt.nodes.get("ALBEDO")
        diff = nt.nodes.new("ShaderNodeBsdfDiffuse")
        if alb is not None:
            nt.links.new(alb.outputs[0], diff.inputs["Color"])
        nt.links.new(diff.outputs[0], out.inputs[0])
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        nt.nodes.active = tex
        me.materials[i] = v
        variants.append(v)
    select_only([ob])
    try:
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, target="IMAGE_TEXTURES", margin=4, use_clear=True)
    except RuntimeError as e:  # a busy GPU (out of memory): the CPU bakes it (a minute or two at 2048 px)
        print(f"[building] GPU bake failed ({e}); baking on the CPU", flush=True)
        _to_cpu(sc)
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, target="IMAGE_TEXTURES", margin=4, use_clear=True)
    px = np.empty(size * size * 4, np.float32)
    img.pixels.foreach_get(px)
    if sc.cycles.device == "GPU" and float(px.reshape(-1, 4)[:, :3].max()) < 0.02:
        # A shared or busy GPU can return a black bake without an error (seen with OptiX): bake again on the CPU.
        print("[building] the GPU bake came back black; baking on the CPU", flush=True)
        _to_cpu(sc)
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, target="IMAGE_TEXTURES", margin=4, use_clear=True)
        img.pixels.foreach_get(px)
    SIGNAGE.clear()
    if slot_px:
        SIGNAGE.extend(signs.check_atlas(list(me.materials), px.reshape(size, size, 4)[..., :3], slot_px))
    img.filepath_raw = os.path.join(out_dir or bpy.app.tempdir, f"{ob.name}.atlas.png")
    img.file_format = "PNG"
    img.save()
    # One textured material (and the emissive ones).
    tm = bpy.data.materials.new(f"{ob.name}_baked")
    tm.use_nodes = True
    bsdf = tm.node_tree.nodes["Principled BSDF"]
    tx = tm.node_tree.nodes.new("ShaderNodeTexImage")
    tx.image = img
    tm.node_tree.links.new(tx.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.85
    for i, m in enumerate(srcs):
        if i in emissive:
            em = bpy.data.materials.new(m.name + "_glow")
            em.use_nodes = True
            b = em.node_tree.nodes["Principled BSDF"]
            from common import srgb
            b.inputs["Base Color"].default_value = srgb(m["cw_emissive"])
            b.inputs["Emission Color"].default_value = srgb(m["cw_emissive"])
            b.inputs["Emission Strength"].default_value = float(m.get("cw_emissive_strength", 1.0))
            me.materials[i] = em
        else:
            me.materials[i] = tm
    for v in variants:
        bpy.data.materials.remove(v)
    _merge_slots(ob)
    if me.uv_layers.get("decal") is not None:
        me.uv_layers.remove(me.uv_layers["decal"])
    return img


def _merge_slots(ob):
    me = ob.data
    mats = list(me.materials)
    uniq, remap = [], []
    for m in mats:
        if m in uniq:
            remap.append(uniq.index(m))
        else:
            uniq.append(m)
            remap.append(len(uniq) - 1)
    idx = [remap[p.material_index] for p in me.polygons]
    me.materials.clear()
    for m in uniq:
        me.materials.append(m)
    for p, i in zip(me.polygons, idx):
        p.material_index = i


def export_glb(ob, path):
    select_only([ob])
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
                              export_texcoords=True, export_normals=True, export_materials="EXPORT", export_image_format="WEBP",
                              export_image_quality=88, export_cameras=False, export_lights=False, export_extras=False, export_animations=False)
    return os.path.getsize(path)


def lod(ob, ratio=0.4):
    c = ob.copy()
    c.data = ob.data.copy()
    c.name = ob.name + "_lod1"
    bpy.context.scene.collection.objects.link(c)
    for md in list(c.modifiers):
        c.modifiers.remove(md)
    md = c.modifiers.new("decimate", "DECIMATE")
    md.decimate_type = "COLLAPSE"
    md.ratio = ratio
    md.use_collapse_triangulate = True
    select_only([c])
    bpy.ops.object.modifier_apply(modifier=md.name)
    return c


def triangles(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)
