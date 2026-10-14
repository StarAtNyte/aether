import { describe, expect, it } from 'vitest';
import { BoxGeometry, DataTexture, FloatType, Group, InstancedMesh, Mesh, MeshBasicMaterial, MeshStandardMaterial, RGBAFormat, Texture } from 'three';
import { createWorld, type WorldDoc } from '@aether/core';
import { exportScene, textureExportMode, countTriangles, exportGlb, createMaterial, resolveMaterial, BlueprintMarks, bracketSegments, BLUEPRINT_FADE_SECONDS, BLUEPRINT_HOLD_SECONDS, MAX_BLUEPRINT_BOXES, PROOF_FADE_SECONDS, PROOF_HOLD_SECONDS, PROOF_MAX_SECONDS, ProofReplay, replayWorld, trailBuffers, validTrace, type ProofTrace } from '../src/index';
import type { SceneSync } from '../src/sync/scene-sync';

function trace(frames: number, bodies: string[], dt = 0.1): ProofTrace {
  const poses = new Float32Array(frames * bodies.length * 7);
  for (let f = 0; f < frames; f++) {
    for (let b = 0; b < bodies.length; b++) {
      const o = (f * bodies.length + b) * 7;
      poses[o] = f; // x walks one metre per frame
      poses[o + 1] = b;
      poses[o + 2] = 0;
      poses[o + 6] = 1; // identity quaternion
    }
  }
  return { ids: bodies, dt, frames, poses };
}

/** Advance `thing` by `seconds` in 50 ms steps (updates clamp long steps). */
function advance(thing: { update(dt: number): boolean }, seconds: number): void {
  for (let t = 0; t < seconds - 1e-9; t += 0.05) thing.update(Math.min(0.05, seconds - t));
}

function doc(): WorldDoc {
  return createWorld({
    entities: {
      ball: { id: 'ball', shape: { kind: 'primitive', primitive: 'sphere', size: [1, 1, 1] }, physics: { body: 'dynamic' }, light: { type: 'point', color: '#ffffff', intensity: 1 } },
      crate: { id: 'crate', shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] }, physics: { body: 'dynamic' }, parent: 'ball', transform: { position: [0, 2, 0] } },
      lamp: { id: 'lamp', shape: { kind: 'none' } },
    },
  });
}

/** Minimal scene-sync stand-in: one node per entity of the last world. */
function fakeSync(): { sync: SceneSync; cleared: () => number } {
  const nodes = new Map<string, { object: Group; content: Group }>();
  let clears = 0;
  const sync = {
    setWorld: async (w: WorldDoc) => {
      nodes.clear();
      for (const id of Object.keys(w.entities)) {
        const object = new Group();
        const content = new Group();
        object.add(content);
        nodes.set(id, { object, content });
      }
    },
    object: (id: string) => nodes.get(id)?.object,
    node: (id: string) => nodes.get(id),
    clear: () => {
      clears++;
      nodes.clear();
    },
  } as unknown as SceneSync;
  return { sync, cleared: () => clears };
}

describe('proof replay — pure helpers', () => {
  it('validates trace shapes', () => {
    expect(validTrace(trace(3, ['a']))).toBe(true);
    expect(validTrace({ ...trace(3, ['a']), frames: 4 })).toBe(false);
    expect(validTrace({ ...trace(3, ['a']), dt: 0 })).toBe(false);
    expect(validTrace({ ...trace(3, ['a']), ids: [] })).toBe(false);
    expect(validTrace(null)).toBe(false);
  });

  it('builds a flattened ghost world of traced bodies only', () => {
    const w = replayWorld(doc(), ['ball', 'crate', 'lamp', 'missing']);
    expect(Object.keys(w.entities).sort()).toEqual(['ball', 'crate']);
    expect(w.entities['crate']?.parent).toBeNull();
    expect(w.entities['crate']?.transform.position[1]).toBeCloseTo(2, 5);
    expect(w.entities['ball']?.light).toBeUndefined();
    expect(w.entities['ball']?.physics).toBeUndefined();
    expect(w.tests).toEqual([]);
  });

  it('lays trail segments out frame-major with a tail-to-head colour ramp', () => {
    const t = trace(4, ['a', 'b']);
    const { positions, colors } = trailBuffers(t);
    expect(positions.length).toBe(3 * 2 * 6);
    // Segment 1 is body b, frame 0 → 1.
    expect(Array.from(positions.subarray(6, 12))).toEqual([0, 1, 0, 1, 1, 0]);
    // Later segments are brighter than earlier ones (head colour).
    const first = (colors[0] as number) + (colors[1] as number) + (colors[2] as number);
    const last = (colors[colors.length - 3] as number) + (colors[colors.length - 2] as number) + (colors[colors.length - 1] as number);
    expect(last).toBeGreaterThan(first);
  });
});

describe('proof replay — playback', () => {
  it('plays, holds, dissolves and clears its ghosts', async () => {
    const { sync, cleared } = fakeSync();
    const replay = new ProofReplay(() => sync);
    replay.ghostsIfCreated = sync;
    const t = trace(11, ['ball']); // 1 s of motion
    expect(await replay.start(doc(), t)).toBe(true);
    expect(replay.state).toBe('play');
    const ghost = sync.object('ball');
    advance(replay, 0.5);
    expect(ghost?.matrix.elements[12]).toBeCloseTo(5, 3);
    advance(replay, 0.55);
    expect(replay.state).toBe('hold');
    expect(ghost?.matrix.elements[12]).toBeCloseTo(10, 3);
    advance(replay, PROOF_HOLD_SECONDS + 0.05);
    expect(replay.state).toBe('fade');
    advance(replay, PROOF_FADE_SECONDS / 2);
    expect(sync.node('ball')?.content.scale.x).toBeLessThan(1);
    advance(replay, PROOF_FADE_SECONDS);
    expect(replay.active).toBe(false);
    expect(cleared()).toBeGreaterThan(0);
    expect(replay.group.children.length).toBe(0);
  });

  it('hides the live objects while their ghosts replay and restores them (stop included)', async () => {
    const { sync } = fakeSync();
    const live = new Group();
    const hiddenByUser = new Group();
    hiddenByUser.visible = false;
    const replay = new ProofReplay(() => sync, (id) => (id === 'ball' ? live : id === 'crate' ? hiddenByUser : undefined));
    await replay.start(doc(), trace(11, ['ball', 'crate']));
    expect(live.visible).toBe(false);
    advance(replay, 1.2 + PROOF_HOLD_SECONDS);
    expect(replay.state).toBe('fade');
    expect(live.visible).toBe(true);
    await replay.start(doc(), trace(11, ['ball', 'crate']));
    expect(live.visible).toBe(false);
    replay.stop();
    expect(live.visible).toBe(true);
    expect(hiddenByUser.visible).toBe(false);
  });

  it('composes rotation and scale into the ghost matrix', async () => {
    const { sync } = fakeSync();
    const replay = new ProofReplay(() => sync);
    const s = Math.SQRT1_2;
    // Two frames: identity, then 90° about +Y; the ghost is scaled 2×.
    const poses = new Float32Array([0, 0, 0, 0, 0, 0, 1, 3, 1, 0, 0, s, 0, s]);
    await replay.start(doc(), { ids: ['ball'], dt: 1, frames: 2, poses });
    sync.object('ball')?.scale.set(2, 2, 2);
    advance(replay, 1.05);
    const e = sync.object('ball')?.matrix.elements ?? [];
    // Rotated basis: x axis → -z, z axis → +x (times the scale).
    expect(e[0]).toBeCloseTo(0, 4);
    expect(e[2]).toBeCloseTo(-2, 4);
    expect(e[8]).toBeCloseTo(2, 4);
    expect(e[5]).toBeCloseTo(2, 4);
    expect([e[12], e[13], e[14]]).toEqual([3, 1, 0]);
  });

  it('speeds long traces up to fit the replay length', async () => {
    const { sync } = fakeSync();
    const replay = new ProofReplay(() => sync);
    const long = trace(201, ['ball'], 0.1); // 20 s
    await replay.start(doc(), long);
    const ghost = sync.object('ball');
    advance(replay, PROOF_MAX_SECONDS / 2);
    expect(ghost?.matrix.elements[12]).toBeCloseTo(100, 0);
  });

  it('with reduced motion shows the finished trails without ghosts', async () => {
    let created = 0;
    const replay = new ProofReplay(() => {
      created++;
      return fakeSync().sync;
    });
    expect(await replay.start(doc(), trace(5, ['ball']), { reducedMotion: true })).toBe(true);
    expect(created).toBe(0);
    expect(replay.state).toBe('hold');
    const lines = replay.group.children[0] as unknown as { geometry: { drawRange: { count: number } } };
    expect(lines.geometry.drawRange.count).toBe(4 * 2);
  });

  it('a superseded start resolves false; invalid traces are ignored', async () => {
    const { sync } = fakeSync();
    const replay = new ProofReplay(() => sync);
    const first = replay.start(doc(), trace(5, ['ball']));
    const second = replay.start(doc(), trace(5, ['ball']));
    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(await replay.start(doc(), { ids: ['ball'], dt: 0.1, frames: 5, poses: new Float32Array(3) })).toBe(false);
    expect(replay.active).toBe(false);
  });
});

describe('blueprint marks', () => {
  it('emits 24 bracket segments per valid box and skips bad ones', () => {
    const segs = bracketSegments([
      { min: [0, 0, 0], max: [2, 2, 2] },
      { min: [0, 0, 0], max: [Number.NaN, 1, 1] },
      { min: [1, 1, 1], max: [0, 0, 0] },
    ]);
    expect(segs.length).toBe(24 * 6);
    // First tick runs from the min corner a quarter of the shortest side along +x.
    expect(Array.from(segs.subarray(0, 6))).toEqual([0, 0, 0, 0.5, 0, 0]);
    const many = Array.from({ length: MAX_BLUEPRINT_BOXES + 10 }, () => ({ min: [0, 0, 0] as const, max: [1, 1, 1] as const }));
    expect(bracketSegments(many).length).toBe(MAX_BLUEPRINT_BOXES * 24 * 6);
  });

  it('holds, fades and clears', () => {
    const marks = new BlueprintMarks();
    marks.show([{ min: [0, 0, 0], max: [1, 1, 1] }]);
    expect(marks.active).toBe(true);
    advance(marks, BLUEPRINT_HOLD_SECONDS);
    expect(marks.active).toBe(true);
    expect(marks.update(0.05)).toBe(true);
    advance(marks, BLUEPRINT_FADE_SECONDS);
    expect(marks.active).toBe(false);
    expect(marks.group.children.length).toBe(0);
    marks.dispose();
  });
});

describe('proof ghost material', () => {
  it('is a translucent, accent-tinted ghost distinct from the preview ghost', () => {
    const r = resolveMaterial({ preset: 'wood' });
    const proof = createMaterial(r, 'proof');
    const ghost = createMaterial(r, 'ghost');
    expect(proof.transparent).toBe(true);
    expect(proof.depthWrite).toBe(false);
    expect(proof.opacity).toBeGreaterThan(ghost.opacity);
    expect(proof.name).toBe('aether:proof');
    expect(proof.map).toBeNull();
  });
});

describe('glTF export guards', () => {
  it('counts visible triangles, instances included', () => {
    const root = new Group();
    const geo = new BoxGeometry(1, 1, 1);
    const mat = new MeshBasicMaterial();
    root.add(new Mesh(geo, mat));
    const inst = new InstancedMesh(geo, mat, 5);
    inst.count = 3;
    root.add(inst);
    const hidden = new Mesh(geo, mat);
    hidden.visible = false;
    root.add(hidden);
    expect(countTriangles(root)).toBe(12 + 36);
  });

  it('refuses empty and oversized scenes before loading the exporter', async () => {
    await expect(exportGlb(new Group())).rejects.toThrow(/nothing to export/);
    const root = new Group();
    root.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));
    await expect(exportGlb(root, 4)).rejects.toThrow(/export limit/);
  });
});

describe('glTF export copy', () => {
  it('classifies textures: drawable kept, RGBA bytes converted, float or odd data dropped', () => {
    expect(textureExportMode(null)).toBe('keep');
    expect(textureExportMode(new DataTexture(new Uint8Array(4 * 4 * 4), 4, 4, RGBAFormat))).toBe('canvas');
    expect(textureExportMode(new DataTexture(new Float32Array(4 * 4 * 4), 4, 4, RGBAFormat, FloatType))).toBe('drop');
    expect(textureExportMode(new DataTexture(new Uint8Array(3), 4, 4, RGBAFormat))).toBe('drop');
    expect(textureExportMode(new Texture())).toBe('drop');
  });

  it('exports a copy: the live scene and its materials are untouched', () => {
    const root = new Group();
    const tex = new DataTexture(new Float32Array(16), 2, 2, RGBAFormat, FloatType);
    const mat = new MeshStandardMaterial({ roughnessMap: tex });
    const plain = new MeshBasicMaterial();
    root.add(new Mesh(new BoxGeometry(), mat), new Mesh(new BoxGeometry(), plain));
    const { scene, dispose } = exportScene(root);
    const [a, b] = scene.children as Mesh[];
    expect(a?.material).not.toBe(mat);
    expect((a?.material as MeshStandardMaterial).roughnessMap).toBeNull();
    expect(b?.material).toBe(plain);
    expect(mat.roughnessMap).toBe(tex);
    expect(root.children[0]).not.toBe(a);
    dispose();
  });
});
