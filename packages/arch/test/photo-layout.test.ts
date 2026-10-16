import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createWorld, type WorldDoc } from '@aether/core';
import { PHOTO_BUILDING_ID, deriveBuild, fitLayout, memoryCaller, parseRoomDescription, photoCameraSpec, runBuild, type FramingTarget, type LayoutMove } from '../src/photo/index';
import { customPose, entityGeometry, moveItem, partKinds, projectGeometry, readScene } from '../src/index';
import { applyEdit } from './scene-helpers';

const FIXTURE = resolve(__dirname, '../../../tests/fixtures/photo/hotel.description.json');
const parsed = parseRoomDescription(JSON.parse(readFileSync(FIXTURE, 'utf8')) as unknown, partKinds());
if (!parsed.ok) throw new Error(parsed.error);
const d = parsed.value;

async function room(): Promise<WorldDoc> {
  const mem = memoryCaller(createWorld({}));
  return (await runBuild(mem.world(), deriveBuild(d), mem.call)).world;
}

/** Boxes of every piece as the true room shows them from the photo camera: what a perfect reading of the photo would give. */
function truthTargets(world: WorldDoc, ids: readonly string[]): FramingTarget[] {
  const pose = customPose(world, PHOTO_BUILDING_ID, photoCameraSpec(d, 1.5))!;
  const boxes = projectGeometry(entityGeometry(world, PHOTO_BUILDING_ID), pose, 1.5);
  return ids.flatMap((label) => {
    const id = `${PHOTO_BUILDING_ID}-${label}`;
    const box = boxes.get(id);
    return box ? [{ label, ids: [id], box }] : [];
  });
}

function tOf(world: WorldDoc, label: string): number {
  const it = readScene(world, PHOTO_BUILDING_ID)!.items.find((i) => i.id === `${PHOTO_BUILDING_ID}-${label}`)!;
  const w = readScene(world, PHOTO_BUILDING_ID)!.rooms[0]!.walls[it.against?.[0]?.edge ?? it.wall!.edge]!;
  return (it.pos[0] - w.a[0]) * w.dir[0] + (it.pos[2] - w.a[1]) * w.dir[1];
}

function apply(world: WorldDoc, moves: readonly LayoutMove[]): WorldDoc {
  let w = world;
  for (const m of moves) {
    const e = m.edit as { ref: string; wall?: string; t?: number; gap?: number; on?: string; offset?: [number, number] };
    w = applyEdit(w, moveItem(w, undefined, e.ref, { ...(e.wall ? { wall: e.wall as 'north' } : {}), ...(e.t !== undefined ? { t: e.t } : {}), ...(e.gap !== undefined ? { gap: e.gap } : {}), ...(e.on ? { on: e.on } : {}), ...(e.offset ? { offset: e.offset } : {}) }));
  }
  return w;
}

describe('layout fit', () => {
  const labels = ['bed', 'nightstand', 'armchair', 'side-table', 'tv-cabinet', 'picture-left', 'picture-right', 'floor-lamp', 'bedside-lamp', 'tv'];

  it('brings a side table and a TV cabinet that stand off back to where their boxes say, and the TV with its cabinet', async () => {
    const truth = await room();
    const targets = truthTargets(truth, labels);
    expect(targets.length).toBeGreaterThanOrEqual(6);
    const chairT = tOf(truth, 'side-table');
    const tvT = tOf(truth, 'tv-cabinet');
    let off = applyEdit(truth, moveItem(truth, undefined, 'side-table', { wall: 'west', t: chairT - 0.4, gap: 0.02 }));
    off = applyEdit(off, moveItem(off, undefined, 'tv-cabinet', { wall: 'west', t: tvT + 0.5, gap: 0.02 }));
    off = applyEdit(off, moveItem(off, undefined, 'tv', { on: 'tv-cabinet', offset: [0, 0] }));
    const fit = fitLayout(off, d, 1.5, targets);
    expect(fit).not.toBeNull();
    const chair = fit!.moves.find((m) => m.id === 'side-table');
    expect(chair).toBeDefined();
    expect(Math.abs(chair!.shift - 0.4)).toBeLessThan(0.15);
    expect(chair!.after!).toBeLessThan(chair!.before! - 0.05);
    expect(fit!.after).toBeLessThan(fit!.before);
    const fixed = apply(off, fit!.moves);
    expect(Math.abs(tOf(fixed, 'side-table') - chairT)).toBeLessThan(0.15);
    expect(Math.abs(tOf(fixed, 'tv-cabinet') - tvT)).toBeLessThan(0.15);
    // The TV rides with its cabinet: moved with it, still standing on it.
    const scene = readScene(fixed, PHOTO_BUILDING_ID)!;
    const tv = scene.items.find((i) => i.id.endsWith('-tv'))!;
    const stand = scene.items.find((i) => i.id.endsWith('-tv-cabinet'))!;
    expect(Math.hypot(tv.pos[0] - stand.pos[0], tv.pos[2] - stand.pos[2])).toBeLessThan(0.3);
    expect(tv.y0).toBeCloseTo(stand.y1, 2);
  });

  it('leaves a room that already matches its boxes alone, and is deterministic', async () => {
    const truth = await room();
    const targets = truthTargets(truth, labels);
    const fit = fitLayout(truth, d, 1.5, targets);
    expect(fit?.moves).toEqual([]);
    const again = fitLayout(truth, d, 1.5, targets);
    expect(again).toEqual(fit);
  });

  it('never moves a piece further than its limit, into its neighbour, or out of its wall', async () => {
    const truth = await room();
    const targets = truthTargets(truth, labels);
    // Over a metre off is beyond the limit: it is brought closer by at most 0.7 m (or left), never further.
    const chairT = tOf(truth, 'side-table');
    const off = applyEdit(truth, moveItem(truth, undefined, 'side-table', { wall: 'west', t: chairT - 0.6, gap: 0.02 }));
    const fit = fitLayout(off, d, 1.5, targets);
    for (const m of fit?.moves ?? []) expect(Math.abs(m.shift)).toBeLessThanOrEqual(0.7 + 1e-9);
    const fixed = apply(off, fit?.moves ?? []);
    expect(reviewErrors(fixed)).toEqual([]);
  });

  it('needs enough boxes to mean anything', async () => {
    const truth = await room();
    expect(fitLayout(truth, d, 1.5, truthTargets(truth, ['bed', 'nightstand']))).toBeNull();
  });
});

import { reviewFindings } from '../src/index';
function reviewErrors(world: WorldDoc): string[] {
  return reviewFindings(world, PHOTO_BUILDING_ID).filter((f) => f.severity === 'error').map((f) => f.message);
}
