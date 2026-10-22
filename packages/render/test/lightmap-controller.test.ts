import { describe, expect, it } from 'vitest';
import { BoxGeometry, Mesh, MeshStandardMaterial, PlaneGeometry } from 'three';
import { LightVolumeBaker, TraceScene, planVolumeGrid } from '../src/environment/light-volume';
import { LightVolume } from '../src/environment/light-volume-light';
import { LightmapBaker, meshTriangleCount, unwrapLightmap, type ProxyBox } from '../src/environment/lightmap';
import type { LightmapCache } from '../src/environment/lightmap-cache';
import { parseLightmapRequest, type LightmapReply } from '../src/environment/lightmap-protocol';
import { LightmapController, type LightmapScene, type LightmapWorkerLike } from '../src/view/lightmap-controller';
import { collectTraceInput, type VolumePart } from '../src/view/light-volume-controller';
import { Box3 } from 'three';

/** A 6 × 3 × 6 m room of five inward-facing planes (the +x wall has a window-sized gap: four quads around it). */
function room(): { meshes: Mesh[]; parts: VolumePart[] } {
  const mat = new MeshStandardMaterial({ color: 0xb0b0b0 });
  const mk = (g: PlaneGeometry, pos: [number, number, number], rot: [number, number, number]): Mesh => {
    const m = new Mesh(g, mat);
    m.position.set(...pos);
    m.rotation.set(...rot);
    m.updateMatrixWorld(true);
    return m;
  };
  const floor = mk(new PlaneGeometry(6, 6), [0, 0, 0], [-Math.PI / 2, 0, 0]);
  const ceiling = mk(new PlaneGeometry(6, 6), [0, 3, 0], [Math.PI / 2, 0, 0]);
  const north = mk(new PlaneGeometry(6, 3), [0, 1.5, -3], [0, 0, 0]);
  const south = mk(new PlaneGeometry(6, 3), [0, 1.5, 3], [0, Math.PI, 0]);
  const west = mk(new PlaneGeometry(6, 3), [-3, 1.5, 0], [0, Math.PI / 2, 0]);
  const east = mk(new PlaneGeometry(6, 3), [3, 1.5, 0], [0, -Math.PI / 2, 0]);
  const shell = [floor, ceiling, north, south, west, east];
  const table = new Mesh(new BoxGeometry(1.2, 0.7, 0.8), mat);
  table.position.set(0, 0.35, 0);
  table.updateMatrixWorld(true);
  const parts: VolumePart[] = [
    ...shell.map((m, i) => ({ role: i === 0 ? 'room' : 'wall', object: m, meshes: [{ mesh: m, seeThrough: false, doubleSided: true }] })),
    { role: 'furniture', object: table, meshes: [{ mesh: table, seeThrough: false, doubleSided: false }] },
  ];
  return { meshes: [...shell, table], parts };
}

/** The worker's own steps run in this thread, answering on the next tick. */
function inlineWorker(posted: unknown[], hold?: { release?: () => void }): LightmapWorkerLike {
  const w: LightmapWorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage(message: unknown) {
      posted.push(message);
      const req = parseLightmapRequest(message);
      const run = (): void => {
        if (!req) return;
        const layout = unwrapLightmap(req.meshes, req.maxSize, req.density)!;
        const scene = new TraceScene({ positions: req.positions, albedo: req.albedo, twoSided: req.twoSided });
        const proxies: ProxyBox[] = [];
        for (let i = 0; i + 6 < req.proxies.length; i += 7) proxies.push({ lo: [req.proxies[i]!, req.proxies[i + 1]!, req.proxies[i + 2]!], hi: [req.proxies[i + 3]!, req.proxies[i + 4]!, req.proxies[i + 5]!], tri: req.proxies[i + 6]! });
        const out = new LightmapBaker({ scene, proxies, meshes: req.meshes, layout, grid: req.grid, volume: req.volume, sun: req.sun, ambient: req.ambient, ground: req.ground, lamps: req.lamps, samples: req.samples }).run();
        const reply: LightmapReply = { type: 'lightmap', id: req.id, ok: true, size: out.size, scale: out.scale, density: layout.density, charts: layout.charts, texels: out.texels, rays: out.rays, rgba: out.rgba, uv: layout.uv };
        w.onmessage?.({ data: reply } as MessageEvent);
      };
      if (hold) hold.release = run;
      else queueMicrotask(run);
    },
    terminate() {
      /* nothing running */
    },
  };
  return w;
}

function memoryCache(): LightmapCache & { store: Map<string, Uint8Array> } {
  const store = new Map<string, Uint8Array>();
  return { store, get: async (k) => store.get(k) ?? null, put: async (k, b) => void store.set(k, b) };
}

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function until(cond: () => boolean, ms = 8000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await tick(5);
  }
}

function setup(over: { cache?: LightmapCache | null; auto?: boolean; posted?: unknown[]; worker?: boolean; hold?: { release?: () => void }; staticBytes?: Map<string, Uint8Array> } = {}) {
  const { meshes, parts } = room();
  const posted = over.posted ?? [];
  const light = new LightVolume();
  const scene = new TraceScene(collectTraceInput(parts, new Box3())!);
  const input = collectTraceInput(parts, new Box3())!;
  const grid = planVolumeGrid([-3.2, -0.2, -3.2], [3.2, 3.2, 3.2], 0.6)!;
  const lighting = { sun: { direction: [0.6, 0.8, 0] as [number, number, number], irradiance: [3, 2.9, 2.7] as [number, number, number] }, ambient: { a: [0.5, 0.55, 0.6] as [number, number, number], b: [0.2, 0.25, 0.35] as [number, number, number] }, groundAlbedo: [0.2, 0.2, 0.2] as [number, number, number], lamps: [] };
  const data = new LightVolumeBaker({ grid, scene: new TraceScene(input), sun: lighting.sun, ambient: lighting.ambient, ground: { y: -0.2, albedo: lighting.groundAlbedo }, lamps: [], rays: 16, passes: 2 }).run();
  void scene;
  let changes = 0;
  let attached: unknown = 'none';
  const statuses: string[] = [];
  const gather = (): LightmapScene => ({ meshes, parts, lighting, groundY: 0 });
  const ctl = new LightmapController(light, {
    gather,
    volume: () => ({ grid, data }),
    onChange: () => void changes++,
    attach: (s) => {
      attached = s;
    },
    onStatus: (s) => statuses.push(s.state),
    autoBake: () => over.auto ?? false,
    autoQuality: () => 'low',
    createWorker: over.worker === false ? null : () => inlineWorker(posted, over.hold),
    cache: over.cache === undefined ? memoryCache() : over.cache,
    staticBase: over.staticBytes ? 'static/' : null,
    fetchBytes: async (url) => {
      if (url.endsWith('index.json')) return new TextEncoder().encode(JSON.stringify({ keys: [...(over.staticBytes?.keys() ?? [])] }));
      return over.staticBytes?.get(url.replace('static/', '').replace('.lmap', '')) ?? null;
    },
  });
  return { ctl, light, meshes, posted, statuses, changes: () => changes, attached: () => attached };
}

describe('lightmap controller', () => {
  it('stays out of the way without a request when the host says a bake is not affordable', async () => {
    const t = setup({ auto: false });
    t.ctl.setEnabled(true);
    t.ctl.volumeChanged();
    await tick(1500);
    expect(t.posted).toHaveLength(0);
    expect(t.ctl.ready).toBe(false);
    expect(t.light.lightmapStrength).toBe(0);
    expect(t.ctl.status.state).toBe('idle');
    t.ctl.dispose();
  });

  it('bakes on request, gives the surfaces coordinates and the light its atlas, and puts everything back on invalidate', async () => {
    const t = setup();
    t.ctl.setEnabled(true);
    const before = t.meshes.map((m) => m.geometry);
    t.ctl.request('low', 12);
    expect(t.ctl.baking).toBe(true);
    await until(() => t.ctl.ready);
    expect(t.posted).toHaveLength(1);
    expect(t.ctl.status.state).toBe('applied');
    expect(t.light.lightmapStrength).toBe(1);
    expect(t.light.lightmap).not.toBeNull();
    expect(t.attached()).toBe(t.ctl);
    // Standalone meshes draw their own unindexed copy with the atlas coordinates.
    const baked = t.meshes.filter((m) => m.geometry.getAttribute('aetherLM'));
    expect(baked.length).toBe(7);
    for (const m of baked) {
      expect(m.geometry.index).toBeNull();
      expect(m.geometry.getAttribute('aetherLM').count).toBe(m.geometry.getAttribute('position').count);
    }
    expect(t.ctl.lastBake).toMatchObject({ source: 'bake' });
    expect(t.ctl.lastBake!.meshes).toBe(7);
    expect(t.ctl.asset!.byteLength).toBeGreaterThan(1000);
    // A change to the building takes it away at once.
    t.ctl.invalidate('geometry');
    expect(t.ctl.ready).toBe(false);
    expect(t.light.lightmapStrength).toBe(0);
    t.meshes.forEach((m, i) => expect(m.geometry).toBe(before[i]));
    expect(t.attached()).toBeNull();
    t.ctl.dispose();
  });

  it('keeps the lightmap through a light-only change and replaces it when the new one is ready', async () => {
    const t = setup();
    t.ctl.setEnabled(true);
    t.ctl.request('low', 8);
    await until(() => t.ctl.ready);
    const geoms = t.meshes.map((m) => m.geometry);
    t.ctl.invalidate('light');
    expect(t.light.lightmapStrength).toBe(1);
    expect(t.ctl.ready).toBe(true);
    t.meshes.forEach((m, i) => expect(m.geometry).toBe(geoms[i]));
    t.ctl.dispose();
  });

  it('applies a cached lightmap with no worker, and a cancelled bake is not started again', async () => {
    const cache = memoryCache();
    const first = setup({ cache });
    first.ctl.setEnabled(true);
    first.ctl.request('low', 8);
    await until(() => first.ctl.ready);
    // The wall time of the test bake is under the cache's threshold: store its file the way a slow bake would.
    cache.store.set(first.ctl.lastBake!.key, first.ctl.asset!);
    first.ctl.dispose();
    const second = setup({ cache, worker: false });
    second.ctl.setEnabled(true);
    second.ctl.request('low', 8);
    await until(() => second.ctl.ready);
    expect(second.ctl.lastBake!.source).toBe('cache');
    expect(second.posted).toHaveLength(0);
    second.ctl.dispose();

    const third = setup({ cache: null, worker: false });
    third.ctl.setEnabled(true);
    third.ctl.request('low', 8);
    await until(() => third.ctl.status.state === 'failed');
    expect(third.ctl.status.message).toMatch(/no worker/);
    expect(third.ctl.ready).toBe(false);
    third.ctl.dispose();
  });

  it('applies a bundled file named in the index and ignores one that does not match the building', async () => {
    const donor = setup();
    donor.ctl.setEnabled(true);
    donor.ctl.request('low', 8);
    await until(() => donor.ctl.ready);
    const key = donor.ctl.lastBake!.key;
    const bytes = donor.ctl.asset!;
    donor.ctl.dispose();
    const t = setup({ cache: null, worker: false, staticBytes: new Map([[key, bytes]]) });
    t.ctl.setEnabled(true);
    t.ctl.request('low', 8);
    await until(() => t.ctl.ready);
    expect(t.ctl.lastBake!.source).toBe('static');
    t.ctl.dispose();
    // The same bytes under another key (another building) are refused: the triangle counts do not match a smaller scene.
    const wrong = setup({ cache: null, worker: false, staticBytes: new Map([['lm1-00000000000000000000000000000000', bytes]]) });
    wrong.ctl.setEnabled(true);
    wrong.ctl.request('low', 8);
    await until(() => wrong.ctl.status.state === 'failed');
    wrong.ctl.dispose();
    expect(meshTriangleCount({ positions: new Float32Array(18), index: null })).toBe(2);
  });

  it('cancels a bake in flight and reports it', async () => {
    const posted: unknown[] = [];
    const hold: { release?: () => void } = {};
    const t = setup({ posted, hold });
    t.ctl.setEnabled(true);
    t.ctl.request('low', 8);
    await until(() => posted.length === 1);
    expect(t.ctl.status.state).toBe('baking');
    t.ctl.cancel();
    expect(t.ctl.baking).toBe(false);
    expect(t.ctl.status.state).toBe('cancelled');
    // The terminated worker's late answer is ignored.
    hold.release?.();
    await tick(300);
    expect(t.ctl.ready).toBe(false);
    expect(t.light.lightmapStrength).toBe(0);
    t.ctl.dispose();
  });

  it('turns off with the world setting and returns to automatic', async () => {
    const t = setup();
    t.ctl.setEnabled(true);
    t.ctl.request('low', 8);
    await until(() => t.ctl.ready);
    t.ctl.clear();
    expect(t.ctl.ready).toBe(false);
    expect(t.ctl.status.message).toMatch(/off/);
    t.ctl.volumeChanged();
    await tick(1500);
    expect(t.ctl.ready).toBe(false);
    t.ctl.reset();
    expect(t.ctl.status.state).toBe('idle');
    t.ctl.dispose();
  });
});
