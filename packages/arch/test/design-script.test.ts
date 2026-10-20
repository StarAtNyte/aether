import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld } from '@aether/core';
import { reviewFindings, runDesignTool } from '../src/index';
import { BEDROOM_ITEMS, BEDROOM_PLAN, PAINTING_FIX } from '../../../tests/e2e/support/design-script';

describe('the scripted designer of the design e2e', () => {
  it('builds a bedroom without a single checker error or warning, and honours the plan', () => {
    let w = createWorld({});
    const plan = runDesignTool(w, 'design_plan', { plan: BEDROOM_PLAN });
    expect(plan.ok, plan.text).toBe(true);
    w = applyPatches(w, plan.patches).world;
    const placed = runDesignTool(w, 'place_items', { items: BEDROOM_ITEMS });
    expect(placed.refused, placed.text).toBe(0);
    w = applyPatches(w, placed.patches).world;
    // Information notes (the dressing suggestion) are advice, not checker errors or warnings.
    expect(reviewFindings(w, 'bedroom-home').filter((f) => f.severity !== 'info').map((f) => `${f.code}: ${f.message}`)).toEqual([]);
  });

  it('fixes a painting dragged over the window', () => {
    let w = createWorld({});
    w = applyPatches(w, runDesignTool(w, 'design_plan', { plan: BEDROOM_PLAN }).patches).world;
    w = applyPatches(w, runDesignTool(w, 'place_items', { items: BEDROOM_ITEMS }).patches).world;
    const p = w.entities['bedroom-home-picture']!;
    // Drag it east onto the window of the east wall (by hand).
    w = applyPatches(w, [{ op: 'update', id: p.id, set: { transform: { ...p.transform, position: [4.26, 1.5, 1.9], rotation: [0, -90, 0] } } }]).world;
    expect(reviewFindings(w, 'bedroom-home').some((f) => f.severity === 'error')).toBe(true);
    const fix = runDesignTool(w, 'edit_items', { edits: PAINTING_FIX });
    expect(fix.refused, fix.text).toBe(0);
    w = applyPatches(w, fix.patches).world;
    expect(reviewFindings(w, 'bedroom-home').filter((f) => f.severity === 'error')).toEqual([]);
  });
});
