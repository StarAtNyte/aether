/**
 * Oracle tests of the pipeline's own geometry and comparison, with the TRUE world standing in for a perfect build:
 *  - projection: the true pieces projected through the pipeline's camera (the photo camera spec of the description, and a plain
 *    pose) and rasterised by `renderInstanceIds` must reproduce the true per-pixel masks of the real renderer. A low number is a
 *    bug in the raster or the camera convention (field of view, heading, pitch, handedness, aspect, level offset), or a limit of
 *    the raster (it draws each piece as the prism of its footprint, so legs, backs and curtains are overdrawn).
 *  - comparison: `compareObjects` between the true world and the photo, with the true masks as the photo's masks (nothing left to
 *    measure wrongly): every object should read match or close.
 */
import { measureAppearance, photoCameraSpec, type RoomDescription, type Appearance } from '@aether/arch/photo';
import { customPose, renderInstanceIds, type ReviewPose, type UnitMesh } from '@aether/arch';
import type { WorldDoc } from '@aether/core';
import { ObjectLedger, type InventoryItem } from '../objects';
import { compareObjects, type Measured } from '../objects-measure';
import { encodeRle, PERCEPTION_VERSION, type PerceivedObject, type PerceptionReport } from '../perception/perceive';
import type { Raster } from '../score';
import { decodeMasks, type TruthMasks } from './fixture';
import { labelMask, maskIou, median, type SelftestTruth } from './metrics';
import { basis } from './truth';

const r2 = (v: number | null): number | null => (v === null ? null : Math.round(v * 100) / 100);

/** The pose the pipeline derives from a description holding the TRUE camera and room (the photo camera spec, then the custom pose). */
export function pipelinePose(world: WorldDoc, t: SelftestTruth): ReviewPose | null {
  const [x0, z0, x1, z1] = t.room.bbox;
  // the description's footprint starts at the plan origin; a photo room's interior reaches 0.14 m beyond it on every side
  const inset = x0 < -0.05 ? -x0 : 0;
  const d = {
    camera: { x: t.camera.plan.at[0], z: t.camera.plan.at[1], height: t.camera.plan.height, heading: t.camera.heading, pitch: t.camera.pitch, fov: t.camera.hfov },
    footprint: { width: x1 - x0 - 2 * inset, depth: z1 - z0 - 2 * inset, ceiling: t.room.height },
  } as unknown as RoomDescription;
  return customPose(world, t.room.building, photoCameraSpec(d, t.camera.aspect));
}

/** The same camera as a plain pose from the truth (position, target on the optical axis, vertical field of view). */
export function plainPose(t: SelftestTruth): ReviewPose {
  const { fwd } = basis(t.camera.heading, t.camera.pitch);
  return { name: 'truth', label: 'truth', room: 'x', kind: 'corner', position: t.camera.pos, target: [t.camera.pos[0] + fwd[0] * 5, t.camera.pos[1] + fwd[1] * 5, t.camera.pos[2] + fwd[2] * 5], up: [0, 1, 0], fov: t.camera.vfov, hideTops: false };
}

export interface ProjectionResult {
  rows: Array<{ id: string; kind: string; iou: number; truthPx: number; rasterPx: number }>;
  median: number | null;
  /** Median over the pieces covering at least 1 percent of the frame. */
  medianLarge: number | null;
  structure: { floor: number; ceiling: number; wall: number };
}

export function projectionOracle(world: WorldDoc, pose: ReviewPose, t: SelftestTruth, m: TruthMasks, meshes?: ReadonlyMap<string, UnitMesh>): ProjectionResult | null {
  const inst = renderInstanceIds(world, t.room.building, pose, t.camera.aspect, m.width, m.height, meshes);
  if (!inst) return null;
  const dec = decodeMasks(m);
  const maskOf = (re: (id: string) => boolean): Uint8Array => {
    const keep = new Uint8Array(inst.ids.length + 1);
    inst.ids.forEach((id, i) => { if (re(id)) keep[i + 1] = 1; });
    const out = new Uint8Array(m.width * m.height);
    for (let k = 0; k < out.length; k++) if (keep[inst.buffer[k] as number]) out[k] = 1;
    return out;
  };
  const rows: ProjectionResult['rows'] = [];
  for (const it of t.items) {
    const tm = labelMask(m, it.id, dec);
    let tn = 0;
    for (let k = 0; k < tm.length; k++) tn += tm[k] as number;
    if (tn < m.width * m.height * 0.0015) continue;
    const rm = maskOf((id) => id === it.id);
    let rn = 0;
    for (let k = 0; k < rm.length; k++) rn += rm[k] as number;
    rows.push({ id: it.id, kind: it.kind, iou: r2(maskIou(tm, rm)) as number, truthPx: tn, rasterPx: rn });
  }
  const st = (label: string, re: RegExp): number => r2(maskIou(labelMask(m, label, dec), maskOf((id) => re.test(id)))) as number;
  return {
    rows,
    median: r2(median(rows.map((r) => r.iou))),
    medianLarge: r2(median(rows.filter((r) => r.truthPx >= m.width * m.height * 0.01).map((r) => r.iou))),
    structure: { floor: st('floor', /^floor:/), ceiling: st('ceiling', /^ceiling:/), wall: st('wall', /^wall:/) },
  };
}

/** A synthetic perception report whose masks are the TRUE masks and whose colours are read from the photo under them. */
export function oracleReport(base: PerceptionReport, t: SelftestTruth, m: TruthMasks, photo: Raster): { report: PerceptionReport; ledger: ObjectLedger } {
  const dec = decodeMasks(m);
  const objects: PerceivedObject[] = [];
  const items: InventoryItem[] = [];
  const bbox = (mask: Uint8Array): [number, number, number, number] | null => {
    let x0 = m.width, y0 = m.height, x1 = -1, y1 = -1;
    for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) if (mask[y * m.width + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return x1 < 0 ? null : [x0 / m.width, y0 / m.height, (x1 + 1) / m.width, (y1 + 1) / m.height];
  };
  const read = (mask: Uint8Array, box: [number, number, number, number], dominant = false): Appearance | null => measureAppearance(photo, { width: m.width, height: m.height, data: mask }, box, dominant ? { dominant: true } : {});
  let n = 0;
  for (const it of t.items) {
    const mask = labelMask(m, it.id, dec);
    let px = 0;
    for (let k = 0; k < mask.length; k++) px += mask[k] as number;
    const box = bbox(mask);
    if (!box || px < m.width * m.height * 0.0015) continue;
    n++;
    const pid = `o${n}`;
    const frac = px / (m.width * m.height);
    objects.push({ id: pid, label: it.kind, asked: null, source: 'measured', pass: 'generic', confidence: 1, box, areaFraction: frac, mask: { rle: encodeRle({ width: m.width, height: m.height, data: mask }), score: 1, areaFraction: frac }, placement: null, appearance: read(mask, box), relations: [] });
    items.push({ id: `i${n}`, kind: it.kind, category: 'furniture' as InventoryItem['category'], label: it.kind, box, relations: [], size: '', look: '', confidence: 1, occlusion: '', entities: [it.id], linkedBy: 'model', seen: 'measured', measured: { id: pid, colour: '', hex: '', text: '' } });
  }
  const plane = (label: string): Appearance | null => {
    const mask = labelMask(m, label, dec);
    const box = bbox(mask);
    return box ? read(mask, box, true) : null;
  };
  const report: PerceptionReport = { ...base, version: PERCEPTION_VERSION, objects, surfaces: { floor: plane('floor'), walls: plane('wall'), ceiling: plane('ceiling') }, illuminant: null };
  const ledger = new ObjectLedger();
  ledger.load(items);
  return { report, ledger };
}

export interface ComparisonResult {
  counts: Measured['counts'];
  total: number;
  /** Share of objects reading match or close. */
  goodShare: number | null;
  medianIou: number | null;
  medianDeltaE: number | null;
  surfaces: Array<{ surface: string; deltaE: number | null; rawDeltaE: number | null | undefined }>;
  worst: Array<{ label: string; id: string; verdict: string; iou: number | null; deltaE: number | null }>;
}

/** `compareObjects` on the true world (the perfect build) against the photo with the true masks. */
export function comparisonOracle(world: WorldDoc, pose: ReviewPose, t: SelftestTruth, m: TruthMasks, photo: Raster, base: PerceptionReport, meshes?: ReadonlyMap<string, UnitMesh>): ComparisonResult | null {
  const { report, ledger } = oracleReport(base, t, m, photo);
  const res = compareObjects({ world, pose, aspect: t.camera.aspect, report, ledger, render: photo, px: { w: t.photo.width, h: t.photo.height }, building: t.room.building, ...(meshes ? { meshes } : {}) });
  if (!res) return null;
  const total = res.rows.length;
  const good = res.counts.match + res.counts.close;
  return {
    counts: res.counts, total,
    goodShare: total ? r2(good / total) : null,
    medianIou: r2(median(res.rows.map((r) => r.iou).filter((x): x is number => x !== null))),
    medianDeltaE: r2(median(res.rows.map((r) => r.deltaE).filter((x): x is number => x !== null))),
    surfaces: res.surfaces.map((s) => ({ surface: s.surface, deltaE: s.deltaE, rawDeltaE: s.rawDeltaE })),
    worst: res.rows.filter((r) => r.verdict !== 'match' && r.verdict !== 'close').sort((a, b) => (a.iou ?? 0) - (b.iou ?? 0)).slice(0, 6).map((r) => ({ label: r.label, id: r.id, verdict: r.verdict, iou: r.iou, deltaE: r.deltaE })),
  };
}
