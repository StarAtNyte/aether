/**
 * Progressive library models: a large model with a light copy mounts the copy, then (when the host allows) swaps in the
 * full file, nearest first, at most two files at a time, without a moment showing neither.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, type Object3D } from 'three';
import { createWorld, type EntityInput } from '@aether/core';
import { setCatalog, type CatalogInput } from '@aether/assets';
import { ModelCache, type ModelLoader } from '../src/geometry/model-loader';
import { ModelUpgrades } from '../src/sync/model-upgrades';
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
});
