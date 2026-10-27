/**
 * Stage-by-stage error metrics of the photo pipeline against the truth of a self-test photo. Pure functions: no model, no
 * renderer. Each stage is scored alone, so a bad total can be traced to the stage that made it (camera, room box, depth,
 * detection and masks, back-projection, colour) and told apart from the model's own choices later on.
 */
import { deltaE2000, hexToLab, normaliseHex, measureAppearance, type Appearance } from '@aether/arch/photo';
import { decodeRle, type PerceivedObject, type PerceptionReport } from '../perception/perceive';
import { decodeMasks, type TruthMasks } from './fixture';
import { planToRoom, type TruthCamera, type TruthItem, type TruthRoom } from './truth';

export interface SelftestTruth {
  world: string;
  pose: string;
  photo: { width: number; height: number };
  camera: TruthCamera;
  room: TruthRoom;
  items: Array<TruthItem & { visible: { centre: { u: number; v: number }; size: { w: number; d: number; h: number }; low: number; high: number; samples: number; area: number } | null }>;
  levelY: number;
  surfaces: Record<string, number>;
  surfaceColours: { floor: string | null; walls: string | null; ceiling: string | null };
}

export const median = (a: readonly number[]): number | null => {
  if (a.length === 0) return null;
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? (s[(s.length - 1) / 2] as number) : ((s[s.length / 2 - 1] as number) + (s[s.length / 2] as number)) / 2;
};
const r1 = (v: number | null): number | null => (v === null ? null : Math.round(v * 10) / 10);
const r2 = (v: number | null): number | null => (v === null ? null : Math.round(v * 100) / 100);
const nums = (a: ReadonlyArray<number | null>): number[] => a.filter((x): x is number => x !== null);

// ---------------------------------------------------------------------------------------------------------------- (a) camera

export interface CameraErrors {
  fov: { est: number | null; truth: number; err: number | null };
  /** Field of view from the vanishing points alone (null when none were found). */
  vpFov: { est: number | null; err: number | null };
  pitch: { est: number | null; truth: number; err: number | null };
  height: { est: number | null; truth: number; err: number | null };
  yaw: { est: number | null; truth: number; err: number | null; flipped: boolean };
}

export function cameraErrors(rep: PerceptionReport, t: SelftestTruth): CameraErrors {
  const c = rep.camera;
  const v = rep.vanishing;
  const d = (e: number | null, tr: number): number | null => (e === null ? null : r1(e - tr));
  const yawEst = c ? c.yawDeg : null;
  // the report's yaw is positive when the back wall lies to the right of the optical axis, i.e. the camera is turned LEFT of the wall
  const yawT = -t.room.yawRel;
  return {
    fov: { est: c ? r1(c.fovDeg) : null, truth: r1(t.camera.hfov) as number, err: d(c ? c.fovDeg : null, t.camera.hfov) },
    vpFov: { est: v ? r1(v.fovDeg) : null, err: d(v ? v.fovDeg : null, t.camera.hfov) },
    // the report's tilt is positive looking down; the truth pitch is positive looking up
    pitch: { est: v ? r1(-v.pitchDeg) : null, truth: t.camera.pitch, err: d(v ? -v.pitchDeg : null, t.camera.pitch) },
    height: { est: c ? r2(c.cameraHeight) : null, truth: t.camera.plan.height, err: c ? r2(c.cameraHeight - t.camera.plan.height) : null },
    yaw: { est: yawEst === null ? null : r1(yawEst), truth: yawT, err: yawEst === null ? null : r1(yawEst - yawT), flipped: yawEst !== null && Math.abs(yawT) > 4 && Math.abs(yawEst + yawT) < Math.abs(yawEst - yawT) - 2 },
  };
}

// ---------------------------------------------------------------------------------------------------------------- (b) room box

export interface RoomErrors {
  width: { est: number | null; truth: number; relErr: number | null };
  depth: { est: number | null; truth: number; relErr: number | null };
  height: { est: number | null; truth: number; relErr: number | null };
  /** The same from the relative-depth cross-check. */
  cross: { width: number | null; depth: number | null; height: number | null } | null;
}

export function roomErrors(rep: PerceptionReport, t: SelftestTruth): RoomErrors {
  const rel = (e: number | null, tr: number): number | null => (e === null ? null : r2((e - tr) / tr));
  const rb = rep.room;
  const cc = rep.crossCheck;
  return {
    width: { est: rb ? rb.width.value : null, truth: r2(t.room.width) as number, relErr: rel(rb ? rb.width.value : null, t.room.width) },
    depth: { est: rb ? rb.depth.value : null, truth: r2(t.room.depth) as number, relErr: rel(rb ? rb.depth.value : null, t.room.depth) },
    height: { est: rb ? rb.height.value : null, truth: r2(t.room.height) as number, relErr: rel(rb ? rb.height.value : null, t.room.height) },
    cross: cc ? { width: rel(cc.width, t.room.width), depth: rel(cc.depth, t.room.depth), height: rel(cc.height, t.room.height) } : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------- (c) depth

export interface DepthErrors {
  /** Per surface class: median absolute error in metres, median relative error, median of est/true (above 1: reads too far). */
  classes: Record<string, { n: number; absM: number | null; rel: number | null; ratio: number | null }>;
  /** All truth surfaces: ratio of the estimate to the truth (scale error) and the relative error left once that scale is removed (shape error). */
  scale: number | null;
  relAfterScale: number | null;
  rel: number | null;
  absM: number | null;
}

export function depthErrors(grid: { width: number; height: number; data: ArrayLike<number> }, kind: 'z' | 'ray', m: TruthMasks): DepthErrors {
  const dm = decodeMasks(m);
  const truth = kind === 'z' ? dm.depthZ : dm.depthRay;
  const per: Record<string, { abs: number[]; rel: number[]; ratio: number[] }> = {};
  const all: Array<{ est: number; tr: number }> = [];
  for (let v = 0; v < grid.height; v++) {
    for (let u = 0; u < grid.width; u++) {
      const i = Math.min(m.width - 1, Math.floor(((u + 0.5) / grid.width) * m.width));
      const j = Math.min(m.height - 1, Math.floor(((v + 0.5) / grid.height) * m.height));
      const k = j * m.width + i;
      const label = m.labels[dm.data[k] as number] ?? 'none';
      const tr = truth[k] as number;
      const est = grid.data[v * grid.width + u] as number;
      if (label === 'none' || !(tr > 0.2) || !(est > 0.05)) continue;
      const cls = label === 'floor' || label === 'ceiling' || label === 'wall' ? label : 'items';
      const p = (per[cls] ??= { abs: [], rel: [], ratio: [] });
      p.abs.push(Math.abs(est - tr));
      p.rel.push(Math.abs(est - tr) / tr);
      p.ratio.push(est / tr);
      all.push({ est, tr });
    }
  }
  const classes: DepthErrors['classes'] = {};
  for (const [k, p] of Object.entries(per)) classes[k] = { n: p.abs.length, absM: r2(median(p.abs)), rel: r2(median(p.rel)), ratio: r2(median(p.ratio)) };
  const scale = median(all.map((a) => a.est / a.tr));
  return {
    classes,
    scale: r2(scale),
    relAfterScale: scale ? r2(median(all.map((a) => Math.abs(a.est / scale - a.tr) / a.tr))) : null,
    rel: r2(median(all.map((a) => Math.abs(a.est - a.tr) / a.tr))),
    absM: r2(median(all.map((a) => Math.abs(a.est - a.tr)))),
  };
}

// ---------------------------------------------------------------------------------------------------------------- (d) detection and masks

/** Nearest-neighbour resample of a binary mask. */
export function resampleMask(src: ArrayLike<number>, sw: number, sh: number, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = src[Math.min(sh - 1, Math.floor(((y + 0.5) / h) * sh)) * sw + Math.min(sw - 1, Math.floor(((x + 0.5) / w) * sw))] ? 1 : 0;
  return out;
}

export function maskIou(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let i = 0, u = 0;
  for (let k = 0; k < a.length; k++) { const x = a[k] ? 1 : 0, y = b[k] ? 1 : 0; if (x && y) i++; if (x || y) u++; }
  return u === 0 ? 0 : i / u;
}

/** Mask of one label of the truth grid. */
export function labelMask(m: TruthMasks, label: string, decoded = decodeMasks(m)): Uint8Array {
  const li = m.labels.indexOf(label);
  const out = new Uint8Array(m.width * m.height);
  if (li < 0) return out;
  for (let k = 0; k < out.length; k++) if (decoded.data[k] === li) out[k] = 1;
  return out;
}

const FAMILY: Record<string, string> = {
  nightstand: 'table', desk: 'table', 'dining-table': 'table', 'coffee-table': 'table', table: 'table', sideboard: 'table', dresser: 'table', 'tv-stand': 'table',
  chair: 'seat', armchair: 'seat', 'office-chair': 'seat', stool: 'seat', 'bar-stool': 'seat', sofa: 'seat', couch: 'seat', bench: 'seat',
  'table-lamp': 'lamp', 'floor-lamp': 'lamp', lamp: 'lamp', sconce: 'lamp', pendant: 'lamp',
  art: 'art', painting: 'art', picture: 'art', mirror: 'art', poster: 'art', tv: 'art', television: 'art',
  bed: 'bed', mattress: 'bed', pillow: 'bed', duvet: 'bed', blanket: 'bed',
  curtain: 'curtain', curtains: 'curtain', drape: 'curtain', blind: 'curtain',
  wardrobe: 'storage', closet: 'storage', bookshelf: 'storage', bookcase: 'storage', shelf: 'storage', cabinet: 'storage', fireplace: 'storage',
  rug: 'rug', carpet: 'rug', mat: 'rug', plant: 'plant', houseplant: 'plant', vase: 'plant', luggage: 'luggage', suitcase: 'luggage', backpack: 'luggage', bag: 'luggage',
};
/** The word two labels are compared by: a nightstand and a table are the same family, a bed and a pillow too. */
export function familyOf(label: string): string {
  const l = label.toLowerCase().trim();
  if (FAMILY[l]) return FAMILY[l] as string;
  for (const w of l.split(/[\s-]+/).reverse()) if (FAMILY[w]) return FAMILY[w] as string;
  return l;
}

export interface MatchRow {
  truthId: string;
  kind: string;
  /** Visible share of the frame, percent. */
  area: number;
  perceivedId: string | null;
  label: string | null;
  iou: number;
  labelOk: boolean | null;
}

export interface DetectionErrors {
  rows: MatchRow[];
  /** True pieces that are big enough to be found (at least 0.15 percent of the frame). */
  eligible: number;
  recall30: number | null;
  recall50: number | null;
  /** Median mask IoU over the eligible pieces (0 for a missed one). */
  medianIou: number | null;
  /** Median over the pieces that were matched at all (IoU 0.1 or more). */
  medianIouMatched: number | null;
  labelAccuracy: number | null;
  /** Perceived objects of 0.4 percent of the frame or more that match no piece and are not mostly structure; and the structure ones apart. */
  falseDetections: string[];
  structureDetections: number;
  perceived: number;
}

const STRUCTURE_LABEL = /^(wall|floor|ceiling|room|window|door|window frame|door frame|doorway|curtain rail|rail|sky|view)$/;

export function detectionErrors(rep: PerceptionReport, t: SelftestTruth, m: TruthMasks): DetectionErrors {
  const W = m.width;
  const H = m.height;
  const dec = decodeMasks(m);
  const tm = new Map(t.items.map((it) => [it.id, labelMask(m, it.id, dec)]));
  const structure = new Uint8Array(W * H);
  for (const l of ['floor', 'ceiling', 'wall']) { const lm = labelMask(m, l, dec); for (let k = 0; k < lm.length; k++) if (lm[k]) structure[k] = 1; }
  const perceived = rep.objects.filter((o) => o.mask);
  const pmask = new Map<string, Uint8Array>(perceived.map((o) => {
    const mk = o.mask as NonNullable<PerceivedObject['mask']>;
    return [o.id, resampleMask(decodeRle(mk.rle), mk.rle.width, mk.rle.height, W, H)];
  }));
  const pairs: Array<{ tid: string; pid: string; iou: number }> = [];
  for (const [tid, a] of tm) for (const [pid, b] of pmask) { const iou = maskIou(a, b); if (iou >= 0.1) pairs.push({ tid, pid, iou }); }
  pairs.sort((x, y) => y.iou - x.iou);
  const usedT = new Set<string>();
  const usedP = new Set<string>();
  const best = new Map<string, { pid: string; iou: number }>();
  for (const p of pairs) { if (usedT.has(p.tid) || usedP.has(p.pid)) continue; usedT.add(p.tid); usedP.add(p.pid); best.set(p.tid, { pid: p.pid, iou: p.iou }); }
  const rows: MatchRow[] = [];
  for (const it of t.items) {
    const a = tm.get(it.id) as Uint8Array;
    let n = 0;
    for (let k = 0; k < a.length; k++) n += a[k] as number;
    const area = n / (W * H);
    if (area < 0.0015) continue;
    const b = best.get(it.id);
    const po = b ? rep.objects.find((o) => o.id === b.pid) : undefined;
    rows.push({ truthId: it.id, kind: it.kind, area: r2(area * 100) as number, perceivedId: b ? b.pid : null, label: po?.label ?? null, iou: r2(b ? b.iou : 0) as number, labelOk: po ? familyOf(po.label) === familyOf(it.kind) || (po.labelAlternatives ?? []).some((x) => x.p >= 0.15 && familyOf(x.label) === familyOf(it.kind)) : null });
  }
  const eligible = rows.length;
  const matched = rows.filter((r) => r.perceivedId);
  const falseDetections: string[] = [];
  let structureDetections = 0;
  for (const o of perceived) {
    if (usedP.has(o.id) || o.areaFraction < 0.004) continue;
    const pm = pmask.get(o.id) as Uint8Array;
    let n = 0, s = 0;
    for (let k = 0; k < pm.length; k++) if (pm[k]) { n++; if (structure[k]) s++; }
    if (STRUCTURE_LABEL.test(o.label) || s / Math.max(1, n) >= 0.6) structureDetections++;
    else falseDetections.push(`${o.id} ${o.label}`);
  }
  const lab = matched.filter((r) => r.labelOk !== null);
  return {
    rows, eligible,
    recall30: eligible ? r2(rows.filter((r) => r.iou >= 0.3).length / eligible) : null,
    recall50: eligible ? r2(rows.filter((r) => r.iou >= 0.5).length / eligible) : null,
    medianIou: r2(median(rows.map((r) => r.iou))),
    medianIouMatched: r2(median(matched.map((r) => r.iou))),
    labelAccuracy: lab.length ? r2(lab.filter((r) => r.labelOk).length / lab.length) : null,
    falseDetections, structureDetections, perceived: perceived.length,
  };
}

// ---------------------------------------------------------------------------------------------------------------- (e) back-projection

export interface PlacementRow {
  truthId: string;
  kind: string;
  mount: string;
  /** Distance in the room frame between the measured centre and the true centre of the VISIBLE surface (what the measurement is meant to give), metres. */
  posVisM: number | null;
  /** The same against the centre of the whole piece (what a build would need). */
  posPieceM: number | null;
  /** Error of the position relative to the eye (the estimated eye position against the true one subtracted on both sides): what is left when the wall lines are wrong by a shift. */
  posRelEyeM: number | null;
  /** Measured over true width, height and visible depth of the piece. */
  wRatio: number | null;
  hRatio: number | null;
  dRatio: number | null;
  /** Measured width over the true full width of the piece. */
  wPieceRatio: number | null;
  frame: string | null;
  floor: boolean;
}

export interface PlacementErrors {
  rows: PlacementRow[];
  /** Medians over the floor pieces matched with IoU 0.3 or more and measured in the room frame. */
  floorPosVisM: number | null;
  floorPosPieceM: number | null;
  /** Median over the same pieces of the eye-relative error (see {@link PlacementRow.posRelEyeM}): the depth and back-projection part of the error alone. */
  floorPosRelEyeM: number | null;
  /** Median absolute relative size error (|ratio - 1|) of width and of height, all matched pieces. */
  sizeW: number | null;
  sizeH: number | null;
  /** Share of matched pieces measured in the camera frame (side walls not both found), which cannot be scored in the room frame. */
  cameraFrame: number;
}

export function placementErrors(rep: PerceptionReport, t: SelftestTruth, det: DetectionErrors): PlacementErrors {
  const rows: PlacementRow[] = [];
  let camFrame = 0;
  let n = 0;
  for (const r of det.rows) {
    if (!r.perceivedId || r.iou < 0.3) continue;
    n++;
    const ti = t.items.find((x) => x.id === r.truthId) as SelftestTruth['items'][number];
    const po = rep.objects.find((o) => o.id === r.perceivedId) as PerceivedObject;
    const pl = po.placement;
    if (!pl) continue;
    const vis = ti.visible;
    const inRoom = pl.centre.frame === 'room';
    if (!inRoom) camFrame++;
    // Camera frame (the side walls were not both found): x is the offset to the right of the eye along the back wall, z the distance from the back wall
    // (the forward distance from the eye when no back wall was found). The truth is put in the same frame.
    const [bx0, bz0, bx1, bz1] = t.room.bbox;
    const [cu, cv] = planToRoom(t.room.back, t.camera.plan.at[0] - bx0, t.camera.plan.at[1] - bz0, bx1 - bx0, bz1 - bz0);
    const backKnown = rep.room?.walls.back ?? false;
    const tr = (u: number, v: number): [number, number] => (inRoom ? [u, v] : [u - cu, backKnown ? v : cv - v]);
    const vp = vis ? tr(vis.centre.u, vis.centre.v) : null;
    const pc = tr(ti.centre.u, ti.centre.v);
    rows.push({
      truthId: r.truthId, kind: ti.kind, mount: ti.mount,
      posVisM: vp ? r2(Math.hypot(pl.centre.x - vp[0], pl.centre.z - vp[1])) : null,
      posPieceM: r2(Math.hypot(pl.centre.x - pc[0], pl.centre.z - pc[1])),
      posRelEyeM: vp && inRoom && rep.room?.camera.x !== null && rep.room?.camera.x !== undefined ? r2(Math.hypot((pl.centre.x - rep.room.camera.x) - (vp[0] - cu), (pl.centre.z - rep.room.camera.z) - (vp[1] - cv))) : null,
      wRatio: vis && vis.size.w > 0.05 ? r2(pl.size.w / vis.size.w) : null,
      hRatio: vis && vis.size.h > 0.05 ? r2(pl.size.h / vis.size.h) : null,
      dRatio: vis && vis.size.d > 0.05 ? r2(pl.size.d / vis.size.d) : null,
      wPieceRatio: ti.size.w > 0.05 ? r2(pl.size.w / ti.size.w) : null,
      frame: pl.centre.frame, floor: ti.mount === 'floor' || ti.y0 < 0.1,
    });
  }
  const fl = rows.filter((r) => r.floor);
  return {
    rows,
    floorPosVisM: r2(median(nums(fl.map((r) => r.posVisM)))),
    floorPosPieceM: r2(median(nums(fl.map((r) => r.posPieceM)))),
    floorPosRelEyeM: r2(median(nums(fl.map((r) => r.posRelEyeM)))),
    sizeW: r2(median(nums(rows.map((r) => (r.wRatio === null ? null : Math.abs(r.wRatio - 1)))))),
    sizeH: r2(median(nums(rows.map((r) => (r.hRatio === null ? null : Math.abs(r.hRatio - 1)))))),
    cameraFrame: n ? (r2(camFrame / n) as number) : 0,
  };
}

// ---------------------------------------------------------------------------------------------------------------- (f) colour

export interface ColourRow {
  truthId: string;
  kind: string;
  truthHex: string | null;
  /** What the photo shows under the TRUE mask (the best a perfect segmentation could read). */
  visibleHex: string | null;
  measuredHex: string | null;
  /** Measured against the colour the world was made with (lighting and exposure included). */
  rawParam: number | null;
  /** Measured, after the pipeline's own white-reference normalisation, against the colour the world was made with. */
  normParam: number | null;
  /** Measured against the visible colour (mask and reading errors only). */
  measVis: number | null;
  /** Visible colour against the made colour (what lighting does: no measurement could undo it without a reference). */
  visParam: number | null;
}

export interface ColourErrors {
  rows: ColourRow[];
  medianRawParam: number | null;
  medianNormParam: number | null;
  medianMeasVis: number | null;
  medianVisParam: number | null;
  surfaces: Array<{ surface: string; truthHex: string | null; visibleHex: string | null; measuredHex: string | null; measVis: number | null; rawParam: number | null; normParam: number | null }>;
}

const dE = (a: string | null, b: string | null): number | null => {
  if (!a || !b) return null;
  const x = hexToLab(a);
  const y = hexToLab(b);
  return x && y ? r1(deltaE2000(x, y)) : null;
};

export function colourErrors(rep: PerceptionReport, t: SelftestTruth, det: DetectionErrors, m: TruthMasks, photo: { width: number; height: number; data: Uint8ClampedArray | Uint8Array }): ColourErrors {
  const ill = rep.illuminant;
  const dec = decodeMasks(m);
  const read = (mask: Uint8Array, dominant = false): Appearance | null => {
    const box = [1, 1, 0, 0] as [number, number, number, number];
    for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) if (mask[y * m.width + x]) { box[0] = Math.min(box[0], x / m.width); box[1] = Math.min(box[1], y / m.height); box[2] = Math.max(box[2], (x + 1) / m.width); box[3] = Math.max(box[3], (y + 1) / m.height); }
    if (box[2] <= box[0]) return null;
    return measureAppearance(photo, { width: m.width, height: m.height, data: mask }, box, dominant ? { dominant: true } : {});
  };
  const rows: ColourRow[] = [];
  for (const r of det.rows) {
    if (!r.perceivedId || r.iou < 0.3) continue;
    const ti = t.items.find((x) => x.id === r.truthId) as SelftestTruth['items'][number];
    const po = rep.objects.find((o) => o.id === r.perceivedId) as PerceivedObject;
    const measured = po.appearance?.colour.hex ?? null;
    const vis = read(labelMask(m, ti.id, dec))?.colour.hex ?? null;
    rows.push({ truthId: ti.id, kind: ti.kind, truthHex: ti.mainHex, visibleHex: vis, measuredHex: measured, rawParam: dE(measured, ti.mainHex), normParam: measured && ill ? dE(normaliseHex(measured, ill), ti.mainHex) : null, measVis: dE(measured, vis), visParam: dE(vis, ti.mainHex) });
  }
  const med = (f: (r: ColourRow) => number | null): number | null => r1(median(nums(rows.map(f))));
  const surfaces: ColourErrors['surfaces'] = [];
  for (const [name, label] of [['floor', 'floor'], ['walls', 'wall'], ['ceiling', 'ceiling']] as const) {
    const meas = rep.surfaces[name]?.colour.hex ?? null;
    const truthHex = t.surfaceColours[name];
    const vis = read(labelMask(m, label, dec), true)?.colour.hex ?? null;
    surfaces.push({ surface: name, truthHex, visibleHex: vis, measuredHex: meas, measVis: dE(meas, vis), rawParam: dE(meas, truthHex), normParam: meas && ill ? dE(normaliseHex(meas, ill), truthHex) : null });
  }
  return { rows, medianRawParam: med((r) => r.rawParam), medianNormParam: med((r) => r.normParam), medianMeasVis: med((r) => r.measVis), medianVisParam: med((r) => r.visParam), surfaces };
}

// ---------------------------------------------------------------------------------------------------------------- surfaces

export interface SurfaceMaskErrors {
  /** IoU of the plane masks the colours were read from (floor, ceiling, walls) with the true surface masks. */
  floor: number | null;
  ceiling: number | null;
  walls: number | null;
  /** Share of the plane mask that lies on the true surface (precision), which is what a colour reading needs. */
  floorPrecision: number | null;
}

export function surfaceMaskErrors(dbg: { floor: ArrayLike<number>; ceil: ArrayLike<number>; wall: ArrayLike<number>; w: number; h: number } | null, m: TruthMasks): SurfaceMaskErrors | null {
  if (!dbg) return null;
  const dec = decodeMasks(m);
  const one = (est: ArrayLike<number>, label: string): { iou: number; precision: number } => {
    const tm = resampleMask(labelMask(m, label, dec), m.width, m.height, dbg.w, dbg.h);
    let i = 0, e = 0;
    for (let k = 0; k < tm.length; k++) { if (est[k]) { e++; if (tm[k]) i++; } }
    return { iou: maskIou(est, tm), precision: e ? i / e : 0 };
  };
  const f = one(dbg.floor, 'floor');
  return { floor: r2(f.iou), ceiling: r2(one(dbg.ceil, 'ceiling').iou), walls: r2(one(dbg.wall, 'wall').iou), floorPrecision: r2(f.precision) };
}
