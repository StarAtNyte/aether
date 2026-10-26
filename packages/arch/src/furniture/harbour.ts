/**
 * The parts that make a waterfront read as one and that the photographed library does not have in a realistic look:
 * quay bollards, cleats and mooring piles, boats of varied size (rowboat, dinghy, fishing boat, sailboat, motor launch), lobster
 * pots and gulls. One mesh per material, a few hundred to a few thousand triangles each, so a quay of them instances as a
 * handful of draw calls (`shape_land` along, row, grid).
 *
 * Boats float: the origin is the waterline (y = 0), the bow faces +Z, the keel hangs below.
 */
import { Geom, box, cylinder, lathe, roundedBox, sphere } from '../mesh';
import { PartSet } from '../parts';
import type { P2 } from '../math2';
import { choice, color, num, seeded, type FurnitureDef } from './kit';

const paint = (c: string, roughness = 0.6) => ({ finish: 'paint' as const, color: c, roughness });

/**
 * A smooth surface through a grid of points (rows along the boat, columns across a section). Normals are averaged at the
 * vertices; `outward` is the way the surface should face, tested at the middle row of the grid and flipped if needed.
 */
function skin(grid: ReadonlyArray<ReadonlyArray<readonly [number, number, number]>>, faceOut: boolean): Geom {
  const g = new Geom();
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const nrm = new Float32Array(rows * cols * 3);
  const at = (i: number, j: number): readonly [number, number, number] => (grid[Math.min(rows - 1, Math.max(0, i))] as ReadonlyArray<readonly [number, number, number]>)[Math.min(cols - 1, Math.max(0, j))] as readonly [number, number, number];
  let outward = 0;
  for (let i = 0; i < rows; i++) {
    const row = grid[i] as ReadonlyArray<readonly [number, number, number]>;
    const yc = row.reduce((a, q) => a + q[1], 0) / row.length;
    for (let j = 0; j < cols; j++) {
      const a = at(i + 1, j);
      const b = at(i - 1, j);
      const c = at(i, j + 1);
      const d = at(i, j - 1);
      const du = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
      const dv = [c[0] - d[0], c[1] - d[1], c[2] - d[2]];
      let nx = (du[1] as number) * (dv[2] as number) - (du[2] as number) * (dv[1] as number);
      let ny = (du[2] as number) * (dv[0] as number) - (du[0] as number) * (dv[2] as number);
      let nz = (du[0] as number) * (dv[1] as number) - (du[1] as number) * (dv[0] as number);
      const len = Math.hypot(nx, ny, nz);
      const q = at(i, j);
      if (len > 1e-9) {
        nx /= len;
        ny /= len;
        nz /= len;
      } else {
        // A pinched point (the stem of the bow): point it away from the middle of the section.
        const o = Math.hypot(q[0], q[1] - yc) || 1;
        nx = q[0] / o;
        ny = (q[1] - yc) / o;
        nz = 0;
      }
      nrm.set([nx, ny, nz], (i * cols + j) * 3);
      outward += nx * q[0] + ny * (q[1] - yc);
    }
  }
  // cross(d/di, d/dj) points out of the section or into it depending on how the grid runs: orient it as asked.
  const sign = (outward >= 0 ? 1 : -1) * (faceOut ? 1 : -1);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const p = at(i, j);
      g.vertex(p[0], p[1], p[2], (nrm[(i * cols + j) * 3] as number) * sign, (nrm[(i * cols + j) * 3 + 1] as number) * sign, (nrm[(i * cols + j) * 3 + 2] as number) * sign, j / (cols - 1), i / (rows - 1));
    }
  }
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      // (a, c, b) and (b, c, d) face along cross(d/di, d/dj).
      if (sign > 0) g.tri(a, c, b).tri(b, c, d);
      else g.tri(a, b, c).tri(b, d, c);
    }
  }
  return g;
}

interface Hull {
  L: number;
  B: number;
  /** Depth of the keel below the waterline and height of the gunwale above it. */
  draft: number;
  free: number;
  /** Sharpness of the bow (1 blunt .. 3 sharp). */
  bow: number;
}

/** Half beam at fraction t along the boat (0 stern, 1 bow). */
function halfBeam(h: Hull, t: number): number {
  const stern = t < 0.22 ? 0.66 + 0.34 * (t / 0.22) ** 0.7 : 1;
  const run = t < 0.22 ? 1 : Math.max(0, 1 - ((t - 0.22) / 0.78) ** h.bow);
  return (h.B / 2) * stern * Math.max(0.03, run) ** 0.62;
}

/** A hull shell: sections from the port gunwale round the keel to the starboard gunwale, stern to bow. */
function hullGrid(h: Hull, inset: number): Array<Array<[number, number, number]>> {
  const rows = 22;
  const cols = 15;
  const out: Array<Array<[number, number, number]>> = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const w = Math.max(0.01, halfBeam(h, t) - inset);
    const z = -h.L / 2 + t * h.L;
    const lift = Math.max(0, (t - 0.55) / 0.45) ** 2.4;
    const keel = -h.draft * (1 - 0.92 * lift) + inset;
    const sheer = h.free * (1 + 0.28 * t ** 3 + 0.12 * (1 - t) ** 3) - inset * 0.2;
    const row: Array<[number, number, number]> = [];
    for (let j = 0; j < cols; j++) {
      const u = (j / (cols - 1)) * 2 - 1;
      const s = Math.abs(u);
      row.push([Math.sign(u) * w * (0.2 + 0.8 * s ** 0.72), keel + (sheer - keel) * s ** 1.35, z]);
    }
    out.push(row);
  }
  return out;
}

function hullSolid(h: Hull, open: boolean): Geom {
  const g = new Geom();
  g.merge(skin(hullGrid(h, 0), true));
  if (open) {
    g.merge(skin(hullGrid(h, 0.035), false));
    // The gunwale: a strip joining the outer and inner skins along each rail.
    const outer = hullGrid(h, 0);
    const inner = hullGrid(h, 0.035);
    const last = (outer[0] as Array<[number, number, number]>).length - 1;
    for (const j of [0, last]) {
      const strip: Array<Array<[number, number, number]>> = [];
      for (let i = 0; i < outer.length; i++) strip.push([(outer[i] as Array<[number, number, number]>)[j] as [number, number, number], (inner[i] as Array<[number, number, number]>)[j] as [number, number, number]]);
      g.merge(skin(strip.map((r) => [r[0] as [number, number, number], r[1] as [number, number, number], r[1] as [number, number, number]]), true));
      g.merge(skin(strip.map((r) => [r[0] as [number, number, number], r[1] as [number, number, number], r[1] as [number, number, number]]), false));
    }
  }
  return g;
}

const BOATS: Record<string, { L: number; B: number; draft: number; free: number; bow: number }> = {
  rowboat: { L: 4.2, B: 1.4, draft: 0.2, free: 0.34, bow: 1.7 },
  dinghy: { L: 3.0, B: 1.4, draft: 0.17, free: 0.32, bow: 1.5 },
  fishing: { L: 9, B: 3, draft: 0.9, free: 0.95, bow: 2.0 },
  sailboat: { L: 7.5, B: 2.5, draft: 1.3, free: 0.65, bow: 2.2 },
  motorboat: { L: 6.2, B: 2.2, draft: 0.45, free: 0.75, bow: 2.4 },
};

export const BOAT: FurnitureDef = {
  id: 'furn-boat',
  kind: 'boat',
  aliases: ['boat', 'rowboat', 'row boat', 'dinghy', 'skiff', 'fishing boat', 'fishing vessel', 'trawler', 'sailboat', 'sailing boat', 'yacht', 'motorboat', 'motor launch', 'launch', 'speedboat', 'moored boat', 'small boat', 'harbour boat', 'harbor boat'],
  description:
    'A boat that floats at the waterline (origin y = 0 is the water level, bow towards +Z): `variant` rowboat (4 m, thwarts and oars), dinghy (3 m, outboard), fishing (9 m, wheelhouse, mast, rails), sailboat (7.5 m, mast, boom and sail), motorboat (6 m, windscreen and cabin). `length` rescales the whole boat so a harbour has boats of varied size; `hull` and `trim` set the paint. Place with shape_land {op:"along"} down a quay (spacing = boat length + 2 m, facing out) with `variants` of different params, or one by one at water level.',
  params: {
    variant: choice(['rowboat', 'dinghy', 'fishing', 'sailboat', 'motorboat'], 'rowboat', 'kind of boat'),
    length: num(0, 0, 30, 'overall length in metres; 0 = the variant\'s own'),
    hull: color('#2f5d7c', 'hull colour'),
    trim: color('#e8e4d8', 'gunwale, cabin and sail colour'),
  },
  mount: 'floor',
  againstWall: false,
  frontClearance: 0.5,
  size: (p) => {
    const b = BOATS[p.str('variant')] ?? (BOATS['rowboat'] as (typeof BOATS)[string]);
    const k = p.num('length') > 0 ? p.num('length') / b.L : 1;
    const mast = p.str('variant') === 'sailboat' ? 8.5 : p.str('variant') === 'fishing' ? 5.5 : 0;
    return [b.B * k, Math.max(b.free * k * 1.4 + 2 * k, mast * k) + b.draft * k, b.L * k];
  },
  build(p, seed) {
    const set = new PartSet();
    const v = BOATS[p.str('variant')] ? p.str('variant') : 'rowboat';
    const base = BOATS[v] as (typeof BOATS)[string];
    const k = p.num('length') > 0 ? p.num('length') / base.L : 1;
    const h: Hull = { L: base.L * k, B: base.B * k, draft: base.draft * k, free: base.free * k, bow: base.bow };
    const rnd = seeded(seed * 9301 + 49297);
    const hullMat = paint(p.color('hull'), 0.45);
    const trimMat = paint(p.color('trim'), 0.55);
    const wood = { finish: 'oak' as const, color: '#9a7448' };
    const open = v === 'rowboat' || v === 'dinghy' || v === 'sailboat' || v === 'fishing' || v === 'motorboat';
    set.add(hullSolid(h, open), hullMat);
    // A boot stripe above the water in the trim colour.
    const deck = new Geom();
    const wood2 = new Geom();
    const cabin = new Geom();
    const spars = new Geom();
    const sail = new Geom();
    const L = h.L;
    const hb = (t: number): number => halfBeam(h, t);
    const zAt = (t: number): number => -L / 2 + t * L;
    // Floor boards inside.
    const floorY = -h.draft * 0.35;
    wood2.merge(box(-hb(0.5) * 0.7, floorY - 0.02, zAt(0.1), hb(0.5) * 0.7, floorY, zAt(0.82)));
    // Thwarts across.
    const thwarts = v === 'dinghy' ? 2 : v === 'rowboat' ? 3 : v === 'sailboat' ? 2 : 2;
    for (let i = 0; i < thwarts; i++) {
      const t = 0.3 + (0.45 * (i + 0.5)) / thwarts;
      const w = hb(t) * 0.88;
      wood2.merge(box(-w, h.free * 0.2, zAt(t) - 0.12 * k, w, h.free * 0.2 + 0.035 * k, zAt(t) + 0.12 * k));
    }
    if (v === 'rowboat') {
      // Oars lying along the thwarts, blades at the stern.
      for (const side of [-1, 1] as const) {
        const x0 = side * hb(0.5) * 0.45;
        spars.merge(cylinder(0.018, 0.018, 2.2 * k, 6).rotateX(90).translate(x0, h.free * 0.42, zAt(0.15) + 0.0));
        spars.merge(box(x0 - 0.05, h.free * 0.42 - 0.012, zAt(0.0) + 0.05, x0 + 0.05, h.free * 0.42 + 0.012, zAt(0.0) + 0.5 * k));
      }
    }
    if (v === 'dinghy') {
      // Outboard on the transom.
      const m = new Geom();
      m.merge(box(-0.12, -0.35, zAt(0) - 0.32, 0.12, 0.35, zAt(0) - 0.06));
      m.merge(cylinder(0.025, 0.025, 0.5, 6).translate(0, -0.55, zAt(0) - 0.2));
      set.add(m, { finish: 'black-metal' as const });
    }
    if (v === 'fishing') {
      // Wheelhouse forward of amidships, a low cabin roof, a mast with a boom and a rail.
      const w = hb(0.55) * 0.78;
      cabin.merge(roundedBox(w * 2, 1.35 * k, 2.1 * k, 0.04, 1).translate(0, h.free + 0.68 * k, zAt(0.55)));
      deck.merge(box(-w - 0.08, h.free + 1.35 * k, zAt(0.55) - 1.2 * k, w + 0.08, h.free + 1.42 * k, zAt(0.55) + 1.2 * k));
      cabin.merge(box(-w * 0.9, h.free + 0.75 * k, zAt(0.55) + 1.04 * k, w * 0.9, h.free + 1.15 * k, zAt(0.55) + 1.07 * k));
      spars.merge(cylinder(0.05 * k, 0.04 * k, 4.4 * k, 8).translate(0, h.free, zAt(0.42)));
      spars.merge(cylinder(0.03 * k, 0.03 * k, 3.2 * k, 6).rotateX(90).translate(0, h.free + 2.6 * k, zAt(0.42) - 1.4 * k));
      for (const side of [-1, 1] as const) for (let i = 0; i < 6; i++) spars.merge(cylinder(0.015, 0.015, 0.5 * k, 5).translate(side * hb(0.1 + i * 0.07) * 0.97, h.free, zAt(0.1 + i * 0.07)));
    }
    if (v === 'sailboat') {
      const mastH = 8.2 * k;
      spars.merge(cylinder(0.05 * k, 0.035 * k, mastH, 8).translate(0, h.free * 0.7, zAt(0.5)));
      spars.merge(cylinder(0.03 * k, 0.03 * k, 3.2 * k, 6).rotateX(90).translate(0, h.free + 0.9 * k, zAt(0.5) - 1.6 * k));
      // A mainsail and a jib: slightly bellied triangles, drawn from both sides.
      const tri = (a: [number, number, number], b: [number, number, number], c: [number, number, number], belly: number): void => {
        const mid: [number, number, number] = [(a[0] + b[0] + c[0]) / 3 + belly, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
        const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const cx = (ab[1] as number) * (ac[2] as number) - (ab[2] as number) * (ac[1] as number);
        const cy = (ab[2] as number) * (ac[0] as number) - (ab[0] as number) * (ac[2] as number);
        const cz = (ab[0] as number) * (ac[1] as number) - (ab[1] as number) * (ac[0] as number);
        const cl = Math.hypot(cx, cy, cz) || 1;
        for (const flip of [false, true]) {
          const f = flip ? -1 : 1;
          const [nx, ny, nz] = [(f * cx) / cl, (f * cy) / cl, (f * cz) / cl];
          const i0 = sail.vertex(a[0], a[1], a[2], nx, ny, nz, 0, 0);
          const i1 = sail.vertex(b[0], b[1], b[2], nx, ny, nz, 1, 0);
          const i2 = sail.vertex(mid[0], mid[1], mid[2], nx, ny, nz, 0.5, 0.5);
          const i3 = sail.vertex(c[0], c[1], c[2], nx, ny, nz, 0, 1);
          if (flip) sail.tri(i0, i2, i1).tri(i1, i2, i3).tri(i3, i2, i0);
          else sail.tri(i0, i1, i2).tri(i1, i3, i2).tri(i3, i0, i2);
        }
      };
      const zm = zAt(0.5);
      tri([0.04, h.free + 1.0 * k, zm - 0.1], [0.04, h.free + mastH * 0.92, zm - 0.1], [0.04, h.free + 1.0 * k, zm - 3.0 * k], 0.25 * k);
      tri([0.04, h.free + 0.6 * k, zm + 0.2], [0.04, h.free + mastH * 0.8, zm + 0.1], [0.04, h.free + 0.7 * k, zAt(0.95)], 0.2 * k);
      cabin.merge(roundedBox(hb(0.35) * 1.3, 0.45 * k, 1.6 * k, 0.03, 1).translate(0, h.free + 0.2 * k, zAt(0.28)));
    }
    if (v === 'motorboat') {
      const w = hb(0.5) * 0.8;
      cabin.merge(roundedBox(w * 2, 0.6 * k, 1.8 * k, 0.05, 1).translate(0, h.free + 0.25 * k, zAt(0.45)));
      // Windscreen: a raked glass panel.
      const glass = new Geom();
      glass.merge(box(-w * 0.9, h.free + 0.5 * k, zAt(0.45) + 0.9 * k, w * 0.9, h.free + 1.0 * k, zAt(0.45) + 0.94 * k).rotateX(-18));
      set.add(glass, { finish: 'glass' as const, color: '#cfe3ea', opacity: 0.35, roughness: 0.05 });
      deck.merge(box(-w * 0.95, h.free + 0.5 * k, zAt(0.45) - 0.9 * k, w * 0.95, h.free + 0.55 * k, zAt(0.45) + 0.9 * k));
    }
    // A rub rail round the gunwale in the trim colour.
    const rail = new Geom();
    for (const side of [-1, 1] as const) {
      for (let i = 0; i < 12; i++) {
        const t0 = i / 12;
        const t1 = (i + 1) / 12;
        const sh = (t: number): number => h.free * (1 + 0.28 * t ** 3 + 0.12 * (1 - t) ** 3);
        const a: [number, number, number] = [side * hb(t0), sh(t0), zAt(t0)];
        const b: [number, number, number] = [side * hb(t1), sh(t1), zAt(t1)];
        const dz = b[2] - a[2];
        const dx = b[0] - a[0];
        const len = Math.hypot(dx, dz);
        rail.merge(box(-0.03 * k - 0.01, -0.02 * k, -len / 2, 0.03 * k + 0.01, 0.025 * k, len / 2).rotateY((Math.atan2(dx, dz) * 180) / Math.PI).translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2));
      }
    }
    set.add(rail, trimMat);
    if (wood2.vertexCount > 0) set.add(wood2, wood);
    if (deck.vertexCount > 0) set.add(deck, trimMat);
    if (cabin.vertexCount > 0) set.add(cabin, v === 'fishing' ? paint('#d9d4c4', 0.5) : trimMat);
    if (spars.vertexCount > 0) set.add(spars, v === 'sailboat' ? { finish: 'brushed-metal' as const } : wood);
    if (sail.vertexCount > 0) set.add(sail, { finish: 'fabric' as const, color: '#f1ede2' });
    void rnd;
    const top = v === 'sailboat' ? 8.6 * k : v === 'fishing' ? 5.6 * k : h.free + 1.2 * k;
    set.boxMinMax(-h.B / 2, -h.draft, -h.L / 2, h.B / 2, top, h.L / 2);
    return set.build();
  },
};

export const BOLLARD: FurnitureDef = {
  id: 'furn-bollard',
  kind: 'bollard',
  aliases: ['bollard', 'mooring bollard', 'quay bollard', 'dock bollard', 'cleat', 'mooring cleat', 'dock cleat', 'mooring post', 'mooring pile', 'pile', 'piling', 'timber pile', 'quayside bollard', 'iron bollard'],
  description:
    'Quay furniture: `variant` bollard (cast-iron mooring bollard with a flared base and a rope groove, 0.5 m), cleat (a two-horned dock cleat on a timber base), pile (a tall timber mooring pile with iron bands). Origin on the ground, y up. shape_land {op:"along"} down the quay edge every 8 to 12 m (bollards), 4 to 6 m (cleats) or 2 to 3 m (piles).',
  params: {
    variant: choice(['bollard', 'cleat', 'pile'], 'bollard', 'kind of mooring fitting'),
    height: num(0, 0, 4, 'height in metres; 0 = the variant\'s own'),
    iron: color('#2b2d2e', 'iron colour'),
  },
  mount: 'floor',
  againstWall: false,
  frontClearance: 0.3,
  size: (p) => {
    const v = p.str('variant');
    const H = p.num('height') > 0 ? p.num('height') : v === 'pile' ? 2.4 : v === 'cleat' ? 0.16 : 0.5;
    return v === 'cleat' ? [0.4, H, 0.14] : v === 'pile' ? [0.34, H, 0.34] : [0.36, H, 0.36];
  },
  build(p) {
    const set = new PartSet();
    const v = p.str('variant');
    const iron = { finish: 'black-metal' as const, color: p.color('iron'), roughness: 0.55 };
    const rope = { finish: 'fabric' as const, color: '#b8a77c' };
    if (v === 'cleat') {
      const H = p.num('height') > 0 ? p.num('height') : 0.16;
      const s = H / 0.16;
      set.add(box(-0.22 * s, 0, -0.08 * s, 0.22 * s, 0.04 * s, 0.08 * s), { finish: 'oak' as const, color: '#6d5a40' });
      const c = new Geom();
      c.merge(box(-0.16 * s, 0.04 * s, -0.025 * s, 0.16 * s, 0.085 * s, 0.025 * s));
      c.merge(cylinder(0.025 * s, 0.03 * s, 0.05 * s, 8).translate(0, 0.04 * s, 0));
      for (const side of [-1, 1] as const) c.merge(roundedBox(0.1 * s, 0.05 * s, 0.045 * s, 0.015 * s, 1).translate(side * 0.14 * s, 0.1 * s, 0));
      set.add(c, iron);
      set.boxMinMax(-0.22 * s, 0, -0.08 * s, 0.22 * s, H, 0.08 * s);
    } else if (v === 'pile') {
      const H = p.num('height') > 0 ? p.num('height') : 2.4;
      const t = new Geom();
      t.merge(cylinder(0.15, 0.13, H, 12));
      t.merge(cylinder(0.13, 0.12, 0.05, 12).translate(0, H, 0));
      set.add(t, { finish: 'bark' as const, color: '#5b4a38' });
      const bands = new Geom();
      for (const y of [H * 0.55, H * 0.86]) bands.merge(cylinder(0.158, 0.158, 0.06, 12).translate(0, y, 0));
      set.add(bands, iron);
      set.add(cylinder(0.16, 0.16, 0.09, 12).translate(0, H * 0.7, 0), rope);
      set.boxMinMax(-0.16, 0, -0.16, 0.16, H, 0.16);
    } else {
      const H = p.num('height') > 0 ? p.num('height') : 0.5;
      const s = H / 0.5;
      const prof: P2[] = ([[0.001, 0], [0.17, 0], [0.17, 0.03], [0.12, 0.07], [0.1, 0.15], [0.1, 0.28], [0.085, 0.31], [0.085, 0.34], [0.115, 0.38], [0.125, 0.45], [0.1, 0.5], [0.001, 0.5]] as P2[]).map(([r, y]) => [r * s, y * s] as P2);
      set.add(lathe(prof, 16), iron);
      set.add(cylinder(0.172 * s, 0.172 * s, 0.015 * s, 14), { finish: 'concrete' as const, color: '#8d8a84' });
      set.boxMinMax(-0.18 * s, 0, -0.18 * s, 0.18 * s, H, 0.18 * s);
    }
    return set.build();
  },
};

export const LOBSTER_POT: FurnitureDef = {
  id: 'furn-lobster-pot',
  kind: 'lobster-pot',
  aliases: ['lobster pot', 'crab pot', 'fish trap', 'creel', 'fishing pot', 'lobster trap', 'crab trap'],
  description: 'A lobster or crab pot: a half-round trap of wooden slats over a net funnel with a coil of rope and a float, 0.8 m long. Scatter a few round a quay or net rack.',
  params: { colour: color('#8a6a45', 'slat colour'), float: color('#d8452e', 'float colour') },
  mount: 'floor',
  againstWall: false,
  frontClearance: 0.2,
  size: () => [0.5, 0.4, 0.8],
  build(p) {
    const set = new PartSet();
    const slats = new Geom();
    // A half cylinder along Z: ribs at the ends and slats along the curve.
    const R = 0.25;
    const ribs = 6;
    for (const z of [-0.38, 0.38]) {
      for (let i = 0; i < ribs; i++) {
        const a0 = (Math.PI * i) / ribs;
        const a1 = (Math.PI * (i + 1)) / ribs;
        slats.merge(box(-0.012, -0.012, -0.012, 0.012, 0.012, 0.012));
        const x = (R * (Math.cos(a0) + Math.cos(a1))) / 2;
        const y = (R * (Math.sin(a0) + Math.sin(a1))) / 2;
        const len = Math.hypot(R * (Math.cos(a1) - Math.cos(a0)), R * (Math.sin(a1) - Math.sin(a0)));
        slats.merge(box(-len / 2, -0.012, -0.012, len / 2, 0.012, 0.012).rotateZ(((a0 + a1) / 2) * (180 / Math.PI) - 90 + 90 * 0).translate(x, y, z));
      }
    }
    for (let i = 1; i < ribs; i++) {
      const a = (Math.PI * i) / ribs;
      slats.merge(box(-0.012, -0.012, -0.38, 0.012, 0.012, 0.38).translate(R * Math.cos(a), R * Math.sin(a), 0));
    }
    slats.merge(box(-R, 0, -0.38, R, 0.02, 0.38));
    slats.translate(0, 0.012, 0);
    set.add(slats, { finish: 'oak' as const, color: p.color('colour') });
    set.add(sphere(0.07, 8).translate(0.16, 0.34, 0.1), paint(p.color('float'), 0.5));
    set.add(cylinder(0.1, 0.1, 0.03, 10).translate(-0.12, 0.2, -0.1), { finish: 'fabric' as const, color: '#b8a77c' });
    set.boxMinMax(-R, 0, -0.4, R, 0.4, 0.4);
    return set.build();
  },
};

export const SEAGULL: FurnitureDef = {
  id: 'furn-seagull',
  kind: 'seagull',
  aliases: ['seagull', 'gull', 'sea gull', 'bird', 'harbour gull', 'harbor gull', 'herring gull'],
  description: 'A standing herring gull, 0.55 m long, folded wings: perch a few on bollards, mooring piles, boat bows and the quay edge. Static (no animation).',
  params: { size: num(1, 0.6, 1.6, 'scale'), mantle: color('#9aa3ab', 'back and wing colour') },
  mount: 'floor',
  againstWall: false,
  frontClearance: 0.1,
  size: (p) => [0.2 * p.num('size'), 0.38 * p.num('size'), 0.55 * p.num('size')],
  build(p) {
    const set = new PartSet();
    const k = p.num('size');
    const body = new Geom();
    body.merge(sphere(0.1, 12).scale(0.85, 0.8, 1.7).rotateX(-12).translate(0, 0.25, 0));
    body.merge(sphere(0.055, 10).translate(0, 0.37, 0.15));
    body.merge(box(-0.018, 0.2, -0.28, 0.018, 0.25, -0.1).rotateX(12));
    body.scale(k, k, k);
    set.add(body, paint('#f3f1ec', 0.7));
    const wings = new Geom();
    for (const side of [-1, 1] as const) wings.merge(sphere(0.07, 8).scale(0.35, 0.6, 1.9).rotateX(-14).translate(side * 0.082, 0.27, -0.03));
    wings.scale(k, k, k);
    set.add(wings, paint(p.color('mantle'), 0.7));
    const beak = new Geom();
    beak.merge(cylinder(0.002, 0.014, 0.07, 6).rotateX(90).translate(0, 0.37, 0.22));
    beak.scale(k, k, k);
    set.add(beak, paint('#e8b43a', 0.5));
    const legs = new Geom();
    for (const side of [-1, 1] as const) legs.merge(cylinder(0.006, 0.006, 0.17, 5).translate(side * 0.035, 0, 0.02));
    legs.scale(k, k, k);
    set.add(legs, paint('#d9a05a', 0.6));
    set.boxMinMax(-0.1 * k, 0, -0.28 * k, 0.1 * k, 0.42 * k, 0.28 * k);
    return set.build();
  },
};

/** Boats, bollards, cleats, piles, lobster pots and gulls. */
export const HARBOUR: readonly FurnitureDef[] = [BOAT, BOLLARD, LOBSTER_POT, SEAGULL];
