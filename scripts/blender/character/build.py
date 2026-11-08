"""The character pipeline: a brief (and optionally a concept sheet) in, a rigged, animated, shaded character out.

  blender -b --factory-startup -P scripts/blender/character/build.py -- --brief <dir>/brief.json --out <dir>
          [--sheet <dir>/sheet.png] [--revise <dir>/report.json] [--review]

Writes in <dir>: report.json (the QA), turnaround.png (front, side, back), expressions.png, <id>.blender.glb (the
Blender export), <id>.meta.json, <id>.glb (finished by scripts/characters/finish-character.ts; installed into the
asset library when the brief says "install": true), <id>.lod1.glb, <id>.blend (for --review and --revise).

Stages (modules beside this file): brief -> skeleton (the shared Biped fitted to the brief) -> body -> face (head,
normals, painted decals and their morphs) -> hair -> clothes -> rig (weights, join) -> clips -> shading -> export ->
qa. The QA loop rebuilds with corrections when a check fails that the pipeline can fix (clothes showing the body
through: more ease; the triangle budget: a lighter subdivision), and keeps the best build. See docs/BLENDER-HARNESS.md.
"""
import json
import os
import subprocess
import sys
import time

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402

import body as BODY  # noqa: E402
import brief as BRIEF  # noqa: E402
import clips as CLIPS  # noqa: E402
import clothes as CLOTHES  # noqa: E402
import export as EXPORT  # noqa: E402
import face as FACE  # noqa: E402
import hair as HAIR  # noqa: E402
import paint as PAINT  # noqa: E402
import qa as QA  # noqa: E402
import render as RENDER  # noqa: E402
import rig as RIG  # noqa: E402
import shading as SHADING  # noqa: E402
import skeleton as SKEL  # noqa: E402
from common import Part, activate, apply_modifiers, colour, linear_to_srgb, srgb_to_linear  # noqa: E402

T0 = time.time()
# the triangle budget of a character (anime; the QA flags over it and the loop drops a body subdivision): the hair's
# strands, the head's finer jaw line and the knit and pleat detail fit in it at the near level of detail
BUDGET = 75000


def log(s):
    print(f'[character {time.time() - T0:6.1f}s] {s}', flush=True)


def args():
    a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out = {'review': '--review' in a}
    for k in ('brief', 'out', 'sheet', 'revise'):
        if f'--{k}' in a:
            out[k] = a[a.index(f'--{k}') + 1]
    return out


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


# ---------------------------------------------------------------------------------------------------------------------
# Revision notes: plain directives a reviewer (the studio's assistant or a person) writes.

DIRECTIVES = [
    (('bigger eyes', 'larger eyes'), ('eye_scale', 1.1)), (('smaller eyes',), ('eye_scale', 0.9)),
    (('more hair volume', 'fuller hair', 'more volume'), ('hair_volume', 1.15)), (('less hair volume', 'flatter hair'), ('hair_volume', 0.87)),
    (('longer hair',), ('hair_length', 1.15)), (('shorter hair',), ('hair_length', 0.87)),
    (('longer skirt',), ('skirt', 'mid-calf')), (('shorter skirt',), ('skirt', 'mini')),
    (('slimmer', 'thinner'), ('girth', 0.94)), (('heavier', 'stockier'), ('girth', 1.07)),
    (('wider shoulders',), ('shoulder', 1.08)), (('narrower shoulders',), ('shoulder', 0.93)),
    (('looser clothes', 'more ease'), ('ease', 1.4)), (('fewer triangles', 'lighter'), ('budget', 0.8)),
    (('taller',), ('height', 1.04)), (('shorter',), ('height', 0.96)),
]


def apply_notes(spec, notes, P):
    n = (notes or '').lower()
    applied = []
    for words, (key, val) in DIRECTIVES:
        if any(w in n for w in words):
            applied.append(key)
            if key == 'hair_volume':
                spec['hair']['volume'] *= val
            elif key == 'hair_length':
                spec['hair']['length'] *= val
            elif key == 'skirt':
                for o in spec['outfit']:
                    if 'skirt' in o['item']:
                        o['length'] = val
            elif key == 'girth':
                spec['girth'] *= val
            elif key == 'shoulder':
                spec['shoulder'] *= val
            elif key == 'height':
                spec['height'] *= val
                spec['head_h'] = spec['height'] / spec['ratio']
            elif key == 'ease':
                P['ease'] = P.get('ease', 1.0) * val
            elif key == 'budget':
                P['body_sub'] = 1
            elif key == 'eye_scale':
                spec['eye_scale'] = spec.get('eye_scale', 1.0) * val
    return applied


# ---------------------------------------------------------------------------------------------------------------------
# One build.

def id_colour(i):
    import colorsys
    h = (i * 0.618034) % 1.0
    r, g, b = colorsys.hsv_to_rgb(h, 0.85, 0.95)
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b))


def bvh_of(obs):
    vs, ps = [], []
    for o in obs:
        b = len(vs)
        vs += [v.co.copy() for v in o.data.vertices]
        ps += [[b + i for i in p.vertices] for p in o.data.polygons]
    return BVHTree.FromPolygons(vs, ps)


def build(spec, P, out):
    reset()
    spec['body_sub'] = P.get('body_sub', 2)
    src = SKEL.read_bones(SKEL.source_body(REPO, spec['gender']))
    bones, L = SKEL.proportion(src, spec)
    main_bones = [dict(b) for b in bones]
    J = SKEL.joints_blender(bones)
    atlas = PAINT.Atlas()
    PAINT.paint_face(atlas, spec)
    log('body')
    body = BODY.build_body(J, spec)
    base_quads = sum(1 for p in body.data.polygons if len(p.vertices) == 4) / max(1, len(body.data.polygons))
    lab, tp = BODY.labels(body, J)
    W, unweighted = RIG.body_weights(body, main_bones)
    W = RIG.fix_body_weights(body, W, lab)
    log('face')
    head, ears, form, chin = FACE.build_head(J, spec)
    decals = FACE.build_decals(head, chin, form.u, atlas, spec)
    log('clothes')
    if P.get('ease', 1.0) != 1.0:
        CLOTHES.EASE = P['ease']
    kit = CLOTHES.build_kit(spec, J, body, lab, tp, W, atlas, bones)
    log('hair')
    # after the clothes: long hair falls over the collar, the cardigan's back and the bag strap, not through them
    H = HAIR.build_hair(spec, J, head, form, chin, atlas, bones, bvh_of([body, head] + [p.ob for p in kit.parts if p.layer <= 1 or 'strap' in p.ob.name]))
    # the body under tight garments goes
    hide = kit.hide
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in np.where(hide)[0]], context='VERTS')
    bm.to_mesh(body.data)
    bm.free()
    keep = np.where(~hide)[0]
    W = [W[i] for i in keep]
    lab_k = lab[keep]
    RIG.assign(body, W)
    skin = PAINT.srgb(spec['skin'])
    skin_uv = atlas.swatch('skin', spec['skin'])
    for ob in [body, head] + ears:
        CLOTHES.set_uv(ob, skin_uv)
    parts = [Part(body, 'skin', toon=(0.85, 0.0, 1.0, 0.0), bones='groups', role='skin'), Part(head, 'head', toon=(0.7, 0.1, 1.0, 0.0), bones={'Bip01_Head': 1.0}, role='skin')]
    hb = FACE.HEAD_BIAS.get(head.name)
    if hb is not None:
        n = len(hb)
        hr = FACE.HEAD_RIM.get(head.name, np.ones(n))
        parts[1].toon_v = np.stack([np.full(n, 0.7), hb, hr, np.zeros(n)], 1)
    if spec['style'] == 'anime':
        # the chin's shadow on the neck: the front of the neck under the jaw falls into shadow first
        bco = np.array([v.co[:] for v in body.data.vertices])
        dz = bco[:, 2] - chin.z
        # (down the whole front of the neck, so the jaw reads against it and the face does not run on into the neck)
        under = np.clip((dz + 0.095 * form.u) / (0.035 * form.u), 0, 1) * (bco[:, 2] < chin.z + 0.03 * form.u) * (np.abs(bco[:, 0]) < 0.065 * form.u)
        under = under * under * (3 - 2 * under)
        nb = len(bco)
        parts[0].toon_v = np.stack([np.full(nb, 0.85), -0.75 * under, np.ones(nb), np.zeros(nb)], 1)
    parts += [Part(e, 'head', toon=(0.6, 0.05, 1.0, 0.0), bones={'Bip01_Head': 1.0}, role='skin') for e in ears]
    parts += decals
    parts += H.parts
    parts += kit.parts
    for p in parts:
        RIG.weight_part(p, kit, kit.weights_at)
    # per-vertex toon values, part ids (QA) and the role colours
    roles = sorted({p.role for p in parts})
    role_id = {r: id_colour(i) for i, r in enumerate(roles)}
    for k, p in enumerate(parts):
        n = len(p.ob.data.vertices)
        if p.toon_v is not None and len(p.toon_v) == n:
            tv = np.array(p.toon_v, np.float32)
            tv[:, 0] = np.minimum(1.0, tv[:, 0])
            SHADING.set_toon_attribute(p.ob, tv)
        else:
            tv = list(p.toon)
            tv[0] = min(1.0, tv[0])
            SHADING.set_toon_attribute(p.ob, np.tile(tv, (n, 1)))
        a = p.ob.data.color_attributes.new('qa_id', 'FLOAT_COLOR', 'POINT')
        a.data.foreach_set('color', np.tile([*role_id[p.role], 1.0], (n, 1)).astype(np.float32).ravel())
        ia = p.ob.data.attributes.new('qa_part', 'INT', 'POINT')
        ia.data.foreach_set('value', np.full(n, k, np.int32))
    info = [{'kind': p.kind, 'role': p.role, 'cloth': p.cloth, 'layer': p.layer, 'name': p.ob.name} for p in parts]
    # atlas
    atlas_png = os.path.join(out, f'{spec["id"]}.atlas.png')
    RENDER.save_png(atlas_png, atlas.rgba())
    img = SHADING.atlas_image(atlas_png)
    skull_top = max(v.co.z for v in head.data.vertices) + (0.012 * form.u if spec['hair']['style'] != 'bald' else 0)
    log('join')
    joined = RIG.join(parts, body, FACE.EXPRESSIONS)
    joined.name = f'{spec["id"]}-body'
    joined.data.name = f'{spec["id"]}-body'
    for a in list(joined.data.color_attributes):
        pass
    RIG.finalize_groups(joined, {b['name'] for b in bones})
    joined.data.color_attributes.active_color = joined.data.color_attributes['_TOON']
    # the exact Biped (every secondary bone added by hair and clothes)
    arm = SKEL.build_armature(bones, 'Biped')
    joined.parent = arm
    m = joined.modifiers.new('armature', 'ARMATURE')
    m.object = arm
    trs = SKEL.local_trs(bones)
    springs = H.springs + kit.springs
    spec['leg_fit'] = leg_fit(joined, J)
    colliders = make_colliders(bones, J, spec)
    rest_clear_skirt(springs, kit.skirt_panels, J, spec)
    palette_roles = {'skin': spec['skin'], 'hair': spec['hair']['colour']}
    palette_roles.update(kit.palette)
    return {
        'spec': spec, 'bones': bones, 'J': J, 'arm': arm, 'body': joined, 'atlas': atlas, 'atlas_png': atlas_png, 'img': img,
        'trs': trs, 'springs': springs, 'colliders': colliders, 'info': info, 'role_id': role_id, 'palette_roles': palette_roles,
        'head_top': skull_top, 'chin': chin, 'form': form, 'base_quads': base_quads, 'unweighted_heat': unweighted,
    }


# (the thigh in two capsules: it tapers from the hip to the knee, and one radius for both ends was the hip's, 3 cm
# outside a slim skirt's lower thigh at rest)
LEG_SEGMENTS = (('thigh', 'Thigh', 'Calf', 0.05, 0.52), ('thigh2', 'Thigh', 'Calf', 0.48, 0.97), ('calf', 'Calf', 'Foot', 0.0, 0.6))


def leg_fit(ob, J):
    """The legs' capsules fitted to the body's own skin (part 0 of the joined mesh), Blender space at rest:
    {'L_thigh': (a, b, r), ...}. An anime thigh is not round about its bone (the bone runs along its inner side), so the
    axis is the line through the skin's centroids at a quarter and at four fifths of the segment (hip to knee, knee to
    ankle), and the radius the 98th percentile of the skin's distance to it: the leg the cloth must clear."""
    me = ob.data
    n = len(me.vertices)
    co = np.empty(n * 3, np.float32)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3).astype(np.float64)
    part = np.empty(n, np.int32)
    me.attributes['qa_part'].data.foreach_get('value', part)
    out = {}
    for name, a_, b_, t0, t1 in LEG_SEGMENTS:
        for sd, sg in (('L', 1), ('R', -1)):
            A, B = np.array(J[f'Bip01_{sd}_{a_}']), np.array(J[f'Bip01_{sd}_{b_}'])
            ab = B - A
            t = ((co - A) @ ab) / float(ab @ ab)
            q = A + np.clip(t, 0, 1)[:, None] * ab
            d = np.linalg.norm(co - q, axis=1)
            near = (part == 0) & (co[:, 0] * sg > 0) & (d < 0.16)
            cs = []
            ta, tb = t0 + (t1 - t0) * 0.2, t0 + (t1 - t0) * 0.8
            for tc in (ta, tb):
                sel = near & (np.abs(t - tc) < 0.06)
                cs.append(co[sel].mean(axis=0) if sel.sum() > 8 else A + ab * tc)
            c0, c1 = cs
            axis = (c1 - c0) / (tb - ta)
            a = c0 + axis * (t0 - ta)
            b = c0 + axis * (t1 - ta)
            seg = b - a
            sel = near & (t > max(0.0, t0 + 0.08)) & (t < t1)
            tt = np.clip(((co - a) @ seg) / float(seg @ seg), 0, 1)
            dd = np.linalg.norm(co - (a + tt[:, None] * seg), axis=1)
            r = float(np.percentile(dd[sel], 98)) if sel.sum() > 20 else 0.06
            out[f'{sd}_{name}'] = ([round(float(x), 4) for x in a], [round(float(x), 4) for x in b], round(r, 4))
    return out


def leg_capsules(J, spec):
    """The thigh and calf capsules of make_colliders, in Blender space at rest: (a, b, radius)."""
    s = spec['height'] / 1.54
    g = spec['girth']
    out = []
    fit = spec.get('leg_fit') or {}
    for side in ('L', 'R'):
        th, cf, ft = J[f'Bip01_{side}_Thigh'], J[f'Bip01_{side}_Calf'], J[f'Bip01_{side}_Foot']
        f, f2 = fit.get(f'{side}_thigh'), fit.get(f'{side}_thigh2')
        out.append((Vector(f[0]), Vector(f[1]), f[2]) if f else (th + Vector((0, 0, -0.03 * s)), th.lerp(cf, 0.5), 0.062 * s * g))
        out.append((Vector(f2[0]), Vector(f2[1]), f2[2]) if f2 else (th.lerp(cf, 0.5), th.lerp(cf, 0.97), 0.055 * s * g))
        f = fit.get(f'{side}_calf')
        out.append((Vector(f[0]), Vector(f[1]), f[2]) if f else (cf, cf.lerp(ft, 0.6), 0.045 * s))
    return out


def rest_clear_skirt(springs, panels, J, spec):
    """A skirt fitted close to the legs (a sheet's slim pleated skirt) must hang still at rest: each panel spring's
    collision radius is cut to what clears the leg capsules at rest (its tip and middle), so the springs push a panel
    only when a leg moves into it, not while she stands."""
    caps = leg_capsules(J, spec)
    for idx, at, tip in panels:
        clear = 1.0
        for p in (at + (tip - at) * f for f in SAMPLES_ALONG):
            for a, b, r in caps:
                ab = b - a
                t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
                clear = min(clear, (p - (a + ab * t)).length - r)
        sp = springs[idx]
        sp['radius'] = round(max(0.0, min(sp['radius'], clear - 0.004)), 4)


def make_colliders(bones, J, spec):
    """Capsules the springs keep out of (local to their bones, glTF): thighs, calves, forearms, hands, head, back, chest, hips."""
    from common import b2g_point
    by = {b['name']: b for b in bones}
    s = spec['height'] / 1.54
    g = spec['girth']

    def local(bone, p_blender):
        wm = by[bone]['world']
        return list(wm.inverted() @ Vector(b2g_point(p_blender)))

    out = []
    for side in ('L', 'R'):
        # (the legs' own capsules, fitted to the skin: leg_fit)
        (ta, tb, tr), (ua, ub, ur), (ca, cb, cr) = leg_capsules(J, spec)[(0 if side == 'L' else 3):(3 if side == 'L' else 6)]
        out.append({'bone': f'Bip01_{side}_Thigh', 'head': local(f'Bip01_{side}_Thigh', ta), 'tail': local(f'Bip01_{side}_Thigh', tb), 'radius': round(tr, 3)})
        out.append({'bone': f'Bip01_{side}_Thigh', 'head': local(f'Bip01_{side}_Thigh', ua), 'tail': local(f'Bip01_{side}_Thigh', ub), 'radius': round(ur, 3)})
        out.append({'bone': f'Bip01_{side}_Calf', 'head': local(f'Bip01_{side}_Calf', ca), 'tail': local(f'Bip01_{side}_Calf', cb), 'radius': round(cr, 3)})
        fa, hn = J[f'Bip01_{side}_Forearm'], J[f'Bip01_{side}_Hand']
        out.append({'bone': f'Bip01_{side}_Forearm', 'head': local(f'Bip01_{side}_Forearm', fa), 'tail': local(f'Bip01_{side}_Forearm', hn), 'radius': round(0.03 * s, 3)})
        out.append({'bone': f'Bip01_{side}_Hand', 'head': local(f'Bip01_{side}_Hand', hn), 'tail': local(f'Bip01_{side}_Hand', J[f'Bip01_{side}_Finger2']), 'radius': round(0.03 * s, 3)})
    hd = J['Bip01_Head']
    hh = spec['head_h']
    out.append({'bone': 'Bip01_Head', 'head': local('Bip01_Head', hd + Vector((0, 0.01, 0.1 * hh / 0.237))), 'tail': local('Bip01_Head', hd + Vector((0, 0.0, 0.03))), 'radius': round(0.09 * hh / 0.237, 3)})
    sp2 = J['Bip01_Spine2']
    out.append({'bone': 'Bip01_Spine2', 'head': local('Bip01_Spine2', sp2 + Vector((0.06, 0.03, 0))), 'tail': local('Bip01_Spine2', sp2 + Vector((-0.06, 0.03, 0))), 'radius': round(0.075 * s * g, 3)})
    out.append({'bone': 'Bip01_Spine2', 'head': local('Bip01_Spine2', sp2 + Vector((0.07, -0.02, 0.0))), 'tail': local('Bip01_Spine2', sp2 + Vector((-0.07, -0.02, 0.0))), 'radius': round(0.07 * s * g, 3)})
    pv = J['Bip01_Pelvis']
    out.append({'bone': 'Bip01_Pelvis', 'head': local('Bip01_Pelvis', pv + Vector((0, 0.01, 0.05))), 'tail': local('Bip01_Pelvis', pv + Vector((0, 0.01, -0.03))), 'radius': round(0.1 * s * g, 3)})
    for c in out:
        c['head'] = [round(x, 4) for x in c['head']]
        c['tail'] = [round(x, 4) for x in c['tail']]
    return out


# ---------------------------------------------------------------------------------------------------------------------
# QA of a build.

def motion_poses(gender, out):
    path = os.path.join(out, f'motion-poses-{gender}.json')
    if not os.path.exists(path):
        r = subprocess.run(['npx', 'tsx', 'scripts/blender/character/motion-poses.ts', '--gender', gender, '--out', path], cwd=REPO, capture_output=True, text=True, timeout=600)
        if r.returncode != 0:
            raise RuntimeError(f'motion-poses failed: {r.stderr[-600:]}')
    with open(path) as f:
        return json.load(f)


SAMPLES_ALONG = (1.0, 0.87, 0.75, 0.64, 0.54, 0.45)  # packages/render/src/characters/springs.ts, for a chain with `collide`
SAMPLES_TIP_MID = (1.0, 0.5)


def skirt_push(gp, springs, colliders, bones):
    """Turn the skirt panels out of the leg capsules exactly as the runtime springs settle (springs.ts): the panel's tail
    pushed out wherever a point along it is inside a capsule of the pose (a point at fraction f moves the tail by its
    push / f), three passes, the length kept, then the swing limit (for the QA poses)."""
    W = gp.world()
    caps_all = [(c['bone'], W[c['bone']] @ Vector(c['head']), W[c['bone']] @ Vector(c['tail']), c['radius']) for c in colliders]
    for sp in springs:
        if not sp['name'].startswith('skirt'):
            continue
        only = sp.get('collide')
        caps = [c for c in caps_all if not only or any(n in c[0] for n in only)]
        samples = SAMPLES_ALONG if only else SAMPLES_TIP_MID
        b = sp['bones'][0]
        W = gp.world()
        h = W[b].translation.copy()
        t0 = W[b] @ Vector(sp['tip'])
        ln = (t0 - h).length
        n = t0.copy()
        for _ in range(3):
            moved = False
            for _bn, a, c2, r in caps:
                rr = r + sp['radius']
                ab = c2 - a
                for f in samples:
                    m = h + (n - h) * f
                    t = max(0.0, min(1.0, (m - a).dot(ab) / max(1e-12, ab.length_squared)))
                    q = a + ab * t
                    dm = (m - q).length
                    if 1e-6 < dm < rr:
                        n = n + (m - q) * ((rr - dm) / dm / f)
                        moved = True
            if not moved:
                break
            n = h + (n - h).normalized() * ln
        d0 = (t0 - h).normalized()
        d1 = (n - h).normalized()
        ang = d0.angle(d1, 0.0)
        if ang > sp['limit']:
            ax = d0.cross(d1)
            if ax.length > 1e-9:
                from mathutils import Quaternion
                d1 = Quaternion(ax.normalized(), sp['limit']) @ d0
                ang = sp['limit']
        if ang > 1e-5:
            ax = d0.cross(d1)
            if ax.length > 1e-9:
                gp.rotate_world(b, ax.normalized(), ang)
    return gp


def run_qa(B, out, sheet, poses):
    spec = B['spec']
    arm, body = B['arm'], B['body']
    q = QA.QA(out, spec, arm, body, B['info'], B['img'], B['J'])
    base = RIG.GPose(B['bones'], B['trs'], poses['clips']['idle']['frames'][0]['bones'])
    B['base'] = base

    sheet_stance = CLIPS.sheet_pose(RIG.GPose(B['bones'], B['trs']))

    def pose_idle():
        g = sheet_stance.copy()
        skirt_push(g, B['springs'], B['colliders'], B['bones'])
        RIG.apply_to_armature(arm, g)
    q.preview_setup()
    log('qa renders')
    q.turnaround(pose_idle)
    q.expressions([k for k in FACE.EXPRESSIONS])
    # the hands up close: her left in the sheet stance (its back, its thumb side), then her own clips' right hand
    own_keys = CLIPS.poses(base, spec)

    def pose_key(name, i):
        def fn():
            RIG.apply_to_armature(arm, own_keys[name][i][1])
        return fn
    q.hands([(pose_idle, 'L', 'back'), (pose_idle, 'L', 'thumb'), (pose_key('two_fingers', 1), 'R', 0), (pose_key('hand_to_chest', 1), 'R', 'back')])
    pose_idle()
    ids = q.ids()
    log('qa checks')
    q.silhouette(sheet)
    q.colour_regions()
    q.features(B['head_top'], B['chin'].z)
    q.proportions(B['head_top'], B['chin'].z, B['J']['Bip01_Pelvis'].z)
    q.palette(B['palette_roles'], ids, B['role_id'])
    q.topology(B['base_quads'])
    q.weights()
    # interpenetration through the clip set
    me = body.data
    part = np.empty(len(me.vertices), np.int32)
    me.attributes['qa_part'].data.foreach_get('value', part)
    info = B['info']
    skin_ids = [i for i, k in enumerate(part) if info[k]['kind'] == 'skin']
    co = np.array([v.co[:] for v in me.vertices])
    pairs = []
    for k, inf in enumerate(info):
        if not inf['cloth'] or inf['layer'] > 1:
            continue
        verts = set(np.where(part == k)[0].tolist())
        faces = [list(p.vertices) for p in me.polygons if p.vertices[0] in verts]
        if not faces:
            continue
        bvh = BVHTree.FromPolygons([Vector(c) for c in co], faces, all_triangles=False)
        under = []
        reach = 0.07 if inf['role'] == 'skirt' else 0.05
        rest_d = {}
        for i in skin_ids:
            nv = me.vertices[i].normal
            hit = bvh.ray_cast(Vector(co[i]) + nv * 0.0005, nv, reach)
            if hit[0] is None:
                continue
            # well inside the garment, not at an opening: tilted rays hit it too
            t1 = nv.orthogonal().normalized()
            t2 = nv.cross(t1)
            if all(bvh.ray_cast(Vector(co[i]) + nv * 0.0005, (nv + t * 0.6).normalized(), reach * 1.5)[0] is not None for t in (t1, -t1, t2, -t2)):
                under.append(i)
                rest_d[i] = hit[3]
        if inf['role'] == 'skirt':
            # (not the band just above the hem: a leg there leaves under the lifting hem, it does not cross the cloth)
            hem_z = min(co[i][2] for f in faces for i in f)
            under = [i for i in under if B['J']['Bip01_Pelvis'].z - 0.05 > co[i][2] > hem_z + 0.03]
        elif inf['layer'] <= 1 and 'skirt' in [x['role'] for x in info]:
            # a top's hem is under the skirt's waistband: check above it
            under = [i for i in under if co[i][2] > B['J']['Bip01_Pelvis'].z + (B['J']['Bip01_Neck'].z - B['J']['Bip01_Pelvis'].z) * 0.4]
        if len(under) > 10:
            # the skirt is checked through locomotion (its panels swing at most 0.6 rad, so a crouch or a seat lifts
            # the thighs through it by design)
            pairs.append((inf['role'], under, faces, rest_d, ('walk', 'run', 'sprint', 'jog', 'jump_air', 'stair', 'wave', 'run_stop', 'look_up', 'hand_to_chest', 'two_fingers') if inf['role'] == 'skirt' else None))
    frames = []
    for name in ('walk', 'run', 'sprint', 'sit', 'crouch', 'jump_air', 'wave', 'pickup'):
        c = poses['clips'].get(name)
        if not c:
            continue
        for fi, fr in enumerate(c['frames'][::2]):
            def fn(fr=fr):
                gp = RIG.GPose(B['bones'], B['trs'], fr['bones'])
                skirt_push(gp, B['springs'], B['colliders'], B['bones'])
                RIG.apply_to_armature(arm, gp)
            frames.append((f'{name}@{fr["t"]:.2f}', fn))
    own = CLIPS.poses(base, spec)
    for name, keys in own.items():
        for t, gp in keys[1:-1]:
            def fn(gp=gp):
                g = gp.copy()
                skirt_push(g, B['springs'], B['colliders'], B['bones'])
                RIG.apply_to_armature(arm, g)
            frames.append((f'{name}@{t:.2f}', fn))
    # a stair climb, past what the clips author (the runtime's foot placement lifts a knee this far on steps): one thigh
    # raised 60 and 75 degrees forward, its knee bent 90, the pelvis dropped 5 cm, the other leg straight
    for side in ('L', 'R'):
        for lift in (60, 75):
            g = base.copy()
            g.rotate_world(f'Bip01_{side}_Thigh', CLIPS.X, CLIPS.rad(-lift))
            g.rotate_world(f'Bip01_{side}_Calf', CLIPS.X, CLIPS.rad(90))
            g.t['Bip01'] = base.t['Bip01'] + Vector((0, -0.05, 0))

            def fn(g=g):
                gg = g.copy()
                skirt_push(gg, B['springs'], B['colliders'], B['bones'])
                RIG.apply_to_armature(arm, gg)
            frames.append((f'stair_{side}{lift}', fn))
    log(f'qa interpenetration: {len(pairs)} garments x {len(frames)} frames')
    q.interpenetration(frames, None, pairs)
    pose_idle()
    return q.report


def score(rep):
    s = 0.0
    for name, r in rep.get('interpenetration', {}).items():
        s += r['worst_share'] * 100 + r['worst_depth_mm'] * 0.2
    t = rep.get('triangles', 0)
    s += max(0, t - BUDGET) / 1000
    s += 10 * (1 - rep.get('silhouette_iou', {}).get('mean', 1))
    s += sum(e.get('delta_e', 0) for e in rep.get('palette', {}).values()) * 0.05
    s += 0.1 * (rep.get('colour_regions') or {}).get('mean', 0)
    s += 5 * sum(abs(v) for k, v in ((rep.get('features') or {}).get('delta_head_heights') or {}).items() if k != 'eye_size')
    return s


def sheet_corrections(rep, P, spec):
    """What the loop corrects from the feature check against the sheet: the face template's jaw and chin widths, the
    fringe's length (the hairline), the hair's volume (its outer width at the cheeks). Each correction moves the
    parameter by the measured ratio, so a second iteration lands close."""
    f = rep.get('features') or {}
    d = f.get('delta_head_heights') or {}
    w = f.get('widths_head_heights') or {}
    changed = False
    fit = P.setdefault('face_fit', {})
    for key, k in (('jaw_width', 'jaw'),):
        if key in w and abs(d.get(key, 0)) > 0.015 and w[key]['ours'] > 0.02:
            ratio = max(0.9, min(1.12, w[key]['sheet'] / w[key]['ours']))
            fit[k] = round(max(0.85, min(1.2, fit.get(k, 1.0) * ratio)), 3)
            changed = True
    if abs(d.get('hairline', 0)) > 0.035 and spec['hair']['style'] in ('bob', 'long', 'ponytail'):
        P['fringe_drop'] = round(max(-0.02, min(0.04, P.get('fringe_drop', 0.0) + d['hairline'] * spec['head_h'] * 0.9)), 4)
        changed = True
    if 'hair_width' in w and abs(d.get('hair_width', 0)) > 0.02 and w['hair_width']['ours'] > 0:
        # the volume is the shell's push past the head; the width beyond the face's own half-width scales with it
        face = 0.33
        ratio = (w['hair_width']['sheet'] - face) / max(0.02, w['hair_width']['ours'] - face)
        P['hair_volume'] = round(max(0.7, min(1.35, P.get('hair_volume', 1.0) * max(0.8, min(1.2, ratio)))), 3)
        changed = True
    return changed


def apply_params(spec, P):
    """The loop's parameters into the spec for one build."""
    spec['face_fit'] = dict(P.get('face_fit', {}))
    spec['fringe_drop'] = P.get('fringe_drop', 0.0)
    if 'hair_volume_base' not in spec:
        spec['hair_volume_base'] = spec['hair']['volume']
    spec['hair']['volume'] = spec['hair_volume_base'] * P.get('hair_volume', 1.0)


def sheet_fit(sheet, spec):
    """What the build takes from the sheet before modelling (sheet.py): the skirt's extent by height in each view and
    its hem, the face's features and the eyes' colours. Stored in spec['sheet_fit']; the stages use what they find."""
    if not sheet:
        return None
    import sheet as SH
    from common import linear_to_srgb as l2s
    img = RENDER.load_image(sheet)[..., :3]
    H = spec['height']
    fit = {}
    sk = next((o for o in spec['outfit'] if 'skirt' in o['item']), None)
    if sk:
        others = [[l2s(c) for c in o['rgb']] for o in spec['outfit'] if o is not sk and 'rgb' in o and 'sock' not in o['item']]
        others.append([l2s(c) for c in spec['skin']])
        prof = SH.skirt_profile(img, H, [l2s(c) for c in sk['rgb']], (0.12 * H, 0.66 * H), others)
        if prof:
            fit['skirt'] = prof
    hems = {}
    for o in spec['outfit']:
        if any(k in o['item'] for k in ('cardigan', 'jacket', 'coat')):
            others = [[l2s(c) for c in x['rgb']] for x in spec['outfit'] if x is not o and 'rgb' in x]
            hm = SH.garment_hem(img, H, [l2s(c) for c in o['rgb']], (0.3 * H, 0.7 * H), others)
            if hm:
                hems[o['item']] = hm
            # its extent by height in each view (the side view's depth is what the fitting takes)
            prof = SH.garment_profile(img, H, [l2s(c) for c in o['rgb']], ((hm or 0.45 * H) + 0.02 * H, 0.84 * H), others + [[l2s(c) for c in spec['skin']]])
            if prof:
                fit.setdefault('outer', {})[o['item']] = prof
    if hems:
        fit['hems'] = hems
    vs, _ = SH.views(img)
    vs = SH.pick_figures(vs)
    if vs:
        hh = spec['head_h']
        hf = SH.head_features(SH.Figure(vs[0], H), H - hh, H, [l2s(c) for c in spec['skin']])
        if hf:
            fit['head'] = hf
    log(f'sheet fit: skirt hem {fit.get("skirt", {}).get("hem")}, eyes {len(fit.get("head", {}).get("eyes", []))}, outer garments {[(k, len(v.get("side", []))) for k, v in fit.get("outer", {}).items()]}')
    return fit


# ---------------------------------------------------------------------------------------------------------------------

def main():
    a = args()
    out = os.path.abspath(a.get('out', '.'))
    os.makedirs(out, exist_ok=True)
    brief = BRIEF.load(a['brief'])
    spec = BRIEF.spec_of(brief)
    cid = spec['id']
    sheet = a.get('sheet')
    if sheet and not os.path.exists(sheet):
        sheet = None
    poses = motion_poses(spec['gender'], out)
    spec['sheet_fit'] = sheet_fit(sheet, spec) or {}
    P = {'ease': 1.0, 'body_sub': 2}
    history = []
    if a.get('revise') and os.path.exists(a['revise']):
        with open(a['revise']) as f:
            last = json.load(f)
        history = last.get('history', [])
        P.update(last.get('params', {}))
        applied = apply_notes(spec, brief.get('revision_notes', ''), P)
        log(f'revise: {applied}')
    if a.get('review'):
        blend = os.path.join(out, f'{cid}.blend')
        bpy.ops.wm.open_mainfile(filepath=blend)
        with open(os.path.join(out, f'{cid}.build.json')) as f:
            saved = json.load(f)
        rep = review(saved, out, sheet, poses, spec)
        write_report(out, rep)
        return
    best = None
    iters = 0
    for it in range(int(os.environ.get('AETHER_CHARACTER_ITERATIONS', '4'))):
        iters += 1
        log(f'iteration {iters}: {P}')
        CLOTHES.EASE = P['ease']
        apply_params(spec, P)
        B = build(spec, P, out)
        rep = run_qa(B, out, sheet, poses)
        sc = score(rep)
        history.append({'iteration': iters, 'params': dict(P), 'score': round(sc, 3), 'issues': rep['issues'][:8]})
        log(f'score {sc:.3f}; issues: {rep["issues"]}')
        if best is None or sc < best[0]:
            best = (sc, dict(P), rep)
            save_build(B, out)
        # what the pipeline can correct by itself
        fix = False
        # more ease helps the tight garments (the skirt hangs by its own envelope and weights, so not when it alone fails)
        if any('interpenetration' in i and 'through skirt' not in i for i in rep['issues']) and P['ease'] < 2.0:
            P['ease'] = round(P['ease'] * 1.35, 3)
            fix = True
        if rep.get('triangles', 0) > BUDGET and P['body_sub'] > 1:
            P['body_sub'] = 1
            fix = True
        if sheet_corrections(rep, P, spec):
            fix = True
        if not fix:
            break
    # reload the best and export it
    sc, P, rep = best
    bpy.ops.wm.open_mainfile(filepath=os.path.join(out, f'{cid}.blend'))
    with open(os.path.join(out, f'{cid}.build.json')) as f:
        saved = json.load(f)
    rep = finish_build(saved, out, spec, rep, P, iters, history)
    write_report(out, rep)
    log('done')


def save_build(B, out):
    cid = B['spec']['id']
    for f in ('turnaround.png', 'expressions.png'):
        src = os.path.join(out, f)
    data = {k: B[k] for k in ('trs', 'springs', 'colliders', 'info', 'palette_roles', 'head_top', 'base_quads')}
    data['role_id'] = {k: list(v) for k, v in B['role_id'].items()}
    data['palette_roles'] = {k: list(v) for k, v in B['palette_roles'].items()}
    data['chin'] = list(B['chin'])
    data['bones'] = [{'name': b['name'], 'parent': b['parent'], 'world': [list(r) for r in b['world']], 'rest_r': b['rest_r']} for b in B['bones']]
    data['J'] = {k: list(v) for k, v in B['J'].items()}
    data['atlas_png'] = B['atlas_png']
    with open(os.path.join(out, f'{cid}.build.json'), 'w') as f:
        json.dump(data, f)
    for f in ('turnaround.png', 'expressions.png'):
        p = os.path.join(out, f)
        if os.path.exists(p):
            import shutil
            shutil.copy(p, os.path.join(out, f'best-{f}'))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, f'{cid}.blend'), compress=True)


def restore(saved):
    from mathutils import Matrix
    bones = [{'name': b['name'], 'parent': b['parent'], 'world': Matrix(b['world']), 'rest_r': b['rest_r']} for b in saved['bones']]
    J = {k: Vector(v) for k, v in saved['J'].items()}
    arm = bpy.data.objects['Biped']
    body = [o for o in bpy.data.objects if o.name.endswith('-body') and o.type == 'MESH'][0]
    img = bpy.data.images.get('atlas') or SHADING.atlas_image(saved['atlas_png'])
    return {'bones': bones, 'J': J, 'arm': arm, 'body': body, 'img': img, 'trs': saved['trs'], 'springs': saved['springs'], 'colliders': saved['colliders'],
            'info': saved['info'], 'role_id': {k: tuple(v) for k, v in saved['role_id'].items()}, 'palette_roles': {k: tuple(v) for k, v in saved['palette_roles'].items()},
            'head_top': saved['head_top'], 'chin': Vector(saved['chin']), 'base_quads': saved['base_quads'], 'atlas_png': saved['atlas_png']}


def review(saved, out, sheet, poses, spec):
    B = restore(saved)
    B['spec'] = spec
    rep = run_qa(B, out, sheet, poses)
    prev = os.path.join(out, 'report.json')
    if os.path.exists(prev):
        with open(prev) as f:
            old = json.load(f)
        for k in ('bytes', 'lods', 'clips', 'iterations', 'history', 'params', 'glb', 'skeleton', 'cast_entry', 'morphs', 'springs'):
            if k in old:
                rep[k] = old[k]
    rep['passed'] = not rep['issues']
    rep['reviewed'] = True
    return rep


def finish_build(saved, out, spec, rep, P, iters, history):
    B = restore(saved)
    B['spec'] = spec
    cid = spec['id']
    arm, body = B['arm'], B['body']
    # QA-only bits off: the preview outline and material, the pose
    if body.modifiers.get('outline'):
        body.modifiers.remove(body.modifiers['outline'])
    for pb in arm.pose.bones:
        pb.matrix_basis.identity()
    mat = SHADING.export_material(B['img'], spec['style'], f'{cid}-toon' if spec['style'] == 'anime' else f'{cid}-pbr')
    body.data.materials.clear()
    body.data.materials.append(mat)
    for name in ('qa_id',):
        a = body.data.color_attributes.get(name)
        if a:
            body.data.color_attributes.remove(a)
    if body.data.attributes.get('qa_part'):
        body.data.attributes.remove(body.data.attributes['qa_part'])
    poses = motion_poses(spec['gender'], out)
    base = RIG.GPose(B['bones'], B['trs'], poses['clips']['idle']['frames'][0]['bones'])
    own = {k: v for k, v in CLIPS.poses(base, spec).items() if k in spec['clips']}
    made = [{'name': k, 'duration': v[-1][0]} for k, v in own.items()]
    for pb in arm.pose.bones:
        pb.matrix_basis.identity()
    blender_glb = os.path.join(out, f'{cid}.blender.glb')
    log('export')
    EXPORT.export_glb(blender_glb, arm, body, with_anim=False)
    drift = EXPORT.patch(blender_glb, B['trs'], f'{cid}-body', B['atlas_png'])
    EXPORT.add_animations(blender_glb, own)
    meta_path = os.path.join(out, f'{cid}.meta.json')
    EXPORT.write_meta(meta_path, spec, B['springs'], B['colliders'])
    entry = EXPORT.finish(REPO, blender_glb, meta_path, os.path.join(out, f'{cid}.glb'), spec['install'])
    # far level of detail
    lods = [{'level': 0, 'triangles': rep.get('triangles')}]
    try:
        lo = EXPORT.lod(body, 0.4)
        lo.name = f'{cid}-body'
        body.name = f'{cid}-body-full'
        lod_glb = os.path.join(out, f'{cid}.lod1.blender.glb')
        EXPORT.export_glb(lod_glb, arm, lo, with_anim=False)
        EXPORT.patch(lod_glb, B['trs'], f'{cid}-body', B['atlas_png'])
        # installed beside the body (the cast entry's `lod1`) when the body is
        e2 = EXPORT.finish(REPO, lod_glb, meta_path, os.path.join(out, f'{cid}.lod1.glb'), spec['install'], lod1=True)
        lods.append({'level': 1, 'triangles': e2.get('triangles'), 'bytes': e2.get('bytes'), 'file': f'{cid}.lod1.glb', 'installed': e2.get('file') if spec['install'] else None})
    except Exception as e:  # a missing level of detail is reported, not fatal
        rep['issues'].append(f'lod: {e}')
    rep['bytes'] = entry.get('bytes')
    rep['glb'] = f'{cid}.glb'
    rep['cast_entry'] = entry
    rep['lods'] = lods
    rep['clips'] = [m['name'] for m in made]
    rep['morphs'] = FACE.EXPRESSIONS
    rep['springs'] = [s['name'] for s in B['springs']]
    rep['skeleton'] = {'bones': len(B['trs']), 'rest_rotations': 'the library Biped, exact', 'blender_export_rest_deviation_patched': round(drift, 4)}
    rep['iterations'] = iters
    rep['history'] = history
    rep['params'] = P
    rep['installed'] = bool(spec['install'])
    rep['passed'] = not rep['issues']
    import shutil
    for f in ('turnaround.png', 'expressions.png'):
        bp = os.path.join(out, f'best-{f}')
        if os.path.exists(bp):
            shutil.move(bp, os.path.join(out, f))
    return rep


def write_report(out, rep):
    with open(os.path.join(out, 'report.json'), 'w') as f:
        json.dump(rep, f, indent=1, default=lambda o: list(o) if hasattr(o, '__iter__') else str(o))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        import traceback
        traceback.print_exc()
        out = args().get('out', '.')
        try:
            with open(os.path.join(out, 'report.json'), 'w') as f:
                json.dump({'passed': False, 'issues': [f'the pipeline failed: {e}'], 'trace': traceback.format_exc()[-3000:]}, f, indent=1)
        except Exception:
            pass
        sys.exit(1)
