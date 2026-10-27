import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createWorld } from '@aether/core';
import { deriveBuild, memoryCaller, parseRoomDescription, runBuild } from '@aether/arch/photo';
import { partKinds, runDesignTool } from '@aether/arch';
import { gateEdits, posesOf, type Anchor } from '../src/photo/placement-gate';

const parsed = parseRoomDescription(JSON.parse(readFileSync(resolve(__dirname, '../../../tests/fixtures/photo/hotel.description.json'), 'utf8')) as unknown, partKinds());
if (!parsed.ok) throw new Error(parsed.error);
const d = { ...parsed.value, items: [] };

async function world() {
  const mem = memoryCaller(createWorld({}));
  await runBuild(mem.world(), deriveBuild(d), mem.call);
  const w0 = mem.world();
  return runDesignTool(w0, 'place_items', { items: [{ kind: 'nightstand', room: 'room', id: 'ns-a', at: [1.5, 2.0] }] });
}

describe('measured placement gate', () => {
  it('holds an unexplained move far from the anchor, lets an explained one and a move back through', async () => {
    const placed = await world();
    expect(placed.accepted).toBeGreaterThan(0);
    const w = placed.world;
    const id = placed.ids.find((i) => posesOf(w).has(i)) as string;
    const p = posesOf(w).get(id)!;
    const anchors = new Map<string, Anchor>([[id, { itemId: 'inv', label: 'lamp', pos: p.pos, size: p.size, yaw: p.yaw }]]);
    const far = { op: 'move', ref: id, at: [p.pos[0] + 0.6, p.pos[2]] };
    const held = gateEdits(w, { edits: [far] }, anchors);
    expect(held.held).toBe(1);
    expect(held.input).toBeNull();
    expect(held.refusal).toMatch(/reason/);
    const near = gateEdits(w, { edits: [{ op: 'move', ref: id, at: [p.pos[0] + 0.05, p.pos[2]] }] }, anchors);
    expect(near.held).toBe(0);
    const why = gateEdits(w, { edits: [{ ...far, reason: 'perception mask occluded by the bed so the measured footprint is unreliable' }] }, anchors);
    expect(why.held).toBe(0);
    expect(why.reasons[0]?.entity).toBe(id);
    expect(JSON.stringify(why.input)).not.toContain('reason');
    // a piece with no anchor is not gated
    expect(gateEdits(w, { edits: [far] }, new Map()).held).toBe(0);
  });
});
