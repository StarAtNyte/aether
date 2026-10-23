import { afterEach, describe, expect, it, vi } from 'vitest';
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { collectTraceInput, isDaylightPane, LightVolumeController, materialAlbedo, type VolumeLighting, type VolumePart, type VolumeWorkerLike } from '../src/view/light-volume-controller';
import type { VolumeCache } from '../src/environment/light-volume-cache';
import { FLOATS_PER_PROBE, LightVolumeBaker, TraceScene } from '../src/environment/light-volume';
import { parseVolumeReply, parseVolumeRequest } from '../src/environment/light-volume-protocol';
import { volumeExposure, VOLUME_MAX_EV, VOLUME_MIN_EV } from '../src/view/eye-adapt';

const LIGHTING: VolumeLighting = {
  sun: { direction: [0.5, 0.7, 0.3].map((v, _i, a) => v / Math.hypot(...a)) as unknown as [number, number, number], irradiance: [2.5, 2.4, 2.2] },
  ambient: { a: [0.5, 0.55, 0.6], b: [0.25, 0.3, 0.35] },
  groundAlbedo: [0.2, 0.23, 0.16],
  lamps: [],
};

function slab(x: number, y: number, z: number, sx: number, sy: number, sz: number, role: string, color = '#e8e4dc'): VolumePart {
  const mesh = new Mesh(new BoxGeometry(sx, sy, sz), new MeshStandardMaterial({ color }));
  mesh.position.set(x, y, z);
  const object = new Group();
  object.add(mesh);
  object.updateMatrixWorld(true);
  return { role, object, meshes: [{ mesh, seeThrough: false, doubleSided: false }] };
}

/** A 6 × 3 × 6 m room with a door-sized gap in the +x wall, a sofa, and a pane of glass in the gap. */
function roomParts(): VolumePart[] {
  const parts = [
    slab(0, -0.1, 0, 6.4, 0.2, 6.4, 'room'),
    slab(0, 3.1, 0, 6.4, 0.2, 6.4, 'ceiling'),
    slab(0, 1.5, -3.1, 6.4, 3, 0.2, 'wall'),
    slab(0, 1.5, 3.1, 6.4, 3, 0.2, 'wall'),
    slab(-3.1, 1.5, 0, 0.2, 3, 6, 'wall'),
    slab(3.1, 1.5, -2, 0.2, 3, 2, 'wall'),
    slab(3.1, 1.5, 2, 0.2, 3, 2, 'wall'),
    slab(-1.5, 0.4, 0, 0.9, 0.8, 2.2, 'furniture', '#6a5a4a'),
  ];
  const glass = slab(3.1, 1.5, 0, 0.02, 3, 2, 'window');
  glass.meshes = [{ mesh: glass.meshes[0]!.mesh, seeThrough: true, doubleSided: false }];
  parts.push(glass);
  // A small lamp is no occluder.
  parts.push(slab(0, 2.6, 0, 0.2, 0.2, 0.2, 'furniture'));
  return parts;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('light volume controller: trace input', () => {
  it('takes shell triangles, skips glass, boxes the furniture and measures the shell', () => {
    const bounds = new Box3();
    const input = collectTraceInput(roomParts(), bounds)!;
    // 7 shell boxes × 12 triangles + one furniture box (the tiny lamp and the glass are left out).
    expect(input.albedo.length / 3).toBe(7 * 12 + 12);
    expect(input.positions.length).toBe((7 * 12 + 12) * 9);
    expect(bounds.min.x).toBeCloseTo(-3.2, 5);
    expect(bounds.max.y).toBeCloseTo(3.2, 5);
    expect(collectTraceInput([], bounds)).toBeNull();
  });

  it('lets light through the daylight pane of a window, not through a frame or an emissive piece of anything else', () => {
    const bounds = new Box3();
    const pane = slab(3.1, 1.5, 0, 0.02, 3, 2, 'window');
    (pane.meshes[0]!.mesh.material as MeshStandardMaterial).emissive.set('#f5f0e6');
    (pane.meshes[0]!.mesh.material as MeshStandardMaterial).emissiveIntensity = 1.8;
    const frame = slab(3.1, 1.5, 0, 0.05, 3, 0.1, 'window');
    const lampShade = slab(0, 1, 0, 0.5, 0.5, 0.5, 'wall');
    (lampShade.meshes[0]!.mesh.material as MeshStandardMaterial).emissive.set('#f5f0e6');
    (lampShade.meshes[0]!.mesh.material as MeshStandardMaterial).emissiveIntensity = 1.8;
    expect(isDaylightPane(pane.meshes[0]!.mesh.material)).toBe(true);
    expect(isDaylightPane(frame.meshes[0]!.mesh.material)).toBe(false);
    const input = collectTraceInput([pane, frame, lampShade], bounds)!;
    // The pane is left out; the frame and the (non-window) emissive shell piece stay.
    expect(input.albedo.length / 3).toBe(2 * 12);
  });

  it('leaves a curtain out of the occluders (its box would shut the window), keeps other furniture', () => {
    const bounds = new Box3();
    const wall = slab(0, 1.5, 0, 6, 3, 0.2, 'wall');
    const curtain = { ...slab(0, 1.25, 1, 1, 2.5, 0.12, 'fixture'), kind: 'curtain' };
    const chair = { ...slab(1, 0.5, 1, 0.8, 1, 0.8, 'furniture'), kind: 'armchair' };
    const input = collectTraceInput([wall, curtain, chair], bounds)!;
    expect(input.albedo.length / 3).toBe(12 + 12);
  });

  it('boxes a four-poster as high as most of its surface reaches, not up to the tips of its posts', () => {
    const bounds = new Box3();
    const object = new Group();
    const body = new Mesh(new BoxGeometry(2, 0.7, 2.1), new MeshStandardMaterial({ color: '#f4f4f2' }));
    body.position.set(0, 0.35, 0);
    const post = new Mesh(new BoxGeometry(0.05, 2.1, 0.05), new MeshStandardMaterial({ color: '#f4f4f2' }));
    post.position.set(0.95, 1.05, 1);
    object.add(body, post);
    object.updateMatrixWorld(true);
    const proxies: Array<{ lo: [number, number, number]; hi: [number, number, number]; tri: number }> = [];
    const wall = slab(0, 1.5, 4, 6, 3, 0.2, 'wall');
    const bed: VolumePart = { role: 'furniture', kind: 'bed', object, meshes: [body, post].map((mesh) => ({ mesh, seeThrough: false, doubleSided: false })) };
    collectTraceInput([wall, bed], bounds, proxies);
    expect(proxies).toHaveLength(1);
    expect(proxies[0]!.hi[1]).toBeLessThan(1);
    expect(proxies[0]!.hi[1]).toBeGreaterThan(0.6);
    // A solid piece keeps the whole box.
    const sofa = { ...slab(0, 0.45, 0, 2, 0.9, 1, 'furniture'), kind: 'sofa' };
    const solid: Array<{ lo: [number, number, number]; hi: [number, number, number]; tri: number }> = [];
    collectTraceInput([wall, sofa], bounds, solid);
    expect(solid[0]!.hi[1]).toBeGreaterThan(0.8);
  });

  it('reads the resolved albedo a material carries, else its colour', () => {
    const out: [number, number, number] = [0, 0, 0];
    const m = new MeshStandardMaterial({ color: '#ffffff' });
    materialAlbedo(m, out);
    expect(out[0]).toBeCloseTo(1, 5);
    m.userData['aetherAlbedo'] = [0.2, 0.3, 0.4];
    materialAlbedo(m, out);
    expect(out).toEqual([0.2, 0.3, 0.4]);
    m.userData['aetherAlbedo'] = [Number.NaN, 0, 0];
    materialAlbedo(m, out);
    expect(out[0]).toBeCloseTo(1, 5);
    materialAlbedo(null, out);
    expect(out).toEqual([0.5, 0.5, 0.5]);
  });
});

describe('light volume controller: baking', () => {
  it('waits for the building to settle, bakes between frames and uploads once', async () => {
    vi.useFakeTimers();
    let settled = false;
    let uploads = 0;
    const c = new LightVolumeController(() => ({ parts: roomParts(), lighting: LIGHTING, groundY: 0 }), { createWorker: null, settled: () => settled, onUpload: () => uploads++ });
    expect(c.baking).toBe(false);
    c.setEnabled(true);
    expect(c.light.visible).toBe(true);
    expect(c.baking).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(c.ready).toBe(false);
    settled = true;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(uploads).toBe(1);
    expect(c.ready).toBe(true);
    expect(c.baking).toBe(false);
    expect(c.light.strength).toBe(1);
    expect(c.light.bakeVersion).toBe(1);
    expect(c.shellBounds.isEmpty()).toBe(false);
    expect(c.lastBake?.worker).toBe(false);
    // Deep in the room the eye sees little sky; outside the volume there is no answer.
    const inside = c.eyeSample(-2, 1.5, 0)!;
    expect(inside.vis).toBeLessThan(0.2);
    expect(inside.lamps).toBe(0);
    expect(c.eyeSample(100, 1.5, 0)).toBeNull();
    expect(c.eyeSample(Number.NaN, 0, 0)).toBeNull();
    c.setEnabled(false);
    expect(c.ready).toBe(false);
    expect(c.light.strength).toBe(0);
    expect(c.light.visible).toBe(false);
    c.dispose();
  });

  it('a change during a bake restarts it; finishNow completes on the spot', async () => {
    vi.useFakeTimers();
    let gathers = 0;
    const c = new LightVolumeController(() => {
      gathers++;
      return { parts: roomParts(), lighting: LIGHTING, groundY: 0 };
    }, { createWorker: null });
    c.setEnabled(true);
    await vi.advanceTimersByTimeAsync(700);
    expect(gathers).toBe(1);
    expect(c.ready).toBe(true);
    c.invalidate();
    // The previous volume stays on screen while the next one bakes.
    expect(c.ready).toBe(true);
    expect(c.baking).toBe(true);
    expect(c.finishNow()).toBe(true);
    expect(gathers).toBe(2);
    expect(c.baking).toBe(false);
    c.dispose();
    expect(c.finishNow()).toBe(false);
  });

  it('bakes in a worker when one is offered, and ignores stale or malformed replies', async () => {
    vi.useFakeTimers();
    const posted: unknown[] = [];
    const fake: VolumeWorkerLike = {
      postMessage: (m: unknown) => posted.push(m),
      terminate: () => undefined,
      onmessage: null,
      onerror: null,
    };
    let uploads = 0;
    const c = new LightVolumeController(() => ({ parts: roomParts(), lighting: LIGHTING, groundY: 0 }), { createWorker: () => fake, onUpload: () => uploads++ });
    c.setEnabled(true);
    await vi.advanceTimersByTimeAsync(700);
    expect(posted.length).toBe(1);
    const req = parseVolumeRequest(posted[0])!;
    expect(req).not.toBeNull();
    // A reply to another job changes nothing; a malformed reply to this one is dropped.
    fake.onmessage?.({ data: { type: 'volume', id: req.id + 7, ok: true, data: new Float32Array(3) } } as MessageEvent);
    expect(c.baking).toBe(true);
    expect(c.ready).toBe(false);
    const data = new LightVolumeBaker({ grid: req.grid, scene: new TraceScene(req), sun: req.sun, ambient: req.ambient, ground: req.ground, lamps: req.lamps, rays: 16, passes: 1 }).run();
    fake.onmessage?.({ data: { type: 'volume', id: req.id, ok: true, data } } as MessageEvent);
    expect(uploads).toBe(1);
    expect(c.ready).toBe(true);
    expect(c.lastBake?.worker).toBe(true);
    c.dispose();
  });
});

describe('light volume controller: persistent cache', () => {
  /** An in-memory cache that records its traffic. */
  function memory(): VolumeCache & { rows: Map<string, Float32Array>; gets: string[] } {
    const rows = new Map<string, Float32Array>();
    const gets: string[] = [];
    return {
      rows,
      gets,
      get: async (key, n) => {
        gets.push(key);
        const d = rows.get(key);
        return d && d.length === n ? d : null;
      },
      put: async (key, data) => void rows.set(key, data.slice()),
    };
  }
  const gather = (lighting: VolumeLighting = LIGHTING) => () => ({ parts: roomParts(), lighting, groundY: 0 });

  it('stores a finished bake, and a revisit takes it without baking', async () => {
    vi.useFakeTimers();
    const cache = memory();
    const first = new LightVolumeController(gather(), { createWorker: null, cache, cacheMinMs: 0 });
    first.setEnabled(true);
    await vi.advanceTimersByTimeAsync(700);
    expect(first.finishNow()).toBe(true);
    expect(cache.rows.size).toBe(1);
    expect(first.lastBake?.cached).toBeUndefined();
    first.dispose();

    // A new session: same building and light, a fresh controller. No baker, no worker: the answer is the stored data.
    let workers = 0;
    const second = new LightVolumeController(gather(), { createWorker: () => (workers++, { postMessage: () => undefined, terminate: () => undefined, onmessage: null, onerror: null }), cache, cacheMinMs: 0 });
    second.setEnabled(true);
    await vi.advanceTimersByTimeAsync(700);
    expect(second.ready).toBe(true);
    expect(second.lastBake?.cached).toBe(true);
    expect(workers).toBe(0);
    expect(second.baking).toBe(false);
    expect(second.eyeSample(1, 1.6, 1)).not.toBeNull();
    second.dispose();
  });

  it('misses when the light, the building or the lamps differ', async () => {
    vi.useFakeTimers();
    const cache = memory();
    const keys = new Set<string>();
    for (const lighting of [LIGHTING, { ...LIGHTING, sun: null }, { ...LIGHTING, lamps: [{ position: [0, 2.6, 0] as [number, number, number], color: [20, 18, 15] as [number, number, number], range: 8 }] }]) {
      const c = new LightVolumeController(gather(lighting), { createWorker: null, cache, cacheMinMs: 0 });
      c.setEnabled(true);
      await vi.advanceTimersByTimeAsync(700);
      c.finishNow();
      c.dispose();
      keys.add(cache.gets.at(-1)!);
    }
    expect(keys.size).toBe(3);
    expect(cache.rows.size).toBe(3);
  });

  it('bakes quicker than the threshold are not stored, and an unreadable cache is a miss', async () => {
    vi.useFakeTimers();
    const cache = memory();
    const quick = new LightVolumeController(gather(), { createWorker: null, cache, cacheMinMs: 1e9 });
    quick.setEnabled(true);
    await vi.advanceTimersByTimeAsync(700);
    quick.finishNow();
    expect(cache.rows.size).toBe(0);
    quick.dispose();
    const broken: VolumeCache = { get: async () => new Float32Array(3), put: async () => undefined };
    const c = new LightVolumeController(gather(), { createWorker: null, cache: broken, cacheMinMs: 0 });
    c.setEnabled(true);
    await vi.advanceTimersByTimeAsync(700);
    expect(c.finishNow()).toBe(true);
    expect(c.lastBake?.cached).toBeUndefined();
    c.dispose();
  });

  it('a change while the cache is being read drops that lookup', async () => {
    vi.useFakeTimers();
    let release: (d: Float32Array | null) => void = () => undefined;
    const slow: VolumeCache = { get: () => new Promise((r) => (release = r)), put: async () => undefined };
    const c = new LightVolumeController(gather(), { createWorker: null, cache: slow, cacheMinMs: 0 });
    c.setEnabled(true);
    await vi.advanceTimersByTimeAsync(700);
    expect(c.baking).toBe(true);
    c.invalidate();
    release(new Float32Array(0));
    await vi.advanceTimersByTimeAsync(0);
    expect(c.ready).toBe(false);
    c.dispose();
  });
});

describe('light volume controller: lamps and the eye', () => {
  it('counts a room lamp toward the exposure only for an eye in its room', () => {
    vi.useFakeTimers();
    const lamp = { position: [0, 2.6, 0] as [number, number, number], color: [20, 18, 15] as [number, number, number], range: 8, room: [-3, 0, -3, 3, 3.2, 3] as const };
    const c = new LightVolumeController(() => ({ parts: roomParts(), lighting: { ...LIGHTING, lamps: [lamp] }, groundY: 0 }), { createWorker: null });
    c.setEnabled(true);
    expect(c.finishNow()).toBe(true);
    expect(c.eyeSample(1, 1.6, 1)!.lamps).toBeGreaterThan(0.5);
    // Just outside the room's box (but inside the volume): the lamp is behind a wall.
    expect(c.eyeSample(3.15, 1.6, 0)!.lamps).toBe(0);
    c.dispose();
  });
});

describe('light volume protocol', () => {
  const grid = { min: [0, 0, 0] as [number, number, number], spacing: 0.5, nx: 2, ny: 2, nz: 2 };
  const ok = { type: 'bake', id: 1, grid, positions: new Float32Array(9), albedo: new Float32Array(3), twoSided: new Uint8Array(1), sun: null, ambient: { a: [1, 1, 1], b: [0, 0, 0] }, ground: { y: 0, albedo: [0.2, 0.2, 0.2] }, lamps: [] };
  it('accepts a well-formed request and rejects malformed ones', () => {
    expect(parseVolumeRequest(ok)).not.toBeNull();
    expect(parseVolumeRequest({ ...ok, grid: { ...grid, nx: 1000 } })).toBeNull();
    expect(parseVolumeRequest({ ...ok, albedo: new Float32Array(4) })).toBeNull();
    expect(parseVolumeRequest({ ...ok, positions: [0, 0, 0] })).toBeNull();
    expect(parseVolumeRequest({ ...ok, sun: { direction: [0, 2, 0], irradiance: [1, 1, 1] } })).toBeNull();
    expect(parseVolumeRequest({ ...ok, ambient: { a: [Number.NaN, 0, 0], b: [0, 0, 0] } })).toBeNull();
    expect(parseVolumeRequest({ ...ok, lamps: [{ position: [0, 0, 0], color: [1, 1, 1], range: -1 }] })).toBeNull();
    expect(parseVolumeRequest(null)).toBeNull();
  });
  it('accepts only finite replies of the right size', () => {
    const n = 8 * FLOATS_PER_PROBE;
    expect(parseVolumeReply({ type: 'volume', id: 1, ok: true, data: new Float32Array(n) }, grid)?.ok).toBe(true);
    expect(parseVolumeReply({ type: 'volume', id: 1, ok: true, data: new Float32Array(n - 1) }, grid)).toBeNull();
    const bad = new Float32Array(n);
    bad[5] = Number.POSITIVE_INFINITY;
    expect(parseVolumeReply({ type: 'volume', id: 1, ok: true, data: bad }, grid)).toBeNull();
    expect(parseVolumeReply({ type: 'volume', id: 1, ok: false, error: 'x'.repeat(1000) }, grid)).toMatchObject({ ok: false });
  });
});

describe('volume exposure', () => {
  it('opens the eye in dark rooms, not outdoors, within bounds', () => {
    const outdoor = { ambient: 0.8, sun: 2.4 };
    expect(volumeExposure({ vis: 1, bounce: 0.6 }, outdoor)).toBeLessThan(0.3);
    const room = volumeExposure({ vis: 0.05, bounce: 0.15 }, outdoor);
    expect(room).toBeGreaterThan(1);
    expect(room).toBeLessThanOrEqual(VOLUME_MAX_EV);
    expect(volumeExposure({ vis: 0, bounce: 0 }, outdoor)).toBe(VOLUME_MAX_EV);
    expect(volumeExposure({ vis: Number.NaN, bounce: 0 }, outdoor)).toBe(0);
    expect(volumeExposure({ vis: 0.1, bounce: 0.1 }, { ambient: 0, sun: 0 })).toBe(0);
  });
  it('closes the eye in a lamp-lit room brighter than the dusk outside, within bounds', () => {
    const dusk = { ambient: 0.5, sun: 0.8 };
    const lit = volumeExposure({ vis: 0, bounce: 0.3, lamps: 6 }, dusk);
    expect(lit).toBeLessThan(-1);
    expect(lit).toBeGreaterThanOrEqual(VOLUME_MIN_EV);
    expect(volumeExposure({ vis: 0, bounce: 0, lamps: 1e6 }, dusk)).toBe(VOLUME_MIN_EV);
  });
});
