import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildChecklist, parseRoomDescription, type RoomDescription } from '@aether/arch/photo';
import { partKinds } from '@aether/arch';
import { WorldAgent } from '../src/agent';
import { DifferenceLedger } from '../src/photo/differences';
import { createMockProvider } from '../src/providers/mock/index';
import { AssumptionsLedger, RepairGuard, StageMachine, applyCameraChange, buildProvenance, causesOfTool, hashDataUrl, GATE_TOOL, REPAIR_TOOL, STAGE_IDS } from '../src/photo/stages';
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
const agent = (provider: Provider, photo: Record<string, unknown> = {}): WorldAgent => new WorldAgent({ provider, catalogs: TEST_CATALOGS, maxTurns: 10, photo: { judges: 0, reads: 1, harness: true, crops: 2, ...photo } });
const photoEvents = (events: AgentEvent[]): Array<Extract<AgentEvent, { type: 'photo' }>> => events.filter((e): e is Extract<AgentEvent, { type: 'photo' }> => e.type === 'photo');
const gateAll = (verdict: 'pass' | 'fail' = 'pass', skip: string[] = []): ContentBlock =>
  call('stage_gate', { gates: ['evidence', 'camera', 'shell', 'furniture', 'materials', 'lighting'].filter((s) => !skip.includes(s)).map((stage) => ({ stage, verdict, evidence: `looked at the ${stage} in the side-by-side image and it matches` })) });

describe('StageMachine', () => {
  it('starts every stage pending and lists them in order', () => {
    const m = new StageMachine();
    expect(m.views().map((v) => v.id)).toEqual([...STAGE_IDS]);
    expect(m.views().every((v) => v.status === 'pending')).toBe(true);
  });
  it('refuses a verdict for a stage the run has not reached', () => {
    const m = new StageMachine();
    const r = m.gate({ gates: [{ stage: 'camera', verdict: 'pass', evidence: 'the horizon is where the photo has it' }] });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/not reached/);
    expect(m.status('camera')).toBe('pending');
  });
  it('needs evidence for a pass and a named blocker for a block', () => {
    const m = new StageMachine();
    m.begin('shell');
    m.begin('lighting');
    expect(m.gate({ gates: [{ stage: 'shell', verdict: 'pass', evidence: '' }] }).text).toMatch(/needs evidence/);
    expect(m.status('shell')).toBe('active');
    expect(m.gate({ gates: [{ stage: 'lighting', verdict: 'blocked', evidence: 'no' }] }).text).toMatch(/blocker named/);
    expect(m.gate({ gates: [{ stage: 'shell', verdict: 'pass', evidence: 'walls and openings land where the photo has them' }] }).changed).toEqual(['shell']);
    expect(m.status('shell')).toBe('passed');
    const b = m.gate({ gates: [{ stage: 'lighting', verdict: 'blocked', evidence: '', blocker: 'the photo is a night shot with no light visible' }] });
    expect(b.changed).toEqual(['lighting']);
    expect(m.blocker()?.stage).toBe('lighting');
  });
  it('a failed stage can be re-judged and pass later; unknown stages and malformed input are refused', () => {
    const m = new StageMachine();
    m.begin('materials');
    m.gate({ gates: [{ stage: 'materials', verdict: 'fail', evidence: 'the floor is the wrong hue' }] });
    expect(m.status('materials')).toBe('failed');
    expect(m.gate({ gates: [{ stage: 'materials', verdict: 'pass', evidence: 'floor now reads oak like the photo' }] }).ok).toBe(true);
    expect(m.status('materials')).toBe('passed');
    expect(m.gate({ gates: [{ stage: 'delivery', verdict: 'pass', evidence: 'because I say so' }] }).ok).toBe(false);
    expect(m.gate('nope').ok).toBe(false);
  });
  it('round-trips through a snapshot and reports the stages without a pass', () => {
    const m = new StageMachine();
    m.begin('shell');
    m.pass('shell', 'matches');
    m.begin('camera');
    const r = StageMachine.restore(JSON.parse(JSON.stringify(m.snapshot())));
    expect(r.status('shell')).toBe('passed');
    expect(r.note('shell')).toBe('matches');
    expect(r.unfinishedText()).toContain('camera (active)');
    r.reset('shell');
    expect(r.status('shell')).toBe('pending');
  });
  it('the gate tool carries the method in its description (the system prompt stays small)', () => {
    expect(GATE_TOOL.description).toMatch(/evidence/);
    expect(REPAIR_TOOL.description).toMatch(/camera.*geometry.*materials.*lighting/s);
  });
});

describe('RepairGuard', () => {
  const ledger = (): DifferenceLedger => {
    const l = new DifferenceLedger();
    const r = l.record({ differences: [{ id: 'fov', cause: 'camera', what: 'room too wide', size: 4 }, { id: 'bed', cause: 'geometry', what: 'bed narrow', size: 5 }, { id: 'hue', kind: 'colour', what: 'wall cooler', size: 3 }, { id: 'glow', kind: 'lighting', what: 'dim', size: 2 }] });
    if (!r.ok) throw new Error(r.error);
    return l;
  };
  it('orders the open differences camera, geometry, materials, lighting and then by size', () => {
    expect(RepairGuard.repairOrder(ledger().ranked()).map((d) => d.id)).toEqual(['fov', 'bed', 'hue', 'glow']);
    expect(RepairGuard.earliestBlocking(ledger().ranked())).toBe('camera');
  });
  it('refuses a later class while an earlier one has a difference of size 3 or more, with the reason', () => {
    const g = new RepairGuard();
    const open = ledger().ranked();
    const r = g.declare({ difference: 'bed', cause: 'geometry' }, open);
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/camera comes before geometry/);
    expect(g.allow('edit_items', { edits: [{ op: 'move', ref: 'bed' }] })).toMatch(/Say what you repair first/);
    expect(g.declare({ difference: 'fov', cause: 'camera', why: 'zoom out' }, open).ok).toBe(true);
    expect(g.log).toHaveLength(1);
  });
  it('a small difference (size 1 or 2) in an earlier class does not block', () => {
    const l = new DifferenceLedger();
    l.record({ differences: [{ id: 'fov', cause: 'camera', what: 'slightly off', size: 2 }, { id: 'hue', cause: 'materials', what: 'wall', size: 4 }] });
    expect(new RepairGuard().declare({ difference: 'hue', cause: 'materials' }, l.ranked()).ok).toBe(true);
  });
  it('checks the declared cause against the ledger and the tool against the declared cause', () => {
    const g = new RepairGuard();
    const l = new DifferenceLedger();
    l.record({ differences: [{ id: 'hue', cause: 'materials', what: 'wall', size: 4 }] });
    expect(g.declare({ difference: 'hue', cause: 'lighting' }, l.ranked()).text).toMatch(/materials difference/);
    expect(g.declare({ difference: 'ghost', cause: 'materials' }, l.ranked()).text).toMatch(/not an open difference/);
    expect(g.declare({ difference: 'hue', cause: 'materials' }, l.ranked()).ok).toBe(true);
    expect(g.allow('place_items', {})).toMatch(/geometry tool/);
    expect(g.allow('make_texture', {})).toBeNull();
    expect(g.allow('query_scene', {})).toBeNull();
    g.newRound(2);
    expect(g.allow('make_texture', {})).toMatch(/Say what you repair first/);
  });
  it('classifies edit tools by what they change', () => {
    expect(causesOfTool('set_photo_camera', { fov: 60 })).toEqual(['camera']);
    expect(causesOfTool('tune_look', {})).toEqual(['lighting']);
    expect(causesOfTool('edit_items', { edits: [{ op: 'resize', ref: 'sofa', params: { color: '#aabbcc' } }] })).toEqual(['materials']);
    expect(causesOfTool('edit_items', { edits: [{ op: 'resize', ref: 'sofa', params: { width: 2 } }] })).toEqual(['geometry']);
    expect(causesOfTool('edit_items', { edits: [{ op: 'move', ref: 'sofa' }] })).toEqual(['geometry']);
    expect(causesOfTool('design_plan', {})).toContain('materials');
    expect(causesOfTool('finish', {})).toBeNull();
  });
});

describe('camera change', () => {
  const cam = description().camera;
  it('changes only what is sent, keeps it in range, and wraps the heading', () => {
    const r = applyCameraChange(cam, { fov: 72, heading: -90 });
    expect(r.ok && r.camera.fov).toBe(72);
    expect(r.ok && r.camera.heading).toBe(270);
    expect(r.ok && r.camera.height).toBe(cam.height);
  });
  it('refuses out-of-range and unknown fields and an empty change', () => {
    expect(applyCameraChange(cam, { fov: 200 }).ok).toBe(false);
    expect(applyCameraChange(cam, { zoom: 2 }).ok).toBe(false);
    expect(applyCameraChange(cam, {}).ok).toBe(false);
  });
});

describe('assumptions ledger and provenance', () => {
  it('keeps confidence, sorts the least certain first, classifies, and asks only through blockers', () => {
    const a = new AssumptionsLedger();
    a.add({ id: 'size', text: 'The room is about 4.2 m wide.', confidence: 0.4, stage: 'evidence', adjust: 'make the room 5 m wide', kind: AssumptionsLedger.kindOf('The room is about 4.2 m wide.') });
    a.add({ id: 'back', text: 'The wall behind the camera is assumed plain.', confidence: 0.2, stage: 'evidence', adjust: '', kind: AssumptionsLedger.kindOf('The wall behind the camera is assumed plain.') });
    expect(a.list().map((x) => x.id)).toEqual(['back', 'size']);
    expect(a.list()[0]?.kind).toBe('hidden');
    expect(a.list()[1]?.kind).toBe('scale');
    expect(a.asks).toHaveLength(0);
    a.block({ kind: 'contradiction', stage: 'evidence', text: 'two photos disagree', unblock: 'send one photo' });
    a.block({ kind: 'contradiction', stage: 'evidence', text: 'two photos disagree', unblock: 'send one photo' });
    expect(a.asks).toHaveLength(1);
    expect(AssumptionsLedger.restore(JSON.parse(JSON.stringify(a.snapshot()))).list()).toHaveLength(2);
  });
  it('hashes the bytes of a data URL with SHA-256 and builds a record that says what it does not know', async () => {
    const h = await hashDataUrl(`data:text/plain;base64,${Buffer.from('abc').toString('base64')}`);
    expect(h).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const p = buildProvenance({ hash: h, size: { width: 10, height: 5 }, footprint: { width: 4, depth: 3, ceiling: 2.5 }, scaleBasis: 'door height', assumptions: [], stages: [], repairs: [], open: [], rounds: 2, models: ['m'] });
    expect(p.source).toEqual({ sha256: h, width: 10, height: 5, stored: false });
    expect(p.permission.publication).toMatch(/Not stated/);
    expect(p.limits.join(' ')).toMatch(/hidden surfaces/);
  });
});

describe('staged photo run (scripted model)', () => {
  it('blocks at the capability stage with the exact reason and builds nothing when only the offline planner is there', async () => {
    const host = new KitHost();
    const events = await collect(new WorldAgent({ provider: createMockProvider(), catalogs: TEST_CATALOGS, maxTurns: 4, photo: { harness: true } }).run('make this bedroom in 3d', host, { images: [fakePhoto(1920, 1280)] }));
    const ph = photoEvents(events);
    const blocked = ph.find((e) => e.stages?.some((s) => s.id === 'capability' && s.status === 'blocked'));
    expect(blocked?.text).toMatch(/needs a connected assistant/);
    expect(blocked?.text).toMatch(/Nothing further was built/);
    expect(ph.some((e) => e.phase === 'offline')).toBe(true);
    expect(Object.keys(host.getWorld().entities)).toHaveLength(0);
  });

  const script = (): Parameters<typeof scripted>[0] => [
    () => [call('describe_room', { description: rawDescription() })],
    // Round 1, turn 1: the list (with causes), the gates (materials pass without evidence), a geometry repair that skips the camera, and an edit with no declaration.
    () => [
      call('report_differences', { differences: [{ id: 'fov', cause: 'camera', where: 'whole', what: 'the room is too wide in the picture', size: 4 }, { id: 'picture-height', kind: 'position', where: 'north wall', what: 'picture hangs low', size: 4 }, { id: 'wall-hue', kind: 'colour', what: 'wall reads cooler', size: 2 }] }),
      call('stage_gate', { gates: [{ stage: 'evidence', verdict: 'pass', evidence: 'the description lists the walls, windows and bed the photo shows' }, { stage: 'camera', verdict: 'fail', evidence: 'the horizon sits too high' }, { stage: 'materials', verdict: 'pass', evidence: '' }] }),
      verdicts(['item-picture-left']),
      call('declare_repair', { difference: 'picture-height', cause: 'geometry', why: 'picture first' }),
      call('edit_items', { edits: [{ op: 'move', ref: 'picture-left', wall: 'north', t: 2.0 }] }),
    ],
    // Turn 2: camera first. The geometry edit under a camera declaration is refused; the camera move applies.
    () => [
      call('declare_repair', { difference: 'fov', cause: 'camera', why: 'widen the view' }),
      call('set_photo_camera', { fov: 72 }),
      call('edit_items', { edits: [{ op: 'move', ref: 'picture-left', wall: 'north', t: 2.0 }] }),
    ],
    // Round 2: the camera difference is fixed, the picture is next (geometry), then its edit applies.
    () => [
      call('report_differences', { differences: [{ id: 'fov', what: 'ok now', size: 0, status: 'fixed' }, { id: 'picture-height', what: 'picture hangs low', size: 4, status: 'same' }, { id: 'wall-hue', what: 'wall reads cooler', size: 2, status: 'same' }] }),
      call('stage_gate', { gates: [{ stage: 'camera', verdict: 'pass', evidence: 'the horizon and wall edges now land where the photo has them' }] }),
      verdicts(['item-picture-left']),
      call('declare_repair', { difference: 'picture-height', cause: 'geometry', why: 'now the geometry' }),
      call('edit_items', { edits: [{ op: 'move', ref: 'picture-left', wall: 'north', t: 2.3 }] }),
    ],
    // Round 3: everything fixed; the remaining stage verdicts.
    () => [
      call('report_differences', { differences: [{ id: 'picture-height', what: 'ok', size: 0, status: 'fixed' }, { id: 'wall-hue', what: 'ok', size: 0, status: 'fixed' }] }),
      call('stage_gate', { gates: ['shell', 'furniture', 'materials', 'lighting'].map((stage) => ({ stage, verdict: 'pass', evidence: `the ${stage} matches in the side-by-side view` })) }),
      verdicts([]),
    ],
  ];

  it('walks the stages: gates need evidence, repairs go camera before geometry, the camera tool moves the camera, the books end in a provenance record and a resume state', async () => {
    const provider = scripted(script());
    const host = new KitHost();
    const photo = fakePhoto(1920, 1280);
    const events = await collect(agent(provider).run('make this bedroom in 3d', host, { images: [photo], photoPermission: 'My own photo of my own room.' }));
    // The tools of the round and the staged text in the user turn (the system prompt carries none of it).
    const r1 = provider.requests[1]!;
    expect(r1.tools?.map((t) => t.name)).toEqual(expect.arrayContaining(['stage_gate', 'declare_repair', 'set_photo_camera', 'report_differences']));
    expect(lastText(r1)).toContain('STAGES AND REPAIR ORDER');
    expect(r1.system).not.toContain('declare_repair');
    // Refusals the model saw.
    const r1b = lastText(provider.requests[2]!);
    expect(r1b).toMatch(/Repair order: camera comes before geometry/);
    expect(r1b).toMatch(/Say what you repair first/);
    expect(r1b).toMatch(/a pass needs evidence/);
    // The camera move and the wrong-tool refusal.
    const r2 = lastText(provider.requests[3]!);
    expect(r2).toMatch(/Camera: fov \d+(\.\d+)? to 72/);
    expect(r2).toMatch(/You declared a camera repair/);
    // Round 2 shows the repair order from the ledger.
    expect(lastText(provider.requests[3]!)).toBeDefined();
    expect(JSON.stringify(provider.requests[4]!.messages)).toContain('Repair order (camera, then geometry');
    // Per-stage events for the chat checklist.
    const staged = photoEvents(events).filter((e) => e.stages);
    expect(staged.length).toBeGreaterThanOrEqual(5);
    expect(staged[0]?.stages?.find((s) => s.id === 'capability')?.status).toBe('passed');
    const done = photoEvents(events).find((e) => e.phase === 'done');
    const st = Object.fromEntries((done?.stages ?? []).map((s) => [s.id, s.status]));
    expect(st).toMatchObject({ capability: 'passed', evidence: 'passed', camera: 'passed', shell: 'passed', furniture: 'passed', materials: 'passed', lighting: 'passed', repair: 'passed', crosscheck: 'skipped', delivery: 'passed' });
    // Provenance: hash of the photo, the permission note, assumptions with confidence, repairs in order, honest limits.
    const prov = done?.provenance;
    expect(prov?.source.sha256).toBe(await hashDataUrl(photo));
    expect(prov?.permission.localProcessing).toBe('My own photo of my own room.');
    expect(prov?.assumptions.length).toBeGreaterThan(0);
    expect(prov?.assumptions.every((a) => a.confidence >= 0 && a.confidence <= 1)).toBe(true);
    expect(prov?.repairs.map((r) => r.cause)).toEqual(['camera', 'geometry']);
    expect(prov?.rounds).toBe(3);
    expect(done?.resume?.sha256).toBe(prov?.source.sha256);
  });

  it('continues at the repair stage from the saved state: no second reading of the photo, the books come back', async () => {
    const photo = fakePhoto(1920, 1280);
    const host = new KitHost();
    // First run stops with a difference open (the model finishes in round 1 with the list unresolved).
    const first = scripted([
      () => [call('describe_room', { description: rawDescription() })],
      () => [call('report_differences', { differences: [{ id: 'rug', cause: 'geometry', what: 'rug is a third smaller', size: 4 }] }), gateAll('pass'), verdicts([]), call('finish', { message: 'stopping here' })],
    ]);
    const ev1 = await collect(agent(first).run('make this bedroom in 3d', host, { images: [photo] }));
    const done1 = photoEvents(ev1).find((e) => e.phase === 'done');
    expect(done1?.resume).toBeDefined();
    expect(done1?.differences?.map((d) => d.id)).toEqual(['rug']);
    // A photo with other bytes does not resume.
    const other = scripted([() => [call('describe_room', { description: rawDescription() })], () => [verdicts([])], () => [call('finish', { message: 'x' })]]);
    await collect(agent(other).run('make this bedroom in 3d', new KitHost(), { images: [fakePhoto(1280, 1920)], photoResume: done1!.resume! }));
    expect(other.requests[0]?.tools?.map((t) => t.name)).toContain('describe_room');
    // The same photo resumes.
    const second = scripted([
      () => [call('report_differences', { differences: [{ id: 'rug', what: 'ok', size: 0, status: 'fixed' }] }), verdicts([])],
    ]);
    const ev2 = await collect(agent(second).run('keep going', host, { images: [photo], photoResume: done1!.resume!, photo: 'recreate', intent: 'refine' }));
    expect(second.requests[0]?.tools?.map((t) => t.name)).not.toContain('describe_room');
    expect(photoEvents(ev2).some((e) => /Continuing the repair/.test(e.text))).toBe(true);
    expect(lastText(second.requests[0]!)).toContain('rug');
    const done2 = photoEvents(ev2).find((e) => e.phase === 'done');
    expect(done2?.differences).toBeUndefined();
    expect(done2?.stages?.find((s) => s.id === 'repair')?.status).toBe('passed');
    expect(done2?.stages?.find((s) => s.id === 'evidence')?.status).toBe('passed');
  });

  it('a blocked verdict stops the run and the closing message names the blocker; nothing is claimed past it', async () => {
    const provider = scripted([
      () => [call('describe_room', { description: rawDescription() })],
      () => [call('stage_gate', { gates: [{ stage: 'evidence', verdict: 'blocked', evidence: '', blocker: 'the photo shows a corridor, not the room that was asked for' }] }), verdicts([])],
    ]);
    const events = await collect(agent(provider).run('make this bedroom in 3d', new KitHost(), { images: [fakePhoto(1920, 1280)] }));
    const done = photoEvents(events).find((e) => e.phase === 'done');
    expect(done?.text).toMatch(/Stopped: the evidence stage is blocked\. the photo shows a corridor/);
    expect(done?.stages?.find((s) => s.id === 'evidence')?.status).toBe('blocked');
    expect(done?.stages?.find((s) => s.id === 'repair')?.status).not.toBe('passed');
  });

  it('is off unless asked for: no stage tools, no stage events', async () => {
    const provider = scripted([() => [call('describe_room', { description: rawDescription() })], () => [verdicts([])], () => [call('finish', { message: 'done' })]]);
    const events = await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS, maxTurns: 10, photo: { judges: 0, reads: 1 } }).run('make this bedroom in 3d', new KitHost(), { images: [fakePhoto(1920, 1280)] }));
    expect(provider.requests[1]?.tools?.map((t) => t.name)).not.toContain('stage_gate');
    expect(photoEvents(events).some((e) => e.stages)).toBe(false);
  });
});
