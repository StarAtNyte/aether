import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createWorld } from '@aether/core';
import { deriveBuild, memoryCaller, parseRoomDescription, runBuild } from '../src/photo/index';
import { partKinds } from '../src/index';

const raw = (): Record<string, unknown> => JSON.parse(readFileSync(resolve(__dirname, '../../../tests/fixtures/photo/hotel.description.json'), 'utf8')) as Record<string, unknown>;

/** A narrow room whose reading put a door between two windows closer than the wall allows (as one Codex reading of the twin room did). */
function crowded() {
  const r = raw() as { footprint: Record<string, unknown>; openings: Array<Record<string, unknown>> };
  r.footprint['width'] = 2.85;
  r.openings = [
    { id: 'window-1', kind: 'window', wall: 'north', along: 0.77, width: 1.0, height: 1.4, sill: 0.8 },
    { id: 'door-1', kind: 'door', wall: 'north', along: 1.63, width: 0.9, height: 2.05 },
    { id: 'window-2', kind: 'window', wall: 'north', along: 2.34, width: 1.0, height: 1.4, sill: 0.8 },
  ];
  const p = parseRoomDescription(r, partKinds());
  if (!p.ok) throw new Error(p.error);
  return p.value;
}

describe('openings that crowd one wall', () => {
  it('are separated deterministically, with notes, and the builder accepts the shell', async () => {
    const d = crowded();
    const build = deriveBuild(d);
    const ops = build.plan.levels[0]?.openings ?? [];
    const north = ops.filter((o) => o.wall === 'north');
    expect(north.length).toBeGreaterThanOrEqual(2);
    expect(build.notes.join('\n')).toMatch(/crowded|left out/);
    const sorted = [...north].sort((a, b) => a.along - b.along);
    for (let k = 1; k < sorted.length; k++) {
      const a = sorted[k - 1] as (typeof sorted)[number];
      const b = sorted[k] as (typeof sorted)[number];
      expect(b.along - b.width / 2 - (a.along + a.width / 2)).toBeGreaterThanOrEqual(0.1);
    }
    const mem = memoryCaller(createWorld({}));
    const built = await runBuild(mem.world(), build, mem.call);
    expect(built.shellOk).toBe(true);
  });

  it('leaves a wall with room to spare alone', () => {
    const build = deriveBuild(crowded());
    const clean = deriveBuild((() => { const p = parseRoomDescription(raw(), partKinds()); if (!p.ok) throw new Error(p.error); return p.value; })());
    expect(clean.notes.join('\n')).not.toMatch(/crowded another opening/);
    expect(build.openingIds.includes('door-1')).toBe(true);
  });
});
