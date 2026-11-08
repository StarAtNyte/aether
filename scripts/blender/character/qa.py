"""The QA pass: turnaround renders and the checks of report.json.

- turnaround.png: front, her left side and back (orthographic, cel-shaded with outlines, the idle pose of the motion
  set), and expressions.png: the face through every morph.
- silhouette_iou: with a sheet, each view's mask against the sheet's figure (found on its flat background, split into
  views by empty columns), both scaled to the same height and centred.
- proportions: heads tall, hip joint over height, leg length, shoulder width in heads; with a sheet, the same ratios
  measured on its front view where they can be.
- palette: each colour role of the brief against the rendered lit tone of that part (CIE delta E), and with a sheet
  against the sheet's colour at the same place.
- interpenetration: the body's skin against each tight garment, and the thighs against the skirt (its panels pushed
  out of the thigh capsules as the runtime springs do), through sampled frames of the motion set and our own clips.
- weights, topology, budget, bytes.
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

import render as R
import sheet as SHEET
import shading
from common import delta_e, linear_to_srgb


def mask_bbox(a, thr=0.5):
    ys, xs = np.where(a > thr)
    if len(ys) == 0:
        return None
    return xs.min(), ys.min(), xs.max(), ys.max()


def normalize_mask(m, h=256, w=192):
    """A mask cropped to its bounding box, scaled to height h, centred in a w-wide frame."""
    bb = mask_bbox(m)
    if bb is None:
        return np.zeros((h, w))
    x0, y0, x1, y1 = bb
    c = m[y0:y1 + 1, x0:x1 + 1]
    sh, sw = c.shape
    k = h / sh
    nw = max(1, int(round(sw * k)))
    ys = np.clip((np.arange(h) / k).astype(int), 0, sh - 1)
    xs = np.clip((np.arange(nw) / k).astype(int), 0, sw - 1)
    s = c[ys][:, xs]
    out = np.zeros((h, w))
    cx = (s.sum(0) * np.arange(nw)).sum() / max(1e-6, s.sum())
    off = int(round(w / 2 - cx))
    lo = max(0, off)
    hi = min(w, off + nw)
    out[:, lo:hi] = s[:, lo - off:hi - off]
    return out


def sheet_views(sheet):
    """The sheet's three figures (front, her left side, back), edge-based (sheet.py): [(mask, (x0, x1), rgb, view)]."""
    vs, bg = SHEET.views(sheet[..., :3])
    vs = SHEET.pick_figures(vs)
    return [(v['mask'], (v['x0'], v['x1']), v['rgb'], v) for v in vs], bg


def render_figure(img):
    """One of our renders as a sheet view (alpha is the mask)."""
    m = img[..., 3] > 0.5
    ys, xs = np.where(m)
    return {'mask': m.astype(float), 'x0': 0, 'x1': img.shape[1], 'rgb': img[..., :3], 'top': int(ys.min()), 'floor': int(ys.max()),
            'cx': float((m.sum(0) * np.arange(m.shape[1])).sum() / max(1, m.sum())), 'area': int(m.sum())}


def iou(a, b):
    i = np.logical_and(a > 0.5, b > 0.5).sum()
    u = np.logical_or(a > 0.5, b > 0.5).sum()
    return float(i / u) if u else 0.0


class QA:
    def __init__(self, out, spec, arm, body, parts_info, atlas_img, J):
        self.out = out
        self.spec = spec
        self.arm = arm
        self.body = body
        self.info = parts_info
        self.img = atlas_img
        self.J = J
        self.report = {'issues': []}

    def issue(self, s):
        self.report['issues'].append(s)

    # --- renders -----------------------------------------------------------------------------------------------------
    def preview_setup(self):
        R.setup_scene('BLENDER_EEVEE_NEXT', transparent=True)
        bpy.context.scene.world.node_tree.nodes['Background'].inputs[1].default_value = 0.0
        shading.sun()
        mat = shading.toon_preview_material(self.img, realistic=self.spec['style'] != 'anime')
        self.body.data.materials.clear()
        self.body.data.materials.append(mat)
        if self.spec['style'] == 'anime' and not self.body.modifiers.get('outline'):
            shading.add_outline(self.body, width=0.0012)
        # the outline modifier sits after the armature
        return mat

    def turnaround(self, pose_fn):
        pose_fn()
        H = self.spec['height']
        views = {}
        for name, az in (('front', 0), ('side', 90), ('back', 180)):
            views[name] = R.render_view(f'{self.out}/qa-{name}.png', az, H, H / 2 + 0.01, ortho=H * 1.08, res=(640, 1280))
        R.save_png(f'{self.out}/turnaround.png', R.side_by_side([views['front'], views['side'], views['back']]))
        self.views = views
        return views

    def ids(self):
        """A flat render of the part ids (front view), for the palette check."""
        m = bpy.data.materials.new('qa-id')
        m.use_nodes = True
        nt = m.node_tree
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        at = nt.nodes.new('ShaderNodeAttribute')
        at.attribute_name = 'qa_id'
        em = nt.nodes.new('ShaderNodeEmission')
        nt.links.new(at.outputs['Color'], em.inputs['Color'])
        nt.links.new(em.outputs[0], out.inputs[0])
        mats = list(self.body.data.materials)
        self.body.data.materials.clear()
        self.body.data.materials.append(m)
        mod = self.body.modifiers.get('outline')
        if mod:
            mod.show_render = False
        sc = bpy.context.scene
        vt = sc.view_settings.view_transform
        sc.view_settings.view_transform = 'Raw'
        H = self.spec['height']
        img = R.render_view(f'{self.out}/qa-ids.png', 0, H, H / 2 + 0.01, ortho=H * 1.08, res=(640, 1280))
        sc.view_settings.view_transform = vt
        self.body.data.materials.clear()
        for mm in mats:
            self.body.data.materials.append(mm)
        if mod:
            mod.show_render = True
        return img

    def expressions(self, keys):
        hd = self.J['Bip01_Head']
        tiles = []
        kb = self.body.data.shape_keys.key_blocks if self.body.data.shape_keys else None
        u = self.spec['head_h'] / 0.237
        for ex in [''] + keys:
            if kb:
                for k in kb[1:]:
                    k.value = 1.0 if k.name == ex else 0.0
            tiles.append(R.render_view(f'{self.out}/qa-ex.png', 12, 0.3, 0, ortho=0.3 * u, res=(320, 320), target=hd + Vector((0, 0, 0.02 * u)), elev=0.05))
        if kb:
            for k in kb[1:]:
                k.value = 0.0
        row1 = R.side_by_side(tiles[:4])
        row2 = R.side_by_side(tiles[4:] + [np.zeros_like(tiles[0])] * (8 - len(tiles)))
        R.save_png(f'{self.out}/expressions.png', np.concatenate([row1, row2], 0))

    # --- checks ------------------------------------------------------------------------------------------------------
    def silhouette(self, sheet_path):
        if not sheet_path:
            return None
        sheet = R.load_image(sheet_path)
        views, bg = sheet_views(sheet)
        self.sheet = sheet
        self.sheet_views = views
        if len(views) < 3:
            self.issue(f'sheet: found {len(views)} figure views, expected 3 (front, side, back)')
        out = {}
        tiles = []
        for k, name in enumerate(('front', 'side', 'back')):
            if k >= len(views):
                break
            a = normalize_mask(self.views[name][..., 3])
            b = normalize_mask(views[k][0])
            t = np.ones(a.shape + (4,))
            t[..., 0] = 1 - b * 0.8
            t[..., 1] = 1 - np.maximum(a, b) * 0.8
            t[..., 2] = 1 - a * 0.8
            tiles.append(t)
            if name == 'side':
                # the sheet's side view faces left (her left side); ours too
                pass
            out[name] = round(iou(a, b), 3)
        if tiles:
            R.save_png(f'{self.out}/silhouette.png', np.concatenate(tiles, 1))
        if out:
            out['mean'] = round(float(np.mean([v for v in out.values()])), 3)
            if out['mean'] < 0.8:
                self.issue(f'silhouette IoU against the sheet {out["mean"]:.2f} (< 0.80)')
        self.report['silhouette_iou'] = out
        return out

    def colour_regions(self):
        """Each view cut into a 12 x 4 grid of the figure's bounds; per cell our lit colour against the sheet's
        (median, CIE delta E). A wrong colour role, a missing shadow or a part in the wrong place shows as a cell far
        off."""
        if not getattr(self, 'sheet_views', None):
            return None
        out = {}
        # a model sheet is lit flat from the viewer: each view again with the preview sun turned with the camera, so a
        # back in shadow is not counted as a wrong colour
        lit = self.flat_views()
        for k, name in enumerate(('front', 'side', 'back')):
            if k >= len(self.sheet_views):
                break
            im = lit.get(name, self.views[name])
            sm, _, srgb, _ = self.sheet_views[k]
            cells, mean, worst = SHEET.colour_regions(im[..., :3], im[..., 3] > 0.5, srgb[..., :3], sm > 0.5)
            if mean is None:
                continue
            out[name] = {'mean_delta_e': mean, 'worst': worst, 'over_15': sum(1 for c in cells if c['delta_e'] > 15), 'cells': len(cells)}
        if out:
            out['mean'] = round(float(np.mean([v['mean_delta_e'] for v in out.values()])), 1)
            if out['mean'] > 12:
                self.issue(f'colour regions against the sheet: mean delta E {out["mean"]} (> 12)')
        self.report['colour_regions'] = out
        return out

    def flat_views(self):
        import mathutils
        mat = self.body.data.materials[0] if self.body.data.materials else None
        dots = [n for n in mat.node_tree.nodes if n.type == 'VECT_MATH' and n.operation == 'DOT_PRODUCT'] if mat and mat.node_tree else []
        if not dots:
            return {}
        d0 = mathutils.Vector(shading.SUN_DIR).normalized()
        H = self.spec['height']
        out = {}
        for name, az in (('front', 0), ('side', 90), ('back', 180)):
            d = mathutils.Matrix.Rotation(math.radians(az), 3, 'Z') @ d0
            for n in dots:
                n.inputs[1].default_value = d
            out[name] = R.render_view(f'{self.out}/qa-flat.png', az, H, H / 2 + 0.01, ortho=H * 1.08, res=(640, 1280))
        for n in dots:
            n.inputs[1].default_value = d0
        return out

    def features(self, head_top, chin_z):
        """The eyes, mouth and hairline found the same way on the sheet's front view and on ours (sheet.head_features);
        their heights, the eyes' spacing and size and the jaw's width compared in head heights."""
        if not getattr(self, 'sheet_views', None):
            return None
        H = self.spec['height']
        skin = [linear_to_srgb(c) for c in self.spec['skin']]
        hh = head_top - chin_z
        theirs = SHEET.head_features(SHEET.Figure(self.sheet_views[0][3], H), chin_z, head_top, skin)
        ours = SHEET.head_features(SHEET.Figure(render_figure(self.views['front']), H), chin_z, head_top, skin)
        if not theirs or not ours:
            return None
        rep = {'sheet': {k: v for k, v in theirs.items() if k != 'profile'}, 'ours': {k: v for k, v in ours.items() if k != 'profile'}}
        d = {}

        def rel(z):
            return (z - chin_z) / hh

        if theirs['hairline_z'] and ours['hairline_z']:
            d['hairline'] = round(float(rel(ours['hairline_z']) - rel(theirs['hairline_z'])), 3)
        if theirs['mouth_z'] and ours['mouth_z']:
            d['mouth'] = round(float(rel(ours['mouth_z']) - rel(theirs['mouth_z'])), 3)
        if len(theirs['eyes']) == 2 and len(ours['eyes']) == 2:
            d['eye_height'] = round(float(np.mean([rel(e['z']) for e in ours['eyes']]) - np.mean([rel(e['z']) for e in theirs['eyes']])), 3)
            sp = lambda es: abs(es[0]['x'] - es[1]['x']) / hh
            d['eye_spacing'] = round(float(sp(ours['eyes']) - sp(theirs['eyes'])), 3)
            size = lambda f: np.sqrt(np.mean([e['px'] for e in f['eyes']])) / max(1, f['head_px'])
            d['eye_size'] = round(float(size(ours) - size(theirs)), 3)
        elif len(theirs['eyes']) == 2:
            self.issue(f'features: found {len(ours["eyes"])} eyes on our front view')

        def band(p, z0, z1):
            rows = [min(l, r) for z, l, r in p['profile'] if chin_z + hh * z0 < z < chin_z + hh * z1]
            return float(np.median(rows)) / hh if rows else None

        widths = {}
        for key, (z0, z1) in (('jaw_width', (0.1, 0.3)), ('chin_width', (0.02, 0.1))):
            ja, jb = band(ours, z0, z1), band(theirs, z0, z1)
            if ja and jb:
                d[key] = round(ja - jb, 3)
                widths[key] = {'ours': round(ja, 3), 'sheet': round(jb, 3)}
        rep['widths_head_heights'] = widths
        # the hair's outer half-width at the cheeks (front view), against the sheet's (the volume)
        def outer(f, zz):
            y = f.row(zz)
            a, b = SHEET.row_run(f.m[y], f.cx)
            return max(f.cx - a, b - f.cx) * f.k / hh if b > a else None
        fo = SHEET.Figure(render_figure(self.views['front']), H)
        fs = SHEET.Figure(self.sheet_views[0][3], H)
        ho = [outer(fo, chin_z + hh * t) for t in (0.45, 0.6, 0.75)]
        hs = [outer(fs, chin_z + hh * t) for t in (0.45, 0.6, 0.75)]
        if all(ho) and all(hs):
            d['hair_width'] = round(float(np.mean(ho) - np.mean(hs)), 3)
            widths['hair_width'] = {'ours': round(float(np.mean(ho)), 3), 'sheet': round(float(np.mean(hs)), 3)}
        rep['delta_head_heights'] = d
        for k2, v in d.items():
            if k2 == 'eye_size':
                continue   # the blob's size depends on the painting's darks: reported, not judged
            if abs(v) > 0.06:
                self.issue(f'features: {k2} off the sheet by {v:+.2f} head heights')
        self.report['features'] = rep
        return rep

    def proportions(self, head_top, chin_z, hip_z):
        H = self.spec['height']
        hh = head_top - chin_z
        ua = self.J['Bip01_L_UpperArm']
        p = {
            'height_m': round(H, 3),
            'head_ratio': round(head_top / hh, 2),
            'head_ratio_target': self.spec['ratio'],
            'hip_over_height': round(hip_z / head_top, 3),
            'leg_length_heads': round(hip_z / hh, 2),
            'shoulder_heads': round(2 * abs(ua.x) / hh, 2),
        }
        if abs(p['head_ratio'] - self.spec['ratio']) > 0.35:
            self.issue(f'head ratio {p["head_ratio"]} vs brief {self.spec["ratio"]}')
        if getattr(self, 'sheet_views', None):
            m = self.sheet_views[0][0]
            bb = mask_bbox(m)
            if bb:
                p['sheet_height_px'] = int(bb[3] - bb[1])
        self.report['proportions'] = p
        return p

    def palette(self, roles, id_img, id_colours):
        """roles: {role: brief linear colour}; id_colours: {role: id colour (linear)}."""
        front = self.views['front']
        out = {}
        ids = id_img[..., :3]
        for role, want in roles.items():
            idc = id_colours.get(role)
            if idc is None:
                continue
            # the id pass is written raw (linear); accept either encoding
            m = np.zeros(ids.shape[:2], bool)
            for cand in (np.array(idc), np.array([linear_to_srgb(c) for c in idc])):
                m |= (np.abs(ids - cand).max(2) < 0.02) & (id_img[..., 3] > 0.9)
            if m.sum() < 30:
                continue
            got = np.median(front[..., :3][m], 0)
            want_s = [linear_to_srgb(c) for c in want]
            # the lit tone is the base times the lit tint: compare against that
            lit = [linear_to_srgb(c * t) for c, t in zip(want, shading.LIT)]
            e = {'brief': '#%02x%02x%02x' % tuple(int(round(c * 255)) for c in want_s), 'render': '#%02x%02x%02x' % tuple(int(round(c * 255)) for c in got),
                 'delta_e': round(min(delta_e(got, want_s), delta_e(got, lit)), 1)}
            if getattr(self, 'sheet', None) is not None and self.sheet_views:
                # the same place on the sheet's front view
                ys, xs = np.where(m)
                bb = mask_bbox(front[..., 3])
                sm, (sx0, sx1), srgb, _ = self.sheet_views[0]
                sbb = mask_bbox(sm)
                if bb and sbb:
                    k = (sbb[3] - sbb[1]) / max(1, bb[3] - bb[1])
                    cx = (bb[0] + bb[2]) / 2
                    scx = (sbb[0] + sbb[2]) / 2
                    sy = np.clip(((ys - bb[1]) * k + sbb[1]).astype(int), 0, srgb.shape[0] - 1)
                    sxx = np.clip(((xs - cx) * k + scx).astype(int), 0, srgb.shape[1] - 1)
                    ok = sm[sy, sxx] > 0.5
                    if ok.sum() > 20:
                        sc = np.median(srgb[sy[ok], sxx[ok]], 0)
                        e['sheet'] = '#%02x%02x%02x' % tuple(int(round(c * 255)) for c in sc)
                        e['delta_e_sheet'] = round(delta_e(got, sc), 1)
            out[role] = e
            if e['delta_e'] > 12:
                self.issue(f'palette: {role} renders {e["render"]}, brief {e["brief"]} (dE {e["delta_e"]})')
        self.report['palette'] = out
        return out

    def topology(self, base_quads):
        me = self.body.data
        bm = bmesh.new()
        bm.from_mesh(me)
        nonman = sum(1 for e in bm.edges if not e.is_manifold)
        loose = sum(1 for v in bm.verts if not v.link_edges)
        bm.free()
        tris = sum(len(p.vertices) - 2 for p in me.polygons)
        t = {'triangles': tris, 'vertices': len(me.vertices), 'base_body_quad_share': round(base_quads, 3), 'open_edges': nonman, 'loose_vertices': loose,
             'shape_keys': [k.name for k in me.shape_keys.key_blocks[1:]] if me.shape_keys else []}
        self.report['topology'] = t
        self.report['triangles'] = tris
        lo, hi = (30000, 75000) if self.spec['style'] == 'anime' else (30000, 80000)
        if tris > hi:
            self.issue(f'budget: {tris} triangles (over {hi})')
        if loose:
            self.issue(f'topology: {loose} loose vertices')
        return t

    def weights(self):
        me = self.body.data
        names = {g.index: g.name for g in self.body.vertex_groups}
        bones = {b.name for b in self.arm.data.bones}
        unweighted = over = bad_sum = foreign = 0
        for v in me.vertices:
            gs = [g for g in v.groups if g.weight > 1e-4 and names[g.group] in bones]
            if not gs:
                unweighted += 1
            if len(gs) > 4:
                over += 1
            s = sum(g.weight for g in gs)
            if gs and abs(s - 1) > 0.01:
                bad_sum += 1
            if any(names[g.group] not in bones and names[g.group] not in ('outline', 'face_front') for g in gs):
                foreign += 1
        w = {'unweighted': unweighted, 'over_4_influences': over, 'not_normalized': bad_sum, 'non_bone_groups': foreign}
        self.report['weights'] = w
        if unweighted or over or foreign:
            self.issue(f'weights: {w}')
        return w

    def interpenetration(self, frames, pose_apply, pairs):
        """frames: list of (label, callable that poses the armature). pairs: list of (name, skin vertex ids, garment vertex ids, tol)."""
        dg = bpy.context.evaluated_depsgraph_get()
        self.rest_x = np.array([v.co.x for v in self.body.data.vertices])
        mod = self.body.modifiers.get('outline')
        if mod:
            mod.show_viewport = False
        result = {}
        worst = {}
        for label, pose in frames:
            pose()
            dg.update()
            ev = self.body.evaluated_get(dg)
            me = ev.to_mesh()
            co = np.empty(len(me.vertices) * 3)
            me.vertices.foreach_get('co', co)
            co = co.reshape(-1, 3)
            nr = np.empty(len(me.vertices) * 3)
            me.vertices.foreach_get('normal', nr)
            nr = nr.reshape(-1, 3)
            verts = [Vector(c) for c in co]
            for name, skin, gfaces, reach, only in pairs:
                if only and not label.startswith(only):
                    continue
                bvh = BVHTree.FromPolygons(verts, gfaces, all_triangles=False)
                n_in = 0
                depth = 0.0
                if name == 'skirt':
                    # a thigh vertex is through when the skirt lies between it and the thigh bone (the leg crossed the
                    # cloth); a thigh that leaves through the hem, under the skirt's opening, is not
                    pb = self.arm.pose.bones
                    mw = self.arm.matrix_world
                    axis = {sd: (mw @ pb[f'Bip01_{sd}_Thigh'].head, mw @ pb[f'Bip01_{sd}_Calf'].head) for sd in ('L', 'R')}
                    for i in skin:
                        p = verts[i]
                        a, b = axis['L' if self.rest_x[i] > 0 else 'R']
                        ab = b - a
                        t = max(0.0, min(1.0, (p - a).dot(ab) / max(1e-9, ab.length_squared)))
                        q = a + ab * t
                        d = p - q
                        if d.length < 1e-5:
                            continue
                        hit = bvh.ray_cast(q, d.normalized(), d.length)
                        if hit[0] is not None:
                            n_in += 1
                            depth = max(depth, d.length - hit[3])
                for i in (skin if name != 'skirt' else ()):
                    p = verts[i]
                    n = Vector(nr[i])
                    # through if the garment is no longer above the skin within its rest distance and some slack
                    hit = bvh.ray_cast(p + n * 0.0005, n, (reach[i] + 0.015) if name != 'skirt' else 0.25)
                    if hit[0] is None:
                        # out of the garment: how far
                        loc, _, _, d = bvh.find_nearest(p, 0.05)
                        n_in += 1
                        depth = max(depth, d if loc is not None else 0.05)
                frac = n_in / max(1, len(skin))
                r = result.setdefault(name, {'checked_vertices': len(skin), 'frames': 0, 'worst_share': 0.0, 'worst_depth_mm': 0.0, 'worst_frame': ''})
                r['frames'] += 1
                if frac > 0.005:
                    r.setdefault('through', {})[label] = round(frac, 3)
                if frac > r['worst_share']:
                    r['worst_share'] = round(frac, 4)
                    r['worst_frame'] = label
                r['worst_depth_mm'] = round(max(r['worst_depth_mm'], depth * 1000), 1)
            ev.to_mesh_clear()
        if mod:
            mod.show_viewport = True
        for name, r in result.items():
            if r['worst_share'] > 0.01 or r['worst_depth_mm'] > 6:
                self.issue(f'interpenetration: the body shows through {name} in {r["worst_frame"]} ({r["worst_share"] * 100:.1f}% of its vertices, {r["worst_depth_mm"]} mm)')
        self.report['interpenetration'] = result
        return result
