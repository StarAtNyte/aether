import { expect } from 'vitest';
import { applyPatches, createWorld, type Patch, type PatchInput, type WorldDoc } from '@aether/core';
import { compileBuilding, type BuildingPlanInput, type EditResult } from '../src/index';

/** One bedroom (4 × 3.6) with a door to a hall and one window on the north wall; nothing furnished. */
export const SHELL: BuildingPlanInput = {
  id: 'home',
  name: 'Test home',
  style: 'modern',
  levels: [
    {
      height: 2.9,
      autoWindows: false,
      rooms: [
        { id: 'bedroom', type: 'bedroom', rect: [0, 0, 4, 3.6], furnish: false },
        { id: 'hall', type: 'hall', rect: [0, 3.6, 4, 5.2], furnish: false },
      ],
      doors: [
        { between: ['hall', 'bedroom'], at: 0.15, width: 0.9 },
        { between: ['hall', 'outside'], side: 'south', main: true },
      ],
      windows: [{ room: 'bedroom', side: 'north', count: 1, width: 1.4, height: 1.3, sill: 0.9 }],
    },
  ],
};

export function shellWorld(plan: BuildingPlanInput = SHELL): WorldDoc {
  const c = compileBuilding(plan);
  const res = applyPatches(createWorld({ environment: { ground: { material: { preset: 'grass' }, size: 100 } } }), c.patches as PatchInput[], { atomic: true });
  expect(res.errors).toEqual([]);
  return res.world;
}

/** Apply an edit result, failing the test on a refusal. */
export function applyEdit(world: WorldDoc, r: EditResult): WorldDoc {
  if (!r.ok) throw new Error(`refused: ${r.error}`);
  const res = applyPatches(world, r.patches as Patch[]);
  expect(res.errors).toEqual([]);
  return res.world;
}

