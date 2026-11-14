"""Skin weights, the join into one body, and posing in the glTF terms of the motion set.

Weights: automatic (bone heat) on a helper armature whose bones point at their child joints (the Biped's own bone
orientations are arbitrary, so heat would be wrong on them), then fixes: hands and fingers kept to their own chain, the
head rigid, a smoothing pass for the shoulders and hips, at most four influences, normalized. Garments extracted from
the body carry its weights; the others take them from the nearest body surface; secondary parts (hair locks, skirt
panels, tie tails, the braid) have theirs from their builders.
"""
import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

from common import B2G, G2B, activate
from skeleton import build_armature, quat

MAIN = r'^Bip01'


def body_weights(body, main_bones):
    """Bone heat on the body with the helper armature; returns per-vertex {bone: weight}."""
    helper = build_armature(main_bones, 'weights-helper', nice=True)
    # no heat on the root and the pelvis/spine roots that have no length to speak of
    activate(helper)
    bpy.ops.object.mode_set(mode='EDIT')
    for eb in helper.data.edit_bones:
        eb.use_deform = eb.name not in ('Bip01',)
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in bpy.context.selected_objects:
        o.select_set(False)
    body.select_set(True)
    helper.select_set(True)
    bpy.context.view_layer.objects.active = helper
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    for m in list(body.modifiers):
        body.modifiers.remove(m)
    body.parent = None
    names = [g.name for g in body.vertex_groups]
    n = len(body.data.vertices)
    M = np.zeros((n, len(names)), np.float32)
    for v in body.data.vertices:
        for g in v.groups:
            M[v.index, g.group] = g.weight
    unweighted = int((M.sum(1) < 1e-4).sum())
    # smoothing (shoulders, hips and every joint): two passes of neighbour averaging over the mesh edges
    e = np.array([ed.vertices[:] for ed in body.data.edges])
    for _ in range(2):
        acc = np.zeros_like(M)
        cnt = np.zeros(n, np.float32)
        np.add.at(acc, e[:, 0], M[e[:, 1]])
        np.add.at(acc, e[:, 1], M[e[:, 0]])
        np.add.at(cnt, e[:, 0], 1)
        np.add.at(cnt, e[:, 1], 1)
        M = 0.5 * M + 0.5 * acc / np.maximum(cnt, 1)[:, None]
    W = []
    for i in range(n):
        row = M[i]
        idx = np.argsort(-row)[:4]
        w = {names[j]: float(row[j]) for j in idx if row[j] > 1e-3}
        W.append(top4(w) if w else {})
    for g in list(body.vertex_groups):
        body.vertex_groups.remove(g)
    bpy.data.objects.remove(helper)
    return W, unweighted


def fix_body_weights(body, W, lab):
    """Region fixes: hands keep to the hand chain, the feet to the foot, no stray weights across the body."""
    allowed = {
        'hand': ('Hand', 'Finger', 'Forearm'), 'forearm': ('Forearm', 'UpperArm', 'Hand'), 'upperarm': ('UpperArm', 'Clavicle', 'Forearm', 'Spine2'),
        'thigh': ('Thigh', 'Calf', 'Pelvis', 'Spine'), 'calf': ('Calf', 'Thigh', 'Foot'), 'foot': ('Foot', 'Toe0', 'Calf'), 'neck': ('Neck', 'Head', 'Spine2'),
    }
    for i, w in enumerate(W):
        key = lab[i].split('_')[0]
        side = lab[i].split('_')[1] if '_' in lab[i] else None
        if key in allowed:
            keep = {}
            for b, x in w.items():
                ok = any(a in b for a in allowed[key]) and (side is None or f'_{side}_' in b or not any(f'_{s}_' in b for s in 'LR'))
                if ok:
                    keep[b] = x
            if not keep:
                keep = {f'Bip01_{side}_' + {'hand': 'Hand', 'forearm': 'Forearm', 'upperarm': 'UpperArm', 'thigh': 'Thigh', 'calf': 'Calf', 'foot': 'Foot'}[key] if side else 'Bip01_Neck': 1.0}
            W[i] = keep
        W[i] = top4(W[i])
    return W


def finger_weights(body, W, lab, J):
    """Each finger on its own chain: bone heat (and the smoothing after it) spreads a finger's weights onto the finger
    beside it, so a curl dragged the neighbour's tip along and a straight hand drew its ring and little fingers hooked.
    Every hand vertex past a knuckle goes to the nearest finger only, each phalanx rigid on its bone and blended across
    the joint over a fifth of the phalanx on either side; at the knuckle it blends from the hand, and the thumb's first
    bone (lying in the palm's flesh, the ball of the thumb) takes over from the hand along its length. The palm keeps
    the heat weights."""
    from body import FINGER_JOINTS, finger_tip
    co = np.array([v.co[:] for v in body.data.vertices])
    sm = lambda e0, e1, x: (lambda t: t * t * (3 - 2 * t))(np.clip((x - e0) / (e1 - e0), 0, 1))  # noqa: E731
    for side in ('L', 'R'):
        idx = np.array([i for i, l in enumerate(lab) if l.startswith('hand') and l.endswith(side)])
        if len(idx) == 0:
            continue
        P = co[idx]
        f = {k: np.array(J[f'Bip01_{side}_Finger{k}'][:]) for k in FINGER_JOINTS}
        best = np.full(len(idx), 1e9)
        out = [None] * len(idx)
        # farther from every finger's axis than this is the palm or the back of the hand
        cap = 0.55 * float(np.linalg.norm(f['21'] - f['2']))
        for k in ('0', '1', '2', '3', '4'):
            pts = [f[k], f[k + '1'], f[k + '2'], np.array(finger_tip(_vec(f), k)[:])]
            bones = [f'Bip01_{side}_Finger{k}', f'Bip01_{side}_Finger{k}1', f'Bip01_{side}_Finger{k}2']
            for s_i in range(3):
                A, B = pts[s_i], pts[s_i + 1]
                d = B - A
                L2 = max(1e-12, d @ d)
                traw = ((P - A) @ d) / L2
                t = np.clip(traw, 0, 1)
                dist = np.linalg.norm(P - (A + np.outer(t, d)), axis=1)
                if s_i == 0 and k != '0':
                    # before the knuckle is the palm: not a finger's
                    dist = np.where(traw < -0.05, 1e9, dist)
                if s_i == 2:
                    dist = np.where(traw > 1.6, 1e9, dist)
                dist = np.where(dist > cap, 1e9, dist)
                m = dist < best
                best[m] = dist[m]
                for j in np.nonzero(m)[0]:
                    out[j] = (k, s_i, float(traw[j]), bones)
        for j, i in enumerate(idx):
            if out[j] is None:
                continue
            k, s_i, t, bones = out[j]
            w = {}
            if s_i == 0 and k == '0':
                # the ball of the thumb: from the hand to the thumb's first bone along it
                a = float(sm(0.2, 1.0, t))  # most of the ball stays with the palm as the thumb crosses it
                w = {f'Bip01_{side}_Hand': 1 - a, bones[0]: a}
                b = float(sm(0.85, 1.15, t))
                if b > 0:
                    w = {f'Bip01_{side}_Hand': (1 - a) * (1 - b), bones[0]: a * (1 - b) + 0.5 * b, bones[1]: 0.5 * b}
            elif s_i == 0:
                a = float(sm(-0.05, 0.2, t))
                b = float(sm(0.8, 1.2, t))
                w = {f'Bip01_{side}_Hand': 1 - a, bones[0]: a * (1 - 0.5 * b), bones[1]: a * 0.5 * b}
            else:
                lo = float(sm(-0.2, 0.2, t))   # across the joint at the segment's start
                hi = float(sm(0.8, 1.2, t)) if s_i == 1 else 0.0
                w = {bones[s_i - 1]: 0.5 * (1 - lo), bones[s_i]: 0.5 + 0.5 * lo - 0.5 * hi}
                if hi > 0:
                    w[bones[2]] = 0.5 * hi
            W[i] = top4({b: x for b, x in w.items() if x > 1e-3})
    return W


def _vec(f):
    return {k: Vector(v.tolist()) for k, v in f.items()}


def top4(w):
    items = sorted(w.items(), key=lambda kv: -kv[1])[:4]
    s = sum(x for _, x in items) or 1
    return {b: x / s for b, x in items}


def assign(ob, W):
    for g in list(ob.vertex_groups):
        ob.vertex_groups.remove(g)
    for i, w in enumerate(W):
        for b, x in w.items():
            g = ob.vertex_groups.get(b) or ob.vertex_groups.new(name=b)
            g.add([i], x, 'REPLACE')


def weight_part(part, kit_or_none, weights_at):
    """Vertex groups of a part from its spec: fixed dict, existing groups, or the nearest body surface."""
    ob = part.ob
    if isinstance(part.bones, dict):
        for g in list(ob.vertex_groups):
            ob.vertex_groups.remove(g)
        for b, x in part.bones.items():
            g = ob.vertex_groups.new(name=b)
            g.add(list(range(len(ob.data.vertices))), x, 'REPLACE')
    elif part.bones in ('nearest', 'torso'):
        W = [top4(weights_at(v.co, trunk=part.bones == 'torso')) for v in ob.data.vertices]
        assign(ob, W)


def join(parts, body, keys):
    """All parts into the body object: one mesh, shape keys merged by name, attributes and UVs kept."""
    if body.data.shape_keys is None:
        body.shape_key_add(name='Basis')
        for k in keys:
            body.shape_key_add(name=k)
    for p in parts:
        ob = p.ob
        if ob is body:
            continue
        if ob.data.shape_keys is None:
            ob.shape_key_add(name='Basis')
            for k in keys:
                ob.shape_key_add(name=k)
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for p in parts:
        p.ob.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.delete_loose(use_verts=True, use_edges=False, use_faces=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    return body


def finalize_groups(ob, bone_names):
    """Only bone groups; per vertex the four largest weights, normalized (an empty vertex goes to the nearest rigid bone)."""
    for g in list(ob.vertex_groups):
        if g.name not in bone_names:
            ob.vertex_groups.remove(g)
    names = {g.index: g.name for g in ob.vertex_groups}
    W = []
    for v in ob.data.vertices:
        w = {names[g.group]: g.weight for g in v.groups if g.weight > 0.005}
        W.append(top4(w) if w else {'Bip01_Spine2': 1.0})
    assign(ob, W)


# ---------------------------------------------------------------------------------------------------------------------
# Posing in glTF terms.

class GPose:
    """Local glTF rotations (and the root's translation) of the skeleton, with world FK."""

    def __init__(self, bones, rest_locals, base=None):
        self.bones = bones
        self.parent = {b['name']: b['parent'] for b in bones}
        self.order = [b['name'] for b in bones]
        self.rest = rest_locals
        self.r = {n: Quaternion((v['r'][3], v['r'][0], v['r'][1], v['r'][2])) for n, v in rest_locals.items()}
        self.t = {n: Vector(v['t']) for n, v in rest_locals.items()}
        if base:
            for n, v in base.items():
                if n in self.r and 'r' in v:
                    self.r[n] = Quaternion((v['r'][3], v['r'][0], v['r'][1], v['r'][2]))
                if n == 'Bip01' and 't' in v:
                    self.t[n] = Vector(v['t'])

    def copy(self):
        g = GPose.__new__(GPose)
        g.bones, g.parent, g.order, g.rest = self.bones, self.parent, self.order, self.rest
        g.r = {k: v.copy() for k, v in self.r.items()}
        g.t = {k: v.copy() for k, v in self.t.items()}
        return g

    def world(self):
        W = {}
        for n in self.order:
            L = Matrix.Translation(self.t[n]) @ self.r[n].to_matrix().to_4x4()
            p = self.parent[n]
            W[n] = W[p] @ L if p else L
        return W

    def rotate_world(self, name, axis, angle):
        """Turn a bone by `angle` (rad) about a world axis (glTF), children following."""
        W = self.world()
        wq = W[name].to_quaternion()
        d = Quaternion(Vector(axis).normalized(), angle)
        p = self.parent[name]
        pq = W[p].to_quaternion() if p else Quaternion()
        self.r[name] = pq.inverted() @ d @ wq

    def set_world_rotation(self, name, wq):
        W = self.world()
        p = self.parent[name]
        pq = W[p].to_quaternion() if p else Quaternion()
        self.r[name] = pq.inverted() @ wq

    def ik(self, upper, lower, end, target, pole):
        """Two-bone IK in world space: put `end`'s joint at `target`, the elbow toward `pole`."""
        for _ in range(3):
            W = self.world()
            a = W[upper].translation
            b = W[lower].translation
            c = W[end].translation
            la = (b - a).length
            lb = (c - b).length
            t = Vector(target)
            d = min((t - a).length, la + lb - 1e-4)
            # angle at the elbow
            cos_b = (la * la + lb * lb - d * d) / (2 * la * lb)
            cur_b = (a - b).angle(c - b)
            want_b = np.arccos(np.clip(cos_b, -1, 1))
            axis = (b - a).cross(c - b)
            if axis.length < 1e-6:
                axis = (b - a).cross(Vector(pole) - a)
            self.rotate_world(lower, axis, -(want_b - cur_b))
            W = self.world()
            c = W[end].translation
            # swing the upper bone so the end meets the target
            v1 = (c - a).normalized()
            v2 = (t - a).normalized()
            q = v1.rotation_difference(v2)
            ax, ang = q.to_axis_angle()
            self.rotate_world(upper, ax, ang)
            # twist the chain about a->t so the elbow points to the pole
            W = self.world()
            b = W[lower].translation
            axis_at = (t - a).normalized()
            pb = (b - a) - axis_at * (b - a).dot(axis_at)
            pp = (Vector(pole) - a) - axis_at * (Vector(pole) - a).dot(axis_at)
            if pb.length > 1e-6 and pp.length > 1e-6:
                ang = pb.angle(pp)
                if pb.cross(pp).dot(axis_at) < 0:
                    ang = -ang
                self.rotate_world(upper, axis_at, ang)


def _b(m):
    """A glTF world matrix as the Blender matrix of the same frame."""
    r = (G2B @ m.to_3x3() @ B2G).to_4x4()
    r.translation = G2B @ m.translation
    return r


def apply_to_armature(arm, gp, keyframe=None):
    """Pose the armature from a GPose (glTF local rotations), through world matrices, so the result does not depend on
    how Blender rolled its own bones (their rest frames may twist about the bone; positions are the same)."""
    rest = gp.copy()
    for n in rest.r:
        v = gp.rest[n]
        rest.r[n] = Quaternion((v['r'][3], v['r'][0], v['r'][1], v['r'][2]))
        rest.t[n] = Vector(v['t'])
    Wr = rest.world()
    Wp = gp.world()
    world_b = {}
    for b in arm.data.bones:
        n = b.name
        if n not in Wp:
            continue
        delta = _b(Wr[n]).inverted() @ b.matrix_local
        world_b[n] = _b(Wp[n]) @ delta
    for pb in arm.pose.bones:
        n = pb.name
        if n not in world_b:
            continue
        b = pb.bone
        if b.parent:
            l_rest = b.parent.matrix_local.inverted() @ b.matrix_local
            l_pose = world_b[b.parent.name].inverted() @ world_b[n]
        else:
            l_rest = b.matrix_local
            l_pose = world_b[n]
        pb.rotation_mode = 'QUATERNION'
        pb.matrix_basis = l_rest.inverted() @ l_pose
        if keyframe is not None:
            pb.keyframe_insert('rotation_quaternion', frame=keyframe)
            if n == 'Bip01':
                pb.keyframe_insert('location', frame=keyframe)
