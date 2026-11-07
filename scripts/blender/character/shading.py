"""Shading presets.

- Export material: one material on the joined body, base colour = the atlas (its alpha holds the toon codes), so the
  runtime's toon path (finish-character.ts, toon.ts) or glTF PBR (realistic) reads it.
- Preview (QA renders): an EEVEE cel material that mirrors packages/render/src/characters/toon.ts: two tones split by
  the sun with a violet shadow, hair highlights on the lit side only, eyes unshaded, a warm rim; and an inverted-hull
  outline (solidify, flipped, back faces only) whose width follows the per-vertex toon values.
- Per-vertex toon values (`_TOON`: outline width, shade bias, rim strength, spare) as a colour attribute (COLOR_0 in
  the export; finish-character turns it into `_TOON`).
"""
import bpy
import numpy as np

SHADOW = (0.62, 0.55, 0.8)
LIT = (1.0, 0.97, 0.92)


def atlas_image(path, name='atlas'):
    img = bpy.data.images.load(path)
    img.name = name
    img.alpha_mode = 'CHANNEL_PACKED'
    return img


def export_material(img, style, name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    tex.interpolation = 'Linear'
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    if style == 'anime':
        bsdf.inputs['Roughness'].default_value = 1.0
        bsdf.inputs['Metallic'].default_value = 0.0
    else:
        bsdf.inputs['Roughness'].default_value = 0.72
        bsdf.inputs['Specular IOR Level'].default_value = 0.35
    return m


def toon_preview_material(img, name='toon-preview', realistic=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    if realistic:
        bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
        bsdf.inputs['Roughness'].default_value = 0.7
        nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        nt.links.new(bsdf.outputs[0], out.inputs[0])
        return m
    diff = nt.nodes.new('ShaderNodeBsdfDiffuse')
    s2r = nt.nodes.new('ShaderNodeShaderToRGB')
    nt.links.new(diff.outputs[0], s2r.inputs[0])
    bw = nt.nodes.new('ShaderNodeRGBToBW')
    nt.links.new(s2r.outputs[0], bw.inputs[0])
    # shade bias from the toon attribute's green channel
    attr = nt.nodes.new('ShaderNodeAttribute')
    attr.attribute_name = '_TOON'
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(attr.outputs['Color'], sep.inputs[0])
    add = nt.nodes.new('ShaderNodeMath')
    add.operation = 'ADD'
    nt.links.new(bw.outputs[0], add.inputs[0])
    nt.links.new(sep.outputs[1], add.inputs[1])
    ramp = nt.nodes.new('ShaderNodeMapRange')
    ramp.inputs['From Min'].default_value = 0.02
    ramp.inputs['From Max'].default_value = 0.035
    nt.links.new(add.outputs[0], ramp.inputs['Value'])
    lit = ramp.outputs['Result']
    # codes from the alpha
    unsh = nt.nodes.new('ShaderNodeMapRange')
    unsh.inputs['From Min'].default_value = 0.45
    unsh.inputs['From Max'].default_value = 0.25
    nt.links.new(tex.outputs['Alpha'], unsh.inputs['Value'])
    hl_a = nt.nodes.new('ShaderNodeMapRange')
    hl_a.inputs['From Min'].default_value = 0.75
    hl_a.inputs['From Max'].default_value = 0.66
    nt.links.new(tex.outputs['Alpha'], hl_a.inputs['Value'])
    hl_b = nt.nodes.new('ShaderNodeMapRange')
    hl_b.inputs['From Min'].default_value = 0.4
    hl_b.inputs['From Max'].default_value = 0.52
    nt.links.new(tex.outputs['Alpha'], hl_b.inputs['Value'])
    hl = nt.nodes.new('ShaderNodeMath')
    hl.operation = 'MULTIPLY'
    nt.links.new(hl_a.outputs['Result'], hl.inputs[0])
    nt.links.new(hl_b.outputs['Result'], hl.inputs[1])

    def mul(a, col):
        n = nt.nodes.new('ShaderNodeMix')
        n.data_type = 'RGBA'
        n.blend_type = 'MULTIPLY'
        n.inputs['Factor'].default_value = 1
        nt.links.new(a, n.inputs[6])
        n.inputs[7].default_value = (*col, 1)
        return n.outputs[2]

    def mixc(f, a, b):
        n = nt.nodes.new('ShaderNodeMix')
        n.data_type = 'RGBA'
        if isinstance(f, float):
            n.inputs['Factor'].default_value = f
        else:
            nt.links.new(f, n.inputs['Factor'])
        nt.links.new(a, n.inputs[6])
        nt.links.new(b, n.inputs[7])
        return n.outputs[2]

    base = tex.outputs['Color']
    lit_col = mul(base, LIT)
    dark = mul(base, (0.62, 0.62, 0.62))
    shadow_base = mixc(hl.outputs[0], base, dark)
    shadow_col = mul(shadow_base, SHADOW)
    col = mixc(lit, shadow_col, lit_col)
    # in the lit tone, the highlight shape shows (the atlas already holds it); eyes unshaded
    col = mixc(unsh.outputs['Result'], col, base)
    em = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(col, em.inputs['Color'])
    nt.links.new(em.outputs[0], out.inputs[0])
    return m


def outline_material(name='toon-outline'):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (0.045, 0.035, 0.035, 1)
    nt.links.new(em.outputs[0], out.inputs[0])
    return m


def add_outline(ob, width=0.0014):
    """The inverted hull of the preview (the runtime makes its own from the same per-vertex widths)."""
    g = ob.vertex_groups.get('outline') or ob.vertex_groups.new(name='outline')
    attr = ob.data.color_attributes.get('_TOON')
    if attr is not None:
        vals = np.zeros(len(attr.data) * 4, np.float32)
        attr.data.foreach_get('color', vals)
        vals = vals.reshape(-1, 4)
        if attr.domain == 'POINT':
            for i, v in enumerate(vals):
                g.add([i], float(min(1.0, v[0] / 1.5)), 'REPLACE')
    mat = outline_material()
    ob.data.materials.append(mat)
    m = ob.modifiers.new('outline', 'SOLIDIFY')
    m.thickness = -width * 1.5
    m.offset = 1
    m.use_flip_normals = True
    m.use_rim = False
    m.material_offset = len(ob.data.materials) - 1
    m.vertex_group = 'outline'
    m.thickness_vertex_group = 0.0
    return m


def set_toon_attribute(ob, values):
    """values: (n_verts, 4) array."""
    attr = ob.data.color_attributes.get('_TOON') or ob.data.color_attributes.new('_TOON', 'FLOAT_COLOR', 'POINT')
    attr.data.foreach_set('color', np.asarray(values, np.float32).ravel())
    return attr


def sun(direction=(-0.45, -0.75, 0.55), strength=3.0):
    import mathutils
    ob = bpy.data.objects.get('qa-sun')
    if ob is None:
        ob = bpy.data.objects.new('qa-sun', bpy.data.lights.new('qa-sun', 'SUN'))
        bpy.context.scene.collection.objects.link(ob)
    ob.data.energy = strength
    ob.data.use_shadow = False
    ob.data.angle = 0.02
    d = mathutils.Vector(direction).normalized()
    ob.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    return ob
