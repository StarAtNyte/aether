import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld, type WorldDoc } from '@aether/core';
import {
  FIDELITY_WEIGHTS,
  PHOTO_BUILDING_ID,
  deltaE2000,
  deriveBuild,
  fidelityScore,
  fidelityText,
  hexDeltaE,
  measureFidelity,
  memoryCaller,
  parseRoomDescription,
  rgbToLab,
  runBuild,
  type FidelityReport,
} from '../src/photo/index';
import { moveItem, partKinds, removeItem } from '../src/index';
import { applyEdit } from './scene-helpers';

const FIXTURE = resolve(__dirname, '../../../tests/fixtures/photo/hotel.description.json');
const SNAPSHOT = resolve(__dirname, '../../../tests/fixtures/photo/hotel.fidelity.json');
const parsed = parseRoomDescription(JSON.parse(readFileSync(FIXTURE, 'utf8')) as unknown, partKinds());
if (!parsed.ok) throw new Error(parsed.error);
const d = parsed.value;

async function room(): Promise<WorldDoc> {
  const mem = memoryCaller(createWorld({}));
  return (await runBuild(mem.world(), deriveBuild(d), mem.call)).world;
}

const must = (r: FidelityReport | null): FidelityReport => {
  if (!r) throw new Error('no report');
  return r;
};

describe('colour difference', () => {
  it('matches published CIEDE2000 reference pairs', () => {
    // Sharma, Wu, Dalal (2005), test data pairs 1, 7 and 17.
    expect(deltaE2000({ L: 50, a: 2.6772, b: -79.7751 }, { L: 50, a: 0, b: -82.7485 })).toBeCloseTo(2.0425, 3);
    expect(deltaE2000({ L: 50, a: 0, b: 0 }, { L: 50, a: -1, b: 2 })).toBeCloseTo(2.3669, 3);
    expect(deltaE2000({ L: 50, a: 2.5, b: 0 }, { L: 73, a: 25, b: -18 })).toBeCloseTo(27.1492, 3);
  });

  it('is zero for equal colours and reads hex', () => {
    expect(hexDeltaE('#7d6a74', '#7d6a74')).toBe(0);
    expect(hexDeltaE('#ffffff', 'nope')).toBeNull();
    expect(rgbToLab(255, 255, 255).L).toBeCloseTo(100, 2);
    expect(hexDeltaE('#000000', '#ffffff')).toBeGreaterThan(90);
  });
});

describe('fidelity of a room built from its description', () => {
  it('scores the faithful build near the top on every structural measure', async () => {
    const r = must(measureFidelity(await room(), d));
    expect(r.metrics.inventory).toBe(1);
    expect(r.metrics.openings).toBeGreaterThan(0.95);
    expect(r.metrics.placement).toBeGreaterThan(0.85);
    expect(r.metrics.materials).toBeGreaterThan(0.9);
    expect(r.metrics.sizes).toBeGreaterThan(0.8);
    expect(r.metrics.framing).toBeNull();
    expect(r.score).toBeGreaterThan(0.88);
  });

  it('is deterministic: the same world gives the same report, run after run', async () => {
    const w = await room();
    const a = measureFidelity(w, d);
    const b = measureFidelity(w, d);
    const c = measureFidelity(JSON.parse(JSON.stringify(w)) as WorldDoc, d);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    // And building the room again from the same description gives the same numbers.
    expect(measureFidelity(await room(), d)).toEqual(a);
  });

  it('matches the committed regression snapshot of the hotel bedroom', async () => {
    const r = must(measureFidelity(await room(), d));
    // AETHER_UPDATE_FIXTURES=1 rewrites the snapshot (after a deliberate change to a measure; say why in the commit).
    if (process.env['AETHER_UPDATE_FIXTURES'] === '1') writeFileSync(SNAPSHOT, `${JSON.stringify({ note: 'measureFidelity of the hotel bedroom built from hotel.description.json', score: r.score, metrics: r.metrics, issues: r.issues.map((i) => `${i.metric}: ${i.text}`) }, null, 2)}\n`);
    const snap = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as { score: number; metrics: Record<string, number | null>; issues: string[] };
    expect(r.issues.map((i) => `${i.metric}: ${i.text}`)).toEqual(snap.issues);
    for (const [k, v] of Object.entries(snap.metrics)) {
      const got = r.metrics[k as keyof typeof r.metrics];
      if (v === null) expect(got).toBeNull();
      else expect(got).toBeCloseTo(v, 6);
    }
    expect(r.score).toBeCloseTo(snap.score, 6);
  });

  it('a missing piece lowers the inventory and names it', async () => {
    const w = await room();
    const base = must(measureFidelity(w, d));
    const less = applyEdit(w, removeItem(w, undefined, 'tv'));
    const r = must(measureFidelity(less, d));
    expect(r.metrics.inventory).toBeLessThan(base.metrics.inventory ?? 0);
    expect(r.issues.some((i) => i.metric === 'inventory' && i.id === 'tv')).toBe(true);
    expect(r.score).toBeLessThan(base.score ?? 0);
  });

  it('a piece moved a metre along its wall lowers the placement in proportion', async () => {
    const w = await room();
    const base = must(measureFidelity(w, d));
    const bed = d.items.find((i) => i.id === 'bed');
    const t = (bed?.along ?? 2) + 0.14;
    const near = applyEdit(w, moveItem(w, undefined, 'tv-cabinet', { wall: 'west', t: tOf(w, 'tv-cabinet') + 0.3, gap: 0.02 }));
    const far = applyEdit(w, moveItem(w, undefined, 'tv-cabinet', { wall: 'west', t: tOf(w, 'tv-cabinet') + 0.9, gap: 0.02 }));
    const pn = must(measureFidelity(near, d)).metrics.placement ?? 1;
    const pf = must(measureFidelity(far, d)).metrics.placement ?? 1;
    expect(pn).toBeLessThan(base.metrics.placement ?? 0);
    expect(pf).toBeLessThan(pn);
    expect(t).toBeGreaterThan(0);
  });

  it('a repainted wall lowers the colour measure by its ΔE', async () => {
    const w = await room();
    const base = must(measureFidelity(w, d));
    const recoloured = repaint(w, '#2e7d32');
    const r = must(measureFidelity(recoloured, d));
    expect(r.metrics.materials).toBeLessThan((base.metrics.materials ?? 0) - 0.1);
    expect(r.issues.some((i) => i.metric === 'materials' && /wall/.test(i.id))).toBe(true);
  });

  it('render measures join the sub-score with their weights', async () => {
    const r = must(measureFidelity(await room(), d, { framing: { score: 0.5, rows: [] }, similarity: 0.2, regionColour: 0.6 }));
    expect(r.metrics.framing).toBe(0.5);
    const manual = fidelityScore(r.metrics);
    expect(r.score).toBeCloseTo(manual ?? 0, 9);
    const sum = Object.values(FIDELITY_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 9);
    expect(fidelityText(r)).toMatch(/measured fidelity \d+%/);
  });
});

/** Wall `t` of a floor piece against its wall. */
function tOf(world: WorldDoc, handle: string): number {
  const e = world.entities[`${PHOTO_BUILDING_ID}-${handle}`];
  if (!e) throw new Error(`no ${handle}`);
  // West wall: t runs south to north from the south-west corner (centreline at -0.14).
  return d.footprint.depth + 0.14 - e.transform.position[2];
}

/** Every wall face painted one colour. */
function repaint(world: WorldDoc, color: string): WorldDoc {
  const patches = Object.values(world.entities)
    .filter((e) => e.arch?.role === 'wall' && e.shape.kind === 'procedural')
    .map((e) => {
      const p = { ...(e.shape.kind === 'procedural' ? e.shape.params : {}) } as Record<string, unknown>;
      for (const k of ['finishA', 'finishB']) {
        const f = p[k] as { color?: string } | undefined;
        if (f) p[k] = { ...f, color };
      }
      return { op: 'update' as const, id: e.id, set: { shape: { ...e.shape, params: p } } };
    });
  const res = applyPatches(world, patches as Parameters<typeof applyPatches>[1]);
  expect(res.errors).toEqual([]);
  return res.world;
}
