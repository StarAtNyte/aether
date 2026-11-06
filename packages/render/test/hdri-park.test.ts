import { beforeEach, describe, expect, it } from 'vitest';
import { Scene, Texture } from 'three';
import { setCatalog, type CatalogInput } from '@aether/assets';
import { HdriController, type HdriSource } from '../src/environment/hdri';
import { tick } from './helpers';

const entry = (id: string) => ({ id, name: id, kind: 'hdri' as const, category: 'sky' as const, tags: [], style: 'realistic' as const, pack: 'p', size: [0, 0, 0] as [number, number, number], tris: 0, bytes: 1, file: `h/${id}.00000000.hdr`, lods: [], collider: { type: 'box' as const }, placement: 'floor' as const, facing: '+z' as const, source: 'x' });
const CATALOG: CatalogInput = {
  version: 1,
  base: '/assets/lib/',
  packs: [{ id: 'p', title: 'P', author: 'A', licence: 'CC0-1.0', licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', url: 'https://example.org', version: '1' }],
  entries: [entry('sky-a'), entry('sky-b'), entry('sky-c'), entry('sky-d')],
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

function watch(t: Texture): { disposed: boolean } {
  const state = { disposed: false };
  t.addEventListener('dispose', () => (state.disposed = true));
  return state;
}

describe('automatic HDRI parking', () => {
  beforeEach(() => setCatalog(CATALOG));

  it('keeps an automatic map when it is switched off and brings the same texture back without loading again', async () => {
    const src = new FakeHdr();
    const c = new HdriController(src, () => undefined);
    const scene = new Scene();
    c.set('sky-a', { lightOnly: true });
    await tick(10);
    const tex = src.loaded[0]!;
    const state = watch(tex);
    expect(c.bind(scene, 1)).toBe(true);
    c.set(undefined, {});
    expect(c.texture).toBeNull();
    expect(scene.environment).toBeNull();
    expect(state.disposed).toBe(false);
    c.set('sky-a', { lightOnly: true });
    expect(c.texture).toBe(tex);
    expect(src.urls).toHaveLength(1);
    expect(c.bind(scene, 1)).toBe(true);
    expect(scene.environment).toBe(tex);
    // Many tier switches: still one load, one texture.
    for (let i = 0; i < 5; i++) {
      c.set(undefined, {});
      c.set('sky-a', { lightOnly: true });
    }
    expect(src.urls).toHaveLength(1);
    expect(state.disposed).toBe(false);
  });

  it('disposes the oldest parked map when the park is full, every parked map when a world HDRI is requested, and with the controller', async () => {
    const src = new FakeHdr();
    const c = new HdriController(src, () => undefined);
    c.set('sky-a', { lightOnly: true });
    await tick(10);
    const a = watch(src.loaded[0]!);
    c.set(undefined, {});
    expect(a.disposed).toBe(false);
    c.set('sky-b', { lightOnly: true });
    expect(a.disposed).toBe(false);
    await tick(10);
    const b = watch(src.loaded[1]!);
    c.set('sky-c', { lightOnly: true });
    await tick(10);
    const cc = watch(src.loaded[2]!);
    c.set('sky-d', { lightOnly: true });
    await tick(10);
    // a, b and c were shown in turn: two of them stay parked (PARK_CAP), the oldest went.
    expect(a.disposed).toBe(true);
    expect(b.disposed).toBe(false);
    expect(cc.disposed).toBe(false);
    c.set('sky-b', { lightOnly: true });
    expect(c.texture).toBe(src.loaded[1]);
    expect(src.urls).toHaveLength(4);
    c.set(undefined, {});
    expect(b.disposed).toBe(false);
    // A world's own HDRI (not light-only) never reuses the clamped automatic maps.
    c.set('sky-b', {});
    expect(b.disposed).toBe(true);
    expect(cc.disposed).toBe(true);
    await tick(10);
    expect(src.urls).toHaveLength(5);
    const explicit = watch(src.loaded[4]!);
    c.set(undefined, {});
    expect(explicit.disposed).toBe(true);
    c.set('sky-a', { lightOnly: true });
    await tick(10);
    const last = watch(src.loaded[5]!);
    c.set(undefined, {});
    expect(last.disposed).toBe(false);
    c.dispose();
    expect(last.disposed).toBe(true);
  });

  it('keeps the shown automatic map bound until the next one has arrived, then parks it', async () => {
    const src = new FakeHdr();
    const changes: Array<Texture | null> = [];
    const scene = new Scene();
    const c: HdriController = new HdriController(src, () => {
      c.bind(scene, 1);
      changes.push(c.texture);
    });
    c.set('sky-a', { lightOnly: true });
    await tick(10);
    const a = src.loaded[0]!;
    expect(scene.environment).toBe(a);
    c.set('sky-b', { lightOnly: true });
    // Loading: the scene keeps sky-a (no interval on the analytic sky, one change of environment).
    expect(scene.environment).toBe(a);
    expect(c.texture).toBe(a);
    expect(c.requested).toBe('sky-b');
    await tick(10);
    const b = src.loaded[1]!;
    expect(scene.environment).toBe(b);
    expect(changes).toEqual([a, b]);
    // Back to a: straight from the park, no load.
    c.set('sky-a', { lightOnly: true });
    expect(scene.environment).toBe(a);
    expect(src.urls).toHaveLength(2);
    // A request for b, then a again before b arrives: a stays, the late b is discarded.
    c.set('sky-c', { lightOnly: true });
    c.set('sky-a', { lightOnly: true });
    await tick(10);
    expect(c.texture).toBe(a);
    expect(src.urls).toHaveLength(3);
    c.dispose();
  });

  it('a switch while the map is still loading does not park or leak anything', async () => {
    const src = new FakeHdr();
    const c = new HdriController(src, () => undefined);
    c.set('sky-a', { lightOnly: true });
    c.set(undefined, {});
    await tick(10);
    // The late load was discarded (disposed), nothing is bound or parked.
    expect(src.loaded[0] ? watch(src.loaded[0]).disposed : false).toBe(false);
    expect(c.texture).toBeNull();
    c.dispose();
  });
});
