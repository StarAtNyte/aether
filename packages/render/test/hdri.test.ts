import { beforeEach, describe, expect, it } from 'vitest';
import { Scene, Texture } from 'three';
import { setCatalog, type CatalogInput } from '@aether/assets';
import { HdriController, type HdriSource } from '../src/environment/hdri';
import { tick } from './helpers';

const CATALOG: CatalogInput = {
  version: 1,
  base: '/assets/lib/',
  packs: [{ id: 'p', title: 'P', author: 'A', licence: 'CC0-1.0', licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', url: 'https://example.org', version: '1' }],
  entries: [
    { id: 'sky-a', name: 'A', kind: 'hdri', category: 'sky', tags: [], style: 'realistic', pack: 'p', size: [0, 0, 0], tris: 0, bytes: 1, file: 'h/sky-a.00000000.hdr', lods: [], collider: { type: 'box' }, placement: 'floor', facing: '+z', source: 'x' },
    { id: 'sky-b', name: 'B', kind: 'hdri', category: 'sky', tags: [], style: 'realistic', pack: 'p', size: [0, 0, 0], tris: 0, bytes: 1, file: 'h/sky-b.00000000.hdr', lods: [], collider: { type: 'box' }, placement: 'floor', facing: '+z', source: 'x' },
    { id: 'chair', name: 'Chair', kind: 'model', category: 'furniture', tags: [], style: 'low-poly', pack: 'p', size: [1, 1, 1], tris: 1, bytes: 1, file: 'm/chair.00000000.glb', lods: [], collider: { type: 'box' }, placement: 'floor', facing: '+z', source: 'x' },
  ],
};

class FakeHdr implements HdriSource {
  loaded: Texture[] = [];
  urls: string[] = [];
  async load(url: string): Promise<Texture> {
    this.urls.push(url);
    const t = new Texture();
    this.loaded.push(t);
    return t;
  }
}

describe('HDRI environment', () => {
  beforeEach(() => setCatalog(CATALOG));

  it('loads a library HDRI and binds lighting + background', async () => {
    const src = new FakeHdr();
    let changes = 0;
    const c = new HdriController(src, () => changes++);
    const scene = new Scene();
    c.set('sky-a', { intensity: 2 });
    expect(c.bind(scene, 1)).toBe(false);
    await tick(10);
    expect(src.urls).toEqual(['/assets/lib/h/sky-a.00000000.hdr']);
    expect(changes).toBe(1);
    expect(c.bind(scene, 0.5)).toBe(true);
    expect(scene.environment).toBe(src.loaded[0]);
    expect(scene.background).toBe(src.loaded[0]);
    expect(scene.environmentIntensity).toBeCloseTo(1, 6);
    c.set('sky-a', { background: false });
    c.bind(scene, 1);
    expect(scene.background).toBeNull();
    expect(c.showsBackground).toBe(false);
  });

  it('switching or clearing unbinds and disposes the previous map', async () => {
    const src = new FakeHdr();
    const c = new HdriController(src, () => undefined);
    const scene = new Scene();
    c.set('sky-a', {});
    await tick(10);
    c.bind(scene, 1);
    let disposed = 0;
    src.loaded[0]!.addEventListener('dispose', () => disposed++);
    c.set('sky-b', {});
    expect(disposed).toBe(1);
    expect(scene.environment).toBeNull();
    await tick(10);
    c.bind(scene, 1);
    expect(scene.environment).toBe(src.loaded[1]);
    c.set(undefined, {});
    expect(scene.environment).toBeNull();
    expect(c.texture).toBeNull();
  });

  it('rejects ids that are not HDRIs and drops stale loads', async () => {
    const src = new FakeHdr();
    const c = new HdriController(src, () => undefined);
    c.set('chair', {});
    await tick(10);
    expect(c.texture).toBeNull();
    expect(c.error).toContain('not an HDR');
    c.set('sky-a', {});
    c.set('sky-b', {});
    await tick(10);
    expect(c.texture).toBe(src.loaded.at(-1));
    c.dispose();
    expect(c.texture).toBeNull();
  });
});
