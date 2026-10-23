import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld } from '@aether/core';
import { partKinds, runDesignTool } from '@aether/arch';
import { deriveBuild, footprintAdvisory, footprintMinimum, parseRoomDescription, runBuild } from '@aether/arch/photo';
import { DifferenceLedger } from '../src/photo/differences';

function twin(width: number) {
  const t = JSON.parse(readFileSync('tests/fixtures/photo/twin.transcript.json', 'utf8')) as { responses: Array<{ content: Array<{ name?: string; input?: { description: { footprint: { width: number } } } }> }> };
  const block = t.responses.flatMap((r) => r.content).find((c) => c.name === 'describe_room');
  const raw = structuredClone(block?.input?.description) as { footprint: { width: number } };
  raw.footprint.width = width;
  const desc = parseRoomDescription(raw, partKinds());
  if (!desc.ok) throw new Error('fixture description does not parse');
  return desc.value;
}

describe('space evidence for a narrow shell', () => {
  it('the shell advisory names the measured minimum next to the written width', () => {
    const d = twin(2.6);
    const m = footprintMinimum(d);
    expect(m.width).toBeGreaterThan(2.6);
    const text = footprintAdvisory(d);
    expect(text).toContain('you wrote 2.6 m');
    expect(text).toContain(`at least ${m.width} m`);
    expect(text).toContain('advisory');
    expect(text).toContain('design_plan');
    expect(footprintAdvisory(twin(9))).toBe('');
  });

  it('a placement refused for space carries the shell size, the width needed and the design_plan call to widen', async () => {
    const build = deriveBuild(twin(2.6));
    let w = createWorld({ name: 'twin' });
    const caller = async (name: 'design_plan' | 'place_items', input: Record<string, unknown>) => {
      const r = runDesignTool(w, name, input);
      w = applyPatches(w, r.patches).world;
      return { world: w, text: r.text, ok: r.ok };
    };
    const run = await runBuild(w, build, caller);
    const withEvidence = run.outcomes.filter((o) => !o.ok && o.text.includes('Space evidence'));
    expect(withEvidence.length).toBeGreaterThan(0);
    const t = withEvidence[0]!.text;
    expect(t).toMatch(/clear floor \d+\.\d+ x \d+\.\d+ m/);
    expect(t).toMatch(/free floor \d+\.\d+ m2/);
    expect(t).toMatch(/design_plan with room "[^"]+" rect \[/);
    expect(t).toContain('you choose');
  });

  it('a space refusal left from the first build is an open geometry difference until reported fixed', () => {
    const l = new DifferenceLedger();
    l.seed('desk', 'the desk was refused for lack of space');
    expect(l.unresolvedText()).toContain('missing-desk');
    expect(l.ranked()[0]).toMatchObject({ cause: 'geometry', size: 3, status: 'open' });
    const r = l.record({ differences: [{ id: 'missing-desk', what: 'desk placed', status: 'fixed' }] }, 'model');
    expect(r.ok && r.open).toBe(0);
  });
});
