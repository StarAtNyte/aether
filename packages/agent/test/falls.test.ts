import { applyPatches, createWorld, type WorldDoc } from '@aether/core';
import { scoreFindings } from '@aether/arch';
import { describe, expect, it } from 'vitest';
import { fallsFindings, findBuriedFalls, sheetLip, withFalls } from '../src/falls';
import type { ReviewSnapshot } from '../src/review';

const CLIFF = { kind: 'procedural', generator: 'cliff-face', params: { width: 60, height: 40, depth: 16, variant: 1 }, seed: 3 };

function world(entities: Array<Record<string, unknown>>): WorldDoc {
  const out = applyPatches(createWorld(), entities.map((entity) => ({ op: 'add', entity })) as never);
  expect(out.errors).toEqual([]);
  return out.world;
}

const FALL_PARAMS = { height: 30, width: 8, variant: 1 };
/** Where the sheet's lip is in its own frame (the generator centres its footprint, so not at the origin). */
const LIP_Z = sheetLip('waterfall-sheet', FALL_PARAMS, 1)?.z ?? 0;

/** A waterfall whose lip stands at world z = `z` (turned: `extra.transform` places the entity itself). */
const fall = (id: string, z: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  shape: { kind: 'procedural', generator: 'waterfall-sheet', params: FALL_PARAMS, seed: 1 },
  transform: { position: [0, 0, z - LIP_Z] },
  ...extra,
});

describe('buried falls', () => {
  it('finds a waterfall set behind the face of its cliff and says how far to bring it out', () => {
    // The cliff faces +z with its face at z = -10; the sheet's lip 6 m behind the face is inside the rock.
    const w = world([{ id: 'cliff', shape: CLIFF, transform: { position: [0, 0, -10] } }, fall('falls', -16)]);
    const found = findBuriedFalls(w);
    expect(found.map((f) => f.id)).toEqual(['falls']);
    expect(found[0]?.inside).toContain('cliff');
    expect(found[0]?.hidden).toBeGreaterThan(10);
    expect(found[0]?.move).toBeGreaterThan(5);
    expect(found[0]?.dir[1]).toBeCloseTo(1);
    const f = fallsFindings(w)[0];
    expect(f?.code).toBe('fall_buried');
    expect(f?.severity).toBe('warning');
    expect(f?.fix).toMatch(/out from the face/);
  });

  it('leaves a waterfall that stands clear in front of the face alone', () => {
    const w = world([{ id: 'cliff', shape: CLIFF, transform: { position: [0, 0, -10] } }, fall('falls', 4)]);
    expect(findBuriedFalls(w)).toEqual([]);
  });

  it('follows the yaw of a turned waterfall', () => {
    // Turned 90 degrees the sheet pours toward +x; a box mass east of the lip does not bury it, one around the lip does.
    const turned = fall('falls', 0, { transform: { position: [-LIP_Z, 0, 0], rotation: [0, 90, 0] } });
    const clear = world([turned, { id: 'block', shape: { kind: 'primitive', primitive: 'box', size: [10, 60, 30] }, transform: { position: [-6, 30, 0] } }]);
    expect(findBuriedFalls(clear)).toEqual([]);
    const buried = world([turned, { id: 'block', shape: { kind: 'primitive', primitive: 'box', size: [10, 60, 30] }, transform: { position: [2, 30, 0] } }]);
    const found = findBuriedFalls(buried);
    expect(found[0]?.inside).toEqual(['block']);
    expect(found[0]?.dir[0]).toBeCloseTo(1);
  });

  it('checks any falling-water part, by tag or water kind', () => {
    const sheet = { id: 'sheet', tags: ['waterfall'], shape: { kind: 'primitive', primitive: 'box', size: [6, 20, 0.2] }, transform: { position: [0, 10, -12] }, material: { preset: 'water', waterKind: 'fall' } };
    const w = world([{ id: 'cliff', shape: CLIFF, transform: { position: [0, 0, -10] } }, sheet]);
    expect(findBuriedFalls(w).map((f) => f.id)).toEqual(['sheet']);
  });

  it('adds the findings to a review snapshot and replaces the last round of them', () => {
    const w = world([{ id: 'cliff', shape: CLIFF, transform: { position: [0, 0, -10] } }, fall('falls', -16)]);
    const stale = { code: 'fall_buried', severity: 'warning', message: 'old', entities: ['falls'], fix: 'old' } as never;
    const snap = { buildings: ['world'], findings: [stale], score: scoreFindings([stale]), keys: new Set<string>(), views: [], legend: '', advice: '' } as unknown as ReviewSnapshot;
    const out = withFalls(snap, w);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]?.message).not.toBe('old');
    expect(out.keys.size).toBe(1);
    expect(withFalls(snap, createWorld())).toBe(snap);
  });

  it('has nothing to check without falling water', () => {
    expect(findBuriedFalls(world([{ id: 'cliff', shape: CLIFF, transform: { position: [0, 0, -10] } }]))).toEqual([]);
  });

  it('reads the lip of a generated sheet off its falling water (the generator centres its footprint on the pool)', () => {
    const params = { height: 45, width: 15, strands: 3, throwSpeed: 2.2, variant: 1, pool: true };
    const lip = sheetLip('waterfall-sheet', params, 0);
    expect(lip).not.toBeNull();
    // Well behind the origin: the plunge pool reaches far out in front.
    expect(lip!.z).toBeLessThan(-5);
    // A sheet whose origin stands 4 m in front of a cliff face still has its lip inside the rock.
    const world = createWorld({
      entities: {
        rock: { id: 'rock', transform: { position: [0, 22.5, -20] }, shape: { kind: 'primitive', primitive: 'box', size: [40, 45, 40] } },
        fall: { id: 'fall', tags: ['waterfall'], transform: { position: [0, 0, 4] }, shape: { kind: 'procedural', generator: 'waterfall-sheet', params } },
      },
    }) as WorldDoc;
    const buried = findBuriedFalls(world);
    expect(buried.map((b) => b.id)).toContain('fall');
  });
});
