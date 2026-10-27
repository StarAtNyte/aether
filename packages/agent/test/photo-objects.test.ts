import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PHOTO_BUILDING_ID, buildChecklist, parseRoomDescription, type RoomDescription } from '@aether/arch/photo';
import { partKinds, readScene } from '@aether/arch';
import { WorldAgent } from '../src/agent';
import { DifferenceLedger } from '../src/photo/differences';
import {
  ObjectLedger,
  aggregateObject,
  applyReasons,
  boxIou,
  objectTableText,
  openAspects,
  parseInventory,
  parseObjectJudgement,
  reconcileInventories,
  selectObjects,
  SWEEP_EVERY,
  type Current,
  type InventoryItem,
  type ObjectSample,
} from '../src/photo/objects';
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
    data[o] = v;
    data[o + 1] = v * 0.9;
    data[o + 2] = v * 0.95;
    data[o + 3] = 255;
  }
  return { width: w, height: h, data };
};

class ObjHost extends MemoryHost {
  composed = 0;
  boxViews = 0;
  async captureReview(views: readonly ReviewViewRequest[]): Promise<Array<{ name: string; dataUrl: string }>> {
    if (views.some((v) => v.name === 'photo-camera-boxes')) this.boxViews++;
    return views.map((v) => ({ name: v.name, dataUrl: `data:image/png;base64,${Buffer.from(`render|${v.name}|0`).toString('base64')}` }));
  }
  async decodeImage(dataUrl: string): Promise<Raster | null> {
    if (dataUrl.startsWith('data:image/png;base64,iVBOR')) return raster(0);
    return Buffer.from(dataUrl.split(',')[1] ?? '', 'base64').toString().startsWith('render|') ? raster(0) : null;
  }
  async composeImages(tiles: ReadonlyArray<{ dataUrl: string; box?: readonly [number, number, number, number] }>): Promise<string | null> {
    this.composed++;
    return `data:image/png;base64,${Buffer.from(`pair|${tiles.length}|${this.composed}`).toString('base64')}`;
  }
}

let n = 0;
const call = (name: string, input: unknown): ContentBlock => ({ type: 'tool_use', id: `o${++n}`, name, input });
type Reply = (req: CompletionRequest, i: number) => ContentBlock[];
function scripted(replies: Reply[], critic: (req: CompletionRequest) => ContentBlock[]): Provider & { requests: CompletionRequest[]; critics: CompletionRequest[] } {
  const requests: CompletionRequest[] = [];
  const critics: CompletionRequest[] = [];
  let i = 0;
  return {
    name: 'scripted',
    requests,
    critics,
    async complete(req): Promise<CompletionResponse> {
      if (req.role === 'critic') {
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
const photoEvents = (events: AgentEvent[]): Array<Extract<AgentEvent, { type: 'photo' }>> => events.filter((e): e is Extract<AgentEvent, { type: 'photo' }> => e.type === 'photo');
const toolOf = (req: CompletionRequest): string => req.tools?.[0]?.name ?? '';
const textOf = (req: CompletionRequest): string => JSON.stringify(req.messages);

const IDS = ['bed', 'nightstand', 'floor-lamp', 'armchair', 'tv', 'picture-left', 'picture-right', 'curtains'] as const;
const inv = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => {
  const it = (rawDescription()['items'] as Array<{ id: string; kind: string; box: number[] }>).find((i) => i.id === id)!;
  return { id, kind: it.kind, category: 'furniture', label: id.replace(/-/g, ' '), box: it.box, relations: [`${id} stands where the photo shows it`], size: 'as its neighbours', look: 'plain', confidence: 0.8, entity: `${PHOTO_BUILDING_ID}-${id}`, ...over };
};
const CLOCK = { id: 'clock', kind: 'clock', category: 'decor', label: 'wall clock', box: [0.6, 0.1, 0.66, 0.19], relations: ['above the pictures'], confidence: 0.6 };

/** The independent critic seats: the checklist panel (all pass), the two inventories, the object judge and the layout judge. */
function critic(opts: { objects: (ids: string[], req: CompletionRequest) => Record<string, Partial<{ present: boolean; type: number; position: number; size: number; material: number }>>; blind?: boolean }): (req: CompletionRequest) => ContentBlock[] {
  return (req) => {
    const tool = toolOf(req);
    if (tool === 'report_inventory') {
      const blind = !textOf(req).includes('built pieces');
      if (blind) return [call('report_inventory', { items: [...IDS.filter((i) => i !== 'nightstand').map((i) => ({ ...inv(i), id: `b-${i}`, entity: undefined })), CLOCK] })];
      return [call('report_inventory', { items: IDS.map((i) => inv(i)) })];
    }
    if (tool === 'report_object_judgement') {
      const ids = [...textOf(req).matchAll(/id ([a-z0-9-]+):/g)].map((m) => m[1] as string);
      const plan = opts.objects(ids, req);
      return [call('report_object_judgement', { verdicts: ids.map((id) => ({ id, present: true, type: 4, position: 4, size: 4, material: 4, evidence: `photo shows ${id}; render shows ${id}`, ...(plan[id] ?? {}), ...(plan[id]?.present === false ? { type: 0, position: 0, size: 0, material: 0 } : {}), fix: plan[id] ? `fix ${id}` : '' })) })];
    }
    if (tool === 'report_relations') {
      const ids = [...textOf(req).matchAll(/- (rel-[a-z0-9-]+):/g)].map((m) => m[1] as string);
      return [call('report_relations', { relations: ids.map((id) => ({ id, ok: true })) })];
    }
    // The checklist panel: everything passes, no preference.
    const pair = req.messages.some((m) => typeof m.content !== 'string' && m.content.filter((b) => b.type === 'image').length === 3);
    return [call('report_judgement', { verdicts: buildChecklist(description()).map((c) => ({ id: c.id, a: 4, ...(pair ? { b: 4 } : {}), evidence: 'same' })), ...(pair ? { closer: 'same' } : {}) })];
  };
}

const agent = (provider: Provider, photo: Record<string, unknown> = {}): WorldAgent => new WorldAgent({ provider, catalogs: TEST_CATALOGS, maxTurns: 10, photo: { judges: 3, reads: 1, harness: true, crops: 2, objects: true, ...photo } });
const sceneItem = (host: MemoryHost, id: string) => readScene(host.world, PHOTO_BUILDING_ID)?.items.find((i) => i.id.endsWith(id));
const itemOf = (id: string, box: [number, number, number, number], over: Partial<InventoryItem> = {}): InventoryItem => ({ id, kind: id, category: 'furniture', label: id, box, relations: [], size: '', look: '', confidence: 0.8, occlusion: '', entities: [], linkedBy: 'none', seen: 'primary', ...over });

describe('inventory parsing and reconciliation', () => {
  it('parses boxes, relations and the built-piece link; drops unknown links and counts invalid entries', () => {
    const p = parseInventory({ items: [inv('bed'), { kind: 'x' }, { ...inv('tv'), entity: 'room-photo-ghost' }, { ...inv('curtains'), box: [0.5, 0.5, 0.4, 0.4], entity: 'none' }] }, new Set([`${PHOTO_BUILDING_ID}-bed`, `${PHOTO_BUILDING_ID}-tv`]));
    expect(p?.skipped).toBe(1);
    expect(p?.items.map((i) => i.id)).toEqual(['bed', 'tv', 'curtains']);
    expect(p?.items[0]?.entities).toEqual([`${PHOTO_BUILDING_ID}-bed`]);
    expect(p?.items[1]?.entities).toEqual([]);
    expect(p?.items[2]?.box[0]).toBeLessThan(p?.items[2]?.box[2] ?? 0);
  });

  it('matches the two lists by overlap and name, keeps what only one seat saw and flags it', () => {
    const a = [itemOf('bed', [0.2, 0.6, 0.9, 1]), itemOf('lamp', [0.54, 0.65, 0.59, 0.78], { kind: 'table lamp', label: 'bedside lamp' }), itemOf('rug', [0.3, 0.85, 0.7, 1], { kind: 'rug' })];
    const b = [itemOf('b1', [0.18, 0.59, 0.96, 1], { kind: 'bed' }), itemOf('b2', [0.55, 0.66, 0.6, 0.79], { kind: 'lamp', label: 'bedside table lamp', relations: ['on the nightstand'] }), itemOf('b3', [0.6, 0.1, 0.66, 0.19], { kind: 'clock', label: 'wall clock' })];
    const r = reconcileInventories(a, b);
    expect(r.both).toBe(2);
    expect(r.onlyPrimary).toEqual(['rug']);
    expect(r.onlyBlind).toEqual(['blind-b3']);
    expect(r.items).toHaveLength(4);
    expect(r.items.find((i) => i.id === 'lamp')?.relations).toContain('on the nightstand');
    expect(r.items.find((i) => i.id === 'lamp')?.seen).toBe('both');
    expect(r.items.find((i) => i.id === 'blind-b3')?.seen).toBe('blind');
    expect(r.notes.join(' ')).toMatch(/blind seat only.*wall clock/);
    expect(boxIou([0, 0, 1, 1], [0, 0, 0.5, 1])).toBeCloseTo(0.5);
  });
});

describe('the per-object panel', () => {
  const s = (over: Partial<ObjectSample> & { position?: number } = {}): ObjectSample => ({ present: true, scores: { type: 4, position: over.position ?? 4, size: 4, material: 4 }, na: over.na ?? new Set(), evidence: 'photo vs render', fix: over.fix ?? '', ...(over.present === false ? { present: false } : {}) });
  it('takes the median per aspect and the majority for presence, so one wavering judge cannot flip an aspect', () => {
    const a = aggregateObject([s({ position: 1, fix: 'move 0.3 m right' }), s({ position: 4 }), s({ position: 1 })]);
    expect(a?.aspects.position).toEqual({ state: 'fail', score: 1 });
    expect(a?.aspects.size.state).toBe('pass');
    expect(a?.fix).toBe('move 0.3 m right');
    expect(aggregateObject([s({ position: 1 }), s({ position: 4 }), s({ position: 4 })])?.aspects.position.state).toBe('pass');
    const gone = aggregateObject([s({ present: false }), s({ present: false }), s()]);
    expect(gone?.aspects.present.state).toBe('fail');
    expect(gone?.aspects.position.state).toBe('unjudged');
    const hidden = aggregateObject([s({ na: new Set(['material']) }), s({ na: new Set(['material']) }), s()]);
    expect(hidden?.aspects.material.state).toBe('na');
  });

  it('parses a judge answer and drops ids that are not in the request', () => {
    const got = parseObjectJudgement({ verdicts: [{ id: 'bed', present: true, type: 4, position: '2', size: 3, material: 4, evidence: 'ok then' }, { id: 'ghost', present: true, type: 4, position: 4, size: 4, material: 4, evidence: 'ok then' }] }, new Set(['bed']));
    expect([...(got?.keys() ?? [])]).toEqual(['bed']);
    expect(got?.get('bed')?.scores.position).toBe(2);
  });
});

describe('what is judged again', () => {
  const ledger = (): ObjectLedger => {
    const l = new ObjectLedger();
    l.load([itemOf('bed', [0.1, 0.5, 0.5, 0.9]), itemOf('lamp', [0.5, 0.4, 0.6, 0.6]), itemOf('tv', [0.8, 0.1, 0.95, 0.3])]);
    return l;
  };
  const mark = (l: ObjectLedger, round: number): Map<string, Current> => {
    const now = new Map<string, Current>();
    for (const r of l.list()) {
      const c = { sig: [10, 20, 30], proj: null };
      now.set(r.item.id, c);
      l.apply(r.item.id, aggregateObject([{ present: true, scores: { type: 4, position: 4, size: 4, material: 4 }, na: new Set(), evidence: 'x', fix: '' }]) as never, round, { ...c, entities: {} });
    }
    l.swept = round;
    return now;
  };
  it('judges everything first, then only the changed objects and their neighbours, and sweeps every few rounds', () => {
    const l = ledger();
    expect(selectObjects(l, new Map(), 1)).toMatchObject({ full: true, ids: ['bed', 'lamp', 'tv'] });
    const now = mark(l, 1);
    expect(selectObjects(l, now, 2)).toMatchObject({ full: false, ids: [] });
    now.set('lamp', { sig: [90, 90, 90], proj: null });
    const sel = selectObjects(l, now, 2);
    expect(sel.changed).toEqual(['lamp']);
    expect(sel.ids.sort()).toEqual(['bed', 'lamp']);
    expect(selectObjects(l, now, 1 + SWEEP_EVERY).full).toBe(true);
    expect(selectObjects(l, now, 2, { force: true }).full).toBe(true);
  });
  it('does not judge an object the model gave a reason for, and a reason ends the open count', () => {
    const l = ledger();
    const bad = aggregateObject([{ present: true, scores: { type: 4, position: 1, size: 4, material: 4 }, na: new Set(), evidence: 'far left', fix: 'move right' }]) as never;
    l.apply('tv', bad, 1, { sig: null, proj: null, entities: {} });
    expect(openAspects(l.get('tv')!)).toEqual(['position']);
    expect(l.openCount()).toBe(1);
    const d = new DifferenceLedger();
    d.upsert({ id: 'obj-tv-position', kind: 'position', cause: 'geometry', where: 'tv', what: 'x', size: 4 });
    expect(applyReasons(l, { reasons: [{ id: 'tv', aspect: 'position', reason: 'cut off by the frame edge in the photo' }] }, d).ok).toBe(true);
    expect(l.openCount()).toBe(0);
    expect(d.ranked()).toHaveLength(0);
    expect(d.waivedList()).toHaveLength(1);
    expect(objectTableText(l)).toMatch(/Given a reason by you earlier/);
  });
  it('keeps the best state and says an object got worse; a snapshot restores with everything', () => {
    const l = ledger();
    const good = aggregateObject([{ present: true, scores: { type: 4, position: 4, size: 4, material: 4 }, na: new Set(), evidence: 'same', fix: '' }]) as never;
    const bad = aggregateObject([{ present: true, scores: { type: 4, position: 1, size: 4, material: 4 }, na: new Set(), evidence: 'moved', fix: 'back' }]) as never;
    expect(l.apply('bed', good, 1, { sig: [1], proj: null, entities: { a: { id: 'a' } } })?.regressed).toBe(false);
    expect(l.apply('bed', bad, 2, { sig: [2], proj: null, entities: { a: { id: 'a', moved: true } } })?.regressed).toBe(true);
    expect(l.get('bed')?.best?.round).toBe(1);
    const copy = ObjectLedger.restore(JSON.parse(JSON.stringify(l.snapshot())));
    expect(copy?.get('bed')?.best?.entities).toEqual({ a: { id: 'a' } });
    expect(copy?.size).toBe(3);
    copy?.markReverted('bed');
    expect(openAspects(copy!.get('bed')!)).toEqual([]);
    expect(ObjectLedger.restore({ version: 2 })).toBeNull();
  });
});

describe('room from a photo, object by object', () => {
  it('lists the photo twice, flags what only the blind seat saw, judges every object, repairs the failing ones, judges only the changed ones again and ends with a stated reason', async () => {
    const host = new ObjHost();
    let fixed = false;
    const judgedRounds: string[][] = [];
    const provider = scripted(
      [
        () => [call('describe_room', { description: rawDescription() })],
        // Round 1: list, state a reason for the clock, declare and move the left picture.
        () => [
          call('report_differences', { differences: [{ id: 'obj-picture-left-position', kind: 'position', cause: 'geometry', where: 'picture left', what: 'picture is too far left', size: 4 }] }),
          call('state_object_reason', { reasons: [{ id: 'blind-clock', aspect: 'all', reason: 'the clock is cut off by the top edge of the photo; nothing to match' }] }),
          call('declare_repair', { difference: 'obj-picture-left-position', cause: 'geometry', why: 'the judges say it is off' }),
          call('edit_items', { edits: [{ op: 'move', ref: 'picture-left', wall: 'north', t: 1.6 }] }),
        ],
        () => [{ type: 'text', text: 'Edits made, waiting for the next render.' }],
        // Round 2: confirm and finish.
        () => [call('report_differences', { differences: [{ id: 'obj-picture-left-position', what: 'fixed', size: 0, status: 'fixed' }] }), call('finish', { message: 'done' })],
      ],
      critic({
        objects: (ids) => {
          judgedRounds.push(ids);
          if (!fixed && sceneItem(host, 'picture-left')?.wall?.t !== undefined && Math.abs((sceneItem(host, 'picture-left')?.wall?.t ?? 0) - 1.6) < 0.05) fixed = true;
          return { 'picture-left': { position: fixed ? 4 : 1 }, 'blind-clock': { present: false } } as never;
        },
      }),
    );
    const events = await collect(agent(provider).run('make this bedroom in 3d', host, { images: [fakePhoto(1920, 1280)] }));
    // Two inventory seats, one told what is built and one blind.
    const invReqs = provider.critics.filter((r) => toolOf(r) === 'report_inventory');
    expect(invReqs).toHaveLength(2);
    expect(invReqs.filter((r) => textOf(r).includes('built pieces'))).toHaveLength(1);
    const listed = photoEvents(events).find((e) => /Inventory of the photo: 9 objects/.test(e.text));
    expect(listed?.text).toMatch(/7 objects in both, 1 only in the first, 1 only in the blind list/);
    expect(listed?.objects?.find((o) => o.seen === 'blind')?.label).toBe('wall clock');
    // Every object was judged in the first round, in requests of at most six, with paired crops and the boxes drawn on the render.
    expect(judgedRounds[0]).toHaveLength(6);
    expect(new Set(judgedRounds.slice(0, 6).flat()).size).toBe(9);
    expect(host.boxViews).toBeGreaterThan(0);
    const firstJudge = provider.critics.find((r) => toolOf(r) === 'report_object_judgement')!;
    expect(firstJudge.messages.flatMap((m) => (typeof m.content === 'string' ? [] : m.content)).filter((b) => b.type === 'image').length).toBe(8);
    expect(textOf(firstJudge)).toMatch(/measured \(advice\): its built piece projects/);
    // The failing aspects became differences with the repair route; the model saw the table.
    const second = textOf(provider.requests[1]!);
    expect(second).toContain('Per-object judgement (9 objects');
    expect(second).toMatch(/picture-left \[picture left; built as room-photo-picture-left\] present:ok type:ok position:FAIL/);
    expect(second).toMatch(/blind-clock .*present:FAIL/);
    expect(second).toContain('OBJECTS.');
    expect(second).toMatch(/suggested correction \(advisory, unprojected through the photo camera/);
    expect(second).toMatch(/on the north wall: [+-][0-9.]+ m along the wall/);
    // Closed loop: the edit result already says whether the piece moved the right way, before any judge looks.
    expect(JSON.stringify(provider.requests[2]?.messages)).toMatch(/Residual after this edit[^]*picture left: render box/);
    // The fix was applied and only the changed object (and its neighbours) went back to the panel.
    expect(sceneItem(host, 'picture-left')?.wall?.t).toBeCloseTo(1.6, 1);
    const later = judgedRounds.slice(6);
    expect(later.length).toBeGreaterThan(0);
    expect(later.flat()).toContain('picture-left');
    expect(new Set(later.flat())).toEqual(new Set(['picture-left', 'bed']));
    const done = photoEvents(events).find((e) => e.phase === 'done');
    expect(done?.text).toMatch(/Object by object: 9 of 9 objects pass every aspect|Object by object: 8 of 9 objects pass every aspect/);
    expect(done?.text).toMatch(/left as they are with a stated reason/);
    expect(done?.objects?.find((o) => o.id === 'picture-left')).toMatchObject({ position: 'pass' });
    expect(done?.objects?.find((o) => o.label === 'wall clock')?.waived).toMatch(/cut off/);
    expect((done?.resume as { objects?: { version: number } } | undefined)?.objects?.version).toBe(1);
    expect(done?.stages?.find((s) => s.id === 'repair')?.status).toBe('passed');
  });

  it('puts an object back to its best state when a change makes it worse, and tells the model', async () => {
    const host = new ObjHost();
    let calls = 0;
    const original = { t: 0 };
    const provider = scripted(
      [
        () => [call('describe_room', { description: rawDescription() })],
        () => {
          original.t = sceneItem(host, 'picture-left')?.wall?.t ?? 0;
          return [
            call('report_differences', { differences: [{ id: 'obj-nightstand-position', kind: 'position', cause: 'geometry', where: 'nightstand', what: 'off', size: 3 }] }),
            call('declare_repair', { difference: 'obj-nightstand-position', cause: 'geometry', why: 'fix the nightstand' }),
            // The model also moves a picture that was fine.
            call('edit_items', { edits: [{ op: 'move', ref: 'picture-left', wall: 'north', t: original.t - 0.6 }] }),
          ];
        },
        () => [{ type: 'text', text: 'Edits made, waiting for the next render.' }],
        () => [call('report_differences', { differences: [{ id: 'obj-nightstand-position', what: 'ok', size: 0, status: 'fixed' }] }), call('state_object_reason', { reasons: [{ id: 'nightstand', aspect: 'all', reason: 'tried to place it; the tools cannot match it' }] }), call('finish', { message: 'done' })],
      ],
      critic({
        objects: (ids) => {
          calls++;
          const moved = Math.abs((sceneItem(host, 'picture-left')?.wall?.t ?? 0) - original.t) > 0.3 && original.t > 0;
          return { nightstand: { position: 1 }, ...(moved ? { 'picture-left': { position: 1 } } : {}) } as never;
        },
      }),
    );
    const events = await collect(agent(provider).run('make this bedroom in 3d', host, { images: [fakePhoto(1920, 1280)] }));
    expect(calls).toBeGreaterThan(2);
    // The worse object went back to where it was; the text says so.
    expect(sceneItem(host, 'picture-left')?.wall?.t).toBeCloseTo(original.t, 2);
    expect(photoEvents(events).some((e) => /put back to their best: picture-left/.test(e.text))).toBe(true);
    expect(textOf(provider.requests.at(-1)!)).toMatch(/Put back to their best state before this round.*picture left/);
  });

  it('continues from the saved ledger: no second inventory, the failing objects are still on the table', async () => {
    const photo = fakePhoto(1920, 1280);
    const host = new ObjHost();
    const first = scripted(
      [() => [call('describe_room', { description: rawDescription() })], () => [call('report_differences', { differences: [] }), call('finish', { message: 'stop' }), call('finish', { message: 'stop' })]],
      critic({ objects: () => ({ tv: { size: 1 } }) as never }),
    );
    const ev1 = await collect(agent(first, { maxRounds: 1 }).run('make this bedroom in 3d', host, { images: [photo] }));
    const done1 = photoEvents(ev1).find((e) => e.phase === 'done');
    const saved = (done1?.resume as { objects?: unknown } | undefined)?.objects;
    expect(saved).toBeDefined();
    expect(ObjectLedger.restore(saved)?.openCount()).toBeGreaterThan(0);
    const second = scripted([() => [call('report_differences', { differences: [] }), call('state_object_reason', { reasons: [{ id: 'tv', aspect: 'all', reason: 'no matching model after find_model' }] }), call('finish', { message: 'ok' })]], critic({ objects: () => ({ tv: { size: 1 } }) as never }));
    const ev2 = await collect(agent(second).run('keep going', host, { images: [photo], photoResume: done1!.resume!, photo: 'recreate', intent: 'refine' }));
    expect(second.critics.filter((r) => toolOf(r) === 'report_inventory')).toHaveLength(0);
    expect(textOf(second.requests[0]!)).toMatch(/Per-object judgement/);
    expect(textOf(second.requests[0]!)).toMatch(/tv \[/);
    const done2 = photoEvents(ev2).find((e) => e.phase === 'done');
    expect(done2?.objects?.find((o) => o.id === 'tv')?.waived).toMatch(/no matching model/);
  });
});
