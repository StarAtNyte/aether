import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createWorld } from '@aether/core';
import { PHOTO_BUILDING_ID, deriveBuild, memoryCaller, parseRoomDescription, runBuild } from '@aether/arch/photo';
import { partKinds, readScene } from '@aether/arch';
import { ObjectLedger, type InventoryItem } from '../src/photo/objects';
import { applyDecisions, backWallIndex, buildFromMeasurements, makeBuildPlan, parseDecisions, placeItemsOf, planText, refusalsOf, roomToWorld, surfaceOps, BUILD_PLAN_TOOL_NAME } from '../src/photo/perception/buildplan';
import type { PerceivedObject, PerceptionReport } from '../src/photo/perception/perceive';
import type { CompletionRequest, CompletionResponse } from '../src/types';

const parsed = parseRoomDescription(JSON.parse(readFileSync(resolve(__dirname, '../../../tests/fixtures/photo/hotel.description.json'), 'utf8')) as unknown, partKinds());
if (!parsed.ok) throw new Error(parsed.error);
// An empty shell of the hotel room: 3.7 x 4.5 m, the camera at (3.35, 4.25) looking north-west (the north wall is the back wall).
const d = { ...parsed.value, items: [] };
const SHELL = { width: d.footprint.width, depth: d.footprint.depth, ceiling: d.footprint.ceiling };
const CAM = { x: d.camera.x, z: d.camera.z, heading: d.camera.heading };

const sw = (hex: string): { hex: string; lab: [number, number, number]; share: number; name: string } => ({ hex, lab: [50, 0, 0], share: 1, name: 'x' });
const app = (hex: string, finish: 'matte' | 'satin' | 'glossy' = 'matte') => ({ colour: sw(hex), palette: [], luminance: 0.3, pattern: { kind: 'plain' as const, strength: 0 }, glareShare: 0, finish, pixels: 900 });

function obj(id: string, label: string, kind: 'floor' | 'wall' | 'surface' | 'ceiling', u: number, v: number, size: [number, number, number], y: [number, number], hex: string, confidence = 0.8, against: Array<{ wall: 'back' | 'left' | 'right'; gap: number }> = []): PerceivedObject {
  return {
    id, label, asked: null, source: 'measured', pass: 'generic', confidence, box: [0.1, 0.1, 0.4, 0.4], areaFraction: 0.1, mask: null,
    placement: { kind, centre: { x: u, z: v, frame: 'room' }, size: { w: size[0], d: size[1], h: size[2] }, y: { low: y[0], high: y[1] }, range: 3, against, samples: 400 },
    appearance: app(hex), relations: [],
  } as unknown as PerceivedObject;
}

function report(objects: PerceivedObject[]): PerceptionReport {
  return {
    version: 2, photo: { width: 1000, height: 667 }, models: { detector: 'x', segmenter: 'x', depth: 'x' }, unavailable: [], camera: null,
    room: { width: { value: 3.7, low: 3.4, high: 4, confidence: 'medium', basis: 'x' }, depth: { value: 4.5, low: 4, high: 5, confidence: 'medium', basis: 'x' }, height: { value: 2.85, low: 2.7, high: 3, confidence: 'medium', basis: 'x' }, cameraHeight: 1.3, camera: { x: 3.35, z: 4.25 }, walls: { back: true, left: true, right: true, ceiling: true, floor: true }, lines: {}, yawDeg: 0 },
    crossCheck: null, estimators: [], vanishing: null, surfaces: { floor: app('#8a6a4a'), ceiling: null, walls: app('#d8d2c4') }, illuminant: null, objects, notFound: [], caption: null, timingsMs: {}, notes: [],
  } as unknown as PerceptionReport;
}

const item = (o: PerceivedObject, kind = o.label, entities: string[] = []): InventoryItem => ({
  id: `inv-${o.id}`, kind, category: 'furniture', label: kind, box: o.box as InventoryItem['box'], relations: [], size: '', look: '', confidence: 0.8, occlusion: '', entities, linkedBy: entities.length > 0 ? 'model' : 'none', seen: 'both',
  measured: { id: o.id, colour: '', hex: o.appearance?.colour.hex ?? '', text: '' },
});

async function shell(): Promise<ReturnType<typeof memoryCaller>> {
  const mem = memoryCaller(createWorld({}));
  const built = await runBuild(mem.world(), deriveBuild(d), mem.call);
  expect(built.shellOk).toBe(true);
  return mem;
}

// A bed against the back (north) wall, a nightstand beside it with a lamp on it, a rug under the bed, a duplicate of the bed, a false sofa.
const bed = obj('p1', 'bed', 'floor', 2.55, 1.0, [1.7, 1.6, 1.0], [0, 1.0], '#c8b89a', 0.9, [{ wall: 'back', gap: 0.02 }]);
const stand = obj('p2', 'nightstand', 'floor', 1.3, 0.25, [0.48, 0.4, 0.55], [0, 0.55], '#6b4a2f', 0.8, [{ wall: 'back', gap: 0.03 }]);
const lamp = obj('p3', 'lamp', 'surface', 1.3, 0.25, [0.3, 0.3, 0.3], [0.58, 0.88], '#e8dcc0', 0.7);
const rug = obj('p4', 'rug', 'floor', 2.4, 1.7, [2.0, 1.4, 0.02], [0, 0.02], '#7a2e2e', 0.7);
const dup = obj('p5', 'bed', 'floor', 2.5, 1.1, [1.6, 1.5, 1.0], [0, 1.0], '#c0b090', 0.4, [{ wall: 'back', gap: 0.05 }]);
const sofa = obj('p6', 'sofa', 'floor', 2.8, 3.2, [1.9, 0.8, 0.9], [0, 0.9], '#334455', 0.35);
const objs = [bed, stand, lamp, rug, dup, sofa];

describe('frames', () => {
  it('maps the room frame to the world for each wall the camera can look at', () => {
    expect(backWallIndex(-38)).toBe(0);
    expect(backWallIndex(90)).toBe(1);
    expect(backWallIndex(180)).toBe(2);
    expect(backWallIndex(270)).toBe(3);
    expect(roomToWorld(1, 2, 0, 4, 6)).toEqual([1, 2]);
    expect(roomToWorld(1, 2, 1, 4, 6)).toEqual([2, 1]);
    expect(roomToWorld(1, 2, 2, 4, 6)).toEqual([3, 4]);
    expect(roomToWorld(1, 2, 3, 4, 6)).toEqual([2, 5]);
  });
});

describe('build plan from a perception report', () => {
  it('puts positions, sizes and colours where they were measured', async () => {
    const mem = await shell();
    const plan = makeBuildPlan({ items: objs.map((o) => item(o)), report: report(objs), shell: SHELL, camera: CAM, world: mem.world() });
    expect(plan.rows).toHaveLength(6);
    const by = Object.fromEntries(plan.rows.map((r) => [r.perceivedId, r]));
    // the bed stands against the north wall, 2.55 m along it (t includes the wall inset), its width is the measured one
    expect(by['p1']!.kind).toBe('bed');
    expect(by['p1']!.wall).toMatchObject({ compass: 'north' });
    expect(by['p1']!.wall!.t).toBeCloseTo(2.55 + 0.14, 1);
    expect(by['p1']!.fit![0]).toBeCloseTo(1.7, 1);
    expect(by['p1']!.hex).toBe('#c8b89a');
    // a lamp measured above the floor stands ON the nightstand (surface anchoring), not on the floor
    expect(by['p3']!.kind).toBe('table-lamp');
    expect(by['p3']!.on).toBe(by['p2']!.handle);
    // the rug snaps under the bed it overlaps
    expect(by['p4']!.kind).toBe('rug');
    expect(by['p4']!.at![0]).toBeCloseTo(by['p1']!.wall!.t - 0.14, 0);
    expect(by['p4']!.notes.join(' ')).toMatch(/snapped under/);
    // the second bed on the same ground is a duplicate of the first and dropped by default, with the reason
    expect(by['p5']!.action).toBe('drop');
    expect(by['p5']!.reason).toMatch(/same bed/);
    // the table the model reads names every row once
    const text = planText(plan);
    for (const o of objs) expect(text).toContain(`[${o.id}]`);
  });

  it('keeps a piece against the wall when the gap is small and stands it free when it is not', async () => {
    const mem = await shell();
    const free = obj('p9', 'chair', 'floor', 2.0, 2.4, [0.5, 0.5, 0.8], [0, 0.8], '#555555');
    const plan = makeBuildPlan({ items: [item(free), item(stand)], report: report([free, stand]), shell: SHELL, camera: CAM, world: mem.world() });
    const chair = plan.rows.find((r) => r.perceivedId === 'p9')!;
    expect(chair.wall).toBeNull();
    expect(chair.at![0]).toBeCloseTo(2.0, 1);
    expect(chair.at![1]).toBeCloseTo(2.4, 1);
    expect(chair.faces).not.toBeNull();
    expect(plan.rows.find((r) => r.perceivedId === 'p2')!.wall).toMatchObject({ compass: 'north' });
  });

  it('links a built piece that stands where it was measured, and proposes a move for one that does not', async () => {
    const mem = await shell();
    const placed = await mem.call('place_items', { items: [{ kind: 'bed', room: 'room', id: 'bed-a', wall: 'north', t: 2.69, gap: 0.02 }, { kind: 'nightstand', room: 'room', id: 'ns-a', at: [1.2, 1.4] }] });
    expect(placed.ok).toBe(true);
    const plan = makeBuildPlan({ items: [item(bed), item(stand)], report: report([bed, stand]), shell: SHELL, camera: CAM, world: mem.world() });
    const b = plan.rows.find((r) => r.perceivedId === 'p1')!;
    expect(b.action).toBe('keep');
    expect(b.entity).toBe(`${PHOTO_BUILDING_ID}-bed-a`);
    const n = plan.rows.find((r) => r.perceivedId === 'p2')!;
    expect(n.action).toBe('adjust');
    expect(n.at![0]).toBeCloseTo(1.3, 1);
  });

  it('sets floor and wall colours from the measured surfaces only when the shell is off by a visible amount', () => {
    const rep = report([]);
    const off = surfaceOps(rep, { floor: { color: '#ffffff' }, wallColor: '#d8d2c4' });
    expect(off.ops).toHaveLength(1);
    expect(off.ops[0]).toMatchObject({ op: 'set_material', target: 'floor' });
    expect(surfaceOps(rep, { floor: { color: '#8a6a4a' }, wallColor: '#d8d2c4' }).ops).toHaveLength(0);
  });
});

describe('decisions', () => {
  it('honours edits and drops, ignores a drop with no reason', async () => {
    const mem = await shell();
    const plan = makeBuildPlan({ items: objs.map((o) => item(o)), report: report(objs), shell: SHELL, camera: CAM, world: mem.world() });
    const parsedD = parseDecisions({ decisions: [{ n: 6, verdict: 'drop', reason: 'no sofa in this room, a coat on the chair' }, { n: 4, verdict: 'drop' }, { n: 2, verdict: 'edit', color: '#112233', w: 0.5 }, { n: 99, verdict: 'accept' }, { n: 'x' }] });
    expect(parsedD!.skipped).toBe(1);
    const got = applyDecisions(plan, parsedD!.decisions);
    expect(plan.rows[5]!.action).toBe('drop');
    expect(plan.rows[5]!.reason).toMatch(/no sofa/);
    expect(plan.rows[3]!.action).toBe('place');
    expect(got.ignored.join(' ')).toMatch(/needs a reason/);
    expect(got.ignored.join(' ')).toMatch(/no such row/);
    expect(plan.rows[1]!.hex).toBe('#112233');
    expect(plan.rows[1]!.fit![0]).toBe(0.5);
  });

  it('parses the refusals of a place_items reply', () => {
    const m = refusalsOf('[1 bed] placed\n[2 sofa] refused: no room: it would overlap the bed.\n  Move it 0.3 m.\n[3 rug] placed');
    expect([...m.keys()]).toEqual([2]);
    expect(m.get(2)).toMatch(/overlap the bed/);
  });
});

describe('the first build from the measurements', () => {
  it('shows the plan, honours the model\'s edits and drops, places one batch and links the ledger', async () => {
    const mem = await shell();
    const ledger = new ObjectLedger();
    ledger.load(objs.map((o) => item(o)));
    const seen: CompletionRequest[] = [];
    const complete = async (req: CompletionRequest): Promise<CompletionResponse> => {
      seen.push(req);
      return {
        content: [{ type: 'tool_use', id: 't1', name: BUILD_PLAN_TOOL_NAME, input: { decisions: [{ n: 6, verdict: 'drop', reason: 'false detection: a coat over a chair' }, { n: 2, verdict: 'edit', color: '#223344' }] } }],
        stopReason: 'tool_use', usage: { inputTokens: 0, outputTokens: 0 },
      } as unknown as CompletionResponse;
    };
    let placeCalls = 0;
    const rejected = new Map<string, string>();
    const gen = buildFromMeasurements({
      rejected: (id, why) => { rejected.set(id, why); },
      report: report(objs),
      items: () => ledger.list().map((r) => r.item),
      link: (id, ents) => { const r = ledger.get(id)!; r.item = { ...r.item, entities: [...new Set([...r.item.entities, ...ents])], linkedBy: 'model' }; },
      world: () => mem.world(),
      shell: SHELL, camera: CAM,
      complete,
      photoUrl: 'data:image/png;base64,AAAA',
      tool: async (name, input) => {
        if (name === 'place_items') placeCalls++;
        if (name === 'build_architecture') return { content: 'ok', isError: false, edited: true, events: [] };
        const r = await mem.call(name as 'place_items', input);
        return { content: r.text, isError: !r.ok, edited: r.ok, events: [] };
      },
    });
    let step = await gen.next();
    while (!step.done) step = await gen.next();
    const out = step.value;
    // the model saw the table (every row once) and the photo
    const first = seen[0]!;
    const txt = JSON.stringify(first.messages[0]!.content);
    expect(txt).toContain('Build plan from the measurements');
    expect(txt).toContain('[p6]');
    expect(first.tools?.[0]?.name).toBe(BUILD_PLAN_TOOL_NAME);
    // one batch
    expect(placeCalls).toBe(1);
    expect(out.dropped).toBeGreaterThanOrEqual(2);
    const world = mem.world();
    const scene = readScene(world, PHOTO_BUILDING_ID)!;
    const kinds = scene.items.map((i) => i.kind);
    expect(kinds).toContain('bed');
    expect(kinds).toContain('nightstand');
    expect(kinds).toContain('table-lamp');
    expect(kinds).not.toContain('sofa');
    // the bed landed where it was measured (against the north wall near x 2.55)
    const b = scene.items.find((i) => i.kind === 'bed')!;
    expect(b.pos[0]).toBeGreaterThan(2.1);
    expect(b.pos[0]).toBeLessThan(3.1);
    expect(b.pos[2]).toBeLessThan(1.6);
    // the colour edit reached the piece
    const ns = scene.items.find((i) => i.kind === 'nightstand')!;
    expect(JSON.stringify(world.entities[ns.id]!.shape)).toContain('#223344');
    // every placed object is linked in the ledger, entity <-> perceived id; the dropped ones are not
    const linkedIds = ledger.list().filter((r) => r.item.entities.length > 0).map((r) => r.item.measured!.id);
    expect(linkedIds).toEqual(expect.arrayContaining(['p1', 'p2', 'p3', 'p4']));
    expect(linkedIds).not.toContain('p6');
    expect(placeItemsOf(out.plan).map((p) => p.row.perceivedId)).not.toContain('p6');
    expect(out.linked).toBeGreaterThanOrEqual(4);
    expect(rejected.get('inv-p6')).toMatch(/false detection/);
    expect(rejected.get('inv-p5')).toMatch(/same bed/);
  });

  it('builds the plan as made when the assistant gives no usable decisions', async () => {
    const mem = await shell();
    const ledger = new ObjectLedger();
    ledger.load([item(bed), item(stand)]);
    const gen = buildFromMeasurements({
      report: report([bed, stand]),
      items: () => ledger.list().map((r) => r.item),
      link: (id, ents) => { const r = ledger.get(id)!; r.item = { ...r.item, entities: ents }; },
      world: () => mem.world(), shell: SHELL, camera: CAM,
      complete: async () => ({ content: [{ type: 'text', text: 'looks fine' }], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } }) as unknown as CompletionResponse,
      photoUrl: 'data:image/png;base64,AAAA',
      tool: async (name, input) => { if (name === 'build_architecture') return { content: 'ok', isError: false, edited: true, events: [] }; const r = await mem.call(name as 'place_items', input); return { content: r.text, isError: !r.ok, edited: r.ok, events: [] }; },
    });
    let step = await gen.next();
    while (!step.done) step = await gen.next();
    expect(step.value.placed).toBe(2);
    expect(ledger.list().every((r) => r.item.entities.length > 0)).toBe(true);
  });
});

describe('offline fallback', () => {
  it('has nothing to plan without a perception report: no rows, nothing placed, the flow is unchanged', async () => {
    const mem = await shell();
    const before = JSON.stringify(mem.world().entities);
    const ledger = new ObjectLedger();
    ledger.load([{ ...item(bed), measured: undefined } as InventoryItem]);
    const plan = makeBuildPlan({ items: ledger.list().map((r) => r.item), report: report([]), shell: SHELL, camera: CAM, world: mem.world() });
    expect(plan.rows).toHaveLength(0);
    const gen = buildFromMeasurements({
      report: report([]), items: () => ledger.list().map((r) => r.item), link: () => undefined, world: () => mem.world(), shell: SHELL, camera: CAM,
      complete: async () => { throw new Error('no model call is made without a plan'); },
      photoUrl: '', tool: async () => { throw new Error('no tool call is made without a plan'); },
    });
    let step = await gen.next();
    while (!step.done) step = await gen.next();
    expect(step.value.placed).toBe(0);
    expect(JSON.stringify(mem.world().entities)).toBe(before);
  });
});
