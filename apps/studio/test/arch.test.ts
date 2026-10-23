import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld, History, type WorldDoc } from '@aether/core';
import { applyArchOps, checkBuildings } from '@aether/arch';
import { planArch } from '../../../packages/agent/src/providers/mock/arch';
import { DEFAULT_ARCH_UI, hourLabel, mergeArchUi, SECTION_RANGE, sectionLevel, skyForHour, TIME_PRESETS } from '../src/state/archUi';
import { areaLabel, clampZoom, closesPolygon, dragRect, fitPlan, lengthLabel, outlineArea, panBy, pathOf, PLAN_ZOOM, roomColors, viewBox, zoomAt } from '../src/lib/planView';
import { nearestTarget, nextVariant, roomToggle, walkIndex, type WalkTarget } from '../src/engine/walkthrough';
import { ArchController, initialViewFor, type ArchHost } from '../src/engine/arch';
import { entranceYawDeg, quietReached, startYawDeg, THUMBNAIL_QUIET_MS } from '../src/engine/Simulation';
import { roomLabels } from '../src/lib/labels';
import { createStudioStore } from '../src/state/store';

const PLAN = {
  id: 'flat',
  levels: [
    {
      rooms: [
        { id: 'living', type: 'living', rect: [0, 0, 6, 5] },
        { id: 'bedroom', type: 'bedroom', rect: [6, 0, 10, 5] },
      ],
      doors: [
        { between: ['living', 'outside'], side: 'south', main: true },
        { between: ['living', 'bedroom'] },
      ],
    },
  ],
};

function flatWorld(): WorldDoc {
  const res = applyArchOps(createWorld(), [{ op: 'create_building', plan: PLAN }]);
  expect(res.errors).toEqual([]);
  const r = applyPatches(createWorld(), res.patches);
  expect(r.errors).toEqual([]);
  return r.world;
}

describe('architecture UI state', () => {
  it('merges patches and keeps every field valid', () => {
    const levels = [
      { index: 0, name: 'Ground floor', height: 3 },
      { index: 1, name: 'Floor 1', height: 2.8 },
    ];
    const a = mergeArchUi(DEFAULT_ARCH_UI, { building: 'house', levels, level: 7, walls: 'down', section: 99, sunHour: -3 });
    expect(a).toMatchObject({ building: 'house', level: 1, walls: 'down', section: SECTION_RANGE[1], sunHour: 0 });
    const b = mergeArchUi(a, { walls: 'sideways' as never, levelMode: 'x' as never, planTool: 'laser' as never, roomType: 'dungeon' as never, quality: 'ultra' as never, section: Number.NaN });
    // Studio render is the default; only an explicit 'realtime' turns it off.
    expect(b).toMatchObject({ walls: 'down', levelMode: 'stacked', planTool: 'select', roomType: 'living', quality: 'studio', section: SECTION_RANGE[1] });
    expect(mergeArchUi(b, { quality: 'realtime' }).quality).toBe('realtime');
    expect(mergeArchUi(b, { building: '' }).building).toBeNull();
    expect(mergeArchUi(b, { section: null, sunHour: null })).toMatchObject({ section: null, sunHour: null });
  });

  it('maps daylight hours to skies and labels them', () => {
    expect(skyForHour(3).sky).toBe('night');
    expect(skyForHour(7).sky).toBe('dawn');
    expect(skyForHour(13).sky).toBe('day');
    expect(skyForHour(18.1).sky).toBe('sunset');
    expect(skyForHour(22).sky).toBe('night');
    expect(skyForHour(Number.NaN)).toEqual({ sky: 'day', timeOfDay: 12 });
    expect(hourLabel(14.5)).toBe('14:30');
    expect(hourLabel(9.999)).toBe('10:00');
    expect(TIME_PRESETS.map((p) => skyForHour(p.hour).sky)).toEqual(['day', 'day', 'sunset', 'night']);
  });

  it('finds the storey a section cuts through (its rooms get the labels)', () => {
    const levels = [
      { index: 0, height: 3.1 },
      { index: 1, height: 2.9 },
    ];
    expect(sectionLevel(levels, 1.3)).toBe(0);
    expect(sectionLevel(levels, 4.4)).toBe(1);
    expect(sectionLevel(levels, 40)).toBe(1);
    expect(sectionLevel([], 1)).toBeNull();
  });

  it('opens single storeys as a cutaway and taller buildings as built', () => {
    expect(initialViewFor(1).walls).toBe('cutaway');
    expect(initialViewFor(2).walls).toBe('up');
  });
});

describe('thumbnail capture timing (regression)', () => {
  it('waits for a quiet moment: nothing animating and no input', () => {
    // A readback right after content settles stalled "Run checks" on slow GPUs.
    expect(quietReached(10_000, 9_500, 0)).toBe(false);
    expect(quietReached(10_000, 7_000, 9_000)).toBe(false);
    expect(quietReached(10_000, 7_000, 7_500)).toBe(true);
    expect(THUMBNAIL_QUIET_MS).toBeGreaterThanOrEqual(1500);
  });
});

describe('room label chips', () => {
  it('label every room with its name and area above its floor, in world space (rotated buildings too)', () => {
    const w = flatWorld();
    const labels = roomLabels(w);
    expect(labels.map((l) => l.metric.endsWith('m²'))).toEqual([true, true]);
    const living = labels.find((l) => l.id.endsWith('-living'));
    expect(living?.name).toBe('Living room');
    expect(living?.position[1]).toBeGreaterThan(1);
    // Living room spans x 0..6 (wall centrelines): its centroid sits inside.
    expect(living?.position[0]).toBeGreaterThan(1);
    expect(living?.position[0]).toBeLessThan(5);
    const res = applyArchOps(createWorld(), [{ op: 'create_building', plan: { ...PLAN, rotation: 90 } }]);
    const rotated = applyPatches(createWorld(), res.patches).world;
    const r = roomLabels(rotated).find((l) => l.id.endsWith('-living'));
    // A 90° turn about Y maps plan x to world −z.
    expect(r?.position[2]).toBeLessThan(-1);
    expect(Math.abs(r?.position[0] ?? 9)).toBeLessThan(3.2);
    expect(roomLabels(w, 3)).toEqual([]);
    expect(roomLabels(createWorld())).toEqual([]);
  });
});

describe('floor plan view helpers', () => {
  it('fits, zooms around the cursor and pans', () => {
    const cam = fitPlan([0, 0, 10, 5], 1000, 600, 50);
    expect(cam.cx).toBe(5);
    expect(cam.scale).toBeCloseTo(90);
    const vb = viewBox(cam, 1000, 600);
    expect(vb[2]).toBeCloseTo(1000 / 90);
    // The plan point under the cursor stays put.
    const z = zoomAt(cam, 2, 100, 100, 1000, 600);
    const before = [cam.cx + (100 - 500) / cam.scale, cam.cz + (100 - 300) / cam.scale];
    const after = [z.cx + (100 - 500) / z.scale, z.cz + (100 - 300) / z.scale];
    expect(after[0]).toBeCloseTo(before[0] as number);
    expect(after[1]).toBeCloseTo(before[1] as number);
    expect(panBy(cam, 90, 0).cx).toBeCloseTo(4);
    // Insets for overlays: the plan sits in the free area (here below a 100 px bar).
    const inset = fitPlan([0, 0, 10, 5], 1000, 600, { top: 100, right: 20, bottom: 20, left: 20 });
    const top = inset.cz - 300 / inset.scale; // plan z at the view's top edge
    expect((0 - top) * inset.scale).toBeGreaterThanOrEqual(99.9);
    const bottom = inset.cz + 300 / inset.scale; // plan z at the bottom edge
    expect((bottom - 5) * inset.scale).toBeGreaterThanOrEqual(19.9);
    expect(clampZoom(1e9)).toBe(PLAN_ZOOM[1]);
    expect(clampZoom(Number.NaN)).toBe(PLAN_ZOOM[0]);
  });

  it('drafts rectangles and polygons with live measurements', () => {
    expect(dragRect([0, 0], [0.2, 3])).toEqual([]);
    const r = dragRect([4, 3], [1, 0]);
    expect(r).toEqual([[1, 0], [4, 0], [4, 3], [1, 3]]);
    expect(outlineArea(r)).toBe(9);
    expect(closesPolygon([[0, 0], [3, 0], [3, 3]], [0.1, 0.1])).toBe(true);
    expect(closesPolygon([[0, 0], [3, 0]], [0, 0])).toBe(false);
    expect(pathOf([[0, 0], [1, 0], [1, 1]], true)).toBe('M0 0 L1 0 L1 1 Z');
    expect(areaLabel(18.44)).toBe('18.4 m²');
    expect(areaLabel(123.6)).toBe('124 m²');
    expect(lengthLabel(3.456)).toBe('3.46 m');
    expect(roomColors('bedroom')).not.toEqual(roomColors('kitchen'));
    expect(roomColors('???')).toHaveLength(2);
  });
});

describe('walkthrough interactions', () => {
  const t = (id: string, x: number, z: number, y = 0): WalkTarget => ({ id, kind: 'switch', room: null, position: [x, y, z] });

  it('indexes switches, lamps, light sources and swappable pieces of a building', () => {
    const idx = walkIndex(flatWorld());
    expect(idx.switches.length).toBeGreaterThan(0);
    expect(idx.lights.length).toBeGreaterThan(0);
    expect(idx.lights.filter((l) => !l.noLight).every((l) => l.intensity > 0)).toBe(true);
    // Ceilings of recessed downlights switch with their room (glow only, no light source of their own).
    expect(idx.lights.some((l) => l.noLight === true && l.glows)).toBe(true);
    expect(idx.swappable.some((s) => s.kind === 'sofa' || s.kind === 'bed')).toBe(true);
    expect(walkIndex(createWorld())).toEqual({ switches: [], lamps: [], lights: [], swappable: [] });
  });

  it('picks the nearest target ahead within reach', () => {
    const targets = [t('front', 0, -1.2), t('behind', 0, 1), t('far', 0, -5), t('upstairs', 0, -1, 3.5)];
    expect(nearestTarget(targets, [0, 0, 0], [0, -1], 1.7)?.id).toBe('front');
    expect(nearestTarget(targets, [0, 0, 0], [0, 1], 1.7, 0.2)?.id).toBe('behind');
    expect(nearestTarget([t('close', 0.3, 0.3)], [0, 0, 0], [1, 0], 1, 0.9)?.id).toBe('close');
    expect(nearestTarget(targets, [0, 0, 0], [0, -1], 0.5)).toBeNull();
    // A switch is only reachable from the side its plate faces (not through the wall).
    const plate: WalkTarget = { ...t('switch', 0, -1), facing: [0, -1] };
    expect(nearestTarget([plate], [0, 0, 0], [0, -1], 1.7)).toBeNull();
    expect(nearestTarget([plate], [0, 0, -2], [0, 1], 1.7)?.id).toBe('switch');
  });

  it('switches a room off when any light is on, else on', () => {
    const lights = [
      { id: 'a', room: 'r1', intensity: 2, glows: true },
      { id: 'b', room: 'r1', intensity: 2, glows: true },
      { id: 'c', room: 'r2', intensity: 2, glows: true },
    ];
    expect(roomToggle(lights, new Map(), 'r1')).toEqual({ ids: ['a', 'b'], on: false });
    expect(roomToggle(lights, new Map([['a', false], ['b', false]]), 'r1')).toEqual({ ids: ['a', 'b'], on: true });
    expect(roomToggle(lights, new Map([['a', false]]), null).on).toBe(false);
  });

  it('cycles finishes and returns to the original', () => {
    expect([nextVariant(-1, 2), nextVariant(0, 2), nextVariant(1, 2)]).toEqual([0, 1, -1]);
    expect(nextVariant(-1, 0)).toBe(-1);
  });

  it('faces the entrance from the walkthrough spawn', () => {
    const w = flatWorld();
    const yaw = entranceYawDeg(w);
    expect(yaw).not.toBeNull();
    expect(entranceYawDeg(createWorld())).toBeNull();
  });

  it('keeps an authored start yaw unless it looks straight into a wall, then faces the entrance', () => {
    const w = flatWorld();
    const entrance = entranceYawDeg(w);
    const turned = Math.round((entrance ?? 0) + 90);
    const authored = { ...w, player: { ...w.player, yaw: turned } };
    expect(startYawDeg(authored, () => false)).toBe(turned);
    expect(startYawDeg(authored, () => true)).toBe(entrance);
    // Looking roughly at the entrance already: the authored yaw stands even with the facade ahead.
    const near = { ...w, player: { ...w.player, yaw: Math.round((entrance ?? 0) + 10) } };
    expect(startYawDeg(near, () => true)).toBe(Math.round((entrance ?? 0) + 10));
    expect(startYawDeg(w, () => true)).toBe(entrance);
    const open = createWorld({ player: { yaw: 30 } });
    expect(startYawDeg(open, () => true)).toBe(30);
  });
});

describe('ArchController', () => {
  function host(world: WorldDoc): ArchHost & { commits: unknown[][] } {
    const history = new History(world);
    const store = createStudioStore();
    const commits: unknown[][] = [];
    return {
      store,
      history,
      simulation: null,
      onSimulation: () => () => undefined,
      commitUser(patches, message) {
        commits.push(patches as unknown[]);
        const r = history.commit(patches, message, 'user');
        return r.errors.length > 0 ? r.errors[0]!.message : null;
      },
      setCameraView: () => undefined,
      commits,
    };
  }

  it('tracks the building, its storeys and opens it as a cutaway', () => {
    const h = host(flatWorld());
    const c = new ArchController(h);
    const a = h.store.getState().arch;
    expect(a.building).toBe('flat');
    expect(a.levels).toHaveLength(1);
    expect(a.walls).toBe('cutaway');
    c.dispose();
  });

  it('draws a room on the plan as one undoable, checked edit', () => {
    const h = host(flatWorld());
    const c = new ArchController(h);
    h.store.getState().setArch({ roomType: 'office' });
    expect(c.drawRoom([[0, 5], [6, 5], [6, 8.5], [0, 8.5]])).toBeNull();
    expect(h.commits).toHaveLength(1);
    expect(Object.values(h.history.current.entities).some((e) => e.arch?.role === 'room' && e.arch.kind === 'office')).toBe(true);
    // A refused edit reports the reason and commits nothing.
    const err = c.drawRoom([[1, 1], [3, 1], [3, 3], [1, 3]]);
    expect(err).toMatch(/overlaps/);
    expect(h.commits).toHaveLength(1);
    expect(h.store.getState().toasts.at(-1)?.text).toMatch(/overlaps/);
    // Doors, windows and removal go through the same path. A window clicked onto a wall joins the windows the room
    // has (the office's long south wall takes a third in its row); a wall its picture window already fills says so.
    const windowsOf = (room: string): number => Object.values(h.history.current.entities).filter((e) => e.arch?.role === 'window' && e.arch.room?.endsWith(`-${room}`)).length;
    const officeBefore = windowsOf('office');
    const livingBefore = windowsOf('living');
    expect(c.addWindow([3, 8.55])).toBeNull();
    expect(windowsOf('office')).toBe(officeBefore + 1);
    expect(c.addWindow([3, -0.05])).toMatch(/no exterior wall of living facing north has 1\.2 m of clear wall/);
    expect(windowsOf('living')).toBe(livingBefore);
    expect(c.removeRoom('office')).toBeNull();
    expect(Object.values(h.history.current.entities).some((e) => e.arch?.kind === 'office')).toBe(false);
    c.dispose();
  });

  it('keeps a drawn room reachable when furniture blocks the first door spot (regression)', () => {
    // The offline apartment: a room drawn behind the main bedroom used to get a door the bed blocked.
    const plan = planArch('a modern two-bedroom apartment', '')!.arch!.ops;
    const res = applyArchOps(createWorld(), plan);
    const world = applyPatches(createWorld(), res.patches).world;
    const h = host(world);
    const c = new ArchController(h);
    expect(c.drawRoom([[0, 10.6], [3.6, 10.6], [3.6, 13.6], [0, 13.6]])).toBeNull();
    const reports = checkBuildings(h.history.current, '*', 0.8);
    expect(reports[0]?.rooms).toBe(7);
    expect(reports[0]?.passed).toBe(true);
    c.dispose();
  });

  it('clears the building state when the world loses its building', () => {
    const h = host(flatWorld());
    const c = new ArchController(h);
    h.history.commit([{ op: 'remove', id: 'flat', recursive: true }], 'remove', 'user');
    expect(h.store.getState().arch.building).toBeNull();
    expect(c.drawRoom([[0, 0], [3, 0], [3, 3], [0, 3]])).toMatch(/no building/i);
    c.dispose();
  });

  it('photo mode renders in studio quality without making it the user choice (regression)', () => {
    const h = host(flatWorld());
    const calls: string[] = [];
    let quality = 'realtime';
    const renderer = {
      onQualityChange: null as ((q: string) => void) | null,
      studioQualityAvailable: true,
      setArchView: () => undefined,
      restoreEnvironment: () => undefined,
      setEnvironmentOverride: () => undefined,
      setRenderQuality(q: string) {
        calls.push(q);
        const changed = q !== quality;
        quality = q;
        if (changed) this.onQualityChange?.(q);
        return q;
      },
    };
    let listener: ((sim: unknown) => void) | null = null;
    const sim = { renderer } as unknown as NonNullable<ArchHost['simulation']>;
    const withSim: ArchHost = { ...h, get simulation() { return sim; }, onSimulation: (fn) => { listener = fn as (s: unknown) => void; return () => undefined; } };
    const c = new ArchController(withSim);
    h.store.getState().setArch({ quality: 'realtime' });
    listener!(sim);
    h.store.getState().setArch({ photo: true });
    expect(quality).toBe('studio');
    expect(h.store.getState().arch.quality).toBe('realtime');
    h.store.getState().setArch({ photo: false });
    expect(quality).toBe('realtime');
    // A real fallback (studio unavailable) is reported back to the UI.
    h.store.getState().setArch({ quality: 'studio' });
    renderer.studioQualityAvailable = false;
    renderer.setRenderQuality('realtime');
    expect(h.store.getState().arch).toMatchObject({ quality: 'realtime', studioAvailable: false });
    expect(calls.length).toBeGreaterThan(2);
    c.dispose();
  });

  it('suspends view modes while playing and restores them on Stop', () => {
    const h = host(flatWorld());
    const c = new ArchController(h);
    const st = h.store.getState();
    st.setArch({ walls: 'down', xray: true, section: 1.2, plan: true });
    st.setMode('play');
    expect(h.store.getState().arch).toMatchObject({ walls: 'up', xray: false, section: null, plan: false });
    h.store.getState().setArch({ photo: true });
    h.store.getState().setMode('edit');
    expect(h.store.getState().arch).toMatchObject({ walls: 'down', xray: true, section: 1.2, plan: true, photo: false });
    c.dispose();
  });
});
