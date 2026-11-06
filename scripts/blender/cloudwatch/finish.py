"""Finishing: inverted-hull line art on everything marked `cw_outline` (a back-face shell in the line colour, its width
by the object's size), so the lines exist as geometry in Blender and in the exported glb alike."""
import bpy

from common import line_material


def outline_width(ob):
    if ob.get("cw_person"):
        return 0.012
    d = max(ob.dimensions)
    if d < 2.0:
        return 0.014
    if d < 8.0:
        return 0.03
    return 0.05


def build():
    line = line_material()
    n = 0
    for ob in list(bpy.data.objects):
        if ob.type != "MESH" or not ob.get("cw_outline"):
            continue
        me = ob.data
        if line.name not in [m.name for m in me.materials if m]:
            me.materials.append(line)
        idx = [m.name for m in me.materials].index(line.name)
        mod = ob.modifiers.new("outline", "SOLIDIFY")
        mod.thickness = outline_width(ob)
        mod.offset = 1.0
        mod.use_flip_normals = True
        mod.use_rim = False
        mod.material_offset = idx
        mod.use_quality_normals = True
        n += 1
    print("AETHER_OUTLINES", n, flush=True)
