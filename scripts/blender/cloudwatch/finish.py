"""Finishing: inverted-hull line art on everything marked `cw_outline` (a back-face shell in the line colour, its width
by the object's size), so the lines exist as geometry in Blender and in the exported glb alike."""
import bpy

from common import line_material


def outline_width(ob):
    if ob.get("cw_person"):
        return 0.012
    if ob.get("cw_line_w"):
        return float(ob["cw_line_w"])  # thin gear spread over the town (antennas, tanks): a fine line, not a big one
    d = max(ob.dimensions)
    if d < 2.0:
        return 0.016
    if d < 8.0:
        return 0.035
    return 0.06


# Hand-drawn wobble: the shell's width swells and thins along an edge (a slow noise in world position, with a little
# faster jitter), between WOBBLE_MIN and WOBBLE_MAX times the nominal width, the way an inked line's pressure varies.
WOBBLE_MIN, WOBBLE_MAX = 0.45, 1.3
WOBBLE_FREQ = 0.42  # per metre


def wobble_group(ob, width=None):
    """A `cw_wobble` vertex group whose weights (0..1) scale the outline shell's thickness along each edge."""
    from mathutils import Vector, noise
    vg = ob.vertex_groups.get("cw_wobble") or ob.vertex_groups.new(name="cw_wobble")
    mw = ob.matrix_world
    lo = WOBBLE_MIN / WOBBLE_MAX
    # Small things (people, props) wobble faster so a line still varies along a short edge.
    f = WOBBLE_FREQ * (2.5 if (width or 0.05) < 0.02 else 1.0)
    groups = {}
    # Vertices in the `cw_noline` layer (tile courses) get no shell: a line along every course would hatch the roofs.
    nl = ob.data.attributes.get("cw_noline")
    off = set()
    if nl is not None and nl.domain == "POINT":
        vals = [0.0] * len(ob.data.vertices)
        nl.data.foreach_get("value", vals)
        off = {i for i, x in enumerate(vals) if x > 0.5}
    for v in ob.data.vertices:
        if v.index in off:
            groups.setdefault(0.0, []).append(v.index)
            continue
        p = mw @ v.co
        n = noise.noise(p * f) * 0.75 + noise.noise(p * f * 4.1 + Vector((7.3, 1.1, 3.7))) * 0.25
        w = lo + (1.0 - lo) * min(1.0, max(0.0, 0.5 + 0.9 * n))
        groups.setdefault(round(w, 2), []).append(v.index)
    for w, idx in groups.items():
        vg.add(idx, w, "REPLACE")
    return vg


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
        w = outline_width(ob)
        mod.thickness = w * WOBBLE_MAX
        mod.vertex_group = wobble_group(ob, w).name
        mod.thickness_vertex_group = 0.0
        mod.offset = 1.0
        mod.use_flip_normals = True
        mod.use_rim = False
        mod.material_offset = idx
        mod.use_quality_normals = True
        n += 1
    print("AETHER_OUTLINES", n, flush=True)
