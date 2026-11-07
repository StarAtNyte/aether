"""Moving extras of Cloudwatch Harbour, exported as their own pieces so the big static pieces stay static:

  train  a two-car local electric multiple unit (an original design: a cream steel body with a teal band, black
         windscreen masks, four double doors a side), built to real size for the 1.067 m gauge: cars 20 m over the
         body, 2.9 m wide, the roof 3.72 m over the rail, the floor at 1.15 m. Tapered cab fronts with raked windscreens,
         headlights and a destination board; recessed windows and doors; a single-arm pantograph raised to the 5 m contact
         wire (form.build_catenary), roof air-conditioners, two bogies a car with wheelsets, side frames, axle boxes and
         springs, underfloor equipment, a bellows gangway and couplers. Built and baked away from the town (over the open
         sea, lit by the sun and the sky alone, nothing to shadow it), then moved to its rest just inside the east tunnel
         for the export. Length along Blender x; its wheels stand on the rail top.
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
GAUGE = 1.067
CAR_L, CAR_W, GAP = 20.0, 2.9, 0.9      # body length, width, gap between the body ends (gangway, couplers)
TRAIN_L = 2 * CAR_L + GAP
FLOOR, SIDE_TOP, ROOF_TOP = 1.15, 3.30, 3.72
CONTACT_WIRE = 5.0                      # contact wire over the rail top (form.build_catenary)
# Where the train is baked: far out over the sea, clear of everything. And where it rests: just inside the east portal.
BAKE_AT = Vector((0.0, -900.0, 60.0))
REST_AT = Vector((PORTAL_X + 1.2 + TRAIN_L / 2 + 1.0, TRACK_Y, RAIL_TOP))

M_BODY, M_STRIPE, M_ROOF, M_GLASS, M_LIT, M_DARK, M_METAL, M_DOOR, M_MASK, M_WHEEL, M_SEAT, M_INWALL, M_FLOOR = range(13)
HW = CAR_W / 2
# The roof's cross-section from the side's top to the centre line (y, z), a shallow arc.
ROOF = [(HW, SIDE_TOP), (HW - 0.04, SIDE_TOP + 0.14), (HW - 0.22, SIDE_TOP + 0.28), (HW - 0.6, SIDE_TOP + 0.37), (0.0, ROOF_TOP)]
BODY_BOT = 1.0


def _quad(bm, a, b, c, d, mi):
    f = bm.faces.new([bm.verts.new(p) for p in (a, b, c, d)])
    f.material_index = mi
    return f


def _side(bm, x0, x1, s, cells):
    """One body side (y = s * HW, outward normal s) from x0 to x1, z from BODY_BOT to SIDE_TOP. `cells` are recessed
    openings (xa, xb, za, zb, depth, back material, inner bands [(za, zb, material)]) cut into it: the wall around them is
    built as strips, each opening as four reveal faces and a back panel `depth` behind the wall plane."""
    y = s * HW

    def P(x, z, d=0.0):
        return (x, y - s * d, z)

    def wall(xa, xb, za, zb, mi=M_BODY):
        if xb - xa < 1e-4 or zb - za < 1e-4:
            return
        f = _quad(bm, P(xa, za), P(xb, za), P(xb, zb), P(xa, zb), mi)
        if s > 0:
            f.normal_flip()

    cells = sorted(cells)
    xs = x0
    for (xa, xb, za, zb, dep, back, bands) in cells:
        wall(xs, xa, BODY_BOT, SIDE_TOP)
        wall(xa, xb, BODY_BOT, za)
        wall(xa, xb, zb, SIDE_TOP)
        # Reveals (facing into the opening) and the back panel.
        for (p, q) in (((xa, za), (xb, za)), ((xb, za), (xb, zb)), ((xb, zb), (xa, zb)), ((xa, zb), (xa, za))):
            f = _quad(bm, P(p[0], p[1]), P(q[0], q[1]), P(q[0], q[1], dep), P(p[0], p[1], dep), M_DARK)
            if s > 0:
                f.normal_flip()
        if back is None:
            xs = xb
            continue  # an open window: the interior shows through it
        for (ba, bb, bmi) in (bands or [(za, zb, back)]):
            f = _quad(bm, P(xa, ba, dep), P(xb, ba, dep), P(xb, bb, dep), P(xa, bb, dep), bmi)
            if s > 0:
                f.normal_flip()
        xs = xb
    wall(xs, x1, BODY_BOT, SIDE_TOP)


def _ring(x, sy=1.0, rake=0.0, z_cut=0.0):
    """The body's closed cross-section at x (bottom edge first, then up the -y side, over the roof, down the +y side),
    scaled in y by sy; points above z_cut pulled back in x by rake per metre (a raked windscreen)."""
    half = [(HW, BODY_BOT), (HW, 1.95)] + ROOF
    pts = [(-p[0], p[1]) for p in half] + [(p[0], p[1]) for p in reversed(half[:-1])]
    out = []
    for (py, pz) in pts:
        dx = -rake * max(0.0, pz - z_cut)
        out.append(Vector((x + dx, py * sy, pz)))
    return out


def _loft(bm, rings, mi, flip=False):
    """Quads between consecutive rings of equal length; the last ring is returned (for its cap)."""
    vs = [[bm.verts.new(p) for p in r] for r in rings]
    n = len(rings[0])
    for a, b in zip(vs[:-1], vs[1:]):
        for i in range(n):
            j = (i + 1) % n
            f = bm.faces.new((a[i], a[j], b[j], b[i]))
            f.material_index = mi
            if flip:
                f.normal_flip()
    return vs


def _bogie(bm, bx):
    """A bogie centred at x = bx: two wheelsets (0.86 m wheels on the gauge), outside side frames with axle boxes and
    coil springs, a bolster, brake units."""
    wb = 2.1
    for wx in (bx - wb / 2, bx + wb / 2):
        for s in (-1, 1):
            yc = s * (GAUGE / 2 + 0.035)
            add_cylinder(bm, (wx, yc - s * 0.065, 0.43), 0.43, 0.13, segments=14, mat_index=M_WHEEL, axis=(0, s, 0))
            add_cylinder(bm, (wx, yc + s * 0.07, 0.43), 0.2, 0.06, segments=8, mat_index=M_METAL, axis=(0, s, 0))  # hub
        add_cylinder(bm, (wx, -0.9, 0.43), 0.07, 1.8, segments=6, mat_index=M_METAL, axis=(0, 1, 0))  # axle
    for s in (-1, 1):
        yf = s * 0.98
        add_box(bm, (bx, yf, 0.72), (wb + 0.9, 0.16, 0.22), mat_index=M_DARK)        # side frame
        add_box(bm, (bx, yf, 0.56), (0.9, 0.16, 0.2), mat_index=M_DARK)              # its dropped centre
        for wx in (bx - wb / 2, bx + wb / 2):
            add_box(bm, (wx, yf, 0.45), (0.34, 0.2, 0.26), mat_index=M_METAL)         # axle box
            add_cylinder(bm, (wx, yf, 0.58), 0.09, 0.12, segments=6, mat_index=M_METAL)  # axle spring
            add_box(bm, (wx + (0.32 if wx > bx else -0.32), s * 0.72, 0.5), (0.22, 0.2, 0.22), mat_index=M_DARK)  # brake
        add_cylinder(bm, (bx, s * 0.98, 0.84), 0.16, 0.2, segments=8, mat_index=M_DARK)  # air spring
    add_box(bm, (bx, 0.0, 0.86), (0.5, 2.1, 0.2), mat_index=M_DARK)  # bolster
    add_box(bm, (bx - 0.6, 0.0, 0.6), (0.7, 0.9, 0.36), mat_index=M_DARK)  # traction motor


def _pantograph(bm, px, zr):
    """A single-arm pantograph raised to the contact wire, on four insulators; the arm folds toward -x."""
    add_box(bm, (px, 0.0, zr + 0.28), (1.6, 1.2, 0.08), mat_index=M_DARK)  # base frame
    for dx in (-0.6, 0.6):
        for dy in (-0.45, 0.45):
            add_cylinder(bm, (px + dx, dy, zr), 0.06, 0.24, segments=6, mat_index=M_METAL)
    zh = RAIL_TOP + CONTACT_WIRE - RAIL_TOP  # head height over the rail top (local z: rail top = 0)
    hinge = Vector((px + 0.65, 0.0, zr + 0.36))
    knee = Vector((px - 0.75, 0.0, zr + 0.36 + (zh - zr - 0.36) * 0.52))
    head = Vector((px + 0.05, 0.0, zh - 0.12))
    for dy in (-0.32, 0.32):
        a, b = hinge + Vector((0, dy, 0)), knee + Vector((0, dy * 0.5, 0))
        add_cylinder(bm, a, 0.04, (b - a).length, segments=5, mat_index=M_METAL, axis=b - a)  # lower arm
    a = knee
    add_cylinder(bm, a, 0.03, (head - a).length, segments=5, mat_index=M_METAL, axis=head - a)  # upper arm
    add_cylinder(bm, hinge, 0.025, (knee - hinge).length * 0.95, segments=4, mat_index=M_METAL,
                 axis=(knee - hinge) + Vector((0, 0, -0.25)))  # the drive rod
    add_cylinder(bm, (px - 0.25, 0.0, zr + 0.3), 0.1, 0.6, segments=6, mat_index=M_DARK, axis=(1, 0, 0))  # raising spring
    # Collector head: two contact strips across, horns curving down at the ends.
    for dx in (-0.12, 0.12):
        add_box(bm, (head.x + dx, 0.0, zh - 0.02), (0.06, 1.1, 0.05), mat_index=M_DARK)
    for s in (-1, 1):
        a = Vector((head.x, s * 0.55, zh - 0.02))
        b = Vector((head.x, s * 0.82, zh - 0.18))
        add_cylinder(bm, a, 0.022, (b - a).length, segments=4, mat_index=M_METAL, axis=b - a)
    add_box(bm, (head.x, 0.0, zh - 0.1), (0.12, 0.5, 0.08), mat_index=M_METAL)


def _car(bm, x0, lead, pantograph, seed, interior=False):
    """One car from x0 (its -x end) to x0 + CAR_L. lead: +1 / -1 for a cab at that end, 0 none. Wheels on z = 0."""
    L = CAR_L
    xc = x0 + L / 2
    cab_x = x0 + (L if lead > 0 else 0.0) if lead else None
    nose = 0.9  # the cab's tapered length
    xa = x0 + (nose if lead < 0 else 0.0)
    xb = x0 + L - (nose if lead > 0 else 0.0)
    # Doors: four double doors a side (1.3 m), windows between them, a narrow window or the cab door at each end.
    door_u = [3.2, 7.95, 12.05, 16.8]
    if lead < 0:
        door_u = [L - u for u in reversed(door_u)]
    doors = [x0 + u for u in door_u]
    for s in (-1, 1):
        cells = []
        for d in doors:
            # Door: recessed 4 cm, its window in the upper part, a dark seam between the leaves.
            cells.append((d - 0.65, d + 0.65, FLOOR - 0.05, FLOOR + 1.85, 0.04, M_DOOR,
                          [(FLOOR - 0.05, FLOOR + 0.95, M_DOOR), (FLOOR + 0.95, FLOOR + 1.6, M_GLASS), (FLOOR + 1.6, FLOOR + 1.85, M_DOOR)]))
        bays = [(doors[i] + 0.95, doors[i + 1] - 0.95) for i in range(3)]
        lit_k = 0
        for bi, (a, b) in enumerate(bays):
            n = 2
            w = (b - a - 0.35) / n
            for i in range(n):
                wa = a + i * (w + 0.35)
                lit = (lit_k + seed + (s > 0)) % 3 != 0
                back = M_LIT if lit else M_GLASS
                if interior and s < 0 and bi == 1:
                    back = None  # the sea side's middle bay of this car: open windows onto a lit interior
                    INTERIOR_WINDOWS.append((wa, wa + w, FLOOR + 0.85, FLOOR + 1.75))
                cells.append((wa, wa + w, FLOOR + 0.85, FLOOR + 1.75, 0.07, back, None))
                lit_k += 1
        if interior and s < 0:
            _interior(bm, bays[1][0] - 0.3, bays[1][1] + 0.3)
        # End bays: a narrow window toward a gangway end, the cab's side window toward a cab.
        for (ea, eb, is_cab) in ((max(xa, x0) + 0.5, doors[0] - 0.95, lead < 0), (doors[-1] + 0.95, min(xb, x0 + L) - 0.5, lead > 0)):
            if eb - ea < 0.4:
                continue
            if is_cab:
                cells.append((ea, eb, FLOOR + 0.8, FLOOR + 1.8, 0.04, M_GLASS, None))
            else:
                cells.append((ea, eb, FLOOR + 0.85, FLOOR + 1.75, 0.07, M_GLASS, None))
        _side(bm, xa, xb, s, cells)
        # The teal band under the windows and a thin one over them, proud of the wall.
        y = s * (HW + 0.006)
        for (zb, h) in ((FLOOR + 0.62, 0.16), (FLOOR + 1.86, 0.05)):
            for (sa, sb) in _spans(xa, xb, [(d - 0.68, d + 0.68) for d in doors]):
                add_box(bm, ((sa + sb) / 2, y, zb), (sb - sa, 0.012, h), mat_index=M_STRIPE)
        # Rain gutter along the cant rail.
        add_box(bm, (xc, s * (HW + 0.02), SIDE_TOP + 0.02), (L - 0.3, 0.05, 0.05), mat_index=M_ROOF)
    # Roof (over the straight part) and underside.
    rr = [Vector((xa, -p[0], p[1])) for p in ROOF] + [Vector((xa, p[0], p[1])) for p in reversed(ROOF[:-1])]
    ra = [bm.verts.new(p) for p in rr]
    rb = [bm.verts.new((xb, p.y, p.z)) for p in rr]
    for i in range(len(rr) - 1):
        f = bm.faces.new((ra[i], rb[i], rb[i + 1], ra[i + 1]))
        f.material_index = M_ROOF
    _quad(bm, (xa, -HW, BODY_BOT), (xa, HW, BODY_BOT), (xb, HW, BODY_BOT), (xb, -HW, BODY_BOT), M_DARK)
    # Ends: a cab nose (lofted, tapered in plan, the windscreen raked) or a flat gangway end.
    for end, xe, is_cab in ((-1, x0, lead < 0), (1, x0 + L, lead > 0)):
        if is_cab:
            f = end
            xs = xe - f * nose
            stations = [(xs, 1.0, 0.0), (xe - f * 0.5, 0.985, 0.08), (xe - f * 0.2, 0.95, 0.2), (xe, 0.9, 0.3)]
            rings = []
            for (x, sy, rk) in stations:
                rings.append(_ring(x, sy, rake=f * rk, z_cut=1.95))
            # (A ring runs up the -y side, over the roof and down the +y side: lofted toward +x its quads face in.)
            vs = _loft(bm, rings, M_BODY, flip=f > 0)
            fc = bm.faces.new(list(reversed(vs[-1])) if f > 0 else vs[-1])
            fc.material_index = M_BODY
            _cab_face(bm, xe, f)
        else:
            fq = _quad(bm, (xe, -HW, BODY_BOT), (xe, HW, BODY_BOT), (xe, HW, SIDE_TOP), (xe, -HW, SIDE_TOP), M_BODY)
            if end < 0:
                fq.normal_flip()
            prof = [Vector((xe, -p[0], p[1])) for p in ROOF] + [Vector((xe, p[0], p[1])) for p in reversed(ROOF[:-1])]
            fc = bm.faces.new([bm.verts.new(p) for p in prof])
            fc.material_index = M_BODY
            if end > 0:
                fc.normal_flip()
            add_box(bm, (xe + end * 0.02, 0.0, FLOOR + 0.95), (0.04, 0.9, 1.9), mat_index=M_DOOR)  # the end door
            add_box(bm, (xe + end * 0.035, 0.0, FLOOR + 1.45), (0.03, 0.5, 0.6), mat_index=M_GLASS)
            add_box(bm, (xe + end * 0.25, 0.0, 0.78), (0.5, 0.26, 0.2), mat_index=M_METAL)  # coupler
    # Underframe: the solebar, equipment cases between the bogies, a skirt at a cab end.
    add_box(bm, (xc, 0.0, BODY_BOT - 0.06), (L - 0.6, CAR_W - 0.2, 0.12), mat_index=M_DARK)
    r = (seed * 7919) % 97
    x = x0 + 5.2
    k = 0
    while x < x0 + L - 5.6:
        ln = 1.2 + ((r + k * 13) % 5) * 0.3
        hh = 0.45 + ((r + k * 7) % 3) * 0.1
        w = CAR_W - 0.7 - ((r + k) % 2) * 0.4
        add_box(bm, (x + ln / 2, 0.0, BODY_BOT - 0.12 - hh / 2), (ln, w, hh), mat_index=M_DARK if k % 2 else M_METAL)
        x += ln + 0.35
        k += 1
    for bx in (x0 + 3.1, x0 + L - 3.1):
        _bogie(bm, bx)
    if lead:
        # The skirt (a low steel plough under the cab, slanted back) and the coupler.
        sk = add_box(bm, (cab_x - lead * 0.12, 0.0, 0.62), (0.08, CAR_W - 0.7, 0.42), mat_index=M_DARK)
        from common import rotate_faces
        rotate_faces(sk, (cab_x - lead * 0.12, 0.0, 0.62), lead * math.radians(-14), "Y")
        add_box(bm, (cab_x + lead * 0.2, 0.0, 0.78), (0.5, 0.26, 0.2), mat_index=M_METAL)  # coupler
    # Roof: two air-conditioning units (a fan grille on each), the pantograph on the motor car.
    for u in (0.3, 0.7):
        ax = x0 + L * u
        add_box(bm, (ax, 0.0, ROOF_TOP + 0.12), (2.6, 1.9, 0.3), mat_index=M_ROOF)
        add_box(bm, (ax, 0.0, ROOF_TOP + 0.28), (2.3, 1.6, 0.04), mat_index=M_METAL)
        for dx in (-0.6, 0.6):
            add_cylinder(bm, (ax + dx, 0.0, ROOF_TOP + 0.3), 0.36, 0.02, segments=10, mat_index=M_DARK)
    if pantograph:
        _pantograph(bm, x0 + L * 0.5, ROOF_TOP - 0.02)
        # Roof cables from the pantograph to the hatch.
        add_box(bm, (x0 + L * 0.5 + 1.6, 0.45, ROOF_TOP + 0.05), (2.0, 0.06, 0.06), mat_index=M_METAL)


INTERIOR_WINDOWS = []  # (x0, x1, z0, z1) of the open windows, in the train's frame (x along, z over the rail top)


def _interior(bm, xa, xb):
    """The saloon behind the open windows: a floor at FLOOR, the far wall, the ceiling with a warm light strip, bulkheads
    closing the bay, longitudinal bench seats along both walls with grab poles, so a figure standing at the window reads
    from outside. Faces turned inward."""
    y0, y1 = -HW + 0.08, HW - 0.08
    zc = SIDE_TOP - 0.18

    def q(a, b, c, d, mi):
        _quad(bm, a, b, c, d, mi)
    q((xa, y0, FLOOR), (xb, y0, FLOOR), (xb, y1, FLOOR), (xa, y1, FLOOR), M_FLOOR)           # floor, facing up
    q((xa, y0, zc), (xa, y1, zc), (xb, y1, zc), (xb, y0, zc), M_INWALL)                     # ceiling, facing down
    q((xa, y1, FLOOR), (xb, y1, FLOOR), (xb, y1, zc), (xa, y1, zc), M_INWALL)               # far wall, facing -y
    q((xa, y0, FLOOR), (xa, y1, FLOOR), (xa, y1, zc), (xa, y0, zc), M_INWALL)               # bulkheads, facing in
    q((xb, y0, FLOOR), (xb, y0, zc), (xb, y1, zc), (xb, y1, FLOOR), M_INWALL)
    # The light strip down the ceiling (a practical: it lights the saloon in the bake and glows at dusk).
    add_box(bm, ((xa + xb) / 2, 0.0, zc - 0.03), (xb - xa - 0.4, 0.35, 0.05), mat_index=M_LIT)
    for sy in (-1, 1):
        yb = sy * (HW - 0.38)
        add_box(bm, ((xa + xb) / 2, yb, FLOOR + 0.22), (xb - xa - 0.5, 0.5, 0.44), mat_index=M_SEAT)      # seat base
        add_box(bm, ((xa + xb) / 2, yb, FLOOR + 0.48), (xb - xa - 0.5, 0.52, 0.1), mat_index=M_SEAT)      # cushion
        add_box(bm, ((xa + xb) / 2, sy * (HW - 0.16), FLOOR + 0.78), (xb - xa - 0.5, 0.08, 0.5), mat_index=M_SEAT)  # back
        for px in (xa + 0.5, (xa + xb) / 2, xb - 0.5):
            add_cylinder(bm, (px, sy * (HW - 0.7), FLOOR), 0.02, zc - FLOOR, segments=6, mat_index=M_METAL)  # grab pole
    add_cylinder(bm, (xa + 0.3, -0.5, zc - 0.25), 0.015, xb - xa - 0.6, segments=5, mat_index=M_METAL, axis=(1, 0, 0))
    add_cylinder(bm, (xa + 0.3, 0.5, zc - 0.25), 0.015, xb - xa - 0.6, segments=5, mat_index=M_METAL, axis=(1, 0, 0))


def _spans(a, b, holes):
    out, x = [], a
    for (ha, hb) in sorted(holes):
        if ha > x:
            out.append((x, min(ha, b)))
        x = max(x, hb)
    if x < b:
        out.append((x, b))
    return [s for s in out if s[1] - s[0] > 0.02]


def _cab_face(bm, xe, f):
    """The cab front on the nose's end face (x = xe, looking +f): a black mask around a two-pane raked windscreen, the
    destination board over it, headlights and tail lights low, the number plate, the coupler."""
    def P(y, z, out=0.012):
        rake = 0.3 * max(0.0, z - 1.95)
        return (xe - f * rake + f * out, y * 0.9, z)

    def panel(y0, y1, z0, z1, mi, out):
        f2 = _quad(bm, P(y0, z0, out), P(y1, z0, out), P(y1, z1, out), P(y0, z1, out), mi)
        if f < 0:
            f2.normal_flip()
    panel(-HW + 0.12, HW - 0.12, 1.85, 3.05, M_MASK, 0.012)       # the black FRP mask
    for (y0, y1) in ((-HW + 0.22, -0.08), (0.08, HW - 0.22)):
        panel(y0, y1, 2.0, 2.92, M_GLASS, 0.02)                    # windscreen panes
    panel(-0.55, 0.55, 3.0, 3.2, M_LIT, 0.03)                      # destination board
    for s in (-1, 1):
        panel(s * 1.0 - 0.17, s * 1.0 + 0.17, 1.42, 1.62, M_LIT, 0.02)  # headlight
        panel(s * 0.62 - 0.1, s * 0.62 + 0.1, 1.45, 1.59, M_DARK, 0.02)  # tail light (off)
    panel(-0.3, 0.3, 1.25, 1.4, M_METAL, 0.02)                     # number plate
    # The teal band across the front.
    panel(-HW + 0.05, HW - 0.05, FLOOR + 0.55, FLOOR + 0.71, M_STRIPE, 0.014)


def build_train():
    """The train as one object (`train`) at BAKE_AT, hidden in renders (the bake makes its own copy)."""
    def mat(name, *a, **k):
        # In the bake the .blend already holds the town's materials: reuse them (the lit windows stay one practical).
        return bpy.data.materials.get(name) or toon_material(name, *a, **k)
    mats = [
        mat("train_body", "#efe6cf"),
        mat("train_stripe", "#2f8a8a"),
        mat("train_roof", "#9a9aa2"),
        mat("train_glass", "#34425f"),
        mat("window_lit", "#ffcf7a", emission="#ffcf7a", emission_strength=2.2),
        mat("train_dark", "#3a3640"),
        mat("train_metal", "#7d7a82"),
        mat("train_door", "#e2d8bf"),
        mat("train_mask", "#22202a"),
        mat("train_wheel", "#5a5560"),
        mat("train_seat", "#9a4a44", var="#a8564d", noise_scale=6),
        mat("train_inwall", "#ece4d2"),
        mat("train_floor", "#8a8272"),
    ]
    INTERIOR_WINDOWS.clear()
    bm = bmesh.new()
    _car(bm, -TRAIN_L / 2, -1, True, 0, interior=True)
    _car(bm, -TRAIN_L / 2 + CAR_L + GAP, 1, False, 1)
    # The gangway: a bellows between the end doors, ribbed, and the couplers' bar.
    gx = -TRAIN_L / 2 + CAR_L + GAP / 2
    add_box(bm, (gx, 0.0, FLOOR + 1.0), (GAP + 0.02, 1.25, 2.1), mat_index=M_DARK)
    for k in range(5):
        add_box(bm, (gx - GAP / 2 + 0.1 + k * (GAP - 0.2) / 4, 0.0, FLOOR + 1.0), (0.04, 1.31, 2.16), mat_index=M_METAL)
    add_box(bm, (gx, 0.0, 0.78), (GAP + 0.3, 0.2, 0.14), mat_index=M_METAL)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    ob = bm_object("train", bm, "train", mats=mats, outline=True, recalc=False)
    ob.location = BAKE_AT
    ob.hide_render = True
    return ob


def rest_offset():
    """The move from the bake position to the rest position (applied to the baked piece before export)."""
    return REST_AT - BAKE_AT
