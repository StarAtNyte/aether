/**
 * Grounding against what is drawn: a hill with no physics body still holds up the shrine on it, a visible slab
 * without a collider is a surface, and a collider that does not follow its mesh (a box round a round hill) does
 * not hide an object hovering over the drawn flank.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { EntityInput, WorldDoc } from '@aether/core';
import { initPhysics, PhysicsWorld } from '@aether/physics';
import { groundingOf, measureGrounding, reviewLevel, runLevelTool, surfaceWorld } from '../src';
import { coin, gameWorld, goalAt, winAt } from './helpers';

beforeAll(async () => {
  await initPhysics();
});

/** A round hill: a ball of radius 10 whose top is at y = 6 above x = 20, with the given physics. */
function hill(physics?: EntityInput['physics']): EntityInput {
  return { id: 'hill', name: 'Hill', shape: { kind: 'primitive', primitive: 'sphere', size: [20, 20, 20] }, transform: { position: [20, -4, 0] }, ...(physics ? { physics } : {}) };
}

/** A stone lantern (a solid box 1 m tall) with its bottom at `y`. */
function lantern(x: number, y: number, z = 0): EntityInput {
  return { id: 'stone-lantern', name: 'Stone lantern', shape: { kind: 'primitive', primitive: 'box', size: [0.8, 1, 0.8] }, transform: { position: [x, y + 0.5, z] }, physics: { body: 'static' } };
}

function level(extra: EntityInput[]): WorldDoc {
  return gameWorld([coin('c1', [3, 1, 0]), goalAt('exit', [-6, 1, 0]), ...extra], { rules: [winAt(1)], state: { score: 0 } }, [0, 0.5, 0]);
}

async function collidersOnly(world: WorldDoc): Promise<string[]> {
  const pw = await PhysicsWorld.create(world, { fixedDt: 1 / 60 });
  try {
    return measureGrounding(world, pw).floating.map((f) => f.id);
  } finally {
    pw.dispose();
  }
}

describe('grounding on drawn surfaces', () => {
  it('a hill with no physics body holds up what rests on its top', async () => {
    const world = level([hill(), lantern(20, 6)]);
    // Against colliders only, the lantern seems to hover 6 m over the ground plane.
    expect(await collidersOnly(world)).toContain('stone-lantern');
    const r = await groundingOf(world);
    expect(r.floating.map((f) => f.id)).not.toContain('stone-lantern');
    // The level review agrees (no floating finding for it).
    const review = await reviewLevel(world);
    expect(review.findings.some((f) => f.code === 'floating' && f.entities.includes('stone-lantern'))).toBe(false);
    // And so does query_level grounding.
    const q = await runLevelTool(world, 'query_level', { op: 'grounding' });
    expect(q.text).not.toMatch(/stone-lantern\) hovers/);
  });

  it('a lantern above a body-less hill is still reported, with the gap to the drawn surface', async () => {
    const world = level([hill(), lantern(20, 8)]);
    const f = (await groundingOf(world)).floating.find((x) => x.id === 'stone-lantern');
    expect(f).toBeDefined();
    expect(f?.gap).toBeGreaterThan(1.8);
    expect(f?.gap).toBeLessThan(2.2);
    expect(f?.over).toBe('hill');
  });

  it('a visible slab without a collider is a surface', async () => {
    const slab: EntityInput = { id: 'deck', name: 'Deck', shape: { kind: 'primitive', primitive: 'box', size: [4, 0.4, 4] }, transform: { position: [8, 1.8, 6] }, physics: { body: 'static', collider: 'none' } };
    const world = level([slab, lantern(8, 2, 6)]);
    expect((await groundingOf(world)).floating.map((x) => x.id)).not.toContain('stone-lantern');
  });

  it('a collider that does not follow its mesh does not hide hovering over the drawn flank', async () => {
    // A box collider round the round hill: its flat top at y = 6 reaches out over the flank at x = 27, where the
    // drawn surface is about 2.9 m lower. The lantern rests on the invisible box top, so it hovers in the picture.
    const world = level([hill({ body: 'static', collider: 'box' }), lantern(27, 6)]);
    expect(await collidersOnly(world)).not.toContain('stone-lantern');
    const f = (await groundingOf(world)).floating.find((x) => x.id === 'stone-lantern');
    expect(f).toBeDefined();
    expect(f?.gap).toBeGreaterThan(1);
  });

  it('the drawn world gives visible shapes static bodies and leaves zones, pickups and lights alone', () => {
    const world = level([hill(), lantern(20, 6), { id: 'lamp', shape: { kind: 'none' }, light: { type: 'point', color: '#ffffff', intensity: 2, range: 8 } }]);
    const drawn = surfaceWorld(world);
    expect(drawn.entities['hill']?.physics?.body).toBe('static');
    expect(drawn.entities['c1']?.physics).toEqual(world.entities['c1']?.physics);
    expect(drawn.entities['exit']).toBe(world.entities['exit']);
    expect(drawn.entities['lamp']).toBe(world.entities['lamp']);
    // The document itself is untouched.
    expect(world.entities['hill']?.physics).toBeUndefined();
  });
});
