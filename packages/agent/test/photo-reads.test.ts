import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildChecklist, clusterReads, consensusDescription, contested, parseRoomDescription, type RoomDescription } from '@aether/arch/photo';
import { partKinds } from '@aether/arch';
import { WorldAgent } from '../src/agent';
import type { Raster } from '../src/photo/score';
import { PHOTO_ROUNDS_CEILING, READ_SEED } from '../src/photo/pipeline';
import { JUDGE_SEED } from '../src/photo/judge';
import { RECONCILE_TOOL_NAME, parseReconcile } from '../src/photo/reconcile';
import type { AgentEvent, CompletionRequest, CompletionResponse, ContentBlock, Provider, ReviewViewRequest } from '../src/types';
import { collect, MemoryHost, TEST_CATALOGS } from './helpers';

const FIXTURE = resolve(__dirname, '../../../tests/fixtures/photo/hotel.description.json');
type Raw = Record<string, unknown> & { items: Array<Record<string, unknown>>; footprint: Record<string, number> };
const raw = (): Raw => JSON.parse(readFileSync(FIXTURE, 'utf8')) as Raw;
const kinds = partKinds();

function fakePhoto(w: number, h: number): string {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).copy(b, 0);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return `data:image/png;base64,${b.toString('base64')}`;
}

const raster = (seed: number): Raster => {
  const w = 60;
  const h = 40;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    const v = x > 20 + seed && x < 40 + seed ? 230 : y > 28 ? 60 : 130;
    data[o] = v;
    data[o + 1] = v * 0.9;
    data[o + 2] = v * 0.95;
    data[o + 3] = 255;
  }
  return { width: w, height: h, data };
};

class PhotoHost extends MemoryHost {
  async captureReview(views: readonly ReviewViewRequest[]): Promise<Array<{ name: string; dataUrl: string }>> {
    return views.map((v) => ({ name: v.name, dataUrl: `data:image/png;base64,${Buffer.from(`render|${v.name}|0`).toString('base64')}` }));
  }
  async decodeImage(dataUrl: string): Promise<Raster | null> {
    return dataUrl.startsWith('data:image/png;base64,iVBOR') ? raster(0) : raster(0);
  }
}

let n = 0;
const call = (name: string, input: unknown): ContentBlock => ({ type: 'tool_use', id: `t${++n}`, name, input });

/** Three reads of the hotel photo that disagree like live reads: a plant only one sees, a TV one misses, positions and sizes. */
function divergentReads(): Raw[] {
  const a = raw();
  a.items.push({ id: 'plant', kind: 'plant', label: 'small plant by the cabinet', wall: 'west', along: 0.3, gap: 0.05, params: {}, confidence: 0.4, box: [0.14, 0.7, 0.2, 0.95] });
  const b = raw();
  b.footprint.width = 3.9;
  b.items = b.items.filter((i) => i['id'] !== 'tv');
  (b.items.find((i) => i['id'] === 'bed') as Record<string, unknown>)['along'] = 2.75;
  const c = raw();
  c.footprint.width = 3.5;
  (c.items.find((i) => i['id'] === 'bed') as Record<string, unknown>)['along'] = 2.45;
  return [a, b, c];
}

const parsed = (r: unknown): RoomDescription => {
  const p = parseRoomDescription(r, kinds);
  if (!p.ok) throw new Error(p.error);
  return p.value;
};

/** The ids of the checklist the compare conversation was given (the lines "- id: …" of its first message). */
function checklistIds(req: CompletionRequest | undefined): string[] {
  const text = JSON.stringify(req?.messages ?? []);
  const block = /Checklist \(answer every id\):\\n([\s\S]*?)\\n(?:How to judge)/.exec(text)?.[1] ?? '';
  return [...block.matchAll(/- ([a-z0-9-]+)(?: \[structural\])?:/g)].map((m) => m[1] as string);
}

interface Recorder extends Provider {
  reads: CompletionRequest[];
  reconciles: CompletionRequest[];
  loop: CompletionRequest[];
  judged: CompletionRequest[];
}

/**
 * Reads are answered by seed (read k gets `reads[k]`), the reconciliation call by `reconcile`, judges by `judge`, and the
 * compare conversation passes every checklist item it was given, then finishes.
 */
function provider(reads: ReadonlyArray<unknown>, opts: { reconcile?: (req: CompletionRequest) => ContentBlock[]; judge?: (req: CompletionRequest) => ContentBlock[]; loop?: (req: CompletionRequest, i: number) => ContentBlock[] } = {}): Recorder {
  const rec: Recorder = {
    name: 'scripted',
    reads: [],
    reconciles: [],
    loop: [],
    judged: [],
    async complete(req): Promise<CompletionResponse> {
      const copy = JSON.parse(JSON.stringify(req)) as CompletionRequest;
      const tool = req.tools?.[0]?.name;
      let content: ContentBlock[];
      if (tool === 'describe_room') {
        rec.reads.push(copy);
        const k = (req.seed ?? READ_SEED) - READ_SEED;
        content = [call('describe_room', { description: reads[k] ?? reads[0] })];
      } else if (tool === RECONCILE_TOOL_NAME) {
        rec.reconciles.push(copy);
        content = opts.reconcile ? opts.reconcile(req) : [call(RECONCILE_TOOL_NAME, { add: [], remove: [] })];
      } else if (req.role === 'critic' && opts.judge) {
        rec.judged.push(copy);
        content = opts.judge(req);
      } else {
        rec.loop.push(copy);
        const i = rec.loop.length - 1;
        content = opts.loop ? opts.loop(req, i) : i === 0 ? [call('report_verdicts', { verdicts: checklistIds(rec.loop[0]).map((id) => ({ id, pass: true })) })] : [call('finish', { message: 'done' })];
      }
      return { content, stopReason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end', model: 'fake-vision' };
    },
  };
  return rec;
}

const photoEvents = (events: AgentEvent[]): Array<Extract<AgentEvent, { type: 'photo' }>> => events.filter((e): e is Extract<AgentEvent, { type: 'photo' }> => e.type === 'photo');
const agent = (p: Provider, photo: NonNullable<ConstructorParameters<typeof WorldAgent>[0]['photo']> = {}): WorldAgent => new WorldAgent({ provider: p, catalogs: TEST_CATALOGS, maxTurns: 10, photo: { judges: 0, ...photo } });

describe('reading the photo several times', () => {
  it('reads it three times independently, merges the reads, settles the contested pieces against the photo, and builds the checklist from the merge', async () => {
    const reads = divergentReads();
    const expectedClusters = clusterReads(reads.map(parsed));
    const plain = consensusDescription(expectedClusters, kinds);
    const plantKey = contested(plain.report).add.find((c) => c.kind === 'plant')?.key as string;
    const tvKey = contested(plain.report).remove.find((c) => c.kind === 'tv-set')?.key as string;
    expect(plantKey).toBeDefined();
    expect(tvKey).toBeDefined();
    // The reconciliation brings the plant back with evidence, and tries to drop the TV with a reason too short to count.
    const p = provider(reads, { reconcile: () => [call(RECONCILE_TOOL_NAME, { add: [{ key: plantKey, reason: 'a small potted plant is visible left of the cabinet at that box' }], remove: [{ key: tvKey, reason: 'no' }] })] });
    const host = new PhotoHost();
    const events = await collect(agent(p).run('make this bedroom in 3d', host, { images: [fakePhoto(1920, 1280)] }));

    // Three stateless reads, each at temperature 0 with its own seed, each with the photo and only describe_room.
    expect(p.reads).toHaveLength(3);
    expect(p.reads.map((r) => r.seed).sort()).toEqual([READ_SEED, READ_SEED + 1, READ_SEED + 2]);
    for (const r of p.reads) {
      expect(r.session).toBeUndefined();
      expect(r.temperature).toBe(0);
      expect(r.messages[0]?.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'image' })]));
    }
    // One reconciliation call: the photo, and the contested keys only.
    expect(p.reconciles).toHaveLength(1);
    const asked = JSON.stringify(p.reconciles[0]?.messages);
    expect(asked).toContain(plantKey);
    expect(asked).toContain(tvKey);
    expect(asked).toContain('"type":"image"');

    const described = photoEvents(events).find((e) => e.phase === 'described');
    expect(described?.reads).toMatchObject({ reads: 3, asked: 3, items: expect.any(Array), contested: expect.any(Number) });
    expect(described?.reads?.items.slice().sort()).toEqual([10, 11, 12]);
    expect(described?.reads?.reconciled).toHaveLength(1);
    expect(described?.text).toMatch(/Read the photo 3 times independently/);

    // The checklist the compare loop judged is exactly the checklist of the merged description (plant added, TV kept).
    const expected = consensusDescription(expectedClusters, kinds, { add: [plantKey] });
    if (!expected.ok) throw new Error(expected.error);
    expect(checklistIds(p.loop[0])).toEqual(buildChecklist(expected.description).map((c) => c.id));
    expect(checklistIds(p.loop[0])).toContain('item-plant-1');
    expect(checklistIds(p.loop[0])).toContain('item-tv-set-1');
    expect(described?.reads?.checklist).toBe(buildChecklist(expected.description).length);
    const done = photoEvents(events).find((e) => e.phase === 'done');
    expect(done?.score?.passed).toBe(done?.score?.total);
  });

  it('two runs whose reads arrive differently build the same checklist', async () => {
    const reads = divergentReads();
    const run = async (order: number[]): Promise<string[]> => {
      const p = provider(order.map((k) => reads[k]), { reconcile: () => [call(RECONCILE_TOOL_NAME, { add: [], remove: [] })] });
      await collect(agent(p).run('make this bedroom in 3d', new PhotoHost(), { images: [fakePhoto(1920, 1280)] }));
      return checklistIds(p.loop[0]);
    };
    const a = await run([0, 1, 2]);
    const b = await run([2, 0, 1]);
    expect(a.length).toBeGreaterThan(10);
    expect(b).toEqual(a);
  });

  it('without reconciliation the majority stands; one usable read is used as it is and said so', async () => {
    const p = provider(divergentReads());
    await collect(agent(p, { reconcile: false }).run('make this bedroom in 3d', new PhotoHost(), { images: [fakePhoto(1920, 1280)] }));
    expect(p.reconciles).toHaveLength(0);
    expect(checklistIds(p.loop[0])).not.toContain('item-plant-1');

    // Two reads are refused every time (an impossible room): the third is built as it is.
    const bad = { ...raw(), footprint: { width: 300, depth: 4, ceiling: 2.7 } };
    const q = provider([raw(), bad, bad]);
    const events = await collect(agent(q).run('make this bedroom in 3d', new PhotoHost(), { images: [fakePhoto(1920, 1280)] }));
    const described = photoEvents(events).find((e) => e.phase === 'described');
    expect(described?.reads).toMatchObject({ reads: 1, asked: 3 });
    expect(described?.text).toMatch(/Only one of 3 readings/);
    // The single read keeps its own ids (no merge).
    expect(checklistIds(q.loop[0])).toContain('item-picture-left');
  });

  it('the reconciliation answer is checked: unknown keys, unanimous pieces and reasons without evidence are ignored', () => {
    const c = consensusDescription(clusterReads(divergentReads().map(parsed)), kinds);
    const disputed = contested(c.report);
    const bed = c.report.items.find((x) => x.kind === 'bed')?.key as string;
    const plant = disputed.add.find((x) => x.kind === 'plant')?.key as string;
    const out = parseReconcile({ add: [{ key: plant, reason: 'visible in the lower left corner of the photo' }, { key: 'c-item-99', reason: 'there is something there for sure' }], remove: [{ key: bed, reason: 'I do not think there is a bed in the room' }] }, c.report);
    expect(out.add).toEqual([plant]);
    expect(out.remove).toEqual([]);
    expect(parseReconcile('nonsense', c.report)).toEqual({ add: [], remove: [], reasons: [] });
  });
});

describe('no fixed round ceiling on a subscription', () => {
  it('keeps comparing while the judges keep finding the new state closer, past the old twelve-round cap, and stops on the stall', async () => {
    let looks = 0;
    // Judges: every new state is closer to the photo for the first 15 relative looks, then they cannot tell them apart.
    const judge = (req: CompletionRequest): ContentBlock[] => {
      const pair = req.messages.some((m) => typeof m.content !== 'string' && m.content.filter((b) => b.type === 'image').length === 3);
      if (pair && ((req.seed ?? JUDGE_SEED) - JUDGE_SEED) === 0) looks++;
      const ids = [...JSON.stringify(req.messages).matchAll(/- ([a-z0-9-]+)(?: \[structural\])?:/g)].map((m) => m[1] as string);
      const currentFirst = ((req.seed ?? JUDGE_SEED) - JUDGE_SEED) % 2 === 0;
      const better = looks <= 15;
      const verdicts = ids.map((id) => ({ id, a: id === 'floor' ? 1 : 4, ...(pair ? { b: id === 'floor' ? 1 : 4 } : {}), evidence: `photo: ${id}; render: ${id === 'floor' ? 'differs' : 'same'}` }));
      return [call('report_judgement', { verdicts, ...(pair ? { closer: better ? (currentFirst ? 'A' : 'B') : 'same' } : {}) })];
    };
    // The model nudges a picture every round (alternating), so every round has something new to judge.
    const p = provider([raw()], { judge, loop: (_req, i) => [call('edit_items', { edits: [{ op: 'move', ref: 'picture-left', wall: 'north', t: i % 2 === 0 ? 2.25 : 2.27 }] })] });
    const events = await collect(new WorldAgent({ provider: p, catalogs: TEST_CATALOGS, maxTurns: 10, photo: { judges: 1, reads: 1 } }).run('make this bedroom in 3d', new PhotoHost(), { images: [fakePhoto(1920, 1280)] }));
    const rounds = photoEvents(events).filter((e) => e.phase === 'round' && /^Round \d+:/.test(e.text)).map((e) => e.round ?? 0);
    expect(Math.max(...rounds)).toBeGreaterThan(12);
    expect(Math.max(...rounds)).toBeLessThan(PHOTO_ROUNDS_CEILING);
    expect(photoEvents(events).some((e) => /Stopped comparing/.test(e.text))).toBe(true);
  }, 60_000);

  it('a paid key keeps its finite cap', async () => {
    const p = provider([raw()], { loop: (req, i) => (i % 2 === 0 ? [call('report_verdicts', { verdicts: checklistIds(p.loop[0]).map((id) => ({ id, pass: id !== 'floor' })) }), call('edit_items', { edits: [{ op: 'move', ref: 'picture-left', wall: 'north', t: 2.25 + (i % 4) * 0.01 }] })] : [call('report_verdicts', { verdicts: checklistIds(p.loop[0]).map((id) => ({ id, pass: id !== 'floor' })) })]) });
    const events = await collect(agent(p, { reads: 1, maxRounds: 2 }).run('make this bedroom in 3d', new PhotoHost(), { images: [fakePhoto(1920, 1280)] }));
    const rounds = photoEvents(events).filter((e) => e.phase === 'round' && e.round !== undefined).map((e) => e.round ?? 0);
    expect(Math.max(...rounds)).toBeLessThanOrEqual(2);
  });
});
