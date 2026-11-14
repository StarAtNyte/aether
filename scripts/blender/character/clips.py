"""A character's own clips, as Blender actions on the Biped, exported as glTF animations that join the motion set by
name at runtime (packages/render/src/characters/system.ts).

Each starts and ends on the motion set's idle pose (its first frame, sampled by motion-poses.ts), so it blends in and
out of the shared clips; the root keeps the motion set's height (the rig scales it by the body's hip). Poses are made
in glTF terms (character facing +Z, her left +X) with world-axis turns, two-bone IK for the hands and finger curls.

- look_up: the head and neck tip back to look at the sky, a breath, back down.
- hand_to_chest: the right hand comes to rest flat on the chest, the head bows a little, and returns.
- two_fingers: the right hand rises in front of the body to beside the cheek, palm to the front, a V; the head tilts.
- wave: the right forearm raised, the open hand palm to the front, four swings; replaces the motion set's `wave`.
- run_stop: braking from a run: the body leans back, the arms swing forward for balance, settles to the idle.
"""
import math

import bpy
from mathutils import Quaternion, Vector

from rig import GPose, apply_to_armature

FPS = 30
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))


def rad(d):
    return d * math.pi / 180


def hand_frame(W, side):
    """World axes of a hand (glTF): fingers, across toward the index, and their cross product: the palm side on the
    left hand, the back on the right (the frame is mirrored)."""
    h = W[f'Bip01_{side}_Hand'].translation
    k2 = W[f'Bip01_{side}_Finger2'].translation
    x = (k2 - h).normalized()
    y = W[f'Bip01_{side}_Finger1'].translation - W[f'Bip01_{side}_Finger4'].translation
    y = (y - x * y.dot(x)).normalized()
    return x, y, x.cross(y)


def curl(gp, side, finger, angle):
    """Bend a finger's three phalanges toward the palm (a positive angle), the fingers about the hand's across axis,
    the thumb about its long axis (across the palm). hand_frame's z is the palm side on the left hand and the back on
    the right (the frame is mirrored), so a finger bends about -y on the left and +y on the right."""
    for seg in ('', '1', '2'):
        n = f'Bip01_{side}_Finger{finger}{seg}'
        if n not in gp.r:
            continue
        W = gp.world()
        x, y, z = hand_frame(W, side)
        axis = _bend_axis(W, side, n, x, y, z) if finger != '0' else x
        sgn = (1 if side == 'L' else -1) * (1 if finger == '0' else -1)
        gp.rotate_world(n, axis * sgn, angle)


def _plane_angle(d, x, y, z):
    """The angle of `d` in the hand's plane, from the middle finger's line (x) toward the index (y)."""
    d = (d - z * d.dot(z)).normalized()
    return math.atan2(d.dot(y), d.dot(x))


def gather_fingers(gp, side, keep=0.3):
    """Close the fan of the fingers: each phalanx turns in the hand's plane toward the middle finger's line, keeping
    `keep` of its spread (the library Biped's rest hand is spread, and its outer fingers bend away at their joints)."""
    for f in ('1', '3', '4'):
        for seg, nxt in (('', '1'), ('1', '2')):
            W = gp.world()
            x, y, z = hand_frame(W, side)
            n = f'Bip01_{side}_Finger{f}{seg}'
            ang = _plane_angle(W[f'Bip01_{side}_Finger{f}{nxt}'].translation - W[n].translation, x, y, z)
            ang -= _plane_angle(W[f'Bip01_{side}_Finger22'].translation - W[f'Bip01_{side}_Finger2'].translation, x, y, z)
            gp.rotate_world(n, z, -ang * (1 - keep))


def thumb_in(gp, side, lift=-18.0, across=0.0, bend=(10.0, 16.0)):
    """Place the thumb: its root first turns about the hand's across axis by `lift` degrees (toward the palm when
    positive: the library's rest thumb stands well in front of the palm, as if holding something, so at ease it comes
    back toward the index's side), then in the hand's plane by `across` degrees (positive: in over the palm), then
    bends at its two joints toward the palm."""
    sgn = 1 if side == 'L' else -1
    n = f'Bip01_{side}_Finger0'
    curl_joint(gp, side, '0', rad(lift))
    if across:
        W = gp.world()
        x, y, z = hand_frame(W, side)
        gp.rotate_world(n, z, -rad(across))
    for seg, a in zip(('1', '2'), bend):
        W = gp.world()
        x, y, z = hand_frame(W, side)
        gp.rotate_world(f'Bip01_{side}_Finger0{seg}', x * sgn, rad(a))


def relax_hand(gp, side, amount=1.0):
    """The hand at ease: fingers together and softly curled, more toward the little finger (base, middle and tip
    joints each bending a little more than the one before), the thumb beside the index and bent a little."""
    gather_fingers(gp, side, keep=0.15)
    for f, k in (('1', 0.75), ('2', 0.9), ('3', 1.05), ('4', 1.2)):
        for seg, a in (('', 14), ('1', 24), ('2', 14)):
            curl_joint(gp, side, f'{f}{seg}', rad(a * k * amount))
    thumb_in(gp, side, across=20, bend=(10 * amount, 16 * amount))


def curl_joint(gp, side, joint, angle):
    """Bend one finger joint (Finger1, Finger21, ...) toward the palm."""
    W = gp.world()
    x, y, z = hand_frame(W, side)
    n = f'Bip01_{side}_Finger{joint}'
    axis = _bend_axis(W, side, n, x, y, z) if not joint.startswith('0') else y
    gp.rotate_world(n, axis * (-1 if side == 'L' else 1), angle)


def _bend_axis(W, side, n, x, y, z):
    """The hinge of a finger joint: across the finger's own line in the hand's plane (the hand's across axis only for
    the middle finger). Bending every finger about the hand's across axis turned the fanned ring and little fingers
    sideways as they curled, into hooks."""
    base, rest = n.split('Finger')
    base += 'Finger'
    child = base + rest + '1' if len(rest) == 1 else base + rest[0] + '2' if rest[1] == '1' else None
    if child and child in W:
        d = W[child].translation - W[n].translation
    else:
        d = W[n].translation - W[base + rest[0] + '1'].translation
    d = d - z * d.dot(z)
    if d.length < 1e-6:
        return y
    a = z.cross(d.normalized())
    return a if a.dot(y) >= 0 else -a


def orient_hand(gp, side, fingers_to, back_to, twist=0.0):
    """Turn the hand so its fingers point along `fingers_to` and its back faces `back_to` (world). `twist`: the share
    of the turn about the forearm's axis that the forearm takes (pronation), so the wrist does not wring."""
    if twist:
        W = gp.world()
        x, y, z = hand_frame(W, side)
        from mathutils import Matrix
        cur = Matrix((x, y, z)).transposed()
        fx = Vector(fingers_to).normalized()
        fz = (Vector(back_to) - fx * Vector(back_to).dot(fx)).normalized()
        want = Matrix((fx, fz.cross(fx), fz)).transposed()
        q = (want @ cur.inverted()).to_quaternion()
        ax = (W[f'Bip01_{side}_Hand'].translation - W[f'Bip01_{side}_Forearm'].translation).normalized()
        ang = 2 * math.atan2(Vector((q.x, q.y, q.z)).dot(ax), q.w)
        ang = (ang + math.pi) % (2 * math.pi) - math.pi
        gp.rotate_world(f'Bip01_{side}_Forearm', ax, ang * twist)
    W = gp.world()
    x, y, z = hand_frame(W, side)
    from mathutils import Matrix
    cur = Matrix((x, y, z)).transposed()
    fx = Vector(fingers_to).normalized()
    fz = (Vector(back_to) - fx * Vector(back_to).dot(fx)).normalized()
    fy = fz.cross(fx)
    want = Matrix((fx, fy, fz)).transposed()
    d = (want @ cur.inverted()).to_quaternion()
    hq = W[f'Bip01_{side}_Hand'].to_quaternion()
    gp.set_world_rotation(f'Bip01_{side}_Hand', d @ hq)


def spread(gp, side, finger, deg):
    """Set a finger's direction in the hand's plane: `deg` degrees from the middle finger's rest line toward the index
    (negative: toward the little finger)."""
    n = f'Bip01_{side}_Finger{finger}'
    W = gp.world()
    x, y, z = hand_frame(W, side)
    cur = _plane_angle(W[n + '1'].translation - W[n].translation, x, y, z)
    for sgn in (1, -1):
        g = gp.copy()
        g.rotate_world(n, z, sgn * (rad(deg) - cur))
        W2 = g.world()
        x2, y2, z2 = hand_frame(W2, side)
        if abs(_plane_angle(W2[n + '1'].translation - W2[n].translation, x2, y2, z2) - rad(deg)) < rad(2):
            gp.rotate_world(n, z, sgn * (rad(deg) - cur))
            return


def straighten(gp, side, finger):
    """The finger's middle and end phalanges in line with its first: the Biped's phalanges lie along their local x, and
    their rest rotations are the curl, so an identity local rotation is a straight joint."""
    for seg in ('1', '2'):
        n = f'Bip01_{side}_Finger{finger}{seg}'
        if n in gp.r:
            gp.r[n] = Quaternion()


def flatten(gp, side, finger):
    """Lift a finger's first phalanx back into the hand's plane (the idle pose curls the ring and little fingers)."""
    n = f'Bip01_{side}_Finger{finger}'
    W = gp.world()
    x, y, z = hand_frame(W, side)
    d = (W[n + '1'].translation - W[n].translation).normalized()
    want = (d - z * d.dot(z)).normalized()
    ax = d.cross(want)
    if ax.length > 1e-6:
        gp.rotate_world(n, ax.normalized(), d.angle(want))


def palm_normal(gp, side):
    """The world direction the palm faces (found by bending the middle finger: it curls toward the palm)."""
    W = gp.world()
    x, y, z = hand_frame(W, side)
    g = gp.copy()
    curl_joint(g, side, '2', rad(30))
    d = g.world()[f'Bip01_{side}_Finger21'].translation - W[f'Bip01_{side}_Finger21'].translation
    return z if d.dot(z) > 0 else -z


def thumb_to(gp, side, along, toward_index, out_of_palm, bend=(0.0, 0.0)):
    """Point the thumb's first bone along a direction given in the hand's terms (along the fingers, toward the index,
    out in front of the palm), then bend its two joints toward the palm by `bend` degrees."""
    W = gp.world()
    x, y, z = hand_frame(W, side)
    pn = palm_normal(gp, side)
    want = (x * along + y * toward_index + pn * out_of_palm).normalized()
    n = f'Bip01_{side}_Finger0'
    d = (W[n + '1'].translation - W[n].translation).normalized()
    ax = d.cross(want)
    if ax.length > 1e-6:
        gp.rotate_world(n, ax.normalized(), d.angle(want))
    for seg, a in zip(('1', '2'), bend):
        gp.r[f'{n}{seg}'] = Quaternion()
        W = gp.world()
        t = W[f'{n}{seg}'].translation
        # bend toward the palm: about the axis across the thumb and the palm normal
        dd = (W[f'{n}{seg}'].translation - W[n if seg == '1' else n + '1'].translation).normalized()
        axb = dd.cross(pn)
        if axb.length > 1e-6 and a:
            gp.rotate_world(f'{n}{seg}', axb.normalized(), rad(a))


def v_hand(gp, side='R'):
    """The V sign: index and middle straight and apart, ring and little folded into the palm, the thumb over them."""
    for f in ('1', '2', '3', '4'):
        flatten(gp, side, f)
    gather_fingers(gp, side, keep=0.2)
    for f in ('1', '2'):
        straighten(gp, side, f)
    spread(gp, side, '1', 11)
    spread(gp, side, '2', -9)
    for f in ('3', '4'):
        for seg, a in (('', 80), ('1', 100), ('2', 70)):
            curl_joint(gp, side, f'{f}{seg}', rad(a))
    thumb_to(gp, side, 0.35, -0.85, 0.45, bend=(20, 25))


def open_hand(gp, side='R'):
    """An open hand for a wave: the fingers straight and together, a slight natural curl, the thumb beside the index."""
    for f, deg in (('1', 4), ('2', 0), ('3', -3), ('4', -7)):
        flatten(gp, side, f)
        straighten(gp, side, f)
        spread(gp, side, f, deg)
    for f, a in (('1', 4), ('2', 4), ('3', 6), ('4', 8)):
        curl_joint(gp, side, f, rad(a))
    thumb_to(gp, side, 0.9, 0.35, 0.12, bend=(4, 4))


def sheet_pose(rest):
    """The model-sheet stance: the rest pose with the arms let down to hang slightly away from the body."""
    g = rest.copy()
    W = g.world()
    for side, sx in (('L', 1), ('R', -1)):
        ua = W[f'Bip01_{side}_UpperArm'].translation
        fa = W[f'Bip01_{side}_Forearm'].translation
        cur = math.atan2(-(fa - ua).y, abs((fa - ua).x))
        g.rotate_world(f'Bip01_{side}_UpperArm', Z, -sx * (rad(79) - cur))
        g.rotate_world(f'Bip01_{side}_Forearm', X, rad(-8))
        g.rotate_world(f'Bip01_{side}_Hand', Z, -sx * rad(8))
        relax_hand(g, side)
        # the feet a little apart, as a model sheet stands
        g.rotate_world(f'Bip01_{side}_Thigh', Z, -sx * rad(1.0))
        g.rotate_world(f'Bip01_{side}_Foot', Z, sx * rad(1.0))
    return g


def poses(base, spec):
    """Key poses per clip: list of (time s, GPose)."""
    W = base.world()
    head = W['Bip01_Head'].translation
    chest = W['Bip01_Spine2'].translation
    out = {}
    # look_up
    up = base.copy()
    up.rotate_world('Bip01_Spine2', X, rad(-5))
    up.rotate_world('Bip01_Neck', X, rad(-12))
    up.rotate_world('Bip01_Head', X, rad(-20))
    up2 = up.copy()
    up2.rotate_world('Bip01_Head', Z, rad(4))
    out['look_up'] = [(0.0, base), (0.6, up), (1.7, up2), (2.4, base)]
    # hand_to_chest (right hand: -X side)
    hc = base.copy()
    front = 0.11 * spec['height'] / 1.54
    target = chest + Vector((0.02, 0.01, front))
    hc.ik('Bip01_R_UpperArm', 'Bip01_R_Forearm', 'Bip01_R_Hand', target, chest + Vector((-0.3, -0.25, 0.0)))
    orient_hand(hc, 'R', (0.85, 0.35, 0.1), (0.15, 0.0, 1.0))
    # flat on the chest: the idle's curl taken out first (curled further, its ring and little fingers stood off as hooks)
    for f in ('1', '2', '3', '4'):
        flatten(hc, 'R', f)
        straighten(hc, 'R', f)
    gather_fingers(hc, 'R', keep=0.25)
    for f, a in (('1', 7), ('2', 8), ('3', 10), ('4', 12), ('0', 8)):
        curl(hc, 'R', f, rad(a))
    hc.rotate_world('Bip01_Head', X, rad(8))
    hc.rotate_world('Bip01_Spine2', X, rad(3))
    hc2 = hc.copy()
    hc2.rotate_world('Bip01_Head', X, rad(4))
    out['hand_to_chest'] = [(0.0, base), (0.7, hc), (1.8, hc2), (2.5, base)]
    # two_fingers (the sheet's "V sign"): the right hand comes up in front of the body (the forearm rising first, so
    # the arm never swings out to the side), and rests beside her cheek, fingertips at eye level, palm to the front,
    # index and middle straight and apart, ring and little folded under the thumb; the head tilts toward it.
    k = spec['height'] / 1.54
    ua = W['Bip01_R_UpperArm'].translation
    tf = base.copy()
    v_hand(tf)
    mid = tf.copy()
    mid.ik('Bip01_R_UpperArm', 'Bip01_R_Forearm', 'Bip01_R_Hand', chest + Vector((-0.1, 0.06, 0.17)) * k, chest + Vector((-0.25, -0.3, 0.05)))
    orient_hand(mid, 'R', (-0.1, 1.0, 0.25), (-0.15, -0.1, 1.0), twist=0.75)
    tf.ik('Bip01_R_UpperArm', 'Bip01_R_Forearm', 'Bip01_R_Hand', head + Vector((-0.112, -0.045, 0.07)) * k, ua + Vector((-0.12, -0.3, 0.12)))
    orient_hand(tf, 'R', (-0.28, 1.0, 0.05), (-0.2, 0.0, 1.0), twist=0.75)
    tf.rotate_world('Bip01_Head', Z, rad(7))
    tf.rotate_world('Bip01_Head', Y, rad(-6))
    tf.rotate_world('Bip01_Spine2', Z, rad(2))
    tf2 = tf.copy()
    tf2.rotate_world('Bip01_R_Hand', Z, rad(-7))
    tf2.rotate_world('Bip01_Head', Z, rad(2))
    out['two_fingers'] = [(0.0, base), (0.3, mid), (0.6, tf), (1.4, tf2), (2.0, tf), (2.3, mid), (2.7, base)]
    # wave (replaces the shared one: the motion set's wave reads poorly): the forearm raised beside the head, the open
    # hand with its fingers together and its palm to the front, four swings of the forearm about the elbow (in the
    # body's plane, the way a wave reads from the front), eased in and out, from the idle and back to it.
    wv = base.copy()
    open_hand(wv, 'R')
    wmid = wv.copy()
    wmid.ik('Bip01_R_UpperArm', 'Bip01_R_Forearm', 'Bip01_R_Hand', chest + Vector((-0.17, 0.08, 0.14)) * k, ua + Vector((-0.3, -0.25, 0.05)))
    orient_hand(wmid, 'R', (-0.1, 1.0, 0.3), (-0.1, 0.0, 1.0), twist=0.75)
    wv.ik('Bip01_R_UpperArm', 'Bip01_R_Forearm', 'Bip01_R_Hand', ua + Vector((-0.19, 0.17, 0.15)) * k, ua + Vector((-0.35, -0.3, 0.02)))
    orient_hand(wv, 'R', (-0.05, 1.0, 0.08), (-0.05, 0.0, 1.0), twist=0.75)
    wv.rotate_world('Bip01_Head', Z, rad(4))

    def swing(deg):
        g = wv.copy()
        g.rotate_world('Bip01_R_Forearm', Z, rad(deg))
        g.rotate_world('Bip01_R_Hand', Z, rad(deg * 0.35))
        return g
    out['wave'] = [(0.0, base), (0.25, wmid), (0.5, swing(-6)), (0.75, swing(20)), (1.02, swing(-18)), (1.29, swing(20)),
                   (1.56, swing(-18)), (1.83, swing(16)), (2.08, wv), (2.35, wmid), (2.7, base)]
    # run_stop: brake, lean back, arms forward, settle
    rs = base.copy()
    rs.rotate_world('Bip01_Spine', X, rad(-10))
    rs.rotate_world('Bip01_Spine2', X, rad(-6))
    for side, sx in (('L', 1), ('R', -1)):
        rs.rotate_world(f'Bip01_{side}_UpperArm', X, rad(-35))
        rs.rotate_world(f'Bip01_{side}_Forearm', X, rad(-30))
    rs.rotate_world('Bip01_L_Thigh', X, rad(-22))
    rs.rotate_world('Bip01_L_Calf', X, rad(10))
    rs.rotate_world('Bip01_R_Thigh', X, rad(12))
    rs.rotate_world('Bip01_R_Calf', X, rad(28))
    rs.t['Bip01'] = base.t['Bip01'] + Vector((0, -0.05, 0))
    rs2 = base.copy()
    rs2.rotate_world('Bip01_Spine', X, rad(6))
    rs2.rotate_world('Bip01_Head', X, rad(6))
    rs2.t['Bip01'] = base.t['Bip01'] + Vector((0, -0.02, 0))
    out['run_stop'] = [(0.0, rs), (0.35, rs), (0.8, rs2), (1.4, base)]
    return out


def build_actions(arm, base, spec, names):
    """One action per clip, stashed on the armature so the exporter writes each as its own animation."""
    sc = bpy.context.scene
    sc.render.fps = FPS
    arm.animation_data_create()
    made = []
    for name, keys in poses(base, spec).items():
        if name not in names:
            continue
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        arm.animation_data.action = act
        for t, gp in keys:
            apply_to_armature(arm, gp, keyframe=round(t * FPS) + 1)
        track = arm.animation_data.nla_tracks.new()
        track.name = name
        track.strips.new(name, 1, act)
        track.mute = True
        made.append({'name': name, 'duration': keys[-1][0]})
    arm.animation_data.action = None
    return made


def sample_pose(gp_by_clip, name, t):
    """The pose of one of our clips at time t (linear between keys, slerp), for QA."""
    keys = gp_by_clip[name]
    for (t0, a), (t1, b) in zip(keys[:-1], keys[1:]):
        if t <= t1:
            f = 0 if t1 == t0 else (t - t0) / (t1 - t0)
            f = f * f * (3 - 2 * f)
            g = a.copy()
            for n in g.r:
                g.r[n] = a.r[n].slerp(b.r[n], f)
            g.t['Bip01'] = a.t['Bip01'].lerp(b.t['Bip01'], f)
            return g
    return keys[-1][1]
