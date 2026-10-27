import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { buildChecklist, parseRoomDescription, type RoomDescription } from '@aether/arch/photo';
import { makeCam } from '@aether/arch/photo';
import { partKinds } from '@aether/arch';
import { WorldAgent } from '../src/agent';
import { decodeRle, encodeRle, normLabel, Perceiver, perceptionText, type PerceiveDeps, type PerceptionReport } from '../src/photo/perception/perceive';
import { parseBoxes, BpeTokenizer } from '../src/photo/perception/florence';
import { PERCEIVE_TOOL, parsePerceiveInput, perceivePhoto } from '../src/photo/perception/tool';
import { seedInventory } from '../src/photo/perception/seed';
import { classifyEmbedding, clipInput, clipVocabulary } from '../src/photo/perception/clip';
import { FLORENCE_SET, METRIC_SET, SAM_SET, loadWeights } from '../src/photo/perception/weights';
import type { InventoryItem } from '../src/photo/objects';
import type { Raster } from '../src/photo/score';
import type { AgentEvent, CompletionRequest, CompletionResponse, ContentBlock, Provider, ReviewViewRequest } from '../src/types';
import { collect, MemoryHost, TEST_CATALOGS } from './helpers';

// ---- a synthetic room: known colours and a known depth map ----
const W = 256, H = 192;
const FOV = 64;
const ROOM = { W: 4, D: 6, H: 2.6, cam: [1.7, 1.4, 0.5] as [number, number, number] };
const OBST = { x: [2.6, 3.5] as [number, number], z: [3.5, 4.2] as [number, number], h: 0.8 };
const FLOOR: [number, number, number] = [24, 40, 92];
const WALL: [number, number, number] = [225, 222, 214];
const CEIL: [number, number, number] = [245, 245, 245];
const RED: [number, number, number] = [190, 30, 30];

function synth(): { raster: { width: number; height: number; data: Uint8ClampedArray }; depth: { width: number; height: number; data: Float32Array }; obstacleBox: [number, number, number, number] } {
  const cam = makeCam({ width: W, height: H }, FOV);
  const data = new Uint8ClampedArray(W * H * 4);
  const depth = new Float32Array(W * H);
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  const [cx, cy, cz] = ROOM.cam;
  for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) {
    const a = (u + 0.5 - cam.cx) / cam.f;
    const b = -(v + 0.5 - cam.cy) / cam.f;
    let t = Infinity;
    let kind = 'wall';
    const hit = (p: number, k: string): void => { if (p > 0.05 && p < t) { t = p; kind = k; } };
    if (a !== 0) { hit(-cx / a, 'wall'); hit((ROOM.W - cx) / a, 'wall'); }
    if (b !== 0) { hit(-cy / b, 'floor'); hit((ROOM.H - cy) / b, 'ceil'); }
    hit(ROOM.D - cz, 'wall');
    const lo = [(OBST.x[0] - cx) / a, -cy / b, OBST.z[0] - cz];
    const hi = [(OBST.x[1] - cx) / a, (OBST.h - cy) / b, OBST.z[1] - cz];
    const t0 = Math.max(Math.min(lo[0] as number, hi[0] as number), Math.min(lo[1] as number, hi[1] as number), Math.min(lo[2] as number, hi[2] as number));
    const t1 = Math.min(Math.max(lo[0] as number, hi[0] as number), Math.max(lo[1] as number, hi[1] as number), Math.max(lo[2] as number, hi[2] as number));
    if (t0 <= t1 && t0 > 0.05 && t0 < t) { t = t0; kind = 'obst'; x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, v); y1 = Math.max(y1, v); }
    depth[v * W + u] = t;
    const c = kind === 'floor' ? FLOOR : kind === 'ceil' ? CEIL : kind === 'obst' ? RED : WALL;
    data.set([c[0], c[1], c[2], 255], (v * W + u) * 4);
  }
  return { raster: { width: W, height: H, data }, depth: { width: W, height: H, data: depth }, obstacleBox: [x0 / W, y0 / H, (x1 + 1) / W, (y1 + 1) / H] };
}

function deps(over: Partial<PerceiveDeps> = {}): { deps: PerceiveDeps; calls: string[]; obstacleBox: [number, number, number, number] } {
  const s = synth();
  const calls: string[] = [];
  const d: PerceiveDeps = {
    raster: async () => s.raster,
    detector: async () => ({
      ok: true,
      model: {
        async setImage() { calls.push('florence-image'); },
        async detect(task, input) {
          calls.push(`${task}${input ? `:${input}` : ''}`);
          if (task === '<OD>') return [{ label: 'chair', box: s.obstacleBox, confidence: 0.8 }, { label: 'house', box: [0, 0, 1, 1], confidence: 0.99 }];
          if (task === '<CAPTION_TO_PHRASE_GROUNDING>') return [{ label: 'a rug', box: [0.2, 0.7, 0.5, 0.95], confidence: 0.4 }];
          return [];
        },
        async caption() { return 'A room with a chair.'; },
        async dispose() { calls.push('florence-dispose'); },
      },
    }),
    segmenter: async () => ({
      ok: true,
      model: {
        async setImage() { calls.push('sam-image'); },
        async segment(box) {
          const data = new Uint8Array(W * H);
          for (let y = Math.floor(box[1] * H); y < Math.ceil(box[3] * H); y++) for (let x = Math.floor(box[0] * W); x < Math.ceil(box[2] * W); x++) data[y * W + x] = 1;
          return { mask: { width: W, height: H, data }, score: 0.9 };
        },
        async dispose() { calls.push('sam-dispose'); },
      },
    }),
    metric: async () => ({ ok: true, depth: s.depth }),
    relative: async () => ({ ok: false, reason: 'not in this test' }),
    trainedFovDeg: null,
    ...over,
  };
  return { deps: d, calls, obstacleBox: s.obstacleBox };
}

describe('perceive_photo: measurements from specialised models (mocked runners, synthetic photo)', () => {
  it('detects, masks, measures colour and place, and fits the room', async () => {
    const { deps: d, calls } = deps();
    const p = new Perceiver(d);
    const rep = (await p.run({ find: ['rug', 'desk'] })) as PerceptionReport;
    expect(rep.version).toBe(2);
    expect(rep.models).toMatchObject({ detector: expect.stringContaining('Florence'), segmenter: expect.stringContaining('SAM'), depth: expect.stringContaining('metric') });
    // the whole-frame "house" is dropped; the chair and the rug stay
    expect(rep.objects.map((o) => o.label).sort()).toEqual(['chair', 'rug']);
    expect(rep.notFound).toEqual(['desk']);
    const chair = rep.objects.find((o) => o.label === 'chair')!;
    expect(chair.source).toBe('measured');
    expect(chair.appearance?.colour.name).toMatch(/red/);
    expect(chair.appearance?.colour.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(chair.mask?.score).toBe(0.9);
    expect(chair.placement?.kind).toBe('floor');
    expect(chair.placement?.size.h).toBeGreaterThan(0.5);
    expect(chair.placement?.size.h).toBeLessThan(1.1);
    // the floor, walls and ceiling colours come from the fitted planes, furniture removed: the floor is dark blue
    expect(rep.surfaces.floor?.colour.name).toBe('dark blue');
    expect(rep.surfaces.walls?.colour.name).toMatch(/white|light|cream/);
    expect(rep.room?.walls).toMatchObject({ floor: true, back: true });
    // the field of view is only loosely fixed (the arch tests check the box against a known one), so the plumbing check is a plausible ceiling
    expect(rep.room?.height.value).toBeGreaterThan(2.1);
    expect(rep.room?.height.value).toBeLessThan(3.7);
    expect(rep.camera?.cameraHeight).toBeGreaterThan(1.1);
    expect(rep.camera?.cameraHeight).toBeLessThan(1.8);
    expect(rep.caption).toBe('A room with a chair.');
    expect(rep.timingsMs).toHaveProperty('metric-depth');
    // models are asked once: the vision towers ran once each
    expect(calls.filter((c) => c === 'florence-image').length).toBe(1);
    expect(calls.filter((c) => c === 'sam-image').length).toBe(1);
    // the report is JSON (it travels in the run record)
    expect(JSON.parse(JSON.stringify(rep))).toStrictEqual(JSON.parse(JSON.stringify(rep)));
    const back = JSON.parse(JSON.stringify(rep)) as PerceptionReport;
    expect(back.objects.length).toBe(rep.objects.length);
    expect(back.room?.width.value).toBe(rep.room?.width.value);
    const nan: string[] = [];
    const walk = (v: unknown, path: string): void => {
      if (typeof v === 'number' && !Number.isFinite(v)) nan.push(path);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    };
    walk(rep, 'rep');
    expect(nan).toEqual([]);
    await p.dispose();
    expect(calls).toContain('florence-dispose');
  });

  it('keeps what it found and only asks for new nouns on a second call', async () => {
    const { deps: d, calls } = deps();
    const p = new Perceiver(d);
    await p.run({ find: ['rug'] });
    const n = calls.length;
    const again = await p.run({ find: ['rug'], generic: false });
    expect(calls.length).toBe(n);
    expect(again?.objects.length).toBe(2);
    const more = await p.run({ find: ['lamp'], generic: false });
    expect(calls.slice(n).some((c) => c.includes('lamp'))).toBe(true);
    expect(more?.notFound).toContain('lamp');
  });

  it('is partly available: no detector still gives the room, and names the reason', async () => {
    const { deps: d } = deps({ detector: async () => ({ ok: false, reason: 'Florence-2 base: offline' }) });
    const rep = await new Perceiver(d).run({ find: ['bed'] });
    expect(rep?.objects).toEqual([]);
    expect(rep?.room?.walls.floor).toBe(true);
    expect(rep?.unavailable.join(' ')).toContain('offline');
    expect(perceptionText(rep as PerceptionReport)).toContain('Unavailable');
  });

  it('with no model at all the tool says so and changes nothing', async () => {
    const off = { ok: false as const, reason: 'perception models are turned off (AETHER_PERCEPTION=off)' };
    const p = new Perceiver({ raster: async () => synth().raster, detector: async () => off, segmenter: async () => off, metric: async () => off, relative: async () => off });
    const got = await perceivePhoto(p, { find: ['bed'] });
    expect(got.isError).toBe(true);
    expect(got.text).toContain('not available');
    expect(got.blocks).toEqual([]);
  });

  it('a host that cannot decode gives a plain error', async () => {
    const got = await perceivePhoto(new Perceiver({ raster: async () => null }), { find: [] });
    expect(got.isError).toBe(true);
    expect(got.text).toContain('could not decode');
  });

  it('words the result for the model and draws the annotated picture', async () => {
    const p = new Perceiver(deps().deps);
    const got = await perceivePhoto(p, { find: ['rug'] });
    expect(got.isError).toBe(false);
    expect(got.text).toContain('MEASURED');
    expect(got.text).toContain('advisory');
    expect(got.text).toMatch(/Room \(metric depth/);
    expect(got.text).toMatch(/1\. chair/);
    expect(got.text).toMatch(/floor dark blue/);
    const img = got.blocks.find((b) => b.type === 'image') as Extract<ContentBlock, { type: 'image' }>;
    expect(img.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(Buffer.from(img.dataUrl.split(',')[1] as string, 'base64').subarray(1, 4).toString()).toBe('PNG');
  });

  it('round-trips masks as run-length codes', () => {
    const data = new Uint8Array(12 * 9);
    for (let y = 2; y < 6; y++) for (let x = 3; x < 9; x++) data[y * 12 + x] = 1;
    const rle = encodeRle({ width: 12, height: 9, data });
    expect(Array.from(decodeRle(rle))).toEqual(Array.from(data));
    expect(rle.runs.length).toBeLessThan(20);
  });

  it('tool input is validated', () => {
    expect(parsePerceiveInput({})).toEqual({ find: [] });
    expect(parsePerceiveInput({ find: ['bed', 'desk'], generic: false })).toEqual({ find: ['bed', 'desk'], generic: false });
    expect(parsePerceiveInput({ find: 'bed' })).toBeNull();
    expect(PERCEIVE_TOOL.name).toBe('perceive_photo');
    expect(normLabel('A Large Rug.')).toBe('large rug');
  });

  it('parses Florence boxes and the byte-level tokenizer round-trips', () => {
    const loc = (n: number): number => 50269 + n;
    const ids = [100, loc(100), loc(200), loc(500), loc(900), loc(10), loc(20), loc(30), loc(40), 2];
    const decode = (t: number[]): string => (t.join() === '100' ? 'bed' : '?');
    const boxes = parseBoxes(ids, ids.map(() => 0.5), decode);
    expect(boxes.length).toBe(2);
    expect(boxes[0]).toMatchObject({ label: 'bed', box: [0.1005, 0.2005, 0.5005, 0.9005] });
    expect(boxes[1]?.label).toBe('bed');
    const tok = new BpeTokenizer({ model: { vocab: { a: 10, b: 11, ab: 12, Ġ: 13, Ġa: 14 }, merges: ['a b', 'Ġ a'] } });
    expect(tok.encode('ab')).toEqual([0, 12, 2]);
    expect(tok.encode(' a')).toEqual([0, 14, 2]);
    expect(tok.decode([12, 14])).toBe('ab a');
  });

  it('pins every weight file: revision, SHA-256 and a no-fetch, off-switch-honouring loader', async () => {
    for (const set of [FLORENCE_SET, SAM_SET, METRIC_SET]) {
      for (const f of set.files) {
        expect(f.url).toMatch(/resolve\/[0-9a-f]{40}\//);
        expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
    }
    const saved = process.env['AETHER_PERCEPTION'];
    process.env['AETHER_PERCEPTION'] = 'off';
    try {
      const w = await loadWeights(FLORENCE_SET);
      expect(w.ok).toBe(false);
    } finally {
      if (saved === undefined) delete process.env['AETHER_PERCEPTION'];
      else process.env['AETHER_PERCEPTION'] = saved;
    }
  });
});

describe('seeding the two-seat inventory', () => {
  const item = (id: string, kind: string, box: [number, number, number, number], seen: InventoryItem['seen'] = 'both'): InventoryItem => ({ id, kind, category: 'furniture', label: kind, box, relations: [], size: '', look: 'a teal carpet', confidence: 0.8, occlusion: '', entities: [], linkedBy: 'none', seen });

  it('annotates matches with measured values and adds what the seats missed, flagged', async () => {
    const { deps: d, obstacleBox } = deps();
    const rep = (await new Perceiver(d).run({ find: ['rug'] })) as PerceptionReport;
    const chairBox = rep.objects.find((o) => o.label === 'chair')!.box;
    const seats = [item('chair-1', 'chair', chairBox), item('bed-1', 'bed', [0, 0.1, 0.2, 0.3])];
    const seeded = seedInventory(seats, rep, { minConfidence: 0.3 });
    const chair = seeded.items.find((i) => i.id === 'chair-1')!;
    expect(chair.measured?.hex).toMatch(/^#/);
    expect(chair.look).toContain('measured:');
    expect(chair.look).toContain('a teal carpet');
    expect(seeded.matched).toBe(1);
    const rug = seeded.items.find((i) => i.seen === 'measured');
    expect(rug?.kind).toBe('rug');
    expect(rug?.label).toContain('found by measurement');
    expect(seeded.added.length).toBe(1);
    expect(seeded.line).toMatch(/found 1 the seats did not list/);
    expect(obstacleBox[2]).toBeGreaterThan(obstacleBox[0]);
    // seats keep their own entries untouched
    expect(seeded.items.find((i) => i.id === 'bed-1')?.measured).toBeUndefined();
    expect(seats[0]?.measured).toBeUndefined();
  });
});

// ---- the tool result reaches the model in a real (scripted) photo run ----

const FIXTURE = resolve(__dirname, '../../../tests/fixtures/photo/hotel.description.json');
const rawDescription = (): Record<string, unknown> => JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>;
const description = (): RoomDescription => {
  const p = parseRoomDescription(rawDescription(), partKinds());
  if (!p.ok) throw new Error(p.error);
  return p.value;
};
function fakePhoto(w: number, h: number): string {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).copy(b, 0);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return `data:image/png;base64,${b.toString('base64')}`;
}
const flat = (): Raster => {
  const w = 60, h = 40;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([120, 110, 100, 255], i * 4);
  return { width: w, height: h, data };
};
class PhotoHost extends MemoryHost {
  async captureReview(views: readonly ReviewViewRequest[]): Promise<Array<{ name: string; dataUrl: string }>> {
    return views.map((v) => ({ name: v.name, dataUrl: `data:image/png;base64,${Buffer.from(`render|${v.name}|0`).toString('base64')}` }));
  }
  async decodeImage(): Promise<Raster | null> { return flat(); }
}
type Reply = (req: CompletionRequest, n: number) => ContentBlock[];
function scripted(replies: Reply[]): Provider & { requests: CompletionRequest[] } {
  const requests: CompletionRequest[] = [];
  let i = 0;
  return {
    name: 'scripted',
    requests,
    async complete(req): Promise<CompletionResponse> {
      requests.push(JSON.parse(JSON.stringify(req)) as CompletionRequest);
      const r = replies[Math.min(i, replies.length - 1)];
      const content = r ? r(req, i) : [{ type: 'text', text: 'done' } as ContentBlock];
      i++;
      return { content, stopReason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end', model: 'fake-vision' };
    },
  };
}
let n = 0;
const call = (name: string, input: unknown): ContentBlock => ({ type: 'tool_use', id: `t${++n}`, name, input });

describe('the perception layer in the photo flow', () => {
  it('puts the measurements into the first reading, offers perceive_photo, and returns its result to the model', async () => {
    const { deps: d } = deps();
    const shared = new Perceiver(d);
    // every Perceiver the flow makes answers from the one built on the synthetic photo
    const realRun = Perceiver.prototype.run;
    const realOverlay = Perceiver.prototype.overlay;
    const spyRun = vi.spyOn(Perceiver.prototype, 'run').mockImplementation(function (opt) { return realRun.call(shared, opt); });
    const spyOverlay = vi.spyOn(Perceiver.prototype, 'overlay').mockImplementation(() => realOverlay.call(shared));
    const saved = process.env['AETHER_PERCEPTION'];
    process.env['AETHER_PERCEPTION'] = '';
    try {
      const verdicts: Reply = () => [call('report_verdicts', { verdicts: buildChecklist(description()).map((c) => ({ id: c.id, pass: true })), summary: 'ok' })];
      const provider = scripted([() => [call('describe_room', { description: rawDescription() })], () => [call('perceive_photo', { find: ['lamp'] })], verdicts, () => [call('finish', { message: 'done' })]]);
      const agent = new WorldAgent({ provider, catalogs: TEST_CATALOGS, maxTurns: 10, photo: { judges: 0, reads: 1, harness: true, perception: true } });
      const evs: AgentEvent[] = await collect(agent.run('make this bedroom in 3d', new PhotoHost(), { images: [fakePhoto(1920, 1280)] }));
      // 1. the first reading carries the report text and the annotated picture
      const first = provider.requests[0]?.messages[0]?.content as ContentBlock[];
      const text = first.filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n');
      expect(text).toContain('Perception report');
      expect(text).toContain('a label can be wrong');
      expect(first.filter((b) => b.type === 'image').length).toBeGreaterThanOrEqual(2);
      expect(evs.some((e) => e.type === 'step' && e.tool === 'perceive_photo' && e.ok === true)).toBe(true);
      // 2. the tool is offered in the compare round, and its result is in the next request
      const tools = provider.requests.flatMap((r) => (r.tools ?? []).map((t) => t.name));
      expect(tools).toContain('perceive_photo');
      const resultSeen = provider.requests.some((r) => r.messages.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result' && typeof b.content === 'string' && b.content.includes('Perception report') && /Asked for but no box found:.*lamp/.test(b.content))));
      expect(resultSeen).toBe(true);
      // 3. the final resume state keeps the report (versioned, resume-safe)
      const done = evs.filter((e): e is Extract<AgentEvent, { type: 'photo' }> => e.type === 'photo').find((e) => e.phase === 'done');
      const kept = (done?.resume as { perception?: PerceptionReport } | undefined)?.perception;
      expect(kept?.version).toBe(2);
      expect(kept?.objects.length).toBeGreaterThan(0);
    } finally {
      spyRun.mockRestore();
      spyOverlay.mockRestore();
      if (saved === undefined) delete process.env['AETHER_PERCEPTION'];
      else process.env['AETHER_PERCEPTION'] = saved;
    }
  });

  it('with AETHER_PERCEPTION=off nothing is measured even when the option is set', async () => {
    const spyRun = vi.spyOn(Perceiver.prototype, 'run');
    try {
      const provider = scripted([() => [call('describe_room', { description: rawDescription() })], () => [call('report_verdicts', { verdicts: buildChecklist(description()).map((c) => ({ id: c.id, pass: true })), summary: 'ok' })], () => [call('finish', { message: 'done' })]]);
      const agent = new WorldAgent({ provider, catalogs: TEST_CATALOGS, maxTurns: 10, photo: { judges: 0, reads: 1, harness: true, perception: true } });
      await collect(agent.run('make this bedroom in 3d', new PhotoHost(), { images: [fakePhoto(1920, 1280)] }));
      expect(spyRun).not.toHaveBeenCalled();
    } finally {
      spyRun.mockRestore();
    }
  });

  it('without the option nothing is measured and the tool is not offered', async () => {
    const spyRun = vi.spyOn(Perceiver.prototype, 'run');
    try {
      const provider = scripted([() => [call('describe_room', { description: rawDescription() })], () => [call('report_verdicts', { verdicts: buildChecklist(description()).map((c) => ({ id: c.id, pass: true })), summary: 'ok' })], () => [call('finish', { message: 'done' })]]);
      const agent = new WorldAgent({ provider, catalogs: TEST_CATALOGS, maxTurns: 10, photo: { judges: 0, reads: 1, harness: true } });
      await collect(agent.run('make this bedroom in 3d', new PhotoHost(), { images: [fakePhoto(1920, 1280)] }));
      expect(spyRun).not.toHaveBeenCalled();
      expect(provider.requests.flatMap((r) => (r.tools ?? []).map((t) => t.name))).not.toContain('perceive_photo');
    } finally {
      spyRun.mockRestore();
    }
  });
});

describe('second-pass labels (CLIP) and duplicate merging', () => {
  let VOC: Awaited<ReturnType<typeof clipVocabulary>> = [];
  beforeAll(async () => { VOC = await clipVocabulary(); });
  const vocabEmb = (variant: string): Float32Array => VOC.find((x) => x.variant === variant)?.emb as Float32Array;
  it('classifies a vocabulary embedding as its own label, with synonyms summed', () => {
    const g = classifyEmbedding(VOC, vocabEmb('bunk bed'));
    expect(g[0]?.label).toBe('bed');
    expect(g[0]?.p).toBeGreaterThan(0.5);
    expect(g.reduce((a, b) => a + b.p, 0)).toBeCloseTo(1, 5);
  });
  it('builds a 224 x 224 input, padded to a square', () => {
    const s = synth();
    const x = clipInput(s.raster, { box: [0.2, 0.3, 0.6, 0.7] });
    expect(x.length).toBe(3 * 224 * 224);
    expect(Number.isFinite(x[100])).toBe(true);
  });
  it('changes a label only when CLIP is sure of another object and gives the detector noun almost nothing; keeps a plausible one', async () => {
    const { deps: d } = deps({ clip: async () => ({ ok: true, model: { async embed(_r, crops) { return crops.map(() => vocabEmbOf('bed')); }, async dispose() {} } }) });
    function vocabEmbOf(v: string): Float32Array { return vocabEmb(v); }
    const p = new Perceiver(d);
    const rep = (await p.run({ find: [] })) as PerceptionReport;
    const o = rep.objects.find((x) => x.detectorLabel);
    // the mocked detector says "chair"; CLIP (mock) says bed with high probability and almost none for chair
    expect(o?.label).toBe('bed');
    expect(o?.detectorLabel).toBe('chair');
    expect(o?.labelConfidence).toBeGreaterThan(0.45);
    expect(rep.models.labeller).toMatch(/CLIP/);
    const q = new Perceiver(deps({ clip: async () => ({ ok: true, model: { async embed(_r, crops) { return crops.map(() => vocabEmb('chair')); }, async dispose() {} } }) }).deps);
    const rep2 = (await q.run({ find: [] })) as PerceptionReport;
    expect(rep2.objects.find((x) => x.label === 'chair')?.detectorLabel).toBeUndefined();
  });
  it('merges the same object found by two prompts', async () => {
    const s = deps({});
    const d = s.deps;
    d.detector = async () => ({ ok: true, model: { async setImage() {}, async detect(task) { return task === '<OD>' ? [{ label: 'chair', box: s.obstacleBox, confidence: 0.8 }, { label: 'chair', box: s.obstacleBox, confidence: 0.6 }] : []; }, async caption() { return ''; }, async dispose() {} } });
    const rep = (await new Perceiver(d).run({ find: [] })) as PerceptionReport;
    expect(rep.objects.filter((o) => o.label === 'chair').length).toBe(1);
  });
});
