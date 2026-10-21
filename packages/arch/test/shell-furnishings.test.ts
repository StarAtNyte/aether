import { describe, expect, it } from 'vitest';
import { buildFurniture, furnitureByKind, furnitureSize, partKinds, placeItem, readScene, findRoom, isLookupError, type ArchOutput } from '../src/index';
import { applyEdit, shellWorld } from './scene-helpers';

type Params = Record<string, string | number | boolean>;

function build(kind: string, params: Params = {}, seed = 7): { out: ArchOutput; size: [number, number, number] } {
  const def = furnitureByKind(kind);
  if (!def) throw new Error(`no ${kind}`);
  return { out: buildFurniture(def, params, seed), size: furnitureSize(def, params) };
}

interface Stats {
  tris: number;
  finite: boolean;
  min: [number, number, number];
  max: [number, number, number];
  finishes: string[];
  opacity: number[];
}

function stats(out: ArchOutput): Stats {
  const s: Stats = { tris: 0, finite: true, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], finishes: [], opacity: [] };
  for (const p of out.parts) {
    s.tris += p.indices.length / 3;
    for (let i = 0; i < p.positions.length; i++) {
      const v = p.positions[i] as number;
      if (!Number.isFinite(v)) s.finite = false;
      const a = i % 3;
      s.min[a] = Math.min(s.min[a] as number, v);
      s.max[a] = Math.max(s.max[a] as number, v);
    }
    const m = p.material as { finish?: string; opacity?: number };
    if (m.finish) s.finishes.push(m.finish);
    if (m.opacity !== undefined) s.opacity.push(m.opacity);
  }
  return s;
}

describe('curtains', () => {
  it('keeps the old defaults: one pleated panel inside its footprint', () => {
    const c = build('curtain', {});
    const s = stats(c.out);
    expect(c.size).toEqual([1.6, 2.6, 0.14]);
    expect(s.finite).toBe(true);
    expect(s.tris).toBeGreaterThan(500);
    expect(s.max[1]).toBeLessThanOrEqual(2.6 + 1e-6);
    expect(s.min[1]).toBeGreaterThanOrEqual(0);
    expect(s.min[0]).toBeGreaterThanOrEqual(-0.8 - 0.12);
    expect(s.max[2]).toBeLessThan(0.14);
  });

  it('every style builds a bounded, deterministic, finite mesh with smooth unit normals', () => {
    for (const style of ['pleated', 'pinch', 'eyelet', 'ripple', 'sheer']) {
      for (const panels of [1, 2]) {
        const params: Params = { style, panels, width: 0.9, height: 2.6, gap: 1.4 };
        const a = build('curtain', params);
        const b = build('curtain', params);
        const s = stats(a.out);
        expect(s.finite).toBe(true);
        expect(s.tris).toBeLessThan(6000);
        expect(stats(b.out).tris).toBe(s.tris);
        expect(Array.from(a.out.parts[0]!.positions)).toEqual(Array.from(b.out.parts[0]!.positions));
        const n = a.out.parts[0]!.normals;
        for (let i = 0; i < n.length; i += 3) expect(Math.hypot(n[i] as number, n[i + 1] as number, n[i + 2] as number)).toBeCloseTo(1, 3);
      }
    }
    expect(stats(build('curtain', { style: 'sheer' }).out).opacity).toContain(0.55);
    expect(stats(build('curtain', { sheer: 'sheer' }).out).opacity).toContain(0.55);
    expect(stats(build('curtain', {}).out).opacity).toEqual([]);
  });

  it('eyelet adds visible rings; ripple folds are deeper than pleats', () => {
    const plain = stats(build('curtain', { style: 'pleated' }).out);
    const eyelet = stats(build('curtain', { style: 'eyelet' }).out);
    expect(eyelet.finishes).toContain('brushed-metal');
    expect(plain.finishes).not.toContain('brushed-metal');
    const ripple = stats(build('curtain', { style: 'ripple', rod: 'none' }).out);
    const pleat = stats(build('curtain', { style: 'pleated', rod: 'none' }).out);
    expect(ripple.max[2] - ripple.min[2]).toBeGreaterThan(pleat.max[2] - pleat.min[2]);
  });

  it('a pair spans the window gap plus both panels, and drawing it closes the gap', () => {
    const open = build('curtain', { panels: 2, width: 0.8, gap: 1.5, rod: 'none' });
    expect(open.size[0]).toBeCloseTo(3.1, 5);
    const so = stats(open.out);
    expect(so.min[0]).toBeGreaterThanOrEqual(-1.55 - 0.1);
    expect(so.max[0]).toBeLessThanOrEqual(1.55 + 0.1);
    // Open: nothing in front of the window centre; closed: fabric across the centre line.
    const crosses = (o: ArchOutput): boolean => o.parts.some((p) => Array.from({ length: p.positions.length / 3 }, (_, i) => p.positions[i * 3] as number).some((x) => Math.abs(x) < 0.05));
    expect(crosses(open.out)).toBe(false);
    expect(crosses(build('curtain', { panels: 2, width: 0.8, gap: 1.5, closed: 1, rod: 'none' }).out)).toBe(true);
  });

  it('pelmets, tie-back, track and pooling change the geometry inside a stated footprint', () => {
    const base = build('curtain', { rod: 'none' });
    for (const pelmet of ['box', 'valance', 'swag']) {
      const c = build('curtain', { pelmet, rod: 'none' });
      const s = stats(c.out);
      expect(s.tris).toBeGreaterThan(stats(base.out).tris - 1);
      expect(c.size[2]).toBeGreaterThan(base.size[2]);
      expect(s.max[2]).toBeLessThanOrEqual(c.size[2] + 1e-6);
      expect(s.max[1]).toBeLessThanOrEqual(2.6 + 0.01);
    }
    expect(stats(build('curtain', { tieback: true }).out).finishes.filter((f) => f === 'fabric').length).toBeGreaterThan(1);
    const track = stats(build('curtain', { rod: 'track' }).out);
    expect(track.finishes).toContain('paint');
    const pooled = stats(build('curtain', { pool: 0.12 }).out);
    expect(pooled.max[2]).toBeGreaterThan(stats(base.out).max[2] + 0.05);
    expect(pooled.min[1]).toBeGreaterThanOrEqual(0);
  });
});

describe('blinds', () => {
  it('is registered as a wall part and listed with the other kinds', () => {
    const def = furnitureByKind('blind');
    expect(def?.mount).toBe('wall');
    expect(partKinds()).toContain('blind');
  });

  it('every style builds inside its footprint, and drawn lowers the blind', () => {
    for (const style of ['roller', 'roman', 'venetian', 'shutter', 'vertical']) {
      const b = build('blind', { style, width: 1.4, height: 1.6, drawn: 0.6 });
      const s = stats(b.out);
      expect(s.finite).toBe(true);
      expect(s.tris).toBeGreaterThan(20);
      expect(s.tris).toBeLessThan(6000);
      expect(b.size).toEqual([1.4, 1.6, style === 'shutter' ? 0.07 : 0.1]);
      expect(s.min[0]).toBeGreaterThanOrEqual(-0.7 - 1e-6);
      expect(s.max[0]).toBeLessThanOrEqual(0.7 + 1e-6);
      expect(s.max[1]).toBeLessThanOrEqual(1.6 + 1e-6);
      expect(s.min[1]).toBeGreaterThanOrEqual(-1e-6);
      expect(s.min[2]).toBeGreaterThanOrEqual(-0.03);
      expect(s.max[2]).toBeLessThanOrEqual(b.size[2] + 1e-6);
    }
    for (const style of ['roller', 'roman', 'venetian', 'vertical']) {
      const low = stats(build('blind', { style, drawn: 0.9, height: 1.6 }).out);
      const high = stats(build('blind', { style, drawn: 0.2, height: 1.6 }).out);
      expect(low.min[1]).toBeLessThan(high.min[1]);
    }
  });

  it('can be hung on a free stretch of wall and appears in the room', () => {
    const w0 = shellWorld();
    const scene = readScene(w0, 'home')!;
    const room = findRoom(scene, 'bedroom');
    if (isLookupError(room)) throw new Error('no room');
    const r = placeItem(w0, undefined, { kind: 'blind', room: 'bedroom', id: 'shade', wall: 'east', t: 1.8, y: 0.9, params: { width: 0.9, height: 1.2, style: 'roman' } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const w1 = applyEdit(w0, r);
    expect(Object.keys(w1.entities).some((id) => id.endsWith('shade'))).toBe(true);
  });
});

describe('fireplace', () => {
  it('keeps a conservative footprint for every style and mantel, and the breast can be left out', () => {
    for (const style of ['classic', 'victorian', 'modern']) {
      for (const mantel of ['none', 'shelf', 'classic']) {
        const f = build('fireplace', { style, mantel });
        const s = stats(f.out);
        expect(s.finite).toBe(true);
        expect(s.tris).toBeLessThan(4000);
        expect(s.min[0]).toBeGreaterThanOrEqual(-f.size[0] / 2 - 1e-6);
        expect(s.max[0]).toBeLessThanOrEqual(f.size[0] / 2 + 1e-6);
        expect(s.min[2]).toBeGreaterThanOrEqual(-f.size[2] / 2 - 1e-6);
        expect(s.max[2]).toBeLessThanOrEqual(f.size[2] / 2 + 1e-6);
        expect(s.max[1]).toBeLessThanOrEqual(f.size[1] + 0.15);
      }
    }
    expect(build('fireplace', {}).size[1]).toBe(2.7);
    expect(build('fireplace', { breast: false }).size[1]).toBeLessThan(1.3);
    expect(stats(build('fireplace', { breast: false }).out).max[1]).toBeLessThan(1.4);
    expect(build('fireplace', { projection: 0.6 }).size[2]).toBeGreaterThan(build('fireplace', { projection: 0.3 }).size[2]);
  });

  it('lit and hearth switch the glow and the slab off', () => {
    const emissive = (o: ArchOutput): number => o.parts.filter((p) => (p.material as { emissiveIntensity?: number }).emissiveIntensity).length;
    expect(emissive(build('fireplace', {}).out)).toBe(1);
    expect(emissive(build('fireplace', { lit: false }).out)).toBe(0);
    expect(stats(build('fireplace', { hearth: false }).out).max[2]).toBeLessThan(stats(build('fireplace', {}).out).max[2]);
  });
});

describe('built-in wardrobes and bookshelves', () => {
  it('run to the full height with a crown, a face frame and a toe-kick, and keep the loose look by default', () => {
    for (const kind of ['wardrobe', 'bookshelf']) {
      const loose = build(kind, { height: 2.4, width: 2 });
      const fitted = build(kind, { height: 3.0, width: 2, builtin: true });
      const s = stats(fitted.out);
      expect(s.finite).toBe(true);
      expect(fitted.size[1]).toBe(3);
      expect(s.max[1]).toBeCloseTo(3, 2);
      expect(s.tris).toBeGreaterThan(stats(loose.out).tris);
      expect(s.max[2]).toBeLessThanOrEqual(fitted.size[2] / 2 + 0.05 + 1e-6);
      expect(stats(build(kind, { height: 2.4, width: 2, builtin: false }).out).tris).toBe(stats(loose.out).tris);
    }
    // The wardrobe doors stay separate parts that open, with moulded panels on the fitted one.
    const def = furnitureByKind('wardrobe')!;
    expect(def.interactive).toBe(true);
  });
});
