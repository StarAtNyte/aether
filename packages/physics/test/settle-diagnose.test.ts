import { describe, expect, it } from 'vitest';
import type { EntityInput } from '@aether/core';
import { applyPatches } from '@aether/core';
import { diagnose, settle } from '../src/index';
import { ball, box, world } from './helpers';

const table = box('table', [0, 0.95, 0], [2, 0.1, 1], { body: 'static' });

describe('settle', () => {
  it('drops a floating crate onto a table and patches its rest pose', async () => {
    const doc = world([table, box('crate', [0.2, 3, 0], [0.5, 0.5, 0.5]), box('shelf', [5, 0.5, 0], [1, 1, 1], { body: 'static' })]);
    const report = await settle(doc);
    expect(report.fellOut).toEqual([]);
    expect(report.unstable).toEqual([]);
    expect(report.moved.map((m) => m.id)).toEqual(['crate']);
    expect(report.patches).toHaveLength(1);
    const patch = report.patches[0];
    expect(patch?.op).toBe('update');
    if (patch?.op !== 'update') return;
    const t = patch.set.transform as { position: number[]; rotation: number[] };
    expect(t.position[1]).toBeCloseTo(1.25, 2);
    expect(t.position[0]).toBeCloseTo(0.2, 1);
    // Rounded to mm / 0.1°.
    for (const v of t.position) expect(Math.round(v * 1000) / 1000).toBe(v);
    for (const v of t.rotation) expect(Math.round(v * 10) / 10).toBe(v);
    expect(report.seconds).toBeLessThanOrEqual(2);
    // Applying the patch gives a world that no longer moves.
    const settled = applyPatches(doc, report.patches).world;
    const again = await settle(settled);
    expect(again.patches).toEqual([]);
  });

  it('reports fallen bodies, respects `only` and converts to parent space', async () => {
    const doc = world([
      box('hole', [0, 5, 0], [1, 1, 1]),
      { id: 'base', shape: { kind: 'primitive', primitive: 'box', size: [4, 1, 4] }, transform: { position: [20, 0.5, 0], rotation: [0, 90, 0] }, physics: { body: 'static' } },
      { id: 'kid', parent: 'base', shape: { kind: 'primitive', primitive: 'box', size: [0.4, 0.4, 0.4] }, transform: { position: [1, 2, 0] }, physics: { body: 'dynamic' } },
      box('ignored', [-20, 4, 0], [1, 1, 1]),
    ], { environment: { ground: { material: { preset: 'grass' }, size: 30 } } });
    const report = await settle(doc, { seconds: 6, only: ['hole', 'kid'] });
    expect(report.fellOut).toEqual([]); // the ground covers x=0
    const kid = report.patches.find((p) => p.op === 'update' && p.id === 'kid');
    expect(kid).toBeDefined();
    if (kid?.op === 'update') {
      const t = kid.set.transform as { position: number[] };
      expect(t.position[0]).toBeCloseTo(1, 1); // still local to the rotated parent
      expect(t.position[1]).toBeCloseTo(0.7, 2);
    }
    expect(report.patches.some((p) => p.op === 'update' && p.id === 'ignored')).toBe(false);

    const noGround = world([box('lost', [0, 1, 0], [1, 1, 1])], { environment: { ground: null } });
    const fell = await settle(noGround, { seconds: 3 });
    expect(fell.fellOut).toEqual(['lost']);
    expect(fell.patches).toEqual([]);
  });

  it('flags bodies still moving at the end as unstable', async () => {
    const doc = world([ball('roller', [0, 0.5, 0], 0.5, { body: 'dynamic', initialVelocity: [8, 0, 0], friction: 0 })]);
    const report = await settle(doc, { seconds: 0.5 });
    expect(report.unstable).toEqual(['roller']);
  });
});

describe('diagnose', () => {
  it('finds overlaps with actionable suggestions', async () => {
    const diags = await diagnose(world([
      table,
      box('crate-3', [0, 1.13, 0], [0.5, 0.5, 0.5]),
      box('sunk', [5, 0.2, 0], [1, 1, 1]),
      box('a', [10, 0.5, 0], [1, 1, 1]),
      box('b', [10.6, 0.5, 0], [1, 1, 1]),
      { id: 'zone', shape: { kind: 'primitive', primitive: 'box', size: [3, 3, 3] }, transform: { position: [10, 1, 0] }, physics: { body: 'static', sensor: true } },
    ]));
    const overlap = diags.filter((d) => d.code === 'overlap');
    const crate = overlap.find((d) => d.entities.includes('crate-3'));
    expect(crate?.message).toBe('crate-3 overlaps table by 0.12m');
    expect(crate?.suggestion).toBe('move crate-3 up to y=1.25');
    expect(crate?.severity).toBe('error');
    const sunk = overlap.find((d) => d.entities[0] === 'sunk');
    expect(sunk?.message).toMatch(/sunk 0\.3m into the ground/);
    expect(sunk?.suggestion).toBe('move sunk up to y=0.5');
    const ab = overlap.find((d) => d.entities.includes('a') && d.entities.includes('b'));
    expect(ab?.message).toMatch(/overlaps .* by 0\.4m/);
    expect(ab?.suggestion).toMatch(/along \[-?1, 0, -?0\]/);
    expect(overlap.some((d) => d.entities.includes('zone'))).toBe(false);
  });

  it('ignores touching, parent/child and jointed pairs', async () => {
    const diags = await diagnose(world([
      box('floor-box', [0, 0.5, 0], [1, 1, 1]),
      box('stacked', [0, 1.5, 0], [1, 1, 1]),
      box('parent', [5, 1, 0], [1, 1, 1]),
      { id: 'child', parent: 'parent', shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] }, transform: { position: [0.3, 0, 0] }, physics: { body: 'dynamic' } },
      box('hinge-a', [10, 1, 0], [1, 1, 1], { body: 'static' }),
      box('hinge-b', [10.5, 1, 0], [1, 1, 1], { body: 'dynamic' }, { joint: { type: 'revolute', target: 'hinge-a' } }),
    ]));
    expect(diags.filter((d) => d.code === 'overlap')).toEqual([]);
  });

  it('finds floating, out-of-bounds and too many bodies', async () => {
    const diags = await diagnose(world([
      table,
      box('crate', [0, 2, 0], [0.5, 0.5, 0.5]),
      box('balloon', [3, 4, 0], [0.5, 0.5, 0.5], { body: 'dynamic', gravityScale: 0 }),
      box('thrown', [6, 4, 0], [0.5, 0.5, 0.5], { body: 'dynamic', initialVelocity: [1, 0, 0] }),
      box('far', [300, 0.5, 0], [1, 1, 1], { body: 'static' }),
      box('deep', [0, -10, 40], [1, 1, 1], { body: 'static' }),
    ]));
    const floating = diags.filter((d) => d.code === 'floating');
    expect(floating).toHaveLength(1);
    expect(floating[0]?.message).toBe('crate floats 0.75m above table and will drop when simulation starts');
    expect(floating[0]?.suggestion).toMatch(/^lower crate to y=1\.25/);
    const oob = diags.filter((d) => d.code === 'outOfBounds').map((d) => d.entities[0]).sort();
    expect(oob).toEqual(['deep', 'far']);

    const many: EntityInput[] = [];
    for (let i = 0; i < 3001; i++) many.push(box(`b-${i}`, [(i % 60) * 2, 0.5, Math.floor(i / 60) * 2 - 60], [0.5, 0.5, 0.5], { body: 'static' }));
    const big = await diagnose(world(many));
    expect(big.some((d) => d.code === 'tooManyBodies')).toBe(true);
  });

  it('warns about bodies with nothing below them in groundless worlds', async () => {
    const diags = await diagnose(world([box('rock', [0, 5, 0], [1, 1, 1])], { environment: { ground: null } }));
    expect(diags).toHaveLength(1);
    expect(diags[0]?.message).toMatch(/nothing below it/);
  });
});

describe('diagnose: people without a character', () => {
  it('warns about a capsule that stands for a person and not about one with a character', async () => {
    const bare: EntityInput = { id: 'villager-1', shape: { kind: 'primitive', primitive: 'capsule', size: [0.5, 1.75, 0.5] }, transform: { position: [3, 0.875, 0] }, physics: { body: 'static' } };
    const dressed: EntityInput = { ...bare, id: 'villager-2', transform: { position: [-3, 0.875, 0] }, character: { wardrobe: 'villager', scale: 1 } };
    const out = await diagnose(world([bare, dressed]));
    const d = out.filter((x) => x.code === 'noCharacter');
    expect(d.map((x) => x.entities[0])).toEqual(['villager-1']);
    expect(d[0]?.severity).toBe('warning');
  });
});
