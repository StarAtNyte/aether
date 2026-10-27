/**
 * Spiral stairs, dormers, turret roofs and column styles: the schemas, the geometry (well formed, outward-facing), the
 * walking line, the stairwell, the roof intersection and the guarantee that nothing that existed before changed.
 */
import { describe, expect, it } from 'vitest';
import {
  FURNITURE,
  STRUCTURE_IDS,
  buildDormer,
  buildFurniture,
  buildSpiralStair,
  buildStructure,
  buildTurretRoof,
  dormerPlacement,
  dormerShape,
  findCrafted,
  furnitureByKind,
  parseStructureParams,
  spiralFootprint,
  spiralHeadroom,
  spiralLayout,
  spiralMaxTurns,
  spiralProblems,
  spiralWalkLine,
  ColumnParams,
  DormerParams,
  SpiralStairParams,
  TurretRoofParams,
  type ArchOutput,
  type ArchPart,
} from '../src/index';

function windingAgreement(part: ArchPart): number {
  const { positions: p, normals: n, indices: idx } = part;
  let ok = 0;
  let total = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = (idx[t] as number) * 3;
    const b = (idx[t + 1] as number) * 3;
    const c = (idx[t + 2] as number) * 3;
    const ux = (p[b] as number) - (p[a] as number);
    const uy = (p[b + 1] as number) - (p[a + 1] as number);
    const uz = (p[b + 2] as number) - (p[a + 2] as number);
    const vx = (p[c] as number) - (p[a] as number);
    const vy = (p[c + 1] as number) - (p[a + 1] as number);
    const vz = (p[c + 2] as number) - (p[a + 2] as number);
    const gx = uy * vz - uz * vy;
    const gy = uz * vx - ux * vz;
    const gz = ux * vy - uy * vx;
    if (Math.hypot(gx, gy, gz) < 1e-9) continue;
    const nx = (n[a] as number) + (n[b] as number) + (n[c] as number);
    const ny = (n[a + 1] as number) + (n[b + 1] as number) + (n[c + 1] as number);
    const nz = (n[a + 2] as number) + (n[b + 2] as number) + (n[c + 2] as number);
    total++;
    if (gx * nx + gy * ny + gz * nz > 0) ok++;
  }
  return total === 0 ? 1 : ok / total;
}

function wellFormed(out: ArchOutput, label: string, minAgreement = 0.97): number {
  expect(out.parts.length, `${label}: parts`).toBeGreaterThan(0);
  let tris = 0;
  for (const part of out.parts) {
    const n = part.positions.length / 3;
    expect(part.uvs.length, label).toBe(n * 2);
    for (const i of part.indices) expect(i).toBeLessThan(n);
    for (const v of part.positions) expect(Number.isFinite(v), `${label}: finite`).toBe(true);
    for (const v of part.uvs) expect(Number.isFinite(v), `${label}: finite uv`).toBe(true);
    expect(windingAgreement(part), `${label}: winding vs normals`).toBeGreaterThanOrEqual(minAgreement);
    tris += part.indices.length / 3;
  }
  return tris;
}

function bounds(out: ArchOutput): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of out.parts) for (let k = 0; k < p.positions.length; k += 3) for (let a = 0; a < 3; a++) {
    min[a] = Math.min(min[a] as number, p.positions[k + a] as number);
    max[a] = Math.max(max[a] as number, p.positions[k + a] as number);
  }
  return { min, max };
}

describe('nothing that existed changes', () => {
  it('the older generator ids keep their order and the new ones come after', () => {
    expect(STRUCTURE_IDS.slice(0, 13)).toEqual(['arch-wall', 'arch-slab', 'arch-ceiling', 'arch-roof', 'arch-stair', 'arch-door', 'arch-frame', 'arch-window', 'arch-sash', 'arch-railing', 'arch-column', 'arch-basin', 'arch-sign']);
    expect(STRUCTURE_IDS.slice(13)).toEqual(['arch-spiral-stair', 'arch-dormer', 'arch-turret-roof']);
  });

  it('a column without a style resolves to the same params as before (no new keys, so stored worlds and bake keys stay put)', () => {
    expect(Object.keys(parseStructureParams('arch-column', {})).sort()).toEqual(['finish', 'height', 'shape', 'size']);
    expect(Object.keys(parseStructureParams('arch-column', { shape: 'square', size: 0.26, height: 2.2 })).sort()).toEqual(['finish', 'height', 'shape', 'size']);
  });

  it('a plain column builds the plain cylinder (the styled path is not taken)', () => {
    const plain = buildStructure('arch-column', { shape: 'round', size: 0.3, height: 2.8 });
    const same = buildStructure('arch-column', { shape: 'round', size: 0.3, height: 2.8, style: 'plain' });
    expect(plain.parts.length).toBe(1);
    expect(same.parts[0]?.positions.length).toBeGreaterThan(0);
    // The plain round column is one 28-segment cylinder with caps.
    expect(plain.parts[0]?.indices.length).toBe(28 * 6 + 28 * 3 * 2);
    expect(plain.colliders).toHaveLength(1);
  });

  it('the furniture catalogue still has unique ids and kinds with the new pieces appended', () => {
    expect(new Set(FURNITURE.map((f) => f.id)).size).toBe(FURNITURE.length);
    expect(new Set(FURNITURE.map((f) => f.kind)).size).toBe(FURNITURE.length);
    expect(FURNITURE.slice(-3).map((f) => f.id)).toEqual(['furn-spiral-stair', 'furn-dormer', 'furn-turret-roof']);
  });
});

describe('spiral stair', () => {
  const P = SpiralStairParams.parse({});

  it('lays out risers, an angle per riser and a walking radius inside the treads', () => {
    const l = spiralLayout(P);
    expect(l.riser).toBeCloseTo(P.rise / l.n, 9);
    expect(l.riser).toBeLessThan(0.2);
    expect(l.dTheta * l.n).toBeCloseTo(P.turns * 2 * Math.PI, 9);
    expect(l.walk).toBeGreaterThan(l.inner);
    expect(l.walk).toBeLessThan(l.outer);
  });

  it('builds a well formed mesh with a wedge collider per tread, within the collider and triangle budgets', () => {
    const out = buildSpiralStair(P);
    const tris = wellFormed(out, 'spiral');
    expect(tris).toBeLessThan(12_000);
    expect(out.colliders.length).toBeLessThan(200);
    expect(out.colliders.filter((c) => c.kind === 'hull').length).toBeGreaterThanOrEqual(spiralLayout(P).n - 1);
    const b = bounds(out);
    expect(b.min[1]).toBeGreaterThanOrEqual(-0.001);
    expect(Math.max(Math.abs(b.min[0] as number), Math.abs(b.max[0] as number))).toBeLessThan(P.radius + 0.12);
    // The newel / landing rail stand above the floor above; nothing reaches far past the guard height.
    expect(b.max[1]).toBeLessThan(P.rise + 1.0);
  });

  it('builds every handedness, core, rail and balustrade', () => {
    for (const hand of ['right', 'left'] as const) for (const core of ['solid', 'open'] as const) for (const balustrade of ['steel', 'timber', 'glass'] as const) {
      const p = SpiralStairParams.parse({ hand, core, balustrade, rail: core === 'open' ? 'both' : 'outer', turns: 1.25, radius: 0.9 });
      wellFormed(buildSpiralStair(p), `${hand}/${core}/${balustrade}`);
    }
    const bare = buildSpiralStair(SpiralStairParams.parse({ rail: 'none', landingRail: false }));
    wellFormed(bare, 'no rails');
    expect(bare.colliders.length).toBeLessThan(buildSpiralStair(P).colliders.length);
  });

  it('the walking line climbs monotonically from the floor to the floor above, over the treads, on its radius', () => {
    for (const hand of ['right', 'left'] as const) {
      const p = SpiralStairParams.parse({ hand, turns: 1.5, rise: 3.2, startAngle: 35 });
      const l = spiralLayout(p);
      const line = spiralWalkLine(p);
      expect((line[0] as number[])[1]).toBe(0);
      expect((line[line.length - 1] as number[])[1]).toBeCloseTo(p.rise, 9);
      for (let k = 1; k < line.length; k++) expect((line[k] as number[])[1]).toBeGreaterThanOrEqual((line[k - 1] as number[])[1] as number);
      // Tread centres sit at the walking radius and a riser apart in height.
      const treads = line.slice(2, 2 + l.n - 1);
      treads.forEach((q, k) => {
        expect(Math.hypot(q[0], q[2])).toBeCloseTo(l.walk, 6);
        expect(q[1]).toBeCloseTo((k + 1) * l.riser, 6);
      });
      // The angle moves the way the hand says.
      const a0 = Math.atan2((treads[0] as number[])[2] as number, (treads[0] as number[])[0] as number);
      const a1 = Math.atan2((treads[1] as number[])[2] as number, (treads[1] as number[])[0] as number);
      let d = a1 - a0;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      expect(Math.sign(d)).toBe(hand === 'right' ? 1 : -1);
    }
  });

  it('the stairwell is the disc without the landing sector, so the top arrives on solid floor', () => {
    const fp = spiralFootprint(P);
    expect(fp[0]).toEqual([0, 0]);
    const l = spiralLayout(P);
    const landing = (l.n - 1) * l.dTheta * l.dir + l.a0 + (l.dir * l.landing) / 2;
    const probe: [number, number] = [Math.cos(landing) * l.walk, Math.sin(landing) * l.walk];
    const inside = (pt: [number, number]): boolean => {
      let c = false;
      for (let i = 0, j = fp.length - 1; i < fp.length; j = i++) {
        const a = fp[i] as [number, number];
        const b = fp[j] as [number, number];
        if (a[1] > pt[1] !== b[1] > pt[1] && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
      }
      return c;
    };
    expect(inside(probe)).toBe(false);
    // The middle of the tread before the landing is inside the well (the floor above is open there).
    const prev = l.a0 + l.dir * (l.n - 1.5) * l.dTheta;
    expect(inside([Math.cos(prev) * l.walk, Math.sin(prev) * l.walk])).toBe(true);
  });

  it('headroom: one turn never passes over itself; more turns leave less than a person needs', () => {
    expect(spiralHeadroom(SpiralStairParams.parse({ turns: 1 }))).toBe(Infinity);
    expect(spiralHeadroom(SpiralStairParams.parse({ turns: 2, rise: 3.2 }))).toBeLessThan(2);
    // Under the landing sector the floor above hangs lower than a tread does.
    const p = SpiralStairParams.parse({ turns: 1.2, rise: 3 });
    expect(spiralHeadroom(p)).toBeLessThan(3 / 1.2 - 0.045);
    const max = spiralMaxTurns(p);
    expect(max).toBeGreaterThanOrEqual(1);
    expect(spiralHeadroom({ ...p, turns: max })).toBeGreaterThanOrEqual(2);
    expect(spiralProblems(SpiralStairParams.parse({ turns: 2 })).join(' ')).toMatch(/headroom/);
  });

  it('problems: the default stair is fine; a tight radius is flagged because a body catches on the inner treads', () => {
    expect(spiralProblems(SpiralStairParams.parse({}))).toEqual([]);
    expect(spiralProblems(SpiralStairParams.parse({ radius: 1.0 })).join(' ')).toMatch(/catches on the inner treads/);
    expect(spiralProblems(SpiralStairParams.parse({ radius: 1.4, steps: 40 })).join(' ')).toMatch(/deep at the walking line/);
  });

  it('rejects parameters outside the bounds', () => {
    expect(SpiralStairParams.safeParse({ radius: 0.2 }).success).toBe(false);
    expect(SpiralStairParams.safeParse({ turns: 9 }).success).toBe(false);
    expect(SpiralStairParams.safeParse({ hand: 'up' }).success).toBe(false);
  });
});

describe('dormer', () => {
  it('a gable dormer: ridge height, depth where it meets the roof plane, cheeks and roof on the slope', () => {
    const p = DormerParams.parse({ style: 'gable', width: 1.4, wallHeight: 1.3, roofPitch: 35, pitch: 30 });
    const s = dormerShape(p);
    expect(s.top).toBeCloseTo(1.3 + 0.7 * Math.tan((30 * Math.PI) / 180), 9);
    expect(s.depth).toBeCloseTo(s.top / Math.tan((35 * Math.PI) / 180), 9);
    const out = buildDormer(p);
    wellFormed(out, 'gable dormer');
    const b = bounds(out);
    // The back of the dormer stops on the roof plane y = -tan(roofPitch) * z.
    const tr = Math.tan((35 * Math.PI) / 180);
    for (const part of out.parts) {
      if (part.positions.length === 0) continue;
      for (let k = 0; k < part.positions.length; k += 3) {
        const z = part.positions[k + 2] as number;
        const y = part.positions[k + 1] as number;
        // Nothing sinks into the roof: every point is on or above the plane (a flashing strip stands a hair above).
        expect(y).toBeGreaterThanOrEqual(-tr * z - 1e-4);
      }
    }
    expect(b.min[2]).toBeGreaterThan(-s.depth - 0.01);
    expect(b.max[1]).toBeCloseTo(s.top, 2);
    // Flashing is its own material; the window glass is a transparent finish.
    expect(out.parts.some((q) => q.material.finish === 'brushed-metal')).toBe(true);
    expect(out.parts.some((q) => q.material.finish === 'glass')).toBe(true);
  });

  it('shed and hip dormers are well formed and meet the plane; a shed keeps its roof under the main pitch', () => {
    const shed = DormerParams.parse({ style: 'shed', roofPitch: 30, pitch: 45, wallHeight: 1.2 });
    const ss = dormerShape(shed);
    expect(ss.pitch).toBeLessThanOrEqual(26);
    wellFormed(buildDormer(shed), 'shed dormer');
    const hip = DormerParams.parse({ style: 'hip', roofPitch: 40, pitch: 35, width: 1.6 });
    wellFormed(buildDormer(hip), 'hip dormer');
    for (const d of [shed, hip]) {
      const tr = Math.tan((d.roofPitch * Math.PI) / 180);
      for (const part of buildDormer(d).parts) for (let k = 0; k < part.positions.length; k += 3) {
        expect(part.positions[k + 1] as number).toBeGreaterThanOrEqual(-tr * (part.positions[k + 2] as number) - 1e-4);
      }
    }
  });

  it('places on a gable roof: on the surface of the chosen slope, facing down it; flat and wrong sides refuse', () => {
    const roof = { width: 10, depth: 8, pitch: 35, thickness: 0.22, ridgeAlongX: true, shape: 'gable' } as const;
    const south = dormerPlacement(roof, 'south', 1.5, 1.2);
    const north = dormerPlacement(roof, 'north', 1.5, 1.2);
    expect(south?.rotationY).toBe(0);
    expect(north?.rotationY).toBe(180);
    expect(south?.position[2]).toBeCloseTo(4 - 1.2, 9);
    // On the roof's top surface at that distance up the slope.
    expect(south?.position[1]).toBeCloseTo(1.2 * Math.tan((35 * Math.PI) / 180) + 0.22 / Math.cos((35 * Math.PI) / 180), 9);
    expect(dormerPlacement(roof, 'east')).toBeNull();
    expect(dormerPlacement({ ...roof, shape: 'flat' }, 'south')).toBeNull();
    expect(dormerPlacement({ ...roof, shape: 'hip' }, 'east')?.rotationY).toBe(90);
  });
});

describe('turret roof', () => {
  it('cone, bell, dome, ogee and polygonal caps are well formed and reach their height', () => {
    for (const profile of ['cone', 'bell', 'dome', 'ogee'] as const) {
      const p = TurretRoofParams.parse({ profile, height: 2.4, radius: 1.4, wallHeight: 2, slits: 4 });
      const out = buildTurretRoof(p);
      wellFormed(out, profile);
      const b = bounds(out);
      expect(b.max[1]).toBeGreaterThan(2.4);
      expect(b.max[1]).toBeLessThan(2.4 + 0.6);
      expect(b.min[1]).toBeCloseTo(-2, 2);
      expect(Math.max(b.max[0] as number, b.max[2] as number)).toBeLessThanOrEqual(1.4 + 0.3 + 0.02);
    }
    wellFormed(buildTurretRoof(TurretRoofParams.parse({ sides: 6, profile: 'cone' })), 'hexagonal');
    expect(TurretRoofParams.safeParse({ sides: 2 }).success).toBe(false);
  });
});

describe('column styles', () => {
  it('fluted, classical (all capitals), square classical and pilaster columns are well formed', () => {
    for (const style of ['fluted', 'classical'] as const) wellFormed(buildStructure('arch-column', { shape: 'round', size: 0.4, height: 3, style }), style);
    for (const capital of ['tuscan', 'doric', 'ionic'] as const) wellFormed(buildStructure('arch-column', { shape: 'round', size: 0.4, height: 3, style: 'classical', capital, flutes: 20 }), capital, 0.9);
    wellFormed(buildStructure('arch-column', { shape: 'square', size: 0.4, height: 3, style: 'classical' }), 'square pier');
    const pil = buildStructure('arch-column', { size: 0.4, height: 3, style: 'pilaster', projection: 0.12 });
    wellFormed(pil, 'pilaster');
    const b = bounds(pil);
    // The back face stands on z = 0 and the pilaster projects toward +Z.
    expect(b.min[2]).toBeCloseTo(0, 6);
    expect(b.max[2]).toBeGreaterThan(0.12);
    expect(b.max[1]).toBeCloseTo(3, 4);
  });

  it('the shaft is really there: smooth, its middle is a full-radius ring; fluted, the grooves cut a few percent in', () => {
    const ring = (out: ArchOutput): { min: number; max: number } => {
      let min = Infinity;
      let max = 0;
      for (const part of out.parts) for (let k = 0; k < part.positions.length; k += 3) {
        const y = part.positions[k + 1] as number;
        if (y < 1.2 || y > 1.4) continue;
        const r = Math.hypot(part.positions[k] as number, part.positions[k + 2] as number);
        if (r < 0.05) continue;
        min = Math.min(min, r);
        max = Math.max(max, r);
      }
      return { min, max };
    };
    const R = 0.23;
    const smooth = ring(buildStructure('arch-column', { shape: 'round', size: 0.46, height: 3.2, style: 'classical', flutes: 0 }));
    expect(smooth.max).toBeGreaterThan(R * 0.8);
    expect(smooth.max - smooth.min).toBeLessThan(0.003);
    const fluted = ring(buildStructure('arch-column', { shape: 'round', size: 0.46, height: 3.2, style: 'fluted' }));
    expect(fluted.max).toBeGreaterThan(R * 0.9);
    expect(fluted.max - fluted.min).toBeGreaterThan(0.01);
    expect(fluted.min).toBeGreaterThan(R * 0.85);
  });

  it('a fluted shaft has far more triangles than the plain one and the same height', () => {
    const plain = buildStructure('arch-column', { shape: 'round', size: 0.4, height: 3 });
    const fluted = buildStructure('arch-column', { shape: 'round', size: 0.4, height: 3, style: 'fluted' });
    expect(fluted.parts[0]?.indices.length).toBeGreaterThan((plain.parts[0]?.indices.length ?? 0) * 2);
    expect(bounds(fluted).max[1]).toBeCloseTo(3, 4);
  });

  it('style options are validated', () => {
    expect(ColumnParams.safeParse({ style: 'baroque' }).success).toBe(false);
    expect(ColumnParams.safeParse({ flutes: 100 }).success).toBe(false);
  });
});

describe('find_model and the catalogue', () => {
  it('names resolve to the new pieces', () => {
    expect(findCrafted('spiral staircase')[0]?.id).toBe('furn-spiral-stair');
    expect(findCrafted('winding stair')[0]?.id).toBe('furn-spiral-stair');
    expect(findCrafted('dormer window')[0]?.id).toBe('furn-dormer');
    expect(findCrafted('conical roof')[0]?.id).toBe('furn-turret-roof');
    expect(findCrafted('witch hat roof')[0]?.id).toBe('furn-turret-roof');
  });

  it('the furniture wrappers build with their defaults and the column has the classical variants', () => {
    for (const kind of ['spiral-stair', 'dormer', 'turret-roof']) {
      const def = furnitureByKind(kind);
      expect(def, kind).toBeDefined();
      if (!def) continue;
      wellFormed(buildFurniture(def, {}, 1), kind);
    }
    const col = furnitureByKind('column');
    expect(col?.params['variant']?.type === 'enum' && col.params['variant'].options).toEqual(['round', 'fluted', 'square', 'pilaster', 'classical', 'ionic']);
    wellFormed(buildFurniture(col as never, { variant: 'ionic' }, 1), 'ionic column', 0.9);
  });
});
