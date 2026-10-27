import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld, type Entity, type WorldDoc } from '@aether/core';
import { reviewFindings, runDesignTool } from '@aether/arch';
import { WorldAgent } from '../src/agent';
import type { CompletionRequest, CompletionResponse, ContentBlock, Provider } from '../src/types';
import { collect, MemoryHost, TEST_CATALOGS } from './helpers';

const PLAN = {
  id: 'hall',
  name: 'Hall',
  style: 'modern',
  brief: 'A small screening room.',
  levels: [
    {
      height: 4,
      rooms: [{ id: 'auditorium', type: 'living', rect: [0, 0, 8, 6] }],
      openings: [{ kind: 'door', room: 'auditorium', wall: 'south', to: 'outside', along: 2, width: 1, main: true, id: 'front' }],
    },
  ],
  furniture: [
    { id: 'screen', kind: 'cinema-screen', room: 'auditorium', intent: 'screen on the north wall', relations: [] },
    { id: 'lamp', kind: 'ceiling-light', room: 'auditorium', intent: 'light', relations: [] },
  ],
};

const part = (id: string, at: [number, number, number]): Entity =>
  ({ id, name: 'Widescreen with black velvet masking', tags: [], transform: { position: at, rotation: [0, 0, 0], scale: [1, 1, 1] }, shape: { kind: 'procedural', generator: 'furn-cinema-screen', params: {} } }) as unknown as Entity;

function world(screenAt: [number, number, number]): WorldDoc {
  let w: WorldDoc = createWorld({});
  w = applyPatches(w, runDesignTool(w, 'design_plan', { plan: PLAN }).patches).world;
  w = applyPatches(w, runDesignTool(w, 'place_items', { items: [{ kind: 'ceiling-light', room: 'auditorium', id: 'lamp', at: [4, 3] }] }).patches).world;
  return applyPatches(w, [{ op: 'add', entity: part('widescreen-1', screenAt) }]).world;
}

let n = 0;
const call = (name: string, input: unknown): ContentBlock => ({ type: 'tool_use', id: `t${++n}`, name, input });

function scripted(reply: (req: CompletionRequest, reviewRound: number) => ContentBlock[]): Provider & { requests: CompletionRequest[] } {
  const requests: CompletionRequest[] = [];
  return {
    name: 'scripted',
    requests,
    async complete(req): Promise<CompletionResponse> {
      requests.push(JSON.parse(JSON.stringify(req)) as CompletionRequest);
      const rounds = req.messages.filter((m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'text' && b.text.startsWith('REVIEW round'))).length;
      const content = reply(req, rounds);
      return { content, stopReason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end' };
    },
  };
}

const reviewTexts = (p: { requests: CompletionRequest[] }): string[] => {
  const last = p.requests.at(-1);
  return (last?.messages ?? []).flatMap((m) => (Array.isArray(m.content) ? m.content.flatMap((b) => (b.type === 'text' && b.text.startsWith('REVIEW round') ? [b.text] : [])) : []));
};

function agent(provider: Provider): WorldAgent {
  return new WorldAgent({ provider, catalogs: TEST_CATALOGS, maxTurns: 10, review: { stallRounds: 3 } });
}

describe('plan conformance in the review loop', () => {
  it('a planned screen is matched to the crafted cinema-screen: the review never reports it missing', async () => {
    const w = world([4, 2, 0.1]);
    expect(reviewFindings(w, 'hall').filter((f) => f.code === 'plan_missing')).toEqual([]);
    const provider = scripted((req, rounds) => (req.messages.length < 2 ? [call('edit_items', { edits: [{ op: 'move', ref: 'hall-lamp', at: [3, 3] }] })] : rounds === 0 ? [call('finish', { message: 'edited' })] : [call('finish', { message: 'checked' })]));
    await collect(agent(provider).run('tidy up everything', new MemoryHost(w)));
    const text = reviewTexts(provider).join('\n');
    expect(text).toContain('REVIEW round');
    expect(text).not.toContain('never placed');
    expect(text).toContain('widescreen-1');
  });

  it('a mapping the model declares persists: the finding is not repeated in later rounds', async () => {
    const w = world([60, 2, 60]);
    const open = reviewFindings(w, 'hall').find((f) => f.code === 'plan_missing');
    expect(open?.candidates?.join(' ')).toContain('widescreen-1');
    let declared = false;
    const provider = scripted((req, rounds) => {
      if (req.messages.length < 2) return [call('edit_items', { edits: [{ op: 'move', ref: 'hall-lamp', at: [3, 3] }] })];
      if (rounds === 0) return [call('finish', { message: 'edited' })];
      if (rounds <= 1 && !declared) {
        declared = true;
        return [call('edit_items', { edits: [{ op: 'declare_plan', ref: 'screen', entities: ['widescreen-1'], reason: 'the crafted screen' }] })];
      }
      if (rounds <= 1) return [call('edit_items', { edits: [{ op: 'move', ref: 'hall-lamp', at: [3.5, 3] }] })];
      return [call('finish', { message: 'the screen is widescreen-1' })];
    });
    const host = new MemoryHost(w);
    const evs = await collect(agent(provider).run('tidy up everything', host));
    const texts = reviewTexts(provider);
    expect(texts[0]).toContain('never placed');
    expect(texts.slice(1).join('\n')).not.toContain('never placed');
    expect(reviewFindings(host.world, 'hall').filter((f) => f.code === 'plan_missing')).toEqual([]);
  });
});
