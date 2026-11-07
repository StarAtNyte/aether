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

THIGH_SHARE = 0.97   # how much of the skirt's front and back below the hips follows the thighs
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
            for co, no, regions in cuts:
                ok = {code[n] for n in names if n.startswith(regions)}
                faces_r = [f for f in bm.faces if any(v[lay] in ok for v in f.verts)]
                if not faces_r:
                    continue
                geom = list({e for f in faces_r for e in f.edges}) + faces_r + list({v for f in faces_r for v in f.verts})
                _bm.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no, clear_outer=True)
                _bm.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
            bm.to_mesh(ob.data)
            bm.free()
        if solid > 0:
            m = ob.modifiers.new('solid', 'SOLIDIFY')
            m.thickness = solid
            m.offset = -1
            m.use_even_offset = True
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
        open_front = outer and it.get('open', True)
        hem = z['waist'] - 0.05 * s if not outer else z['hip'] + 0.01 * s
        if self.has('trousers') and not outer:
            hem = z['hip'] - 0.03 * s
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
                    if p[2] > lim:
                        return False
                    if open_front and abs(p[0]) < 0.016 * s + max(0, (p[2] - z['chest']) * 0.5):
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
                o += 0.012 * s * min(1.0, self.tp[i] / sl) ** 1.5
            if lab.startswith(('upperarm', 'forearm')) and long_sleeves:
                o += 0.006 * s
            if lab == 'torso' or lab.startswith('thigh'):
                # looser below the chest, the blouse hanging over the waist
                o += 0.008 * s * smoothstep(z['chest'], z['waist'] - 0.03 * s, p[2])
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
        ob = self.extract(name, select, offset, (it['item'].split()[0], colour), layer=layer, hide_margin=None if outer else 0.035 * s, cuts=cuts)
        return ob

    def has(self, *names):
        for o in self.spec['outfit']:
            for n in names:
                if n in o['item']:
                    return o
        return None

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
        fw = 0.112 * s
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
            n_out = Vector((sx * 0.105 * s, nz - 0.03 * s))
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
                    a2 = Vector((sx * 0.016 * s, zv)); b2 = Vector((sx * 0.105 * s, nz - 0.03 * s))
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
            v.co = c + Vector((x * 0.022 * s, y * 0.006 * s - 0.003 * s, zz * 0.016 * s))
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
            pts = [root, root + Vector((sx * 0.014, -0.006, -0.04)) * s, root + Vector((sx * 0.026, -0.006, -0.085)) * s, root + Vector((sx * 0.034, -0.004, -0.12)) * s]
            pts = [self.clear(p, 0.008 * s) for p in pts]
            add_secondary(self.bones, f'Tie_{side}', 'Bip01_Spine2', b2g_point(root + Vector((0, -0.002, -0.01)) * 1.0))
            tipd = b2g_point(pts[-1] - (root + Vector((0, -0.002, -0.01))))
            self.springs.append({'name': f'tie{side}', 'bones': [f'Tie_{side}'], 'tip': tipd, 'stiffness': 0.42, 'drag': 0.26, 'gravity': 0.35, 'radius': 0.012, 'limit': 0.5})
            verts, faces = [], []
            nl = 10
            for i in range(nl + 1):
                t = i / nl
                p = catmull(pts, t)
                w = (0.024 * s) * (0.5 + 0.7 * math.sin(min(1, t * 1.4) * math.pi * 0.5)) * (1 - smoothstep(0.75, 1.0, t) * 0.95)
                across = Vector((1, 0, 0.35 * sx)).normalized()
                th = 0.0025 * s
                ring = [p + across * w / 2, p - Vector((0, th, 0)), p - across * w / 2, p + Vector((0, th, 0))]
                verts += ring
            for i in range(nl):
                for k in range(4):
                    a = i * 4 + k
                    b = i * 4 + (k + 1) % 4
                    faces.append((a, b, b + 4, a + 4))
            faces.append((3, 2, 1, 0))
            ob = new_object(f'tie-{side}', verts, faces)
            shade_smooth(ob)
            wts = []
            for i in range(nl + 1):
                t = i / nl
                wts += [{'Bip01_Spine2': 1 - smoothstep(0.0, 0.3, t), f'Tie_{side}': smoothstep(0.0, 0.3, t)}] * 4
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
    def skirt(self, it):
        s = self.s
        z = self.z
        col = it['rgb']
        P.paint_pleats(self.atlas, 'pleats', col)
        self.palette['skirt'] = col
        N = int(it.get('pleats', 12))
        length = str(it.get('length', 'knee'))
        hem = {'knee': z['knee'] + 0.06 * s, 'mid-calf': lerp(z['knee'], z['ankle'], 0.5), 'long': z['ankle'] + 0.1 * s, 'mini': z['knee'] + 0.15 * s}.get(length, z['knee'] + 0.045 * s)
        top = z['waist'] - 0.012 * s
        hipz = z['hip'] - 0.01 * s
        m = 6 if N <= 16 else 4
        na = N * m
        rows = 20
        cy = 0.008 * s
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
        ease = 0.009 * s * EASE
        flare_k = 0.09 if length in ('knee', 'mini') else 0.07
        verts, uvs, wts = [], [], []
        for r, zz in enumerate(zs):
            below = max(0.0, hipz - zz)
            # knife pleats: each pleat's face steps out across its width and folds back under the next one at its edge
            depth = 0.017 * s * smoothstep(hipz + 0.03 * s, hipz - 0.1 * s, zz)
            for k in range(na):
                j = k % m
                base = env[r, k] + ease + below * flare_k + 0.012 * s * smoothstep(hipz, hipz - 0.1 * s, zz)
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
        # panel springs: 12 bones on the hip ring, each swinging the hem below it
        panels = 12
        attach = hipz + 0.02 * s
        names = []
        for k in range(panels):
            th = 2 * math.pi * k / panels
            kk = int(round(th / (2 * math.pi) * na)) % na
            at = Vector((math.sin(th) * (env[4, kk] + ease) * 0.9, cy - math.cos(th) * (env[4, kk] + ease) * 0.9, attach))
            nm = f'Skirt_{k}'
            add_secondary(self.bones, nm, 'Bip01_Pelvis', b2g_point(at))
            ri = env[-1, kk] + ease + (hipz - hem) * flare_k
            tip = Vector((math.sin(th) * ri, cy - math.cos(th) * ri, hem))
            # front and back panels swing far enough to ride over a striding thigh; the sides less
            fb = abs(math.cos(th))
            self.springs.append({'name': f'skirt{k}', 'bones': [nm], 'tip': b2g_point(tip - at), 'stiffness': 0.34, 'drag': 0.24, 'gravity': 0.2, 'radius': 0.024, 'limit': round(0.75 + 0.6 * fb, 3)})
            names.append(nm)
        th_x = abs(self.J['Bip01_L_Thigh'].x)
        for r, zz in enumerate(zs):
            wv = smoothstep(attach + 0.01 * s, attach - 0.07 * s, zz)
            # over each thigh the cloth follows the thigh in part (a striding leg carries the front and back of the
            # skirt with it; the panels' springs do the rest)
            deep = smoothstep(attach + 0.035 * s, attach - 0.07 * s, zz)
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
                vx = verts[r * na + k].x
                psi = THIGH_SHARE * deep * (0.6 + 0.4 * abs(math.cos(th)))
                w[names[a]] = w.get(names[a], 0) + wv * (1 - t) * (1 - psi)
                w[names[b]] = w.get(names[b], 0) + wv * t * (1 - psi)
                if psi > 0.01:
                    # crossfaded between the thighs: the middle of the front and back hangs between the legs
                    lt = smoothstep(-0.35 * th_x, 0.35 * th_x, vx)
                    for tb, x in (('Bip01_L_Thigh', lt), ('Bip01_R_Thigh', 1 - lt)):
                        if x > 0.01:
                            w[tb] = w.get(tb, 0) + wv * psi * x
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
        self.parts.append(Part(ob, 'cloth', toon=(1.0, 0.0, 0.3, 0.0), bones='groups', cloth=True, layer=1, role='skirt'))
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
        self.palette.pop('skirt_band', None)
        # the body under the skirt's waist is covered
        self.cover(np.array([self.lab[i] == 'torso' and top - 0.02 * s < self.co[i][2] < top + 0.03 * s for i in range(len(self.co))]), 0.0)
        return ob

    # --- legs and feet -----------------------------------------------------------------------------------------------
    def socks(self, it):
        s = self.s
        z = self.z
        h = str(it.get('height', 'mid-calf'))
        top = {'ankle': z['ankle'] + 0.05 * s, 'mid-calf': lerp(z['knee'], z['ankle'], 0.64), 'knee': z['knee'] - 0.03 * s}.get(h, lerp(z['knee'], z['ankle'], 0.64))
        self.extract('socks', lambda i: self.region(i, 'calf', 'foot') and self.co[i][2] < top,
                     lambda i: 0.0018 * s + 0.0015 * s * smoothstep(top - 0.02 * s, top, self.co[i][2]), ('socks', it['rgb']), layer=0, solid=0.0012, toon=(0.8, 0.0, 1.0, 0.0), hide_margin=0.02 * s)

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

        def off(i):
            p = self.co[i]
            o = 0.009 * s
            if self.region(i, 'calf'):
                o += 0.012 * s * smoothstep(z['knee'], bottom, p[2])
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
            v, f = loft(sole_v, cap_start=True, cap_end=True)
            ob = new_object(f'sole-{side}', v, f)
            shade_smooth(ob)
            self.flat_part(ob, (kind + '_sole', sole), toon=(1.0, 0.0, 1.0, 0.0), bones='nearest', layer=2)
            self.palette.pop(kind + '_sole', None)
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
        hip = Vector((-sx * 0.15 * s, 0.0, z['hip'] + 0.03 * s))
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
        self.flat_part(ob, ('bag', col), toon=(0.7, 0.0, 1.0, 0.0), bones='torso', layer=3)
        # the bag at the hip, outside the skirt
        skirt_bvh = BVHTree.FromObject(self.skirt_ob, bpy.context.evaluated_depsgraph_get()) if getattr(self, 'skirt_ob', None) else bvh
        hp = self.on(skirt_bvh, hip + Vector((-sx * 0.05 * s, 0, -0.05 * s)), 0.02 * s)
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1)
        outward = Vector((hp.x, hp.y - 0.0, 0)).normalized()
        along = Vector((0, 0, 1)).cross(outward).normalized()
        M = Matrix((along * 0.15 * s, outward * 0.045 * s, Vector((0, 0, 1)) * 0.11 * s)).transposed()
        for v in bm.verts:
            v.co = hp + M @ v.co
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=0.008 * s, segments=2, affect='EDGES')
        me = bpy.data.meshes.new('bag')
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new('bag', me)
        bpy.context.scene.collection.objects.link(ob)
        shade_smooth(ob)
        self.flat_part(ob, ('bag', col), toon=(0.9, 0.0, 1.0, 0.0), bones={'Bip01_Pelvis': 1.0}, layer=3)


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
    if outer:
        ob = K.top(outer, layer=1, outer=True)
    covers = [p.ob for p in K.parts]
    if covers:
        K.outer_bvh = bvh_of(covers)
    sk = K.has('skirt')
    if sk:
        K.skirt(sk)
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
