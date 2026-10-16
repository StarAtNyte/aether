import { describe, expect, it } from 'vitest';
import { applyPatches, bodilessPeople, characterFor, characterPatches, createWorld, isBodylessPerson, type EntityInput } from '../src/index';

const capsule = (id: string, extra: Partial<EntityInput> = {}): EntityInput => ({
  id,
  shape: { kind: 'primitive', primitive: 'capsule', size: [0.5, 1.75, 0.5] },
  physics: { body: 'dynamic' },
  ...extra,
});

describe('people without a character', () => {
  it('recognises a person-shaped stand-in by its id, name, tags or NPC role', () => {
    const w = createWorld({
      entities: {
        'guard-1': capsule('guard-1'),
        a: capsule('a', { name: 'Old Villager' }),
        b: capsule('b', { tags: ['npc', 'shopkeeper'] }),
        'crate-1': { id: 'crate-1', shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] } },
        'guard-tower': capsule('guard-tower'),
        'stone-statue': capsule('stone-statue', { name: 'Statue of a guard' }),
        sensor: capsule('sensor', { name: 'Guard zone', physics: { body: 'static', sensor: true } }),
        tall: capsule('tall', { name: 'Villager', shape: { kind: 'primitive', primitive: 'capsule', size: [0.5, 9, 0.5] } }),
      },
    });
    expect(bodilessPeople(w).sort()).toEqual(['a', 'b', 'guard-1']);
  });

  it('treats a stylised library figure as a stand-in too, but not a dog or a modelled person', () => {
    const asset = (id: string, extra: Partial<EntityInput> = {}): EntityInput => ({ id, shape: { kind: 'asset', id: 'woman-b', fallback: { kind: 'primitive', primitive: 'capsule', size: [0.6, 1.7, 0.6] } }, ...extra });
    const w = createWorld({
      entities: {
        'fan-3': asset('fan-3', { tags: ['npc'] }),
        'wolf-1': asset('wolf-1', { shape: { kind: 'asset', id: 'dog' } }),
        'pedestrian-1': asset('pedestrian-1', { shape: { kind: 'asset', id: 'rocketbox-marcus' } }),
        'lamp-1': asset('lamp-1'),
      },
    });
    expect(bodilessPeople(w)).toEqual(['fan-3']);
  });

  it('leaves a person that already has a character or a modelled body alone', () => {
    const w = createWorld({ entities: { g: capsule('g', { name: 'Guard', character: { wardrobe: 'guard', scale: 1 } }) } });
    expect(isBodylessPerson(w.entities['g']!)).toBe(false);
  });

  it('derives wardrobe, gender and age from the words', () => {
    const w = createWorld({ entities: { w1: capsule('w1', { name: 'Shopkeeper woman' }), e: capsule('e', { name: 'Elder' }), k: capsule('k', { name: 'Boy' }) } });
    expect(characterFor(w.entities['w1']!)).toMatchObject({ wardrobe: 'merchant', gender: 'female' });
    expect(characterFor(w.entities['e']!)).toMatchObject({ wardrobe: 'elder', age: 'old' });
    expect(characterFor(w.entities['k']!)).toMatchObject({ gender: 'male', age: 'young' });
  });

  it('builds patches that validate and remove the finding', () => {
    const w = createWorld({ entities: { 'guard-1': capsule('guard-1'), 'guard-2': capsule('guard-2') } });
    const patches = characterPatches(w);
    expect(patches).toHaveLength(2);
    const r = applyPatches(w, patches);
    expect(r.errors).toEqual([]);
    expect(r.world.entities['guard-1']?.character?.wardrobe).toBe('guard');
    expect(bodilessPeople(r.world)).toEqual([]);
  });
});
