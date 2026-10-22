/**
 * Record a room-size decision in a photo fixture: the description (and the placements that follow it) of
 * tests/fixtures/photo/<id>.transcript.json at another floor size, with the same proportions rules as the `rescaleDescription` tool.
 *
 *   npx tsx scripts/showcase/resize-fixture.ts twin 4 5.2
 *
 * Floor positions (`at`) stay against their wall, positions along a wall (`t`, `along`) stay centred on it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { anchored, centred, rescaleDescription } from '../../packages/arch/src/photo/scale';

const [id, w, d] = process.argv.slice(2);
if (!id || !w || !d) throw new Error('usage: resize-fixture <id> <width> <depth>');
const file = join(import.meta.dirname, '..', '..', 'tests/fixtures/photo', `${id}.transcript.json`);
const t = JSON.parse(readFileSync(file, 'utf8')) as { responses: Array<{ content: Array<{ type: string; name?: string; input?: Record<string, unknown> }> }> };
let from: { width: number; depth: number } | null = null;
const W = Number(w);
const D = Number(d);

type Place = Record<string, unknown> & { wall?: string; t?: number; at?: number[]; offset?: number[] };
const move = (p: Place, W0: number, D0: number): void => {
  if (typeof p['t'] === 'number') p['t'] = p.wall === 'north' || p.wall === 'south' ? centred(p['t'], W0, W) : centred(p['t'], D0, D);
  if (Array.isArray(p.at) && p.at.length === 2) p.at = [anchored(p.at[0] as number, W0, W), anchored(p.at[1] as number, D0, D)];
};

for (const r of t.responses) {
  for (const c of r.content) {
    if (c.type !== 'tool_use' || !c.input) continue;
    if (c.name === 'describe_room' && c.input['description']) {
      const desc = c.input['description'] as { footprint: { width: number; depth: number } };
      from ??= { width: desc.footprint.width, depth: desc.footprint.depth };
      c.input['description'] = rescaleDescription(desc as never, W, D);
    } else if ((c.name === 'place_items' || c.name === 'edit_items') && from) {
      for (const p of ((c.input['items'] ?? c.input['edits']) as Place[] | undefined) ?? []) move(p, from.width, from.depth);
    }
  }
}
writeFileSync(file, `${JSON.stringify(t)}\n`);
console.log(`${id}: footprint ${from?.width} x ${from?.depth} -> ${W} x ${D}`);
