import { applyPatches, createWorld, type WorldDoc } from '@aether/core';
import { describe, expect, it } from 'vitest';
import { worldGround } from '../src/land';
import { findSunk, sunkFindings } from '../src/sunk';

const TERRAIN = { size: 200, height: 40, resolution: 128, roughness: 0.55, color: '#9a8a4f', variant: 3 };

function world(pieces: Array<{ id: string; generator: string; params: Record<string, unknown>; y: (g: number) => number; tags?: string[] }>): WorldDoc {
  const base = createWorld();
  const terrain = applyPatches(base, [{ op: 'add', entity: { id: 'land', shape: { kind: 'procedural', generator: 'terrain', params: TERRAIN, seed: 7 }, tags: ['terrain'] } }] as never).world;
  const g = worldGround(terrain);
  const out = applyPatches(
    terrain,
    pieces.map((p) => ({ op: 'add', entity: { id: p.id, shape: { kind: 'procedural', generator: p.generator, params: p.params, seed: 1 }, transform: { position: [30, p.y(g(30, 30)), 30] }, tags: p.tags ?? [] } })) as never,
  );
  expect(out.errors).toEqual([]);
  return out.world;
}

describe('sunk pieces', () => {
  it('finds a house sunk into the ground and leaves one standing on it alone', () => {
    const w = world([
      { id: 'sunk-house', generator: 'furn-dwelling', params: { type: 'stone-cottage' }, y: (g) => g - 3 },
      { id: 'tagged', generator: 'furn-dwelling', params: { type: 'stone-cottage' }, y: (g) => g - 3, tags: ['sunk'] },
    ]);
    const ids = findSunk(w).filter((p) => p.kind === 'sunk').map((p) => p.id);
    expect(ids).toContain('sunk-house');
    expect(ids).not.toContain('tagged');
    const f = sunkFindings(w).find((x) => x.entities.includes('sunk-house') && x.code === 'sunk_in_ground');
    expect(f?.code).toBe('sunk_in_ground');
    expect(f?.fix).toMatch(/footing/);
  });

  it('counts a stone footing as meant to be in the ground', () => {
    const w = world([{ id: 'on-footing', generator: 'furn-dwelling', params: { type: 'stone-cottage', footing: 4 }, y: (g) => g - 3 }]);
    expect(findSunk(w).filter((p) => p.kind === 'sunk').map((p) => p.id)).not.toContain('on-footing');
  });

  it('finds a house hanging over a drop on one side', () => {
    const w = world([{ id: 'perched', generator: 'furn-dwelling', params: { type: 'stone-cottage' }, y: (g) => g + 3 }]);
    const f = sunkFindings(w).find((x) => x.entities.includes('perched'));
    expect(f?.code).toBe('over_edge');
  });

  it('has nothing to check without terrain', () => {
    expect(findSunk(createWorld())).toEqual([]);
  });
});
