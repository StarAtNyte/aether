"""The clothing kit, fitted to the body with collision-aware offsets.

Garments that follow the body (tops, cardigans, jackets, trousers, socks, boot shafts) are extracted from the body's
own surface (its regions by nearest limb segment), pushed out along the normal by the garment's ease plus its layer, and
keep the body's skin weights vertex for vertex, so they deform with it and cannot cross it. Garments that hang or have
their own form are built parametrically and fitted by casting against the body: the pleated skirt (pleat count, length,
real pleat depth growing from the hips, an A-line flare clearing the hips and thighs), the sailor collar with its lines,
the neckerchief's knot and tails, shoes (loafers, sneakers, boots), a watch, a bag strap. Body faces fully covered by a
tight garment are removed (no poke-through, fewer triangles).

Every garment registers its colour role (for the palette check) and its springs (skirt panels, tie tails).
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

from common import Part, apply_modifiers, b2g_point, catmull, lerp, new_object, shade_smooth, smoothstep, subdivide
from skeleton import add_secondary
import paint as P

PANELS = 16   # skirt panel springs round the hips (the cloth between two is blended: more panels, smaller chords)
EASE = 1.0   # the QA loop raises it when the body shows through a garment


class Kit:
    def __init__(self, spec, J, body, lab, tp, W, atlas, bones):
        self.spec = spec
        self.J = J
        self.body = body
        self.lab = lab
        self.tp = tp
        self.W = W            # per body vertex: {bone: weight}
        self.atlas = atlas
        self.bones = bones
        self.parts = []
        self.springs = []
        self.hide = np.zeros(len(body.data.vertices), bool)   # body vertices covered by a tight garment
        self.palette = {}
        self.s = spec['height'] / 1.54
        self.co = np.array([v.co[:] for v in body.data.vertices])
        self.nrm = np.array([v.normal[:] for v in body.data.vertices])
        self.bvh = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())
        self.polys = [tuple(p.vertices) for p in body.data.polygons]
        # the trunk and legs only (no arms or hands: in the rest pose the hands hang beside the hips)
        trunk = [k for k, p in enumerate(self.polys) if all(not str(lab[v]).startswith(('hand', 'forearm', 'upperarm')) for v in p)]
        torso = [k for k, p in enumerate(self.polys) if all(str(lab[v]) == 'torso' for v in p)]
        self.torso_polys = torso
        self.bvh_torso = BVHTree.FromPolygons([Vector(c) for c in self.co], [self.polys[k] for k in torso])
        self.trunk_polys = trunk
        self.bvh_trunk = BVHTree.FromPolygons([Vector(c) for c in self.co], [self.polys[k] for k in trunk])
        self.z = {
            'neck': J['Bip01_Neck'].z, 'chest': J['Bip01_Spine2'].z,
            # the natural waist, a little over a third of the way from the hip joints to the neck
            'waist': J['Bip01_Pelvis'].z + (J['Bip01_Neck'].z - J['Bip01_Pelvis'].z) * 0.33,
            'hip': J['Bip01_Pelvis'].z, 'knee': J['Bip01_L_Calf'].z, 'ankle': J['Bip01_L_Foot'].z,
        }
        self.outer_bvh = None
        self.skirt_panels = []   # (spring index, attach point, hem point) in Blender space at rest

    # --- helpers ---------------------------------------------------------------------------------------------------
    def weights_at(self, p, trunk=False):
        if trunk:
            loc, n, fi, d = self.bvh_torso.find_nearest(p)
            fi = self.torso_polys[fi]
        else:
            loc, n, fi, d = self.bvh.find_nearest(p)
        acc = {}
        tot = 0.0
        for vi in self.polys[fi]:
            w = 1.0 / (1e-4 + (Vector(self.co[vi]) - loc).length)
            tot += w
            for b, x in self.W[vi].items():
                acc[b] = acc.get(b, 0.0) + x * w
        return {b: x / tot for b, x in acc.items()}

    def extract(self, name, select, offset, swatch, layer=0, solid=0.0015, toon=(1.0, 0.0, 1.0, 0.0), hide_margin=None, cuts=()):
        """A garment from the body's own faces where `select(i)` holds, pushed out by `offset(i)` (m)."""
        sel = np.array([bool(select(i)) for i in range(len(self.co))])
        me = self.body.data
        keep = [p for p in me.polygons if all(sel[v] for v in p.vertices)]
        used = sorted({v for p in keep for v in p.vertices})
        remap = {v: k for k, v in enumerate(used)}
        verts = [Vector(self.co[v]) + Vector(self.nrm[v]) * offset(v) * EASE for v in used]
        faces = [[remap[v] for v in p.vertices] for p in keep]
        ob = new_object(name, verts, faces)
        shade_smooth(ob)
        for k, v in enumerate(used):
            for b, x in self.W[v].items():
                g = ob.vertex_groups.get(b) or ob.vertex_groups.new(name=b)
                g.add([k], x, 'REPLACE')
        if cuts:
            # clean hems: straight plane cuts (each limited to the faces of its regions), not the body's face grid
            import bmesh as _bm
            bm = _bm.new()
            bm.from_mesh(ob.data)
            names = sorted({str(self.lab[v]) for v in used})
            code = {n: k for k, n in enumerate(names)}
            lay = bm.verts.layers.int.new('reg')
            for v, src in zip(bm.verts, used):
                v[lay] = code[str(self.lab[src])]
            for cut in cuts:
                co, no, regions = cut[:3]
                pred = cut[3] if len(cut) > 3 else None
                ok = {code[n] for n in names if n.startswith(regions)}
                faces_r = [f for f in bm.faces if any(v[lay] in ok for v in f.verts) and (pred is None or pred(f.calc_center_median()))]
                if not faces_r:
                    continue
                geom = list({e for f in faces_r for e in f.edges}) + faces_r + list({v for f in faces_r for v in f.verts})
                split_only = len(cut) > 4 and cut[4] == 'split'
                _bm.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no, clear_outer=not split_only)
                _bm.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
            # the cuts leave slivers where two planes meet near a face corner: gone, or the solidify's even offset
            # throws a vertex a metre out of them
            _bm.ops.dissolve_degenerate(bm, dist=0.0008, edges=bm.edges[:])
            bm.to_mesh(ob.data)
            bm.free()
        if solid > 0:
            m = ob.modifiers.new('solid', 'SOLIDIFY')
            m.thickness = solid
            m.offset = -1
            m.use_even_offset = not cuts or len(cuts) <= 3
            apply_modifiers(ob)
        uv = self.atlas.swatch(swatch[0], swatch[1])
        self.palette[swatch[0]] = swatch[1]
        set_uv(ob, uv)
        if hide_margin is not None:
            self.cover(sel, hide_margin)
        part = Part(ob, 'cloth', toon=toon, bones='groups', cloth=True, layer=layer, role=swatch[0])
        part.src = used
        part.offset = [offset(v) for v in used]
        self.parts.append(part)
        return ob

    def cover(self, sel, margin):
        """Mark body vertices under a garment, farther than `margin` (geodesic) from its openings, as hidden."""
        me = self.body.data
        n = len(me.vertices)
        adj = [[] for _ in range(n)]
        for e in me.edges:
            a, b = e.vertices
            L = (me.vertices[a].co - me.vertices[b].co).length
            adj[a].append((b, L))
            adj[b].append((a, L))
        import heapq
        dist = np.full(n, 1e9)
        heap = []
        for i in range(n):
            if sel[i] and any(not sel[j] for j, _ in adj[i]):
                dist[i] = 0
                heap.append((0.0, i))
        heapq.heapify(heap)
        while heap:
            d, i = heapq.heappop(heap)
            if d > dist[i] or d > margin * 1.5:
                continue
            for j, L in adj[i]:
                if sel[j] and d + L < dist[j]:
                    dist[j] = d + L
                    heapq.heappush(heap, (d + L, j))
        self.hide |= sel & (dist > margin)

    def region(self, i, *names):
        lab = self.lab[i]
        return any(lab.startswith(n) for n in names)

    def flat_part(self, ob, swatch, toon=(0.8, 0.05, 1.0, 0.0), bones=None, kind='cloth', layer=2):
        uv = self.atlas.swatch(swatch[0], swatch[1])
        self.palette[swatch[0]] = swatch[1]
        set_uv(ob, uv)
        p = Part(ob, kind, toon=toon, bones=bones if bones is not None else 'nearest', cloth=kind == 'cloth', layer=layer, role=swatch[0])
        self.parts.append(p)
        return p

    # --- tops ------------------------------------------------------------------------------------------------------
    def top(self, it, layer=0, outer=False):
        z = self.z
        s = self.s
        sleeves = str(it.get('sleeves', 'short'))
        long_sleeves = 'long' in sleeves
        collar = self.has('collar')
        neck_v = z['chest'] - 0.005 * s if collar else z['neck'] - 0.03 * s
        under = self.has('blouse', 't-shirt', 'shirt', 'sweater')
        inner_short = bool(under) and 'long' not in str(under.get('sleeves', 'short'))
        over = self.has('cardigan', 'jacket', 'coat')
        v_under = bool(over) and ('button' in str(over.get('front', '')) or 'closed' in str(over.get('front', '')))
        front_kind = str(it.get('front', ''))
        buttoned = outer and ('button' in front_kind or 'closed' in front_kind or it.get('open') is False)
        open_front = outer and not buttoned and it.get('open', True)
        # a buttoned cardigan's V: from its first button under the chest up to the neck at the collarbones
        v_bottom = z['chest'] - 0.012 * s
        v_slope = (z['neck'] - v_bottom) / (0.058 * s)
        skirt_bvh = getattr(self, 'skirt_bvh', None) if outer else None
        hem = z['waist'] - 0.05 * s if not outer else z['hip'] + 0.01 * s
        if outer and ('jacket' in it['item'] or 'coat' in it['item']):
            hem = z['hip'] - 0.06 * s   # a work jacket covers the seat
        if self.has('trousers') and not outer:
            hem = z['hip'] - 0.03 * s
        fh = ((self.spec.get('sheet_fit') or {}).get('hems') or {}).get(it['item'])
        if fh is not None and abs(fh - hem) < 0.2 * s:
            hem = fh
        if outer and not long_sleeves:
            sl = 0.55
        else:
            sl = 0.42 if not long_sleeves else 0.93
        base = (0.006 if layer == 0 else 0.013) * s

        def select(i):
            p = self.co[i]
            lab = self.lab[i]
            if lab == 'torso':
                if p[2] < hem - 0.03 * s:
                    return False
                if p[2] > z['neck'] + 0.004 * s:
                    return False
                front = p[1] < 0
                if front:
                    # neckline: a V to the collar's knot, a scoop for a T-shirt
                    # a sailor blouse closes high under its collar (the collar's lapels make the V)
                    lim = z['neck'] - 0.012 * s + 0.5 * abs(p[0]) if collar else z['neck'] - 0.022 * s + 0.6 * abs(p[0])
                    if not outer and not collar and v_under:
                        # a crew neck under a V-necked cardigan: high, so the V shows the shirt up to the collarbones
                        lim = z['neck'] - 0.006 * s + 0.9 * abs(p[0])
                    if buttoned:
                        # kept up to a T-shirt's neckline: the V's two plane cuts trim it (the body's faces are too
                        # coarse at the front for a vertex test to draw a clean V)
                        lim = z['neck'] - 0.01 * s + 0.6 * abs(p[0])
                    if p[2] > lim:
                        return False
                    # an open front: the fronts stand apart down to the hem, the V widening to the neck (kept a
                    # little wide here; two plane cuts a side trim the edge clean)
                    if open_front and abs(p[0]) < 0.012 * s + max(0, (p[2] - z['chest'] + 0.04 * s) * 0.4):
                        return False
                else:
                    if p[2] > z['neck'] - 0.004 * s and abs(p[0]) < 0.05 * s:
                        return False
                return True
            if lab.startswith('thigh'):
                # the hips' sides are nearest the thighs' tops
                return p[2] > hem - 0.03 * s
            if lab.startswith('upperarm'):
                return self.tp[i] < (sl + 0.12 if not long_sleeves else 1.01)
            if lab.startswith('forearm'):
                return long_sleeves and self.tp[i] < sl + 0.1
            return False

        def offset(i):
            p = self.co[i]
            lab = self.lab[i]
            o = base
            if lab.startswith('upperarm') and not long_sleeves:
                o += 0.019 * s * min(1.0, self.tp[i] / sl) ** 1.3
            if lab.startswith(('upperarm', 'forearm')) and long_sleeves:
                o += 0.006 * s
            if outer and lab.startswith('upperarm') and inner_short:
                # over a T-shirt's short sleeve: clear its flared end
                o += 0.022 * s * smoothstep(0.1, 0.45, self.tp[i])
            if lab == 'torso' or lab.startswith('thigh'):
                # looser below the chest, the blouse hanging over the waist
                o += 0.011 * s * smoothstep(z['chest'], z['waist'] - 0.03 * s, p[2])
            if skirt_bvh is not None and p[2] < z['waist'] + 0.06 * s:
                # a cardigan worn over the skirt: its lower part clears the skirt's waist and hips
                n = Vector(self.nrm[i])
                start = Vector(p) + n * 0.0005
                far = None
                for _ in range(4):
                    hit = skirt_bvh.ray_cast(start, n, 0.1)
                    if hit[0] is None:
                        break
                    far = (hit[0] - Vector(p)).length
                    start = hit[0] + n * 0.0005
                if far is not None:
                    # the pleats' outer faces vary around the hips: their outermost, plus the knit's own thickness
                    o = max(o, (far + 0.006 * s) / EASE)
                # where the waist curves in, a ray along the normal can miss the waistband: the nearest point too
                loc, _, _, dn = skirt_bvh.find_nearest(Vector(p), 0.08)
                if loc is not None:
                    o = max(o, (dn + 0.007 * s) / EASE)
            return o

        name = 'outer' if outer else 'top'
        colour = it['rgb']
        cuts = [((0, 0, hem), (0, 0, -1), ('torso', 'thigh'))]
        for side in ('L', 'R'):
            if long_sleeves:
                a, b = self.J[f'Bip01_{side}_Forearm'], self.J[f'Bip01_{side}_Hand']
                reg = f'forearm_{side}'
            else:
                a, b = self.J[f'Bip01_{side}_UpperArm'], self.J[f'Bip01_{side}_Forearm']
                reg = f'upperarm_{side}'
            d = (b - a).normalized()
            cuts.append((tuple(a.lerp(b, sl)), tuple(d), (reg,)))
        if open_front:
            cuts.append(((0, 0, 0), (1, 0, 0), ('torso', 'thigh'), (lambda c: c.y < -0.02 * s), 'split'))
            zc = z['chest'] - 0.04 * s
            for sx in (1, -1):
                # below the chest: nearly straight, 3 cm off the middle at the hem, 4.5 cm at the chest
                a0 = Vector((sx * 0.03 * s, 0, hem))
                a1 = Vector((sx * 0.045 * s, 0, zc))
                d = (a1 - a0).normalized()
                n = Vector((-d.z, 0, d.x)) * sx * -1 if sx > 0 else Vector((d.z, 0, -d.x)) * -1
                if n.x * sx > 0:
                    n = -n
                cuts.append((tuple(a0), tuple(n), ('torso', 'thigh'), (lambda c, sx=sx: c.y < -0.02 * s and c.x * sx > 0 and c.z < zc + 0.01 * s)))
                # above: the lapel's V to the neck
                b1 = Vector((sx * 0.075 * s, 0, z['neck'] - 0.01 * s))
                d = (b1 - a1).normalized()
                n = Vector((-d.z, 0, d.x))
                if n.x * sx > 0:
                    n = -n
                cuts.append((tuple(a1), tuple(n), ('torso',), (lambda c, sx=sx: c.y < -0.02 * s and c.x * sx > 0 and c.z > zc - 0.01 * s)))
        if buttoned:
            # the V's two edges as clean plane cuts on the front, each limited to its own side of a first split down the
            # middle (a cut's cleared vertices would otherwise take the faces across the middle with them)
            cuts.append(((0, 0, 0), (1, 0, 0), ('torso',), (lambda c: c.y < -0.02 * s and c.z > v_bottom - 0.03 * s), 'split'))
            for sx in (1, -1):
                dv = Vector((sx * 0.058 * s, 0, z['neck'] - v_bottom)).normalized()
                nv = Vector((-dv.z * sx, 0, dv.x * sx)) if sx > 0 else Vector((dv.z, 0, -dv.x))
                if nv.z < 0:
                    nv = -nv
                cuts.append(((0, 0, v_bottom), tuple(nv), ('torso',), (lambda c, sx=sx: c.y < -0.02 * s and c.x * sx > 0 and c.z > v_bottom - 0.03 * s)))
        ob = self.extract(name, select, offset, (it['item'].split()[0], colour), layer=layer, hide_margin=None if outer else 0.035 * s, cuts=cuts)
        if outer:
            self.fit_depth(ob, it, hem)
        if self.collar_kind(it) and not self.has('collar') and (outer or not over):
            self.turn_down_collar(it, ob, open_front, hem)
        if outer and ('rib' in str(it.get('cuffs', '')) or 'cardigan' in it['item'] or it.get('hem_band')):
            # knit: a ribbed band at the hem and the cuffs (each face of the band shows three ribs)
            P.paint_rib(self.atlas, f'{name}_rib', colour)
            arms = []
            for side in ('L', 'R'):
                a, b = (self.J[f'Bip01_{side}_Forearm'], self.J[f'Bip01_{side}_Hand']) if long_sleeves else (self.J[f'Bip01_{side}_UpperArm'], self.J[f'Bip01_{side}_Forearm'])
                arms.append((a.lerp(b, sl), (b - a).normalized()))
            rib_band(ob, self.atlas, f'{name}_rib', hem, 0.03 * s, arms, 0.022 * s)
        if buttoned:
            self.buttons(ob, it, v_bottom, hem)
        if outer and it.get('pockets'):
            self.pockets(ob, it, hem)
        return ob

    def buttons(self, ob, it, top_z, hem):
        """Buttons down a closed front: small domed discs on the garment's surface, from the V's bottom to the hem."""
        s = self.s
        bvh = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get())
        col = P.parse_colour(it.get('button_colour', '#efe8da'))
        n = int(it.get('buttons', 5))
        for k in range(n):
            zz = lerp(top_z - 0.004 * s, hem + 0.022 * s, k / max(1, n - 1))
            hit = bvh.ray_cast(Vector((0, -0.5, zz)), Vector((0, 1, 0)), 1.0)
            if hit[0] is None:
                continue
            c = hit[0]
            nrm = hit[1] if hit[1].y < 0 else -hit[1]
            bm = bmesh.new()
            bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=4, radius=1)
            q = nrm.to_track_quat('Z', 'Y')
            for v in bm.verts:
                x, y, zv = v.co
                v.co = c + q @ Vector((x * 0.0052 * s, y * 0.0052 * s, (zv * 0.0016 + 0.0016) * s))
            me = bpy.data.meshes.new(f'button{k}')
            bm.to_mesh(me)
            bm.free()
            b = bpy.data.objects.new(f'button{k}', me)
            bpy.context.scene.collection.objects.link(b)
            shade_smooth(b)
            self.flat_part(b, ('button', col), toon=(0.5, 0.1, 1.0, 0.0), bones='nearest', layer=3)

    def pockets(self, ob, it, hem):
        """Patch pockets on the lower front: plates cast onto the garment and stood off it, the garment's colour."""
        s = self.s
        bvh = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get())
        col = it['rgb']
        for sx in (1, -1):
            cx = sx * 0.058 * s
            w, h = 0.05 * s, 0.05 * s
            z0 = hem + 0.03 * s
            nu, nv = 6, 5
            verts, faces = [], []
            for j in range(nv + 1):
                for i in range(nu + 1):
                    x = cx + (i / nu - 0.5) * w
                    zz = z0 + j / nv * h
                    hit = bvh.ray_cast(Vector((x, -0.5, zz)), Vector((0, 1, 0)), 1.0)
                    p = hit[0] + (hit[1] if hit[1].y < 0 else -hit[1]) * 0.0022 * s if hit[0] is not None else Vector((x, -0.1, zz))
                    verts.append(p)
            for j in range(nv):
                for i in range(nu):
                    a = j * (nu + 1) + i
                    faces.append((a, a + 1, a + nu + 2, a + nu + 1))
            pk = new_object(f'pocket{sx}', verts, faces)
            shade_smooth(pk)
            m = pk.modifiers.new('solid', 'SOLIDIFY')
            m.thickness = 0.0016 * s
            m.offset = -1
            apply_modifiers(pk)
            self.flat_part(pk, ('pocket', tuple(min(1.0, c * 1.04) for c in col)), toon=(0.8, 0.0, 1.0, 0.0), bones='nearest', layer=3)
            self.palette.pop('pocket', None)

    def has(self, *names):
        for o in self.spec['outfit']:
            for n in names:
                if n in o['item']:
                    return o
        return None

    # --- the turn-down collar and lapels -----------------------------------------------------------------------------
    def collar_kind(self, it):
        """A top's collar from the brief (`collar`: 'turn-down' or true, 'none' or false); by default a jacket or coat
        has one, a shirt too, a T-shirt, blouse, sweater or cardigan not."""
        v = it.get('collar')
        if v is None:
            return 'turn-down' if any(k in it['item'] for k in ('jacket', 'coat', 'shirt')) and 't-shirt' not in it['item'] else None
        if v is False or str(v).lower() in ('none', 'no', 'false', 'off'):
            return None
        return 'turn-down'

    def turn_down_collar(self, it, garment, open_front, hem):
        """A shirt or jacket collar: a band standing round the neck (2.4 cm at the back, lower toward the front) that
        folds over and lies down on the garment's shoulders, its ends coming to points at the front; with an open front,
        lapels (the facing folded back along each front edge, widest under the collar's points and running out at the
        chest) lie on the garment's front. Laid on the garment's own surface by casting, so they follow its fitted
        shape; painted as turned cloth (paint_collar: the stand a step darker, a crease at the fold, a topstitched edge)."""
        s = self.s
        z = self.z
        col = it['rgb']
        cell = f'{it["item"].split()[0]}_collar'
        P.paint_collar(self.atlas, cell, col)
        self.palette[cell] = col
        U = (0.02, 0.24, 0.42, 0.7, 0.97)
        uvs = []
        gb = BVHTree.FromObject(garment, bpy.context.evaluated_depsgraph_get())
        nk = self.J['Bip01_Neck']
        cy = nk.y + 0.004 * s
        z_back = z['neck'] - 0.008 * s
        phi_e = math.radians(150 if open_front else 165)
        cols = 36
        verts, faces = [], []
        rows = 5
        for ci in range(cols + 1):
            u = ci / cols
            phi = -phi_e + 2 * phi_e * u
            a = abs(phi) / phi_e
            d = Vector((math.sin(phi), math.cos(phi), 0.0))
            z0 = z_back - 0.03 * s * a ** 2
            o = Vector((0, cy, z0)) + d * 0.3
            hit = self.bvh.ray_cast(o, -d, 0.3)
            r = (0.3 - hit[3]) if hit[0] is not None else 0.06 * s
            r += 0.004 * s
            c0 = Vector((0, cy, z0))
            stand = 0.028 * s * (1 - 0.35 * a ** 2)
            p_base = c0 + d * r
            p_top = c0 + d * (r + 0.004 * s) + Vector((0, 0, stand))
            # the leaf: from the fold out over the shoulders, its points longer at the front ends
            w = 0.042 * s + 0.038 * s * smoothstep(0.6, 1.0, a)
            leaf = []
            for k, t in enumerate((0.35, 0.7, 1.0)):
                q = c0 + d * (r + 0.004 * s + w * t) + Vector((0, 0, stand + 0.02 * s))
                h = gb.ray_cast(q, Vector((0, 0, -1)), 0.2)
                if h[0] is None:
                    h = gb.ray_cast(q + d * 0.05, -d, 0.1)
                p = (h[0] + h[1] * 0.004 * s) if h[0] is not None else q - Vector((0, 0, stand + 0.02 * s))
                # the leaf stands off the stand where it turns over
                p = p.lerp(p_top + d * 0.006 * s, 0.35 * (1 - t))
                leaf.append(p)
            # (a point at the front ends: the outer edge dips further)
            if a > 0.85:
                leaf[-1] = leaf[-1] - Vector((0, 0, 0.025 * s * smoothstep(0.85, 1.0, a)))
            verts += [p_base, p_top] + leaf
            uvs += [self.atlas.uv(cell, uu, 0.5) for uu in U]
        for ci in range(cols):
            for ri in range(rows - 1):
                i0 = ci * rows + ri
                faces.append((i0, i0 + rows, i0 + rows + 1, i0 + 1))
        ob = new_object('collar', verts, faces)
        shade_smooth(ob)
        set_uvs_per_vertex(ob, uvs)
        msol = ob.modifiers.new('solid', 'SOLIDIFY')
        msol.thickness = 0.0025 * s
        msol.offset = 0
        apply_modifiers(ob)
        self.parts.append(Part(ob, 'cloth', toon=(0.9, 0.05, 1.0, 0.0), bones='torso', cloth=True, layer=2, role=cell))
        if not open_front:
            return ob
        # lapels: each front edge's facing folded back, from under the collar's point down to the chest
        zc = z['chest'] - 0.04 * s
        for sx in (1, -1):
            top = Vector((sx * 0.07 * s, 0, z['neck'] - 0.03 * s))
            bot = Vector((sx * 0.045 * s, 0, zc))
            lv, lf, luv = [], [], []
            n_al, n_ac = 10, 4
            for i in range(n_al + 1):
                t = i / n_al
                e = top.lerp(bot, t)
                wv = 0.06 * s * (1 - t) ** 0.85
                for j in range(n_ac + 1):
                    g = e + Vector((sx * wv * j / n_ac, 0, 0.012 * s * (1 - t) * j / n_ac))
                    h = gb.ray_cast(Vector((g.x, -0.5, g.z)), Vector((0, 1, 0)), 0.8)
                    p = (h[0] + Vector((0, -1, 0)) * 0.003 * s) if h[0] is not None else Vector((g.x, -0.12 * s, g.z))
                    lv.append(p)
                    luv.append(self.atlas.uv(cell, 0.3 + 0.67 * j / n_ac, 0.5))
            for i in range(n_al):
                for j in range(n_ac):
                    a0 = i * (n_ac + 1) + j
                    lf.append((a0, a0 + 1, a0 + n_ac + 2, a0 + n_ac + 1))
            lo = new_object('lapel', lv, lf)
            shade_smooth(lo)
            set_uvs_per_vertex(lo, luv)
            msol = lo.modifiers.new('solid', 'SOLIDIFY')
            msol.thickness = 0.002 * s
            msol.offset = -1
            apply_modifiers(lo)
            self.parts.append(Part(lo, 'cloth', toon=(0.9, 0.05, 1.0, 0.0), bones='torso', cloth=True, layer=2, role=cell))
        return ob

    # --- the sailor collar -------------------------------------------------------------------------------------------
    def sailor_collar(self, it, over):
        s = self.s
        z = self.z
        line = it.get('line_rgb', (0.9, 0.9, 0.9))
        P.paint_stripes(self.atlas, 'collar', it['rgb'], line, int(it.get('lines', 2)))
        self.palette['collar'] = it['rgb']
        bvh = self.bvh_torso
        zv = z['chest'] - 0.005 * s
        lift = 0.013 * s * EASE
        nz = z['neck']
        # half-width of the back flap: inside the shoulder line (the trunk's surface turns into the arms past it)
        fw = min(0.112 * s, abs(self.J['Bip01_L_UpperArm'].x) - 0.012 * s)
        zb = nz - 0.15 * s
        hit = bvh.ray_cast(Vector((0, -0.4, zv)), Vector((0, 1, 0)), 0.5)
        F = -hit[0].y if hit[0] is not None else 0.08 * s
        neck_r = 0.064 * s
        # The collar is cut from the trunk's own surface (pushed out over the blouse) with straight plane cuts: the back
        # flap's sides and bottom, the lapels' edges down to the V; the neck opening is a circle around the neck.
        pieces = []
        # back flap and shoulders
        pieces.append([((fw, 0, 0), (1, 0, 0)), ((-fw, 0, 0), (-1, 0, 0)), ((0, 0, zb), (0, 0, -1)), ((0, -0.01 * s, 0), (0, -1, 0))])
        # lapels (her left, her right): between the neckline line and the outer line, in front of the shoulders
        for sx in (1, -1):
            v_in = Vector((0.0, zv))
            n_in = Vector((sx * neck_r * 0.9, nz))
            v_out = Vector((sx * 0.016 * s, zv + 0.003 * s))
            n_out = Vector((sx * (fw - 0.007 * s), nz - 0.03 * s))
            def plane(a, b, keep_side):
                d = (b - a).normalized()
                nrm = Vector((-d.y, d.x))
                if nrm.dot(keep_side - a) > 0:
                    nrm = -nrm
                return ((a.x, 0, a.y), (nrm.x, 0, nrm.y))
            mid = (v_in + n_in + v_out + n_out) / 4
            pieces.append([plane(v_in, n_in, mid), plane(v_out, n_out, mid), ((0, 0.012 * s, 0), (0, 1, 0)), ((0, 0, zv - 0.002 * s), (0, 0, -1)),
                           ((sx * 0.0, 0, 0), (-sx, 0, 0))])
        verts, faces, uvs = [], [], []
        import bmesh as _bm
        for k, cuts in enumerate(pieces):
            bm = _bm.new()
            idx = {}
            for fi in self.torso_polys:
                poly = self.polys[fi]
                for v in poly:
                    if v not in idx:
                        idx[v] = bm.verts.new(Vector(self.co[v]) + Vector(self.nrm[v]) * (lift + (0.003 * s if k == 0 else 0.0015 * s)))
                try:
                    bm.faces.new([idx[v] for v in poly])
                except ValueError:
                    pass
            # the neck opening
            gone = [v for v in bm.verts if math.hypot(v.co.x, v.co.y - 0.02 * s) < neck_r and v.co.z > nz - 0.03 * s]
            _bm.ops.delete(bm, geom=gone, context='VERTS')
            for co, no in cuts:
                geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
                _bm.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no, clear_outer=True)
            _bm.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < zv - 0.01 * s or not v.link_faces], context='VERTS')
            base = len(verts)
            bm.verts.index_update()
            for v in bm.verts:
                verts.append(v.co.copy())
                p = v.co
                if k == 0:
                    edge = min(fw - abs(p.x), p.z - zb) if p.y > 0.02 * s else 1.0
                    r = 1 - min(1.0, max(0.0, edge) / (0.045 * s))
                else:
                    sx = 1 if k == 1 else -1
                    a2 = Vector((sx * 0.016 * s, zv)); b2 = Vector((sx * (fw - 0.007 * s), nz - 0.03 * s))
                    d = (b2 - a2).normalized()
                    q = Vector((p.x, p.z)) - a2
                    edge = abs(q.x * d.y - q.y * d.x)
                    r = 1 - min(1.0, edge / (0.045 * s))
                uvs.append(self.atlas.uv('collar', 0.25 + 0.75 * r, 0.5))
            for f in bm.faces:
                faces.append(tuple(base + v.index for v in f.verts))
            bm.free()
        ob = new_object('collar', verts, faces)
        shade_smooth(ob)
        uvl = ob.data.uv_layers.new(name='UVMap')
        for poly in ob.data.polygons:
            for li in poly.loop_indices:
                uvl.data[li].uv = uvs[ob.data.loops[li].vertex_index]
        m = ob.modifiers.new('solid', 'SOLIDIFY')
        m.thickness = 0.0022 * s
        m.offset = -1
        apply_modifiers(ob)
        self.parts.append(Part(ob, 'cloth', toon=(0.9, 0.05, 1.0, 0.0), bones='torso', cloth=True, layer=2, role='collar'))
        self.collar_v = self.on(bvh, Vector((0, -0.2, zv)), lift + 0.003 * s)
        return ob

    def cast(self, bvh, g, off):
        """Onto the trunk's outer surface: cast from the front, the back and above, keep the hit nearest the guide point."""
        best = None
        for o, d in ((Vector((g.x, -0.4, g.z)), Vector((0, 1, 0))), (Vector((g.x, 0.4, g.z)), Vector((0, -1, 0))), (Vector((g.x, g.y, g.z + 0.4)), Vector((0, 0, -1)))):
            hit = bvh.ray_cast(o, d, 0.8)
            if hit[0] is None:
                continue
            dist = (hit[0] - g).length
            if best is None or dist < best[0]:
                n = hit[1] if hit[1].dot(d) <= 0 else -hit[1]
                best = (dist, hit[0], n)
        if best is not None:
            return best[1] + best[2] * off
        return self.on(bvh, g, off)

    def on(self, bvh, g, off):
        """The point of a garment surface nearest `g`, pushed out by `off` along its normal."""
        loc, n, _, _ = bvh.find_nearest(g)
        if loc is None:
            return g
        return loc + n * off

    def neckerchief(self, it):
        s = self.s
        col = it['rgb']
        uv = self.atlas.swatch('tie', col)
        self.palette['tie'] = col
        c = getattr(self, 'collar_v', Vector((0, -0.12 * s, self.z['chest'])))
        # knot: a flattened rounded box
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=1)
        for v in bm.verts:
            x, y, zz = v.co
            v.co = c + Vector((x * 0.028 * s, y * 0.009 * s - 0.004 * s, zz * 0.02 * s))
        me = bpy.data.meshes.new('knot')
        bm.to_mesh(me)
        bm.free()
        knot = bpy.data.objects.new('knot', me)
        bpy.context.scene.collection.objects.link(knot)
        shade_smooth(knot)
        self.flat_part(knot, ('tie', col), toon=(0.9, 0.05, 1.0, 0.0), bones={'Bip01_Spine2': 1.0}, layer=3)
        # two tails, splayed, pointed, on springs
        for side, sx in (('L', 1), ('R', -1)):
            root = c + Vector((sx * 0.006 * s, -0.004 * s, -0.008 * s))
            pts = [root, root + Vector((sx * 0.016, -0.007, -0.045)) * s, root + Vector((sx * 0.028, -0.007, -0.095)) * s, root + Vector((sx * 0.036, -0.005, -0.135)) * s]
            pts = [self.clear(p, 0.008 * s) for p in pts]
            add_secondary(self.bones, f'Tie_{side}', 'Bip01_Spine2', b2g_point(root + Vector((0, -0.002, -0.01)) * 1.0))
            tipd = b2g_point(pts[-1] - (root + Vector((0, -0.002, -0.01))))
            self.springs.append({'name': f'tie{side}', 'bones': [f'Tie_{side}'], 'tip': tipd, 'stiffness': 0.42, 'drag': 0.26, 'gravity': 0.35, 'radius': 0.012, 'limit': 0.5})
            verts, faces = [], []
            nl = 10
            for i in range(nl + 1):
                t = i / nl
                p = catmull(pts, t)
                # wide tails that open from the knot, with a soft fold down the middle (the ring's front edge pulled in)
                w = (0.034 * s) * (0.45 + 0.75 * math.sin(min(1, t * 1.4) * math.pi * 0.5)) * (1 - smoothstep(0.78, 1.0, t) * 0.95)
                across = Vector((1, 0, 0.35 * sx)).normalized()
                th = 0.0025 * s
                fold = 0.004 * s * math.sin(min(1.0, t * 1.2) * math.pi)
                ring = [p + across * w / 2, p - Vector((0, th - fold * 0.5, 0)) + across * w * 0.12, p - Vector((0, th, 0)) - across * w * 0.15, p - across * w / 2,
                        p + Vector((0, th + fold, 0)) - across * w * 0.1, p + Vector((0, th, 0)) + across * w * 0.18]
                verts += ring
            for i in range(nl):
                for k in range(6):
                    a = i * 6 + k
                    b = i * 6 + (k + 1) % 6
                    faces.append((a, b, b + 6, a + 6))
            faces.append((5, 4, 3, 2, 1, 0))
            ob = new_object(f'tie-{side}', verts, faces)
            shade_smooth(ob)
            wts = []
            for i in range(nl + 1):
                t = i / nl
                wts += [{'Bip01_Spine2': 1 - smoothstep(0.0, 0.3, t), f'Tie_{side}': smoothstep(0.0, 0.3, t)}] * 6
            groups(ob, wts)
            p = self.flat_part(ob, ('tie', col), toon=(0.9, 0.05, 1.0, 0.0), bones='groups', layer=3)

    def clear(self, p, margin):
        """Keep a point out of everything built so far (body and garments)."""
        for bvh in [self.bvh] + ([self.outer_bvh] if self.outer_bvh else []):
            loc, n, _, d = bvh.find_nearest(p)
            if loc is None:
                continue
            if (p - loc).dot(n) < margin:
                p = loc + n * margin
        return p

    # --- skirt -------------------------------------------------------------------------------------------------------
    def fit_depth(self, ob, it, hem):
        """An outer garment's depth from the sheet's side view (build.sheet_fit 'outer'): per height its half-depth
        there (the garment's colour run, smoothed as the skirt's), against ours over the trunk (the sleeves left out);
        where the sheet's is deeper, the trunk part is scaled front to back about its own middle at that height (a
        boxy work jacket hanging off a stooped back and over the belly). Only ever outward, at most 45 %, faded out
        toward the shoulders' sides and the neck, so nothing under it comes through."""
        f = ((self.spec.get('sheet_fit') or {}).get('outer') or {}).get(it['item'])
        if not f or len(f.get('side', [])) < 8:
            return None
        sz, sd = smooth_series(f['side'], lambda r: (r[2] - r[1]) / 2)
        s = self.s
        me = ob.data
        co = np.array([v.co[:] for v in me.vertices])
        arm_x = abs(self.J['Bip01_L_UpperArm'].x)
        trunk = 1 - np.clip((np.abs(co[:, 0]) - 0.6 * arm_x) / (0.25 * arm_x), 0, 1)
        trunk = trunk * trunk * (3 - 2 * trunk)
        top = self.z['neck'] - 0.04 * s
        step = 0.01
        zs = np.arange(hem, top, step)
        ks = np.ones(len(zs))
        mids = np.zeros(len(zs))
        for i, zz in enumerate(zs):
            m = (np.abs(co[:, 2] - zz) < step) & (trunk > 0.9)
            if m.sum() < 6 or zz < sz[0] - 0.01 or zz > sz[-1] + 0.01:
                continue
            y0, y1 = co[m, 1].min(), co[m, 1].max()
            mids[i] = (y0 + y1) / 2
            # the sheet's run is the whole garment seen from the side, a sleeve hanging in front included: the
            # smallest scale of the trunk at which trunk and sleeves together are as deep
            sl = (np.abs(co[:, 2] - zz) < step) & (trunk < 0.1)
            s0, s1 = (co[sl, 1].min(), co[sl, 1].max()) if sl.any() else (mids[i], mids[i])
            want = 2 * float(np.interp(zz, sz, sd))
            for k in np.arange(1.0, 1.451, 0.01):
                h = (y1 - y0) / 2 * k
                if max(s1, mids[i] + h) - min(s0, mids[i] - h) >= want:
                    break
            ks[i] = k
        if (ks <= 1.001).all():
            return None
        # smooth along the height (no steps between rows), and fade the scale out over the top rows
        ks = np.convolve(np.pad(ks, 3, mode='edge'), np.ones(7) / 7, 'valid')
        have = mids != 0
        mids = np.interp(zs, zs[have], mids[have]) if have.any() else mids
        mids = np.convolve(np.pad(mids, 3, mode='edge'), np.ones(7) / 7, 'valid')
        fade = smoothstep_np(top, top - 0.08 * s, zs)
        ks = 1 + (ks - 1) * fade
        k_v = np.interp(co[:, 2], zs, ks, left=ks[0], right=1.0)
        c_v = np.interp(co[:, 2], zs, mids)
        k_v = 1 + (k_v - 1) * trunk
        co[:, 1] = c_v + (co[:, 1] - c_v) * k_v
        me.vertices.foreach_set('co', co.ravel())
        me.update()
        self.depth_fit = {it['item']: {'max_scale': round(float(ks.max()), 3), 'at': round(float(zs[int(np.argmax(ks))]), 3)}}
        print(f'[clothes] depth fit {self.depth_fit}', flush=True)
        return ks

    def skirt_fit(self):
        """The sheet's skirt (build.sheet_fit): its hem and, by height, the half-width of the front and back views and
        the half-depth of the side view, smoothed (a median over 5 cm, then a running mean) and robust to what hangs
        over it (a bag or a hand on one side: the wider side counts)."""
        f = (self.spec.get('sheet_fit') or {}).get('skirt')
        if not f or len(f.get('front', [])) < 8 or len(f.get('side', [])) < 8:
            return None

        def series(rows, fn):
            zs = np.array([r[0] for r in rows])
            vs = np.array([fn(r) for r in rows])
            order = np.argsort(zs)
            zs, vs = zs[order], vs[order]
            med = np.array([np.median(vs[max(0, i - 2):i + 3]) for i in range(len(vs))])
            sm = np.convolve(np.pad(med, 2, mode='edge'), np.ones(5) / 5, 'valid')
            return zs, sm

        fz, fw = series(f['front'], lambda r: max(-r[1], r[2]))
        if f.get('back'):
            bz, bw = series(f['back'], lambda r: max(-r[1], r[2]))
            # front and back views see the same width: the larger where both show it (a bag or arm hides one side)
            fw = np.maximum(fw, np.interp(fz, bz, bw, left=0, right=0))
        sz, sd = series(f['side'], lambda r: (r[2] - r[1]) / 2)

        def interp(zz_, zs_, vs_):
            if zz_ < zs_[0] - 0.01 or zz_ > zs_[-1] + 0.01:
                return None
            return float(np.interp(zz_, zs_, vs_))

        return {'hem': float(f['hem']), 'half_width': lambda zz: interp(zz, fz, fw), 'half_depth': lambda zz: interp(zz, sz, sd)}

    def skirt(self, it):
        s = self.s
        z = self.z
        col = it['rgb']
        P.paint_pleats(self.atlas, 'pleats', col)
        self.palette['skirt'] = col
        N = int(it.get('pleats', 12))
        length = str(it.get('length', 'knee'))
        hem = {'knee': z['knee'] + 0.08 * s, 'mid-calf': lerp(z['knee'], z['ankle'], 0.5), 'long': z['ankle'] + 0.1 * s, 'mini': z['knee'] + 0.15 * s}.get(length, z['knee'] + 0.045 * s)
        fit = self.skirt_fit()
        if fit and abs(fit['hem'] - hem) < 0.16 * s:
            # the sheet's hem (its pleat points are the lowest row it shows; the faces' mean line is a little higher)
            hem = fit['hem'] + 0.008 * s
        top = z['waist'] - 0.012 * s
        hipz = z['hip'] - 0.01 * s
        m = 6 if N <= 16 else 4
        na = N * m
        rows = 20
        cy = 0.02 * s
        # body radius by angle and height (cast inward from outside), the envelope hanging from above
        thetas = [2 * math.pi * k / na for k in range(na)]
        zs = [lerp(top, hem, (r / rows) ** 1.0) for r in range(rows + 1)]
        R = np.zeros((rows + 1, na))
        for r, zz in enumerate(zs):
            for k, th in enumerate(thetas):
                d = Vector((math.sin(th), -math.cos(th), 0))
                o = Vector((0, cy, zz)) + d * 0.5
                hit = self.bvh_trunk.ray_cast(o, -d, 0.5)
                R[r, k] = (0.5 - hit[3]) if hit[0] is not None else 0.0
                if self.outer_bvh is not None:
                    h2 = self.outer_bvh.ray_cast(o, -d, 0.5)
                    if h2[0] is not None:
                        R[r, k] = max(R[r, k], 0.5 - h2[3])
        env = np.maximum.accumulate(R, axis=0)
        # smooth around
        for _ in range(4):
            env = (np.roll(env, 1, 1) + 2 * env + np.roll(env, -1, 1)) / 4
        env_clear = env.copy()
        # an A-line: per azimuth the straight line from the waist that clears the envelope everywhere below (the
        # pleats fall straight from the hips instead of belling out over them)
        tz = np.array([(top - zz) / max(1e-6, top - hem) for zz in zs])
        # (the line only has to clear the hips and thighs: below the knee a long skirt keeps flaring at a third of it)
        tk = min(1.0, (top - (z['knee'] + 0.04 * s)) / max(1e-6, top - hem))
        upto = tz <= tk + 1e-6
        slope = np.max((env[1:][upto[1:]] - env[0][None, :]) / tz[1:][upto[1:], None], axis=0)
        for _ in range(3):
            slope = (np.roll(slope, 1) + 2 * slope + np.roll(slope, -1)) / 4
        tt = np.minimum(tz, tk) + 0.25 * np.maximum(0.0, tz - tk)
        env = np.maximum(env, env[0][None, :] + tt[:, None] * slope[None, :])
        ease = 0.009 * s * EASE
        flare_k = 0.02 if length in ('knee', 'mini') else 0.03
        pleat_depth = 0.017 * s * float(it.get('pleat_depth', 1.0))
        target = None
        if fit:
            # fitted to the sheet: per height the ellipse through its front half-width and side half-depth; the outer
            # faces of the pleats lie on it (the body's clearance still wins where the sheet is narrower)
            target = np.zeros((rows + 1, na))
            have = np.zeros(rows + 1, bool)
            for r, zz in enumerate(zs):
                a_, b_ = fit['half_width'](zz), fit['half_depth'](zz)
                if a_ is None or b_ is None:
                    continue
                have[r] = True
                for k, th in enumerate(thetas):
                    target[r, k] = 1.0 / math.sqrt((math.sin(th) / a_) ** 2 + (math.cos(th) / b_) ** 2)
            # rows the sheet does not show (under a cardigan's hem) blend from the body's envelope
            if have.any():
                first = int(np.argmax(have))
                for r in range(first):
                    target[r] = env_clear[r] + ease + pleat_depth
                    have[r] = True
            else:
                target = None
            flare_k = 0.0
        verts, uvs, wts = [], [], []
        for r, zz in enumerate(zs):
            below = max(0.0, hipz - zz)
            # knife pleats: each pleat's face steps out across its width and folds back under the next one at its edge
            depth = pleat_depth * smoothstep(hipz + 0.03 * s, hipz - 0.1 * s, zz)
            for k in range(na):
                j = k % m
                base = env[r, k] + ease + below * flare_k + 0.006 * s * smoothstep(hipz, hipz - 0.1 * s, zz)
                if target is not None and target[r, k] > 0:
                    base = max(env_clear[r, k] + ease, target[r, k] - depth)
                saw = (j / (m - 1)) * depth   # out from the envelope: the tucked end of a pleat still clears the body
                rr = base + saw
                th = thetas[k]
                verts.append(Vector((math.sin(th) * rr, cy - math.cos(th) * rr, zz)))
                uvs.append(self.atlas.uv('pleats', 0.1 + 0.9 * j / (m - 1), 0.5))
        faces = []
        for r in range(rows):
            for k in range(na):
                a = r * na + k
                b = r * na + (k + 1) % na
                faces.append((a, b, b + na, a + na))
        ob = new_object('skirt', verts, faces)
        shade_smooth(ob)
        # panel springs: PANELS bones on the hip ring, each swinging the hem below it. The cloth below the hips is carried
        # by the panels alone (no share of the thighs: a blend of the two thighs put the middle of the front between the
        # legs, where a knee lifted on a stair came through it); the runtime springs keep every panel out of the thigh and
        # calf capsules of the current pose (foot IK, pelvis drop) along its whole length (`collide`).
        panels = PANELS
        attach = hipz + 0.02 * s
        names = []
        for k in range(panels):
            th = 2 * math.pi * k / panels
            kk = int(round(th / (2 * math.pi) * na)) % na
            at = Vector((math.sin(th) * (env[4, kk] + ease) * 0.9, cy - math.cos(th) * (env[4, kk] + ease) * 0.9, attach))
            nm = f'Skirt_{k}'
            add_secondary(self.bones, nm, 'Bip01_Pelvis', b2g_point(at))
            ri = env[-1, kk] + ease + (hipz - hem) * flare_k
            if target is not None and target[-1, kk] > 0:
                ri = max(env_clear[-1, kk] + ease, target[-1, kk] - pleat_depth / 2)
            tip = Vector((math.sin(th) * ri, cy - math.cos(th) * ri, hem))
            # front and back panels swing far enough to ride over a thigh lifted to the hip line; the sides less
            fb = abs(math.cos(th))
            self.springs.append({'name': f'skirt{k}', 'bones': [nm], 'tip': b2g_point(tip - at), 'stiffness': 0.34, 'drag': 0.24, 'gravity': 0.2,
                                 'radius': 0.024, 'limit': round(0.9 + 0.75 * fb, 3), 'collide': ['Thigh', 'Calf']})
            self.skirt_panels.append((len(self.springs) - 1, at.copy(), tip.copy()))
            names.append(nm)
        for r, zz in enumerate(zs):
            wv = smoothstep(attach + 0.01 * s, attach - 0.07 * s, zz)
            for k in range(na):
                th = thetas[k]
                f = th / (2 * math.pi) * panels
                a = int(math.floor(f)) % panels
                b = (a + 1) % panels
                t = f - math.floor(f)
                t = t * t * (3 - 2 * t)
                top_w = self.weights_at(verts[r * na + k], trunk=True) if wv < 0.999 else {}
                top_w = {bb: x for bb, x in top_w.items() if 'Thigh' not in bb and 'Calf' not in bb} or {'Bip01_Pelvis': 1.0}
                tsum = sum(top_w.values())
                top_w = {bb: x / tsum for bb, x in top_w.items()}
                w = {bb: x * (1 - wv) for bb, x in top_w.items()}
                w[names[a]] = w.get(names[a], 0) + wv * (1 - t)
                w[names[b]] = w.get(names[b], 0) + wv * t
                wts.append(w)
        groups(ob, wts)
        uvl = ob.data.uv_layers.new(name='UVMap')
        fold_uv = self.atlas.uv('pleats', 0.0, 0.5, inset=3.0)
        for fi, poly in enumerate(ob.data.polygons):
            # the fold (the step from one pleat's edge back under the next) is the shadow side: its own dark texels
            fold = fi % na % m == m - 1
            for li in poly.loop_indices:
                uvl.data[li].uv = fold_uv if fold else uvs[ob.data.loops[li].vertex_index]
        msol = ob.modifiers.new('solid', 'SOLIDIFY')
        msol.thickness = 0.0022 * s
        msol.offset = -1
        apply_modifiers(ob)
        self.parts.append(Part(ob, 'cloth', toon=(1.0, 0.0, 0.3, 1.0), bones='groups', cloth=True, layer=1, role='skirt'))
        self.skirt_ob = ob
        # waistband
        band = []
        nb = 64
        for r, zz in enumerate((top + 0.028 * s, top + 0.012 * s, top - 0.006 * s)):
            for k in range(nb):
                th = 2 * math.pi * k / nb
                kk = int(round(th / (2 * math.pi) * na)) % na
                rr = R[0, kk] + 0.011 * s if R[0, kk] > 0 else env[0, kk] + 0.011 * s
                band.append(Vector((math.sin(th) * rr, cy - math.cos(th) * rr, zz)))
        bf = [(r * nb + k, r * nb + (k + 1) % nb, (r + 1) * nb + (k + 1) % nb, (r + 1) * nb + k) for r in range(2) for k in range(nb)]
        bob = new_object('waistband', band, bf)
        shade_smooth(bob)
        msol = bob.modifiers.new('solid', 'SOLIDIFY')
        msol.thickness = 0.003 * s
        msol.offset = -1
        apply_modifiers(bob)
        self.flat_part(bob, ('skirt_band', tuple(c * 0.85 for c in col)), toon=(0.9, 0.0, 1.0, 0.0), bones='torso', layer=2)
        self.skirt_band = bob
        self.palette.pop('skirt_band', None)
        # the body under the skirt's waist is covered
        self.cover(np.array([self.lab[i] == 'torso' and top - 0.02 * s < self.co[i][2] < top + 0.03 * s for i in range(len(self.co))]), 0.0)
        return ob

    # --- legs and feet -----------------------------------------------------------------------------------------------
    def socks(self, it):
        s = self.s
        z = self.z
        h = str(it.get('height', 'mid-calf'))
        top = {'ankle': z['ankle'] + 0.05 * s, 'mid-calf': lerp(z['knee'], z['ankle'], 0.7), 'knee': z['knee'] - 0.03 * s}.get(h, lerp(z['knee'], z['ankle'], 0.7))
        # (no thickness: a sock lies on the skin and its top is the only edge seen; it halves its triangles)
        self.extract('socks', lambda i: self.region(i, 'calf', 'foot') and self.co[i][2] < top,
                     lambda i: 0.0018 * s + 0.0015 * s * smoothstep(top - 0.02 * s, top, self.co[i][2]), ('socks', it['rgb']), layer=0, solid=0.0, toon=(0.8, 0.0, 1.0, 0.0), hide_margin=0.02 * s)

    def trousers(self, it):
        s = self.s
        z = self.z
        top = z['hip'] + 0.08 * s
        bottom = z['ankle'] + 0.03 * s
        boots = self.has('boot')
        if boots:
            bottom = lerp(z['knee'], z['ankle'], 0.45) - 0.03 * s

        def sel(i):
            p = self.co[i]
            if self.region(i, 'thigh', 'calf'):
                return p[2] > bottom
            return self.lab[i] == 'torso' and p[2] < top

        loose = 'tight' not in str(it.get('fit', ''))

        def off(i):
            p = self.co[i]
            o = 0.009 * s
            if self.region(i, 'calf'):
                o += 0.012 * s * smoothstep(z['knee'], bottom, p[2])
            if loose:
                # work trousers hang straight from the seat: more ease down the thigh, most at the knee and shin
                if self.region(i, 'thigh'):
                    o += 0.012 * s * smoothstep(z['hip'], z['knee'], p[2])
                elif self.region(i, 'calf'):
                    o += 0.012 * s + 0.01 * s * smoothstep(z['knee'], bottom, p[2])
            return o
        self.extract('trousers', sel, off, ('trousers', it['rgb']), layer=1, toon=(1.0, 0.0, 1.0, 0.0), hide_margin=0.03 * s)

    def shoes(self, it):
        s = self.s
        kind = 'boots' if 'boot' in it['item'] else 'sneakers' if 'sneaker' in it['item'] else 'loafers'
        col = it['rgb']
        sole_col = it.get('sole_colour')
        from common import colour
        sole = colour(sole_col) if sole_col else (tuple(c * 0.45 for c in col) if kind != 'sneakers' else (0.75, 0.73, 0.7))
        self.palette[kind] = col
        for side in ('L', 'R'):
            ft = self.J[f'Bip01_{side}_Foot']
            toe = self.J[f'Bip01_{side}_Toe0']
            fwd = Vector((toe.x - ft.x, toe.y - ft.y, 0)).normalized()
            right = fwd.cross(Vector((0, 0, 1))).normalized()
            heel = Vector((ft.x, ft.y, 0)) - fwd * 0.04 * s
            tip = Vector((toe.x, toe.y, 0)) + fwd * 0.058 * s
            L = (tip - heel).length
            sole_h = {'loafers': 0.011, 'sneakers': 0.022, 'boots': 0.016}[kind] * s
            ns, nr = 18, 16
            upper, sole_v = [], []
            for i in range(ns + 1):
                t = i / ns
                c = heel.lerp(tip, t)
                w = (0.031 + 0.019 * math.sin(min(1.0, t * 1.25) * math.pi * 0.62)) * s
                w *= 1 - 0.55 * smoothstep(0.82, 1.0, t) ** 1.5
                w = max(w, 0.006 * s)
                hgt = {'loafers': lerp(0.066, 0.046, smoothstep(0.3, 1.0, t)), 'sneakers': lerp(0.078, 0.052, smoothstep(0.35, 1.0, t)),
                       'boots': lerp(0.085, 0.056, smoothstep(0.35, 1.0, t))}[kind] * s
                hgt *= 1 - 0.45 * smoothstep(0.9, 1.0, t)
                if t < 0.06:
                    hgt *= 0.7 + 0.3 * t / 0.06
                ring = []
                for k in range(nr):
                    a = 2 * math.pi * k / nr
                    x = math.cos(a)
                    y = math.sin(a)
                    yy = (y + 1) / 2  # 0 bottom, 1 top
                    sq = 0.7  # squarer bottom
                    px = math.copysign(abs(x) ** sq, x) * w * (1 - 0.18 * yy)
                    pz = sole_h + math.sin(math.asin(max(-1, min(1, y))) * 0.5 + math.pi / 4) ** 2 * (hgt - sole_h) if y > -0.3 else sole_h * (1 + y * 0.2)
                    ring.append(c + right * px + Vector((0, 0, pz)))
                upper.append(ring)
                sring = []
                for k in range(nr):
                    a = 2 * math.pi * k / nr
                    x, y = math.cos(a), math.sin(a)
                    px = math.copysign(abs(x) ** 0.5, x) * (w + 0.0025 * s)
                    pz = sole_h * (0.5 + 0.55 * y)
                    if kind == 'loafers' and t < 0.24 and y < 0:
                        # the heel block
                        pz = sole_h * 0.5 + y * 0.02 * s
                    sring.append(c + right * px + Vector((0, 0, max(0.0, pz))))
                sole_v.append(sring)
            from common import loft
            v, f = loft(upper, cap_start=True, cap_end=True)
            ob = new_object(f'shoe-{side}', v, f)
            subdivide(ob, 1)
            shade_smooth(ob)
            self.flat_part(ob, (kind, col), toon=(1.0, 0.0, 1.0, 0.0), bones='nearest', layer=2)
            # painted upper: u along the shoe (heel 0 .. toe 1), v around it from the sole; a glossy leather's highlight
            # along the top of the vamp, canvas' fine weave and its seams
            P.paint_shoe(self.atlas, f'shoe_{kind}', col, kind)
            self.palette[kind] = col
            map_along(ob, self.atlas, f'shoe_{kind}', heel, fwd, L, sole_h, max(hh for hh in [0.09 * s]))
            v, f = loft(sole_v, cap_start=True, cap_end=True)
            ob = new_object(f'sole-{side}', v, f)
            shade_smooth(ob)
            self.flat_part(ob, (kind + '_sole', sole), toon=(1.0, 0.0, 1.0, 0.0), bones='nearest', layer=2)
            self.palette.pop(kind + '_sole', None)
            if kind == 'sneakers':
                # the sole's foxing stripe (painted), a rubber toe cap, the laces over the vamp and the tongue
                P.paint_stripes(self.atlas, 'sole_stripe', sole, tuple(c * 0.35 for c in sole), lines=1)
                map_height(ob, self.atlas, 'sole_stripe', 0.0, sole_h * 1.05)
                cap_rings = []
                for i in range(int(0.8 * ns), ns + 1):
                    ring = upper[i]
                    c0 = sum(ring, Vector()) / len(ring)
                    cap_rings.append([c0 + (q - c0) * 1.06 for k, q in enumerate(ring) if math.sin(2 * math.pi * k / nr) < 0.15])
                vv, ff = loft(cap_rings, closed=False)
                cap = new_object(f'toecap-{side}', vv, ff)
                cap.modifiers.new('s', 'SOLIDIFY').thickness = 0.0015 * s
                apply_modifiers(cap)
                shade_smooth(cap)
                self.flat_part(cap, (kind + '_sole', sole), toon=(0.9, 0.0, 1.0, 0.0), bones='nearest', layer=3)
                self.palette.pop(kind + '_sole', None)
                lace = P.parse_colour(it.get('lace_colour', '#f4f2ee'))
                top_of = lambda i: max(upper[i], key=lambda q: q.z)
                for j in range(5):
                    t = 0.44 + 0.07 * j
                    i = int(t * ns)
                    ring = upper[i]
                    tp = top_of(i)
                    w = (max(q.dot(right) for q in ring) - min(q.dot(right) for q in ring)) * 0.32
                    for sgn in (1, -1):
                        a_ = tp - right * w * sgn + Vector((0, 0, -0.004 * s))
                        b_ = tp + right * w * sgn + fwd * 0.018 * s + Vector((0, 0, -0.002 * s))
                        self.bar(f'lace-{side}{j}{sgn}', a_, b_, 0.0022 * s, ('lace', lace), 3)
                self.palette.pop('lace', None)
                tg = top_of(int(0.4 * ns))
                tongue = self.bar(f'tongue-{side}', tg + Vector((0, 0, -0.006 * s)), tg - fwd * 0.012 * s + Vector((0, 0, 0.012 * s)), 0.009 * s, (kind, col), 3, flat=0.35)
            if kind == 'loafers':
                # the penny strap across the vamp
                band = []
                for i in range(2):
                    t = 0.5 + 0.05 * i
                    band.append([p + Vector((0, 0, 0.0016 * s)) for p in upper[int(t * ns)][nr // 2 - 5: nr // 2 + 6]])
                vv, ff = loft(band, closed=False)
                ob = new_object(f'strap-{side}', [p + (p - upper[int(0.52 * ns)][nr // 4]).normalized() * 0.0 for p in vv], ff)
                ob.modifiers.new('s', 'SOLIDIFY').thickness = 0.002 * s
                apply_modifiers(ob)
                shade_smooth(ob)
                self.flat_part(ob, ('loafer_strap', tuple(c * 0.7 for c in col)), toon=(0.7, 0.0, 1.0, 0.0), bones='nearest', layer=3)
                self.palette.pop('loafer_strap', None)
            if kind == 'boots':
                pass
        # the feet inside are covered
        top_z = {'loafers': 0.04, 'sneakers': 0.05, 'boots': 0.06}[kind] * s
        self.cover(np.array([self.region(i, 'foot') or (self.region(i, 'calf') and self.co[i][2] < top_z) for i in range(len(self.co))]), 0.008 * s)
        if kind == 'boots':
            topb = lerp(self.z['knee'], self.z['ankle'], 0.45)
            self.extract('boot-shaft', lambda i: self.region(i, 'calf', 'foot') and self.co[i][2] < topb and self.co[i][2] > 0.03 * s,
                         lambda i: 0.022 * s + 0.006 * s * smoothstep(topb - 0.05, topb, self.co[i][2]), ('boots', col), layer=2, solid=0.002, hide_margin=0.02 * s)

    def bar(self, name, a, b, r, swatch, layer, flat=1.0):
        """A small rounded bar from a to b (laces, a tongue, straps)."""
        d = b - a
        L = d.length
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=r, radius2=r, depth=L)
        q = d.normalized().to_track_quat('Z', 'Y')
        for v in bm.verts:
            v.co.x *= 1.0
            v.co.y *= flat
            v.co = (a + b) / 2 + q @ v.co
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        shade_smooth(ob)
        self.flat_part(ob, swatch, toon=(0.6, 0.0, 1.0, 0.0), bones='nearest', layer=layer)
        return ob

    # --- accessories -------------------------------------------------------------------------------------------------
    def watch(self, it):
        s = self.s
        side = 'L' if 'left' in str(it.get('wrist', 'left')) else 'R'
        fa = self.J[f'Bip01_{side}_Forearm']
        hn = self.J[f'Bip01_{side}_Hand']
        axis = (hn - fa).normalized()
        c = fa.lerp(hn, 0.86)
        # forearm radius there
        idx = [i for i in range(len(self.co)) if self.lab[i] == f'forearm_{side}' and abs((Vector(self.co[i]) - c).dot(axis)) < 0.01]
        rads = [((Vector(self.co[i]) - c) - axis * (Vector(self.co[i]) - c).dot(axis)).length for i in idx]
        r = (max(rads) if rads else 0.02) + 0.0025 * s
        P.paint_watch(self.atlas, 'watch', it['rgb'])
        self.palette['watch'] = it['rgb']
        u1 = axis.orthogonal().normalized()
        u2 = axis.cross(u1)
        # the watch face on the back of the wrist: the side away from the palm (the hand frame's z)
        from body import hand_frame
        _, hx, hy, hz, _ = hand_frame(self.J, side)
        back = (hz - axis * hz.dot(axis)).normalized()
        u1 = back
        u2 = axis.cross(u1)
        verts, faces = [], []
        n = 24
        for j, (dz, dr) in enumerate(((-0.009, 0), (-0.009, 0.003), (0.009, 0.003), (0.009, 0))):
            for k in range(n):
                a = 2 * math.pi * k / n
                d = u1 * math.cos(a) + u2 * math.sin(a)
                verts.append(c + axis * dz * s + d * (r + dr * s))
        for j in range(3):
            for k in range(n):
                a = j * n + k
                b = j * n + (k + 1) % n
                faces.append((a, b, b + n, a + n))
        for k in range(n):
            a = 3 * n + k
            b = 3 * n + (k + 1) % n
            faces.append((a, b, (k + 1) % n, k))
        ob = new_object('watch-band', verts, faces)
        shade_smooth(ob)
        self.flat_part(ob, ('watch', it['rgb']), toon=(0.7, 0.0, 1.0, 0.0), bones='nearest', layer=3)
        # face box
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1)
        M = Matrix((axis * 0.02 * s, u2 * 0.019 * s, u1 * 0.007 * s)).transposed()
        for v in bm.verts:
            v.co = c + u1 * (r + 0.003 * s) + M @ v.co
        me = bpy.data.meshes.new('watch-face')
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new('watch-face', me)
        bpy.context.scene.collection.objects.link(ob)
        uvl = ob.data.uv_layers.new(name='UVMap')
        for poly in ob.data.polygons:
            top = poly.normal.dot(Vector((0, 0, 1))) * 0 + (Vector(poly.center) - c).normalized().dot(u1) > 0.7
            for li in poly.loop_indices:
                vco = ob.data.vertices[ob.data.loops[li].vertex_index].co - c
                if top:
                    uvl.data[li].uv = self.atlas.uv('watch', 0.5 + vco.dot(axis) / (0.02 * s), 0.5 + vco.dot(u2) / (0.019 * s))
                else:
                    uvl.data[li].uv = self.atlas.uv('watch', 0.05, 0.5)
        p = Part(ob, 'acc', toon=(0.6, 0.0, 1.0, 0.0), bones='nearest', layer=3, role='watch')
        self.parts.append(p)

    def bag_strap(self, it):
        s = self.s
        z = self.z
        col = it['rgb']
        right = 'right' in str(it.get('from', 'right shoulder'))
        sx = -1 if right else 1
        bvh = self.outer_bvh or self.bvh
        top = Vector((sx * 0.08 * s, 0.0, z['neck'] - 0.01 * s))
        hip = Vector((-sx * 0.15 * s, 0.0, z['hip'] + 0.045 * s))
        guide = []
        n = 36
        for k in range(n + 1):
            f = k / n
            # front diagonal up to the shoulder, over it, the back diagonal down
            if f < 0.45:
                q = hip.lerp(top, f / 0.45)
                q.y = -0.2
            elif f < 0.55:
                q = top.copy()
                q.y = lerp(-0.2, 0.2, (f - 0.45) / 0.1) * 0.15
            else:
                q = top.lerp(hip, (f - 0.55) / 0.45)
                q.y = 0.2
            guide.append(q)
        pts = [self.cast(bvh, g, 0.005 * s) for g in guide]
        for _ in range(3):
            pts[1:-1] = [(pts[i - 1] + 2 * pts[i] + pts[i + 1]) / 4 for i in range(1, len(pts) - 1)]
            # smoothing pulls a strap across the chest's curve into it: back out over the body and every garment
            pts = [self.clear(p, 0.006 * s) for p in pts]
        verts, faces = [], []
        for k, p in enumerate(pts):
            t = (pts[min(n, k + 1)] - pts[max(0, k - 1)]).normalized()
            loc, nrm, _, _ = bvh.find_nearest(p)
            if (p - loc).dot(nrm) < 0:
                nrm = -nrm
            side = t.cross(nrm).normalized()
            for a2, b2 in ((0.0125, 0.0), (0.0125, 0.003), (-0.0125, 0.003), (-0.0125, 0.0)):
                verts.append(p + side * a2 * s + nrm * b2 * s)
        for k in range(n):
            for j in range(4):
                a2 = k * 4 + j
                b2 = k * 4 + (j + 1) % 4
                faces.append((a2, b2, b2 + 4, a2 + 4))
        ob = new_object('bag-strap', verts, faces)
        shade_smooth(ob)
        # the body's own weights under the strap (over the shoulder the clavicle and arm carry it, like the cardigan)
        self.flat_part(ob, ('bag', col), toon=(0.7, 0.0, 1.0, 0.0), bones='nearest', layer=3)
        # the bag at the front of the far hip, outside the skirt: a small rounded flap bag with a buckle
        skirt_bvh = BVHTree.FromObject(self.skirt_ob, bpy.context.evaluated_depsgraph_get()) if getattr(self, 'skirt_ob', None) else bvh
        size = str(it.get('bag', 'small'))
        bw, bd, bh = (0.12, 0.04, 0.095) if 'small' in size else (0.2, 0.06, 0.16)
        az = math.radians(float(it.get('bag_azimuth', 62)))
        out_d = Vector((-sx * math.sin(az), -math.cos(az), 0))
        bz = z['hip'] - 0.015 * s
        hit = skirt_bvh.ray_cast(Vector((0, 0, bz)) + out_d * 0.6, -out_d, 0.8)
        hp = (hit[0] if hit[0] is not None else Vector((0, 0, bz)) + out_d * 0.16 * s) + out_d * (bd / 2 + 0.004) * s
        along = Vector((0, 0, 1)).cross(out_d).normalized()
        up = Vector((0, 0, 1))

        def box(c, w, d, h, bev, name):
            bm = bmesh.new()
            bmesh.ops.create_cube(bm, size=1)
            M = Matrix((along * w * s, out_d * d * s, up * h * s)).transposed()
            for v in bm.verts:
                v.co = c + M @ v.co
            bmesh.ops.bevel(bm, geom=bm.edges[:], offset=min(bev, 0.45 * min(w, d, h)) * s, segments=3, affect='EDGES', clamp_overlap=True)
            me = bpy.data.meshes.new(name)
            bm.to_mesh(me)
            bm.free()
            ob = bpy.data.objects.new(name, me)
            bpy.context.scene.collection.objects.link(ob)
            shade_smooth(ob)
            return ob

        body_b = box(hp, bw, bd, bh, 0.008, 'bag')
        self.flat_part(body_b, ('bag', col), toon=(0.9, 0.0, 1.0, 0.0), bones={'Bip01_Pelvis': 1.0}, layer=3)
        # the flap over the upper two thirds, standing a little proud, rounded at its lower corners
        flap = box(hp + out_d * (bd / 2 + 0.002) * s + up * bh * 0.18 * s, bw * 1.02, 0.006, bh * 0.68, 0.0028, 'bag-flap')
        self.flat_part(flap, ('bag_flap', tuple(c * 0.82 for c in col)), toon=(0.9, 0.0, 1.0, 0.0), bones={'Bip01_Pelvis': 1.0}, layer=3)
        self.palette.pop('bag_flap', None)
        # the buckle's tab and its metal
        tab = box(hp + out_d * (bd / 2 + 0.006) * s - up * bh * 0.12 * s, 0.018, 0.004, 0.026, 0.0015, 'bag-tab')
        self.flat_part(tab, ('bag_flap', tuple(c * 0.82 for c in col)), toon=(0.9, 0.0, 1.0, 0.0), bones={'Bip01_Pelvis': 1.0}, layer=3)
        buckle = box(hp + out_d * (bd / 2 + 0.009) * s - up * bh * 0.08 * s, 0.012, 0.003, 0.009, 0.0012, 'bag-buckle')
        self.flat_part(buckle, ('brass', P.parse_colour('#b89a5a')), toon=(0.5, 0.0, 1.0, 0.0), bones={'Bip01_Pelvis': 1.0}, layer=3)
        self.palette.pop('brass', None)


def map_along(ob, atlas, cell, heel, fwd, L, z0, h):
    """UVs of a shoe's upper on its painted cell: u along the shoe from the heel, v by height over the sole."""
    me = ob.data
    uvl = me.uv_layers.active or me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        for li in poly.loop_indices:
            c = me.vertices[me.loops[li].vertex_index].co
            u = (Vector((c.x, c.y, 0)) - heel).dot(fwd) / L
            v = (c.z - z0) / max(1e-6, h)
            uvl.data[li].uv = atlas.uv(cell, min(1, max(0, u)), min(1, max(0, v)))


def map_height(ob, atlas, cell, z0, h):
    """UVs by height (u across the band from its bottom, the stripes cell's convention)."""
    me = ob.data
    uvl = me.uv_layers.active or me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        for li in poly.loop_indices:
            c = me.vertices[me.loops[li].vertex_index].co
            uvl.data[li].uv = atlas.uv(cell, min(1, max(0, (c.z - z0) / max(1e-6, h))), 0.5)


def rib_band(ob, atlas, cell, hem, band_h, arms, cuff_h):
    """Re-map the faces of a knit garment's hem band (within band_h above the hem) and its cuffs (within cuff_h of
    each sleeve's end: (point, arm direction)) onto a rib cell: per face, u across the band's tangent, v along it."""
    me = ob.data
    uvl = me.uv_layers.active
    co = [v.co for v in me.vertices]
    for poly in me.polygons:
        c = poly.center
        axis = None
        if c.z < hem + band_h:
            axis = Vector((0, 0, 1))
        else:
            for p, d in arms:
                if 0 <= (p - c).dot(d) < cuff_h and (c - p - d * (c - p).dot(d)).length < 0.08:
                    axis = d
                    break
        if axis is None:
            continue
        t = poly.normal.cross(axis)
        if t.length < 1e-6:
            continue
        t.normalize()
        us = [co[me.loops[li].vertex_index].dot(t) for li in poly.loop_indices]
        vs = [co[me.loops[li].vertex_index].dot(axis) for li in poly.loop_indices]
        u0, u1 = min(us), max(us)
        v0, v1 = min(vs), max(vs)
        for li, u, v in zip(poly.loop_indices, us, vs):
            uvl.data[li].uv = atlas.uv(cell, (u - u0) / max(1e-6, u1 - u0), (v - v0) / max(1e-6, v1 - v0))


def smooth_series(rows, fn):
    """A sheet profile's rows [(z, left, right)] as (heights, values of fn(row)), sorted and smoothed (a median over
    5 cm, then a running mean)."""
    zs = np.array([r[0] for r in rows])
    vs = np.array([fn(r) for r in rows])
    order = np.argsort(zs)
    zs, vs = zs[order], vs[order]
    med = np.array([np.median(vs[max(0, i - 2):i + 3]) for i in range(len(vs))])
    return zs, np.convolve(np.pad(med, 2, mode='edge'), np.ones(5) / 5, 'valid')


def smoothstep_np(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def resample(pts, n):
    """n + 1 points evenly along a polyline."""
    L = [0.0]
    for a, b in zip(pts[:-1], pts[1:]):
        L.append(L[-1] + (b - a).length)
    out = []
    for k in range(n + 1):
        t = L[-1] * k / n
        i = max(0, min(len(pts) - 2, next((j for j in range(len(L) - 1) if L[j + 1] >= t), len(pts) - 2)))
        f = (t - L[i]) / max(1e-9, L[i + 1] - L[i])
        out.append(pts[i].lerp(pts[i + 1], f))
    return out


def set_uvs_per_vertex(ob, uvs):
    """A UV per vertex (before a solidify, which copies them to the other side)."""
    uvl = ob.data.uv_layers.new(name='UVMap')
    for poly in ob.data.polygons:
        for li in poly.loop_indices:
            uvl.data[li].uv = uvs[ob.data.loops[li].vertex_index]


def set_uv(ob, uv):
    uvl = ob.data.uv_layers.get('UVMap') or ob.data.uv_layers.new(name='UVMap')
    for l in uvl.data:
        l.uv = uv


def set_uvs(ob, uvs, nr, n):
    """UVs for a solidified grid: the shell's two layers share the grid's UVs (vertex order kept by solidify)."""
    uvl = ob.data.uv_layers.get('UVMap') or ob.data.uv_layers.new(name='UVMap')
    m = len(uvs)
    for poly in ob.data.polygons:
        for li in poly.loop_indices:
            vi = ob.data.loops[li].vertex_index
            uvl.data[li].uv = uvs[vi % m]


def groups(ob, wts):
    for i, w in enumerate(wts):
        for b, x in w.items():
            if x <= 1e-4:
                continue
            g = ob.vertex_groups.get(b) or ob.vertex_groups.new(name=b)
            g.add([i], x, 'REPLACE')


def build_kit(spec, J, body, lab, tp, W, atlas, bones):
    K = Kit(spec, J, body, lab, tp, W, atlas, bones)
    o = spec['outfit']
    top = K.has('blouse', 't-shirt', 'shirt', 'sweater')
    if top:
        K.top(top, layer=0)
    outer = K.has('cardigan', 'jacket', 'coat')
    sk = K.has('skirt')
    over_skirt = bool(outer and sk)
    if outer and not over_skirt:
        K.top(outer, layer=1, outer=True)
    covers = [p.ob for p in K.parts]
    if covers:
        K.outer_bvh = bvh_of(covers)
    if sk:
        K.skirt(sk)
    if over_skirt:
        K.skirt_bvh = bvh_of([K.skirt_ob] + ([K.skirt_band] if getattr(K, 'skirt_band', None) else []))
        K.top(outer, layer=1, outer=True)
        K.outer_bvh = bvh_of([p.ob for p in K.parts if p.ob is not K.skirt_ob])
    tr = K.has('trousers', 'pants', 'jeans')
    if tr:
        K.trousers(tr)
    if K.has('sock'):
        K.socks(K.has('sock'))
    sh = K.has('loafer', 'sneaker', 'boot', 'shoe')
    if sh:
        K.shoes(sh)
    col = K.has('collar')
    if col and top:
        K.sailor_collar(col, [p.ob for p in K.parts if p.ob.name.startswith('top')][0])
    tie = K.has('neckerchief', 'scarf', 'tie')
    if tie:
        K.outer_bvh = bvh_of([p.ob for p in K.parts])
        K.neckerchief(tie)
    w = K.has('watch')
    if w:
        K.watch(w)
    b = K.has('bag')
    if b:
        K.outer_bvh = bvh_of([p.ob for p in K.parts if p.layer <= 1 and 'skirt' not in p.ob.name] or [K.body])
        K.bag_strap(b)
    return K


def bvh_of(obs):
    vs, ps = [], []
    for o in obs:
        b = len(vs)
        vs += [v.co.copy() for v in o.data.vertices]
        ps += [[b + i for i in p.vertices] for p in o.data.polygons]
    return BVHTree.FromPolygons(vs, ps)
