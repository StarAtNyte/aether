/**
 * Automatic repair: the review loop fixes mechanical furniture faults with the product's own tools before the model looks.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createWorld, type WorldDoc } from '@aether/core';
import { autoRepairBuildings } from '../src/auto-repair';
import { snapshotForReview } from '../src/review';

const apartment = (): WorldDoc => {
  const file = fileURLToPath(new URL('../../../apps/studio/public/templates/worlds/cosy-apartment.json', import.meta.url));
  return createWorld((JSON.parse(readFileSync(file, 'utf8')) as { world: WorldDoc }).world);
};
const errors = (w: WorldDoc) => snapshotForReview(w, null, { maxViews: 0, withViews: false }).findings.filter((f) => f.severity === 'error');

describe('autoRepairBuildings', () => {
  it('leaves a clean building alone', () => {
    const w = apartment();
    const before = errors(w).length;
    const fix = autoRepairBuildings(w);
    expect(fix.before).toBe(before);
    if (before === 0) expect(fix.patches).toEqual([]);
  });

  it('repairs a room where a book was pushed into a lamp, and never adds errors', () => {
    const w = apartment();
    const book = w.entities['apartment-l0-bed2-f16'];
    const lamp = w.entities['apartment-l0-bed2-f3'];
    if (!book || !lamp) throw new Error('fixture');
    book.transform.position = [...lamp.transform.position];
    const broken = errors(w).length;
    expect(broken).toBeGreaterThan(0);
    const fix = autoRepairBuildings(w);
    expect(fix.patches.length).toBeGreaterThan(0);
    expect(fix.after).toBeLessThan(broken);
    expect(errors(fix.world).length).toBe(fix.after);
    expect(fix.lines.length).toBeGreaterThan(0);
  }, 120_000);

  it('puts a floor piece left in the air back on its floor', () => {
    const w = apartment();
    const bed = Object.values(w.entities).find((e) => e.shape.kind === 'procedural' && e.shape.generator === 'furn-bed');
    if (!bed) throw new Error('fixture');
    bed.transform.position = [bed.transform.position[0], 0.3, bed.transform.position[2]];
    const broken = errors(w).length;
    expect(broken).toBeGreaterThan(0);
    const fix = autoRepairBuildings(w);
    expect(fix.after).toBeLessThan(broken);
    expect(fix.world.entities[bed.id]?.transform.position[1]).toBeCloseTo(0, 3);
  }, 120_000);
});
