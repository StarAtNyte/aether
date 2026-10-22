import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld } from '@aether/core';
import { deriveBuild, memoryCaller, parseRoomDescription, runBuild, scaleAdvisory } from '../src/photo/index';
import { applyArchOps, partKinds, runDesignTool } from '../src/index';
import { doorwayFindings, projectOverlays, readScene, reviewPoses, roomAdvice } from '../src/scene/index';

function firstDescription(id: string): Record<string, unknown> {
  const t = JSON.parse(readFileSync(resolve(__dirname, `../../../tests/fixtures/photo/${id}.transcript.json`), 'utf8')) as { responses: Array<{ content: Array<{ name?: string; input?: { description?: Record<string, unknown> } }> }> };
  for (const r of t.responses) for (const c of r.content) if (c.name === 'describe_room' && c.input?.description) return c.input.description;
  throw new Error('no description');
}

function room(type: string, w: number, d: number, doorWall: string, dw: number) {
  const along = doorWall === 'south' || doorWall === 'north' ? w * 0.5 : d * 0.5;
  const plan = { id: 'b', name: 'B', style: 'modern', brief: 'room', programme: [{ room: 'r', purpose: type, targetArea: w * d }], circulation: { entrance: 'r', notes: 'door' }, levels: [{ height: 2.7, rooms: [{ id: 'r', type, rect: [0, 0, w, d] }], openings: [{ id: 'dr', kind: 'door', room: 'r', wall: doorWall, to: 'outside', along, width: dw, main: true }] }], furniture: [] };
  let world = createWorld({});
  const r = runDesignTool(world, 'design_plan', { plan });
  if (!r.ok) return null;
  world = applyPatches(world, r.patches).world;
  world = applyPatches(world, applyArchOps(world, [{ op: 'furnish_room', building: 'b', room: 'r' }]).patches).world;
  return world;
}

describe('room advice (advisory evidence, never a gate)', () => {
  for (const id of ['twin', 'hotel']) {
    it(`${id}: swing arcs, approach zones and a text readout come out of the built room`, async () => {
      const p = parseRoomDescription(firstDescription(id), partKinds());
      if (!p.ok) throw new Error(p.error);
      const mem = memoryCaller(createWorld({}));
      const built = await runBuild(mem.world(), deriveBuild(p.value), mem.call);
      expect(built.shellOk).toBe(true);
      const scene = readScene(built.world, 'room-photo')!;
      const r = scene.rooms.find((x) => x.key === 'photo-room') ?? scene.rooms[0]!;
      const adv = roomAdvice(scene, r);
      expect(adv.overlays.some((o) => o.kind === 'approach')).toBe(true);
      expect(adv.lines.join('\n')).toMatch(/walkable/);
      const text = scaleAdvisory(built.world);
      expect(text).toMatch(/Circulation/);
      const plan = reviewPoses(built.world, 'room-photo', { maxViews: 12 }).find((q) => q.kind === 'plan')!;
      const proj = projectOverlays(built.world, 'room-photo', plan, adv.overlays, r.levelId);
      expect(proj.length).toBeGreaterThan(0);
      for (const o of proj) for (const [x, y] of o.pts) expect(Number.isFinite(x + y)).toBe(true);
    });
  }

  it('a bed standing in a door swing is reported, not moved', () => {
    const world = room('bedroom', 3, 3, 'south', 0.9);
    expect(world).not.toBeNull();
    const scene = readScene(world!, 'b')!;
    const r = scene.rooms[0]!;
    const adv = roomAdvice(scene, r);
    expect(adv.overlays.filter((o) => o.kind === 'swing').length).toBeGreaterThan(0);
  });

  it('the swing of every furnished generated room stays free of furniture', () => {
    const bad: string[] = [];
    let n = 0;
    for (const type of ['bedroom', 'living', 'office']) {
      for (const [w, d] of [[3.6, 4.2], [5, 4]] as Array<[number, number]>) {
        for (const wall of ['south', 'east']) {
          for (const dw of [0.9, 1.6]) {
            const world = room(type, w, d, wall, dw);
            const scene = world ? readScene(world, 'b') : null;
            if (!scene) continue;
            n++;
            for (const f of doorwayFindings(scene)) bad.push(`${type} ${w}x${d} ${wall} ${dw}: ${f.message}`);
          }
        }
      }
    }
    expect(n).toBeGreaterThan(10);
    expect(bad).toEqual([]);
  });
});

describe('rescaleDescription', () => {
  it('keeps floor pieces against their wall and wall pieces centred', async () => {
    const { rescaleDescription, anchored, centred } = await import('../src/photo/scale');
    expect(anchored(0.5, 3, 4)).toBe(0.5);
    expect(anchored(2.4, 3, 4)).toBe(3.4);
    expect(centred(1.5, 3, 4)).toBe(2);
    const d = { footprint: { width: 3, depth: 5 }, items: [{ wall: 'north', along: 1.5 }, { at: [0.5, 4.5] }], openings: [{ wall: 'north', along: 1.5 }], camera: { x: 1.5, z: 4.6 } };
    const r = rescaleDescription(d, 4, 5);
    expect(r.footprint).toEqual({ width: 4, depth: 5 });
    expect(r.items[0]).toEqual({ wall: 'north', along: 2 });
    expect(r.items[1]).toEqual({ at: [0.5, 4.5] });
    expect(r.openings[0]).toEqual({ wall: 'north', along: 2 });
    expect(d.footprint.width).toBe(3);
  });
});
