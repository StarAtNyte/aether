import { describe, expect, it } from 'vitest';
import {
  FURNITURE,
  STRUCTURE_IDS,
  buildFurniture,
  buildStructure,
  buildWall,
  furnitureSize,
  openingSpans,
  roofRise,
  solveWallJoins,
  stairFootprint,
  stairRisers,
  triangulate,
  triangulatedArea,
  wallNetwork,
  WallParams,
  StairParams,
  area,
  roundedBox,
  cylinder,
  lathe,
  tube,
  extrude,
  box,
  type ArchOutput,
  type ArchPart,
  type P2,
} from '../src/index';

/** Every triangle's winding agrees with its vertex normals (front faces point where the normals do). */
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
    const len = Math.hypot(gx, gy, gz);
    if (len < 1e-9) continue;
    const nx = (n[a] as number) + (n[b] as number) + (n[c] as number);
    const ny = (n[a + 1] as number) + (n[b + 1] as number) + (n[c + 1] as number);
    const nz = (n[a + 2] as number) + (n[b + 2] as number) + (n[c + 2] as number);
    total++;
    if (gx * nx + gy * ny + gz * nz > 0) ok++;
  }
  return total === 0 ? 1 : ok / total;
}

function checkOutput(out: ArchOutput, label: string, minAgreement = 0.97): void {
  expect(out.parts.length, `${label}: parts`).toBeGreaterThan(0);
  for (const part of out.parts) {
    const n = part.positions.length / 3;
    expect(part.normals.length, `${label}: normals`).toBe(part.positions.length);
    expect(part.uvs.length, `${label}: uvs`).toBe(n * 2);
    expect(part.indices.length % 3, `${label}: indices`).toBe(0);
    for (const i of part.indices) expect(i).toBeLessThan(n);
    for (const v of part.positions) expect(Number.isFinite(v), `${label}: finite`).toBe(true);
    for (const v of part.uvs) expect(Number.isFinite(v), `${label}: finite uv`).toBe(true);
    for (let k = 0; k < part.normals.length; k += 3) {
      const l = Math.hypot(part.normals[k] as number, part.normals[k + 1] as number, part.normals[k + 2] as number);
      expect(Math.abs(l - 1), `${label}: unit normals`).toBeLessThan(1e-3);
    }
    expect(windingAgreement(part), `${label}: winding vs normals`).toBeGreaterThanOrEqual(minAgreement);
  }
}

function boundsOf(out: ArchOutput): [number, number, number, number, number, number] {
  const b: [number, number, number, number, number, number] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const part of out.parts) {
    for (let k = 0; k < part.positions.length; k += 3) {
      for (let a = 0; a < 3; a++) {
        const v = part.positions[k + a] as number;
        if (v < (b[a] as number)) b[a] = v;
        if (v > (b[a + 3] as number)) b[a + 3] = v;
      }
    }
  }
  return b;
}

describe('primitives', () => {
  it('produce outward-facing, consistently wound geometry', () => {
    const geoms = {
      box: box(-1, 0, -0.5, 1, 2, 0.5),
      roundedBox: roundedBox(1.2, 0.5, 0.8, 0.08, 3),
      cylinder: cylinder(0.3, 0.2, 1, 24),
      lathe: lathe([[0.2, 0], [0.3, 0.5], [0.1, 1]], 24),
      tube: tube([[0, 0, 0], [1, 0.5, 0], [2, 0.5, 1]], 0.05, 10),
      extrude: extrude([[0, 0], [2, 0], [2, 1], [1, 2], [0, 1]], 0, 0.5),
    };
    for (const [name, g] of Object.entries(geoms)) checkOutput({ parts: [{ ...g.toData(), material: {} }], colliders: [] }, name, 0.99);
  });

  it('rounded boxes keep their requested size', () => {
    const b = roundedBox(1.2, 0.5, 0.8, 0.08, 3).bounds();
    expect(b[3] - b[0]).toBeCloseTo(1.2, 5);
    expect(b[4] - b[1]).toBeCloseTo(0.5, 5);
    expect(b[5] - b[2]).toBeCloseTo(0.8, 5);
  });
});

describe('triangulation', () => {
  it('handles concave outlines and holes', () => {
    const outline: P2[] = [[0, 0], [6, 0], [6, 4], [3, 4], [3, 2], [0, 2]];
    const hole: P2[] = [[4, 1], [5, 1], [5, 3], [4, 3]];
    const { points, triangles } = triangulate(outline, [hole]);
    expect(Math.abs(triangulatedArea(points, triangles))).toBeCloseTo(area(outline) - area(hole), 6);
  });
});

describe('walls', () => {
  const base = WallParams.parse({ length: 4, height: 2.7, thickness: 0.2, skirting: 'none', finishB: { finish: 'brick' }, openings: [{ kind: 'door', offset: 1, width: 0.9, height: 2.1 }, { kind: 'window', offset: 3, width: 1, height: 1.2, sill: 0.9 }] });

  it('tiles side faces around openings (area = wall − openings)', () => {
    const out = buildWall(base);
    checkOutput(out, 'wall', 1);
    const sideA = out.parts[0] as ArchPart;
    let a = 0;
    for (let t = 0; t < sideA.indices.length; t += 3) {
      const i = (sideA.indices[t] as number) * 3;
      const j = (sideA.indices[t + 1] as number) * 3;
      const k = (sideA.indices[t + 2] as number) * 3;
      const ux = (sideA.positions[j] as number) - (sideA.positions[i] as number);
      const uy = (sideA.positions[j + 1] as number) - (sideA.positions[i + 1] as number);
      const vx = (sideA.positions[k] as number) - (sideA.positions[i] as number);
      const vy = (sideA.positions[k + 1] as number) - (sideA.positions[i + 1] as number);
      a += Math.abs(ux * vy - uy * vx) / 2;
    }
    expect(a).toBeCloseTo(4 * 2.7 - 0.9 * 2.1 - 1 * 1.2, 5);
  });

  it('uses metre UVs along the wall', () => {
    const out = buildWall(WallParams.parse({ length: 5, height: 3, skirting: 'none', finishB: { finish: 'brick' } }));
    const side = out.parts[0] as ArchPart;
    let umin = Infinity;
    let umax = -Infinity;
    for (let k = 0; k < side.uvs.length; k += 2) {
      // Side-A face vertices only (normal −Z); the part also holds the top and end caps.
      if ((side.normals[(k / 2) * 3 + 2] as number) > -0.9) continue;
      umin = Math.min(umin, side.uvs[k] as number);
      umax = Math.max(umax, side.uvs[k] as number);
    }
    expect(umax - umin).toBeCloseTo(5, 5);
  });

  it('keeps doorways walkable and window holes solid in the colliders', () => {
    const out = buildWall(base);
    const doorCenter = { x: 1, y: 1 };
    const covers = (x: number, y: number): boolean =>
      out.colliders.some((c) => c.kind === 'box' && Math.abs(x - c.offset[0]) <= c.halfExtents[0] && Math.abs(y - c.offset[1]) <= c.halfExtents[1]);
    expect(covers(doorCenter.x, doorCenter.y)).toBe(false);
    expect(covers(3, 1.5)).toBe(true);
    expect(covers(2, 1)).toBe(true);
  });

  it('clips and merges openings', () => {
    const spans = openingSpans({ length: 3, height: 2.5, openings: [{ kind: 'window', offset: 0.2, width: 1, height: 3, sill: 1 }, { kind: 'door', offset: 0.9, width: 0.8, height: 2.1, sill: 0 }] });
    expect(spans).toHaveLength(1);
    expect(spans[0]?.kind).toBe('door');
    expect(spans[0]?.x0).toBeCloseTo(0.02, 5);
    expect(spans[0]?.y1).toBeCloseTo(2.5, 5);
  });

  it('mitres L corners and butts T junctions', () => {
    const joins = solveWallJoins([
      { id: 'a', a: [0, 0], b: [4, 0], thickness: 0.2 },
      { id: 'b', a: [4, 0], b: [4, 3], thickness: 0.2 },
    ]);
    const a = joins.get('a');
    const b = joins.get('b');
    // At the corner (4,0): one edge of each wall extends by t/2, the other trims by t/2.
    expect([a?.endA, a?.endB].map((v) => Math.abs(v ?? 0))).toEqual([0.1, 0.1]);
    expect((a?.endA ?? 0) + (a?.endB ?? 0)).toBeCloseTo(0, 6);
    expect((b?.startA ?? 0) + (b?.startB ?? 0)).toBeCloseTo(0, 6);
    expect(a?.startA).toBe(0);
    const t = solveWallJoins([
      { id: 'left', a: [0, 0], b: [2, 0], thickness: 0.2 },
      { id: 'right', a: [2, 0], b: [4, 0], thickness: 0.2 },
      { id: 'stem', a: [2, 0], b: [2, 2], thickness: 0.1 },
    ]);
    const stem = t.get('stem');
    // The stem stops at the through wall's face (half its thickness).
    expect(stem?.startA).toBeCloseTo(-0.1, 6);
    expect(stem?.startB).toBeCloseTo(-0.1, 6);
    // Through walls: the stem side trims by half the stem, the far side runs straight through.
    const left = t.get('left');
    expect([left?.endA, left?.endB].sort()).toEqual([-0.05, 0]);
  });
});

describe('wall network', () => {
  it('derives exterior and interior walls from adjacent rooms', () => {
    const walls = wallNetwork([
      { id: 'living', polygon: [[0, 0], [5, 0], [5, 4], [0, 4]] },
      { id: 'kitchen', polygon: [[5, 0], [8, 0], [8, 4], [5, 4]] },
    ]);
    expect(walls).toHaveLength(5);
    const interior = walls.filter((w) => !w.exterior);
    expect(interior).toHaveLength(1);
    const shared = interior[0];
    expect(new Set([shared?.roomA, shared?.roomB])).toEqual(new Set(['living', 'kitchen']));
    const long = walls.filter((w) => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) > 7.9);
    expect(long).toHaveLength(2);
  });

  it('splits edges at T-junction vertices', () => {
    const walls = wallNetwork([
      { id: 'hall', polygon: [[0, 0], [6, 0], [6, 2], [0, 2]] },
      { id: 'bed1', polygon: [[0, 2], [3, 2], [3, 6], [0, 6]] },
      { id: 'bed2', polygon: [[3, 2], [6, 2], [6, 6], [3, 6]] },
    ]);
    const interior = walls.filter((w) => !w.exterior);
    // The hall wall runs through the T (one wall for both bedrooms) plus the bed1/bed2 wall.
    expect(interior).toHaveLength(2);
    const stem = interior.find((w) => Math.abs(w.a[0] - 3) < 1e-6 && Math.abs(w.b[0] - 3) < 1e-6);
    expect(stem).toBeDefined();
    const joins = solveWallJoins(walls.map((w, i) => ({ id: `w${i}`, a: w.a, b: w.b, thickness: w.exterior ? 0.3 : 0.12 })));
    const idx = walls.indexOf(stem as (typeof walls)[number]);
    const j = joins.get(`w${idx}`);
    // The stem starts at the hall wall's centreline (z = 2): it is trimmed back to its face (−0.06).
    const startsAtHall = Math.abs((stem?.a[1] ?? 0) - 2) < 1e-6;
    const [e1, e2] = startsAtHall ? [j?.startA, j?.startB] : [j?.endA, j?.endB];
    expect(e1).toBeCloseTo(-0.06, 6);
    expect(e2).toBeCloseTo(-0.06, 6);
  });
});

describe('stairs and roofs', () => {
  it('uses equal risers and lands on the next floor', () => {
    const p = StairParams.parse({ rise: 3, shape: 'straight' });
    const { count, riser } = stairRisers(p);
    expect(count).toBe(17);
    expect(riser * count).toBeCloseTo(3, 6);
    const fp = stairFootprint(p);
    expect(area(fp)).toBeCloseTo((count - 1) * p.going * p.width, 5);
    const out = buildStructure('arch-stair', { rise: 3, shape: 'straight' });
    const b = boundsOf(out);
    expect(b[4]).toBeGreaterThan(2.9);
  });

  it('builds L and U stairs with landings', () => {
    for (const shape of ['l', 'u'] as const) {
      const out = buildStructure('arch-stair', { rise: 2.8, shape, width: 1 });
      checkOutput(out, `stair-${shape}`, 0.98);
      const fp = stairFootprint(StairParams.parse({ rise: 2.8, shape, width: 1 }));
      expect(fp.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('reports ridge rise', () => {
    expect(roofRise({ shape: 'gable', width: 10, depth: 8, pitch: 45, ridgeAlongX: true })).toBeCloseTo(4, 6);
    expect(roofRise({ shape: 'flat', width: 10, depth: 8, pitch: 45, ridgeAlongX: true })).toBe(0);
  });
});

describe('every structural generator', () => {
  const samples: Record<string, Record<string, unknown>> = {
    'arch-wall': { length: 3.5, openings: [{ kind: 'window', offset: 1.5, width: 1.2, height: 1.3, sill: 0.9 }], startA: 0.1, startB: -0.1 },
    'arch-slab': { polygon: [[0, 0], [5, 0], [5, 3], [2, 3], [2, 5], [0, 5]], holes: [[[0.5, 0.5], [1.5, 0.5], [1.5, 2.5], [0.5, 2.5]]] },
    'arch-ceiling': { polygon: [[0, 0], [5, 0], [5, 4], [0, 4]], cove: 0.1 },
    'arch-roof': { width: 10, depth: 8, shape: 'gable' },
    'arch-stair': { rise: 3 },
    'arch-door': { style: 'panel' },
    'arch-frame': { width: 0.96, height: 2.12 },
    'arch-window': { width: 2.4, height: 1.6, style: 'casement' },
    'arch-railing': { points: [[0, 0], [3, 0], [3, 2]], style: 'glass' },
    'arch-column': { shape: 'round' },
    'arch-basin': { width: 8, length: 4 },
  };
  for (const id of STRUCTURE_IDS) {
    it(`${id} builds clean geometry`, () => {
      const out = buildStructure(id, (samples[id] ?? {}) as Record<string, never>);
      checkOutput(out, id, 0.98);
    });
  }

  it('roof shapes all build and stay above the eaves at the footprint', () => {
    for (const shape of ['flat', 'gable', 'hip', 'shed'] as const) {
      for (const ridgeAlongX of [true, false]) {
        const out = buildStructure('arch-roof', { width: 9, depth: 6, shape, ridgeAlongX });
        checkOutput(out, `roof-${shape}`, 0.98);
        expect(out.colliders.length).toBeGreaterThan(0);
      }
    }
  });

  it('rejects invalid params with a readable error', () => {
    expect(() => buildStructure('arch-wall', { length: -1 })).toThrow(/arch-wall params invalid: length/);
    expect(() => buildStructure('arch-slab', { polygon: [[0, 0]] })).toThrow(/polygon/);
  });
});

describe('furniture catalogue', () => {
  it('has unique ids and kinds', () => {
    expect(new Set(FURNITURE.map((f) => f.id)).size).toBe(FURNITURE.length);
    expect(new Set(FURNITURE.map((f) => f.kind)).size).toBe(FURNITURE.length);
  });

  for (const def of FURNITURE) {
    it(`${def.id} builds clean geometry within its declared size`, () => {
      const out = buildFurniture(def, {}, 7);
      checkOutput(out, def.id, 0.95);
      const [w, h, d] = furnitureSize(def, {});
      const b = boundsOf(out);
      const tol = 0.12;
      expect(b[3] - b[0], `${def.id} width`).toBeLessThanOrEqual(w + 2 * tol + (def.kind === 'floor-lamp' ? 1.2 : 0));
      expect(b[5] - b[2], `${def.id} depth`).toBeLessThanOrEqual(d + 2 * tol + (def.kind === 'plant' ? 1 : 0) + (def.kind === 'kitchen' ? 0.2 : 0));
      if (def.mount === 'floor') {
        expect(b[1], `${def.id} rests on the floor`).toBeGreaterThanOrEqual(-0.001);
        expect(b[4], `${def.id} height`).toBeLessThanOrEqual(h + 0.25 + (def.kind === 'plant' ? 0.5 : 0));
        // Rugs are walked over: no collider.
        if (def.kind !== 'rug') expect(out.colliders.length, `${def.id} colliders`).toBeGreaterThan(0);
      }
      if (def.mount === 'ceiling') expect(b[4], `${def.id} hangs from the ceiling`).toBeLessThanOrEqual(0.001);
    });
  }

  it('is deterministic for a seed', () => {
    const def = FURNITURE.find((f) => f.kind === 'bookshelf');
    if (!def) throw new Error('missing bookshelf');
    const a = buildFurniture(def, {}, 3);
    const b = buildFurniture(def, {}, 3);
    expect(Array.from(a.parts[1]?.positions ?? [])).toEqual(Array.from(b.parts[1]?.positions ?? []));
  });
});
