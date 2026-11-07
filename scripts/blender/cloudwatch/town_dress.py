"""Dressing for the town's balconies and shop front, called from the prop pass (detail.build_small_props): laundry on
the balcony poles and futons over the railings, and nobori banners (a pole and a tall cloth with invented text).

Balcony laundry is attached to the balcony floor recorded by town.py (not gated: it does not stand on the ground);
the banners stand on the ground and are gated like every prop."""

import bmesh
import bpy
from mathutils import Vector

from common import add_box, add_cylinder, bm_object, collection, rng, toon_material

CLOTH = ["#f4f1ea", "#9cc3e6", "#f2b8c6", "#f5e29a", "#ffffff", "#c9e2b8", "#e98f7a", "#7f9fd0", "#f0c48a"]
FUTON = ["#e9d4a8", "#f2c4c4", "#bcd3ea", "#efe6d2"]


def balcony_laundry(balconies, seed):
    """One object (`laundry_balconies`) with a pole, hanging cloth and sometimes a futon on each listed balcony."""
    r = rng(seed)
    mats = [toon_material("cloth_" + c[1:], c) for c in CLOTH] + [toon_material("line_pole", "#9a9aa2")] + \
        [toon_material("futon_" + c[1:], c, stripes=("z", 0.18, "#d8c7a0", 0.12)) for c in FUTON]
    pole_m = len(CLOTH)
    bm = bmesh.new()
    for b in balconies:
        nx, ny = b["nx"], b["ny"]
        ux, uy = -ny, nx  # along the balcony
        ln = b["len"] - 0.3
        inset = 0.3 if not b.get("deck") else 0.6
        # Centre line of the pole, `inset` back from the railing.
        cx = b["x"] + nx * (b["dep"] / 2 - inset)
        cy = b["y"] + ny * (b["dep"] / 2 - inset)
        z = b["z"]
        hp = 1.75
        for s in (-1, 1):
            px, py = cx + ux * s * ln / 2, cy + uy * s * ln / 2
            add_cylinder(bm, (px, py, z), 0.022, hp + 0.05, segments=5, mat_index=pole_m)
        add_cylinder(bm, (cx - ux * ln / 2, cy - uy * ln / 2, z + hp), 0.016, ln, segments=5, mat_index=pole_m, axis=(ux, uy, 0))
        t = -ln / 2 + 0.2
        while t < ln / 2 - 0.35:
            w = r.uniform(0.3, 0.65)
            h = r.uniform(0.4, 0.8)
            m = r.randrange(len(CLOTH))
            px, py = cx + ux * (t + w / 2), cy + uy * (t + w / 2)
            size = (abs(ux) * w + abs(uy) * 0.02, abs(uy) * w + abs(ux) * 0.02, h)
            add_box(bm, (px, py, z + hp - 0.01 - h / 2), size, mat_index=m)
            t += w + r.uniform(0.06, 0.18)
        # A futon airing over the railing (only on railings that stand at the balcony edge).
        if not b.get("deck") and r.random() < 0.6:
            fl = min(1.6, b["len"] - 0.6)
            off = r.uniform(-b["len"] / 4, b["len"] / 4)
            ox = b["x"] + nx * (b["dep"] / 2 + 0.06) + ux * off
            oy = b["y"] + ny * (b["dep"] / 2 + 0.06) + uy * off
            fm = len(CLOTH) + 1 + r.randrange(len(FUTON))
            add_box(bm, (ox, oy, z + 1.0 - 0.32), (abs(ux) * fl + abs(uy) * 0.08, abs(uy) * fl + abs(ux) * 0.08, 0.7), mat_index=fm)
            ix = b["x"] + nx * (b["dep"] / 2 - 0.1) + ux * off
            iy = b["y"] + ny * (b["dep"] / 2 - 0.1) + uy * off
            add_box(bm, (ix, iy, z + 1.0 - 0.22), (abs(ux) * fl + abs(uy) * 0.08, abs(uy) * fl + abs(ux) * 0.08, 0.5), mat_index=fm)
            add_box(bm, ((ox + ix) / 2, (oy + iy) / 2, z + 1.06), (abs(ux) * fl + abs(uy) * 0.24, abs(uy) * fl + abs(ux) * 0.24, 0.08), mat_index=fm)
    ob = bm_object("laundry_balconies", bm, "props", mats=mats, outline=True)
    ob["cw_line_w"] = 0.014
    return ob


def text_mesh(text, size, vertical=False):
    """Blender's built-in font as mesh (in the XZ plane, facing -Y); returns (bmesh, width, height)."""
    cu = bpy.data.curves.new("txt_tmp", "FONT")
    cu.body = "\n".join(text) if vertical else text
    cu.size = size
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.space_line = 0.9
    cu.resolution_u = 2
    cu.extrude = 0.004
    tob = bpy.data.objects.new("txt_tmp", cu)
    collection("props").objects.link(tob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tob.evaluated_get(dg))
    bpy.data.objects.remove(tob)
    bpy.data.curves.remove(cu)
    xs = [v.co.x for v in me.vertices] or [0.0]
    ys = [v.co.y for v in me.vertices] or [0.0]
    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    cyy = (max(ys) + min(ys)) / 2
    for v in bm.verts:
        v.co = Vector((v.co.x, -v.co.z, v.co.y - cyy))
    return bm, max(xs) - min(xs), max(ys) - min(ys)


def nobori(name, x, y, yaw, text, cloth, ink, z_ground, seed=0):
    """A tall shop banner: a pole and a cloth with vertical invented text, standing on the ground at z_ground."""
    bm, tw, th = text_mesh(text, 0.2, vertical=True)
    for f in bm.faces:
        f.material_index = 1
    cw, ch = 0.46, max(1.5, th + 0.3)
    zc = 0.55 + ch / 2
    for v in bm.verts:
        v.co = Vector((v.co.x + 0.05 + cw / 2, v.co.y - 0.02, v.co.z + zc))
    add_box(bm, (0.05 + cw / 2, 0.0, zc), (cw, 0.025, ch), mat_index=0)
    add_box(bm, (0.05 + cw / 2, 0.0, zc + ch / 2 + 0.03), (cw + 0.06, 0.03, 0.03), mat_index=2)
    add_cylinder(bm, (0.0, 0.0, 0.0), 0.028, zc + ch / 2 + 0.12, segments=6, mat_index=2)
    add_cylinder(bm, (0.0, 0.0, 0.0), 0.11, 0.06, segments=8, mat_index=2)  # weighted foot
    mats = [toon_material("nobori_" + cloth[1:], cloth), toon_material("ink_" + ink[1:], ink), toon_material("sign_post", "#6a6870")]
    ob = bm_object(name, bm, "props", mats=mats, prop=True, outline=True, recalc=False)
    ob.location = (x, y, z_ground)
    ob.rotation_euler = (0, 0, yaw)
    return ob
