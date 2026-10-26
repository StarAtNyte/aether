import { describe, expect, it } from 'vitest';
import { Mesh, PerspectiveCamera, PointLight } from 'three';
import { applyPatches, createWorld, type WorldDoc } from '@aether/core';
import { compileBuilding } from '@aether/arch';
import { ArchView, archDecision, cameraFacingWall, CUTAWAY_WALL_HEIGHT, DEFAULT_ARCH_VIEW, distanceToWall, DOWN_WALL_HEIGHT, EXPLODE_GAP, explodeLift, looksInside, type ArchViewState } from '../src/view/arch-view';
import { daylightLampFactor, DAYLIGHT_LAMP_FACTOR, LAMP_CUTOFF, LOCAL_LIGHT_SCALE } from '../src/sync/lights';
import { makeSync, tick } from './helpers';
import type { EntityNode } from '../src/sync/entity-node';

const view = (patch: Partial<ArchViewState> = {}): ArchViewState => ({ ...DEFAULT_ARCH_VIEW, ...patch });

it('keeps cutaway walls stable across small camera-facing reversals', () => {
  let facing = false;
  for (const distance of [.4, .29, .1, -.1, -.29]) { facing = cameraFacingWall(distance, facing); expect(facing).toBe(true); }
  facing = cameraFacingWall(-.4, facing); expect(facing).toBe(false);
  for (const distance of [-.29, -.1, .1, .29]) { facing = cameraFacingWall(distance, facing); expect(facing).toBe(false); }
});

/** A two-storey house compiled into a world. */
function house(): WorldDoc {
  const b = compileBuilding({
    id: 'house',
    levels: [
      { height: 3, rooms: [{ id: 'living', type: 'living', rect: [0, 0, 6, 5] }, { id: 'kitchen', type: 'kitchen', rect: [6, 0, 10, 5] }], doors: [{ between: ['living', 'outside'], side: 'south', main: true }, { between: ['living', 'kitchen'], kind: 'opening', width: 1.6 }], stairs: [{ at: [0.6, 1.2], heading: 'east' }] },
      { height: 2.8, rooms: [{ id: 'landing', type: 'hall', rect: [0, 0, 6, 5] }, { id: 'bed', type: 'bedroom', rect: [6, 0, 10, 5] }], doors: [{ between: ['landing', 'bed'] }] },
    ],
    roof: { shape: 'gable' },
  });
  const r = applyPatches(createWorld(), b.patches);
  expect(r.errors).toEqual([]);
  return r.world;
}

function camera(x: number, y: number, z: number): PerspectiveCamera {
  const c = new PerspectiveCamera(50, 1.5, 0.1, 500);
  c.position.set(x, y, z);
  c.lookAt(5, 0, 2.5);
  c.updateMatrixWorld();
  return c;
}

describe('archDecision (pure)', () => {
  const wall = { role: 'wall', level: 0, facesCamera: false, hostLowered: false };
  it('keeps everything as built by default', () => {
    expect(archDecision(view(), wall)).toEqual({ hidden: false, lowered: null, xray: false });
    expect(archDecision(view(), { ...wall, role: 'ceiling' }).hidden).toBe(false);
    expect(looksInside(view())).toBe(false);
  });
  it('sections exterior walls facing the camera in the cutaway, every wall when walls are down', () => {
    expect(archDecision(view({ walls: 'cutaway' }), { ...wall, facesCamera: true }).lowered).toBe(CUTAWAY_WALL_HEIGHT);
    expect(archDecision(view({ walls: 'cutaway' }), wall).lowered).toBeNull();
    expect(archDecision(view({ walls: 'down' }), wall).lowered).toBe(DOWN_WALL_HEIGHT);
  });
  it('cuts walls at the section plane and hides walls entirely below it', () => {
    expect(archDecision(view({ section: 1.2 }), { ...wall, sectionAt: 1.2 }).lowered).toBe(1.2);
    expect(archDecision(view({ walls: 'down', section: 1.2 }), { ...wall, sectionAt: 1.2 }).lowered).toBe(DOWN_WALL_HEIGHT);
    expect(archDecision(view({ section: 1.2 }), { ...wall, sectionAt: -0.5 })).toMatchObject({ hidden: true, lowered: null });
  });
  it('hides ceilings, roofs and ceiling fittings when looking in, and pieces on sectioned walls', () => {
    for (const v of [view({ walls: 'cutaway' }), view({ levels: 'exploded' }), view({ levels: 'solo' }), view({ section: 2 })]) {
      expect(looksInside(v)).toBe(true);
      expect(archDecision(v, { ...wall, role: 'roof' }).hidden).toBe(true);
      expect(archDecision(v, { ...wall, role: 'ceiling' }).hidden).toBe(true);
      expect(archDecision(v, { ...wall, role: 'light', mount: 'ceiling' }).hidden).toBe(true);
      expect(archDecision(v, { ...wall, role: 'furniture', mount: 'floor' }).hidden).toBe(false);
    }
    expect(archDecision(view(), { ...wall, role: 'fixture', mount: 'wall', hostLowered: true }).hidden).toBe(true);
    expect(archDecision(view(), { ...wall, role: 'window', hostLowered: true }).hidden).toBe(true);
  });
  it('solo shows one storey (site works stay), x-ray turns structure to glass only', () => {
    expect(archDecision(view({ levels: 'solo', level: 1 }), wall).hidden).toBe(true);
    expect(archDecision(view({ levels: 'solo', level: 0 }), wall).hidden).toBe(false);
    expect(archDecision(view({ levels: 'solo', level: 1 }), { ...wall, role: 'site' }).hidden).toBe(false);
    expect(archDecision(view({ xray: true }), wall).xray).toBe(true);
    expect(archDecision(view({ xray: true }), { ...wall, role: 'furniture' }).xray).toBe(false);
  });
  it('lifts storeys and the roof apart with an eased curve', () => {
    expect(explodeLift(2, false, 0)).toBe(0);
    expect(explodeLift(2, false, 1)).toBeCloseTo(2 * EXPLODE_GAP);
    expect(explodeLift(1, false, 0.5)).toBeCloseTo(EXPLODE_GAP * 0.5);
    expect(explodeLift(0, true, 1)).toBeGreaterThan(0);
  });
  it('measures plan distance to a wall segment', () => {
    expect(distanceToWall(2, 1, 0, 0, 1, 0, 4)).toBeCloseTo(1);
    expect(distanceToWall(6, 0, 0, 0, 1, 0, 4)).toBeCloseTo(2);
    expect(distanceToWall(-3, 4, 0, 0, 1, 0, 4)).toBeCloseTo(5);
  });
});

describe('ArchView on a scene', () => {
  async function setup(): Promise<{ av: ArchView; sync: ReturnType<typeof makeSync>['sync']; world: WorldDoc }> {
    const { sync } = makeSync();
    const world = house();
    await sync.setWorld(world);
    await tick(10);
    return { av: new ArchView(sync), sync, world };
  }
  const cut = (sync: ReturnType<typeof makeSync>['sync'], id: string): unknown => {
    const s = sync.node(id)?.entity.shape;
    return s?.kind === 'procedural' ? s.params['cut'] : undefined;
  };
  const walls = (world: WorldDoc): string[] => Object.values(world.entities).filter((e) => e.arch?.role === 'wall').map((e) => e.id);

  it('indexes the building and reports its storeys', async () => {
    const { av } = await setup();
    expect(av.active).toBe(true);
    expect(av.storeys).toBe(2);
  });

  it('sections every wall in walls-down mode with a view-only override, and restores the document', async () => {
    const { av, sync, world } = await setup();
    av.set({ walls: 'down' });
    expect(av.update(camera(20, 15, 20), 0)).toBe(true);
    for (const id of walls(world)) expect(cut(sync, id)).toBe(DOWN_WALL_HEIGHT);
    // The document never changes.
    expect(Object.values(world.entities).every((e) => e.shape.kind !== 'procedural' || e.shape.params['cut'] === undefined)).toBe(true);
    // Unchanged state: no further work.
    expect(av.update(camera(20, 15, 20), 0.016)).toBe(false);
    av.set({ walls: 'up' });
    av.update(camera(20, 15, 20), 0);
    for (const id of walls(world)) expect(cut(sync, id)).toBeUndefined();
  });

  it('cutaway sections only exterior walls between the camera and the building', async () => {
    const { av, sync, world } = await setup();
    av.set({ walls: 'cutaway' });
    av.update(camera(5, 12, 30), 0);
    const lowered = walls(world).filter((id) => cut(sync, id) === CUTAWAY_WALL_HEIGHT);
    expect(lowered.length).toBeGreaterThan(0);
    for (const id of lowered) expect(world.entities[id]?.arch?.kind).toBe('exterior');
    expect(lowered.length).toBeLessThan(walls(world).filter((id) => world.entities[id]?.arch?.kind === 'exterior').length);
    // Ceilings and the roof are hidden while looking in.
    const roof = Object.values(world.entities).find((e) => e.arch?.role === 'roof');
    expect(sync.node(roof!.id)?.content.visible).toBe(false);
  });

  it('retains facing hysteresis when a wall rebuild makes the view re-index', async () => {
    const { av, sync } = await setup(); av.set({ walls: 'cutaway' }); av.update(camera(20, 12, 30), 0);
    const wall = (av as unknown as { walls: Array<{ node: Readonly<EntityNode>; exterior: boolean; length: number; cx: number; cz: number }> }).walls.find(w => w.exterior)!;
    const e = wall.node.object.matrixWorld.elements, mx = e[12]! + e[0]! * wall.length * .5, mz = e[14]! + e[2]! * wall.length * .5;
    let nx = e[8]!, nz = e[10]!; if (nx * (mx - wall.cx) + nz * (mz - wall.cz) < 0) { nx = -nx; nz = -nz; }
    const n2 = nx * nx + nz * nz;
    const at = (distance: number) => camera(mx + nx * distance / n2, 8, mz + nz * distance / n2);
    av.update(at(.4), 0); expect(cut(sync, wall.node.id)).toBe(CUTAWAY_WALL_HEIGHT);
    av.invalidate(); av.update(at(.1), 0); expect(cut(sync, wall.node.id)).toBe(CUTAWAY_WALL_HEIGHT);
    av.update(at(-.4), 0); expect(cut(sync, wall.node.id)).toBeUndefined();
    av.invalidate(); av.update(at(-.1), 0); expect(cut(sync, wall.node.id)).toBeUndefined();
    av.dispose(); sync.dispose();
  });

  it('solo hides the other storeys; exploded lifts them and settles back', async () => {
    const { av, sync, world } = await setup();
    const upper = Object.values(world.entities).find((e) => e.arch?.role === 'level' && e.arch.level === 1)!;
    av.set({ levels: 'solo', level: 0 });
    av.update(camera(20, 15, 20), 0);
    expect(sync.node(upper.id)?.object.visible).toBe(false);
    av.set({ levels: 'exploded' });
    const base = upper.transform.position[1];
    av.update(camera(20, 15, 20), 0.45);
    expect(sync.node(upper.id)?.object.visible).toBe(true);
    expect(av.animating).toBe(true);
    const mid = sync.node(upper.id)!.object.matrix.elements[13] as number;
    expect(mid).toBeGreaterThan(base);
    expect(mid).toBeLessThan(base + EXPLODE_GAP);
    av.update(camera(20, 15, 20), 1);
    expect(sync.node(upper.id)?.object.matrix.elements[13]).toBeCloseTo(base + EXPLODE_GAP);
    av.set({ levels: 'stacked' });
    av.update(camera(20, 15, 20), 0);
    expect(sync.node(upper.id)?.object.matrix.elements[13]).toBeCloseTo(base);
    expect(av.animating).toBe(false);
  });

  it('x-ray swaps structure materials and puts every original back', async () => {
    const { av, sync, world } = await setup();
    const wallId = walls(world)[0]!;
    const before = sync.node(wallId)!.bindings.map((b) => b.mesh.material);
    av.set({ xray: true });
    av.update(camera(20, 15, 20), 0);
    const during = sync.node(wallId)!.bindings.map((b) => b.mesh.material);
    expect(during.every((m, i) => m !== before[i])).toBe(true);
    const sofa = Object.values(world.entities).find((e) => e.arch?.role === 'furniture');
    if (sofa) expect(sync.node(sofa.id)!.bindings.every((b) => !(b.mesh.material as { name?: string }).name?.includes('xray'))).toBe(true);
    av.set({ xray: false });
    av.update(camera(20, 15, 20), 0);
    expect(sync.node(wallId)!.bindings.map((b) => b.mesh.material)).toEqual(before);
  });

  it('restoreAll undoes every mode and forgets nodes that left the scene', async () => {
    const { av, sync, world } = await setup();
    av.set({ walls: 'down', levels: 'exploded', xray: true });
    av.update(camera(20, 15, 20), 1);
    expect(av.restoreAll()).toBe(true);
    for (const id of walls(world)) expect(cut(sync, id)).toBeUndefined();
    expect(sync.root.getObjectByProperty('name', 'aether:xray')).toBeUndefined();
    // Without buildings the view is inert.
    await sync.setWorld(createWorld());
    av.invalidate();
    expect(av.active).toBe(false);
    av.update(camera(20, 15, 20), 0);
    expect(av.restoreAll()).toBe(false);
    av.dispose();
  });

  it('sections the upper storey correctly while it settles back from the exploded view (regression)', async () => {
    const { av, sync, world } = await setup();
    av.set({ levels: 'exploded' });
    av.update(camera(20, 15, 20), 1);
    // Collapse and cut in one change: the cut must not use the still-lifted storey height.
    av.set({ levels: 'stacked', section: 4.4 });
    av.update(camera(20, 15, 20), 0.1);
    const upper = walls(world).filter((id) => world.entities[id]?.parent === 'house-l1');
    expect(upper.length).toBeGreaterThan(0);
    for (const id of upper) {
      expect(sync.node(id)!.content.visible).toBe(true);
      expect(cut(sync, id)).toBeGreaterThan(1);
    }
  });

  it('section height maps to the lowest storey and validates input', async () => {
    const { av } = await setup();
    av.set({ section: 1.5 });
    av.update(camera(20, 15, 20), 0);
    expect(av.sectionY).toBeCloseTo(0.15 + 1.5, 1);
    av.set({ section: Number.NaN });
    expect(av.value.section).toBeNull();
    av.set({ walls: 'bogus' as never, levels: 'nope' as never, level: Number.POSITIVE_INFINITY });
    expect(av.value).toMatchObject({ walls: 'up', levels: 'stacked', level: 0 });
  });
});

describe('daylight lamp dimming', () => {
  it('is full at night, dim in daylight and smooth in between', () => {
    expect(daylightLampFactor(-20)).toBe(1);
    expect(daylightLampFactor(60)).toBeCloseTo(DAYLIGHT_LAMP_FACTOR);
    const dusk = daylightLampFactor(8);
    expect(dusk).toBeGreaterThan(DAYLIGHT_LAMP_FACTOR);
    expect(dusk).toBeLessThan(1);
    expect(daylightLampFactor(Number.NaN)).toBe(1);
  });

  it('scales only architectural lamps, in place', async () => {
    const { sync } = makeSync();
    const world = createWorld({
      entities: {
        lamp: { id: 'lamp', light: { type: 'point', intensity: 2, color: '#ffffff', range: 6 }, arch: { role: 'light', kind: 'pendant' } },
        torch: { id: 'torch', light: { type: 'point', intensity: 2, color: '#ffffff', range: 6 } },
      },
    });
    await sync.setWorld(world);
    const lamp = sync.node('lamp')!.light!.light as PointLight;
    const torch = sync.node('torch')!.light!.light as PointLight;
    sync.setArchLampScale(0.25);
    expect(lamp.intensity).toBeCloseTo(2 * LOCAL_LIGHT_SCALE * 0.25);
    expect(torch.intensity).toBeCloseTo(2 * LOCAL_LIGHT_SCALE);
    // Runtime overrides keep the scale.
    sync.setProperty('lamp', 'light.intensity', 1);
    expect(lamp.intensity).toBeCloseTo(LOCAL_LIGHT_SCALE * 0.25);
    expect(lamp).toBeInstanceOf(PointLight);
    // Full daylight switches lamps off entirely (no per-pixel cost); other lights are untouched.
    expect(lamp.visible).toBe(true);
    sync.setArchLampScale(LAMP_CUTOFF / 2);
    expect(lamp.visible).toBe(false);
    expect(torch.visible).toBe(true);
    sync.setArchLampScale(1);
    expect(lamp.visible).toBe(true);
    expect(sync.node('lamp')!.content.children.every((c) => !(c instanceof Mesh) || c.visible)).toBe(true);
  });
});
