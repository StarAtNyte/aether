/**
 * Allocation probe of the per-frame render path: every piece of
 * `WorldRenderer.render` / `applyTransforms` that runs each frame and can be
 * driven headless must allocate (almost) nothing in steady state. The probe
 * samples V8 allocations (collected objects included) and attributes them
 * to `packages/render/src` sources. three.js internals are not counted.
 */
import { describe, expect, it } from 'vitest';
import { Group, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Raycaster, Scene, Vector3 } from 'three';
import { createWorld } from '@aether/core';
import { CameraRig } from '../src/view/camera-rig';
import { FrameStats } from '../src/view/frame-stats';
import { GrowIn } from '../src/view/grow-in';
import { Highlighter } from '../src/view/highlighter';
import { AdaptiveResolution } from '../src/view/adaptive-resolution';
import { EnvironmentRig } from '../src/environment/environment-rig';
import { WeatherSystem } from '../src/environment/weather';
import { MaterialCache } from '../src/materials/material-cache';
import { accelerateRaycast, triangleBvh } from '../src/geometry/raycast-bvh';
import { describeSites, probeAllocations } from '../../../tests/unit/alloc-probe';
import { makeSync } from './helpers';
import { ProofReplay } from '../src/view/proof-replay';
import { BlueprintMarks } from '../src/view/blueprint';
const RENDER_SRC = /packages\/render\/src\//;
/** Sampling noise allowance per frame (bytes): the probe must find no real per-frame garbage. */
const BUDGET = process.env.CI ? 64 : 16;
function controls() {
    return { enabled: true, enableDamping: true, dampingFactor: 0.1, target: new Vector3(), update: () => true, dispose() { } };
}
describe('render loop allocation probe', () => {
    it('SceneSync.applyTransforms (500 bodies, some parented) allocates nothing per frame', async () => {
        const { sync } = makeSync();
        const ents = [{ id: 'holder', transform: { position: [5, 0, 0], rotation: [0, 30, 0] } }];
        for (let i = 0; i < 500; i++)
            ents.push({ id: `b-${i}`, transform: { position: [i, 0.5, 0] }, shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] }, ...(i % 5 === 0 ? { parent: 'holder' } : {}) });
        const map = {};
        for (const e of ents)
            map[e.id] = e;
        await sync.setWorld(createWorld({ entities: map }));
        const order = ents.slice(1).map((e) => e.id);
        const packed = new Float32Array(order.length * 7);
        for (let i = 0; i < order.length; i++) {
            packed[i * 7] = i;
            packed[i * 7 + 6] = 1;
        }
        let f = 0;
        const r = await probeAllocations(() => {
            packed[1] = Math.sin(f++);
            sync.applyTransforms(packed, order);
        }, { iterations: 400, warmup: 4000, match: RENDER_SRC });
        expect(r.bytesPerIteration, describeSites(r)).toBeLessThan(BUDGET);
    });
    it('static-prop batch updates (200 instanced posts, one moving) allocate nothing per frame', async () => {
        const { sync } = makeSync();
        const map = {};
        for (let i = 0; i < 200; i++)
            map[`post-${i}`] = { id: `post-${i}`, transform: { position: [i, 0.5, 0] }, shape: { kind: 'primitive', primitive: 'box', size: [0.3, 1, 0.3] }, physics: { body: 'static' } };
        await sync.setWorld(createWorld({ entities: map }));
        sync.root.updateMatrixWorld(true);
        sync.updateBatches();
        expect(sync.batchStats().drawCallsSaved).toBe(199);
        const mover = sync.object('post-7');
        let t = 0;
        const r = await probeAllocations(() => {
            mover.position.y = Math.sin((t += 0.1));
            mover.updateMatrix();
            sync.root.updateMatrixWorld();
            sync.updateBatches();
        }, { iterations: 300, warmup: 3000, match: RENDER_SRC });
        expect(r.bytesPerIteration, describeSites(r)).toBeLessThan(BUDGET);
    });
    it('scatter-field and virtual-geometry view planning (moving camera) allocate nothing per frame', async () => {
        const { createProcgenGeometrySource } = await import('../src/geometry/procgen-source');
        const { sync } = makeSync({ source: createProcgenGeometrySource(), fields: { maxInstances: 200_000, triangles: 400_000 }, virtual: { triangles: 300_000, dag: { createWorker: null } } });
        await sync.setWorld(createWorld({
            entities: {
                forest: { id: 'forest', shape: { kind: 'scatter', of: { kind: 'procedural', generator: 'tree-pine' }, count: 50_000, area: [600, 600], seed: 2 } },
                stone: { id: 'stone', shape: { kind: 'procedural', generator: 'colossus', params: { detail: 1 } } },
                'stone-2': { id: 'stone-2', transform: { position: [20, 0, 0] }, shape: { kind: 'procedural', generator: 'colossus', params: { detail: 1 } } },
            },
        }));
        await sync.whenIdle();
        for (let i = 0; i < 100 && sync.virtualStats().instances < 2; i++)
            await new Promise((r) => setTimeout(r, 20));
        expect(sync.virtualStats().instances).toBe(2);
        const cam = new PerspectiveCamera(55, 1.6, 0.1, 3000);
        let t = 0;
        const r = await probeAllocations(() => {
            t += 0.05;
            cam.position.set(Math.cos(t) * 60, 12, Math.sin(t) * 60);
            cam.lookAt(0, 0, 0);
            cam.updateMatrixWorld();
            sync.updateView(cam, 900);
        }, { iterations: 200, warmup: 400, match: RENDER_SRC });
        expect(r.bytesPerIteration, describeSites(r)).toBeLessThan(BUDGET);
    });
    it('camera rig (orbit + follow), grow-in, highlighter, stats and adaptive resolution allocate nothing per frame', async () => {
        const cam = new PerspectiveCamera(50, 1, 0.1, 1000);
        const orbit = new CameraRig(cam, controls());
        const followCam = new PerspectiveCamera(50, 1, 0.1, 1000);
        const follow = new CameraRig(followCam, controls());
        const target = new Group();
        target.position.set(3, 0, 4);
        follow.setMode('follow', (out) => {
            out.copy(target.position);
            return 30;
        });
        const grow = new GrowIn();
        const parent = new Group();
        const kids = Array.from({ length: 50 }, () => new Mesh());
        parent.add(...kids);
        for (const k of kids)
            grow.start(k, 0, false);
        const hl = new Highlighter();
        hl.set(['a'], () => kids[0]);
        const stats = new FrameStats();
        const adaptive = new AdaptiveResolution();
        let t = 0;
        const r = await probeAllocations(() => {
            t += 1 / 60;
            target.position.x = Math.sin(t) * 5;
            orbit.update(1 / 60);
            follow.update(1 / 60);
            grow.update(1 / 600);
            hl.update();
            stats.record(1 / 60, 2);
            adaptive.record(1 / 60, true);
        }, { iterations: 400, match: RENDER_SRC });
        expect(r.bytesPerIteration, describeSites(r)).toBeLessThan(BUDGET);
    });
    it('environment and weather updates allocate nothing per frame', async () => {
        const rig = new EnvironmentRig(new MaterialCache(), true);
        const scene = new Scene();
        scene.add(rig.group);
        rig.apply(createWorld({ environment: { sky: 'night', weather: 'fireflies' } }).environment, scene);
        const weather = new WeatherSystem(new Group());
        weather.set('rain');
        const cam = new PerspectiveCamera();
        let t = 0;
        const r = await probeAllocations(() => {
            t += 1 / 60;
            cam.position.set(Math.sin(t) * 10, 5, Math.cos(t) * 10);
            rig.update(1 / 60, cam);
            weather.update(1 / 60, cam);
        }, 
        // The 5000-particle loop optimizes quickly; a long warmup would only cost test time.
        { iterations: 300, warmup: 1500, match: RENDER_SRC });
        expect(r.bytesPerIteration, describeSites(r)).toBeLessThan(BUDGET);
        weather.dispose();
        rig.dispose();
    });
    it('a BVH raycast miss (camera occlusion test on a clear line) allocates nothing', async () => {
        const g = new PlaneGeometry(40, 40, 64, 64);
        g.rotateX(-Math.PI / 2);
        g.computeBoundingSphere();
        const mesh = new Mesh(g, new MeshBasicMaterial());
        accelerateRaycast(mesh, null);
        mesh.updateMatrixWorld(true);
        triangleBvh(g);
        // A ray that enters the bounding sphere but passes above the surface.
        const ray = new Raycaster(new Vector3(-30, 1, 0), new Vector3(1, 0, 0));
        const hits = [];
        const r = await probeAllocations(() => {
            mesh.raycast(ray, hits);
        }, { iterations: 500, warmup: 30_000, match: RENDER_SRC });
        expect(hits).toHaveLength(0);
        expect(r.bytesPerIteration, describeSites(r)).toBeLessThan(BUDGET);
    });
    it('building views and merged building geometry allocate nothing per frame in steady state', async () => {
        const { compileBuilding } = await import('@aether/arch');
        const { applyPatches } = await import('@aether/core');
        const { ArchView } = await import('../src/view/arch-view');
        const b = compileBuilding({ id: 'flat', levels: [{ rooms: [{ id: 'living', type: 'living', rect: [0, 0, 7, 5] }, { id: 'bed', type: 'bedroom', rect: [7, 0, 11, 5] }], doors: [{ between: ['living', 'outside'], main: true }, { between: ['living', 'bed'] }] }] });
        const w = applyPatches(createWorld(), b.patches).world;
        const { sync } = makeSync();
        await sync.setWorld(w);
        // Furniture are library assets: wait for the catalog and their (fallback) builds to settle.
        await sync.whenIdle();
        for (let i = 0; i < 10; i++)
            await Promise.resolve();
        const view = new ArchView(sync);
        view.set({ walls: 'down', xray: false });
        const cam = new PerspectiveCamera(50, 1.5, 0.1, 500);
        cam.position.set(20, 15, 20);
        cam.updateMatrixWorld();
        view.update(cam, 0);
        // Let the sectioned walls finish rebuilding, then settle the merges before measuring.
        await new Promise((r) => setTimeout(r, 0));
        for (let i = 0; i < 100; i++)
            await Promise.resolve();
        const pending = [];
        sync.forEachNode((n) => pending.push(n.ready));
        await Promise.all(pending);
        await sync.whenIdle();
        sync.root.updateMatrixWorld(true);
        for (let i = 0; i < 3; i++) {
            view.update(cam, 0.016);
            sync.updateBatches();
        }
        const r = await probeAllocations(() => {
            view.update(cam, 0.016);
            sync.updateBatches();
        }, { iterations: 400, warmup: 3000, match: RENDER_SRC });
        expect(sync.batchStats().merges).toBeGreaterThan(0);
        expect(r.bytesPerIteration, describeSites(r)).toBeLessThan(BUDGET);
        view.dispose();
    });
    it('proof replay playback (16 ghosts, trails) and blueprint fades allocate nothing per frame', async () => {
        const { sync } = makeSync();
        const ids = Array.from({ length: 16 }, (_, i) => `g-${i}`);
        const map = {};
        for (const id of ids)
            map[id] = { id, shape: { kind: 'primitive', primitive: 'box', size: [0.2, 1, 0.5] }, physics: { body: 'dynamic' } };
        const world = createWorld({ entities: map });
        const frames = 241;
        const poses = new Float32Array(frames * ids.length * 7);
        for (let f = 0; f < frames; f++)
            for (let b = 0; b < ids.length; b++) {
                const o = (f * ids.length + b) * 7;
                poses[o] = b + f * 0.01;
                poses[o + 1] = 0.5;
                poses[o + 6] = 1;
            }
        const replay = new ProofReplay(() => sync);
        expect(await replay.start(world, { ids, dt: 1 / 30, frames, poses })).toBe(true);
        const marks = new BlueprintMarks();
        marks.show(ids.map((_, i) => ({ min: [i, 0, 0], max: [i + 1, 1, 1] })));
        const r = await probeAllocations(() => {
            replay.update(1e-5);
            marks.update(1e-6);
        }, { iterations: 400, warmup: 20_000, match: RENDER_SRC });
        expect(replay.state).toBe('play');
        expect(r.bytesPerIteration, describeSites(r)).toBeLessThan(BUDGET);
        replay.dispose();
        marks.dispose();
    });
});
