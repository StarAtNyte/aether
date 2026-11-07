import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld, Story, type Patch, type WorldDoc } from '@aether/core';
import { pitchOf, qualityChecks, runQualityPass, type QualityHost } from '../src/presentation/quality';

const w = (patches: Patch[]): WorldDoc => applyPatches(createWorld(), patches).world;

function host(world: WorldDoc, extra: Partial<QualityHost> = {}): QualityHost & { world: WorldDoc } {
  const h: { world: WorldDoc } & Record<string, unknown> = {
    world,
    getWorld: (): WorldDoc => h.world,
    applyPatches(p: unknown[]) {
      const r = applyPatches(h.world, p);
      h.world = r.world;
      return r;
    },
    ...extra,
  };
  return h as unknown as QualityHost & { world: WorldDoc };
}

describe('world-quality pass: data checks', () => {
  it('lowers a building opening above standing eye height, and flags a backlit one', async () => {
    const world = w([
      { op: 'add', entity: { id: 'house', arch: { role: 'building' } } } as Patch,
      { op: 'add', entity: { id: 'l0', arch: { role: 'level', level: 0 }, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } } } as Patch,
      { op: 'setMeta', opening: { position: [0, 6, 20], target: [0, 3, 0] } },
    ]);
    const f = await qualityChecks(world, null, host(world, { sunState: () => ({ direction: [0, 0.3, -1], elevation: 20 }) }));
    const eye = f.find((x) => x.check === 'opening' && /eye height|above the floor/.test(x.note));
    expect(eye?.fix?.kind).toBe('patches');
    expect(f.some((x) => x.fix?.kind === 'repick-opening' && /backlit/.test(x.note))).toBe(true);
  });

  it('tilts a top-down aerial up to the horizon', async () => {
    const world = w([{ op: 'setMeta', views: [{ position: [0, 80, 0], target: [0, 0, 1] }] }]);
    const f = await qualityChecks(world, null, null);
    const a = f.find((x) => x.check === 'aerial');
    expect(a).toBeDefined();
    const fixed = applyPatches(world, (a?.fix as { patches: Patch[] }).patches).world;
    expect(pitchOf(fixed.views![0]!)).toBeGreaterThan(-60);
  });

  it('derives colliders for static meshes, gives blocky people a human body, resets odd scales', async () => {
    const world = w([
      { op: 'add', entity: { id: 'pier', shape: { kind: 'model', url: 'x.glb' } } } as Patch,
      { op: 'add', entity: { id: 'fisher', name: 'Old fisherman', shape: { kind: 'primitive', primitive: 'capsule', size: [0.5, 1.7, 0.5] } } } as Patch,
      { op: 'add', entity: { id: 'giant', name: 'Walker', character: {}, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1.5, 1.5, 1.5] } } } as Patch,
    ]);
    const f = await qualityChecks(world, null, null);
    expect(f.find((x) => x.check === 'playability')?.note).toMatch(/no collider/);
    expect(f.find((x) => x.check === 'characters' && x.severity === 'error')?.note).toMatch(/fisher/);
    expect(f.find((x) => x.check === 'scale')?.note).toMatch(/giant/);
  });

  it('catches story filler, a named person off screen and a name nobody has', async () => {
    const cam = { position: [0, 2, 10] as [number, number, number], target: [0, 2, 0] as [number, number, number] };
    const world = w([
      { op: 'add', entity: { id: 'kaho', name: 'Kaho', character: {}, transform: { position: [50, 0, 50], rotation: [0, 0, 0], scale: [1, 1, 1] } } } as Patch,
      { op: 'setMeta', story: Story.parse({ shots: [
        { duration: 10, camera: cam, title: 'T' },
        { duration: 10, camera: cam, caption: 'Kaho runs up the stair' },
        { duration: 10, camera: cam },
        { duration: 10, camera: { position: [5, 2, 5], target: [0, 2, 0] }, caption: 'She waits with Mio' },
        { duration: 10, camera: { position: [9, 2, 5], target: [0, 2, 0] } },
      ] }) },
    ]);
    const f = (await qualityChecks(world, null, null)).filter((x) => x.check === 'story');
    expect(f.some((x) => /repeat an earlier framing/.test(x.note))).toBe(true);
    expect(f.some((x) => /names Kaho/.test(x.note) && x.fix?.kind === 'patches')).toBe(true);
    expect(f.some((x) => /"Mio"/.test(x.note))).toBe(true);
  });

  it('puts a floating spawn on the ground the level tools measure', async () => {
    const world = w([{ op: 'setPlayer', set: { spawn: [0, 9, 0] } }]);
    const h = host(world, { levelTools: async () => ({ ok: true, text: '(0, 0): top surface y=0.5 on ground, slope 2 deg (flat)', patches: [], message: '' }) });
    const r = await runQualityPass(h, null, { visual: false });
    expect(r.fixed).toContain('spawn set on the ground');
    expect(h.world.player.spawn[1]).toBeCloseTo(1.5);
  });

  it('flags drawn triangles over the tier budget', async () => {
    const f = await qualityChecks(createWorld(), null, host(createWorld(), { renderStats: () => ({ triangles: 9_000_000, tier: 'medium', programs: 40 }) }));
    expect(f.find((x) => x.check === 'performance')?.severity).toBe('warn');
  });
});
