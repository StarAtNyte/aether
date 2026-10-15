import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createWorld } from '@aether/core';
import {
  PHOTO_BUILDING_ID,
  PHOTO_ROOM_ID,
  alongToT,
  buildChecklist,
  calibrateCamera,
  framingOf,
  framingTargets,
  framingText,
  fitOpening,
  deriveBuild,
  floorFinish,
  memoryCaller,
  parseRoomDescription,
  photoCameraSpec,
  runBuild,
  scoreVerdicts,
  verticalFov,
  wallBehind,
} from '../src/photo/index';
import { customPose, entityGeometry, partKinds, projectMarks, readScene, reviewFindings } from '../src/index';

const FIXTURE = resolve(__dirname, '../../../tests/fixtures/photo/hotel.description.json');
const raw = (): unknown => JSON.parse(readFileSync(FIXTURE, 'utf8')) as unknown;

function description() {
  const p = parseRoomDescription(raw(), partKinds());
  if (!p.ok) throw new Error(p.error);
  return p;
}

describe('room description schema', () => {
  it('parses the hotel fixture without repairs', () => {
    const p = description();
    expect(p.fixes).toEqual([]);
    expect(p.value.items.length).toBe(11);
  });

  it('rejects absurd sizes and bad colours', () => {
    const bad = { ...(raw() as object), footprint: { width: 400, depth: 3, ceiling: 2.7 } };
    expect(parseRoomDescription(bad, partKinds()).ok).toBe(false);
    const badColour = { ...(raw() as Record<string, unknown>), palette: ['red'] };
    expect(parseRoomDescription(badColour, partKinds()).ok).toBe(false);
  });

  it('accepts numbers written as strings and maps kind synonyms to parts', () => {
    const r = raw() as { items: Array<Record<string, unknown>>; footprint: Record<string, unknown> };
    r.footprint['width'] = '3.6 m';
    r.items.push({ id: 'poster', kind: 'Wall Art', along: 1, wall: 'north', params: {} }, { id: 'sofa-x', kind: 'couch', wall: 'south', along: 2 });
    const p = parseRoomDescription(r, partKinds());
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.value.footprint.width).toBe(3.6);
    expect(p.value.items.find((i) => i.id === 'poster')?.kind).toBe('art');
    expect(p.value.items.find((i) => i.id === 'sofa-x')?.kind).toBe('sofa');
    expect(p.fixes.some((f) => f.includes('couch'))).toBe(true);
  });

  it('drops a piece that matches no part and says so, renames duplicate ids, clamps along', () => {
    const r = raw() as { items: Array<Record<string, unknown>> };
    r.items.push({ id: 'bed', kind: 'bed', wall: 'north', along: 99, params: {} }, { id: 'ufo', kind: 'flying-saucer', wall: 'north', along: 1 });
    const p = parseRoomDescription(r, partKinds());
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.value.items.some((i) => i.id === 'bed-2')).toBe(true);
    expect(p.value.items.find((i) => i.id === 'bed-2')?.along).toBe(3.7);
    expect(p.value.items.some((i) => i.id === 'ufo')).toBe(false);
    expect(p.fixes.join('\n')).toContain('flying-saucer');
  });
});

describe('openings that a photo estimate gets slightly wrong', () => {
  const d = description().value;
  it('shortens a window that would reach the ceiling and says so', () => {
    const notes: string[] = [];
    const o = fitOpening(d, { id: 'w', kind: 'window', wall: 'west', along: 2, width: 1.2, height: 1.9, sill: 0.95, visible: true, note: '' }, notes);
    expect((o.sill ?? 0) + (o.height ?? 0)).toBeLessThanOrEqual(d.footprint.ceiling - 0.1);
    expect(notes.join(' ')).toContain('shortened');
  });
  it('narrows and moves an opening that does not fit its wall', () => {
    const notes: string[] = [];
    const o = fitOpening(d, { id: 'w', kind: 'window', wall: 'north', along: 3.6, width: 5, sill: 0.9, visible: true, note: '' }, notes);
    expect(o.width).toBeLessThan(d.footprint.width);
    expect(o.along - o.width / 2).toBeGreaterThanOrEqual(0.09);
    expect(o.along + o.width / 2).toBeLessThanOrEqual(d.footprint.width - 0.09);
    expect(notes.length).toBeGreaterThan(0);
  });
  it('leaves a sound opening alone, and the shell of a too-tall window description builds', async () => {
    const notes: string[] = [];
    const ok = { id: 'w', kind: 'window' as const, wall: 'west' as const, along: 3.3, width: 1.3, height: 1.5, sill: 0.8, visible: true, note: '' };
    expect(fitOpening(d, ok, notes)).toEqual(ok);
    expect(notes).toEqual([]);
    const tall = { ...d, openings: [{ ...ok, height: 2.4, sill: 0.8 }] };
    const mem = memoryCaller(createWorld({}));
    const run = await runBuild(mem.world(), deriveBuild(tall), mem.call);
    expect(run.shellOk, run.shellText).toBe(true);
  });
});

describe('derivation', () => {
  it('maps floor words to finishes', () => {
    expect(floorFinish('dark fitted carpet')).toBe('carpet');
    expect(floorFinish('pale oak boards')).toBe('oak');
    expect(floorFinish('polished concrete')).toBe('concrete');
    expect(floorFinish('mystery')).toBe('oak');
  });

  it('finds the wall behind the camera', () => {
    expect(wallBehind(0)).toBe('south');
    expect(wallBehind(-38)).toBe('south');
    expect(wallBehind(90)).toBe('west');
    expect(wallBehind(180)).toBe('north');
    expect(wallBehind(-90)).toBe('east');
  });

  it('builds a plan of exactly the described room, adds an assumed door and keeps the openings where described', () => {
    const b = deriveBuild(description().value);
    const lvl = b.plan.levels[0];
    expect(lvl?.rooms[0]?.rect).toEqual([-0.14, -0.14, 3.84, 4.64]);
    const win = lvl?.openings.find((o) => o.kind === 'window');
    expect(win?.wall).toBe('west');
    expect(win?.along).toBe(alongToT(3.3));
    const door = lvl?.openings.find((o) => o.kind === 'door');
    expect(door?.to).toBe('outside');
    expect(door?.wall).toBe('south');
    expect(b.assumedDoor?.visible).toBe(false);
    expect(b.notes.join(' ')).toContain('door');
    expect(lvl?.height).toBeCloseTo(2.85 + 0.22, 5);
  });

  it('orders steps: floor pieces large to small, then surface pieces, wall pieces, curtains, trim', () => {
    const b = deriveBuild(description().value);
    const phases = b.steps.map((s) => s.phase);
    const rank = { rug: 0, floor: 1, surface: 2, wall: 3, curtain: 4, ceiling: 5, trim: 6 } as const;
    expect([...phases].sort((a, c) => rank[a] - rank[c])).toEqual(phases);
    expect(b.steps[0]?.id).toBe('bed');
    expect(b.steps.filter((s) => s.id.startsWith('cornice')).length).toBe(4);
    expect(b.steps.find((s) => s.id === 'picture-left')?.aboveOf).toEqual({ target: 'bed', gap: 0.45 });
  });

  it('builds the checklist with structural entries for the shell, the window and the bed', () => {
    const list = buildChecklist(description().value);
    const structural = list.filter((c) => c.structural).map((c) => c.id);
    expect(structural).toEqual(expect.arrayContaining(['shell-size', 'opening-win-1', 'item-bed']));
    expect(list.some((c) => c.id === 'cornice')).toBe(true);
    // The assumed door is not visible in the photo, so it is not judged.
    expect(list.some((c) => c.id === 'opening-door-assumed')).toBe(false);
  });
});

describe('scoreboard', () => {
  const list = buildChecklist(description().value);

  it('counts passes; missing verdicts fail; a structural failure is flagged', () => {
    const all = list.map((c) => ({ id: c.id, pass: true, note: '' }));
    expect(scoreVerdicts(list, all)).toMatchObject({ rate: 1, structuralFailed: false });
    const some = all.filter((v) => v.id !== 'item-bed');
    const s = scoreVerdicts(list, some);
    expect(s.passed).toBe(list.length - 1);
    expect(s.structuralFailed).toBe(true);
    expect(s.failing[0]?.note).toBe('not judged');
  });

  it('ignores unknown ids and lets the last verdict win', () => {
    const s = scoreVerdicts(list, [
      { id: 'nonsense', pass: true, note: '' },
      { id: 'floor', pass: false, note: 'wrong' },
      { id: 'floor', pass: true, note: '' },
    ]);
    expect(s.passed).toBe(1);
  });
});

describe('camera', () => {
  it('converts the horizontal field of view to a vertical one for the image aspect', () => {
    expect(verticalFov(90, 1)).toBeCloseTo(90, 5);
    expect(verticalFov(90, 1.5)).toBeCloseTo(67.4, 0);
    expect(verticalFov(90, Number.NaN)).toBeGreaterThan(60);
  });
});

describe('the hotel room end to end through the design tools', () => {
  const d = description().value;
  const build = deriveBuild(d);

  it('builds the shell and places every piece, anchored', async () => {
    const mem = memoryCaller(createWorld({}));
    const run = await runBuild(mem.world(), build, mem.call);
    expect(run.shellOk, run.shellText).toBe(true);
    const failed = run.outcomes.filter((o) => !o.ok);
    expect(failed, JSON.stringify(failed, null, 1)).toEqual([]);
    const scene = readScene(run.world, PHOTO_BUILDING_ID);
    expect(scene).not.toBeNull();
    if (!scene) return;
    const room = scene.rooms.find((r) => r.key === PHOTO_ROOM_ID);
    expect(room).toBeTruthy();
    expect(room?.bbox[2]).toBeCloseTo(3.84, 1);
    // The window sits where described, on the west wall.
    const west = room?.walls.find((w) => w.compass === 'west');
    const win = west?.openings.find((o) => o.kind === 'window');
    expect(win).toBeTruthy();
    expect(win?.width).toBeCloseTo(1.3, 1);
    expect(win?.sill).toBeCloseTo(0.55, 1);
    // Two curtain panels, both beside that window and floor length.
    const panels = scene.items.filter((i) => i.kind === 'curtain');
    expect(panels.length).toBe(2);
    for (const p of panels) {
      expect(p.wall?.compass).toBe('west');
      expect(p.y0).toBeCloseTo(0, 2);
      expect(p.y1).toBeGreaterThan(2.6);
    }
    // Pictures hang on the north wall above the headboard, over the bed's span.
    const bed = scene.items.find((i) => i.kind === 'bed');
    const pics = scene.items.filter((i) => i.kind === 'art');
    expect(pics.length).toBe(2);
    for (const p of pics) {
      expect(p.wall?.compass).toBe('north');
      expect(p.y0).toBeGreaterThan((bed?.y1 ?? 0) + 0.2);
      expect(p.y0).toBeLessThan(2.1);
    }
    // The bed stands against the north wall; the lamp on the table stands at the table's top.
    expect(bed?.against?.some((a) => a.compass === 'north')).toBe(true);
    const lamp = scene.items.find((i) => i.id.endsWith('bedside-lamp'));
    const stand = scene.items.find((i) => i.id.endsWith('-nightstand'));
    expect(lamp?.y0).toBeCloseTo(stand?.y1 ?? -1, 2);
    // Cornices on every wall.
    expect(scene.items.filter((i) => i.kind === 'cornice').length).toBe(4);
    // The checker reports no error.
    expect(reviewFindings(run.world, PHOTO_BUILDING_ID).filter((f) => f.severity === 'error')).toEqual([]);
  });

  it('paints walls that differ in the photo one by one', async () => {
    const mem = memoryCaller(createWorld({}));
    const run = await runBuild(mem.world(), build, mem.call);
    const colours = new Set<string>();
    for (const e of Object.values(run.world.entities)) {
      if (e.arch?.role !== 'wall') continue;
      const sh = e.shape as { params?: Record<string, { color?: string }> };
      for (const k of ['finishA', 'finishB']) if (sh.params?.[k]?.color) colours.add(String(sh.params[k]?.color));
    }
    expect(colours.has('#7d6a74')).toBe(true);
    expect(colours.has('#6f5d68')).toBe(true);
  });

  it('gives the photo camera marks on the pieces it sees', async () => {
    const mem = memoryCaller(createWorld({}));
    const run = await runBuild(mem.world(), build, mem.call);
    const pose = customPose(run.world, PHOTO_BUILDING_ID, photoCameraSpec(d, 1.5));
    expect(pose).not.toBeNull();
    if (!pose) return;
    expect(pose.position[1]).toBeGreaterThanOrEqual(d.camera.height);
    const marks = projectMarks(run.world, PHOTO_BUILDING_ID, pose, 1.5);
    // Bed, pictures and window are in front of the camera.
    expect(marks.length).toBeGreaterThanOrEqual(5);
  });
});

describe('framing and camera calibration', () => {
  const d = description().value;
  const build = deriveBuild(d);

  it('reads boxes, drops unusable ones', () => {
    expect(d.items.find((i) => i.id === 'bed')?.box).toEqual([0.18, 0.59, 0.96, 1]);
    const r = raw() as { items: Array<Record<string, unknown>> };
    r.items[0]!['box'] = [0.5, 0.5, 0.5, 0.5];
    r.items[1]!['box'] = [1.4, -2, 0.1, 0.2];
    const p = parseRoomDescription(r, partKinds());
    expect(p.ok && p.value.items[0]?.box).toBeUndefined();
    expect(p.ok && p.value.items[1]?.box).toEqual([0.1, 0, 1, 0.2]);
  });

  it('scores the hand-annotated hotel room well from its own camera and badly from a wrong one', async () => {
    const mem = memoryCaller(createWorld({}));
    const run = await runBuild(mem.world(), build, mem.call);
    const targets = framingTargets(d, run.openings);
    expect(targets.length).toBeGreaterThanOrEqual(10);
    const geometry = entityGeometry(run.world, PHOTO_BUILDING_ID);
    const good = framingOf(geometry, targets, customPose(run.world, PHOTO_BUILDING_ID, photoCameraSpec(d, 1.5))!, 1.5);
    const wrong = framingOf(geometry, targets, customPose(run.world, PHOTO_BUILDING_ID, photoCameraSpec({ ...d, camera: { ...d.camera, heading: 40, x: 1, z: 1 } }, 1.5))!, 1.5);
    expect(good.score).toBeGreaterThan(wrong.score + 0.2);
  });

  it('recovers the framing from a camera that is badly off', async () => {
    const mem = memoryCaller(createWorld({}));
    const run = await runBuild(mem.world(), build, mem.call);
    const targets = framingTargets(d, run.openings);
    const off = { ...d, camera: { ...d.camera, x: d.camera.x - 1.2, z: d.camera.z - 1.0, heading: d.camera.heading + 22, fov: d.camera.fov - 15 } };
    const fit = calibrateCamera(run.world, off, 1.5, targets);
    expect(fit).not.toBeNull();
    expect(fit?.improved).toBe(true);
    expect(fit!.after.score).toBeGreaterThan(fit!.before.score + 0.1);
    expect(fit!.after.score).toBeGreaterThan(0.6);
    // Deterministic.
    expect(calibrateCamera(run.world, off, 1.5, targets)?.camera).toEqual(fit?.camera);
  });

  it('does not fit with too few targets and names the worst boxes for the model', async () => {
    const mem = memoryCaller(createWorld({}));
    const run = await runBuild(mem.world(), build, mem.call);
    expect(calibrateCamera(run.world, d, 1.5, framingTargets(d, run.openings).slice(0, 2))).toBeNull();
    const targets = framingTargets(d, run.openings);
    const wrong = framingOf(entityGeometry(run.world, PHOTO_BUILDING_ID), targets, customPose(run.world, PHOTO_BUILDING_ID, photoCameraSpec({ ...d, camera: { ...d.camera, heading: 40 } }, 1.5))!, 1.5);
    const text = framingText(wrong);
    expect(text).toContain('photo x');
    expect(text).toContain('render');
  });
});
