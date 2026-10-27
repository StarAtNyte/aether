/**
 * Tool wording and the empty-world guard: reports claim only what the evidence supports and name what was not checked,
 * a placement refusal is described as a constraint to solve, and an edit that would leave nothing in the world is refused
 * with a clear message (unless the user asked to start over).
 */
import { applyPatches, createWorld, type WorldDoc } from '@aether/core';
import { emptiesWorld, emptyWorldRefusal } from '@aether/arch';
import { describe, expect, it } from 'vitest';
import { WorldAgent } from '../src/agent';
import { NARROW_CLAIM, NO_EMPTYING, REFUSAL_IS_A_CONSTRAINT } from '../src/claims';
import { levelTurnText } from '../src/level-review';
import { reviewTurnText, stallAskText, type ReviewSnapshot } from '../src/review';
import { AGENT_TOOLS } from '../src/tools';
import type { CompletionRequest, CompletionResponse, ContentBlock, Provider } from '../src/types';
import { collect, MemoryHost, TEST_CATALOGS } from './helpers';

function scripted(replies: Array<() => ContentBlock[]>): Provider & { requests: CompletionRequest[] } {
  const requests: CompletionRequest[] = [];
  let i = 0;
  return {
    name: 'scripted',
    requests,
    async complete(req): Promise<CompletionResponse> {
      requests.push(JSON.parse(JSON.stringify(req)) as CompletionRequest);
      const r = replies[Math.min(i++, replies.length - 1)];
      const content = r ? r() : [{ type: 'text', text: 'done' } as ContentBlock];
      return { content, stopReason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end' };
    },
  };
}

let n = 0;
const call = (name: string, input: unknown): ContentBlock => ({ type: 'tool_use', id: `g${++n}`, name, input });

const box = (id: string): unknown => ({ op: 'add', entity: { id, name: id, shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] }, transform: { position: [0, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } } });

function twoBoxes(): WorldDoc {
  return applyPatches(createWorld(), [box('a'), box('b')]).world;
}

const ids = (w: WorldDoc): string[] => Object.keys(w.entities).sort();

describe('empty-world guard', () => {
  it('emptiesWorld is true only when a world with entities ends with none', () => {
    const w = twoBoxes();
    expect(emptiesWorld(w, applyPatches(w, [{ op: 'remove', id: 'a' }]).world)).toBe(false);
    expect(emptiesWorld(w, applyPatches(w, [{ op: 'remove', id: 'a' }, { op: 'remove', id: 'b' }]).world)).toBe(true);
    expect(emptiesWorld(createWorld(), createWorld())).toBe(false);
  });

  it('the refusal says what was refused, that nothing changed, and the ways forward', () => {
    const t = emptyWorldRefusal(2, 'apply_patches');
    expect(t).toMatch(/empty world/);
    expect(t).toMatch(/Nothing was changed/);
    expect(t).toMatch(/startOver:true/);
    expect(emptyWorldRefusal(1, 'edit_items')).toMatch(/remove all 1 entity/);
  });

  it('apply_patches that removes every entity is refused, the world is untouched and the model is told why', async () => {
    const provider = scripted([
      () => [call('apply_patches', { patches: [{ op: 'remove', id: 'a' }, { op: 'remove', id: 'b' }], message: 'clear up' })],
      () => [call('finish', { message: 'Left the world as it was.' })],
    ]);
    const host = new MemoryHost(twoBoxes());
    await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS, maxTurns: 4, fineEdit: false, localEdits: false }).run('tidy the scene', host));
    expect(ids(host.world)).toEqual(['a', 'b']);
    expect(host.commits.filter((c) => c.result.applied.length > 0)).toHaveLength(0);
    const second = JSON.stringify(provider.requests[1]?.messages);
    expect(second).toMatch(/empty world/);
    expect(second).toMatch(/Nothing was changed/);
  });

  it('a clear that leaves nothing is refused too; a batch that rebuilds after clearing is not', async () => {
    const wipe = scripted([() => [call('apply_patches', { patches: [{ op: 'clear' }], message: 'wipe' })], () => [call('finish', { message: 'ok' })]]);
    const host = new MemoryHost(twoBoxes());
    await collect(new WorldAgent({ provider: wipe, catalogs: TEST_CATALOGS, maxTurns: 4, fineEdit: false, localEdits: false }).run('tidy the scene', host));
    expect(ids(host.world)).toEqual(['a', 'b']);
    const rebuild = scripted([() => [call('apply_patches', { patches: [{ op: 'clear' }, box('c')], message: 'replace' })], () => [call('finish', { message: 'ok' })]]);
    const host2 = new MemoryHost(twoBoxes());
    await collect(new WorldAgent({ provider: rebuild, catalogs: TEST_CATALOGS, maxTurns: 4, fineEdit: false, localEdits: false }).run('replace the boxes with one', host2));
    expect(ids(host2.world)).toEqual(['c']);
  });

  it('startOver:true lets the user have an empty world; removing some of the entities is always fine', async () => {
    const some = scripted([() => [call('apply_patches', { patches: [{ op: 'remove', id: 'a' }], message: 'drop a' })], () => [call('finish', { message: 'ok' })]]);
    const host = new MemoryHost(twoBoxes());
    await collect(new WorldAgent({ provider: some, catalogs: TEST_CATALOGS, maxTurns: 4, fineEdit: false, localEdits: false }).run('remove box a', host));
    expect(ids(host.world)).toEqual(['b']);
    const over = scripted([() => [call('apply_patches', { patches: [{ op: 'remove', id: 'a' }, { op: 'remove', id: 'b' }], message: 'start over', startOver: true })], () => [call('finish', { message: 'Cleared.' })]]);
    const host2 = new MemoryHost(twoBoxes());
    await collect(new WorldAgent({ provider: over, catalogs: TEST_CATALOGS, maxTurns: 4, fineEdit: false, localEdits: false }).run('start over with nothing', host2));
    expect(ids(host2.world)).toEqual([]);
  });
});

describe('tool and review wording', () => {
  const tool = (name: string): string => AGENT_TOOLS.find((t) => t.name === name)?.description ?? '';

  it('finish asks for the narrowest supported claim and a Not checked list', () => {
    expect(tool('finish')).toMatch(/Claim only what you measured or saw/);
    expect(tool('finish')).toMatch(/Not checked/);
  });

  it('place_items and edit_items describe a refusal as a constraint to solve, not a tool failure', () => {
    expect(tool('place_items')).toMatch(/constraint of the room \(.*\), not a failure of the tool/);
    expect(tool('edit_items')).toMatch(/constraint to solve, not a tool failure/);
    expect(tool('edit_items')).toMatch(/no entities is refused/);
  });

  it('apply_patches names the empty-world refusal and the startOver flag', () => {
    expect(tool('apply_patches')).toMatch(/no entities at all is refused/);
    const schema = AGENT_TOOLS.find((t) => t.name === 'apply_patches')?.inputSchema as { properties: Record<string, unknown> };
    expect(Object.keys(schema.properties)).toContain('startOver');
  });

  it('the review turns end on the narrow-claim and refusal rules; the stall ask wants the same', () => {
    const snap: ReviewSnapshot = { buildings: [], findings: [], score: 0, keys: new Set(), views: [], legend: '', advice: '' };
    const text = reviewTurnText(1, snap, { hasImages: false, lastEdited: false });
    expect(text).toContain(NARROW_CLAIM);
    expect(text).toContain(REFUSAL_IS_A_CONSTRAINT);
    expect(NARROW_CLAIM).toMatch(/narrowest claim the evidence supports/);
    expect(NARROW_CLAIM).toMatch(/Not checked:/);
    expect(levelTurnText(1, snap, { hasImages: false, lastEdited: false })).toContain(NARROW_CLAIM);
    expect(stallAskText([{ code: 'x', severity: 'warning', message: 'm', entities: [] } as never])).toMatch(/Not checked/);
    expect(NO_EMPTYING).toMatch(/startOver:true/);
  });
});
