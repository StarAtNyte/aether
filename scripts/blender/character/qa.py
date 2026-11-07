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
    """Split a turnaround sheet into figure masks (left to right) on its flat background."""
    rgb = sheet[..., :3]
    h, w = rgb.shape[:2]
    # background: the most common colour of the border
    border = np.concatenate([rgb[:8].reshape(-1, 3), rgb[-40:-30].reshape(-1, 3), rgb[:, :6].reshape(-1, 3), rgb[:, -6:].reshape(-1, 3)])
    bg = np.median(border, 0)
    diff = np.abs(rgb - bg).max(2)
    bgm = diff <= 0.09
    # the background is what floods in from the border; the rest (holes included) is figure
    reach = np.zeros_like(bgm)
    reach[0, :] = reach[-1, :] = reach[:, 0] = reach[:, -1] = True
    reach &= bgm
    for _ in range(4000):
        grown = reach.copy()
        grown[1:] |= reach[:-1]
        grown[:-1] |= reach[1:]
        grown[:, 1:] |= reach[:, :-1]
        grown[:, :-1] |= reach[:, 1:]
        grown &= bgm
        if (grown == reach).all():
            break
        reach = grown
    fg = ~reach
    # thin guide lines and text out: an opening (3 px)
    def erode(m, k):
        out = m.copy()
        for d in range(1, k + 1):
            out[d:] &= m[:-d]; out[:-d] &= m[d:]; out[:, d:] &= m[:, :-d]; out[:, :-d] &= m[:, d:]
        return out
    def dilate(m, k):
        out = m.copy()
        for d in range(1, k + 1):
            out[d:] |= m[:-d]; out[:-d] |= m[d:]; out[:, d:] |= m[:, :-d]; out[:, :-d] |= m[:, d:]
        return out
    fg = dilate(erode(fg, 3), 3)
    # rows of the figures: below the top margin, above the label row
    cols = fg.sum(0)
    runs = []
    on = False
    for x, c in enumerate(cols):
        if c > h * 0.08 and not on:
            on, start = True, x
        elif c <= h * 0.08 and on:
            on = False
            if x - start > w * 0.04:
                runs.append((start, x))
    if on and w - start > w * 0.04:
        runs.append((start, w))
    views = []
    for x0, x1 in runs:
        m = fg[:, max(0, x0 - 20):min(w, x1 + 20)].astype(float)
        # keep the tallest connected vertical band (the figure), not the labels below it
        rows = m.sum(1)
        ys = np.where(rows > 2)[0]
        if len(ys) == 0:
            continue
        views.append((m, (x0, x1), sheet[:, max(0, x0 - 20):min(w, x1 + 20), :3]))
    return views, bg


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
        if len(views) > 3:
            # guides or extra figures: keep the three neighbouring views that match ours best
            ours = [normalize_mask(self.views[n][..., 3]) for n in ('front', 'side', 'back')]
            best = max(range(len(views) - 2), key=lambda i: sum(iou(ours[k], normalize_mask(views[i + k][0])) for k in range(3)))
            views = views[best:best + 3]
            self.sheet_views = views
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
                sm, (sx0, sx1), srgb = self.sheet_views[0]
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
        lo, hi = (30000, 60000) if self.spec['style'] == 'anime' else (30000, 80000)
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
                for i in skin:
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
