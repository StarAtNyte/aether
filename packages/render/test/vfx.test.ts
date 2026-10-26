/**
 * Gameplay effects: the particle pool (seeding, ring overwrite, dirty ranges), the effect system (bursts, emitters,
 * budgets, no per-frame allocation) and the atlas.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Group, Object3D, PerspectiveCamera, Scene, type Mesh, type InstancedBufferAttribute } from 'three';
import { VfxPreset } from '@aether/core';
import { ParticlePool, SeededRandom, mixSeed, NO_FLOOR, STRIDE, SPIN_BIAS } from '../src/vfx/pool';
import { VFX_PRESETS, vfxBudget, CONTINUOUS_VFX } from '../src/vfx/presets';
import { VfxSystem, MAX_EMITTERS } from '../src/vfx/system';
import { atlasPixels, ATLAS_CELLS } from '../src/vfx/atlas';
import { describeSites, probeAllocations } from '../../../tests/unit/alloc-probe';

const RENDER_SRC = /packages\/render\/src\//;
const BUDGET = process.env.CI ? 64 : 16;

function camera(): PerspectiveCamera {
  const c = new PerspectiveCamera(50, 16 / 9, 0.1, 500);
  c.position.set(0, 2, 8);
  c.lookAt(0, 1, 0);
  c.updateMatrixWorld();
  return c;
}

function arrays(pool: ParticlePool): Float32Array[] {
  return [pool.origin, pool.velocity, pool.shape, pool.color0, pool.color1, pool.motion];
}

describe('particle pool', () => {
  it('batch emission matches individual writes across presets, direction changes and ring wraparound', () => {
    const batch = new ParticlePool(17), individual = new ParticlePool(17);
    const batchRandom = new SeededRandom(123), individualRandom = new SeededRandom(123);
    const opts = { scale: 1.5, tint: null, floorY: 0.25 };
    let time = 0;
    for (const def of Object.values(VFX_PRESETS)) for (const layer of def.layers) {
      for (const direction of [[0, 1, 0], [0.3, 0.8, -0.1], [-0, -1, 0], [0, 0, 0]]) {
        for (const count of [0, 1, 31]) {
          for (const pool of [batch, individual]) pool.at.set([1.2, 2.3, -4.5, ...direction, time]);
          batch.writeMany(layer, batchRandom, opts, count);
          for (let i = 0; i < count; i++) individual.write(layer, individualRandom, opts);
          for (let i = 0; i < 6; i++) expect(new Uint32Array(arrays(batch)[i]!.buffer)).toEqual(new Uint32Array(arrays(individual)[i]!.buffer));
          expect(batchRandom.state).toBe(individualRandom.state);
          expect(batch.spawned).toBe(individual.spawned);
          expect(batch.count).toBe(individual.count);
          time += 0.1;
        }
      }
    }
    const a = { start: 0, count: 0 }, b = { start: 0, count: 0 };
    expect(batch.takeDirty(a)).toBe(individual.takeDirty(b));
    expect(a).toEqual(b);
    for (const sample of [time, time + 10]) expect(batch.alive(sample)).toBe(individual.alive(sample));
  });

  it('every preset name of the World IR has a definition with sane numbers', () => {
    for (const name of VfxPreset.options) {
      const def = VFX_PRESETS[name];
      expect(def, name).toBeDefined();
      expect(def.layers.length).toBeGreaterThan(0);
      for (const l of def.layers) {
        expect(l.life[0]).toBeGreaterThan(0);
        expect(l.life[1]).toBeGreaterThanOrEqual(l.life[0]);
        expect(l.burst[1]).toBeGreaterThanOrEqual(l.burst[0]);
        expect(Math.abs(l.spin)).toBeLessThan(50);
      }
      expect(def.maxLife).toBe(Math.max(...def.layers.map((l) => l.life[1])));
    }
    expect(CONTINUOUS_VFX).toContain('fire');
    expect(CONTINUOUS_VFX).not.toContain('explosion');
  });

  it('the same seed writes the same particles; another seed different ones', () => {
    const layer = VFX_PRESETS.sparks.layers[0]!;
    const opts = { scale: 1, tint: null, floorY: 0 };
    const write = (seed: number): ParticlePool => {
      const p = new ParticlePool(64);
      const r = new SeededRandom(seed);
      for (let i = 0; i < 20; i++) p.spawn(layer, 1, 2, 3, 0, 1, 0, 0.5, r, opts);
      return p;
    };
    const a = write(42);
    const b = write(42);
    const c = write(43);
    arrays(a).forEach((arr, i) => expect(Array.from(arr)).toEqual(Array.from(arrays(b)[i]!)));
    expect(Array.from(a.velocity)).not.toEqual(Array.from(c.velocity));
    expect(a.count).toBe(20);
    // Cone emission stays inside its spread around +Y, sparks rest on their floor.
    for (let i = 0; i < 20; i++) {
      const k = i * STRIDE;
      const vy = a.velocity[k + 1]!;
      const speed = Math.hypot(a.velocity[k]!, vy, a.velocity[k + 2]!);
      expect(vy / speed).toBeGreaterThanOrEqual(Math.cos(layer.spread) - 1e-5);
      expect(a.color1[k + 3]).toBe(0);
      expect(a.origin[k + 3]).toBe(0.5);
      expect(a.motion[k + 3]).toBeGreaterThan(0); // a streak
    }
  });

  it('is a ring: the budget is a hard cap and the oldest particles are overwritten', () => {
    const p = new ParticlePool(8);
    const r = new SeededRandom(1);
    const layer = VFX_PRESETS.dust.layers[0]!;
    for (let i = 0; i < 20; i++) p.spawn(layer, i, 0, 0, 0, 1, 0, i, r, { scale: 1, tint: null, floorY: NO_FLOOR });
    expect(p.count).toBe(8);
    expect(p.spawned).toBe(20);
    // Slots hold the 8 newest births (12..19).
    const births = Array.from({ length: 8 }, (_, i) => p.origin[i * STRIDE + 3]!).sort((x, y) => x - y);
    expect(births).toEqual([12, 13, 14, 15, 16, 17, 18, 19]);
    // Spinning sprites encode their spin below -SPIN_BIAS.
    expect(p.motion[3]!).toBeLessThanOrEqual(-SPIN_BIAS + 50);
    expect(p.alive(19)).toBe(true);
    expect(p.alive(19 + layer.life[1] + 0.01)).toBe(false);
  });

  it('reports the written slots once (the GPU upload range)', () => {
    const p = new ParticlePool(16);
    const r = new SeededRandom(9);
    const layer = VFX_PRESETS.sparkle.layers[0]!;
    const out = { start: -1, count: -1 };
    expect(p.takeDirty(out)).toBe(false);
    for (let i = 0; i < 5; i++) p.spawn(layer, 0, 0, 0, 0, 1, 0, 0, r, { scale: 1, tint: null, floorY: NO_FLOOR });
    expect(p.takeDirty(out)).toBe(true);
    expect(out).toEqual({ start: 0, count: 5 });
    expect(p.takeDirty(out)).toBe(false);
    for (let i = 0; i < 3; i++) p.spawn(layer, 0, 0, 0, 0, 1, 0, 0, r, { scale: 1, tint: null, floorY: NO_FLOOR });
    p.takeDirty(out);
    expect(out).toEqual({ start: 5, count: 3 });
  });

  it('tints replace the colours and additive layers carry their HDR intensity', () => {
    const p = new ParticlePool(4);
    const r = new SeededRandom(3);
    const layer = VFX_PRESETS.sparks.layers[0]!;
    p.spawn(layer, 0, 0, 0, 0, 1, 0, 0, r, { scale: 1, tint: new Float32Array([0, 1, 0]), floorY: 0 });
    expect(p.color0[0]).toBe(0);
    expect(p.color0[1]).toBeCloseTo(layer.intensity, 5);
    expect(p.color0[2]).toBe(0);
  });

  it('mixSeed and SeededRandom are deterministic and spread', () => {
    expect(mixSeed(1, 2, 3)).toBe(mixSeed(1, 2, 3));
    expect(mixSeed(1, 2, 3)).not.toBe(mixSeed(1, 2, 4));
    const r = new SeededRandom(7);
    const xs = Array.from({ length: 1000 }, () => r.next());
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.05);
  });

  it('budgets grow with the render tier and shrink in low-memory mode', () => {
    expect(vfxBudget('low')).toBeLessThan(vfxBudget('medium'));
    expect(vfxBudget('medium')).toBeLessThan(vfxBudget('high'));
    expect(vfxBudget('high')).toBeLessThan(vfxBudget('ultra'));
    expect(vfxBudget('ultra', true)).toBe(1024);
  });
});

describe('effect system', () => {
  it('bursts are seeded, split by blend and never exceed the budget', () => {
    const make = (): VfxSystem => {
      const v = new VfxSystem(new Scene(), 'low');
      v.setWorldSeed(5);
      return v;
    };
    const a = make();
    const b = make();
    a.burst('explosion', 1, 1, 1, { seed: 99 });
    b.burst('explosion', 1, 1, 1, { seed: 99 });
    expect(Array.from(a.pools.add.velocity)).toEqual(Array.from(b.pools.add.velocity));
    expect(Array.from(a.pools.alpha.origin)).toEqual(Array.from(b.pools.alpha.origin));
    expect(a.pools.add.count).toBeGreaterThan(0);
    expect(a.pools.alpha.count).toBeGreaterThan(0);
    for (let i = 0; i < 400; i++) a.burst('confetti', 0, 0, 0, { seed: i, scale: 4 });
    expect(a.pools.add.count + a.pools.alpha.count).toBeLessThanOrEqual(a.capacity + 256);
    expect(a.pools.alpha.count).toBe(a.pools.alpha.capacity);
    a.dispose();
    b.dispose();
  });

  it('preserves particle writes across hidden frames and reuses consumed upload records', () => {
    const scene = new Scene();
    const v = new VfxSystem(scene, 'low');
    const cam = camera();
    const mesh = scene.children.find((o) => o.name === 'aether:vfx:add') as Mesh;
    const attrs = Object.values(mesh.geometry.attributes).filter((a) => (a as InstancedBufferAttribute).isInstancedBufferAttribute) as InstancedBufferAttribute[];
    expect(attrs.length).toBe(6);
    const records = attrs.map((a) => a.updateRanges[0]);
    v.hidden = true;
    v.burst('sparks', 0, 1, 0, { seed: 1 });
    v.update(1 / 60, cam);
    const first = v.pools.add.count;
    expect(first).toBeGreaterThan(0);
    v.burst('sparks', 0, 1, 0, { seed: 2 });
    v.update(1 / 60, cam);
    const second = v.pools.add.count;
    for (const a of attrs) expect(a.updateRanges).toEqual([{ start: 0, count: second * 4 }]);
    // The renderer consumes only when the hidden layer is eventually drawn.
    v.hidden = false;
    v.update(1 / 60, cam);
    for (const a of attrs) a.clearUpdateRanges();
    v.burst('sparks', 0, 1, 0, { seed: 3 });
    v.update(1 / 60, cam);
    for (let i = 0; i < attrs.length; i++) {
      expect(attrs[i]!.updateRanges).toEqual([{ start: second * 4, count: (v.pools.add.count - second) * 4 }]);
      expect(attrs[i]!.updateRanges[0]).toBe(records[i]);
    }
    v.dispose();
  });

  it('preserves the existing seeded particle buffers byte for byte', () => {
    // Captured before hoisting burst setup and caching preset hashes.
    const expected = {
      sparks: '4ee412eaa8c8959917c243c635677539f60a0797174cc58af71f872f2de75589',
      explosion: 'c1cc493637dbce6842236a8b4e136ec32beb6fa8eca542517860ca7f9277c621',
      confetti: 'd0d88542fc2bbeace1a4566b2f71ae6b0b1d975c56c6ed497f50b3259327905a',
      magic: '44cc461e04fdddf823191f21685213af1d49504b1532df4f209f6cb4676ff98e',
      splash: 'daa37848ebdeec4737cc5a589a492342988d64a90b3eebf9a0ec6c3bac86f5d0',
    } as const;
    for (const preset of Object.keys(expected) as Array<keyof typeof expected>) {
      const v = new VfxSystem(new Scene(), 'low');
      v.setWorldSeed(123);
      v.burst(preset, 1.2, 2.3, -4.5, { seed: 987, scale: 1.5, direction: [0.3, 0.8, -0.1], color: '#ff8800', floorY: 0.25 });
      const hash = createHash('sha256');
      for (const pool of [v.pools.add, v.pools.alpha]) for (const array of arrays(pool)) hash.update(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
      expect(hash.digest('hex'), preset).toBe(expected[preset]);
      v.dispose();
    }
  });

  it('ignores non-finite positions and unknown presets', () => {
    const v = new VfxSystem(new Scene(), 'low');
    v.burst('sparks', Number.NaN, 0, 0, { seed: 1 });
    v.burst('nope' as never, 0, 0, 0, { seed: 1 });
    v.burst('constructor' as never, 0, 0, 0, { seed: 1 });
    v.setEmitter('invalid', { preset: 'constructor' as never, enabled: true }, new Group());
    expect(v.emitterCount).toBe(0);
    expect(v.spawned).toBe(0);
    v.dispose();
  });

  it('continuous emitters follow their object, emit at their rate and stop when removed or far away', () => {
    const scene = new Scene();
    const v = new VfxSystem(scene, 'medium');
    const torch = new Object3D();
    torch.position.set(0, 1, 0);
    scene.add(torch);
    torch.updateMatrixWorld();
    v.setEmitter('torch', { preset: 'fire', enabled: true }, torch);
    expect(v.emitterCount).toBe(1);
    const cam = camera();
    for (let i = 0; i < 60; i++) v.update(1 / 60, cam);
    const rate = VFX_PRESETS.fire.layers[0]!.rate;
    expect(v.pools.add.spawned).toBeGreaterThan(rate * 0.8);
    expect(v.pools.add.spawned).toBeLessThan(rate * 1.6);
    // Births sit at the torch.
    expect(Math.abs(v.pools.add.origin[1]! - 1)).toBeLessThan(0.5);
    const before = v.spawned;
    torch.position.set(500, 1, 0);
    torch.updateMatrixWorld();
    for (let i = 0; i < 30; i++) v.update(1 / 60, cam);
    expect(v.spawned).toBe(before);
    v.setEmitter('torch', { preset: 'fire', enabled: false }, torch);
    expect(v.emitterCount).toBe(0);
    v.retainEmitters(new Set());
    v.dispose();
  });

  it('lets dormant emitters idle after live particles expire and resumes without a backlog', () => {
    const scene = new Scene();
    const parent = new Group();
    const torch = new Object3D();
    scene.add(parent);
    parent.add(torch);
    scene.updateMatrixWorld(true);
    const v = new VfxSystem(scene, 'medium');
    const cam = camera();
    v.setEmitter('torch', { preset: 'fire', enabled: true }, torch);
    expect(v.animating).toBe(false);
    for (let i = 0; i < 60; i++) v.update(1 / 60, cam);
    expect(v.animating).toBe(true);
    const before = v.spawned;
    parent.visible = false;
    for (let i = 0; i < 600; i++) v.update(1 / 60, cam);
    expect(v.spawned).toBe(before);
    expect(v.emitterCount).toBe(1);
    expect(v.animating).toBe(false);
    parent.visible = true;
    for (let i = 0; i < 6; i++) v.update(1 / 60, cam);
    expect(v.spawned - before).toBeGreaterThan(0);
    expect(v.spawned - before).toBeLessThan(10);
    expect(v.animating).toBe(true);
    torch.position.x = 500;
    torch.updateMatrixWorld(true);
    const far = v.spawned;
    for (let i = 0; i < 600; i++) v.update(1 / 60, cam);
    expect(v.spawned).toBe(far);
    expect(v.animating).toBe(false);
    torch.position.x = 0;
    torch.updateMatrixWorld(true);
    for (let i = 0; i < 6; i++) v.update(1 / 60, cam);
    expect(v.animating).toBe(true);
    v.hidden = true;
    expect(v.animating).toBe(false);
    v.hidden = false;
    expect(v.animating).toBe(true);
    v.dispose();
  });

  it('holds at most MAX_EMITTERS emitters', () => {
    const scene = new Scene();
    const v = new VfxSystem(scene, 'low');
    const g = new Group();
    scene.add(g);
    for (let i = 0; i < MAX_EMITTERS + 20; i++) v.setEmitter(`e${i}`, { preset: 'smoke', enabled: true }, g);
    expect(v.emitterCount).toBe(MAX_EMITTERS);
    v.dispose();
  });

  it('a frame (clock, uniforms, continuous emitters, uploads) allocates nothing', async () => {
    const scene = new Scene();
    const v = new VfxSystem(scene, 'high');
    const cam = camera();
    for (let i = 0; i < 6; i++) {
      const o = new Object3D();
      o.position.set(i - 3, 0.5, 0);
      scene.add(o);
      o.updateMatrixWorld();
      v.setEmitter(`fire-${i}`, { preset: i % 2 ? 'fire' : 'smoke', enabled: true }, o);
    }
    const r = await probeAllocations(() => v.update(1 / 60, cam), { iterations: 400, warmup: 2000, match: RENDER_SRC });
    expect(r.bytesPerIteration, describeSites(r)).toBeLessThan(BUDGET);
    expect(v.spawned).toBeGreaterThan(1000);
    v.dispose();
  });

  it('a burst allocates (almost) nothing: its particles go into the preallocated ring', async () => {
    const v = new VfxSystem(new Scene(), 'high');
    const cam = camera();
    let f = 0;
    const presets = ['sparks', 'dust', 'sparkle', 'splash', 'explosion'] as const;
    const opts = { seed: 0, color: '#ff8800', scale: 1.5 };
    const r = await probeAllocations(
      () => {
        opts.seed = f;
        v.burst(presets[f % presets.length]!, 0, 1, 0, opts);
        v.update(1 / 60, cam);
        f++;
      },
      { iterations: 400, warmup: 2000, match: RENDER_SRC },
    );
    // A few boxed seeds per burst at most (bursts happen per game event, not per frame).
    expect(r.bytesPerIteration, describeSites(r)).toBeLessThan(96);
    v.dispose();
  });
});

describe('sprite atlas', () => {
  it('is deterministic, white, with a clear border around each cell', () => {
    const a = atlasPixels(32);
    const b = atlasPixels(32);
    expect(a.length).toBe(32 * ATLAS_CELLS * 32 * 4);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const w = 32 * ATLAS_CELLS;
    for (let c = 0; c < ATLAS_CELLS; c++) {
      // Border texel transparent, centre (or ring band) covered.
      expect(a[(0 * w + c * 32) * 4 + 3]).toBe(0);
      let peak = 0;
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) peak = Math.max(peak, a[(y * w + c * 32 + x) * 4 + 3]!);
      expect(peak, `cell ${c}`).toBeGreaterThan(150);
    }
    expect(a[0]).toBe(255);
  });
});
