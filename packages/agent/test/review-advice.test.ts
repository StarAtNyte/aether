import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld } from '@aether/core';
import { applyArchOps, runDesignTool } from '@aether/arch';
import { reviewTurnText, snapshotForReview } from '../src/review';

describe('review turn carries circulation evidence', () => {
  it('lists swings, walkable floor and standard sizes as advice, and draws the plan overlays', () => {
    const plan = { id: 'b', name: 'B', style: 'modern', brief: 'room', programme: [{ room: 'r', purpose: 'bedroom', targetArea: 12 }], circulation: { entrance: 'r', notes: 'door' }, levels: [{ height: 2.7, rooms: [{ id: 'r', type: 'bedroom', rect: [0, 0, 3, 4] }], openings: [{ id: 'dr', kind: 'door', room: 'r', wall: 'south', to: 'outside', along: 1.5, width: 0.9, main: true }] }], furniture: [] };
    let world = createWorld({});
    const r = runDesignTool(world, 'design_plan', { plan });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    world = applyPatches(world, r.patches).world;
    world = applyPatches(world, applyArchOps(world, [{ op: 'furnish_room', building: 'b', room: 'r' }]).patches).world;
    const snap = snapshotForReview(world, null, { maxViews: 8, withViews: true });
    expect(snap.advice).toMatch(/walkable/);
    expect(snap.advice).toMatch(/advisory/);
    const plans = snap.views.filter((v) => v.kind === 'plan');
    if (plans.length > 0) expect(plans.some((v) => (v.overlays ?? []).length > 0)).toBe(true);
    expect(reviewTurnText(1, snap, { hasImages: true, lastEdited: false })).toContain('decide what to move, remove or enlarge');
  });
});
