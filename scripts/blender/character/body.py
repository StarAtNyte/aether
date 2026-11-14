"""The parametric base body: one continuous quad mesh from a skin-modifier graph laid on the fitted skeleton's joints,
subdivided, then shaped by anatomical profiles (the waist, the hips' curve, the calves, the knees).

Radii are for a 1.54 m slim anime girl and scale with the height, the girth (build, gender, age) and the style.
The head is not here (face.py): the neck runs up into it.
"""
import math

import bpy
from mathutils import Vector

from common import activate, apply_modifiers, lerp, new_object, shade_smooth, smoothstep


class Graph:
    def __init__(self):
        self.v = []
        self.r = []
        self.e = []

    def add(self, p, rx, ry=None, parent=None):
        self.v.append(Vector(p))
        self.r.append((rx, ry if ry is not None else rx))
        i = len(self.v) - 1
        if parent is not None:
            self.e.append((parent, i))
        return i

    def chain(self, parent, points):
        last = parent
        out = []
        for p, rx, ry in points:
            last = self.add(p, rx, ry, last)
            out.append(last)
        return out


def build_body(J, spec):
    s = spec['height'] / 1.54
    g = spec['girth'] * s
    male = spec['gender'] == 'male'
    anime = spec['style'] == 'anime'
    fem = 0.0 if male else 1.0
    G = Graph()
    P = J['Bip01_Pelvis']
    sp, sp1, sp2, nk, hd = J['Bip01_Spine'], J['Bip01_Spine1'], J['Bip01_Spine2'], J['Bip01_Neck'], J['Bip01_Head']
    hipw = (0.128 + 0.012 * fem) * g
    # Torso, from the crotch up into the head. Radii x (width) and y (depth).
    crotch = G.add(P + Vector((0, 0.0, -0.075 * s)), 0.1 * g, 0.075 * g)
    pelvis = G.add(P + Vector((0, 0.005, -0.01 * s)), hipw, 0.088 * g, crotch)
    waist_lo = G.add(lerp(P, sp1, 0.5) + Vector((0, 0.004, 0)), lerp(hipw, (0.1 + 0.02 * (1 - fem)) * g, 0.55), 0.074 * g, pelvis)
    waist = G.add(sp1 + Vector((0, 0.0, -0.01 * s)), (0.094 + 0.03 * (1 - fem) - 0.008 * fem) * g, (0.068 - 0.004 * fem) * g, waist_lo)
    chest = G.add(lerp(sp1, sp2, 0.75) + Vector((0, -0.006, 0)), (0.108 + 0.03 * (1 - fem)) * g, 0.078 * g, waist)
    upper = G.add(lerp(sp2, nk, 0.7) + Vector((0, 0.008, 0)), (0.098 + 0.035 * (1 - fem)) * g, 0.068 * g, chest)
    neck0 = G.add(nk + Vector((0, 0.006, 0.012 * s)), (0.04 - 0.003 * fem * anime) * g, (0.039 - 0.002 * fem * anime) * g, upper)
    neck1 = G.add(lerp(nk, hd, 0.75), (0.03 + 0.005 * (1 - fem) - 0.0015 * fem * anime) * s, (0.033 + 0.005 * (1 - fem) - 0.0015 * fem * anime) * s, neck0)
    G.add(hd + Vector((0, 0.01, 0.03 * s)), 0.032 * s, 0.032 * s, neck1)
    # Legs.
    for side in ('L', 'R'):
        th, cf, ft, toe = (J[f'Bip01_{side}_{n}'] for n in ('Thigh', 'Calf', 'Foot', 'Toe0'))
        sx = 1 if side == 'L' else -1
        top = th + Vector((sx * 0.006, 0.004, -0.04 * s))
        legs = []
        for t, rx, ry in ((0.0, 0.074, 0.074), (0.3, 0.066, 0.064), (0.62, 0.054, 0.052), (0.86, 0.045, 0.045)):
            legs.append((lerp(top, cf, t), rx * g, ry * g))
        knee = (cf + Vector((0, -0.006, 0)), 0.043 * g, 0.044 * g)
        calf = []
        for t, rx, ry, dy in ((0.12, 0.043, 0.046, 0.006), (0.3, 0.046, 0.05, 0.01), (0.55, 0.037, 0.039, 0.006), (0.8, 0.028, 0.029, 0.002), (0.95, 0.025, 0.025, 0.0)):
            calf.append((lerp(cf, ft, t) + Vector((0, dy * s, 0)), rx * g, ry * g))
        ids = G.chain(pelvis, legs + [knee] + calf)
        ankle = ids[-1]
        # Foot: heel behind the ankle, the arch to the ball (toe joint) and the toes.
        fwd = Vector((toe.x - ft.x, toe.y - ft.y, 0)).normalized()
        heel = G.add(Vector((ft.x, ft.y, 0.03 * s)) - fwd * 0.03 * s, 0.026 * g, 0.026 * g, ankle)
        mid = G.add(lerp(Vector((ft.x, ft.y, 0.035 * s)), Vector((toe.x, toe.y, 0.025 * s)), 0.5), 0.032 * g, 0.026 * s, ankle)
        ball = G.add(Vector((toe.x, toe.y, 0.021 * s)), 0.036 * g, 0.018 * s, mid)
        G.add(Vector((toe.x, toe.y, 0.016 * s)) + fwd * 0.045 * s, 0.03 * g, 0.012 * s, ball)
    # Arms and hands.
    for side in ('L', 'R'):
        cl, ua, fa, hn = (J[f'Bip01_{side}_{n}'] for n in ('Clavicle', 'UpperArm', 'Forearm', 'Hand'))
        sx = 1 if side == 'L' else -1
        shoulder = G.add(lerp(cl, ua, 0.55) + Vector((0, 0.004, 0.0)), 0.05 * g, 0.045 * g, upper)
        arm = []
        for t, r in ((0.0, 0.043), (0.35, 0.037), (0.75, 0.031)):
            arm.append((lerp(ua, fa, t), r * g, r * g))
        arm.append((fa, 0.028 * g, 0.028 * g))
        for t, rx, ry in ((0.25, 0.032, 0.03), (0.6, 0.026, 0.023), (0.93, 0.021, 0.016)):
            arm.append((lerp(fa, hn, t), rx * g, ry * g))
        ids = G.chain(shoulder, arm)
        wrist = ids[-1]
        hand_s = s * (1.05 if male else 1.0)
        f = {k: J[f'Bip01_{side}_Finger{k}'] for k in FINGER_JOINTS}
        build_hand(G, J, side, wrist, f, hand_s, male)

    ob = new_object('body', G.v, [])
    me = ob.data
    me.from_pydata([], [], [])
    me.clear_geometry()
    me.from_pydata([tuple(v) for v in G.v], G.e, [])
    sk = ob.modifiers.new('skin', 'SKIN')
    sk.use_smooth_shade = True
    sk.branch_smoothing = 0.6
    for i, (rx, ry) in enumerate(G.r):
        d = me.skin_vertices[0].data[i]
        d.radius = (rx, ry)
        d.use_root = i == 0
    sub = ob.modifiers.new('sub', 'SUBSURF')
    sub.levels = spec.get('body_sub', 2)
    sub.quality = 3
    apply_modifiers(ob)
    shade_smooth(ob)
    shape_body(ob, J, spec)
    for side in ('L', 'R'):
        shape_palm(ob, J, side, spec)
    return ob


FINGER_JOINTS = ('0', '01', '02', '1', '11', '12', '2', '21', '22', '3', '31', '32', '4', '41', '42')
# per finger: radius (m at 1.54 m) and the tip's length as a share of the middle phalanx
FINGERS = {'1': (0.0078, 0.74), '2': (0.008, 0.76), '3': (0.0076, 0.74), '4': (0.0068, 0.72)}


def finger_tip(f, k):
    """The fingertip of finger k: beyond its last joint along the last phalanx (the thumb's is shorter)."""
    if k == '0':
        b, c = f['01'], f['02']
        return c + (c - b).normalized() * (c - b).length * 0.62
    b, c = f[k + '1'], f[k + '2']
    return c + (c - b).normalized() * (c - b).length * FINGERS[k][1]


def build_hand(G, J, side, wrist, f, hand_s, male):
    """The hand on the skin graph: a palm and a knuckle bar, four fingers in three phalanges with a slight swell at each
    joint and a thinner shaft between (the knuckles read under the outline), rounded tips; the thumb leaves a fleshy
    base (the ball of the thumb, in the palm) at its knuckle, in two phalanges to a shorter tip."""
    hn = J[f'Bip01_{side}_Hand']
    kmid = lerp(f['2'], f['3'], 0.5)
    palm = G.add(lerp(hn, kmid, 0.5), 0.022 * hand_s, 0.02 * hand_s, wrist)
    knuck = {}
    knuck['2'] = G.add(f['2'], 0.0098 * hand_s, 0.0088 * hand_s, palm)
    knuck['1'] = G.add(f['1'], 0.0096 * hand_s, 0.0088 * hand_s, knuck['2'])
    knuck['3'] = G.add(f['3'], 0.0094 * hand_s, 0.0085 * hand_s, knuck['2'])
    knuck['4'] = G.add(f['4'], 0.0084 * hand_s, 0.008 * hand_s, knuck['3'])
    for k, (r, _) in FINGERS.items():
        r *= hand_s * (1.08 if male else 1.0)
        a, b, c = f[k], f[k + '1'], f[k + '2']
        tip = finger_tip(f, k)
        # an anime finger tapers evenly from the knuckle to a soft tip: the joints only a hair fuller than the shafts
        # (a swell at each joint over a thinner shaft read as a string of beads under the outline)
        G.chain(knuck[k], [
            (lerp(a, b, 0.5), r * 0.98, r * 0.88),
            (b, r * 0.94, r * 0.86),            # the middle knuckle
            (lerp(b, c, 0.5), r * 0.86, r * 0.79),
            (c, r * 0.82, r * 0.76),            # the last knuckle
            (lerp(c, tip, 0.5), r * 0.76, r * 0.7),
            (lerp(c, tip, 0.85), r * 0.62, r * 0.56),
            (tip, r * 0.36, r * 0.32),
        ])
    a, b, c = f['0'], f['01'], f['02']
    tip = finger_tip(f, '0')
    r = 0.0098 * hand_s * (1.08 if male else 1.0)
    # the ball of the thumb: its first bone lies in the palm's flesh, so the thumb leaves the palm at its knuckle (the
    # web to the index is that flesh), not at the wrist
    pc = lerp(hn, kmid, 0.5)
    ball = G.add(lerp(lerp(a, b, 0.55), pc, 0.35), 0.0165 * hand_s, 0.0125 * hand_s, palm)
    G.chain(ball, [
        (b, r * 1.05, r * 0.98),               # the thumb's knuckle
        (lerp(b, c, 0.5), r * 0.95, r * 0.88),
        (c, r * 0.95, r * 0.88),
        (lerp(c, tip, 0.55), r * 0.88, r * 0.8),
        (tip, r * 0.55, r * 0.5),
    ])


def hand_frame(J, side):
    """Origin at the wrist, x toward the middle knuckle, y across toward the index, z = x cross y (the palm side on the
    left hand, the back on the right)."""
    hn = J[f'Bip01_{side}_Hand']
    k2 = J[f'Bip01_{side}_Finger2']
    x = (k2 - hn).normalized()
    y = J[f'Bip01_{side}_Finger1'] - J[f'Bip01_{side}_Finger4']
    y = (y - x * y.dot(x)).normalized()
    z = x.cross(y)
    return hn, x, y, z, (k2 - hn).length


def shape_palm(ob, J, side, spec):
    """Flatten the palm (the skin graph makes it round): wider across, thinner back to front, fading to the wrist and
    out before the lowest knuckle. The fingers and the thumb are left round: widened with the palm, the index and little
    fingers' first phalanges and the thumb were pushed out sideways from their bones, so a straightened hand drew them
    as flat spurs with the finger hooked up at the end."""
    o, x, y, z, L = hand_frame(J, side)
    u_knuckle = min((J[f'Bip01_{side}_Finger{k}'] - o).dot(x) / L for k in '1234')
    thumb = [J[f'Bip01_{side}_Finger0{s}'] for s in ('1', '2')]
    thumb.append(thumb[1] + (thumb[1] - thumb[0]) * 0.62)
    r_thumb = 0.016 * spec['height'] / 1.54
    for v in ob.data.vertices:
        d = v.co - o
        u = d.dot(x) / L
        if u < -0.15 or u > 1.12:
            continue
        a = d.dot(y)
        c = d.dot(z)
        if abs(a) > 0.06 or abs(c) > 0.05:
            continue
        w = smoothstep(-0.15, 0.3, u) * (1 - smoothstep(u_knuckle - 0.12, u_knuckle + 0.02, u))
        if w <= 0:
            continue
        # off the thumb past its knuckle
        dt = min(_seg_dist(v.co, thumb[i], thumb[i + 1]) for i in range(2))
        w *= smoothstep(0.6 * r_thumb, 1.3 * r_thumb, dt)
        a2 = a * (1 + 0.4 * w)
        c2 = c * (1 - 0.4 * w)
        v.co = o + x * d.dot(x) + y * a2 + z * c2


def _seg_dist(p, a, b):
    d = b - a
    t = max(0.0, min(1.0, (p - a).dot(d) / max(1e-12, d.dot(d))))
    return (p - (a + d * t)).length


def shape_body(ob, J, spec):
    """Anatomy passes on the subdivided mesh: front of the shins flatter, buttocks and chest, knee caps."""
    s = spec['height'] / 1.54
    fem = 0.0 if spec['gender'] == 'male' else 1.0
    P = J['Bip01_Pelvis']
    sp2 = J['Bip01_Spine2']
    for v in ob.data.vertices:
        p = v.co
        # buttocks: a soft push back below the pelvis
        if abs(p.x) < 0.16 * s and p.y > 0:
            dz = (p.z - (P.z - 0.06 * s)) / (0.09 * s)
            w = math.exp(-dz * dz) * smoothstep(0.0, 0.05 * s, p.y)
            p.y += 0.012 * s * w * (0.7 + 0.5 * fem) * math.exp(-((abs(p.x) - 0.065 * s) / (0.07 * s)) ** 2)
        # chest (under the blouse it still shapes the cloth)
        if p.y < 0 and abs(p.x) < 0.14 * s:
            dz = (p.z - (sp2.z - 0.005 * s)) / (0.055 * s)
            dx = (abs(p.x) - 0.055 * s) / (0.05 * s)
            p.y -= 0.021 * s * fem * math.exp(-dz * dz - dx * dx) * smoothstep(0.0, -0.04 * s, p.y)


SEGMENTS = [
    ('torso', 'Bip01_Pelvis', 'Bip01_Spine'), ('torso', 'Bip01_Spine', 'Bip01_Spine1'), ('torso', 'Bip01_Spine1', 'Bip01_Spine2'),
    ('torso', 'Bip01_Spine2', 'Bip01_Neck'), ('neck', 'Bip01_Neck', 'Bip01_Head'),
]
for _s in ('L', 'R'):
    SEGMENTS += [
        ('torso', 'Bip01_Neck', f'Bip01_{_s}_UpperArm'), (f'upperarm_{_s}', f'Bip01_{_s}_UpperArm', f'Bip01_{_s}_Forearm'),
        (f'forearm_{_s}', f'Bip01_{_s}_Forearm', f'Bip01_{_s}_Hand'), (f'hand_{_s}', f'Bip01_{_s}_Hand', f'Bip01_{_s}_Finger2'),
        (f'thigh_{_s}', f'Bip01_{_s}_Thigh', f'Bip01_{_s}_Calf'), (f'calf_{_s}', f'Bip01_{_s}_Calf', f'Bip01_{_s}_Foot'),
        (f'foot_{_s}', f'Bip01_{_s}_Foot', f'Bip01_{_s}_Toe0'),
    ]
    for _f in ('0', '1', '2', '3', '4'):
        SEGMENTS.append((f'hand_{_s}', f'Bip01_{_s}_Finger{_f}', f'Bip01_{_s}_Finger{_f}2'))


def labels(ob, J):
    """Each vertex's region (nearest limb segment) and its parameter along that segment."""
    import numpy as np
    co = np.array([v.co[:] for v in ob.data.vertices])
    best = np.full(len(co), 1e9)
    lab = np.empty(len(co), dtype=object)
    tp = np.zeros(len(co))
    for name, a, b in SEGMENTS:
        A = np.array(J[a][:])
        Bv = np.array(J[b][:])
        if name.startswith('foot'):
            Bv = Bv + (Bv - A) * 0.4
        d = Bv - A
        L2 = max(1e-9, d @ d)
        t = np.clip(((co - A) @ d) / L2, 0, 1)
        dist = np.linalg.norm(co - (A + np.outer(t, d)), axis=1)
        if name == 'torso' and a == 'Bip01_Pelvis':
            # the hips reach down to the crotch
            dist = np.minimum(dist, np.linalg.norm(co - (A + np.array([0, 0, -0.06])), axis=1))
        m = dist < best
        best[m] = dist[m]
        lab[m] = name
        tp[m] = t[m]
    return lab, tp
