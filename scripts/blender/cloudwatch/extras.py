"""Moving extras of Cloudwatch Harbour, exported as their own pieces so the big static pieces stay static:

  train  a two-car local commuter train (an original design: cream body, a teal stripe, a pantograph on the first car,
         windows lit as practicals), built for the 1.067 m gauge track. Built and baked away from the town (over the open
         sea, lit by the sun and the sky alone, nothing to shadow it), then moved to its rest position just inside the
         east tunnel for the export. Length along Blender x.
  birds  a flock of gulls circling over the harbour with a looping wing-flap clip (see bake_export.birds_export).

Both are created by the bake (bake_export.py --only train,birds), not by build.py: the stills do not show them.
"""
import math

import bmesh
import bpy
from mathutils import Vector

from common import add_box, add_cylinder, bm_object, toon_material
from form import PORTAL_X, TRACK_Y, TRACK_Z

RAIL_TOP = TRACK_Z + 0.3 + 0.12 + 0.16  # ballast, sleepers, rails (form.build_railway)
CAR_L, CAR_W, GAP = 15.5, 2.8, 0.7
TRAIN_L = 2 * CAR_L + GAP
# Where the train is baked: far out over the sea, clear of everything. And where it rests: just inside the east portal.
BAKE_AT = Vector((0.0, -900.0, 60.0))
REST_AT = Vector((PORTAL_X + 1.2 + TRAIN_L / 2 + 1.0, TRACK_Y, RAIL_TOP))


def _car(bm, x0, lead, pantograph, seed):
    """One car from x0 (its -x end) to x0 + CAR_L, wheels on z = 0, centred on y = 0. lead: +1/-1 cab end, 0 none."""
    M_BODY, M_STRIPE, M_ROOF, M_GLASS, M_LIT, M_DARK, M_METAL = range(7)
    L, W = CAR_L, CAR_W
    xc = x0 + L / 2
    floor = 1.1
    top = floor + 2.75
    # Underframe and bogies with wheels.
    add_box(bm, (xc, 0, floor - 0.25), (L - 0.4, W - 0.3, 0.5), mat_index=M_DARK)
    for bx in (x0 + 2.6, x0 + L - 2.6):
        add_box(bm, (bx, 0, 0.62), (2.6, W - 0.5, 0.42), mat_index=M_DARK)
        for wx in (bx - 1.05, bx + 1.05):
            for wy in (-0.5335, 0.5335):
                add_cylinder(bm, (wx, wy - 0.06 * (1 if wy < 0 else -1), 0.43), 0.43, 0.12, segments=12, mat_index=M_METAL,
                             axis=(0, 1 if wy < 0 else -1, 0))
    for k in range(3):  # under-floor equipment
        add_box(bm, (x0 + 5.0 + k * 2.6, 0, floor - 0.62), (1.8, W - 0.9, 0.5), mat_index=M_DARK)
    # Body: lower panel, the stripe, the window band, the letterboard, the roof.
    add_box(bm, (xc, 0, floor + 0.45), (L, W, 0.9), mat_index=M_BODY)
    add_box(bm, (xc, 0, floor + 1.0), (L + 0.01, W + 0.02, 0.22), mat_index=M_STRIPE)
    add_box(bm, (xc, 0, floor + 1.62), (L, W - 0.06, 1.0), mat_index=M_BODY)
    add_box(bm, (xc, 0, floor + 2.42), (L, W, 0.6), mat_index=M_BODY)
    add_box(bm, (xc, 0, top + 0.12), (L - 0.2, W - 0.3, 0.24), mat_index=M_ROOF)
    # Windows (both sides): glass between the doors, every other pane lit; three doors a side.
    doors = [x0 + 2.0, xc, x0 + L - 2.0]
    for side in (-1, 1):
        y = side * (W / 2 + 0.005)
        n = 0
        for d in doors:
            add_box(bm, (d, y, floor + 1.15), (1.3, 0.02, 2.0), mat_index=M_DARK)  # door panels
            add_box(bm, (d, y + side * 0.004, floor + 1.55), (0.9, 0.02, 0.8), mat_index=M_GLASS)
        for (a, b) in ((doors[0] + 0.9, doors[1] - 0.9), (doors[1] + 0.9, doors[2] - 0.9)):
            k = int((b - a) / 1.35)
            for i in range(k):
                wx = a + (i + 0.5) * (b - a) / k
                lit = (i + n + seed + (side > 0)) % 3 != 0
                add_box(bm, (wx, y, floor + 1.62), ((b - a) / k - 0.16, 0.02, 0.86), mat_index=M_LIT if lit else M_GLASS)
            n += 1
    # Cab end: a flat face with two big windows, headlights low, a destination board, the stripe across.
    if lead:
        xe = x0 + (L if lead > 0 else 0)
        f = lead
        add_box(bm, (xe + f * 0.05, 0, floor + 1.62), (0.06, W - 0.5, 0.9), mat_index=M_GLASS)
        add_box(bm, (xe + f * 0.07, 0, floor + 1.62), (0.06, 0.12, 0.92), mat_index=M_BODY)  # the mullion
        add_box(bm, (xe + f * 0.06, 0, floor + 2.42), (0.06, 1.2, 0.32), mat_index=M_LIT)  # destination board
        for hy in (-0.95, 0.95):
            add_box(bm, (xe + f * 0.06, hy, floor + 0.55), (0.06, 0.34, 0.2), mat_index=M_LIT)  # headlights
        add_box(bm, (xe + f * 0.25, 0, floor - 0.35), (0.4, W - 0.6, 0.3), mat_index=M_DARK)  # coupler box / skirt
    # Pantograph: a diamond of thin bars on the roof, a contact bar on top.
    if pantograph:
        px = x0 + L * 0.3
        zr = top + 0.24
        for sy in (-0.6, 0.6):
            for sx in (-1, 1):
                a = Vector((px + sx * 0.8, sy, zr))
                b = Vector((px, sy, zr + 0.75))
                add_cylinder(bm, a, 0.025, (b - a).length, segments=4, mat_index=M_METAL, axis=b - a)
        add_cylinder(bm, (px - 0.08, -0.9, zr + 0.78), 0.03, 1.8, segments=5, mat_index=M_METAL, axis=(0, 1, 0))
        add_box(bm, (px, 0, zr + 0.06), (1.9, 1.4, 0.12), mat_index=M_DARK)
    # Roof gear: AC housings.
    for k in range(2):
        add_box(bm, (x0 + L * (0.55 + 0.25 * k), 0, top + 0.38), (2.2, 1.6, 0.3), mat_index=M_ROOF)


def build_train():
    """The train as one object (`train`) at BAKE_AT, hidden in renders (the bake makes its own copy)."""
    def mat(name, *a, **k):
        # In the bake the .blend already holds the town's materials: reuse them (the lit windows stay one practical).
        return bpy.data.materials.get(name) or toon_material(name, *a, **k)
    mats = [
        mat("train_body", "#efe6cf"),
        mat("train_stripe", "#2f8a8a"),
        mat("train_roof", "#9a9aa2"),
        mat("train_glass", "#3b4a6a"),
        mat("window_lit", "#ffcf7a", emission="#ffcf7a", emission_strength=2.2),
        mat("train_dark", "#3a3640"),
        mat("train_metal", "#6d6a72"),
    ]
    bm = bmesh.new()
    _car(bm, -TRAIN_L / 2, -1, True, 0)
    _car(bm, -TRAIN_L / 2 + CAR_L + GAP, 1, False, 1)
    add_box(bm, (-TRAIN_L / 2 + CAR_L + GAP / 2, 0, 2.3), (GAP + 0.2, 1.4, 2.2), mat_index=5)  # the gangway
    ob = bm_object("train", bm, "train", mats=mats, outline=True, recalc=False)
    ob.location = BAKE_AT
    ob.hide_render = True
    return ob


def rest_offset():
    """The move from the bake position to the rest position (applied to the baked piece before export)."""
    return REST_AT - BAKE_AT
