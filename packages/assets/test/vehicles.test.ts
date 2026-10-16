import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Catalog } from '../src/schema';

const ROOT = new URL('../../../assets/', import.meta.url);
const catalog = Catalog.parse(JSON.parse(readFileSync(new URL('catalog.json', ROOT), 'utf8')));
const VEHICLES = ['go-kart', 'go-kart-blue', 'go-kart-yellow', 'race-car', 'race-car-yellow', 'car', 'taxi', 'police-car', 'sports-car', 'hatchback', 'suv', 'van', 'delivery-truck'];

/** Node and material names of a GLB (the JSON chunk is plain even when the buffers are meshopt-compressed). */
function glbJson(file: string): { nodes: Array<{ name?: string }>; materials: Array<{ name?: string }> } {
  const buf = readFileSync(new URL(`lib/${file}`, ROOT));
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as { nodes: Array<{ name?: string }>; materials: Array<{ name?: string }> };
}

describe('modelled vehicles', () => {
  for (const id of VEHICLES) {
    it(`${id}: real size, four named wheels, steering nodes, a tintable paint and an MIT pack`, () => {
      const e = catalog.entries.find((x) => x.id === id);
      expect(e, id).toBeDefined();
      expect(e!.pack).toBe('aether-vehicles');
      expect(catalog.packs.find((p) => p.id === 'aether-vehicles')?.licence).toBe('MIT');
      const [w, h, l] = e!.size;
      expect(w).toBeGreaterThan(1.3);
      expect(w).toBeLessThan(2.6);
      expect(h).toBeGreaterThan(0.8);
      expect(h).toBeLessThan(2.6);
      expect(l).toBeGreaterThan(2.2);
      expect(l).toBeLessThan(6.2);
      const j = glbJson(e!.file!);
      const names = new Set(j.nodes.map((n) => n.name));
      for (const n of ['chassis', 'wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr', 'steer_fl', 'steer_fr']) expect(names.has(n), n).toBe(true);
      expect(j.materials.some((m) => m.name === 'paint')).toBe(true);
      expect(j.materials.some((m) => m.name === 'glass' || id.startsWith('go-kart') || id.startsWith('race-car'))).toBe(true);
    });
  }

  it('karts and race cars carry a driver and a steering wheel', () => {
    for (const id of ['go-kart', 'race-car']) {
      const j = glbJson(catalog.entries.find((x) => x.id === id)!.file!);
      expect(j.nodes.some((n) => n.name === 'steer_wheel')).toBe(true);
      expect(j.materials.some((m) => m.name === 'helmet')).toBe(true);
    }
  });
});
