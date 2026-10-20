/**
 * Front clearance measures the floor: a ceiling light over the space in front of a shower or wardrobe takes none of
 * it (acceptance: a Codex house kept reporting "only 0.20 m of clear floor in front" of both showers because of the
 * bathroom ceiling lights, and the model had to move the lights to silence it).
 */
import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld } from '@aether/core';
import { applyArchOps, DesignPlan, designToBuildingPlan, freeFrontDepth, placeItem, readScene, type SceneItem } from '../src/index';
import { applyEdit } from './scene-helpers';

const PLAN = DesignPlan.parse({
  id: 'home',
  name: 'Test home',
  style: 'scandinavian',
  brief: 'A bedroom with a wardrobe.',
  programme: [{ room: 'bedroom', purpose: 'sleep', targetArea: 14 }],
  circulation: { entrance: 'hall', notes: 'front door into the hall' },
  levels: [
    {
      height: 2.9,
      rooms: [
        { id: 'bedroom', type: 'bedroom', rect: [0, 0, 4, 3.6] },
        { id: 'hall', type: 'hall', rect: [0, 3.6, 4, 5.2] },
      ],
      openings: [
        { kind: 'door', room: 'bedroom', wall: 'south', to: 'hall', along: 3.2, width: 0.9, id: 'door-bed' },
        { kind: 'door', room: 'hall', wall: 'south', to: 'outside', along: 1.4, width: 1, main: true, id: 'front' },
      ],
    },
  ],
  furniture: [],
});

function shifted(it: SceneItem, dx: number, dz: number, over: Partial<SceneItem>): SceneItem {
  return { ...it, ...over, pos: [it.pos[0] + dx, it.pos[1], it.pos[2] + dz], footprint: it.footprint.map(([x, z]) => [x + dx, z + dz] as [number, number]) };
}

describe('front clearance', () => {
  it('a ceiling light in front of a wardrobe takes no floor; a chest standing there does', () => {
    const world = createWorld({});
    const res = applyArchOps(world, [{ op: 'create_building', plan: designToBuildingPlan(PLAN) }]);
    expect(res.errors).toEqual([]);
    const built = applyPatches(world, res.patches).world;
    const w = applyEdit(built, placeItem(built, undefined, { kind: 'wardrobe', room: 'bedroom', id: 'robe', wall: 'north', align: 'centre' }));
    const scene = readScene(w, 'home');
    expect(scene).not.toBeNull();
    if (!scene) return;
    const robe = scene.items.find((i) => i.kind === 'wardrobe');
    expect(robe).toBeDefined();
    if (!robe) return;
    const open = freeFrontDepth(scene, robe, 0.9);
    expect(open).toBeGreaterThanOrEqual(0.85);
    // In front of it (toward the room): which way is "front" follows the wardrobe's yaw.
    const f: [number, number] = [Math.sin((robe.yaw * Math.PI) / 180), Math.cos((robe.yaw * Math.PI) / 180)];
    const d = robe.size[2] / 2 + 0.4;
    const lamp = shifted(robe, f[0] * d, f[1] * d, { id: 'lamp', kind: 'ceiling-light', name: 'Ceiling light', mount: 'ceiling', y0: 2.8, y1: 2.88 });
    expect(freeFrontDepth({ ...scene, items: [...scene.items, lamp] }, robe, 0.9)).toBe(open);
    const chest = shifted(robe, f[0] * d, f[1] * d, { id: 'chest', kind: 'chest', name: 'Chest', mount: 'floor', y0: 0, y1: 0.8 });
    expect(freeFrontDepth({ ...scene, items: [...scene.items, chest] }, robe, 0.9)).toBeLessThan(0.3);
  });
});
