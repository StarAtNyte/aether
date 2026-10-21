/**
 * The walkthrough bot agrees with the building check about stair landings. The house a model built had its
 * stair's top step come out 0.78 m short of the south wall with the stairwell balustrade beside it: 0.69 m to get
 * through, narrower than the body, so the bot never got off the landing. Built exactly as drawn it still fails; built
 * through create_building, whose stair fitter moves the stair along the hall wall to a full landing, it walks to
 * every room, and the building check said so before the bot ran.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyArchOps, checkBuilding } from '@aether/arch';
import { createWorld } from '@aether/core';
import { ensureAssetCatalog } from '@aether/physics';
import { describe, expect, it } from 'vitest';
import { walkthrough } from '../src';

const plan = (): unknown => JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/house-stair-landing.plan.json', import.meta.url)), 'utf8')) as unknown;

describe('stair landings, walked', () => {
  it('a top landing narrower than the body: the check and the bot both find the upper floor unreachable', async () => {
    const built = applyArchOps(createWorld(), [{ op: 'create_building', plan: plan(), exactStairs: true }]);
    expect(built.errors).toEqual([]);
    await ensureAssetCatalog(built.target);
    const report = checkBuilding(built.target, 'house');
    expect(report.reachable).toBe(3);
    expect(report.issues.some((i) => i.entities.includes('house-l0-stair0') && /cannot get off/.test(i.message))).toBe(true);
    const r = await walkthrough(built.target, { trace: false });
    expect(r.status).toBe('failed');
    expect(r.objectives.filter((o) => o.status === 'done').length).toBeLessThan(r.objectives.length);
  }, 120_000);

  it('the same plan through create_building: the stair is moved to a full landing and the bot walks every room', async () => {
    const built = applyArchOps(createWorld(), [{ op: 'create_building', plan: plan() }]);
    expect(built.errors).toEqual([]);
    await ensureAssetCatalog(built.target);
    expect(built.lines.some((l) => l.startsWith('stair moved: level 0 stair 1'))).toBe(true);
    expect(checkBuilding(built.target, 'house').passed).toBe(true);
    const r = await walkthrough(built.target, { trace: false });
    expect(r.status, r.summary).toBe('passed');
    expect(r.objectives.every((o) => o.status === 'done')).toBe(true);
    expect(r.wallMs).toBeLessThan(20_000);
  }, 120_000);
});
