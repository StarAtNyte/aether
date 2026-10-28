import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld } from '@aether/core';
import { loadCatalog } from '@aether/assets';
import { runDesignTool } from '../src/index';

const PLAN = { id: 'shop', name: 'Shop', style: 'modern', brief: 'A workshop.', levels: [{ height: 2.8, rooms: [{ id: 'room', type: 'office', rect: [0, 0, 6, 4.5] }], openings: [{ kind: 'door', room: 'room', wall: 'south', to: 'outside', along: 0.9, width: 0.9, id: 'door', main: true }] }] };

describe('small floor models on a table', () => {
  it('lets a toolbox, a crate and a bucket stand on a workbench, and refuses a filing cabinet', async () => {
    await loadCatalog();
    let w = createWorld({});
    w = applyPatches(w, runDesignTool(w, 'design_plan', { plan: PLAN }).patches).world;
    const place = (item: Record<string, unknown>): { ok: boolean; text: string } => {
      const r = runDesignTool(w, 'place_items', { items: [{ room: 'room', ...item }] });
      if (r.ok) w = applyPatches(w, r.patches).world;
      return r;
    };
    expect(place({ kind: 'model:simready-workbench-standard', id: 'bench', wall: 'north', align: 'centre' }).ok).toBe(true);
    const toolbox = place({ kind: 'model:simready-toolbox-hardcase', id: 'tb', on: 'shop-bench', offset: [-0.4, 0] });
    expect(toolbox.ok, toolbox.text).toBe(true);
    expect(place({ kind: 'model:simready-box-shipping', id: 'crate', on: 'shop-bench', offset: [0.55, 0] }).ok).toBe(true);
    expect(place({ kind: 'model:simready-bucket-red', id: 'bucket', on: 'shop-bench', offset: [0.05, 0] }).ok).toBe(true);
    const tb = w.entities['shop-tb'];
    expect(tb?.transform.position[1]).toBeGreaterThan(0.5);
    const big = place({ kind: 'model:simready-cabinet-filing', id: 'cab', on: 'shop-bench', offset: [0, 0] });
    expect(big.ok).toBe(false);
  });
});
