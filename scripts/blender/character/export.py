"""Export: the skinned body on the Biped as `<id>.blender.glb`, its `<id>.meta.json`, a reduced level of detail, and the
finishing step (scripts/characters/finish-character.ts) that makes the runtime body.

After Blender's glTF export the file is patched: every bone's rest translation and rotation are set to the fitted
skeleton's exact values (the library's rest rotations to the last bit, so the motion set plays unchanged), the inverse
bind matrices recomputed from them, and the body node named `<id>-body`.
"""
import json
import os
import struct
import subprocess

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

from common import activate


def export_glb(path, arm, body, with_anim=True):
    for o in bpy.context.selected_objects:
        o.select_set(False)
    arm.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    kw = dict(
        filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
        export_texcoords=True, export_normals=True, export_tangents=False, export_materials='EXPORT',
        export_skins=True, export_all_influences=False, export_morph=True, export_morph_normal=False,
        export_animations=with_anim, export_attributes=True, export_image_format='AUTO',
    )
    if with_anim:
        kw.update(export_animation_mode='ACTIONS', export_force_sampling=True, export_frame_step=1, export_optimize_animation_size=True,
                  export_anim_single_armature=True, export_reset_pose_bones=True, export_def_bones=False, export_rest_position_armature=True)
    try:
        kw['export_vertex_color'] = 'NONE'
        bpy.ops.export_scene.gltf(**kw)
    except TypeError:
        kw.pop('export_vertex_color', None)
        bpy.ops.export_scene.gltf(**kw)


def read_glb(path):
    with open(path, 'rb') as f:
        b = f.read()
    n = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + n])
    rest = b[20 + n:]
    binary = b''
    if len(rest) >= 8:
        ln = struct.unpack('<I', rest[0:4])[0]
        binary = rest[8:8 + ln]
    return j, bytearray(binary)


def write_glb(path, j, binary):
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    binary = bytes(binary)
    binary += b'\0' * ((4 - len(binary) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(binary)
    with open(path, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, total))
        f.write(struct.pack('<I4s', len(js), b'JSON'))
        f.write(js)
        f.write(struct.pack('<I4s', len(binary), b'BIN\0'))
        f.write(binary)


def patch(path, trs, body_name, atlas_png=None):
    """Exact rest transforms and inverse bind matrices; body node name; the atlas bytes as painted (alpha kept)."""
    j, binary = read_glb(path)
    nodes = j['nodes']
    drift = 0.0
    for nd in nodes:
        n = nd.get('name')
        if n in trs:
            t0 = nd.get('translation', [0, 0, 0])
            r0 = nd.get('rotation', [0, 0, 0, 1])
            drift = max(drift, max(abs(a - b) for a, b in zip(t0, trs[n]['t'])), min(max(abs(a - b) for a, b in zip(r0, trs[n]['r'])), max(abs(a + b) for a, b in zip(r0, trs[n]['r']))))
            nd['translation'] = list(trs[n]['t'])
            nd['rotation'] = list(trs[n]['r'])
            nd.pop('scale', None)
            nd.pop('matrix', None)
    # world matrices of the joints, then inverse bind matrices
    parent = {}
    for i, nd in enumerate(nodes):
        for c in nd.get('children', []):
            parent[c] = i

    def local(i):
        nd = nodes[i]
        t = nd.get('translation', [0, 0, 0])
        r = nd.get('rotation', [0, 0, 0, 1])
        s = nd.get('scale', [1, 1, 1])
        M = Matrix.Translation(Vector(t)) @ Quaternion((r[3], r[0], r[1], r[2])).to_matrix().to_4x4() @ Matrix.Diagonal((s[0], s[1], s[2], 1))
        return M

    cache = {}

    def world(i):
        if i not in cache:
            cache[i] = world(parent[i]) @ local(i) if i in parent else local(i)
        return cache[i]

    for skin in j.get('skins', []):
        acc = j['accessors'][skin['inverseBindMatrices']]
        bv = j['bufferViews'][acc['bufferView']]
        off = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
        mesh_node = [i for i, nd in enumerate(nodes) if nd.get('skin') == j['skins'].index(skin)]
        base = world(mesh_node[0]) if mesh_node else Matrix.Identity(4)
        for k, ji in enumerate(skin['joints']):
            ibm = (world(ji).inverted() @ base)
            vals = [ibm[r][c] for c in range(4) for r in range(4)]
            binary[off + k * 64: off + (k + 1) * 64] = struct.pack('<16f', *vals)
    for i, nd in enumerate(nodes):
        if 'mesh' in nd and 'skin' in nd:
            nd['name'] = body_name
            j['meshes'][nd['mesh']]['name'] = body_name
    if atlas_png and j.get('images'):
        with open(atlas_png, 'rb') as f:
            png = f.read()
        img = j['images'][0]
        if 'bufferView' in img:
            # append the painted atlas as a new buffer view (the exporter's copy may drop the alpha codes)
            pad = (4 - len(binary) % 4) % 4
            binary += b'\0' * pad
            img['bufferView'] = len(j['bufferViews'])
            j['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(png)})
            img['mimeType'] = 'image/png'
            binary += png
            j['buffers'][0]['byteLength'] = len(binary)
    write_glb(path, j, binary)
    return drift


def add_animations(path, clips, fps=30):
    """Write a character's own clips into the file as glTF animations, sampled from their key poses (glTF local
    rotations of every bone and the root's translation), so they are in exactly the rest frames the file carries."""
    import clips as CLIPS
    j, binary = read_glb(path)
    names = {nd.get('name'): i for i, nd in enumerate(j['nodes'])}
    j.setdefault('animations', [])
    j['animations'] = [a for a in j['animations'] if a.get('name') not in clips]

    def put(arr, typ, minmax=False):
        nonlocal binary
        pad = (4 - len(binary) % 4) % 4
        binary += b'\0' * pad
        data = np.asarray(arr, np.float32).tobytes()
        j['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(data)})
        binary += data
        acc = {'bufferView': len(j['bufferViews']) - 1, 'componentType': 5126, 'count': len(arr), 'type': typ}
        if minmax:
            acc['min'] = [float(np.min(arr))]
            acc['max'] = [float(np.max(arr))]
        j['accessors'].append(acc)
        return len(j['accessors']) - 1

    for name, keys in clips.items():
        dur = keys[-1][0]
        n = max(2, int(round(dur * fps)) + 1)
        times = [dur * k / (n - 1) for k in range(n)]
        poses = [CLIPS.sample_pose({name: keys}, name, t) for t in times]
        tin = put(times, 'SCALAR', minmax=True)
        samplers, channels = [], []
        for bone in poses[0].r:
            if bone not in names:
                continue
            rots = []
            prev = None
            for g in poses:
                q = g.r[bone]
                v = [q.x, q.y, q.z, q.w]
                if prev is not None and sum(a * b for a, b in zip(v, prev)) < 0:
                    v = [-c for c in v]
                rots.append(v)
                prev = v
            if all(max(abs(a - b) for a, b in zip(r, rots[0])) < 1e-6 for r in rots) and not bone.startswith('Bip01'):
                continue
            samplers.append({'input': tin, 'output': put(rots, 'VEC4'), 'interpolation': 'LINEAR'})
            channels.append({'sampler': len(samplers) - 1, 'target': {'node': names[bone], 'path': 'rotation'}})
        tr = [list(g.t['Bip01']) for g in poses]
        samplers.append({'input': tin, 'output': put(tr, 'VEC3'), 'interpolation': 'LINEAR'})
        channels.append({'sampler': len(samplers) - 1, 'target': {'node': names['Bip01'], 'path': 'translation'}})
        j['animations'].append({'name': name, 'samplers': samplers, 'channels': channels})
    j['buffers'][0]['byteLength'] = len(binary)
    write_glb(path, j, binary)


def write_meta(path, spec, springs, colliders):
    meta = {
        'id': spec['id'], 'name': spec['name'], 'style': 'anime' if spec['style'] == 'anime' else 'realistic', 'gender': spec['gender'],
        'look': spec['look'][:200], 'faces': 1, 'springs': springs, 'colliders': colliders,
    }
    with open(path, 'w') as f:
        json.dump(meta, f, indent=1)
    return meta


def finish(repo, blender_glb, meta, out, install, lod1=False):
    cmd = ['npx', 'tsx', 'scripts/characters/finish-character.ts', '--in', blender_glb, '--meta', meta, '--out', out]
    if install:
        cmd.append('--install')
    if lod1:
        cmd.append('--lod1')
    r = subprocess.run(cmd, cwd=repo, capture_output=True, text=True, timeout=600)
    if r.returncode != 0:
        raise RuntimeError(f'finish-character failed: {r.stderr[-800:]}')
    lines = [l for l in r.stdout.strip().splitlines() if l.startswith('{')]
    return json.loads(lines[-1]) if lines else {}


def lod(body, ratio):
    """A reduced copy of the body (no morphs), for the far level of detail."""
    me = body.data.copy()
    ob = bpy.data.objects.new(body.name + '-lod1', me)
    bpy.context.scene.collection.objects.link(ob)
    activate(ob)
    if ob.data.shape_keys:
        ob.shape_key_clear()
    for m in list(ob.modifiers):
        if m.type != 'ARMATURE':
            ob.modifiers.remove(m)
    arm_mods = [(m.name, m.object) for m in body.modifiers if m.type == 'ARMATURE']
    d = ob.modifiers.new('dec', 'DECIMATE')
    d.ratio = ratio
    d.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier='dec')
    for name, arm in arm_mods:
        m = ob.modifiers.new(name, 'ARMATURE')
        m.object = arm
    ob.parent = body.parent
    return ob
