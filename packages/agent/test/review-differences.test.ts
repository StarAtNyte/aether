import { describe, expect, it } from 'vitest';
import { WorldAgent } from '../src/agent';
import type { AgentEvent, CompletionRequest, CompletionResponse, ContentBlock, Provider, ReviewViewRequest } from '../src/types';
import { REVIEW_CROSSCHECK_SEED } from '../src/review-diff';
import { collect, MemoryHost, TEST_CATALOGS } from './helpers';

const PLAN = {
  id: 'home',
  name: 'Test home',
  style: 'scandinavian',
  brief: 'A calm bedroom.',
  levels: [
    {
      height: 2.9,
      rooms: [
        { id: 'bedroom', type: 'bedroom', rect: [0, 0, 4, 3.6] },
        { id: 'hall', type: 'hall', rect: [0, 3.6, 4, 5.2] },
      ],
      openings: [
        { kind: 'window', room: 'bedroom', wall: 'east', along: 1.8, width: 1.4, height: 1.3, sill: 0.9 },
        { kind: 'door', room: 'bedroom', wall: 'south', to: 'hall', along: 3.2, width: 0.9 },
        { kind: 'door', room: 'hall', wall: 'south', to: 'outside', along: 1.4, width: 1, main: true },
      ],
    },
  ],
  furniture: [
    { id: 'bed', kind: 'bed', room: 'bedroom', intent: 'bed centred on the north wall', relations: [{ type: 'against_wall', wall: 'north' }, { type: 'centred_on_wall', wall: 'north' }] },
    { id: 'light', kind: 'ceiling-light', room: 'bedroom', intent: 'light in the middle', relations: [] },
    { id: 'hall-light', kind: 'ceiling-light', room: 'hall', intent: 'light', relations: [] },
  ],
};


type Reply = (req: CompletionRequest) => ContentBlock[];
let n = 0;
const call = (name: string, input: unknown): ContentBlock => ({ type: 'tool_use', id: `r${++n}`, name, input });
const finish = (message = 'ok'): ContentBlock => call('finish', { message });
const FURNISH = {
  items: [
    { kind: 'bed', room: 'bedroom', id: 'bed', wall: 'north', align: 'centre' },
    { kind: 'nightstand', room: 'bedroom', id: 'ns', wall: 'north', t: 0.65 },
    { kind: 'ceiling-light', room: 'bedroom', id: 'light', at: [2, 1.8] },
    { kind: 'ceiling-light', room: 'hall', id: 'hall-light', at: [2, 4.4] },
  ],
};


const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

class ReviewHost extends MemoryHost {
  composed = 0;
  async captureReview(views: readonly ReviewViewRequest[]): Promise<Array<{ name: string; dataUrl: string }>> {
    return views.map((v) => ({ name: v.name, dataUrl: PNG }));
  }
  async composeImages(): Promise<string | null> {
    this.composed++;
    return PNG;
  }
}

function scripted(replies: Reply[], critic?: Reply): Provider & { requests: CompletionRequest[]; critics: CompletionRequest[] } {
  const requests: CompletionRequest[] = [];
  const critics: CompletionRequest[] = [];
  let i = 0;
  return {
    name: 'scripted',
    requests,
    critics,
    async complete(req): Promise<CompletionResponse> {
      if (req.role === 'critic' && critic) {
        critics.push(JSON.parse(JSON.stringify(req)) as CompletionRequest);
        return { content: critic(req), stopReason: 'tool_use' };
      }
      requests.push(JSON.parse(JSON.stringify(req)) as CompletionRequest);
      const r = replies[Math.min(i, replies.length - 1)];
      i++;
      const content = r ? r(req) : [{ type: 'text', text: 'done' } as ContentBlock];
      return { content, stopReason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end' };
    },
  };
}
const text = (req: CompletionRequest): string => JSON.stringify(req.messages.at(-1)?.content);

describe('review of a world built from a prompt: gaps from the request, ranked, confirmed, cross-checked', () => {
  it('compares the renders with the request and the reference picture, gates edits on the list, pushes back a large open gap, and records what a fresh seat still sees', async () => {
    const provider = scripted(
      [
        () => [call('design_plan', { plan: PLAN })],
        () => [call('place_items', FURNISH)],
        () => [finish('A calm bedroom.')],
        // Review round 1: an edit before the list is refused; the list names a large gap; the model approves anyway.
        () => [call('edit_items', { edits: [{ op: 'move', ref: 'bed', wall: 'north', t: 1.9 }] })],
        () => [call('report_differences', { differences: [{ id: 'bed-size', kind: 'scale', where: 'bedroom', what: 'bed is a single, the request says double', size: 5 }] }), finish('Looks fine.')],
        // The push-back: round 2 reports it fixed.
        () => [call('report_differences', { differences: [{ id: 'bed-size', what: 'bed is a double now', size: 0, status: 'fixed' }] }), finish('Done.')],
      ],
      () => [call('report_differences', { differences: [{ id: 'rug', kind: 'missing', what: 'no rug under the bed', size: 3 }] })],
    );
    const host = new ReviewHost();
    const agent = new WorldAgent({ provider, catalogs: TEST_CATALOGS, maxTurns: 10, review: { vision: true, differences: true, crossCheck: true, stallRounds: 6 } });
    const events: AgentEvent[] = await collect(agent.run('a calm bedroom with a double bed under the window', host, { images: [PNG] }));
    const reviewReq = provider.requests.find((r) => text(r).includes('COMPARE WITH THE REQUEST'));
    expect(reviewReq).toBeDefined();
    expect(text(reviewReq!)).toContain('a calm bedroom with a double bed under the window');
    expect(text(reviewReq!)).toContain('REFERENCE 1 from the user');
    expect(reviewReq!.tools?.map((t) => t.name)).toContain('report_differences');
    expect(host.composed).toBeGreaterThan(0);
    // The edit before the list was refused.
    expect(provider.requests.some((r) => text(r).includes('List the differences first'))).toBe(true);
    // The large open gap was pushed back once, naming it.
    expect(provider.requests.some((r) => text(r).includes('large gaps from the request are still open: bed-size'))).toBe(true);
    // The UI is told about the list; the independent seat is fresh and its finding is named in the closing message.
    expect(events.some((e) => e.type === 'review' && e.differences && e.differences.length > 0)).toBe(true);
    expect(provider.critics).toHaveLength(1);
    const c = provider.critics[0]!;
    expect(c.seed).toBe(REVIEW_CROSSCHECK_SEED);
    expect(c.messages).toHaveLength(1);
    expect(JSON.stringify(c.messages)).not.toContain('bed-size');
    expect(JSON.stringify(c.messages)).toContain('double bed under the window');
    expect(events.some((e) => e.type === 'review' && e.phase === 'crosscheck')).toBe(true);
    const closing = events.filter((e) => e.type === 'message').map((e) => (e as { text: string }).text).join('\n');
    expect(closing).toMatch(/still open, largest first: check-rug/);
  });

  it('does nothing different unless the ledger is switched on', async () => {
    const provider = scripted([() => [call('design_plan', { plan: PLAN })], () => [call('place_items', FURNISH)], () => [finish('ok')], () => [finish('fine')]]);
    const host = new ReviewHost();
    await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS, maxTurns: 10, review: { vision: true } }).run('a calm bedroom', host));
    expect(provider.requests.every((r) => !text(r).includes('COMPARE WITH THE REQUEST'))).toBe(true);
    expect(provider.requests.every((r) => !(r.tools ?? []).some((t) => t.name === 'report_differences'))).toBe(true);
  });
});
