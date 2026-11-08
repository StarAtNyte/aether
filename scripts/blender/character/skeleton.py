"""The shared Biped, fitted to the brief's proportions with only bone offsets changed.

The rest rotations of the library body (`juno` for women, `marcus` for men: the `Bip01_*` skeleton the female and male
motion sets drive) are kept exactly, so every clip of the motion set plays unchanged; joint positions move to the
landmarks of the brief (height, heads tall, leg length, shoulder and hip width). Secondary bones (hair, skirt panels,
ties) have an identity world rest rotation, as the runtime's springs expect.

The Blender armature is built so that the glTF exporter writes the same rest transforms: each edit bone's matrix is the
glTF world matrix of the bone conjugated into Blender's axes. `export.py` then writes the exact values into the file.
"""
import glob
import json
import os
import re
import struct

import bpy
from mathutils import Matrix, Quaternion, Vector

from common import B2G, G2B, activate, g2b_matrix

DROP_BONE = re.compile(r'Eye|Eyebrow|Mouth|Lip|Jaw|Tongue|Cheek|Caninus|Masseter|Nose|Nub$|Footsteps', re.I)


def read_glb_json(path):
    with open(path, 'rb') as f:
        b = f.read()
    n = struct.unpack('<I', b[12:16])[0]
    return json.loads(b[20:20 + n])


def source_body(repo, gender):
    name = 'marcus' if gender == 'male' else 'juno'
    files = glob.glob(os.path.join(repo, 'assets/lib/c', f'{name}.*.glb'))
    files = [f for f in files if re.search(rf'/{name}\.[0-9a-f]{{8}}\.glb$', f)]
    if not files:
        raise RuntimeError(f'the library body {name} is missing from assets/lib/c')
    return files[0]


def read_bones(path):
    """Bones of a library body in parent-first order: name, parent, local t (glTF), local r (x, y, z, w)."""
    j = read_glb_json(path)
    nodes = j['nodes']
    parent = {}
    for i, nd in enumerate(nodes):
        for c in nd.get('children', []):
            parent[c] = i
    out = []

    def visit(i):
        nd = nodes[i]
        name = nd.get('name', '')
        if name.startswith('Bip01'):
            p = parent.get(i)
            out.append({'name': name, 'parent': nodes[p]['name'] if p is not None and nodes[p].get('name', '').startswith('Bip01') else None,
                        't': list(nd.get('translation', [0, 0, 0])), 'r': list(nd.get('rotation', [0, 0, 0, 1]))})
        for c in nd.get('children', []):
            visit(c)

    roots = [i for i in range(len(nodes)) if i not in parent]
    for r in roots:
        visit(r)
    return out


def quat(r):
    return Quaternion((r[3], r[0], r[1], r[2]))


def landmarks(spec):
    """Target heights and widths (m, glTF Y-up) of the brief's body."""
    H = spec['height']
    hh = spec['head_h']
    anime = spec['style'] == 'anime'
    male = spec['gender'] == 'male'
    leg = spec['leg']  # hip joint height as a share of the height
    chin = H - hh
    neck_len = hh * (0.125 if anime else 0.3)
    neck_base = chin - neck_len
    return {
        'H': H, 'hh': hh, 'chin': chin,
        'ankle': H * (0.05 if anime else 0.052),
        'knee': H * leg * 0.535,
        'hip': H * leg,
        'neck_base': neck_base,
        'head_joint': chin + hh * 0.16,
        'shoulder_half': hh * spec['shoulder'],
        'shoulder_y': neck_base - hh * (0.32 if anime else 0.26),
        'hip_half': hh * spec['hip_w'],
        'upper_arm': H * (0.145 if anime else 0.172) * spec['arm'],
        'forearm': H * (0.115 if anime else 0.145) * spec['arm'],
        'hand': H * (0.09 if anime else 0.104) * (1.04 if male else 1.0),
        'foot': H * (0.13 if anime else 0.15),
    }


def proportion(src, spec):
    """World positions and rotations (glTF) of the fitted skeleton. Returns bones: list of dicts with world matrices."""
    L = landmarks(spec)
    kept = [b for b in src if not DROP_BONE.search(b['name'])]
    by = {b['name']: b for b in kept}
    # Source world transforms.
    W = {}
    for b in kept:
        local = Matrix.Translation(Vector(b['t'])) @ quat(b['r']).to_matrix().to_4x4()
        W[b['name']] = (W[b['parent']] @ local) if b['parent'] else local
    P = {n: W[n].translation.copy() for n in W}
    R = {n: W[n].to_quaternion() for n in W}

    def seg(a, b):
        return (P[b] - P[a]).length

    s = {
        'thigh': (L['hip'] - L['knee']) / (P['Bip01_L_Thigh'].y - P['Bip01_L_Calf'].y),
        'calf': (L['knee'] - L['ankle']) / (P['Bip01_L_Calf'].y - P['Bip01_L_Foot'].y),
        'foot': L['foot'] / (abs(P['Bip01_L_Toe0'].z - P['Bip01_L_Foot'].z) * 1.55),
        'torso': (L['neck_base'] - L['hip']) / (P['Bip01_Neck'].y - P['Bip01_Pelvis'].y),
        'neck': (L['head_joint'] - L['neck_base']) / (P['Bip01_Head'].y - P['Bip01_Neck'].y),
        'upper': L['upper_arm'] / seg('Bip01_L_UpperArm', 'Bip01_L_Forearm'),
        'fore': L['forearm'] / seg('Bip01_L_Forearm', 'Bip01_L_Hand'),
        'hand': L['hand'] / (seg('Bip01_L_Hand', 'Bip01_L_Finger2') * 2.1),
    }
    new = {}
    # the whole skeleton is dropped later so the ankle meets its landmark; landmarks set directly are pre-raised by it
    drop0 = P['Bip01_Pelvis'].y - L['hip']
    for b in kept:
        n = b['name']
        if not b['parent']:
            new[n] = P[n].copy()
            continue
        off = P[n] - P[b['parent']]
        if n.endswith('_Thigh'):
            continue  # placed below, from the pelvis
        if n.endswith('_Calf'):
            off *= s['thigh']
        elif n.endswith('_Foot'):
            off *= s['calf']
        elif n.endswith('_Toe0'):
            off = Vector((off.x * s['foot'], 0, off.z * s['foot']))
        elif re.match(r'Bip01_Spine\d?$', n) or n == 'Bip01_Neck':
            off *= s['torso']
        elif n == 'Bip01_Head':
            off *= s['neck']
        elif n.endswith('_Clavicle'):
            off = Vector((off.x, off.y * s['torso'], off.z * s['torso']))
        elif n.endswith('_UpperArm'):
            pass  # placed by the shoulder width below
        elif n.endswith('_Forearm'):
            off *= s['upper']
        elif n.endswith('_Hand'):
            off *= s['fore']
        elif '_Finger' in n:
            off *= s['hand']
        new[n] = new[b['parent']] + off
        if n.endswith('_Clavicle'):
            pass
        if n.endswith('_UpperArm'):
            side = 1 if '_L_' in n else -1
            cl = new[b['parent']]
            new[n] = Vector((side * L['shoulder_half'], L['shoulder_y'] + drop0, cl.z + (P[n].z - P[b['parent']].z)))
        if n == 'Bip01_Spine':
            # the thighs hang from the spine in the Biped: hip joints at the pelvis, a set distance apart
            for side, t in ((1, 'Bip01_L_Thigh'), (-1, 'Bip01_R_Thigh')):
                if t in by:
                    new[t] = Vector((side * L['hip_half'], new['Bip01_Pelvis'].y, P[t].z))
    # Height: the ankle at its landmark, the toe joints on the floor.
    drop = new['Bip01_L_Foot'].y - L['ankle']
    for v in new.values():
        v.y -= drop
    for t in ('Bip01_L_Toe0', 'Bip01_R_Toe0'):
        if t in new:
            new[t].y = 0.004
    # Arms: keep the rest pose's direction for the upper arm, at the landmark shoulder height.
    bones = []
    for b in kept:
        n = b['name']
        wm = R[n].to_matrix().to_4x4()
        wm.translation = new[n]
        bones.append({'name': n, 'parent': b['parent'], 'world': wm, 'rest_r': list(b['r'])})
    return bones, L


def add_secondary(bones, name, parent, at):
    """A secondary bone at glTF world `at` under `parent`, world rest rotation identity."""
    wm = Matrix.Translation(Vector(at))
    bones.append({'name': name, 'parent': parent, 'world': wm, 'rest_r': None})


def local_trs(bones):
    """Local translation and rotation (glTF, x y z w) per bone, from the world matrices."""
    by = {b['name']: b for b in bones}
    out = {}
    for b in bones:
        w = b['world']
        if b['parent']:
            local = by[b['parent']]['world'].inverted() @ w
        else:
            local = w
        t = local.translation
        if b['rest_r'] is not None and b['parent']:
            q = quat(b['rest_r'])  # exactly the library's rest rotation
        else:
            q = local.to_quaternion()
        out[b['name']] = {'t': [t.x, t.y, t.z], 'r': [q.x, q.y, q.z, q.w]}
    return out


def joints_blender(bones):
    """Joint positions in Blender coordinates by bone name."""
    from common import g2b_point
    return {b['name']: g2b_point(b['world'].translation) for b in bones}


def build_armature(bones, name='Biped', nice=False):
    """The armature object. `nice`: bones pointing at their child joints (for automatic weights only)."""
    arm = bpy.data.armatures.new(name)
    ob = bpy.data.objects.new(name, arm)
    bpy.context.scene.collection.objects.link(ob)
    activate(ob)
    bpy.ops.object.mode_set(mode='EDIT')
    J = joints_blender(bones)
    children = {}
    for b in bones:
        children.setdefault(b['parent'], []).append(b['name'])
    ebs = {}
    for b in bones:
        eb = arm.edit_bones.new(b['name'])
        if nice:
            head = J[b['name']]
            kids = [k for k in children.get(b['name'], []) if not k.startswith(('Hair', 'Skirt', 'Tie', 'Acc'))]
            pref = {'Bip01_Pelvis': 'Bip01_Spine', 'Bip01_Spine2': 'Bip01_Neck', 'Bip01_Neck': 'Bip01_Head',
                    'Bip01_L_Hand': 'Bip01_L_Finger2', 'Bip01_R_Hand': 'Bip01_R_Finger2', 'Bip01_Spine': 'Bip01_Spine1'}
            if b['name'] in pref:
                tail = J[pref[b['name']]]
            elif len(kids) == 1:
                tail = J[kids[0]]
            elif b['name'] == 'Bip01_Head':
                tail = head + Vector((0, 0, 0.18))
            elif b['parent'] and (head - J[b['parent']]).length > 1e-4:
                tail = head + (head - J[b['parent']]).normalized() * max(0.012, (head - J[b['parent']]).length * 0.7)
            else:
                tail = head + Vector((0, 0, 0.05))
            if (tail - head).length < 0.005:
                tail = head + Vector((0, 0, 0.02))
            eb.head = head
            eb.tail = tail
        else:
            eb.head = (0, 0, 0)
            eb.tail = (0, 0.05, 0)
            eb.matrix = g2b_matrix(b['world'])
            eb.length = 0.04
        ebs[b['name']] = eb
    for b in bones:
        if b['parent']:
            ebs[b['name']].parent = ebs[b['parent']]
            ebs[b['name']].use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    return ob
