/**
 * The level tools: the assistant chooses where, the code measures the ground,
 * the clearance, the sight lines and what the player can reach.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyPatches, type Patch, type WorldDoc } from '@aether/core';
import { initPhysics } from '@aether/physics';
import { isLevelTool, runLevelTool } from '../src';
import { gameWorld, pickup, slab, winAt } from './helpers';

beforeAll(async () => {
  await initPhysics();
});

/** A floor at y=0 (top), a 3 m wall, and an island 20 m up the +x axis that no jump can reach. */
function level(): WorldDoc {
  return gameWorld(
    [
      slab('floor', [0, -0.25, 0], [30, 0.5, 20]),
      slab('wall', [5, 1.5, 0], [0.5, 3, 8], { name: 'Old wall' }),
      slab('island', [60, 4.75, 0], [10, 0.5, 10], { name: 'Far island' }),
      pickup('p-start', [-4, 1, 0], 'score'),
    ],
    { state: { score: 0 }, rules: [winAt(1)] },
    [0, 0.5, 0],
  );
}

const ent = (shape: object): Record<string, unknown> => ({ shape });
const orb = ent({ kind: 'primitive', primitive: 'sphere', size: [0.5, 0.5, 0.5] });

describe('query_level', () => {
  it('knows the level tools by name', () => {
    expect(isLevelTool('query_level')).toBe(true);
    expect(isLevelTool('place_level_items')).toBe(true);
    expect(isLevelTool('place_items')).toBe(false);
  });

  it('measures ground height, slope and open air', async () => {
    const r = await runLevelTool(level(), 'query_level', { op: 'ground', points: [{ x: 0, z: 5 }, { x: 5, z: 0 }, { x: 60, z: 0 }, { x: 200, z: 200 }] });
    expect(r.ok).toBe(true);
    expect(r.text).toContain('(0, 5): top surface y=0');
    expect(r.text).toContain('Old wall');
    expect(r.text).toContain('y=3');
    expect(r.text).toContain('Far island');
    expect(r.text).toMatch(/\(200, 200\): top surface y=0 on the ground|open air/);
  });

  it('measures clearance next to a wall and headroom', async () => {
    const r = await runLevelTool(level(), 'query_level', { op: 'clearance', x: 4.3, z: 0 });
    expect(r.text).toContain('Old wall');
    expect(r.text).toMatch(/free radius 0\.[0-9] m/);
    const open = await runLevelTool(level(), 'query_level', { op: 'clearance', x: -10, z: 5, radius: 0.5, height: 2 });
    expect(open.text).toContain('fits');
    expect(open.text).not.toContain('does NOT fit');
  });

  it('says what blocks a line of sight', async () => {
    const blocked = await runLevelTool(level(), 'query_level', { op: 'sightline', from: [0, 1.5, 0], to: [10, 1.5, 0] });
    expect(blocked.text).toContain('Blocked by Old wall');
    const clear = await runLevelTool(level(), 'query_level', { op: 'sightline', from: [0, 1.5, 6], to: [10, 1.5, 6] });
    expect(clear.text).toContain('Clear');
  });

  it('reports which points the player can reach and why not', async () => {
    const r = await runLevelTool(level(), 'query_level', { op: 'reach', points: [{ x: -8, z: 3 }, { x: 60, z: 0 }] });
    expect(r.text).toContain('CAN get there');
    expect(r.text).toContain('NOT reachable');
    expect(r.text).toContain('too high');
  }, 60_000);

  it('lists every objective with its reach, and summarises the level', async () => {
    const w = level();
    const far = await runLevelTool(w, 'place_level_items', { items: [{ id: 'p-far', role: 'pickup', x: 60, z: 0, reach: false, entity: orb }] });
    const world = applyPatches(w, far.patches).world;
    const o = await runLevelTool(world, 'query_level', { op: 'objectives' });
    expect(o.text).toContain('objectives, 1 reachable');
    expect(o.text).toContain('p-far');
    const s = await runLevelTool(world, 'query_level', { op: 'summary' });
    expect(s.text).toContain('Player: thirdPerson');
    expect(s.text).toContain('Win: defined');
    expect(s.text).toContain('NOT reachable');
  }, 90_000);

  it('refuses malformed input without throwing', async () => {
    expect((await runLevelTool(level(), 'query_level', { op: 'nope' })).ok).toBe(false);
    expect((await runLevelTool(level(), 'query_level', { op: 'ground', points: [] })).ok).toBe(false);
    expect((await runLevelTool(level(), 'query_level', { op: 'ground', points: [{ x: 1e9, z: 0 }] })).ok).toBe(false);
  });
});

describe('place_level_items', () => {
  it('snaps pickups to the ground, adds the pickup behaviour and commits as patches', async () => {
    const w = level();
    const r = await runLevelTool(w, 'place_level_items', { items: [{ id: 'orb-1', role: 'pickup', x: -8, z: 4, entity: { ...orb, name: 'Orb' } }, { id: 'orb-2', role: 'pickup', x: 5, z: 5, above: 1.2, entity: orb }] });
    expect(r.accepted).toBe(2);
    expect(r.refused).toBe(0);
    const out = applyPatches(w, r.patches);
    expect(out.errors).toEqual([]);
    const a = out.world.entities['orb-1'];
    expect(a?.transform.position).toEqual([-8, 1.05, 4]);
    expect(a?.behaviors.some((b) => b.type === 'collectible')).toBe(true);
    expect(a?.physics?.sensor).toBe(true);
    expect(out.world.entities['orb-2']?.transform.position[1]).toBeCloseTo(1.45, 1);
  }, 60_000);

  it('refuses what cannot be reached, with the gap, and keeps the rest', async () => {
    const w = level();
    const r = await runLevelTool(w, 'place_level_items', { items: [{ id: 'ok', role: 'pickup', x: -8, z: 4, entity: orb }, { id: 'far', role: 'pickup', x: 60, z: 0, entity: orb }] });
    expect(r.accepted).toBe(1);
    expect(r.refused).toBe(1);
    expect(r.text).toContain('far: the player cannot get to');
    expect(r.text).toContain('too high');
    expect(r.patches).toHaveLength(1);
    expect(applyPatches(w, r.patches).world.entities['far']).toBeUndefined();
  }, 60_000);

  it('does not check reach for scenery, and refuses open air and buried spots', async () => {
    const w = level();
    const r = await runLevelTool(w, 'place_level_items', {
      items: [
        { id: 'rock', role: 'prop', x: 60, z: 2, entity: ent({ kind: 'primitive', primitive: 'box', size: [1, 1, 1] }) },
        { id: 'void', role: 'decor', x: 400, z: 0, below: -10, entity: orb },
        { id: 'inside', role: 'pickup', x: 5, z: 0, above: -1.4, reach: false, entity: orb },
      ],
    });
    expect(r.accepted).toBe(1);
    expect(r.text).toContain('void: nothing under');
    expect(r.text).toContain('inside: its spot');
    expect(r.text).toContain('Old wall');
    expect(r.patches.map((p: Patch) => (p.op === 'add' ? p.entity.id : ''))).toEqual(['rock']);
  }, 60_000);

  it('moves an existing item without an entity and keeps what it is', async () => {
    const w = level();
    const r = await runLevelTool(w, 'place_level_items', { items: [{ id: 'p-start', role: 'pickup', x: -9, z: -3 }] });
    expect(r.accepted).toBe(1);
    const moved = applyPatches(w, r.patches).world.entities['p-start'];
    expect(moved?.transform.position[0]).toBe(-9);
    expect(moved?.transform.position[2]).toBe(-3);
    expect(moved?.behaviors.some((b) => b.type === 'collectible')).toBe(true);
  }, 60_000);

  it('rejects duplicate ids, existing ids with an entity, and missing shapes', async () => {
    const r = await runLevelTool(level(), 'place_level_items', {
      items: [
        { id: 'a', x: 0, z: 0, entity: orb },
        { id: 'a', x: 1, z: 0, entity: orb },
        { id: 'p-start', x: 2, z: 0, entity: orb },
        { id: 'ghost', x: 3, z: 0 },
      ],
    });
    expect(r.accepted).toBe(1);
    expect(r.refused).toBe(3);
    expect(r.text).toContain('used twice');
    expect(r.text).toContain('already exists');
    expect(r.text).toContain('nothing to place');
  }, 60_000);

  it('caps the batch and survives hostile entities', async () => {
    const many = Array.from({ length: 41 }, (_, i) => ({ id: `i${i}`, x: 0, z: 0, entity: orb }));
    expect((await runLevelTool(level(), 'place_level_items', { items: many })).ok).toBe(false);
    const hostile = await runLevelTool(level(), 'place_level_items', { items: [{ id: 'h', role: 'prop', x: 0, z: 0, entity: { shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] }, __proto__: { polluted: true }, behaviors: [{ type: 'x'.repeat(5000) }] } }] });
    expect(hostile.accepted).toBe(0);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  }, 60_000);
});
