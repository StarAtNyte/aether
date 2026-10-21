import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_CHECKLIST_ITEMS, MAX_PHOTO_ITEMS, MAX_PHOTO_OPENINGS, MAX_VERDICTS, PHOTO_BUILDING_ID, buildChecklist, parseRoomDescription, type RoomDescription } from '@aether/arch/photo';
import { partKinds, readScene } from '@aether/arch';
import { WorldAgent } from '../src/agent';
import { createMockProvider } from '../src/providers/mock/index';
import type { Raster } from '../src/photo/score';
import { isRoomPhotoRequest } from '../src/photo/pipeline';
import { JUDGE_SEED, JUDGE_TOOL, parseJudgement } from '../src/photo/judge';
import { VERDICT_TOOL } from '../src/photo/prompt';
import type { AgentEvent, CompletionRequest, CompletionResponse, ContentBlock, Provider, ReviewViewRequest, ToolDef } from '../src/types';
import { collect, MemoryHost, TEST_CATALOGS } from './helpers';

const FIXTURE = resolve(__dirname, '../../../tests/fixtures/photo/hotel.description.json');
const rawDescription = (): Record<string, unknown> => JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>;
const description = (): RoomDescription => {
  const p = parseRoomDescription(rawDescription(), partKinds());
  if (!p.ok) throw new Error(p.error);
  return p.value;
};

/** A PNG data URL whose header says `w`×`h` (the body is not a real image: nothing here decodes it). */
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

/** A host that renders fake images: the photo-camera render drifts away from the photo by `drift[call]`. */
class PhotoHost extends MemoryHost {
  captures: Array<{ names: string[]; aspect: number }> = [];
  drift: number[] = [0];
  private calls = 0;
  async captureReview(views: readonly ReviewViewRequest[]): Promise<Array<{ name: string; dataUrl: string }>> {
    this.captures.push({ names: views.map((v) => v.name), aspect: views[0]?.aspect ?? 0 });
    if (views.some((v) => v.name === 'photo-camera')) this.calls++;
    const d = this.drift[Math.min(this.calls - 1, this.drift.length - 1)] ?? 0;
    return views.map((v) => ({ name: v.name, dataUrl: `data:image/png;base64,${Buffer.from(`render|${v.name}|${d}`).toString('base64')}` }));
  }
  async decodeImage(dataUrl: string): Promise<Raster | null> {
    if (dataUrl.startsWith('data:image/png;base64,iVBOR')) return raster(0);
    const text = Buffer.from(dataUrl.split(',')[1] ?? '', 'base64').toString();
    const m = /^render\|[^|]+\|(\d+)$/.exec(text);
    return m ? raster(Number(m[1])) : null;
  }
}

type Reply = (req: CompletionRequest, n: number) => ContentBlock[];

/** The conversation is scripted turn by turn; the independent judges (role critic) are answered by `judge`. */
function scripted(replies: Reply[], judge?: (req: CompletionRequest) => ContentBlock[]): Provider & { requests: CompletionRequest[]; judged: CompletionRequest[] } {
  const requests: CompletionRequest[] = [];
  const judged: CompletionRequest[] = [];
  let i = 0;
  return {
    name: 'scripted',
    requests,
    judged,
    async complete(req): Promise<CompletionResponse> {
      if (req.role === 'critic' && judge) {
        judged.push(JSON.parse(JSON.stringify(req)) as CompletionRequest);
        const content = judge(req);
        return { content, stopReason: 'tool_use', model: 'fake-judge' };
      }
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
const describeCall = (d: unknown = rawDescription()): Reply => () => [call('describe_room', { description: d })];
const verdicts = (fail: string[], note = 'differs'): Reply => () => [
  call('report_verdicts', { verdicts: buildChecklist(description()).map((c) => ({ id: c.id, pass: !fail.includes(c.id), ...(fail.includes(c.id) ? { note } : {}) })), summary: 'ok' }),
];
const finish: Reply = () => [call('finish', { message: 'done' })];

/** These tests script the conversation turn by turn, so the model in it judges (no panel) and the photo is read once; the panel and the merged reads have their own tests below. */
function agent(provider: Provider, photo: ConstructorParameters<typeof WorldAgent>[0]['photo'] = {}): WorldAgent {
  return new WorldAgent({ provider, catalogs: TEST_CATALOGS, maxTurns: 10, photo: { judges: 0, reads: 1, ...photo } });
}

const photoEvents = (events: AgentEvent[]): Array<Extract<AgentEvent, { type: 'photo' }>> => events.filter((e): e is Extract<AgentEvent, { type: 'photo' }> => e.type === 'photo');

describe('verdict limits', () => {
  it('advertise the same maximum the parsers enforce, and it covers the longest checklist', () => {
    const raw = rawDescription();
    const opening = (raw['openings'] as Array<Record<string, unknown>>)[0] ?? {};
    const item = (raw['items'] as Array<Record<string, unknown>>)[0] ?? {};
    const walls = ['north', 'east', 'south', 'west'] as const;
    raw['openings'] = Array.from({ length: MAX_PHOTO_OPENINGS }, (_, i) => ({ ...opening, id: `win-${i}`, wall: walls[i % 4], along: 0.6 + Math.floor(i / 4) * 0.5, width: 0.4 }));
    raw['items'] = Array.from({ length: MAX_PHOTO_ITEMS }, (_, i) => ({ ...item, id: `piece-${i}`, kind: 'stool', at: [0.5 + (i % 9) * 0.4, 0.5 + Math.floor(i / 9) * 0.4], wall: undefined, along: undefined }));
    const parsed = parseRoomDescription(raw, partKinds());
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.value.openings.length).toBe(MAX_PHOTO_OPENINGS);
    expect(parsed.value.items.length).toBe(MAX_PHOTO_ITEMS);
    const list = buildChecklist(parsed.value);
    expect(list.length).toBeGreaterThan(MAX_PHOTO_OPENINGS + MAX_PHOTO_ITEMS);
    expect(list.length).toBeLessThanOrEqual(MAX_CHECKLIST_ITEMS);
    expect(MAX_CHECKLIST_ITEMS).toBeLessThanOrEqual(MAX_VERDICTS);
    const maxOf = (t: ToolDef): unknown => (t.inputSchema as { properties: { verdicts: { maxItems: unknown } } }).properties.verdicts.maxItems;
    expect(maxOf(VERDICT_TOOL)).toBe(MAX_VERDICTS);
    expect(maxOf(JUDGE_TOOL)).toBe(MAX_VERDICTS);
    const verdict = { id: 'item-x', a: 3, evidence: 'the photo and the render agree' };
    const known = new Set(['item-x']);
    expect(parseJudgement({ verdicts: Array.from({ length: MAX_VERDICTS }, () => verdict) }, known, 'single')).not.toBeNull();
    expect(parseJudgement({ verdicts: Array.from({ length: MAX_VERDICTS + 1 }, () => verdict) }, known, 'single')).toBeNull();
  });

  it('rejects a report_verdicts call longer than the advertised maximum', async () => {
    const host = new PhotoHost();
    const tooMany = (): ContentBlock[] => [call('report_verdicts', { verdicts: Array.from({ length: MAX_VERDICTS + 1 }, (_, i) => ({ id: `item-${i}`, pass: true })) })];
    const provider = scripted([describeCall(), tooMany, verdicts([]), finish]);
    await collect(agent(provider).run('recreate this room', host, { images: [fakePhoto(1200, 1600)] }));
    const results = provider.requests.flatMap((r) => r.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []))).filter((b): b is Extract<ContentBlock, { type: 'tool_result' }> => b.type === 'tool_result');
    expect(results.some((r) => r.isError === true && r.content.includes(`at most ${MAX_VERDICTS}`))).toBe(true);
  });
});

describe('what counts as a request for the room in a picture', () => {
  it('needs a picture and a prompt about a room', () => {
    expect(isRoomPhotoRequest('make this bedroom in 3d', 1, false)).toBe(true);
    expect(isRoomPhotoRequest('recreate this room', 1, false)).toBe(true);
    expect(isRoomPhotoRequest('make this bedroom in 3d', 0, false)).toBe(false);
    expect(isRoomPhotoRequest('a castle on a hill', 1, false)).toBe(false);
    expect(isRoomPhotoRequest('x', 1, true)).toBe(true);
    expect(isRoomPhotoRequest('a dragon', 1, false)).toBe(false);
  });
});

describe('room from a photo, with a vision model', () => {
  it('reads the photo, builds the described room through the tools, compares, fixes, and ends with every item passing', async () => {
    const provider = scripted([
      describeCall(),
      verdicts(['item-picture-left', 'cornice'], 'the picture hangs too low'),
      () => [call('edit_items', { edits: [{ op: 'move', ref: 'picture-left', wall: 'north', t: 2.24 }] })],
      verdicts([]),
      finish,
    ]);
    // After round 1 the model reports two failures and fixes one in a second turn; round 2 passes everything.
    const host = new PhotoHost();
    const events = await collect(agent(provider).run('make this bedroom in 3d', host, { images: [fakePhoto(1920, 1280)] }));
    const photo = photoEvents(events);
    expect(photo.map((e) => e.phase)).toEqual(expect.arrayContaining(['analysing', 'described', 'building', 'built', 'comparing', 'round', 'done']));
    // The assumptions are listed with a one-tap adjust sentence each.
    const described = photo.find((e) => e.phase === 'described');
    expect(described?.assumptions?.length).toBeGreaterThanOrEqual(2);
    expect(described?.assumptions?.some((a) => a.adjust.length > 0)).toBe(true);
    // The room is the described room: shell at the described size, window west, bed on the north wall, curtains anchored.
    const scene = readScene(host.world, PHOTO_BUILDING_ID);
    expect(scene).not.toBeNull();
    const room = scene?.rooms[0];
    expect(room?.walls.find((w) => w.compass === 'west')?.openings.some((o) => o.kind === 'window')).toBe(true);
    expect(scene?.items.filter((i) => i.kind === 'curtain')).toHaveLength(2);
    expect(scene?.items.find((i) => i.kind === 'bed')?.against?.[0]?.compass).toBe('north');
    // The loop ended with a measured, honest score.
    const done = photo.find((e) => e.phase === 'done');
    expect(done?.score?.passed).toBe(done?.score?.total);
    expect(events.some((e) => e.type === 'verify')).toBe(true);
    // Renders were made from the photo's camera at the photo's aspect (1920 / 1280 = 1.5), plus a clean one to measure.
    expect(host.captures[0]?.names).toContain('photo-camera');
    expect(host.captures[0]?.aspect).toBeCloseTo(1.5, 2);
    expect(host.captures.some((c) => c.names.includes('photo-camera-clean'))).toBe(true);
    // Framing against the boxes the description gives is measured, fitted and reported to the model.
    expect(photo.some((e) => e.phase === 'round' && /measured fidelity \d+% \(framing \d+/.test(e.text))).toBe(true);
    expect(JSON.stringify(provider.requests[1]?.messages)).toContain('Framing');
    // The first compare message carries the photo and the render; the second drops the first round's images.
    const first = provider.requests[1]?.messages.at(-1);
    expect(Array.isArray(first?.content) && first.content.filter((b) => b.type === 'image').length).toBeGreaterThanOrEqual(2);
    // The analysis call carried the specification and the photo; no tool but describe_room was offered.
    expect(provider.requests[0]?.tools?.map((t) => t.name)).toEqual(['describe_room']);
    const spec = JSON.stringify(provider.requests[0]?.messages);
    expect(spec).toContain('along');
    expect(spec).toContain('bed [floor');
  });

  it('moves the exposure and the colour grade of the world towards the photo (warm and bright) when the render is dim and neutral', async () => {
    const picture = (light: [number, number, number], e: number): Raster => {
      const w = 60;
      const h = 40;
      const data = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        const c = x > 24 ? 235 : y > 28 ? 80 : 150;
        for (let k = 0; k < 3; k++) data[o + k] = Math.min(255, c * light[k]! * e);
        data[o + 3] = 255;
      }
      return { width: w, height: h, data };
    };
    class Dim extends PhotoHost {
      override async decodeImage(dataUrl: string): Promise<Raster | null> {
        return dataUrl.startsWith('data:image/png;base64,iVBOR') ? picture([1, 0.85, 0.6], 1) : picture([1, 1, 1], 0.45);
      }
    }
    const host = new Dim();
    const before = host.world.environment.exposure;
    const provider = scripted([describeCall(), verdicts([]), finish]);
    await collect(agent(provider).run('make this bedroom in 3d', host, { images: [fakePhoto(1920, 1280)] }));
    const env = host.world.environment;
    expect(env.exposure).toBeGreaterThan(before);
    expect(env.grade?.temperature ?? 0).toBeGreaterThan(0.05);
    expect(env.grade?.temperature ?? 0).toBeLessThanOrEqual(1);
  });

  it('leaves the exposure and the grade alone when the render already matches the photo', async () => {
    const host = new PhotoHost();
    const before = host.world.environment;
    await collect(agent(scripted([describeCall(), verdicts([]), finish])).run('make this bedroom in 3d', host, { images: [fakePhoto(1920, 1280)] }));
    expect(host.world.environment.exposure).toBe(before.exposure);
    expect(host.world.environment.grade).toBeUndefined();
  });

  it('refuses to edit before judging, and applies a fix in the same reply as the verdicts', async () => {
    const provider = scripted([
      describeCall(),
      () => [call('edit_items', { edits: [{ op: 'move', ref: 'picture-left', wall: 'north', t: 2.0 }] })],
      () => [
        call('edit_items', { edits: [{ op: 'move', ref: 'picture-left', wall: 'north', t: 2.3 }] }),
        call('report_verdicts', { verdicts: buildChecklist(description()).map((c) => ({ id: c.id, pass: c.id !== 'item-picture-left', note: 'low' })) }),
      ],
      verdicts([]),
    ]);
    const host = new PhotoHost();
    await collect(agent(provider).run('recreate this room', host, { images: [fakePhoto(1200, 1600)] }));
    const second = provider.requests[2]?.messages.at(-1);
    const text = JSON.stringify(second?.content);
    expect(text).toContain('Judge first');
    // The verdict came first in the next reply (sorted), so the edit in it was applied.
    const pic = readScene(host.world, PHOTO_BUILDING_ID)?.items.find((i) => i.id.endsWith('picture-left'));
    expect(pic?.wall?.t).toBeCloseTo(2.3, 1);
  });

  it('rolls the room back when a round makes it worse', async () => {
    const all = buildChecklist(description()).map((c) => c.id);
    const mostlyFail = all.filter((id) => id !== 'shell-size').slice(0, 14);
    const provider = scripted([
      describeCall(),
      verdicts(['item-picture-left']),
      () => [call('edit_items', { edits: [{ op: 'remove', ref: 'tv' }, { op: 'remove', ref: 'picture-right' }] })],
      // Round 2: much worse; the host rolls back before applying anything else.
      verdicts(mostlyFail),
      () => [call('edit_items', { edits: [{ op: 'remove', ref: 'bed' }] })],
      verdicts([]),
      finish,
    ]);
    const host = new PhotoHost();
    host.drift = [0, 0, 0, 0];
    const events = await collect(agent(provider, { maxRounds: 3 }).run('recreate this room', host, { images: [fakePhoto(1920, 1280)] }));
    const msgs = photoEvents(events).map((e) => e.text).join('\n');
    expect(msgs).toContain('back to round 1');
    const scene = readScene(host.world, PHOTO_BUILDING_ID);
    // The room is the round-1 room: tv and the right picture are back, and the bed was never removed.
    expect(scene?.items.some((i) => i.kind === 'tv-set')).toBe(true);
    expect(scene?.items.filter((i) => i.kind === 'art')).toHaveLength(2);
    expect(scene?.items.some((i) => i.kind === 'bed')).toBe(true);
  });

  it('stops at the round cap and reports the measured final state, judging the last edits before keeping them', async () => {
    const provider = scripted([
      describeCall(),
      verdicts(['floor']),
      () => [call('edit_items', { edits: [{ op: 'move', ref: 'picture-left', wall: 'north', t: 2.1 }] })],
      // The final check after the cap.
      verdicts([]),
    ]);
    const host = new PhotoHost();
    const events = await collect(agent(provider, { maxRounds: 1 }).run('recreate this room', host, { images: [fakePhoto(1920, 1280)] }));
    const msgs = photoEvents(events);
    expect(msgs.some((e) => e.text.startsWith('Final check'))).toBe(true);
    const done = msgs.find((e) => e.phase === 'done');
    expect(done?.score?.passed).toBe(done?.score?.total);
  });

  it('says why when the description is refused three times and builds nothing', async () => {
    const bad = { ...rawDescription(), footprint: { width: 300, depth: 4, ceiling: 2.7 } };
    const provider = scripted([describeCall(bad)]);
    const host = new PhotoHost();
    const events = await collect(agent(provider).run('make this bedroom in 3d', host, { images: [fakePhoto(1920, 1280)] }));
    expect(events.some((e) => e.type === 'error' && /footprint/.test(e.text))).toBe(true);
    expect(Object.keys(host.world.entities)).toHaveLength(0);
    // The refusal was sent back to the model each time.
    expect(provider.requests).toHaveLength(3);
    expect(JSON.stringify(provider.requests[1]?.messages)).toContain('refused');
  });

  it('surfaces the real reason when the provider fails', async () => {
    const provider: Provider = {
      name: 'broken',
      async complete(): Promise<CompletionResponse> {
        throw new Error('You have hit your usage limit. Try again at 9:59 PM.');
      },
    };
    const events = await collect(agent(provider).run('make this bedroom in 3d', new PhotoHost(), { images: [fakePhoto(1920, 1280)] }));
    const err = events.find((e) => e.type === 'error');
    expect(err && 'text' in err ? err.text : '').toContain('usage limit');
  });

  it('keeps the room it built when the assistant becomes unavailable during the comparison', async () => {
    let calls = 0;
    const provider: Provider = {
      name: 'flaky',
      async complete(): Promise<CompletionResponse> {
        calls++;
        if (calls === 1) return { content: [call('describe_room', { description: rawDescription() })], stopReason: 'tool_use' };
        throw new Error('connection reset');
      },
    };
    const host = new PhotoHost();
    const events = await collect(agent(provider).run('make this bedroom in 3d', host, { images: [fakePhoto(1920, 1280)] }));
    expect(readScene(host.world, PHOTO_BUILDING_ID)?.items.length).toBeGreaterThan(8);
    expect(events.some((e) => e.type === 'error' && /connection reset/.test(e.text))).toBe(true);
  });

  it('builds without comparing when the host cannot render, and says so', async () => {
    const provider = scripted([describeCall()]);
    const host = new MemoryHost();
    const events = await collect(agent(provider).run('make this bedroom in 3d', host, { images: [fakePhoto(1920, 1280)] }));
    expect(photoEvents(events).some((e) => e.phase === 'unavailable')).toBe(true);
    expect(readScene(host.world, PHOTO_BUILDING_ID)?.items.length).toBeGreaterThan(8);
    expect(events.some((e) => e.type === 'message' && /not compared/.test(e.text))).toBe(true);
  });
});

const imageCount = (req: CompletionRequest): number => req.messages.reduce((n, m) => n + (typeof m.content === 'string' ? 0 : m.content.filter((b) => b.type === 'image').length), 0);

/**
 * A judge that scores every item 4 (those in `fail` 1) and, shown two renders, prefers `prefer`. It reads the seat's
 * A/B order from its seed, as the panel alternates it.
 */
function judgeReply(prefer: 'current' | 'previous' | 'same', fail: readonly string[] = []): (req: CompletionRequest) => ContentBlock[] {
  return (req) => {
    const pair = imageCount(req) === 3;
    const currentFirst = ((req.seed ?? JUDGE_SEED) - JUDGE_SEED) % 2 === 0;
    const cur = (id: string): number => (fail.includes(id) ? 1 : 4);
    const prev = (id: string): number => (prefer === 'previous' ? 4 : prefer === 'current' ? Math.max(0, cur(id) - 1) : cur(id));
    const verdicts = buildChecklist(description()).map((c) => ({
      id: c.id,
      a: pair && !currentFirst ? prev(c.id) : cur(c.id),
      ...(pair ? { b: currentFirst ? prev(c.id) : cur(c.id) } : {}),
      evidence: `photo: ${c.id}; render: ${fail.includes(c.id) ? 'differs' : 'same'}`,
    }));
    const closer = prefer === 'same' ? 'same' : (prefer === 'current') === currentFirst ? 'A' : 'B';
    return [call('report_judgement', { verdicts, ...(pair ? { closer } : {}) })];
  };
}

describe('room from a photo, with a panel of independent judges', () => {
  const panelAgent = (provider: Provider, photo: ConstructorParameters<typeof WorldAgent>[0]['photo'] = {}): WorldAgent => new WorldAgent({ provider, catalogs: TEST_CATALOGS, maxTurns: 10, photo: { judges: 3, reads: 1, ...photo } });

  it('the judges look first (stateless, temperature 0, a fixed seed per seat, the same clean view), the model fixes, and a fix they prefer is kept', async () => {
    const provider = scripted(
      [describeCall(), () => [call('edit_items', { edits: [{ op: 'move', ref: 'picture-left', wall: 'north', t: 2.3 }] })], finish],
      judgeReply('current', []),
    );
    const host = new PhotoHost();
    const events = await collect(panelAgent(provider, { maxRounds: 3 }).run('make this bedroom in 3d', host, { images: [fakePhoto(1920, 1280)] }));
    // Three judges per look: the first look scores one render, the second compares the new one with the accepted one.
    expect(provider.judged.length).toBe(6);
    for (const r of provider.judged) {
      expect(r.role).toBe('critic');
      expect(r.session).toBeUndefined();
      expect(r.temperature).toBe(0);
      expect(r.tools?.map((t) => t.name)).toEqual(['report_judgement']);
    }
    expect(provider.judged.slice(0, 3).map((r) => r.seed)).toEqual([JUDGE_SEED, JUDGE_SEED + 1, JUDGE_SEED + 2]);
    expect(provider.judged.slice(0, 3).map(imageCount)).toEqual([2, 2, 2]);
    expect(provider.judged.slice(3).map(imageCount)).toEqual([3, 3, 3]);
    // The judges see the clean photo-camera render (no numbered marks), the same view every round.
    expect(host.captures.every((c) => c.names.includes('photo-camera-clean'))).toBe(true);
    // The model got their consensus and the measured differences; it never had to report verdicts itself.
    const first = JSON.stringify(provider.requests[1]?.messages);
    expect(first).toContain('Independent judges (3');
    expect(first).toContain('measured fidelity');
    // The fix was kept, and the score the UI shows carries both signals.
    const pic = readScene(host.world, PHOTO_BUILDING_ID)?.items.find((i) => i.id.endsWith('picture-left'));
    expect(pic?.wall?.t).toBeCloseTo(2.3, 1);
    const done = photoEvents(events).find((e) => e.phase === 'done');
    expect(done?.score?.judges).toBe(3);
    expect(done?.score?.judge).toBe(1);
    expect(done?.score?.fidelity?.inventory).toBeGreaterThan(0.9);
    expect(done?.score?.objective).toBeGreaterThan(0.5);
    expect(done?.score?.combined).toBeGreaterThan(0.5);
    expect(photoEvents(events).some((e) => e.phase === 'round' && e.score?.preference === 'current')).toBe(true);
  });

  it('a change the judges do not prefer is rolled back before the model sees the round', async () => {
    let looks = 0;
    const judge = (req: CompletionRequest): ContentBlock[] => {
      if (imageCount(req) === 2) return judgeReply('same', ['item-picture-left'])(req);
      looks++;
      return judgeReply('previous', ['item-picture-left'])(req);
    };
    const provider = scripted([describeCall(), () => [call('edit_items', { edits: [{ op: 'move', ref: 'picture-left', wall: 'north', t: 2.3 }] })], finish], judge);
    const host = new PhotoHost();
    const before = (await (async () => {
      const h = new PhotoHost();
      await collect(panelAgent(scripted([describeCall(), finish], judgeReply('same')), { maxRounds: 1 }).run('make this bedroom in 3d', h, { images: [fakePhoto(1920, 1280)] }));
      return readScene(h.world, PHOTO_BUILDING_ID)?.items.find((i) => i.id.endsWith('picture-left'))?.pos;
    })()) as [number, number, number];
    const events = await collect(panelAgent(provider, { maxRounds: 2 }).run('make this bedroom in 3d', host, { images: [fakePhoto(1920, 1280)] }));
    expect(looks).toBeGreaterThan(0);
    expect(photoEvents(events).some((e) => /was not kept \(the judges found the accepted state closer/.test(e.text))).toBe(true);
    const moved = readScene(host.world, PHOTO_BUILDING_ID)?.items.find((i) => i.id.endsWith('picture-left'));
    expect(moved?.pos[0]).toBeCloseTo(before[0], 3);
    expect(moved?.pos[2]).toBeCloseTo(before[2], 3);
    // The model was told, and shown the accepted state.
    expect(JSON.stringify(provider.requests.at(-1)?.messages)).toContain('rolled back');
  });

  it('the measures veto a change that loses pieces, even when the judges like it', async () => {
    const provider = scripted([describeCall(), () => [call('edit_items', { edits: [{ op: 'remove', ref: 'tv' }, { op: 'remove', ref: 'picture-right' }] })], finish], judgeReply('current'));
    const host = new PhotoHost();
    const events = await collect(panelAgent(provider, { maxRounds: 2 }).run('make this bedroom in 3d', host, { images: [fakePhoto(1920, 1280)] }));
    expect(photoEvents(events).some((e) => /not kept \(the measured (inventory|fidelity)/.test(e.text))).toBe(true);
    const scene = readScene(host.world, PHOTO_BUILDING_ID);
    expect(scene?.items.some((i) => i.kind === 'tv-set')).toBe(true);
    expect(scene?.items.filter((i) => i.kind === 'art')).toHaveLength(2);
  });

  it('falls back to the model in the conversation when no judge answers', async () => {
    const provider = scripted([describeCall(), verdicts([]), finish], () => [{ type: 'text', text: 'I would rather not.' }]);
    const host = new PhotoHost();
    const events = await collect(panelAgent(provider).run('make this bedroom in 3d', host, { images: [fakePhoto(1920, 1280)] }));
    const done = photoEvents(events).find((e) => e.phase === 'done');
    expect(done?.score?.passed).toBe(done?.score?.total);
    expect(done?.score?.judges).toBeUndefined();
  });
});

describe('the room replaces the world', () => {
  it('clears what was there (one undo step) unless the user is refining, then builds the room', async () => {
    const start = { op: 'add', entity: { id: 'old-tree', name: 'Old tree', shape: { kind: 'primitive', primitive: 'cone', size: [1, 2, 1] }, transform: { position: [9, 1, 9] } } };
    const run = async (intent: 'auto' | 'refine'): Promise<MemoryHost> => {
      const host = new PhotoHost();
      host.applyPatches([start], 'seed');
      await collect(agent(scripted([describeCall(), verdicts([]), finish])).run('make this bedroom in 3d', host, { images: [fakePhoto(1920, 1280)], photo: 'recreate', intent }));
      return host;
    };
    const replaced = await run('auto');
    expect(replaced.world.entities['old-tree']).toBeUndefined();
    expect(replaced.commits.map((c) => c.message)).toContain('Clear the world for the room from the photo');
    expect(readScene(replaced.world, PHOTO_BUILDING_ID)?.items.length).toBeGreaterThan(8);
    // Named after the room, without the starter's outdoor weather.
    expect(replaced.world.name).toMatch(/from a photo$/);
    expect(replaced.world.environment.weather).toBe('clear');
    const beside = await run('refine');
    expect(beside.world.entities['old-tree']).toBeDefined();
  });
});

describe('room from a photo, without a vision model', () => {
  it('does not build a random room: it extracts the palette, says why and offers text', async () => {
    const host = new PhotoHost();
    const events = await collect(agent(createMockProvider()).run('make this bedroom in 3d', host, { images: [fakePhoto(1920, 1280)] }));
    const off = photoEvents(events).find((e) => e.phase === 'offline');
    expect(off).toBeTruthy();
    expect(off?.text).toMatch(/needs a connected assistant/);
    expect(off?.text).toMatch(/describe the room in words/);
    expect(off?.palette?.length).toBeGreaterThan(0);
    expect(Object.keys(host.world.entities)).toHaveLength(0);
  });

  it('does the same when the connected assistant cannot see images', async () => {
    const provider = scripted([describeCall()]);
    const host = new PhotoHost();
    const events = await collect(agent(provider, { vision: false }).run('make this bedroom in 3d', host, { images: [fakePhoto(1920, 1280)] }));
    expect(photoEvents(events).some((e) => e.phase === 'offline' && /cannot look at images/.test(e.text))).toBe(true);
    expect(provider.requests).toHaveLength(0);
    expect(Object.keys(host.world.entities)).toHaveLength(0);
  });

  it('treats the offline planner that took over mid-run as unavailable, not as an answer', async () => {
    const chain: Provider = { name: 'mock', async complete() { return createMockProvider().complete({ role: 'planner', system: '', messages: [{ role: 'user', content: 'x' }] }); } };
    const host = new PhotoHost();
    const events = await collect(agent(chain).run('recreate this room', host, { images: [fakePhoto(1920, 1280)], photo: 'recreate' }));
    expect(photoEvents(events).some((e) => e.phase === 'offline')).toBe(true);
    expect(Object.keys(host.world.entities)).toHaveLength(0);
  });

  it('an agent without photo options goes through the normal planner for a picture, unless asked to recreate it', async () => {
    const provider = scripted([() => [{ type: 'text', text: 'nothing to do' }]]);
    const plain = new WorldAgent({ provider, catalogs: TEST_CATALOGS, maxTurns: 2 });
    await collect(plain.run('make this bedroom in 3d', new PhotoHost(), { images: [fakePhoto(1920, 1280)] }));
    expect(provider.requests[0]?.tools?.map((t) => t.name)).not.toEqual(['describe_room']);
    const off = await collect(agent(provider).run('make this bedroom in 3d', new PhotoHost(), { images: [fakePhoto(1920, 1280)], photo: 'off' }));
    expect(photoEvents(off)).toHaveLength(0);
  });
});
