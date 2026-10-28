import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FRONT_FIX_REV } from '../../../scripts/assets/front';
import { classify, denied, needsFrontFix, opaque, stemOf } from '../../../scripts/assets/simready-bulk';
import { budgetFor } from '../../../scripts/assets/simready-gate';

const qf = JSON.parse(readFileSync(new URL('../../../scripts/assets/simready-queries.json', import.meta.url), 'utf8')) as Parameters<typeof classify>[1];

describe('bulk SimReady import helpers', () => {
  it('finds the variant stem of a package name', () => {
    expect(stemOf('chair_office_fabric_manager_a01')).toBe('chair_office_fabric_manager');
    expect(stemOf('chair_hospital_b03')).toBe('chair_hospital');
    expect(stemOf('D00825')).toBe('d00825');
  });
  it('denies whole words only', () => {
    expect(denied('robot_gripper_a01', qf.denylist)).toBe('gripper');
    expect(denied('handtool_screwdriver_torx', qf.denylist)).toBeNull();
    expect(denied('arm_robot_arm_x', qf.denylist)).not.toBeNull();
  });
  it('labels from the package name before the query that found it', () => {
    const found = qf.queries.find((q) => q.q === 'sofa')!;
    expect(classify('cart_mobile_a01', qf, found).type).toBe('cart');
    expect(classify('D00160', qf, found).type).toBe(found.type);
    expect(opaque('D00160')).toBe(true);
    expect(opaque('storage_toolbox_standard_d01')).toBe(false);
  });
  it('has a budget that grows with size and a well-formed query file', () => {
    expect(budgetFor(0.1)).toBeLessThan(budgetFor(2));
    expect(qf.queries.length).toBeGreaterThanOrEqual(200);
    expect(new Set(qf.queries.map((q) => q.q)).size).toBe(qf.queries.length);
  });
});

describe('reprocessing after a front fix', () => {
  const base = { symmetric: false, status: 'published' as const, front: { rot: null, sure: true, why: 'x' } };
  it('picks backed pieces, unsure fronts and checked overrides built before the fix, and nothing else', () => {
    expect(needsFrontFix({ ...base, id: 'simready-warehouse-chair', type: 'chair' }, {})).toBe(true);
    expect(needsFrontFix({ ...base, id: 'simready-x', type: 'cart', front: { rot: null, sure: false, why: 'near square' } }, {})).toBe(true);
    expect(needsFrontFix({ ...base, id: 'simready-vehicle-forklift-red-c01', type: 'vehicle' }, {})).toBe(true);
    expect(needsFrontFix({ ...base, id: 'simready-mug', type: 'mug' }, {})).toBe(false);
    expect(needsFrontFix({ ...base, id: 'simready-chair', type: 'chair', symmetric: true }, {})).toBe(false);
    expect(needsFrontFix({ ...base, id: 'simready-chair', type: 'chair', status: 'rejected' }, {})).toBe(false);
    expect(needsFrontFix({ ...base, id: 'simready-chair', type: 'chair', fixRev: FRONT_FIX_REV }, {})).toBe(false);
  });
});
