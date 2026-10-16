/**
 * Outdoor flagships: the draped trail mesh, the canoe with its seated paddler, and the two scenes that became walks
 * (Four-Seasons Garden, Painterly Meadow): player, people, stops and a gated goal.
 */
import { applyPatches, createWorld, decodeMesh, validateWorld, type Entity, type WorldDoc } from '@aether/core';
import { describe, expect, it } from 'vitest';
import { Builder } from '../src/providers/mock/builder';
import { FLAGSHIPS } from '../src/providers/mock/showcase/index';
import { groundRibbon, loopPoints } from '../src/providers/mock/showcase/kit';
import { trackMeshes, trackSamples } from '../src/providers/mock/showcase/track';
import { chunkPatches } from '../src/providers/mock/index';

function build(id: string): WorldDoc {
  const f = FLAGSHIPS.find((x) => x.id === id);
  if (!f) throw new Error(`no flagship ${id}`);
  const r = applyPatches(createWorld(), f.plan().patches);
  expect(r.errors.map((e) => e.message)).toEqual([]);
  return r.world;
}

const all = (w: WorldDoc): Entity[] => Object.values(w.entities);

describe('groundRibbon', () => {
  const height = (x: number, z: number): number => 0.1 * x + 0.05 * z + 0.8 * Math.sin(x * 0.2);
  const make = (): { world: WorldDoc; builder: Builder } => {
    const builder = new Builder(7, [], { night: false, dusk: false, dawn: false, rain: false, snow: false, fog: false, lowGravity: false, water: false });
    groundRibbon(builder, { id: 'trail', paths: [[[0, 0], [20, 5], [40, 30]], [[50, 30], [60, 40]]], height, width: 2, lift: 0.05 });
    const r = applyPatches(createWorld(), builder.build());
    expect(r.errors.map((e) => e.message)).toEqual([]);
    return { world: r.world, builder };
  };

  it('puts the mesh asset before the entity that uses it, and the world validates', () => {
    const { world, builder } = make();
    const ops = builder.build().map((p) => p.op);
    expect(ops.indexOf('setMesh')).toBeLessThan(ops.indexOf('add'));
    expect(validateWorld(world).ok).toBe(true);
    expect(world.entities['trail']?.shape).toEqual({ kind: 'mesh', mesh: 'trail-mesh' });
  });

  it('drapes over the ground: every cross-section sample sits a hand above the terrain under it', () => {
    const { world } = make();
    const data = decodeMesh(world.meshes['trail-mesh'] as NonNullable<WorldDoc['meshes'][string]>);
    expect(data.positions.length / 3).toBeGreaterThan(100);
    for (let i = 0; i < data.positions.length; i += 3) {
      const x = data.positions[i] as number;
      const y = data.positions[i + 1] as number;
      const z = data.positions[i + 2] as number;
      const above = y - height(x, z);
      expect(above, `vertex ${i / 3}`).toBeGreaterThan(0.0);
      expect(above).toBeLessThan(0.08);
    }
  });

  it('faces up (counter-clockwise from above), indexes only its own vertices, has colours and UVs and no physics', () => {
    const { world } = make();
    const data = decodeMesh(world.meshes['trail-mesh'] as NonNullable<WorldDoc['meshes'][string]>);
    const nv = data.positions.length / 3;
    let up = 0;
    for (let t = 0; t < data.indices.length; t += 3) {
      const [a, b, c] = [data.indices[t] as number, data.indices[t + 1] as number, data.indices[t + 2] as number];
      expect(Math.max(a, b, c)).toBeLessThan(nv);
      const p = data.positions;
      const e1 = [(p[b * 3] as number) - (p[a * 3] as number), (p[b * 3 + 1] as number) - (p[a * 3 + 1] as number), (p[b * 3 + 2] as number) - (p[a * 3 + 2] as number)];
      const e2 = [(p[c * 3] as number) - (p[a * 3] as number), (p[c * 3 + 1] as number) - (p[a * 3 + 1] as number), (p[c * 3 + 2] as number) - (p[a * 3 + 2] as number)];
      const ny = (e1[2] as number) * (e2[0] as number) - (e1[0] as number) * (e2[2] as number);
      if (ny > 0) up++;
    }
    expect(up / (data.indices.length / 3)).toBeGreaterThan(0.99);
    expect(data.colors).not.toBeNull();
    expect(data.uvs).not.toBeNull();
    expect(world.entities['trail']?.physics).toBeUndefined();
  });

  it('keeps the two strips apart (a gap such as a bridge is not bridged by a stray triangle)', () => {
    const { world } = make();
    const data = decodeMesh(world.meshes['trail-mesh'] as NonNullable<WorldDoc['meshes'][string]>);
    for (let t = 0; t < data.indices.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = data.indices[t + k] as number;
        const c = data.indices[t + ((k + 1) % 3)] as number;
        const d = Math.hypot((data.positions[a * 3] as number) - (data.positions[c * 3] as number), (data.positions[a * 3 + 2] as number) - (data.positions[c * 3 + 2] as number));
        expect(d).toBeLessThan(4);
      }
    }
  });
});

describe('Highland Trail trail', () => {
  const world = build('highland-trail');

  it('is one draped mesh, not a row of pitched boxes', () => {
    expect(world.entities['trail']?.shape.kind).toBe('mesh');
    expect(all(world).filter((e) => e.id.startsWith('trail-') && e.shape.kind === 'primitive')).toEqual([]);
  });

  it('starts at ground level on a gentle floodplain: camp, spawn and stakes are on walkable ground', () => {
    const p = world.player.spawn;
    expect(p[1]).toBeGreaterThan(-1);
    expect(p[1]).toBeLessThan(6);
    for (const e of all(world).filter((x) => x.tags.includes('stake'))) expect(e.transform.position[1]).toBeGreaterThan(0.5);
  });

  it('the hiker carries a backpack (both hands free)', () => {
    expect(world.player.character?.hold).toBe('backpack');
  });

  it('two walkers stroll the trail between the first two stakes on measured ground', () => {
    const walkers = all(world).filter((e) => e.tags.includes('walker'));
    expect(walkers).toHaveLength(2);
    const stake1 = world.entities['stake-1']?.transform.position;
    const stake2 = world.entities['stake-2']?.transform.position;
    expect(stake1 && stake2).toBeTruthy();
    for (const w of walkers) {
      expect(w.character?.hold).toBe('backpack');
      const patrol = w.behaviors.find((b) => b.type === 'patrol');
      const pts = patrol?.params['waypoints'] as number[][];
      expect(pts.length).toBeGreaterThanOrEqual(8);
      for (const p of pts) {
        // Between the stakes in z (the first is south of the second), a person's height above the ground, not below the valley floor.
        expect(p[2]).toBeLessThan((stake1 as number[])[2]! + 3);
        expect(p[2]).toBeGreaterThan((stake2 as number[])[2]! - 3);
        expect(p[1]).toBeGreaterThan(0.9);
      }
    }
  });
});

describe('Sakura River canoe', () => {
  const world = build('sakura-river');
  const canoe = world.entities['canoe-1'];

  it('is a procedural canoe hull riding the water, not a library toy', () => {
    expect(canoe?.shape).toMatchObject({ kind: 'procedural', generator: 'boat', params: { variant: 3 } });
    expect(canoe?.physics?.gravityScale).toBe(0);
    // The keel is a hand below the 0.38 m water surface.
    expect(canoe?.transform.position[1]).toBeGreaterThan(0.2);
    expect(canoe?.transform.position[1]).toBeLessThan(0.38);
    expect(canoe?.behaviors.some((b) => b.type === 'vehicle')).toBe(true);
  });

  it('carries a seated paddler with a paddle who needs no collider of their own', () => {
    const paddler = all(world).find((e) => e.parent === 'canoe-1' && e.character);
    expect(paddler?.character?.pose).toBe('sit');
    expect(paddler?.character?.hold).toBe('paddle');
    expect(paddler?.physics).toBeUndefined();
  });
});

describe('Four-Seasons Garden walk', () => {
  const world = build('four-seasons-garden');

  it('is a walk: third-person player at the gate, people to meet, four quarters to stand in', () => {
    expect(world.player.mode).toBe('thirdPerson');
    expect(all(world).filter((e) => e.tags.includes('npc')).length).toBeGreaterThanOrEqual(4);
    expect(all(world).filter((e) => e.tags.includes('quarter-zone'))).toHaveLength(4);
    expect(world.rules.filter((r) => r.id.startsWith('quarter-'))).toHaveLength(4);
  });

  it('opens the tea house (a goal that starts switched off) only once all four are seen', () => {
    const goal = world.entities['tea-goal-1'];
    expect(goal?.behaviors.find((b) => b.type === 'goal')?.enabled).toBe(false);
    const open = world.rules.find((r) => r.id === 'tea-ready');
    expect(open?.when).toMatchObject({ on: 'state', key: 'quarters', value: 4 });
  });

  it('keeps the season keys', () => {
    for (const k of ['1', '2', '3', '4', '5']) expect(world.rules.some((r) => r.when.on === 'key' && r.when.key === k), k).toBe(true);
  });
});

describe('Painterly Meadow walk', () => {
  const world = build('painterly-meadow');

  it('is a walk from the station platform with people, three stops and the platform as a gated goal', () => {
    expect(world.player.mode).toBe('thirdPerson');
    expect(world.player.spawn[1]).toBeGreaterThan(0.9);
    expect(all(world).filter((e) => e.tags.includes('npc')).length).toBeGreaterThanOrEqual(4);
    expect(all(world).filter((e) => e.tags.includes('stop-zone'))).toHaveLength(3);
    const goal = world.entities['platform-goal-1'];
    expect(goal?.behaviors.find((b) => b.type === 'goal')?.enabled).toBe(false);
  });

  it('uses realistic vegetation and modelled animals, not toy trees', () => {
    const trees = all(world).filter((e) => e.tags.includes('tree'));
    expect(trees.length).toBeGreaterThan(10);
    for (const t of trees) expect(t.shape).toMatchObject({ kind: 'procedural' });
    for (const t of trees) expect((t.shape as { generator: string }).generator).not.toBe('tree-oak');
    expect(all(world).filter((e) => e.tags.includes('life') && e.tags.includes('sheep')).length).toBeGreaterThanOrEqual(8);
  });

  it('keeps the whistle, now on F because Space jumps', () => {
    expect(world.rules.some((r) => r.when.on === 'key' && r.when.key === 'f')).toBe(true);
  });
});

describe('Lantern Isles cloud sea', () => {
  it('has two layers of clouds: stratus floor and cumulus banks', () => {
    const world = build('lantern-isles');
    expect(all(world).filter((e) => e.id.startsWith('cloud-sea')).length).toBeGreaterThanOrEqual(20);
    expect(all(world).filter((e) => e.id.startsWith('cloud-bank')).length).toBeGreaterThanOrEqual(10);
  });
});

describe('railTrack meshes', () => {
  const loop = loopPoints(0, 0, 46, 30, 64, 0.04).map((p) => [p[0], p[2]] as const);
  const { bed, rails } = trackMeshes({ id: 'line', loop });

  it('has real sections: tens of thousands of triangles of bed, sleepers and two rails, indexed in range', () => {
    expect(bed.indices.length / 3).toBeGreaterThan(5000);
    expect(rails.indices.length / 3).toBeGreaterThan(3000);
    for (const m of [bed, rails]) {
      const nv = m.positions.length / 3;
      for (let i = 0; i < m.indices.length; i++) expect(m.indices[i] as number).toBeLessThan(nv);
      expect(m.colors?.length).toBe(m.positions.length);
    }
    expect(bed.positions.length / 3).toBeLessThan(65_536);
    expect(rails.positions.length / 3).toBeLessThan(65_536);
  });

  it('keeps the rails one gauge apart along the whole loop and the rail top above the sleepers', () => {
    const samples = trackSamples(loop);
    // The rail mesh stores 4 vertices per sample per rail, the first rail then the second.
    const n = samples.length;
    for (let i = 0; i < n; i += 37) {
      const a = [rails.positions[(i * 4 + 2) * 3] as number, rails.positions[(i * 4 + 2) * 3 + 2] as number];
      const b = [rails.positions[((n + i) * 4 + 2) * 3] as number, rails.positions[((n + i) * 4 + 2) * 3 + 2] as number];
      expect(Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!)).toBeCloseTo(1.435, 2);
      expect(rails.positions[(i * 4 + 2) * 3 + 1] as number).toBeCloseTo(0.39, 3);
    }
  });

  it('most triangles face up or sideways, none are degenerate', () => {
    let degenerate = 0;
    for (let t = 0; t < bed.indices.length; t += 3) {
      const [a, b, c] = [bed.indices[t] as number, bed.indices[t + 1] as number, bed.indices[t + 2] as number];
      const p = bed.positions;
      const e1 = [(p[b * 3] as number) - (p[a * 3] as number), (p[b * 3 + 1] as number) - (p[a * 3 + 1] as number), (p[b * 3 + 2] as number) - (p[a * 3 + 2] as number)];
      const e2 = [(p[c * 3] as number) - (p[a * 3] as number), (p[c * 3 + 1] as number) - (p[a * 3 + 1] as number), (p[c * 3 + 2] as number) - (p[a * 3 + 2] as number)];
      const nx = (e1[1] as number) * (e2[2] as number) - (e1[2] as number) * (e2[1] as number);
      const ny = (e1[2] as number) * (e2[0] as number) - (e1[0] as number) * (e2[2] as number);
      const nz = (e1[0] as number) * (e2[1] as number) - (e1[1] as number) * (e2[0] as number);
      if (Math.hypot(nx, ny, nz) < 1e-9) degenerate++;
    }
    expect(degenerate).toBe(0);
  });
});

describe('mock provider patch chunking', () => {
  it('keeps every call under the tool size limit (large mesh assets) and under the patch count, in order', () => {
    const big = (i: number): { op: string; i: number; blob: string } => ({ op: 'setMesh', i, blob: 'A'.repeat(200_000) });
    const small = (i: number): { op: string; i: number } => ({ op: 'add', i });
    const patches = [big(0), small(1), big(2), big(3), ...Array.from({ length: 900 }, (_, i) => small(4 + i))];
    const chunks = chunkPatches(patches);
    expect(chunks.flat().map((p) => p.i)).toEqual(patches.map((p) => p.i));
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(400);
      expect(JSON.stringify(c).length).toBeLessThan(450_000);
    }
    expect(chunks.length).toBeGreaterThan(3);
  });

  it('one chunk for a small plan', () => {
    expect(chunkPatches([{ op: 'add' }, { op: 'add' }])).toHaveLength(1);
    expect(chunkPatches([])).toEqual([]);
  });
});
