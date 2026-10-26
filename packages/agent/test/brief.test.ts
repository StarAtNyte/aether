import { describe, expect, it } from 'vitest';
import { WorldAgent } from '../src/agent';
import { BRIEF_TOOL_NAME, parseBrief, richnessEvidence, type Brief } from '../src/brief';
import type { GeneratedImage, ImageGenerator, ImageRequest } from '../src/images';
import { createMockProvider } from '../src/providers/mock/index';
import type { AgentEvent, CompletionRequest, CompletionResponse, ContentBlock, Provider } from '../src/types';
import { collect, MemoryHost, TEST_CATALOGS } from './helpers';

const PLAN = {
  id: 'home',
  name: 'Test hall',
  style: 'scandinavian',
  brief: 'A hall.',
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
  furniture: [],
};

const brief = (over: Partial<Brief> = {}): Brief => ({
  elaboration: 'elaborate',
  elaboration_reason: 'a general request for a cinema hall, so a full-scale one',
  kind: 'cinema hall',
  summary: 'A stepped auditorium with a lobby.',
  scale: 'about 24 m by 16 m, 9 m tall',
  zones: [{ name: 'auditorium', purpose: 'seating and screen' }, { name: 'lobby', purpose: 'tickets and concessions' }],
  elements: [
    { name: 'seat rows', count: 10, note: '10 rows', find: ['seat'] },
    { name: 'screen', count: 1, size: '12 m wide', find: ['screen'] },
    { name: 'exit signs', count: 4, find: ['exit'] },
  ],
  materials: ['dark carpet', 'acoustic panels'],
  lighting: 'dim house lights, floor lights on the aisle steps',
  richness: { kinds: 20, pieces: 120 },
  reference: { generate: true, reason: 'a cinema hall has specific fittings I want to see', prompt: 'wide view of a cinema auditorium from the back row' },
  ...over,
});

let n = 0;
const call = (name: string, input: unknown): ContentBlock => ({ type: 'tool_use', id: `t${++n}`, name, input });
const finish = (message = 'ok'): ContentBlock => call('finish', { message });
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

function images(fail = false): ImageGenerator & { calls: ImageRequest[] } {
  const calls: ImageRequest[] = [];
  return {
    id: 'mock-image',
    label: 'mock',
    calls,
    async generate(req): Promise<GeneratedImage> {
      calls.push(req);
      if (fail) throw new Error('usage limit reached');
      return { dataUrl: PNG, model: 'mock-model', via: 'codex' };
    },
  };
}

/** Answers the brief call with `b`, everything else from the script. */
function scripted(b: Brief | null, replies: Array<(req: CompletionRequest) => ContentBlock[]>): Provider & { requests: CompletionRequest[]; briefCalls: number } {
  const requests: CompletionRequest[] = [];
  let i = 0;
  const p = {
    name: 'scripted',
    requests,
    briefCalls: 0,
    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      requests.push(JSON.parse(JSON.stringify(req)) as CompletionRequest);
      if (req.tools?.some((t) => t.name === BRIEF_TOOL_NAME)) {
        p.briefCalls++;
        return b ? { content: [call(BRIEF_TOOL_NAME, b)], stopReason: 'tool_use' } : { content: [{ type: 'text', text: 'no brief' }], stopReason: 'end' };
      }
      const r = replies[Math.min(i, replies.length - 1)];
      i++;
      const content = r ? r(req) : [{ type: 'text', text: 'done' } as ContentBlock];
      return { content, stopReason: content.some((x) => x.type === 'tool_use') ? 'tool_use' : 'end' };
    },
  };
  return p;
}

const textOf = (m: CompletionRequest['messages'][number]): string => (typeof m.content === 'string' ? m.content : m.content.map((b) => (b.type === 'text' ? b.text : b.type === 'tool_result' ? b.content : '')).join('\n'));

const FURNISH = { items: [{ kind: 'bed', room: 'bedroom', id: 'seat-1', wall: 'north', align: 'centre' }] };

describe('brief -> build -> richness review', () => {
  it('an elaborate request: writes the brief, makes the reference, builds to the checklist and reviews richness', async () => {
    const gen = images();
    const provider = scripted(brief(), [
      () => [call('design_plan', { plan: PLAN })],
      () => [call('place_items', FURNISH)],
      () => [finish('built')],
      // review round 1: the model sees the richness text, looks at the reference, adds a piece
      () => [call('look_closer', { regions: [{ box: [0.2, 0.2, 0.6, 0.6], note: 'sconces' }] })],
      () => [call('place_items', { items: [{ kind: 'nightstand', room: 'bedroom', id: 'sconce-1', wall: 'north', t: 0.65 }] })],
      () => [finish('added what was missing')],
      // round 2: approves
      () => [finish('as rich as the brief said')],
    ]);
    const host = new MemoryHost();
    const events: AgentEvent[] = await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS, maxTurns: 12, brief: {}, textures: { images: gen }, review: {} }).run('make a cinema hall', host, { intent: 'new' }));

    const ev = events.find((e) => e.type === 'brief');
    expect(ev && ev.type === 'brief' && ev.view.brief.elaboration).toBe('elaborate');
    // The decision and the provenance are recorded.
    expect(ev && ev.type === 'brief' && ev.view.reference).toMatchObject({ decision: 'generated', provenance: 'generated reference', via: 'codex' });
    expect(ev && ev.type === 'brief' && ev.view.reference.prompt).toContain('cinema auditorium');
    expect(gen.calls).toHaveLength(1);
    expect(events.some((e) => e.type === 'step' && e.tool === 'reference_image' && e.looked?.length === 1)).toBe(true);

    // The first build turn carries the checklist and the picture, and look_closer is offered.
    const build = provider.requests.find((r) => !r.tools?.some((t) => t.name === BRIEF_TOOL_NAME))!;
    const first = textOf(build.messages[0]!);
    expect(first).toContain('BRIEF for this world');
    expect(first).toContain('seat rows: 10');
    expect(build.messages[0]!.content).toSatisfy((c: unknown) => Array.isArray(c) && c.some((b: ContentBlock) => b.type === 'image'));
    expect(build.tools!.map((t) => t.name)).toContain('look_closer');

    // The review compares with the brief and shows advisory counts.
    const review = provider.requests.map((r) => r.messages.map(textOf).join('\n')).find((t) => t.includes('RICHNESS REVIEW'))!;
    expect(review).toContain('Advisory piece counts');
    expect(review).toMatch(/seat rows: brief 10, found/);
    expect(events.some((e) => e.type === 'review' && e.phase === 'approved')).toBe(true);
    expect(events.some((e) => e.type === 'step' && e.tool === 'look_closer')).toBe(true);
    expect(Object.keys(host.world.entities).some((id) => id.includes('sconce'))).toBe(true);
  });

  it('a small-room request: minimal brief, no image call, nothing extra to build', async () => {
    const gen = images();
    const b = brief({ elaboration: 'minimal', elaboration_reason: 'the user asked for a small room', kind: 'small room', reference: { generate: false, reason: 'a simple small room needs no picture' } });
    const provider = scripted(b, [() => [call('design_plan', { plan: PLAN })], () => [finish('done')], () => [finish('fine')]]);
    const host = new MemoryHost();
    const events = await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS, maxTurns: 10, brief: {}, textures: { images: gen }, review: {} }).run('make a small room', host, { intent: 'new' }));
    expect(gen.calls).toHaveLength(0);
    const ev = events.find((e) => e.type === 'brief');
    expect(ev && ev.type === 'brief' && ev.view.brief.elaboration).toBe('minimal');
    expect(ev && ev.type === 'brief' && ev.view.reference).toMatchObject({ decision: 'skipped' });
    const build = provider.requests.find((r) => !r.tools?.some((t) => t.name === BRIEF_TOOL_NAME))!;
    expect(textOf(build.messages[0]!)).toContain('small and simple');
    expect(build.tools!.map((t) => t.name)).not.toContain('look_closer');
  });

  it('records an image that could not be made, and builds on', async () => {
    const provider = scripted(brief(), [() => [call('design_plan', { plan: PLAN })], () => [finish('done')]]);
    const events = await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS, maxTurns: 10, brief: {}, textures: { images: images(true) } }).run('make a cinema hall', new MemoryHost(), { intent: 'new' }));
    const ev = events.find((e) => e.type === 'brief');
    expect(ev && ev.type === 'brief' && ev.view.reference.decision).toBe('failed');
    expect(ev && ev.type === 'brief' && ev.view.reference.reason).toContain('usage limit');
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('records that no image model was connected', async () => {
    const provider = scripted(brief(), [() => [call('design_plan', { plan: PLAN })], () => [finish('done')]]);
    const events = await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS, maxTurns: 10, brief: {} }).run('make a cinema hall', new MemoryHost(), { intent: 'new' }));
    const ev = events.find((e) => e.type === 'brief');
    expect(ev && ev.type === 'brief' && ev.view.reference.decision).toBe('unavailable');
  });

  it('lets the user edit the plan before the build when the host asks', async () => {
    const provider = scripted(brief({ reference: { generate: false, reason: 'known' } }), [() => [call('design_plan', { plan: PLAN })], () => [finish('done')]]);
    const events = await collect(
      new WorldAgent({ provider, catalogs: TEST_CATALOGS, maxTurns: 10, brief: {} }).run('make a cinema hall', new MemoryHost(), {
        intent: 'new',
        reviewBrief: async (view) => ({ brief: { ...view.brief, elements: view.brief.elements.map((e) => (e.name === 'seat rows' ? { ...e, count: 14 } : e)) }, notes: 'make it an old art-deco cinema' }),
      }),
    );
    const views = events.filter((e) => e.type === 'brief');
    expect(views).toHaveLength(2);
    const build = provider.requests.find((r) => !r.tools?.some((t) => t.name === BRIEF_TOOL_NAME))!;
    const t = textOf(build.messages[0]!);
    expect(t).toContain('seat rows: 14');
    expect(t).toContain('art-deco');
  });

  it('builds without a brief when the model cannot write one', async () => {
    const provider = scripted(null, [() => [call('design_plan', { plan: PLAN })], () => [finish('done')]]);
    const events = await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS, maxTurns: 10, brief: {} }).run('make a cinema hall', new MemoryHost(), { intent: 'new' }));
    expect(provider.briefCalls).toBe(2);
    expect(events.some((e) => e.type === 'brief')).toBe(false);
    expect(events.some((e) => e.type === 'step' && /without it/.test(e.label))).toBe(true);
  });

  it('does not run for a refinement of an existing world', async () => {
    const provider = scripted(brief({ reference: { generate: false, reason: 'known' } }), [() => [call('design_plan', { plan: PLAN })], () => [finish('done')], () => [finish('red')]]);
    const host = new MemoryHost();
    await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS, maxTurns: 10, brief: {} }).run('make a cinema hall', host, { intent: 'new' }));
    const before = provider.briefCalls;
    await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS, maxTurns: 10, brief: {} }).run('make the carpet red', host, { intent: 'refine' }));
    expect(provider.briefCalls).toBe(before);
  });

  it('leaves the offline planner unchanged: no brief, no review', async () => {
    const events = await collect(new WorldAgent({ provider: createMockProvider(), catalogs: TEST_CATALOGS, brief: {}, review: {} }).run('a small house', new MemoryHost(), { intent: 'new' }));
    expect(events.some((e) => e.type === 'brief')).toBe(false);
    expect(events.some((e) => e.type === 'review')).toBe(false);
  });
});

describe('brief helpers', () => {
  it('rejects a brief without elements and names the problem', () => {
    const r = parseBrief({ ...brief(), elements: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('elements');
  });

  it('counts pieces per element as evidence and marks gaps', async () => {
    const host = new MemoryHost();
    const p = scripted(null, []);
    void p;
    const { applyPatches } = await import('@aether/core');
    const mk = (id: string) => ({ op: 'add', entity: { id, name: id } });
    const res = applyPatches(host.world, [mk('seat-1'), mk('seat-2'), mk('screen-main')] as never);
    const text = richnessEvidence(res.world, brief());
    expect(text).toMatch(/seat rows: brief 10, found 2 \(sparse\)/);
    expect(text).toMatch(/screen: brief 1, found 1 \(ok\)/);
    expect(text).toMatch(/exit signs: brief 4, found 0 \(NONE FOUND\)/);
  });
});
