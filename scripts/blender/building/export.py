"""Export of a kit building: the painted albedo (with its wear) baked into one atlas, LOD0 and a decimated LOD1 as GLB.

The node materials do not survive glTF, so the albedo bake (Cycles, the DIFFUSE colour pass of every material: tile rows,
brush strokes, grime, moss) goes into one texture on a smart-projected atlas, and the building exports with one
textured material plus the emissive ones (lit windows, lamps, the shop glass) kept as emissive colours. LOD1 is a
collapse decimation of LOD0 to 40 % on the same atlas. Outlines are not exported (the engine's toon path draws its own).
"""
import math
import os

import bpy


def select_only(obs, active=None):
    bpy.ops.object.select_all(action="DESELECT")
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or obs[0]


def bake_albedo(ob, size=2048, gpu=True):
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
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    me.uv_layers.new(name="UVMap")
    select_only([ob])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.002, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(shape_method="AABB", margin_method="FRACTION", margin=2.0 / size, rotate=True)
    bpy.ops.object.mode_set(mode="OBJECT")
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
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, target="IMAGE_TEXTURES", margin=4, use_clear=True)
    img.filepath_raw = os.path.join(bpy.app.tempdir, f"{ob.name}_albedo.png")
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
