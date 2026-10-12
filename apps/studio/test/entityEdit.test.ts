import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld } from '@aether/core';
import { BEHAVIOR_CATALOG } from '@aether/logic';
import { defaultParams, entityReplacePatches, entityToJson, parseEntityJson, parseTags } from '../src/lib/entityEdit';
import { MAX_ENTITY_JSON_CHARS } from '../src/config';

const world = createWorld({
  entities: { crate: { id: 'crate', shape: { kind: 'primitive', primitive: 'box' }, physics: { body: 'dynamic' }, material: { color: '#aa5500' } } },
});
const crate = world.entities['crate']!;

describe('raw entity JSON editing', () => {
  it('round-trips and produces minimal update patches', () => {
    const edited = JSON.parse(entityToJson(crate)) as Record<string, unknown>;
    edited['name'] = 'Big crate';
    delete edited['physics'];
    const r = parseEntityJson(JSON.stringify(edited), 'crate');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const patches = entityReplacePatches(world, r.entity);
    expect(patches.length).toBeGreaterThan(0);
    const next = applyPatches(world, patches).world;
    expect(next.entities['crate']?.name).toBe('Big crate');
    expect(next.entities['crate']?.physics).toBeUndefined();
  });

  it('returns no patches when nothing changed', () => {
    const r = parseEntityJson(entityToJson(crate), 'crate');
    expect(r.ok && entityReplacePatches(world, r.entity)).toEqual([]);
  });

  it('rejects id changes, invalid JSON, schema errors, pollution and oversize input', () => {
    expect(parseEntityJson(JSON.stringify({ ...crate, id: 'other' }), 'crate').ok).toBe(false);
    expect(parseEntityJson('{', 'crate').ok).toBe(false);
    expect(parseEntityJson('[]', 'crate').ok).toBe(false);
    expect(parseEntityJson(JSON.stringify({ ...crate, physics: { body: 'flying' } }), 'crate').ok).toBe(false);
    expect(parseEntityJson('{"id":"crate","__proto__":{"x":1}}', 'crate').ok).toBe(false);
    expect(parseEntityJson('x'.repeat(MAX_ENTITY_JSON_CHARS + 1), 'crate').ok).toBe(false);
  });

  it('builds default behavior params from the catalog', () => {
    const spin = BEHAVIOR_CATALOG.find((b) => b.type === 'spin');
    expect(spin).toBeDefined();
    if (spin) expect(defaultParams(spin.params)).toMatchObject({ speed: 90 });
  });

  it('parses tags', () => {
    expect(parseTags('#coin, pickup  coin,,')).toEqual(['coin', 'pickup']);
    expect(parseTags(Array.from({ length: 50 }, (_, i) => `t${i}`).join(' '))).toHaveLength(32);
  });
});
