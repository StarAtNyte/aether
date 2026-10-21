import { beforeEach, describe, expect, it } from 'vitest';
import { Texture } from 'three';
import { setCatalog, type CatalogInput } from '@aether/assets';
import { HdriController, type HdriSource } from '../src/environment/hdri';
import { tick } from './helpers';

const CATALOG: CatalogInput = {
  version: 1,
  base: '/assets/lib/',
  packs: [{ id: 'p', title: 'P', author: 'A', licence: 'CC0-1.0', licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', url: 'https://example.org', version: '1' }],
  entries: [{ id: 'sky-a', name: 'A', kind: 'hdri', category: 'sky', tags: [], style: 'realistic', pack: 'p', size: [0, 0, 0], tris: 0, bytes: 1, file: 'h/sky-a.00000000.hdr', lods: [], collider: { type: 'box' }, placement: 'floor', facing: '+z', source: 'x' }],
};

/** A source whose load finishes when the test says so. */
function gated(): { source: HdriSource; finish(): void; fail(): void } {
  let ok: (t: Texture) => void = () => undefined;
  let bad: (e: Error) => void = () => undefined;
  return {
    source: { load: () => new Promise<Texture>((resolve, reject) => ((ok = resolve), (bad = reject))) },
    finish: () => ok(new Texture()),
    fail: () => bad(new Error('offline')),
  };
}

describe('HDRI settled', () => {
  beforeEach(() => setCatalog(CATALOG));

  it('resolves at once when nothing is loading', async () => {
    const c = new HdriController(gated().source, () => undefined);
    await expect(c.settled(10_000)).resolves.toBeUndefined();
  });

  it('waits for the requested map, then resolves', async () => {
    const g = gated();
    const c = new HdriController(g.source, () => undefined);
    c.set('sky-a', {});
    let done = false;
    void c.settled(10_000).then(() => (done = true));
    await tick(10);
    expect(done).toBe(false);
    g.finish();
    await tick(10);
    expect(done).toBe(true);
    expect(c.texture).not.toBeNull();
  });

  it('resolves when the load fails', async () => {
    const g = gated();
    const c = new HdriController(g.source, () => undefined);
    c.set('sky-a', {});
    let done = false;
    void c.settled(10_000).then(() => (done = true));
    await tick(10);
    g.fail();
    await tick(10);
    expect(done).toBe(true);
    expect(c.error).toBe('offline');
  });

  it('gives up after the timeout', async () => {
    const c = new HdriController(gated().source, () => undefined);
    c.set('sky-a', {});
    const started = Date.now();
    await c.settled(30);
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });
});
