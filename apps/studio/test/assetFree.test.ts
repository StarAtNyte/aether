import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SHOWCASE } from '../src/showcase/manifest';

const WORLDS = resolve(__dirname, '../public/templates/worlds');

/** Every shape in a world, including the ones a scatter repeats. */
function shapeKinds(world: { entities: Record<string, { shape?: { kind?: string; of?: { kind?: string } } }> }): string[] {
  const kinds: string[] = [];
  for (const e of Object.values(world.entities)) {
    if (e.shape?.kind) kinds.push(e.shape.kind);
    if (e.shape?.of?.kind) kinds.push(e.shape.of.kind);
  }
  return kinds;
}

describe('"Asset-free" worlds', () => {
  const marked = SHOWCASE.filter((e) => e.assetFree);

  it('marks the worlds built from scratch', () => {
    expect(marked.map((e) => e.slug)).toEqual(expect.arrayContaining(['desert-citadel', 'evening-bistro', 'starlight-cinema']));
  });

  for (const e of marked) {
    it(`${e.slug} holds no library model, character or HDRI`, () => {
      const text = readFileSync(resolve(WORLDS, `${e.slug}.json`), 'utf8');
      const doc = JSON.parse(text) as { world?: unknown };
      const world = (doc.world ?? doc) as Parameters<typeof shapeKinds>[0] & { environment?: { hdri?: string } };
      const kinds = shapeKinds(world);
      expect(kinds.length).toBeGreaterThan(0);
      expect(kinds.filter((k) => k === 'asset' || k === 'model')).toEqual([]);
      expect(world.environment?.hdri).toBeUndefined();
      expect(text).not.toMatch(/\.glb\b/);
    });
  }
});
