import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld, type Patch, type WorldDoc } from '@aether/core';
import { PHOTO_BUILDING_ID, deriveBuild, memoryCaller, parseRoomDescription, photoCameraSpec, runBuild } from '@aether/arch/photo';
import { customPose, partKinds, renderInstanceIds } from '@aether/arch';
import { compareObjects } from '../src/photo/objects-measure';
import { ObjectLedger, type InventoryItem } from '../src/photo/objects';
import { encodeRle, type PerceptionReport } from '../src/photo/perception/perceive';

const parsed = parseRoomDescription(JSON.parse(readFileSync(resolve(__dirname, '../../../tests/fixtures/photo/hotel.description.json'), 'utf8')) as unknown, partKinds());
if (!parsed.ok) throw new Error(parsed.error);
const d = parsed.value;
const ASPECT = 1.5;
const BED = `${PHOTO_BUILDING_ID}-bed`;

async function room(): Promise<WorldDoc> {
  const mem = memoryCaller(createWorld({}));
  return (await runBuild(mem.world(), deriveBuild(d), mem.call)).world;
}
function shifted(world: WorldDoc, ref: string): WorldDoc {
  const e = world.entities[ref]!;
  const p = e.transform.position;
  const res = applyPatches(world, [{ op: 'update', id: ref, set: { transform: { position: [p[0] - 0.9, p[1], p[2] + 1.1] } } }] as unknown as Patch[]);
  if (res.errors.length > 0) throw new Error(JSON.stringify(res.errors));
  return res.world;
}
const pose = (w: WorldDoc) => customPose(w, PHOTO_BUILDING_ID, photoCameraSpec(d, ASPECT))!;
const maskOf = (inst: NonNullable<ReturnType<typeof renderInstanceIds>>, id: string): Uint8Array => {
  const k = inst.ids.indexOf(id) + 1;
  return Uint8Array.from(inst.buffer, (v) => (k > 0 && v === k ? 1 : 0));
};
const area = (m: ArrayLike<number>): number => { let n = 0; for (let i = 0; i < m.length; i++) if (m[i]) n++; return n; };

describe('instance-id render of a built room', () => {
  it('draws pieces, floor and walls with occlusion; a moved piece moves its mask', async () => {
    const world = await room();
    const inst = renderInstanceIds(world, PHOTO_BUILDING_ID, pose(world), ASPECT, 192)!;
    expect(inst).not.toBeNull();
    expect(area(maskOf(inst, BED))).toBeGreaterThan(inst.width * inst.height * 0.02);
    expect(inst.ids.some((i) => i.startsWith('floor:'))).toBe(true);
    expect(inst.ids.some((i) => i.startsWith('wall:'))).toBe(true);
    expect(inst.buffer.reduce((a, v) => a + (v === 0 ? 1 : 0), 0) / inst.buffer.length).toBeLessThan(0.2);
    const cx = (m: Uint8Array): number => { let s = 0, n = 0; m.forEach((v, i) => { if (v) { s += i % inst.width; n++; } }); return s / Math.max(1, n); };
    const moved = shifted(world, BED);
    const inst2 = renderInstanceIds(moved, PHOTO_BUILDING_ID, pose(world), ASPECT, 192)!;
    expect(Math.abs(cx(maskOf(inst2, BED)) - cx(maskOf(inst, BED)))).toBeGreaterThan(1);
  });
});

describe('measured comparison of a built object with the photo', () => {
  async function setup(photoWorld: WorldDoc, buildWorld: WorldDoc, photoHex: string, renderRgb: [number, number, number]) {
    const W = 256;
    const pi = renderInstanceIds(photoWorld, PHOTO_BUILDING_ID, pose(photoWorld), ASPECT, W)!;
    const bi = renderInstanceIds(buildWorld, PHOTO_BUILDING_ID, pose(buildWorld), ASPECT, W)!;
    const H = bi.height;
    const photoMask = maskOf(pi, BED);
    const render = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
    const bm = maskOf(bi, BED);
    for (let i = 0; i < W * H; i++) render.data.set(bm[i] ? [...renderRgb, 255] : [150, 150, 150, 255], i * 4);
    const hx = photoHex;
    const rep = {
      version: 2, photo: { width: W, height: H }, models: { detector: null, segmenter: null, depth: null }, unavailable: [], camera: null, room: null, crossCheck: null, estimators: [], vanishing: null,
      surfaces: { floor: null, ceiling: null, walls: null }, illuminant: null, notFound: [], caption: null, timingsMs: {}, notes: [],
      objects: [{ id: 'p1', label: 'bed', asked: null, source: 'measured', pass: 'generic', confidence: 0.9, box: [0, 0, 1, 1], areaFraction: area(photoMask) / (W * H), mask: { rle: encodeRle({ width: W, height: H, data: photoMask }), score: 0.9, areaFraction: 0.1 }, placement: null, appearance: { colour: { hex: hx, lab: [50, 0, 0], share: 1, name: 'x' }, palette: [], luminance: 0.3, pattern: { kind: 'plain', strength: 0 }, glareShare: 0, finish: 'matte', pixels: 100 }, relations: [] }],
    } as unknown as PerceptionReport;
    const ledger = new ObjectLedger();
    const item: InventoryItem = { id: 'bed-1', kind: 'bed', category: 'furniture', label: 'bed', box: [0, 0, 1, 1], relations: [], size: '', look: '', confidence: 0.9, occlusion: '', entities: [BED], linkedBy: 'model', seen: 'both', measured: { id: 'p1', colour: '', hex: hx, text: '' } };
    ledger.load([item]);
    return compareObjects({ world: buildWorld, pose: pose(buildWorld), aspect: ASPECT, report: rep, ledger, render, px: { w: 1000, h: Math.round(1000 / ASPECT) } })!;
  }

  it('reads an identical build as match, with the same colour', async () => {
    const world = await room();
    const m = await setup(world, world, '#8c8c8c', [140, 140, 140]);
    const r = m.rows[0]!;
    expect(r.iou).toBeGreaterThan(0.95);
    expect(['match', 'close']).toContain(r.verdict);
    expect(m.counts.match + m.counts.close).toBe(1);
  });

  it('finds a moved piece off, says which way, and a wrong colour says apply_measured_colour', async () => {
    const world = await room();
    const moved = shifted(world, BED);
    const m = await setup(world, moved, '#1b2a4a', [200, 60, 60]);
    const r = m.rows[0]!;
    expect(r.iou).toBeLessThan(0.6);
    expect(['off', 'near']).toContain(r.verdict);
    expect(r.hint).toMatch(/left|right|above|below|hidden/);
    expect(r.deltaE).toBeGreaterThan(20);
    expect(r.hint).toContain('apply_measured_colour');
    expect(m.text).toContain('Measured comparison');
  });
});
