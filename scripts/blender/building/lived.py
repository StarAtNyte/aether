"""Lived-in detail of the building kit: what makes a house used. Outdoor units of air conditioners (on brackets, on
balconies, on the ground) with their pipe covers running to a wall cap; downpipes with offsets, brackets and shoes;
gas and electricity meters with their pipes and conduit; a service wire's bracket; potted plants of a few kinds;
signboards with invented names (Blender's own font, as mesh); roof gear (an antenna, a water heater) for buildings
built on their own (the town has its own gear pass).

Every fitting is a kit part (K.part), so the QA checks that it touches what carries it and sinks into nothing.
"""
import math

import bmesh
import bpy
from mathutils import Vector

from facade import nrm


def ac_unit(K, face, u, z, plan, r, bracket=True, ground=None, pipe_to=None, side=None, duct=True):
    """An outdoor unit (0.8 x 0.3 x 0.6 m) against a wall face, its fan grille and fins, on wall brackets (or feet on
    the ground / a floor), and the pipe cover from its side to a cap in the wall."""
    n = nrm(face)
    W, D, H = 0.78, 0.29, 0.58
    off = 0.06 + D / 2
    acm, fan, duct = K.lib("ac"), K.lib("ac_fan"), K.lib("duct")
    support = "back" if bracket else "below"
    with K.part(f"ac_{len(K.parts)}", support, normal=n):
        K.fbox(face, u, z, W, D, H, off, acm)
        # The fan's round grille on the front, a fin panel at one end.
        c = face.pt(u - 0.08, z, off + D / 2)
        K.cyl(c, 0.2, 0.012, fan, axis=n, seg=K.seg + 4)
        if K.tier == "hero":
            with K.no_outline():
                for k in range(3):
                    K.cyl(face.pt(u - 0.08, z, off + D / 2 + 0.012), 0.2 - 0.06 * (k + 1), 0.004, acm, axis=n, seg=K.seg + 2)
        K.fbox(face, u + W / 2 - 0.14, z, 0.2, 0.012, H - 0.12, off + D / 2 + 0.006, K.lib("grille"))
        if bracket:
            # Two angle brackets from the wall under the unit, with their diagonals.
            for s in (-1, 1):
                bu = u + s * (W / 2 - 0.12)
                K.fbox(face, bu, z - H / 2 - 0.02, 0.04, D + 0.1, 0.04, (D + 0.1) / 2, K.lib("metal"))
                a = face.pt(bu, z - H / 2 - 0.35, 0.02)
                b = face.pt(bu, z - H / 2 - 0.04, D + 0.04)
                K.beam(a, b, 0.014, K.lib("metal"), seg=4)
                K.fbox(face, bu, z - H / 2 - 0.3, 0.05, 0.02, 0.14, 0.01, K.lib("metal"))
        else:
            # Feet (on a concrete pad on the ground: the unit's foot 18 cm above it).
            for s in (-1, 1):
                K.fbox(face, u + s * (W / 2 - 0.08), z - H / 2 - 0.035, 0.08, D, 0.07, off, K.lib("metal"))
            if ground is not None:
                zg = z - H / 2 - 0.18
                K.fbox(face, u, zg + 0.045, W + 0.12, D + 0.12, 0.13, 0.06 + (D + 0.12) / 2, K.lib("stone"), grime=0.3)
    # The pipe cover (a cream duct) from the unit's end up or down the wall to a cap.
    if not duct:
        return None
    side = side or r.choice((-1, 1))
    du = u + side * (W / 2 + 0.08)
    zc = pipe_to if pipe_to is not None else z + r.uniform(0.6, 1.4) * (1 if r.random() < 0.7 else -0.6)
    zl, zh = sorted((z - 0.05, zc))
    with K.part(f"ac_duct_{len(K.parts)}", "back", normal=n):
        K.fbox(face, du, (zl + zh) / 2, 0.1, 0.08, zh - zl, 0.04, duct)
        K.fbox(face, (u + side * W / 2 + du) / 2, z - 0.05, abs(du - (u + side * W / 2)) + 0.05, 0.08, 0.1, 0.04 + 0.0, duct)
        K.fbox(face, du, zc + (0.07 if zc > z else -0.07), 0.16, 0.1, 0.14, 0.05, duct)
    return du


def downpipe(K, face, u, z_top, z_bottom, gutter_off, plan, ground_z):
    """A downpipe from the gutter (`gutter_off` out of this wall, at z_top) down the wall: an offset bend to the wall,
    brackets every 1.6 m, a shoe at the foot."""
    r = 0.045
    pm = K.lib("gutter")
    wo = 0.1
    pts = [face.pt(u, z_top - 0.05, gutter_off), face.pt(u, z_top - 0.22, gutter_off), face.pt(u, z_top - 0.5, wo), face.pt(u, ground_z + 0.32, wo),
           face.pt(u, ground_z + 0.14, wo + 0.12)]
    with K.part(f"downpipe_{len(K.parts)}", "none"):
        K.pipe(pts, r, pm, seg=6 if K.tier != "far" else 5)
        if K.tier != "far":
            zz = z_top - 0.8
            while zz > ground_z + 0.6:
                K.fbox(face, u, zz, 0.12, wo, 0.04, wo / 2, K.lib("metal"))
                zz -= 1.6


def meters(K, face, u, zb, plan, r, ground_z):
    """A gas meter on its riser (from the ground) and an electricity meter on the wall, its conduit to the eaves."""
    n = nrm(face)
    with K.part(f"gas_meter_{len(K.parts)}", "back", normal=n):
        K.fbox(face, u, zb + 0.95, 0.3, 0.16, 0.34, 0.08 + 0.02, K.lib("meter"))
        K.fbox(face, u, zb + 0.95, 0.36, 0.02, 0.4, 0.01, K.lib("metal"))
        K.fbox(face, u - 0.06, zb + 1.0, 0.11, 0.012, 0.07, 0.186, K.lib("meter_face"))
    with K.part(f"gas_pipe_{len(K.parts)}", "below"):
        K.pipe([face.pt(u + 0.1, ground_z - 0.02, 0.09), face.pt(u + 0.1, zb + 0.74, 0.09), face.pt(u + 0.06, zb + 0.78, 0.09)], 0.022, K.lib("pipe"), seg=5)
    eu = u + r.choice((-1, 1)) * 0.6
    with K.part(f"elec_meter_{len(K.parts)}", "back", normal=n):
        K.fbox(face, eu, zb + 1.7, 0.2, 0.12, 0.28, 0.06, K.lib("meter"))
        K.fbox(face, eu, zb + 1.74, 0.14, 0.012, 0.12, 0.126, K.lib("meter_face"))
    return eu


def conduit(K, face, u, z0, z1, plan):
    with K.part(f"conduit_{len(K.parts)}", "back", normal=nrm(face)):
        with K.no_outline():
            K.fbox(face, u, (z0 + z1) / 2, 0.03, 0.03, z1 - z0, 0.015, K.lib("pipe"))
            K.fbox(face, u, z1 + 0.06, 0.12, 0.16, 0.06, 0.08, K.lib("metal"))


def wire(K, a, b, sag=0.25, r=0.008, n=10):
    """A sagging wire (catenary-ish) between two points."""
    A, B = Vector(a), Vector(b)
    pts = []
    for i in range(n + 1):
        t = i / n
        p = A.lerp(B, t)
        p.z -= sag * 4 * t * (1 - t)
        pts.append(tuple(p))
    with K.part(f"wire_{len(K.parts)}", "none"):
        with K.no_outline():
            K.pipe(pts, r, K.lib("wire"), seg=4)


def plant(K, at, kind, r, scale=1.0, support="below"):
    """A potted plant standing at `at` (the pot's base): 'shrub' (a round bush), 'tall' (a cluster of upright leaves),
    'flowers' (a low mound with colour)."""
    x, y, z = at
    s = scale
    with K.part(f"plant_{len(K.parts)}", support):
        pr = 0.15 * s
        ph = 0.28 * s
        pot = K.lib("pot") if r.random() < 0.65 else K.lib("pot2")
        K.cyl((x, y, z), pr, ph, pot, radius_top=pr * 1.22, seg=max(6, K.seg), cap0=True, cap1=False)
        K.cyl((x, y, z + ph - 0.035 * s), pr * 1.3, 0.05 * s, pot, seg=max(6, K.seg))
        K.cyl((x, y, z + ph - 0.03 * s), pr * 1.12, 0.012, K.lib("soil"), seg=max(6, K.seg), cap0=False)
        leaf = K.lib("leaf") if r.random() < 0.6 else K.lib("leaf2")
        with K.no_outline(K.tier == "far"):
            if kind == "tall":
                for k in range(3 if K.tier == "far" else 5):
                    a = k * 2.4 + r.uniform(0, 0.5)
                    off = Vector((math.cos(a), math.sin(a), 0)) * 0.06 * s
                    K.sphere((x + off.x, y + off.y, z + ph + 0.32 * s), 0.11 * s, leaf, scale=(0.7, 0.7, 3.0), subdiv=1)
            elif kind == "flowers":
                K.sphere((x, y, z + ph + 0.08 * s), 0.2 * s, leaf, scale=(1.0, 1.0, 0.55), subdiv=1)
                if K.tier != "far":
                    fl = K.lib("curtain2") if r.random() < 0.5 else K.lib("awning")
                    for k in range(4):
                        a = k * 1.7 + r.uniform(0, 0.4)
                        K.sphere((x + math.cos(a) * 0.12 * s, y + math.sin(a) * 0.12 * s, z + ph + 0.15 * s), 0.045 * s, fl, subdiv=1)
            else:
                K.sphere((x, y, z + ph + 0.22 * s), 0.27 * s, leaf, scale=(1.0, 1.0, 1.05), subdiv=2 if K.tier == "hero" else 1)
                if K.tier == "hero":
                    K.sphere((x + 0.1 * s, y - 0.08 * s, z + ph + 0.38 * s), 0.16 * s, leaf, subdiv=1)


def signboard(K, face, u, z, text, plan, height=0.42, max_w=None):
    """A signboard flat on the wall: a board with a frame, the name painted on its front as a decal (`signs.py`: the
    text rasterized into the board's own image, with its own texels in the bake, so thin letters never vanish)."""
    import signs
    n = nrm(face)
    size = height * 0.62
    _t, tw, th = signs.text_tris(text, size)
    if max_w and tw + height * 0.6 > max_w:
        k = max_w / (tw + height * 0.6)
        size *= k
        height *= k
        _t, tw, th = signs.text_tris(text, size)
    bw = tw + height * 0.6
    lib = K.lib
    mat = signs.decal_material(f"{lib.prefix}_decal_{len(K.parts)}", text, size, lib.colour("sign"), lib.colour("ink"), bw, height,
                               style=lib.style)
    from materials import _wear_nodes
    _wear_nodes(mat, lib.wear)
    with K.part(f"sign_{len(K.parts)}", "back", normal=n):
        K.fbox(face, u, z, bw, 0.05, height, 0.025, K.lib("sign"), skip=("front",))
        K.decal_quad(face, u, z, bw, height, 0.05, lib.slot(mat))
        K.fbox(face, u, z + height / 2 - 0.01, bw + 0.04, 0.06, 0.03, 0.03, K.lib("trim"))
        K.fbox(face, u, z - height / 2 + 0.01, bw + 0.04, 0.06, 0.03, 0.03, K.lib("trim"))
    return bw


def antenna(K, x, y, z, r):
    m = K.lib("metal")
    h = r.uniform(1.8, 2.6)
    with K.part(f"antenna_{len(K.parts)}", "none"):
        with K.no_outline():
            K.cyl((x, y, z - 0.02), 0.03, h, m, seg=5)
            yaw = r.uniform(-0.5, 0.5)
            c, s = math.cos(yaw), math.sin(yaw)
            zb = z + h - 0.15
            K.beam((x - c * 0.2, y - s * 0.2, zb), (x + c * 1.5, y + s * 1.5, zb), 0.018, m, seg=4)
            for k in range(5):
                t = k * 0.32
                half = 0.55 - k * 0.07
                px, py = x + c * t, y + s * t
                K.beam((px + s * half, py - c * half, zb), (px - s * half, py + c * half, zb), 0.011, m, seg=3)
