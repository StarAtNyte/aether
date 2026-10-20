/**
 * Grounding: objects that should rest on the terrain are measured against the real surface under them, not the
 * box of whatever is below. A shrine set above the flank of a hill is reported with the gap; lanterns tagged
 * floating, pickups and goals are left alone; moving the shrine with place_level_items snaps it onto the hill.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyPatches, type EntityInput, type WorldDoc } from '@aether/core';
import { initPhysics, PhysicsWorld } from '@aether/physics';
import { measureGrounding, reviewLevel, runLevelTool } from '../src';
import { coin, gameWorld, goalAt, winAt } from './helpers';

beforeAll(async () => {
  await initPhysics();
});

/** A round hill: a static ball of radius 10 whose top is at y = 6 above x = 20. */
const HILL: EntityInput = { id: 'hill', name: 'Hill', shape: { kind: 'primitive', primitive: 'sphere', size: [20, 20, 20] }, transform: { position: [20, -4, 0] }, physics: { body: 'static' } };

/** A torii: a plain group of two posts and a beam, its bottom at `y`. */
function shrine(x: number, y: number): EntityInput[] {
  return [
    { id: 'shrine', name: 'Torii shrine', shape: { kind: 'none' }, transform: { position: [x, y, 0] } },
    { id: 'post-l', parent: 'shrine', shape: { kind: 'primitive', primitive: 'box', size: [0.3, 3, 0.3] }, transform: { position: [-1, 1.5, 0] }, physics: { body: 'static' } },
    { id: 'post-r', parent: 'shrine', shape: { kind: 'primitive', primitive: 'box', size: [0.3, 3, 0.3] }, transform: { position: [1, 1.5, 0] }, physics: { body: 'static' } },
    { id: 'beam', parent: 'shrine', shape: { kind: 'primitive', primitive: 'box', size: [3, 0.3, 0.4] }, transform: { position: [0, 3.1, 0] }, physics: { body: 'static' } },
  ];
}

function level(extra: EntityInput[]): WorldDoc {
  return gameWorld([HILL, coin('c1', [3, 1, 0]), goalAt('exit', [-6, 1, 0]), ...extra], { rules: [winAt(1)], state: { score: 0 } }, [0, 0.5, 0]);
}

async function floating(world: WorldDoc): Promise<string[]> {
  const pw = await PhysicsWorld.create(world, { fixedDt: 1 / 60 });
  try {
    return measureGrounding(world, pw).floating.map((f) => f.id);
  } finally {
    pw.dispose();
  }
}

describe('grounding', () => {
  it('measures the gap to the hill surface under the object, not to the top of the hill box', async () => {
    // Above the flank (x = 26) at the height of the hill top: the surface there is about 1.5 m lower.
    const world = level(shrine(26, 6));
    const pw = await PhysicsWorld.create(world, { fixedDt: 1 / 60 });
    try {
      const r = measureGrounding(world, pw);
      const f = r.floating.find((x) => x.id === 'shrine');
      expect(f).toBeDefined();
      expect(f?.over).toBe('hill');
      expect(f?.gap).toBeGreaterThan(1);
      expect(f?.gap).toBeLessThan(2);
      // The posts are parts of the shrine, not objects of their own.
      expect(r.floating.map((x) => x.id)).toEqual(['shrine']);
    } finally {
      pw.dispose();
    }
  });

  it('leaves alone what rests, what is meant to hover and what is a trigger', async () => {
    const lantern: EntityInput = { id: 'lantern', shape: { kind: 'primitive', primitive: 'sphere', size: [0.4, 0.4, 0.4] }, transform: { position: [2, 3, 5] }, tags: ['floating'] };
    const crate: EntityInput = { id: 'crate', shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] }, transform: { position: [5, 0.5, 5] }, physics: { body: 'static' } };
    const onTop = shrine(20, 6);
    expect(await floating(level([lantern, crate, ...onTop]))).toEqual([]);
  });

  it('is a review finding with the numbers and a fix, and query_level grounding lists it', async () => {
    const world = level(shrine(26, 6));
    const r = await reviewLevel(world);
    const f = r.findings.find((x) => x.code === 'floating');
    expect(f?.severity).toBe('error');
    expect(f?.entities).toEqual(['shrine']);
    expect(f?.message).toMatch(/Torii shrine \(shrine\) hovers 1\.\d\d m above Hill \(hill\): its bottom is at y=6/);
    expect(f?.fix).toMatch(/place_level_items \{"id":"shrine","x":26,"z":0\}/);
    const q = await runLevelTool(world, 'query_level', { op: 'grounding' });
    expect(q.text).toMatch(/1 of \d+ object\(s\) hover/);
    expect(q.text).toContain('shrine');
  }, 60_000);

  it('moving an object with place_level_items puts its bottom on the surface (not on its own old self)', async () => {
    const world = level(shrine(20, 9));
    expect(await floating(world)).toEqual(['shrine']);
    const res = await runLevelTool(world, 'place_level_items', { items: [{ id: 'shrine', x: 20, z: 0 }] });
    expect(res.refused).toBe(0);
    const after = applyPatches(world, res.patches).world;
    expect(after.entities['shrine']?.transform.position[1]).toBeCloseTo(6, 1);
    expect(await floating(after)).toEqual([]);
  });
});
