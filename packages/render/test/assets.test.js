/**
 * Library / imported assets in the scene graph: model mounting with sized
 * placeholders, the fallback chain, LOD chains sharing materials, posters,
 * refcounted release, locomotion animation (and its zero-allocation frame).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AnimationClip, BoxGeometry, Group, LOD, Mesh, MeshStandardMaterial, NumberKeyframeTrack, Object3D, Texture } from 'three';
import { createWorld } from '@aether/core';
import { registerUserAsset, setCatalog, unregisterUserAsset } from '@aether/assets';
import { ModelCache } from '../src/geometry/model-loader';
import { TextureCache } from '../src/geometry/poster';
import { AssetAnimator, gaitFor } from '../src/sync/asset-animator';
import { describeSites, probeAllocations } from '../../../tests/unit/alloc-probe';
import { makeSync, tick } from './helpers';
const CATALOG = {
    version: 1,
    base: '/assets/lib/',
    packs: [{ id: 'p', title: 'P', author: 'A', licence: 'CC0-1.0', licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', url: 'https://example.org', version: '1' }],
    entries: [
        { id: 'chair', name: 'Chair', kind: 'model', category: 'furniture', tags: [], style: 'low-poly', pack: 'p', size: [0.5, 1, 0.5], tris: 12, bytes: 1, file: 'm/chair.00000000.glb', lods: [], collider: { type: 'box' }, placement: 'floor', facing: '+z', source: 'x' },
        { id: 'statue', name: 'Statue', kind: 'model', category: 'decor', tags: [], style: 'realistic', pack: 'p', size: [1, 2, 1], tris: 9000, bytes: 1, file: 'm/statue.00000000.glb', lods: [{ file: 'm/statue.lod1.00000000.glb', tris: 4500 }, { file: 'm/statue.lod2.00000000.glb', tris: 1300 }], collider: { type: 'box' }, placement: 'floor', facing: '+z', source: 'x' },
        { id: 'walker', name: 'Walker', kind: 'model', category: 'characters', tags: [], style: 'stylised', pack: 'p', size: [1, 1.8, 0.5], tris: 12, bytes: 1, file: 'm/walker.00000000.glb', lods: [], collider: { type: 'capsule' }, placement: 'floor', facing: '-z', anims: { idle: 'idle', walk: 'walk', run: 'run', clips: ['idle', 'walk', 'run'] }, source: 'x' },
        { id: 'sky', name: 'Sky', kind: 'hdri', category: 'sky', tags: [], style: 'realistic', pack: 'p', size: [0, 0, 0], tris: 0, bytes: 1, file: 'h/sky.00000000.hdr', lods: [], collider: { type: 'box' }, placement: 'floor', facing: '+z', source: 'x' },
        { id: 'hero', name: 'Hero', kind: 'generator', category: 'props', tags: [], style: 'stylised', pack: 'p', size: [1, 1, 1], tris: 0, bytes: 0, lods: [], collider: { type: 'box' }, placement: 'floor', facing: '+z', generator: { id: 'hero-gen', params: { a: 1 } }, source: 'x' },
    ],
};
function clip(name) {
    return new AnimationClip(name, 1, [new NumberKeyframeTrack('.position[x]', [0, 1], [0, 0.01])]);
}
/** Fake glTF loader: a group with one mesh per file; the walker gets three clips. Deferred on demand. */
class FakeLoader {
    calls = [];
    defer = false;
    waiting = [];
    async load(url) {
        this.calls.push(url);
        if (url.includes('fail'))
            throw new Error('404');
        if (this.defer)
            await new Promise((r) => this.waiting.push(r));
        const g = new Group();
        const m = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ name: url }));
        m.name = 'body';
        g.add(m);
        if (url.includes('walker'))
            g.animations = [clip('idle'), clip('walk'), clip('run')];
        return g;
    }
    flush() {
        for (const w of this.waiting.splice(0))
            w();
    }
}
class FakeTextures {
    async load() {
        return new Texture();
    }
}
const ent = (id, assetId, extra = {}) => ({ id, shape: { kind: 'asset', id: assetId }, ...extra });
const doc = (...entities) => createWorld({ entities: Object.fromEntries(entities.map((e) => [e.id, e])) });
function meshes(root) {
    const out = [];
    root.traverse((o) => {
        if (o instanceof Mesh)
            out.push(o);
    });
    return out;
}
let loader;
let models;
let textures;
beforeEach(() => {
    setCatalog(CATALOG);
    loader = new FakeLoader();
    models = new ModelCache(loader);
    textures = new TextureCache(new FakeTextures());
});
afterEach(() => {
    models.dispose();
    textures.dispose();
});
describe('asset shapes in SceneSync', () => {
    it('shows a placeholder of the asset size while loading, then the model', async () => {
        loader.defer = true;
        const { sync } = makeSync({ models, textures });
        await sync.setWorld(doc(ent('c', 'chair')));
        await tick(10);
        const node = sync.node('c');
        const placeholder = node.content.children.find((o) => o.name === 'placeholder');
        expect(placeholder.scale.toArray()).toEqual([0.5, 1, 0.5]);
        loader.flush();
        await sync.whenIdle();
        expect(node.content.children.some((o) => o.name === 'placeholder')).toBe(false);
        expect(node.content.children[0]?.name).toBe('asset');
        expect(meshes(node.content)).toHaveLength(1);
        expect(sync.getWarnings().size).toBe(0);
    });
    it('applies fitSize as a uniform scale', async () => {
        const { sync } = makeSync({ models, textures });
        await sync.setWorld(doc({ id: 'c', shape: { kind: 'asset', id: 'chair', fitSize: 2 } }));
        await sync.whenIdle();
        const inner = sync.node('c').content.children[0].children[0];
        expect(inner.scale.x).toBeCloseTo(2, 5);
    });
    it('fallback chain: shape fallback, else a stand-in box, with a warning', async () => {
        const { sync } = makeSync({ models, textures });
        await sync.setWorld(doc({ id: 'a', shape: { kind: 'asset', id: 'missing', fallback: { kind: 'primitive', primitive: 'sphere', size: [1, 1, 1] } } }, ent('b', 'missing'), ent('s', 'sky')));
        await sync.whenIdle();
        expect(sync.node('a').failed).toBe(true);
        expect(sync.node('a').keyed?.output.parts.length).toBeGreaterThan(0);
        expect(sync.node('b').content.children.some((o) => o.name === 'placeholder')).toBe(true);
        expect(sync.getWarnings().get('b')).toContain('not available');
        expect(sync.getWarnings().get('s')).toContain('is a sky, not an object');
    });
    it('a load failure falls back instead of leaving a hole', async () => {
        setCatalog({ ...CATALOG, entries: [{ ...CATALOG.entries[0], file: 'm/fail.00000000.glb' }] });
        const { sync } = makeSync({ models, textures });
        await sync.setWorld(doc({ id: 'c', shape: { kind: 'asset', id: 'chair', fallback: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] } } }));
        await sync.whenIdle();
        expect(sync.node('c').failed).toBe(true);
        expect(sync.getWarnings().get('c')).toContain('404');
        expect(models.size).toBe(0);
    });
    it('generator assets mount their procedural shape', async () => {
        const { sync, source } = makeSync({ models, textures });
        await sync.setWorld(doc(ent('h', 'hero')));
        await sync.whenIdle();
        expect(source.proceduralCalls).toBe(1);
        expect(sync.node('h').keyed).not.toBeNull();
    });
    it('builds an LOD chain whose lower levels reuse the full-detail materials', async () => {
        const { sync } = makeSync({ models, textures });
        await sync.setWorld(doc(ent('s', 'statue')));
        await sync.whenIdle();
        const lod = sync.node('s').content.children[0];
        expect(lod).toBeInstanceOf(LOD);
        expect(lod.levels).toHaveLength(3);
        expect(lod.levels[1].distance).toBeGreaterThan(0);
        expect(lod.levels[2].distance).toBeGreaterThan(lod.levels[1].distance);
        const m0 = meshes(lod.levels[0].object)[0].material;
        for (const l of lod.levels)
            expect(meshes(l.object)[0].material).toBe(m0);
        expect(loader.calls.sort()).toEqual(['/assets/lib/m/statue.00000000.glb', '/assets/lib/m/statue.lod1.00000000.glb', '/assets/lib/m/statue.lod2.00000000.glb']);
    });
    it('releases model references when entities go away (shared per URL)', async () => {
        const { sync } = makeSync({ models, textures });
        await sync.setWorld(doc(ent('a', 'chair'), ent('b', 'chair'), ent('s', 'statue')));
        await sync.whenIdle();
        expect(models.size).toBe(4);
        expect(loader.calls.filter((u) => u.includes('chair'))).toHaveLength(1);
        await sync.setWorld(doc(ent('a', 'chair')));
        await sync.whenIdle();
        expect(models.size).toBe(1);
        sync.clear();
        expect(models.size).toBe(0);
    });
    it('imported images become framed posters; their textures are released', async () => {
        registerUserAsset({ meta: { id: 'user-0123456789ab', kind: 'image', name: 'Poster', mime: 'image/png', bytes: 10, width: 400, height: 200, createdAt: 1 }, url: 'blob:poster' });
        const { sync } = makeSync({ models, textures });
        await sync.setWorld(doc(ent('p', 'user-0123456789ab')));
        await sync.whenIdle();
        const poster = sync.node('p').content.children[0];
        expect(poster.name).toBe('poster');
        expect(meshes(poster)).toHaveLength(2);
        expect(textures.size).toBe(1);
        sync.clear();
        expect(textures.size).toBe(0);
        unregisterUserAsset('user-0123456789ab');
    });
    it('refreshAssets re-mounts entities once a user import is registered', async () => {
        const { sync } = makeSync({ models, textures });
        await sync.setWorld(doc(ent('u', 'user-aaaaaaaaaaaa')));
        await sync.whenIdle();
        expect(sync.node('u').failed).toBe(true);
        registerUserAsset({ meta: { id: 'user-aaaaaaaaaaaa', kind: 'model', name: 'U', mime: 'model/gltf-binary', bytes: 10, size: [1, 1, 1], createdAt: 1 }, url: 'blob:model' });
        expect(sync.refreshAssets(new Set(['user-aaaaaaaaaaaa']))).toBe(1);
        await sync.whenIdle();
        expect(sync.node('u').failed).toBe(false);
        expect(loader.calls).toContain('blob:model');
        unregisterUserAsset('user-aaaaaaaaaaaa');
    });
});
describe('asset animation', () => {
    it('maps speed to gaits', () => {
        expect(gaitFor(0)).toBe('idle');
        expect(gaitFor(1.4)).toBe('walk');
        expect(gaitFor(5)).toBe('run');
    });
    it('animated assets register with the animator and follow their movement', async () => {
        const { sync } = makeSync({ models, textures });
        await sync.setWorld(doc(ent('w', 'walker', { transform: { position: [0, 0, 0] } })));
        await sync.whenIdle();
        expect(sync.animatedCount).toBe(1);
        expect(sync.gaitOf('w')).toBe('idle');
        const obj = sync.object('w');
        const step = (speed, frames) => {
            for (let i = 0; i < frames; i++) {
                obj.position.z -= speed / 60;
                obj.updateMatrix(); // entity objects do not auto-update (the sync writes their matrices)
                obj.updateMatrixWorld(true);
                sync.updateAnimations(1 / 60);
            }
        };
        step(1.5, 60);
        expect(sync.gaitOf('w')).toBe('walk');
        step(6, 60);
        expect(sync.gaitOf('w')).toBe('run');
        step(0, 90);
        expect(sync.gaitOf('w')).toBe('idle');
        await sync.setWorld(doc());
        expect(sync.animatedCount).toBe(0);
    });
    it('a named clip loops regardless of movement; "none" does not animate', async () => {
        const { sync } = makeSync({ models, textures });
        await sync.setWorld(doc({ id: 'a', shape: { kind: 'asset', id: 'walker', animation: 'run' } }, { id: 'b', shape: { kind: 'asset', id: 'walker', animation: 'none' } }));
        await sync.whenIdle();
        expect(sync.animatedCount).toBe(1);
        expect(sync.gaitOf('a')).toBe('idle');
    });
    it('the animator frame allocates nothing (20 walkers)', async () => {
        const animator = new AssetAnimator();
        const roots = [];
        for (let i = 0; i < 20; i++) {
            const root = new Group();
            root.add(new Object3D());
            root.animations = [clip('idle'), clip('walk'), clip('run')];
            const tracked = new Object3D();
            animator.add(`w${i}`, root, tracked, { idle: 'idle', walk: 'walk', run: 'run' }, undefined);
            roots.push(tracked);
        }
        let t = 0;
        const r = await probeAllocations(() => {
            t += 1 / 60;
            for (let i = 0; i < roots.length; i++) {
                const o = roots[i];
                o.position.x = Math.sin(t + i) * 3;
                o.updateMatrixWorld();
            }
            animator.update(1 / 60);
        }, 
        // A long warm-up: on a busy machine 3000 runs left update() in baseline code, which boxes
        // doubles that the optimized code keeps unboxed (intermittent failures under the full suite).
        { iterations: 400, warmup: 12_000, match: /packages\/render\/src\/sync\/asset-animator/ });
        expect(r.bytesPerIteration, describeSites(r)).toBeLessThan(16);
    });
});
