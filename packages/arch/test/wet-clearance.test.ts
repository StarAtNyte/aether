import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld } from '@aether/core';
import { applyArchOps, readScene, runDesignTool } from '../src/index';
import { convexOverlap } from '../src/layout';

const PLAN = {
  id: 'bath-home',
  name: 'Bathroom',
  style: 'modern',
  brief: 'A small bathroom with a walk-in shower.',
  programme: [{ room: 'bath', purpose: 'wash', targetArea: 6 }],
  circulation: { entrance: 'bath', notes: 'Door on the south wall.' },
  levels: [
    {
      height: 2.8,
      rooms: [{ id: 'bath', type: 'bathroom', rect: [0, 0, 2.4, 2.6] }],
      openings: [{ id: 'door-s', kind: 'door', room: 'bath', wall: 'south', to: 'outside', along: 1.8, width: 0.9, main: true }],
    },
  ],
  furniture: [{ id: 'shower', kind: 'shower', room: 'bath', intent: 'walk-in shower in the north-west corner', relations: [{ type: 'in_corner', wall: 'north' }] }],
};

describe('wet clearance', () => {
  it('a re-compile (a window added) never leaves a compiled piece standing in or against a shower placed by the design tools', () => {
    let w = createWorld({});
    const plan = runDesignTool(w, 'design_plan', { plan: PLAN });
    expect(plan.ok, plan.text).toBe(true);
    w = applyPatches(w, plan.patches).world;
    const placed = runDesignTool(w, 'place_items', { items: [{ kind: 'shower', room: 'bath', id: 'shower', wall: 'north', t: 0.8 }] });
    expect(placed.refused, placed.text).toBe(0);
    w = applyPatches(w, placed.patches).world;
    // The room is then furnished automatically (as a model's furnish_room does) and a window is added: both re-compile.
    const res = applyArchOps(w, [{ op: 'furnish_room', building: 'bath-home', room: 'bath' }, { op: 'add_window', building: 'bath-home', window: { room: 'bath', side: 'east', width: 0.6, height: 0.6, sill: 1.5 } }]);
    w = applyPatches(w, res.patches).world;
    const scene = readScene(w, 'bath-home');
    expect(scene).not.toBeNull();
    const shower = scene!.items.find((i) => i.kind === 'shower');
    expect(shower).toBeDefined();
    // The compiler furnished the rest of the room round it (vanity, toilet, a plant).
    expect(scene!.items.filter((i) => !i.placed && i.mount === 'floor').length).toBeGreaterThan(1);
    for (const it of scene!.items) {
      if (it === shower || it.mount !== 'floor' || it.kind === 'rug' || it.footprint.length === 0) continue;
      if (it.kind === 'plant' || it.kind === 'floor-lamp' || it.kind === 'side-table') expect(convexOverlap(it.footprint, shower!.footprint, -0.3), `${it.kind} at the shower`).toBe(false);
      else expect(convexOverlap(it.footprint, shower!.footprint), `${it.kind} in the shower`).toBe(false);
    }
  });
});
