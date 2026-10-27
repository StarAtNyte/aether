import { describe, expect, it } from 'vitest';
import { DWELLING_TYPES, FURNITURE, buildFurniture, dwellingDoorAt, furnitureById, furnitureSize, type ArchOutput } from '../src/index';
import { FINISHES } from '../src/finishes';

const get = (id: string) => {
  const d = furnitureById(id);
  if (!d) throw new Error(`missing ${id}`);
  return d;
};

function bounds(out: ArchOutput): [number, number, number, number, number, number] {
  const b: [number, number, number, number, number, number] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const p of out.parts) {
    for (let k = 0; k < p.positions.length; k += 3) {
      for (let a = 0; a < 3; a++) {
        const v = p.positions[k + a] as number;
        if (v < (b[a] as number)) b[a] = v;
        if (v > (b[a + 3] as number)) b[a + 3] = v;
      }
    }
  }
  return b;
}

function tris(out: ArchOutput): number {
  return out.parts.reduce((s, p) => s + p.indices.length / 3, 0);
}

describe('dwellings', () => {
  const dwelling = get('furn-dwelling');

  it('is registered with the everyday names of a house', () => {
    expect(FURNITURE.find((f) => f.kind === 'dwelling')?.id).toBe('furn-dwelling');
    for (const n of ['house', 'cottage', 'village house', 'machiya', 'terraced house']) expect(dwelling.aliases).toContain(n);
  });

  for (const type of DWELLING_TYPES) {
    for (const variant of [0, 1, 2, 3]) {
      it(`${type} variant ${variant} builds clean, solid geometry in few meshes and triangles`, () => {
        const out = buildFurniture(dwelling, { type, variant }, 1);
        expect(out.parts.length).toBeGreaterThan(5);
        expect(out.parts.length).toBeLessThanOrEqual(24);
        expect(tris(out)).toBeLessThan(12_000);
        expect(out.colliders.length).toBeGreaterThan(0);
        for (const p of out.parts) {
          for (const v of p.positions) expect(Number.isFinite(v)).toBe(true);
          for (const i of p.indices) expect(i).toBeLessThan(p.positions.length / 3);
          expect(p.normals.length).toBe(p.positions.length);
        }
        const b = bounds(out);
        const [w, h, d] = furnitureSize(dwelling, { type, variant });
        expect(b[1]).toBeGreaterThanOrEqual(-0.001);
        expect(b[4]).toBeLessThanOrEqual(h + 0.01);
        expect(b[3] - b[0]).toBeLessThanOrEqual(w + 0.01);
        expect(b[5] - b[2]).toBeLessThanOrEqual(d + 0.01);
        // A house, not a hut or a tower: 4 to 14 m across, 3 to 12 m tall.
        expect(w).toBeGreaterThan(4);
        expect(w).toBeLessThan(15);
        expect(h).toBeGreaterThan(3);
        expect(h).toBeLessThan(12);
      });
    }
  }

  it('is deterministic and the variant changes the house', () => {
    const a = buildFurniture(dwelling, { type: 'stone-cottage', variant: 5 }, 1);
    const b = buildFurniture(dwelling, { type: 'stone-cottage', variant: 5 }, 9);
    expect(Array.from(a.parts[0]?.positions ?? [])).toEqual(Array.from(b.parts[0]?.positions ?? []));
    const sizes = new Set([0, 1, 2, 3, 4, 5].map((v) => furnitureSize(dwelling, { type: 'mediterranean', variant: v }).map((n) => n.toFixed(2)).join('x')));
    expect(sizes.size).toBeGreaterThan(3);
  });

  it('uses the real finishes of each region: thatch and slate roofs, timber frame, brick, plaster, cladding, tile', () => {
    const finishesOf = (params: Record<string, unknown>): string[] => buildFurniture(dwelling, params as never, 1).parts.map((p) => p.material.finish ?? '');
    expect(finishesOf({ type: 'stone-cottage', roofing: 'thatch' })).toContain('thatch');
    expect(finishesOf({ type: 'stone-cottage', roofing: 'slate' })).toContain('slate');
    expect(finishesOf({ type: 'timber-frame' })).toEqual(expect.arrayContaining(['plaster', 'oak', 'roof-tile']));
    expect(finishesOf({ type: 'brick-terrace' })).toContain('brick');
    expect(finishesOf({ type: 'nordic' })).toEqual(expect.arrayContaining(['cladding', 'metal-roof']));
    expect(finishesOf({ type: 'machiya' })).toContain('roof-tile');
    for (const f of ['thatch', 'slate'] as const) expect(FINISHES[f].tile).toBeGreaterThan(0.5);
  });

  it('has real roofs: eaves beyond the walls, a ridge above them, a chimney or dormer on the cottage', () => {
    const out = buildFurniture(dwelling, { type: 'stone-cottage', variant: 0, dormers: 1, chimney: 'ridge' }, 1);
    const b = bounds(out);
    expect(b[4]).toBeGreaterThan(5.2);
    const roof = out.parts.find((p) => p.material.finish === 'slate');
    expect(roof).toBeDefined();
    // The roof reaches past the walls by its eave and verge.
    const rb = bounds({ parts: roof ? [roof] : [], colliders: [] });
    expect(rb[3] - rb[0]).toBeGreaterThan(8.2);
    expect(rb[5] - rb[2]).toBeGreaterThan(5.4);
  });

  it('turns the gable to the street and keeps the door on the front', () => {
    const [dx, dz] = dwellingDoorAt({ type: 'nordic', variant: 2, gableFront: true });
    const [w, , d] = furnitureSize(dwelling, { type: 'nordic', variant: 2, gableFront: true });
    expect(Math.abs(dx)).toBeLessThan(w / 2);
    expect(dz).toBeGreaterThan(0);
    expect(dz).toBeLessThanOrEqual(d / 2 + 0.01);
    const [fx, fz] = dwellingDoorAt({ type: 'brick-terrace', variant: 1 });
    expect(Math.abs(fx)).toBeLessThan(3);
    expect(fz).toBeGreaterThan(2);
  });

  it('adds a flagstone path to the door when asked', () => {
    const none = buildFurniture(dwelling, { type: 'timber-frame', path: 0 }, 1);
    const path = buildFurniture(dwelling, { type: 'timber-frame', path: 5 }, 1);
    expect(none.parts.some((p) => p.material.finish === 'cobble')).toBe(false);
    expect(path.parts.some((p) => p.material.finish === 'cobble')).toBe(true);
    expect(bounds(path)[5]).toBeGreaterThan(bounds(none)[5] + 3);
  });

  it('lights windows warmly after dark only when asked', () => {
    const day = buildFurniture(dwelling, { type: 'mediterranean' }, 1);
    const night = buildFurniture(dwelling, { type: 'mediterranean', lit: true }, 1);
    expect(day.parts.some((p) => p.material.emissive !== undefined)).toBe(false);
    expect(night.parts.some((p) => p.material.emissive !== undefined)).toBe(true);
  });
});

describe('lot pieces', () => {
  it('builds every kind of fence at its span, with a gate gap that leaves the walkway open', () => {
    const fence = get('furn-fence');
    const kinds = ['picket', 'rail', 'stone-wall', 'brick-wall', 'hedge', 'wattle', 'bamboo', 'iron'];
    for (const variant of kinds) {
      const out = buildFurniture(fence, { variant, span: 2.4 }, 1);
      expect(out.parts.length, variant).toBeGreaterThan(0);
      const b = bounds(out);
      expect(b[3] - b[0], variant).toBeGreaterThan(2.2);
      expect(b[3] - b[0], variant).toBeLessThan(2.8);
      expect(b[1]).toBeGreaterThanOrEqual(-0.001);
      expect(out.colliders.length, variant).toBeGreaterThan(0);
      const gated = buildFurniture(fence, { variant, span: 2.4, gate: true }, 1);
      // Two blocks of collider with an opening between them.
      expect(gated.colliders.length, variant).toBeGreaterThanOrEqual(2);
    }
  });

  it('builds gardens and street lamps', () => {
    const garden = get('furn-garden');
    for (const variant of ['kitchen-garden', 'flowers', 'yard']) {
      const out = buildFurniture(garden, { variant, width: 5, depth: 4 }, 1);
      expect(out.parts.length, variant).toBeGreaterThan(1);
      expect(tris(out), variant).toBeLessThan(6000);
    }
    const lamp = get('furn-street-lamp');
    const post = buildFurniture(lamp, { variant: 'post' }, 1);
    expect(bounds(post)[4]).toBeGreaterThan(3);
    expect(post.parts.some((p) => p.material.emissive !== undefined)).toBe(true);
    expect(buildFurniture(lamp, { variant: 'post', glow: 0 }, 1).parts.some((p) => p.material.emissive !== undefined)).toBe(false);
  });
});
