/**
 * MEASURED comparison of the build with the photo, per object (advisory; the judges and the model still decide). The built scene is
 * rendered from the photo camera into an INSTANCE-ID buffer (`renderInstanceIds`, arch): the visible pixel mask of every built
 * piece. Each linked inventory object that the perception layer measured (mask, colour) is compared with it: mask IoU, centroid
 * offset (pixels, share of the frame and, for floor pieces, metres on the floor), size ratio, CIELAB colour difference between the
 * render crop and the photo crop (deltaE 2000, glare and shadow tails removed on both) and a plain-language fix hint. Floor, wall
 * and ceiling colours are compared the same way. An object with IoU above 0.6 and deltaE under 10 counts as CLOSE evidence.
 */
import { colourName, deltaE2000, hexLuminance, hexToLab, measureAppearance, PHOTO_BUILDING_ID, scaleHexLight, type Appearance } from '@aether/arch/photo';
import { projectBuilt, renderInstanceIds, worldShiftOnFloor } from './objects-evidence';
import type { ReviewPose } from '@aether/arch';
import type { WorldDoc } from '@aether/core';
import type { InventoryItem, ObjectLedger } from './objects';
import { decodeRle, type PerceivedObject, type PerceptionReport } from './perception/perceive';
import type { Raster } from './score';

export type MeasuredVerdict = 'match' | 'close' | 'near' | 'off' | 'unclear';

export interface ObjectMeasure {
  id: string;
  label: string;
  perceivedId: string;
  verdict: MeasuredVerdict;
  iou: number | null;
  /** Centre of the render mask minus centre of the photo mask, pixels of the photo. */
  centroidPx: number | null;
  /** The same as a share of the frame (x right, y down). */
  centroidPct: [number, number] | null;
  /** Metres on the floor between where the base of the piece is and where the photo's mask puts it (floor pieces only). */
  offsetM: number | null;
  /** Photo mask size over render mask size (above 1: the render is smaller), by width and height of the masks. */
  sizeRatio: { w: number; h: number } | null;
  deltaE: number | null;
  photoHex: string | null;
  renderHex: string | null;
  hint: string;
  /** Where the render side came from: the ledger's link, or the built piece whose visible mask overlaps the photo mask (comparison only). */
  linked?: 'ledger' | 'overlap';
}

export interface SurfaceMeasure {
  surface: 'floor' | 'walls' | 'ceiling';
  /** deltaE after the render's exposure is matched to the photo's (see `Measured.exposureGain`). */
  deltaE: number | null;
  /** deltaE of the colours as they are, exposure included. */
  rawDeltaE?: number | null;
  photoHex: string | null;
  renderHex: string | null;
  hint: string;
}

export interface Measured {
  rows: ObjectMeasure[];
  surfaces: SurfaceMeasure[];
  counts: Record<MeasuredVerdict, number>;
  /** Linear gain applied to render colours so that its ceiling (else wall) is as bright as the photo's: the render is tone-mapped with the room's exposure, the photo has its own. 1: no reference. */
  exposureGain: number;
  /** Of the unclear rows: no linked piece (a coverage gap) against a mask too small or missing (not measurable). */
  unclearBy: { unlinked: number; unmeasurable: number };
  text: string;
  line: string;
}

const r1 = (v: number): number => Math.round(v * 10) / 10;
const r2 = (v: number): number => Math.round(v * 100) / 100;

function resample(m: Uint8Array, sw: number, sh: number, w: number, h: number): Uint8Array {
  if (sw === w && sh === h) return m;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = m[Math.min(sh - 1, Math.floor(((y + 0.5) / h) * sh)) * sw + Math.min(sw - 1, Math.floor(((x + 0.5) / w) * sw))] as number;
  return out;
}
const area = (m: ArrayLike<number>): number => {
  let n = 0;
  for (let i = 0; i < m.length; i++) if (m[i]) n++;
  return n;
};
function stats(m: ArrayLike<number>, w: number, h: number): { n: number; cx: number; cy: number; x0: number; x1: number; y0: number; y1: number } {
  let n = 0, sx = 0, sy = 0, x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) { n++; sx += x; sy += y; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { n, cx: n ? sx / n / w : 0, cy: n ? sy / n / h : 0, x0, x1, y0, y1 };
}
const bboxOf = (s: ReturnType<typeof stats>, w: number, h: number): [number, number, number, number] => [s.x0 / w, s.y0 / h, (s.x1 + 1) / w, (s.y1 + 1) / h];

/** Plain words for the difference between two colours: lighter or darker, and which hue. */
export function colourHint(render: Appearance['colour'] | { hex: string; lab: [number, number, number]; name: string }, photo: { hex: string; lab: [number, number, number]; name: string }, id: string, label: string): string {
  const dL = render.lab[0] - photo.lab[0];
  const bits: string[] = [];
  if (Math.abs(dL) >= 6) bits.push(dL > 0 ? 'lighter' : 'darker');
  if (render.name.replace(/^(very )?(dark|light) /, '') !== photo.name.replace(/^(very )?(dark|light) /, '')) bits.push(`${render.name} against the photo's ${photo.name}`);
  return `${label} render is ${bits.length > 0 ? bits.join(', ') : 'a different shade'} than the photo (render ${render.hex}, photo ${photo.hex}): apply_measured_colour {object:"${id}"} sets the photo's ${photo.hex}`;
}

export interface MeasureInput {
  world: WorldDoc;
  pose: ReviewPose;
  aspect: number;
  report: PerceptionReport;
  ledger: ObjectLedger;
  /** The render from the photo camera, decoded (any size above 128 px wide). */
  render: Raster;
  /** Pixel size of the photo, for pixel errors. */
  px: { w: number; h: number };
}

export function compareObjects(inp: MeasureInput): Measured | null {
  const W = 256;
  const inst = renderInstanceIds(inp.world, PHOTO_BUILDING_ID, inp.pose, inp.aspect, W);
  if (!inst) return null;
  const H = inst.height;
  const idMask = (match: (id: string) => boolean): Uint8Array => {
    const keep = new Uint8Array(inst.ids.length + 1);
    inst.ids.forEach((id, i) => { if (match(id)) keep[i + 1] = 1; });
    const m = new Uint8Array(W * H);
    for (let i = 0; i < m.length; i++) if (keep[inst.buffer[i] as number]) m[i] = 1;
    return m;
  };
  // Surfaces first: the render's own white reference gives the exposure gain that puts its colours in the photo's space.
  const planes = [['floor', /^floor:/, inp.report.surfaces.floor], ['walls', /^wall:/, inp.report.surfaces.walls], ['ceiling', /^ceiling:/, inp.report.surfaces.ceiling]] as const;
  const renderPlane = new Map<string, Appearance | null>();
  for (const [surface, re] of planes) {
    const m = idMask((id) => re.test(id));
    const s0 = stats(m, W, H);
    renderPlane.set(surface, s0.n > W * H * 0.01 ? measureAppearance(inp.render, { width: W, height: H, data: m }, bboxOf(s0, W, H), { dominant: true }) : null);
  }
  const photoPlane = (n: string): Appearance | null => (n === 'floor' ? inp.report.surfaces.floor : n === 'walls' ? inp.report.surfaces.walls : inp.report.surfaces.ceiling);
  const anchor = (['ceiling', 'walls'] as const).find((n) => renderPlane.get(n) && photoPlane(n));
  let gain = 1;
  if (anchor) {
    const lr = hexLuminance((renderPlane.get(anchor) as Appearance).colour.hex);
    const lp = hexLuminance((photoPlane(anchor) as Appearance).colour.hex);
    if (lr > 0.004 && lp > 0.004) gain = Math.max(0.35, Math.min(3, lp / lr));
  }
  gain = Math.round(gain * 100) / 100;
  const align = (hex: string): string => (gain === 1 ? hex : scaleHexLight(hex, gain));
  const proj = projectBuilt(inp.world, inp.pose, inp.aspect);
  const byPerceived = new Map<string, PerceivedObject>(inp.report.objects.map((o) => [o.id, o]));
  const rows: ObjectMeasure[] = [];
  // Objects with no link are matched to the built piece whose visible mask overlaps the photo mask most (at least 0.25), one piece to one object.
  const takenEnt = new Set(inp.ledger.list().flatMap((r) => r.item.entities));
  const overlapLink = new Map<string, string>();
  const pieceMasks = new Map<string, Uint8Array>();
  inst.ids.forEach((id) => { if (!/^(floor|wall|ceiling):/.test(id) && !takenEnt.has(id)) pieceMasks.set(id, idMask((x) => x === id)); });
  for (const rec of inp.ledger.list()) {
    const it0 = rec.item;
    const po0 = it0.measured?.id ? byPerceived.get(it0.measured.id) : undefined;
    if (it0.entities.length > 0 || !po0?.mask || it0.category === 'structure' || it0.category === 'view') continue;
    const pm = resample(decodeRle(po0.mask.rle), po0.mask.rle.width, po0.mask.rle.height, W, H);
    let best: string | null = null;
    let bi = 0.25;
    for (const [id, m] of pieceMasks) {
      if (overlapLink.has(`e:${id}`)) continue;
      let i = 0, a = 0, b = 0;
      for (let q = 0; q < pm.length; q++) { const x = pm[q] as number, y = m[q] as number; a += x; b += y; if (x && y) i++; }
      const u = a + b - i;
      if (u > 0 && i / u > bi) { bi = i / u; best = id; }
    }
    if (best) { overlapLink.set(it0.id, best); overlapLink.set(`e:${best}`, it0.id); }
  }
  for (const rec of inp.ledger.list()) {
    const it: InventoryItem = overlapLink.has(rec.item.id) ? { ...rec.item, entities: [overlapLink.get(rec.item.id) as string] } : rec.item;
    const pid = it.measured?.id;
    if (!pid || it.category === 'structure' || it.category === 'view') continue;
    const po = byPerceived.get(pid);
    const base: ObjectMeasure = { linked: overlapLink.has(it.id) ? 'overlap' : 'ledger', id: it.id, label: it.label, perceivedId: pid, verdict: 'unclear', iou: null, centroidPx: null, centroidPct: null, offsetM: null, sizeRatio: null, deltaE: null, photoHex: po?.appearance?.colour.hex ?? null, renderHex: null, hint: '' };
    if (!po?.mask || it.entities.length === 0) { rows.push({ ...base, hint: it.entities.length === 0 ? 'no built piece is linked, so nothing to compare' : 'no photo mask for this object' }); continue; }
    const photo = resample(decodeRle(po.mask.rle), po.mask.rle.width, po.mask.rle.height, W, H);
    const rend = idMask((id) => it.entities.includes(id));
    const ps = stats(photo, W, H);
    const rs = stats(rend, W, H);
    if (ps.n < W * H * 0.0015) { rows.push({ ...base, hint: 'the photo mask is tiny: not judged by measurement' }); continue; }
    if (rs.n < W * H * 0.0008) { rows.push({ ...base, verdict: 'off', iou: 0, hint: `its built piece is hidden or out of frame in the photo camera (photo mask ${r2((ps.n / (W * H)) * 100)}% of the frame): check the position, size and that it is not behind another piece` }); continue; }
    let inter = 0;
    for (let i = 0; i < photo.length; i++) if (photo[i] && rend[i]) inter++;
    const iou = inter / (ps.n + rs.n - inter);
    const dx = (rs.cx - ps.cx) * inp.px.w;
    const dy = (rs.cy - ps.cy) * inp.px.h;
    const sizeRatio = { w: r2((ps.x1 - ps.x0 + 1) / Math.max(1, rs.x1 - rs.x0 + 1)), h: r2((ps.y1 - ps.y0 + 1) / Math.max(1, rs.y1 - rs.y0 + 1)) };
    // colour of the render crop (its own visible mask) against the photo's
    const ra = measureAppearance(inp.render, { width: W, height: H, data: rend }, bboxOf(rs, W, H));
    const photoCol = po.appearance?.colour ?? null;
    let dE: number | null = null;
    if (ra && photoCol) {
      const a = hexToLab(align(ra.colour.hex));
      const b = hexToLab(photoCol.hex);
      if (a && b) dE = r1(deltaE2000(a, b));
    }
    // metres on the floor between the piece's base and where the photo mask puts the base (standing pieces only)
    let offsetM: number | null = null;
    const geo = proj.geometry.filter((g) => it.entities.includes(g.id)).flatMap((g) => g.pts);
    const wallish = /(painting|picture|frame|mirror|curtain|window|clock|tv|television|sconce|wall light|lamp shade)/.test(`${it.kind} ${it.label}`);
    if (geo.length > 0 && !wallish) {
      const lo = [Math.min(...geo.map((p) => p[1]))];
      const anchor: [number, number, number] = [geo.reduce((s, p) => s + p[0], 0) / geo.length, lo[0] as number, geo.reduce((s, p) => s + p[2], 0) / geo.length];
      const shift = worldShiftOnFloor(inp.pose, inp.aspect, anchor, [(ps.x0 + ps.x1 + 1) / 2 / W, (ps.y1 + 1) / H]);
      if (shift) offsetM = r2(Math.hypot(shift[0], shift[2]));
    }
    const verdict: MeasuredVerdict = iou >= 0.75 && (dE === null || dE < 6) ? 'match' : iou >= 0.6 && (dE === null || dE < 10) ? 'close' : iou < 0.3 || (dE !== null && dE > 20) || (offsetM !== null && offsetM > 1.2) ? 'off' : 'near';
    const hints: string[] = [];
    if (iou < 0.6) {
      const horiz = Math.abs(dx) > inp.px.w * 0.03 ? `${Math.abs(Math.round((rs.cx - ps.cx) * 100))}% ${dx > 0 ? 'right' : 'left'}` : '';
      const vert = Math.abs(dy) > inp.px.h * 0.03 ? `${Math.abs(Math.round((rs.cy - ps.cy) * 100))}% ${dy > 0 ? 'below' : 'above'}` : '';
      if (horiz || vert) hints.push(`render is ${[horiz, vert].filter(Boolean).join(' and ')} of the photo mask${offsetM !== null ? ` (about ${offsetM} m on the floor)` : ''}`);
      const sc: string[] = [];
      if (sizeRatio.w > 1.2 || sizeRatio.w < 0.83) sc.push(`width x${sizeRatio.w}`);
      if (sizeRatio.h > 1.2 || sizeRatio.h < 0.83) sc.push(`height x${sizeRatio.h}`);
      if (sc.length > 0) hints.push(`scale ${sc.join(', ')}`);
    }
    if (dE !== null && dE >= 8 && ra && photoCol) { const al = hexToLab(align(ra.colour.hex)); if (al) hints.push(colourHint({ hex: align(ra.colour.hex), lab: [al.L, al.a, al.b], name: colourName(al) }, photoCol, it.id, 'the').replace(/^the render/, 'render')); }
    rows.push({ ...base, verdict, iou: r2(iou), centroidPx: Math.round(Math.hypot(dx, dy)), centroidPct: [Math.round((rs.cx - ps.cx) * 100), Math.round((rs.cy - ps.cy) * 100)], offsetM, sizeRatio, deltaE: dE, renderHex: ra ? align(ra.colour.hex) : null, hint: hints.join('; ') });
  }
  // floor, walls and ceiling: render plane colour (exposure matched at the anchor) against the photo's plane colour
  const surfaces: SurfaceMeasure[] = [];
  for (const [surface] of planes) {
    const photo = photoPlane(surface);
    if (!photo) continue;
    const ra = renderPlane.get(surface) ?? null;
    const b = hexToLab(photo.colour.hex);
    const rawA = ra ? hexToLab(ra.colour.hex) : null;
    let al = ra ? hexToLab(align(ra.colour.hex)) : null;
    // the anchor itself matches in lightness by construction: its deltaE is then the hue and chroma difference alone
    const rawDE = rawA && b ? r1(deltaE2000(rawA, b)) : null;
    const dE = al && b ? r1(deltaE2000(al, b)) : null;
    const hintCol = ra && al && dE !== null && dE >= 8 ? { hex: align(ra.colour.hex), lab: [al.L, al.a, al.b] as [number, number, number], name: colourName(al) } : null;
    const how = surface === 'floor' ? 'the floor finish colour (design_plan room floor)' : surface === 'walls' ? 'the wall finish colours (design_plan walls)' : 'the ceiling finish colour';
    surfaces.push({ surface, deltaE: dE, rawDeltaE: rawDE, photoHex: photo.colour.hex, renderHex: ra ? align(ra.colour.hex) : null, hint: hintCol ? `${colourHint(hintCol, photo.colour, surface, surface).replace(/: apply_measured_colour .*$/, '')}: set ${how} to ${photo.colour.hex}` : '' });
    void al;
    al = null;
  }
  const counts: Record<MeasuredVerdict, number> = { match: 0, close: 0, near: 0, off: 0, unclear: 0 };
  for (const r of rows) counts[r.verdict]++;
  const unlinked = rows.filter((r) => r.verdict === 'unclear' && /no built piece is linked/.test(r.hint)).length;
  const unclearBy = { unlinked, unmeasurable: counts.unclear - unlinked };
  const surfLine = surfaces.filter((s) => s.deltaE !== null).map((s) => `${s.surface} dE ${s.deltaE} (raw ${s.rawDeltaE})`).join(', ');
  const line = `Measured comparison (mask IoU and colour deltaE against the photo, render exposure matched to the photo's ${anchor ?? 'none'}${anchor ? ` x${gain}` : ''}): ${counts.match} match, ${counts.close} close, ${counts.near} near, ${counts.off} off, ${counts.unclear} unclear (${unclearBy.unlinked} with no linked piece, ${unclearBy.unmeasurable} not measurable) of ${rows.length} objects${surfLine ? `; ${surfLine}` : ''}.`;
  const worst = rows.filter((r) => r.verdict === 'off' || r.verdict === 'near').sort((a, b) => (a.iou ?? 0) - (b.iou ?? 0)).slice(0, 16);
  const tl: string[] = [`${line} (advisory: close = mask IoU above 0.6 and deltaE under 10; the judges decide)`];
  for (const r of worst) tl.push(`- ${r.label} [${r.id}] ${r.verdict}: IoU ${r.iou}, centre ${r.centroidPx} px off${r.offsetM !== null ? ` (${r.offsetM} m)` : ''}${r.sizeRatio ? `, photo/render size ${r.sizeRatio.w}x wide ${r.sizeRatio.h}x high` : ''}${r.deltaE !== null ? `, deltaE ${r.deltaE} (render ${r.renderHex}, photo ${r.photoHex}; ${colourName(hexToLab(r.photoHex ?? '#000000') ?? { L: 0, a: 0, b: 0 })})` : ''}${r.hint ? `. Fix: ${r.hint}` : ''}`);
  for (const s of surfaces) if (s.hint) tl.push(`- ${s.hint}`);
  return { rows, surfaces, counts, unclearBy, exposureGain: gain, text: tl.join('\n'), line };
}
