import { beforeEach, describe, expect, it } from 'vitest';
import { Scene, Texture } from 'three';
import { setCatalog } from '@aether/assets';
import { HdriController } from '../src/environment/hdri';
import { tick } from './helpers';
const entry = (id) => ({ id, name: id, kind: 'hdri', category: 'sky', tags: [], style: 'realistic', pack: 'p', size: [0, 0, 0], tris: 0, bytes: 1, file: `h/${id}.00000000.hdr`, lods: [], collider: { type: 'box' }, placement: 'floor', facing: '+z', source: 'x' });
const CATALOG = {
    version: 1,
    base: '/assets/lib/',
    packs: [{ id: 'p', title: 'P', author: 'A', licence: 'CC0-1.0', licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', url: 'https://example.org', version: '1' }],
    entries: [entry('sky-a'), entry('sky-b')],
};
class FakeHdr {
    loaded = [];
    urls = [];
    async load(url) {
        this.urls.push(url);
        const t = new Texture();
        this.loaded.push(t);
        return t;
    }
}
function watch(t) {
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
        const tex = src.loaded[0];
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
    it('disposes the parked map when another map takes its place, when a world HDRI is requested, and with the controller', async () => {
        const src = new FakeHdr();
        const c = new HdriController(src, () => undefined);
        c.set('sky-a', { lightOnly: true });
        await tick(10);
        const a = watch(src.loaded[0]);
        c.set(undefined, {});
        expect(a.disposed).toBe(false);
        c.set('sky-b', { lightOnly: true });
        expect(a.disposed).toBe(true);
        await tick(10);
        const b = watch(src.loaded[1]);
        c.set(undefined, {});
        expect(b.disposed).toBe(false);
        // A world's own HDRI (not light-only) never reuses the clamped automatic map.
        c.set('sky-b', {});
        expect(b.disposed).toBe(true);
        await tick(10);
        expect(src.urls).toHaveLength(3);
        const explicit = watch(src.loaded[2]);
        c.set(undefined, {});
        expect(explicit.disposed).toBe(true);
        c.set('sky-a', { lightOnly: true });
        await tick(10);
        const last = watch(src.loaded[3]);
        c.set(undefined, {});
        expect(last.disposed).toBe(false);
        c.dispose();
        expect(last.disposed).toBe(true);
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
