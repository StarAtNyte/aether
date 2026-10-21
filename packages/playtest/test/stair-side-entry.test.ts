/**
 * The walkthrough bot agrees with the plan checks about a stair tucked against the wall at its foot. The house a
 * model built had its L stair in the hall's south-east corner, first riser 2 cm from the south wall: only the side of
 * the first treads was left to step onto, and a body pressed against the wall stands beside treads taller than it
 * climbs. Built exactly as drawn the bot cannot get upstairs (and the building check says so); through
 * create_building the stair is moved to one that works and the bot walks every room.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyArchOps, checkBuilding } from '@aether/arch';
import { createWorld } from '@aether/core';
import { ensureAssetCatalog } from '@aether/physics';
import { describe, expect, it } from 'vitest';
import { walkthrough } from '../src';

const plan = (): unknown => JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/house-stair-foot-wall.plan.json', import.meta.url)), 'utf8')) as unknown;

describe('a stair against the wall at its foot, walked', () => {
  it('as drawn: the building check and the bot both find the upper floor unreachable', async () => {
    const built = applyArchOps(createWorld(), [{ op: 'create_building', plan: plan(), exactStairs: true }]);
    expect(built.errors).toEqual([]);
    await ensureAssetCatalog(built.target);
    const report = checkBuilding(built.target, 'house');
    expect(report.reachable).toBeLessThan(report.rooms);
    const r = await walkthrough(built.target, { trace: false });
    expect(r.status).toBe('failed');
  }, 180_000);

  it('through create_building: the stair is moved and the bot walks every room', async () => {
    const built = applyArchOps(createWorld(), [{ op: 'create_building', plan: plan() }]);
    expect(built.errors).toEqual([]);
    await ensureAssetCatalog(built.target);
    expect(built.lines.some((l) => l.startsWith('stair moved: level 0 stair'))).toBe(true);
    expect(checkBuilding(built.target, 'house').passed).toBe(true);
    const r = await walkthrough(built.target, { trace: false });
    expect(r.status, r.summary).toBe('passed');
    expect(r.objectives.every((o) => o.status === 'done')).toBe(true);
  }, 180_000);
});
