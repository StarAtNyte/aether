/**
 * Progressive library models: a large model with a light copy mounts the copy, then (when the host allows) swaps in the
 * full file, nearest first, at most two files at a time, without a moment showing neither.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, type Object3D } from 'three';
import { createWorld, type EntityInput } from '@aether/core';
import { setCatalog, type CatalogInput } from '@aether/assets';
import { ModelCache, type ModelLoader } from '../src/geometry/model-loader';
import { ModelUpgrades, UPGRADE_DECODED, UPGRADE_DOWNLOAD_SHARE, UPGRADE_PREPARED } from '../src/sync/model-upgrades';
import { PROGRESSIVE_MIN_BYTES } from '../src/sync/scene-sync';
import { makeSync, tick } from './helpers';

const entry = (id: string, bytes: number, lite: boolean) => ({
  id,
  name: id,
  kind: 'model' as const,
  category: 'decor' as const,
  tags: [],
  style: 'realistic' as const,
  pack: 'p',
  size: [1, 0.02, 2] as [number, number, number],
  tris: 12,
  bytes,
  file: `m/${id}.00000000.glb`,
  lods: [],
  ...(lite ? { lite: `m/${id}.lite.00000000.glb` } : {}),
  collider: { type: 'box' as const },
  placement: 'floor' as const,
  facing: '+z' as const,
  source: 'x',
});

const CATALOG: CatalogInput = {
  version: 1,
  base: '/assets/lib/',
  packs: [{ id: 'p', title: 'P', author: 'A', licence: 'CC0-1.0', licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', url: 'https://example.org', version: '1' }],
  entries: [entry('rug', 3_000_000, true), entry('rug2', 3_000_000, true), entry('rug3', 3_000_000, true), entry('mat', PROGRESSIVE_MIN_BYTES - 1, true), entry('plain', 3_000_000, false)],
};

class FakeLoader implements ModelLoader {
  calls: string[] = [];
  holdFull = false;
  private waiting: Array<() => void> = [];
  async load(url: string): Promise<Object3D> {
    this.calls.push(url);
    if (this.holdFull && !url.includes('.lite.')) await new Promise<void>((r) => this.waiting.push(r));
    const g = new Group();
    g.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ name: url })));
    return g;
  }
  flush(): void {
    for (const w of this.waiting.splice(0)) w();
  }
}

const ent = (id: string, assetId: string, x = 0): EntityInput => ({ id, shape: { kind: 'asset', id: assetId }, transform: { position: [x, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } });
const doc = (...entities: EntityInput[]) => createWorld({ entities: Object.fromEntries(entities.map((e) => [e.id, e])) });
const materialOf = (o: Object3D): string => {
  let name = '';
  o.traverse((x) => {
    if (x instanceof Mesh) name = (x.material as MeshStandardMaterial).name;
  });
  return name;
};

let loader: FakeLoader;
let models: ModelCache;
beforeEach(() => {
  setCatalog(CATALOG);
  loader = new FakeLoader();
  models = new ModelCache(loader);
});
afterEach(() => models.dispose());

describe('progressive library models', () => {
  it('mounts the light copy, holds the full file until allowed, then swaps it in and lets the copy go', async () => {
    let allowed = false;
    const prepared: Object3D[] = [];
    const { sync } = makeSync({ models, modelUpgrades: { allowed: () => allowed, prepare: async (c) => void prepared.push(c) } });
    await sync.setWorld(doc(ent('r', 'rug')));
    await sync.whenIdle();
    const node = sync.node('r')!;
    expect(materialOf(node.content)).toBe('/assets/lib/m/rug.lite.00000000.glb');
    expect(loader.calls).toEqual(['/assets/lib/m/rug.lite.00000000.glb']);
    expect(sync.upgradesPending).toBe(1);
    expect(sync.upgradeProgress()).toEqual({ done: 0, total: 1 });
    sync.updateUpgrades(null);
    await tick(10);
    expect(loader.calls).toHaveLength(1);
    allowed = true;
    loader.holdFull = true;
    sync.updateUpgrades(null);
    await tick(10);
    // Downloading: the light copy is still what is drawn.
    expect(materialOf(node.content)).toBe('/assets/lib/m/rug.lite.00000000.glb');
    expect(node.content.children).toHaveLength(1);
    expect(sync.upgradeProgress()).toEqual({ done: 0, total: 1 });
    loader.flush();
    await tick(20);
    expect(sync.upgradeProgress()).toEqual({ done: 1, total: 1 });
    expect(prepared).toHaveLength(1);
    expect(node.content.children).toEqual([prepared[0]]);
    expect(materialOf(node.content)).toBe('/assets/lib/m/rug.00000000.glb');
    expect(models.size).toBe(1);
    expect(sync.upgradesPending).toBe(0);
    sync.clear();
    expect(models.size).toBe(0);
  });

  it('small models, models without a light copy and the low tiers load one file', async () => {
    const { sync } = makeSync({ models, modelUpgrades: { allowed: () => true } });
    await sync.setWorld(doc(ent('m', 'mat'), ent('p', 'plain')));
    await sync.whenIdle();
    expect(loader.calls.sort()).toEqual(['/assets/lib/m/mat.00000000.glb', '/assets/lib/m/plain.00000000.glb']);
    expect(sync.upgradesPending).toBe(0);
    const low = makeSync({ models, liteModels: () => true, modelUpgrades: { allowed: () => true } }).sync;
    await low.setWorld(doc(ent('r', 'rug')));
    await low.whenIdle();
    expect(materialOf(low.node('r')!.content)).toBe('/assets/lib/m/rug.lite.00000000.glb');
    expect(low.upgradesPending).toBe(0);
  });

  it('without the option, the full file mounts at once (as before)', async () => {
    const { sync } = makeSync({ models });
    await sync.setWorld(doc(ent('r', 'rug')));
    await sync.whenIdle();
    expect(loader.calls).toEqual(['/assets/lib/m/rug.00000000.glb']);
  });

  it('upgrades the nearest file first, two at a time, copies of one file together', async () => {
    const { sync } = makeSync({ models, modelUpgrades: { allowed: () => true } });
    await sync.setWorld(doc(ent('far', 'rug3', 25), ent('near', 'rug', 2), ent('near-copy', 'rug', 3), ent('mid', 'rug2', 10)));
    await sync.whenIdle();
    loader.holdFull = true;
    loader.calls = [];
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 1.6, 0);
    camera.lookAt(0, 1.6, -10);
    sync.updateUpgrades(camera);
    await tick(10);
    expect(loader.calls).toEqual(['/assets/lib/m/rug.00000000.glb', '/assets/lib/m/rug2.00000000.glb']);
    loader.flush();
    await tick(20);
    expect(materialOf(sync.node('near')!.content)).toBe('/assets/lib/m/rug.00000000.glb');
    expect(materialOf(sync.node('near-copy')!.content)).toBe('/assets/lib/m/rug.00000000.glb');
    expect(loader.calls).toContain('/assets/lib/m/rug3.00000000.glb');
    loader.flush();
    await tick(20);
    expect(sync.upgradesPending).toBe(0);
  });

  it('drops the upgrade of a copy rebuilt or removed meanwhile', async () => {
    const { sync } = makeSync({ models, modelUpgrades: { allowed: () => true } });
    await sync.setWorld(doc(ent('r', 'rug')));
    await sync.whenIdle();
    loader.holdFull = true;
    sync.updateUpgrades(null);
    await tick(10);
    await sync.setWorld(doc());
    await sync.whenIdle();
    loader.flush();
    await tick(20);
    expect(models.size).toBe(0);
    // The dropped upgrade counts as settled: nothing is left to wait for.
    expect(sync.upgradeProgress()).toEqual({ done: 1, total: 1 });
  });

  it('counts copies settled, dropped before they start and failed alike', async () => {
    const q = new ModelUpgrades({ allowed: () => true });
    const alive = { a: true, b: true, c: true };
    const swapped: string[] = [];
    const item = (k: keyof typeof alive, fail = false) => ({
      live: () => alive[k],
      bounds: () => null,
      load: () => (fail ? Promise.reject(new Error('no file')) : Promise.resolve(() => void swapped.push(k))),
    });
    expect(q.progress()).toEqual({ done: 0, total: 0 });
    const a = item('a');
    q.request('f1', a);
    q.request('f1', a);
    q.request('f2', item('b', true));
    q.request('f3', item('c'));
    expect(q.progress()).toEqual({ done: 0, total: 3 });
    alive.c = false;
    q.update(null);
    await tick(10);
    expect(swapped).toEqual(['a']);
    expect(q.progress()).toEqual({ done: 3, total: 3 });
  });

  it('the queue holds far, out-of-view files until the view rests', () => {
    let resting = false;
    const q = new ModelUpgrades({ allowed: () => true, resting: () => resting });
    const started: string[] = [];
    q.request('far', { live: () => true, bounds: (s) => (s.center.set(0, 0, 200), (s.radius = 1), s), load: async () => (started.push('far'), null) });
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.lookAt(0, 0, -10);
    q.update(camera);
    expect(started).toEqual([]);
    resting = true;
    q.update(camera);
    expect(started).toEqual(['far']);
  });

  it('reports a weighted, fractional progress: stages of a loading file, bytes as weight, failures and drops whole', async () => {
    const q = new ModelUpgrades({ allowed: () => true });
    expect(q.fraction()).toBe(1);
    const reports: Array<(f: number) => void> = [];
    const finish: Array<() => void> = [];
    const item = (fail = false) => ({
      live: () => true,
      bounds: () => null,
      load: (report?: (f: number) => void) =>
        new Promise<(() => void) | null>((resolve, reject) => {
          reports.push(report!);
          finish.push(() => (fail ? reject(new Error('no file')) : resolve(null)));
        }),
    });
    // A big file (3 MB) and a small one (1 MB): the big one is worth three quarters.
    q.request('big', item(), 3_000_000);
    q.request('small', item(true), 1_000_000);
    expect(q.fraction()).toBe(0);
    q.update(null);
    await tick(5);
    reports[0]!(0.3);
    expect(q.fraction()).toBeCloseTo(0.75 * 0.3);
    // A lower report never takes it back.
    reports[0]!(0.1);
    expect(q.fraction()).toBeCloseTo(0.75 * 0.3);
    reports[0]!(UPGRADE_PREPARED);
    reports[1]!(0.5);
    expect(q.fraction()).toBeCloseTo(0.75 * UPGRADE_PREPARED + 0.25 * 0.5);
    // The small file fails: it counts whole.
    finish[1]!();
    await tick(5);
    expect(q.fraction()).toBeCloseTo(0.75 * UPGRADE_PREPARED + 0.25);
    finish[0]!();
    await tick(5);
    expect(q.fraction()).toBe(1);
    expect(q.progress()).toEqual({ done: 2, total: 2 });
  });

  it('creeps through a stage it cannot see inside (decode, prepare), never past it, and never backwards', async () => {
    let clock = 0;
    const q = new ModelUpgrades({ allowed: () => true, now: () => clock });
    let report: ((f: number) => void) | undefined;
    q.request('f', { live: () => true, bounds: () => null, load: (r) => ((report = r), new Promise(() => undefined)) });
    q.update(null);
    await tick(5);
    report!(0.3);
    clock = 20_000;
    // Mid-download the real bytes count, no estimate.
    expect(q.fraction()).toBeCloseTo(0.3);
    report!(UPGRADE_DOWNLOAD_SHARE);
    expect(q.fraction()).toBeCloseTo(UPGRADE_DOWNLOAD_SHARE);
    let last = q.fraction();
    for (const t of [21_000, 24_000, 30_000, 120_000]) {
      clock = t;
      const f = q.fraction();
      expect(f).toBeGreaterThanOrEqual(last);
      last = f;
    }
    // Far later it is near, but short of, the decoded mark.
    expect(last).toBeGreaterThan(UPGRADE_DOWNLOAD_SHARE + 0.15 * 0.9);
    expect(last).toBeLessThan(UPGRADE_DECODED);
    report!(UPGRADE_DECODED);
    expect(q.fraction()).toBeCloseTo(UPGRADE_DECODED);
  });

  it('without weights every file counts the same, and a dropped copy counts whole', async () => {
    const q = new ModelUpgrades({ allowed: () => true });
    let alive = true;
    q.request('a', { live: () => alive, bounds: () => null, load: async () => null });
    q.request('b', { live: () => true, bounds: () => null, load: () => new Promise(() => undefined) });
    expect(q.fraction()).toBe(0);
    alive = false;
    q.update(null);
    expect(q.fraction()).toBeCloseTo(0.5);
  });

  it('a full model load reports its download bytes through the cache and the sync', async () => {
    const seen: number[] = [];
    const bytesLoader: ModelLoader = {
      async load(url, onProgress) {
        if (!url.includes('.lite.')) {
          onProgress?.(0.25);
          onProgress?.(1);
        }
        const g = new Group();
        g.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ name: url })));
        return g;
      },
    };
    const cache = new ModelCache(bytesLoader);
    const { sync } = makeSync({ models: cache, modelUpgrades: { allowed: () => true } });
    await sync.setWorld(doc(ent('r', 'rug')));
    await sync.whenIdle();
    expect(sync.upgradeFraction()).toBe(0);
    sync.updateUpgrades(null);
    await tick(20);
    seen.push(sync.upgradeFraction());
    expect(seen[0]).toBe(1);
    cache.dispose();
  });
});
