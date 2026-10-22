import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld } from '@aether/core';
import { partKinds, runDesignTool } from '@aether/arch';
import { deriveBuild, parseRoomDescription, runBuild } from '@aether/arch/photo';

/** The twin-room description (a narrow room, two beds, a glass wall at the end): what the first build must manage. */
describe('first build of the twin room from its recorded description', () => {
  it('hangs the curtains at the glazed door, keeps the desk chair a few centimetres off the bed and puts no downlights in', async () => {
    const t = JSON.parse(readFileSync('tests/fixtures/photo/twin.transcript.json', 'utf8')) as { responses: Array<{ content: Array<{ type: string; name?: string; input?: { description: unknown } }> }> };
    const block = t.responses.flatMap((r) => r.content).find((c) => c.name === 'describe_room');
    const desc = parseRoomDescription(block?.input?.description, partKinds());
    if (!desc.ok) throw new Error('fixture description does not parse');
    const build = deriveBuild(desc.value);
    let w = createWorld({ name: 'twin' });
    const caller = async (name: 'design_plan' | 'place_items', input: Record<string, unknown>) => {
      const r = runDesignTool(w, name, input);
      w = applyPatches(w, r.patches).world;
      return { world: w, text: r.text, ok: r.ok };
    };
    const run = await runBuild(w, build, caller);
    const bad = run.outcomes.filter((o) => !o.ok).map((o) => `${o.id}: ${o.text.slice(0, 160)}`);
    expect(bad.filter((b) => /^(curtain|chair)/.test(b))).toEqual([]);
    for (const e of Object.values(w.entities)) if (e.arch?.role === 'ceiling') expect((e.shape as unknown as { params: { downlights: unknown[] } }).params.downlights).toHaveLength(0);
  });
});
