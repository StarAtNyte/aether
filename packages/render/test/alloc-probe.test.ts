/**
 * Allocation probe of the per-frame render path: every piece of
 * `WorldRenderer.render` / `applyTransforms` that runs each frame and can be
 * driven headless must allocate (almost) nothing in steady state. The probe
 * samples V8 allocations (collected objects included) and attributes them
 * to `packages/render/src` sources. three.js internals are not counted.
 */
import { describe, expect, it } from 'vitest';
import { Group, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Raycaster, Scene, Vector3, type Intersection } from 'three';
import { createWorld, type EntityInput } from '@aether/core';
import { CameraRig, type OrbitControlsLike } from '../src/view/camera-rig';
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

const RENDER_SRC = /packages\/render\/src\//;
/** Sampling noise allowance per frame (bytes): the probe must find no real per-frame garbage. */
const BUDGET = 16;

function controls(): OrbitControlsLike {
  return { enabled: true, enableDamping: true, dampingFactor: 0.1, target: new Vector3(), update: () => true, dispose() {} };
}

describe('render loop allocation probe', () => {
  it('SceneSync.applyTransforms (500 bodies, some parented) allocates nothing per frame', async () => {
    const { sync } = makeSync();
    const ents: EntityInput[] = [{ id: 'holder', transform: { position: [5, 0, 0], rotation: [0, 30, 0] } }];
    for (let i = 0; i < 500; i++) ents.push({ id: `b-${i}`, transform: { position: [i, 0.5, 0] }, shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] }, ...(i % 5 === 0 ? { parent: 'holder' } : {}) });
    const map: Record<string, EntityInput> = {};
    for (const e of ents) map[e.id] = e;
    await sync.setWorld(createWorld({ entities: map }));
    const order = ents.slice(1).map((e) => e.id);
    const packed = new Float32Array(order.length * 7);
    for (let i = 0; i < order.length; i++) {
      packed[i * 7] = i;
      packed[i * 7 + 6] = 1;
    }
    let f = 0;
    const r = await probeAllocations(
      () => {
        packed[1] = Math.sin(f++);
        sync.applyTransforms(packed, order);
      },
      { iterations: 400, warmup: 4000, match: RENDER_SRC },
    );
    expect(r.bytesPerIteration, describeSites(r)).toBeLessThan(BUDGET);
  });

  it('static-prop batch updates (200 instanced posts, one moving) allocate nothing per frame', async () => {
    const { sync } = makeSync();
    const map: Record<string, EntityInput> = {};
    for (let i = 0; i < 200; i++) map[`post-${i}`] = { id: `post-${i}`, transform: { position: [i, 0.5, 0] }, shape: { kind: 'primitive', primitive: 'box', size: [0.3, 1, 0.3] }, physics: { body: 'static' } };
    await sync.setWorld(createWorld({ entities: map }));
    sync.root.updateMatrixWorld(true);
    sync.updateBatches();
    expect(sync.batchStats().drawCallsSaved).toBe(199);
    const mover = sync.object('post-7')!;
    let t = 0;
    const r = await probeAllocations(
      () => {
        mover.position.y = Math.sin((t += 0.1));
        mover.updateMatrix();
        sync.root.updateMatrixWorld();
        sync.updateBatches();
      },
      { iterations: 300, warmup: 3000, match: RENDER_SRC },
    );
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
    for (let i = 0; i < 100 && sync.virtualStats().instances < 2; i++) await new Promise((r) => setTimeout(r, 20));
    expect(sync.virtualStats().instances).toBe(2);
    const cam = new PerspectiveCamera(55, 1.6, 0.1, 3000);
    let t = 0;
    const r = await probeAllocations(
      () => {
        t += 0.05;
        cam.position.set(Math.cos(t) * 60, 12, Math.sin(t) * 60);
        cam.lookAt(0, 0, 0);
        cam.updateMatrixWorld();
        sync.updateView(cam, 900);
      },
      { iterations: 200, warmup: 400, match: RENDER_SRC },
    );
    expect(r.bytesPerIteration, describeSites(r)).toBeLessThan(BUDGET);
  });

  it('camera rig (orbit + follow), grow-in, highlighter, stats and adaptive resolution allocate nothing per frame', async () => {
    const cam = new PerspectiveCamera(50, 1, 0.1, 1000);
    const orbit = new CameraRig(cam, controls());
    const followCam = new PerspectiveCamera(50, 1, 0.1, 1000);
    const follow = new CameraRig(followCam, controls());
    const target = new Group();
    target.position.set(3, 0, 4);
    follow.setMode('follow', (out: Vector3) => {
      out.copy(target.position);
      return 30;
    });
    const grow = new GrowIn();
    const parent = new Group();
    const kids = Array.from({ length: 50 }, () => new Mesh());
    parent.add(...kids);
    for (const k of kids) grow.start(k, 0, false);
    const hl = new Highlighter();
    hl.set(['a'], () => kids[0]);
    const stats = new FrameStats();
    const adaptive = new AdaptiveResolution();
    let t = 0;
    const r = await probeAllocations(
      () => {
        t += 1 / 60;
        target.position.x = Math.sin(t) * 5;
        orbit.update(1 / 60);
        follow.update(1 / 60);
        grow.update(1 / 600);
        hl.update();
        stats.record(1 / 60, 2);
        adaptive.record(1 / 60, true);
      },
      { iterations: 400, match: RENDER_SRC },
    );
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
    const r = await probeAllocations(
      () => {
        t += 1 / 60;
        cam.position.set(Math.sin(t) * 10, 5, Math.cos(t) * 10);
        rig.update(1 / 60, cam);
        weather.update(1 / 60, cam);
      },
      // The 5000-particle loop optimizes quickly; a long warmup would only cost test time.
      { iterations: 300, warmup: 1500, match: RENDER_SRC },
    );
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
    const hits: Intersection[] = [];
    const r = await probeAllocations(
      () => {
        mesh.raycast(ray, hits);
      },
      { iterations: 500, warmup: 30_000, match: RENDER_SRC },
    );
    expect(hits).toHaveLength(0);
    expect(r.bytesPerIteration, describeSites(r)).toBeLessThan(BUDGET);
  });
});
