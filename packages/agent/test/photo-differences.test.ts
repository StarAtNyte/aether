import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildChecklist, parseRoomDescription, type RoomDescription } from '@aether/arch/photo';
import { partKinds } from '@aether/arch';
import { WorldAgent } from '../src/agent';
import { DIFFERENCES_TOOL, DifferenceLedger } from '../src/photo/differences';
import { cropRegions, regionReadout } from '../src/photo/kit';
import { CROSSCHECK_SEED } from '../src/photo/prompt';
import type { Raster } from '../src/photo/score';
import type { AgentEvent, CompletionRequest, CompletionResponse, ContentBlock, Provider, ReviewViewRequest } from '../src/types';
import { collect, MemoryHost, TEST_CATALOGS } from './helpers';

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
const raster = (seed: number): Raster => {
  const w = 60;
  const h = 40;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    const v = x > 20 + seed && x < 40 + seed ? 230 : y > 28 ? 60 : 130;
    data[o] = v + seed;
    data[o + 1] = v * 0.9;
    data[o + 2] = v * 0.95;
    data[o + 3] = 255;
  }
  return { width: w, height: h, data };
};

class KitHost extends MemoryHost {
  composed: string[][] = [];
  cropped: Array<{ box: readonly number[] }> = [];
  async captureReview(views: readonly ReviewViewRequest[]): Promise<Array<{ name: string; dataUrl: string }>> {
    return views.map((v) => ({ name: v.name, dataUrl: `data:image/png;base64,${Buffer.from(`render|${v.name}|0`).toString('base64')}` }));
  }
  async decodeImage(dataUrl: string): Promise<Raster | null> {
    if (dataUrl.startsWith('data:image/png;base64,iVBOR')) return raster(0);
    return Buffer.from(dataUrl.split(',')[1] ?? '', 'base64').toString().startsWith('render|') ? raster(4) : null;
  }
  async composeImages(tiles: ReadonlyArray<{ dataUrl: string; box?: readonly [number, number, number, number] }>): Promise<string | null> {
    this.composed.push(tiles.map((t) => (t.box ? t.box.join(',') : 'whole')));
    for (const t of tiles) if (t.box) this.cropped.push({ box: t.box });
    return `data:image/png;base64,${Buffer.from(`sbs|${tiles.length}|${this.composed.length}`).toString('base64')}`;
  }
}

let n = 0;
const call = (name: string, input: unknown): ContentBlock => ({ type: 'tool_use', id: `d${++n}`, name, input });
type Reply = (req: CompletionRequest, i: number) => ContentBlock[];
function scripted(replies: Reply[], critic?: (req: CompletionRequest) => ContentBlock[]): Provider & { requests: CompletionRequest[]; critics: CompletionRequest[] } {
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
        return { content: critic(req), stopReason: 'tool_use', model: 'fake-critic' };
      }
      requests.push(JSON.parse(JSON.stringify(req)) as CompletionRequest);
      const r = replies[Math.min(i, replies.length - 1)];
      const content = r ? r(req, i) : [{ type: 'text', text: 'done' } as ContentBlock];
      i++;
      return { content, stopReason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end', model: 'fake-vision' };
    },
  };
}
const verdicts = (fail: string[]): ContentBlock => call('report_verdicts', { verdicts: buildChecklist(description()).map((c) => ({ id: c.id, pass: !fail.includes(c.id), ...(fail.includes(c.id) ? { note: 'differs' } : {}) })) });
const lastText = (req: CompletionRequest): string => JSON.stringify(req.messages.at(-1)?.content);
const imagesOf = (req: CompletionRequest): number => req.messages.reduce((k, m) => k + (Array.isArray(m.content) ? m.content.filter((b) => b.type === 'image').length : 0), 0);
const agent = (provider: Provider, photo: Record<string, unknown> = {}): WorldAgent => new WorldAgent({ provider, catalogs: TEST_CATALOGS, maxTurns: 10, photo: { judges: 0, reads: 1, differences: true, crops: 2, ...photo } });

describe('DifferenceLedger', () => {
  const rec = (l: DifferenceLedger, d: unknown[]) => {
    const r = l.record({ differences: d });
    if (!r.ok) throw new Error(r.error);
    return r;
  };
  it('ranks open differences by size and keeps the largest first', () => {
    const l = new DifferenceLedger();
    const r = rec(l, [{ id: 'a', what: 'small', size: 2 }, { id: 'b', what: 'big', size: 5, kind: 'scale' }]);
    expect(r.ranked.map((d) => d.id)).toEqual(['b', 'a']);
    expect(r.text).toMatch(/1\. b \[scale, size 5\]/);
  });
  it('confirms a fix on the next report, points out a difference that did not shrink after an edit, and counts omitted ones as open', () => {
    const l = new DifferenceLedger();
    rec(l, [{ id: 'a', what: 'wide', size: 5 }, { id: 'b', what: 'dark', size: 3 }]);
    l.markEdited();
    const r = rec(l, [{ id: 'a', what: 'wide', size: 5, status: 'same' }]);
    expect(r.text).toMatch(/"a" \(the largest last round\) did not shrink/);
    expect(r.text).toMatch(/Not mentioned this time, so still counted as open: b/);
    const r2 = rec(l, [{ id: 'a', what: 'wide', size: 1, status: 'smaller' }, { id: 'b', what: 'dark', size: 0, status: 'fixed' }]);
    expect(r2.ranked.map((d) => d.id)).toEqual(['a']);
    expect(l.unresolvedText()).toContain('a (other');
  });
  it('rejects a malformed report and a report without statuses is asked for them', () => {
    const l = new DifferenceLedger();
    expect(l.record({ nope: 1 }).ok).toBe(false);
    rec(l, [{ id: 'a', what: 'x', size: 3 }]);
    expect(rec(l, [{ id: 'a', what: 'x', size: 3 }]).text).toMatch(/without a status/);
  });
  it('a rollback clears the edit flag so an undone fix is not blamed', () => {
    const l = new DifferenceLedger();
    rec(l, [{ id: 'a', what: 'x', size: 5 }]);
    l.markEdited();
    l.clearEdited();
    expect(rec(l, [{ id: 'a', what: 'x', size: 5, status: 'same' }]).text).not.toMatch(/did not shrink/);
  });
  it('has a tool description that carries the method (the system prompt stays small)', () => {
    expect(DIFFERENCES_TOOL.description).toMatch(/LARGEST first/);
    expect(DIFFERENCES_TOOL.description).toMatch(/status/);
  });
});

describe('compare kit pieces', () => {
  it('picks wall, floor, ceiling and the largest pieces, failing ones first, padded and clamped', () => {
    const d = description();
    const all = cropRegions(d, { max: 8 });
    expect(all.length).toBeGreaterThan(2);
    for (const r of all) for (const v of r.box) expect(v >= 0 && v <= 1).toBe(true);
    const some = all[all.length - 1]!;
    expect(cropRegions(d, { max: 3, priority: new Set([some.id]) })[0]?.id).toBe(some.id);
    expect(cropRegions(d, { max: 0 })).toEqual([]);
  });
  it('reads colour of the same region in both pictures', () => {
    const d = description();
    const text = regionReadout(raster(0), raster(4), cropRegions(d, { max: 4 }));
    expect(text).toMatch(/photo lit #[0-9a-f]{6}/i);
    expect(text).toMatch(/render lit #/i);
  });
});

describe('room from a photo with the differences ledger and the compare kit', () => {
  it('shows the side-by-side and crops, demands the list before edits, follows it across rounds, and records what a fresh seat still sees', async () => {
    const provider = scripted(
      [
        () => [call('describe_room', { description: rawDescription() })],
        // Round 1: an edit before the list is refused; the list and the edit in one reply work (list sorts first).
        () => [call('edit_items', { edits: [{ op: 'move', ref: 'picture-left', wall: 'north', t: 2.0 }] })],
        () => [
          call('edit_items', { edits: [{ op: 'move', ref: 'picture-left', wall: 'north', t: 2.3 }] }),
          call('report_differences', { differences: [{ id: 'picture-height', kind: 'position', where: 'north wall', what: 'picture hangs 0.3 m too low', size: 5 }, { id: 'wall-hue', kind: 'colour', what: 'wall reads cooler', size: 2 }] }),
          verdicts(['item-picture-left']),
        ],
        // Round 2: statuses on the new render; every checklist item passes.
        () => [call('report_differences', { differences: [{ id: 'picture-height', what: 'picture ok', size: 1, status: 'smaller' }, { id: 'wall-hue', what: 'wall reads cooler', size: 2, status: 'same' }] }), verdicts([])],
        () => [call('finish', { message: 'done' })],
      ],
      () => [call('report_differences', { differences: [{ id: 'rug-size', kind: 'scale', where: 'rug', what: 'rug is a third smaller', size: 4 }] })],
    );
    const host = new KitHost();
    const events: AgentEvent[] = await collect(agent(provider, { crossCheck: true }).run('make this bedroom in 3d', host, { images: [fakePhoto(1920, 1280)] }));
    // Round 1 carries the kit: a side-by-side image and zoomed pairs, built through the host.
    const r1 = provider.requests[1]!;
    expect(lastText(r1)).toContain('the PHOTO beside the RENDER from the same camera');
    expect(lastText(r1)).toContain('COMPARE KIT');
    // One ranking instruction, not two: the intro's written ranking and the ledger's list are the same step.
    expect(lastText(r1).split('BIGGEST DIFFERENCE FIRST').length - 1).toBe(1);
    expect(lastText(r1)).toContain('call report_differences with every difference you can see');
    expect(lastText(r1)).toContain('The single largest goes first');
    expect(lastText(r1)).not.toContain('write one line that ranks');
    expect(lastText(r1)).toContain('Colour readout');
    expect(host.composed.length).toBeGreaterThanOrEqual(3);
    expect(host.cropped.length).toBeGreaterThanOrEqual(4);
    expect(imagesOf(r1)).toBeGreaterThanOrEqual(5);
    expect(provider.requests[1]?.tools?.map((t) => t.name)).toContain('report_differences');
    // The edit before the list was refused, with the reason.
    expect(lastText(provider.requests[2]!)).toContain('List the differences first');
    // Round 2 shows the list from round 1 and asks for statuses.
    const r2 = lastText(provider.requests[3]!);
    expect(r2).toContain('Your differences list from the last round');
    expect(r2).toContain('picture-height');
    expect(r2.split('BIGGEST DIFFERENCE FIRST').length - 1).toBe(1);
    expect(r2).toContain('BIGGEST DIFFERENCE FIRST, AGAIN');
    expect(r2).toContain('status: fixed, smaller, same, worse');
    expect(r2).not.toContain('Rank the differences again');
    // The fix was applied after the list.
    // The list is reported to the UI, and the closing message names what is still open, from both seats.
    const diffs = events.filter((e) => e.type === 'photo' && e.differences);
    expect(diffs.length).toBeGreaterThanOrEqual(3);
    const done = events.find((e) => e.type === 'photo' && e.phase === 'done');
    expect(done && done.type === 'photo' && done.text).toMatch(/still open, largest first: check-rug-size/);
    expect(done && done.type === 'photo' && done.text).toMatch(/wall-hue/);
    // The independent seat: a fresh conversation with its own seed and no trace of the model's list.
    expect(provider.critics).toHaveLength(1);
    const c = provider.critics[0]!;
    expect(c.seed).toBe(CROSSCHECK_SEED);
    expect(c.messages).toHaveLength(1);
    expect(c.session).toBeUndefined();
    expect(JSON.stringify(c.messages)).not.toContain('picture-height');
    expect(JSON.stringify(c.messages)).toContain('the PHOTO beside the RENDER');
  });

  it('is off unless asked for: no tool, no kit calls, no cross-check', async () => {
    const provider = scripted([() => [call('describe_room', { description: rawDescription() })], () => [verdicts([])], () => [call('finish', { message: 'done' })]], () => [call('report_differences', { differences: [] })]);
    const host = new KitHost();
    await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS, maxTurns: 10, photo: { judges: 0, reads: 1 } }).run('make this bedroom in 3d', host, { images: [fakePhoto(1920, 1280)] }));
    expect(provider.requests[1]?.tools?.map((t) => t.name)).not.toContain('report_differences');
    expect(host.composed).toHaveLength(0);
    expect(provider.critics).toHaveLength(0);
  });
});

describe('ranking instruction text', () => {
  it('is one text per form and carries every behaviour of the two it replaced', async () => {
    const { rankDifferencesText, BIGGEST_DIFFERENCE_TEXT } = await import('../src/photo/prompt');
    const first = rankDifferencesText(1);
    const later = rankDifferencesText(2);
    for (const t of [first, later, BIGGEST_DIFFERENCE_TEXT]) {
      for (const kind of ['proportion', 'position', 'colour', 'material and finish', 'lighting', 'missing or extra items']) expect(t).toContain(kind);
      expect(t).toContain('look_closer');
      expect(t).toContain('BIGGEST DIFFERENCE FIRST');
    }
    expect(first).toContain('report_differences');
    expect(first).toContain('size 1..5');
    expect(first).toContain('one change per difference');
    expect(later).toContain('did not shrink, change the approach');
    expect(BIGGEST_DIFFERENCE_TEXT).not.toContain('report_differences');
    // Short enough to cost little on every round.
    expect(first.length).toBeLessThan(1100);
    expect(later.length).toBeLessThan(1100);
  });
});
