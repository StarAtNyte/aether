import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createWorld, findStandIns, validateWorld, type EntityInput, type WorldDoc } from '../src/index';

function world(entities: EntityInput[], voxel = false): WorldDoc {
  const w = createWorld({ entities: Object.fromEntries(entities.map((e) => [e.id, e])) });
  return voxel ? ({ ...w, voxel: { seed: 1 } } as unknown as WorldDoc) : w;
}
const capsule = (id: string, extra: Partial<EntityInput> = {}): EntityInput => ({ id, shape: { kind: 'primitive', primitive: 'capsule', size: [0.6, 1.7, 0.6] }, ...extra });

describe('stand-in lint', () => {
  it('flags a bare capsule villager, ghost and enemy', () => {
    const w = world([capsule('villager-1', { tags: ['npc'] }), capsule('ghost-1'), capsule('enemy-1')]);
    expect(findStandIns(w).map((s) => `${s.id}:${s.kind}`).sort()).toEqual(['enemy-1:person', 'ghost-1:person', 'villager-1:person']);
  });

  it('accepts a capsule that carries a character (the capsule is only the collider)', () => {
    expect(findStandIns(world([capsule('villager-1', { character: { wardrobe: 'villager' } })]))).toEqual([]);
  });

  it('flags block mini-figures and cube pets, and bare boxes for vehicles', () => {
    const w = world([
      { id: 'fan-1', shape: { kind: 'asset', id: 'man-b' } },
      { id: 'cat-1', tags: ['animal'], shape: { kind: 'asset', id: 'bunny' } },
      { id: 'car-1', behaviors: [{ type: 'vehicle', params: {} }], shape: { kind: 'primitive', primitive: 'box', size: [2, 1, 4] } },
    ]);
    expect(findStandIns(w).map((s) => s.kind).sort()).toEqual(['animal', 'person', 'vehicle']);
  });

  it('leaves modelled animals and vehicles, parts of a being, and block worlds alone', () => {
    const w = world([
      { id: 'wolf-1', npc: { archetype: 'predator' }, shape: { kind: 'asset', id: 'wolf' } },
      { id: 'taxi-1', shape: { kind: 'asset', id: 'taxi' } },
      capsule('guard-1', { character: { wardrobe: 'guard' } }),
      { id: 'guard-1-torch', parent: 'guard-1', shape: { kind: 'primitive', primitive: 'cylinder', size: [0.1, 0.5, 0.1] } },
      { id: 'neon-cat-1', shape: { kind: 'primitive', primitive: 'sphere', size: [0.9, 0.9, 0.9] } },
    ]);
    expect(findStandIns(w)).toEqual([]);
    expect(findStandIns(world([capsule('villager-1')], true))).toEqual([]);
  });

  it('flags a ball called bird or fish, but not a bird house, a fish tank or a big sculpture', () => {
    const ball = (id: string, size: number, extra: Partial<EntityInput> = {}): EntityInput => ({ id, shape: { kind: 'primitive', primitive: 'sphere', size: [size, size, size] }, ...extra });
    const w = world([ball('bird-1', 0.4), ball('fish-3', 0.5, { tags: ['fish'] }), ball('butterfly-2', 0.2), ball('bird-house', 0.6), ball('fish-tank', 1.0), ball('seagull-statue', 1.2), ball('hawk-big', 3)]);
    expect(findStandIns(w).map((s) => s.id).sort()).toEqual(['bird-1', 'butterfly-2', 'fish-3']);
  });

  it('lets the modelled replacements of the cube pets through', () => {
    const w = world(['cat', 'deer', 'fish', 'parrot', 'bird', 'hawk', 'koi', 'butterfly'].map((id) => ({ id: `${id}-1`, tags: ['animal'], shape: { kind: 'asset' as const, id } })));
    expect(findStandIns(w)).toEqual([]);
  });

  it('finds no stand-in in any bundled project', () => {
    const dir = new URL('../../../apps/studio/public/templates/worlds/', import.meta.url);
    const bad: string[] = [];
    for (const f of readdirSync(dir)) {
      const v = validateWorld((JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as { world: unknown }).world);
      if (!v.ok) continue;
      for (const s of findStandIns(v.world)) bad.push(`${f}:${s.id}`);
    }
    expect(bad).toEqual([]);
  });
});

describe('stand-in lint: parts named after vehicles', () => {
  it('a vehicle bay door or a car park is part of a building, not a vehicle', () => {
    const world = createWorld({ entities: {
      d: { id: 'd', name: 'Vehicle bay door', tags: ['door'], shape: { kind: 'primitive', primitive: 'box', size: [0.14, 3.4, 4.2] } },
      p: { id: 'p', name: 'Car park', shape: { kind: 'primitive', primitive: 'box', size: [20, 0.1, 30] } },
      c: { id: 'c', name: 'Car', shape: { kind: 'primitive', primitive: 'box', size: [1.8, 1.4, 4.2] } },
    } });
    expect(findStandIns(world).map((s) => s.id)).toEqual(['c']);
  });
});

describe('world skins', () => {
  it('accept finish keys, finish#colour and generator-scoped keys, and refuse anything else', () => {
    const ok = validateWorld({ ...createWorld(), skins: { plaster: { id: 'tex-0123456789ab' }, 'paint#ffffff': { id: 'tex-0123456789ab' }, 'paint@town-row3': { id: 'tex-0123456789ab' } } });
    expect(ok.ok).toBe(true);
    expect(validateWorld({ ...createWorld(), skins: { 'Bad Key': { id: 'tex-0123456789ab' } } }).ok).toBe(false);
  });
});
