/**
 * `perceive_photo`: specialised vision models MEASURE the photo and hand the numbers to the model as evidence.
 *   - Florence-2 base (MIT): open-vocabulary detection and phrase grounding (boxes, with a confidence from its box tokens);
 *   - SAM 2.1 tiny (Apache-2.0): a pixel mask for every box;
 *   - Depth Anything V2 metric indoor small (Apache-2.0): depth in metres, from which a floor plane, wall lines and a room
 *     box are fitted (packages/arch roomgeometry.ts) and every mask is back-projected to room coordinates;
 *   - appearance from the mask pixels: robust CIELAB median, palette, luminance, pattern, gloss (arch appearance.ts).
 * The language model still decides: this is a report with numbers, a text summary and an annotated picture, written to
 * the run record. Every model is optional: one that cannot load (offline, off, checksum) is named in `unavailable` and the
 * rest still work; with none the tool says so and nothing else changes.
 */
import {
  detectSegments, estimateIlluminant, normaliseHex, estimateRoomEnsemble, estimateRoomFromDepth, measureAppearance, placeObject, solveCamera, solveManhattan,
  type Appearance, type Cam, type Illuminant, type DepthGrid, type DisparityMap, type EstimatorResult, type ManhattanCamera, type Placement, type RoomBox, type RoomFrame,
} from '@aether/arch/photo';
import type { DepthRaster } from '../depth-model';
import { estimateDepthMap } from '../depth-model';
import { classifyEmbedding, loadClip, type Clip, type LabelGuess } from './clip';
import { loadFlorence, type Florence, type RawBox } from './florence';
import { estimateMetricDepth, type MetricDepth } from './metric-depth';
import { drawOverlay, overlayDataUrl, type OverlayItem } from './overlay';
import { loadSam, type Mask, type Segmenter } from './sam2';

export const PERCEPTION_VERSION = 2;
export const PERCEIVE_TOOL_NAME = 'perceive_photo';

export interface Rle {
  width: number;
  height: number;
  /** Alternating run lengths starting with zeros (row-major). */
  runs: number[];
}
export function encodeRle(m: { width: number; height: number; data: ArrayLike<number> }): Rle {
  const runs: number[] = [];
  let cur = 0;
  let n = 0;
  for (let i = 0; i < m.width * m.height; i++) {
    const v = m.data[i] ? 1 : 0;
    if (v === cur) n++;
    else { runs.push(n); cur = v; n = 1; }
  }
  runs.push(n);
  return { width: m.width, height: m.height, runs };
}
export function decodeRle(r: Rle): Uint8Array {
  const out = new Uint8Array(r.width * r.height);
  let k = 0;
  let v = 0;
  for (const n of r.runs) {
    if (v) out.fill(1, k, k + n);
    k += n;
    v ^= 1;
  }
  return out;
}

export interface PerceivedObject {
  id: string;
  /** Normalised noun ("bed"). */
  label: string;
  /** The noun the caller asked for that found it, or null for the generic pass. */
  asked: string | null;
  source: 'measured';
  /** How it was found: the generic detection pass, phrase grounding of the asked nouns, or a one-noun query. */
  pass: 'generic' | 'grounding' | 'single';
  /** The detector's own noun, when the second pass changed the label (otherwise equal to `label`). */
  detectorLabel?: string;
  /** Second-pass label (CLIP over the vocabulary): its probability for `label`, and the best three. Absent when CLIP did not run. */
  labelConfidence?: number;
  labelAlternatives?: LabelGuess[];
  /** Mean probability of the model's box tokens (a weak confidence: it ranks, it does not certify). */
  confidence: number;
  /** [x0, y0, x1, y1] in 0..1, origin top-left. */
  box: [number, number, number, number];
  areaFraction: number;
  mask: { rle: Rle; score: number; areaFraction: number } | null;
  placement: Placement | null;
  appearance: Appearance | null;
  /** Neighbours and walls in words, from the placement. */
  relations: string[];
}

export interface SurfaceColours {
  floor: Appearance | null;
  ceiling: Appearance | null;
  walls: Appearance | null;
}

export interface PerceptionReport {
  version: typeof PERCEPTION_VERSION;
  photo: { width: number; height: number };
  models: { detector: string | null; segmenter: string | null; depth: string | null; labeller?: string | null };
  /** Models that could not run, with the reason. */
  unavailable: string[];
  camera: { fovDeg: number; fovRange: [number, number]; kind: 'z' | 'ray'; cameraHeight: number; yawDeg: number } | null;
  room: RoomBox | null;
  /** The relative-depth estimate (Depth Anything V2 small + door or ceiling anchor): a second opinion on the same photo. */
  crossCheck: { width: number; depth: number; height: number; basis: string } | null;
  /** The independent room-box estimators behind `room` (median of their families; spread is the confidence). */
  estimators: EstimatorResult[];
  /** Camera from vanishing points (image lines): field of view range, tilt (positive looks down), yaw, how much of the line length is explained. */
  vanishing: { fovDeg: number; fovRange: [number, number]; pitchDeg: number; yawDeg: number; rollDeg: number; explained: number; segments: number } | null;
  surfaces: SurfaceColours;
  /** The white reference of the photo (cast and exposure from the ceiling or a whitish wall), or null when no surface is whitish. */
  illuminant: Illuminant | null;
  objects: PerceivedObject[];
  /** Nouns asked for that no box was found for. */
  notFound: string[];
  caption: string | null;
  timingsMs: Record<string, number>;
  notes: string[];
}

export interface PerceiveDeps {
  /** The photo as RGBA, long side about 1024 (null when the host cannot decode). */
  raster: () => Promise<DepthRaster | null>;
  /** Replace the model loaders (tests). */
  detector?: () => Promise<{ ok: true; model: Florence } | { ok: false; reason: string }>;
  segmenter?: () => Promise<{ ok: true; model: Segmenter } | { ok: false; reason: string }>;
  metric?: (r: DepthRaster) => Promise<{ ok: true; depth: MetricDepth } | { ok: false; reason: string }>;
  relative?: typeof estimateDepthMap;
  /** Second-pass labeller and crop embeddings (CLIP). Default: loaded when the real detector is used; null: off. */
  clip?: (() => Promise<{ ok: true; model: Clip } | { ok: false; reason: string }>) | null;
  /** Field of view of the camera the metric network was trained on (Hypersim: 60 degrees); null: the depth is taken as exact. */
  trainedFovDeg?: number | null;
}

/** Nouns of a room, used when the caller gives none (the first pass, before the inventory exists). */
export const DEFAULT_NOUNS = ['bed', 'nightstand', 'desk', 'chair', 'table', 'sofa', 'curtain', 'rug', 'lamp', 'painting', 'mirror', 'window', 'door', 'television', 'wardrobe', 'shelf', 'luggage', 'plant', 'pillow', 'towel'];
const WALLISH = /(curtain|window|door|painting|picture|frame|mirror|poster|clock|tv|television|screen|radiator|vent|sconce|detector|blind|shade|wall light|light fixture|glass)/;
const STRUCTURE = /^(wall|floor|ceiling|room|house|building|window frame|door frame)$/;

export const normLabel = (s: string): string => s.toLowerCase().replace(/^(a|an|the|some)\s+/, '').replace(/[^a-z0-9 \-]/g, '').trim();

const iou = (a: readonly number[], b: readonly number[]): number => {
  const w = Math.min(a[2] as number, b[2] as number) - Math.max(a[0] as number, b[0] as number);
  const h = Math.min(a[3] as number, b[3] as number) - Math.max(a[1] as number, b[1] as number);
  if (w <= 0 || h <= 0) return 0;
  const i = w * h;
  return i / (((a[2] as number) - (a[0] as number)) * ((a[3] as number) - (a[1] as number)) + ((b[2] as number) - (b[0] as number)) * ((b[3] as number) - (b[1] as number)) - i);
};

const WORKING = 128;

function resampleDepth(d: MetricDepth, w: number, h: number): DepthGrid {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.max(0, Math.min(d.height - 1, ((y + 0.5) * d.height) / h - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(d.height - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.max(0, Math.min(d.width - 1, ((x + 0.5) * d.width) / w - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(d.width - 1, x0 + 1);
      const tx = fx - x0;
      const g = (yy: number, xx: number): number => d.data[yy * d.width + xx] as number;
      out[y * w + x] = (g(y0, x0) * (1 - tx) + g(y0, x1) * tx) * (1 - ty) + (g(y1, x0) * (1 - tx) + g(y1, x1) * tx) * ty;
    }
  }
  return { width: w, height: h, data: out };
}

function shrinkMask(m: Mask, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = m.data[Math.min(m.height - 1, Math.floor(((y + 0.5) / h) * m.height)) * m.width + Math.min(m.width - 1, Math.floor(((x + 0.5) / w) * m.width))] as number;
  return out;
}

const bbox = (m: ArrayLike<number>, w: number, h: number): [number, number, number, number] | null => {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : [x0 / w, y0 / h, (x1 + 1) / w, (y1 + 1) / h];
};

interface Geometry {
  grid: DepthGrid;
  cam: Cam;
  fr: RoomFrame;
  /** The box in the geometry's own metric (its wall lines place the objects). */
  box: RoomBox;
  /** The fused room box: the report's room; placements are rescaled from `box` to it. */
  fused: RoomBox;
  sweep: { fov: number; kind: string; score: number }[];
  vp: ManhattanCamera | null;
  estimators: EstimatorResult[];
}

/** One photo, many calls: models load once, the vision towers and the depth run once, objects accumulate. */
export class Perceiver {
  private raster: DepthRaster | null = null;
  private florence: Promise<{ ok: true; model: Florence } | { ok: false; reason: string }> | null = null;
  private sam: Promise<{ ok: true; model: Segmenter } | { ok: false; reason: string }> | null = null;
  private clipP: Promise<{ ok: true; model: Clip } | { ok: false; reason: string }> | null = null;
  private clipReady = false;
  private embeds = new Map<string, Float32Array>();
  private florenceReady = false;
  private samReady = false;
  private objects: PerceivedObject[] = [];
  private masks = new Map<string, Mask>();
  private asked = new Set<string>();
  private geometry: Geometry | null | undefined;
  private surfaces: SurfaceColours = { floor: null, ceiling: null, walls: null };
  private crossCheck: PerceptionReport['crossCheck'] = null;
  private caption: string | null = null;
  private unavailable: string[] = [];
  private timings: Record<string, number> = {};
  private notes: string[] = [];
  private metricName: string | null = null;
  private counter = 0;
  /** The plane masks of the surface colours (for tests and the CLI overlay). */
  debugMasks: { floor: Uint8Array; ceil: Uint8Array; wall: Uint8Array; w: number; h: number } | null = null;

  constructor(private deps: PerceiveDeps) {}

  private time<T>(k: string, f: () => Promise<T>): Promise<T> {
    const t = performance.now();
    return f().finally(() => { this.timings[k] = Math.round((this.timings[k] ?? 0) + performance.now() - t); });
  }

  private note(s: string): void {
    if (!this.unavailable.includes(s)) this.unavailable.push(s);
  }

  async dispose(): Promise<void> {
    const f = this.florence ? await this.florence : null;
    if (f?.ok) await f.model.dispose().catch(() => undefined);
    const s = this.sam ? await this.sam : null;
    if (s?.ok) await s.model.dispose().catch(() => undefined);
    const cl = this.clipP ? await this.clipP : null;
    if (cl?.ok) await cl.model.dispose().catch(() => undefined);
    this.clipP = null;
    this.florence = null;
    this.sam = null;
  }

  /**
   * Detect and measure. `find`: nouns to look for (prompted pass); `generic`: also run the open detection pass (default true
   * on the first call). Returns the accumulated report.
   */
  async run(opt: { find?: string[]; generic?: boolean } = {}): Promise<PerceptionReport | null> {
    if (!this.raster) {
      this.raster = await this.deps.raster().catch(() => null);
      if (!this.raster) return null;
    }
    const r = this.raster;
    const wantGeneric = opt.generic ?? this.objects.length === 0;
    const nouns = [...new Set((opt.find ?? []).map(normLabel).filter((n) => n.length > 0))].filter((n) => !this.asked.has(n)).slice(0, 40);
    // 1. boxes
    const found: { raw: RawBox; pass: PerceivedObject['pass']; asked: string | null }[] = [];
    if (wantGeneric || nouns.length > 0) {
      this.florence ??= (this.deps.detector ?? loadFlorence)();
      const f = await this.time('load-detector', () => this.florence as Promise<{ ok: true; model: Florence } | { ok: false; reason: string }>);
      if (!f.ok) this.note(f.reason);
      else {
        if (!this.florenceReady) {
          await this.time('detector-image', () => f.model.setImage(r));
          this.florenceReady = true;
        }
        if (wantGeneric) {
          const od = await this.time('detect-generic', () => f.model.detect('<OD>', undefined, 400).catch(() => []));
          for (const raw of od) found.push({ raw, pass: 'generic', asked: null });
          if (!this.caption) this.caption = await this.time('caption', () => f.model.caption('<CAPTION>').catch(() => '')) || null;
        }
        if (nouns.length > 0) {
          for (let i = 0; i < nouns.length; i += 6) {
            const chunk = nouns.slice(i, i + 6);
            const boxes = await this.time('detect-grounding', () => f.model.detect('<CAPTION_TO_PHRASE_GROUNDING>', chunk.map((n) => `a ${n}`).join('. ') + '.', 300).catch(() => []));
            for (const raw of boxes) {
              const lab = normLabel(raw.label);
              const hit = chunk.find((n) => n === lab || lab.includes(n) || n.includes(lab)) ?? null;
              found.push({ raw: { ...raw, label: hit ?? lab }, pass: 'grounding', asked: hit });
            }
          }
          const have = new Set(found.filter((x) => x.asked).map((x) => x.asked));
          for (const n of nouns.filter((x) => !have.has(x) && !this.objects.some((o) => o.label === x))) {
            const boxes = await this.time('detect-single', () => f.model.detect('<OPEN_VOCABULARY_DETECTION>', n, 120).catch(() => []));
            for (const raw of boxes.slice(0, 3)) found.push({ raw: { ...raw, label: n }, pass: 'single', asked: n });
          }
        }
      }
      for (const n of nouns) this.asked.add(n);
    }
    // 2. dedupe against what is already known; drop the whole-frame boxes
    const fresh: PerceivedObject[] = [];
    const ranked = found.filter((x) => x.raw.label.length > 0).sort((a, b) => b.raw.confidence - a.raw.confidence);
    for (const x of ranked) {
      const lab = normLabel(x.raw.label);
      const area = (x.raw.box[2] - x.raw.box[0]) * (x.raw.box[3] - x.raw.box[1]);
      if (area > 0.85 || area < 0.0008 || STRUCTURE.test(lab)) continue;
      const dup = [...this.objects, ...fresh].find((o) => iou(o.box, x.raw.box) > 0.55 && (o.label === lab || iou(o.box, x.raw.box) > 0.8));
      if (dup) continue;
      fresh.push({ id: `p${++this.counter}`, label: lab, asked: x.asked, source: 'measured', pass: x.pass, confidence: Math.round(x.raw.confidence * 100) / 100, box: x.raw.box.map((v) => Math.round(v * 1000) / 1000) as PerceivedObject['box'], areaFraction: Math.round(area * 1000) / 1000, mask: null, placement: null, appearance: null, relations: [] });
    }
    // 3. masks (largest first, at most 30 objects in all)
    const room = 30 - this.objects.length;
    const toMask = fresh.sort((a, b) => b.areaFraction - a.areaFraction).slice(0, Math.max(0, room));
    if (toMask.length > 0) {
      this.sam ??= (this.deps.segmenter ?? loadSam)();
      const s = await this.time('load-segmenter', () => this.sam as Promise<{ ok: true; model: Segmenter } | { ok: false; reason: string }>);
      if (!s.ok) this.note(s.reason);
      else {
        if (!this.samReady) {
          await this.time('segmenter-image', () => s.model.setImage(r));
          this.samReady = true;
        }
        for (const o of toMask) {
          const seg = await this.time('segment', () => s.model.segment(o.box).catch(() => null));
          if (!seg) continue;
          const frac = seg.mask.data.reduce((a, b) => a + b, 0) / seg.mask.data.length;
          this.masks.set(o.id, seg.mask);
          const small = shrinkMask(seg.mask, Math.max(8, Math.round(seg.mask.width / 4)), Math.max(8, Math.round(seg.mask.height / 4)));
          o.mask = { rle: encodeRle({ width: Math.max(8, Math.round(seg.mask.width / 4)), height: Math.max(8, Math.round(seg.mask.height / 4)), data: small }), score: Math.round(seg.score * 100) / 100, areaFraction: Math.round(frac * 1000) / 1000 };
          const bb = bbox(seg.mask.data, seg.mask.width, seg.mask.height);
          if (bb && frac > 0.0005) o.box = bb.map((v) => Math.round(v * 1000) / 1000) as PerceivedObject['box'];
        }
      }
    }
    this.objects.push(...toMask);
    // 4. appearance (pixels of the mask), second-pass labels, duplicates merged, placement (metric depth)
    for (const o of toMask) {
      const m = this.masks.get(o.id);
      if (m) o.appearance = measureAppearance(r, m, o.box);
    }
    await this.relabel(toMask);
    this.mergeDuplicates();
    await this.geometryOnce();
    this.placeAll(toMask.length > 0 || this.objects.some((o) => !o.placement));
    return this.report();
  }

  /**
   * Second pass over each box: CLIP (box crop with its surroundings, and the masked crop) against the vocabulary. The label changes only
   * when CLIP is fairly sure of another object (probability 0.45 or more) AND gives the detector's own noun almost nothing (under 0.06):
   * a pillow on a bed keeps "pillow" (CLIP calls the crop a bed too, but the pillow keeps some of its probability).
   */
  private async relabel(objs: PerceivedObject[]): Promise<void> {
    if (objs.length === 0 || !this.raster) return;
    const loader = this.deps.clip === undefined ? (this.deps.detector === undefined ? loadClip : null) : this.deps.clip;
    if (!loader) return;
    this.clipP ??= loader();
    const c = await this.time('load-labeller', () => this.clipP as Promise<{ ok: true; model: Clip } | { ok: false; reason: string }>);
    if (!c.ok) { this.note(c.reason); return; }
    this.clipReady = true;
    const r = this.raster;
    for (const o of objs) {
      const m = this.masks.get(o.id);
      const [eb, em] = await this.time('label', () => c.model.embed(r, [{ box: o.box }, { box: o.box, mask: m }]));
      if (!eb || !em) continue;
      this.embeds.set(o.id, em);
      const g = classifyEmbedding([eb, em]);
      const top = g[0] as LabelGuess;
      const own = g.find((x) => x.label === o.label)?.p ?? 0.02;
      const detector = o.label;
      if (top.label !== detector && top.p >= 0.45 && own < 0.06) {
        o.detectorLabel = detector;
        o.label = top.label;
        o.labelConfidence = Math.round(top.p * 100) / 100;
      } else o.labelConfidence = Math.round(own * 100) / 100;
      o.labelAlternatives = g.slice(0, 3).map((x) => ({ label: x.label, p: Math.round(x.p * 100) / 100 }));
    }
  }

  /** CLIP embedding of any box of the photo (an inventory object that no detector box matched); null when the labeller is unavailable. */
  async embedBox(box: readonly [number, number, number, number]): Promise<Float32Array | null> {
    if (!this.raster) this.raster = await this.deps.raster().catch(() => null);
    const loader = this.deps.clip === undefined ? (this.deps.detector === undefined ? loadClip : null) : this.deps.clip;
    if (!this.raster || !loader) return null;
    this.clipP ??= loader();
    const c = await this.clipP;
    if (!c.ok) return null;
    return (await c.model.embed(this.raster, [{ box }]))[0] ?? null;
  }

  /** Embedding of an object's masked crop (CLIP), for appearance retrieval; null when the labeller did not run. */
  embeddingOf(id: string): Float32Array | null {
    return this.embeds.get(id) ?? null;
  }

  /**
   * Duplicates across prompts: the generic pass and the grounding pass find the same thing under different names. Two objects with the
   * same label whose masks overlap (IoU 0.6) or one inside the other (85 percent), or whose boxes nearly coincide (IoU 0.8), are one;
   * the more confident stays.
   */
  private mergeDuplicates(): void {
    const dec = (o: PerceivedObject): Uint8Array | null => (o.mask ? decodeRle(o.mask.rle) : null);
    const keep: PerceivedObject[] = [];
    for (const o of [...this.objects].sort((a, b) => b.confidence - a.confidence)) {
      const mo = dec(o);
      const dup = keep.find((k) => {
        if (k.label !== o.label && !(k.label.includes(o.label) || o.label.includes(k.label))) return false;
        const mk = dec(k);
        if (mo && mk && mo.length === mk.length) {
          let i = 0, a = 0, b = 0;
          for (let q = 0; q < mo.length; q++) { const x = mo[q] as number, y = mk[q] as number; a += x; b += y; if (x && y) i++; }
          const u = a + b - i;
          if (u > 0 && (i / u > 0.6 || i / Math.max(1, Math.min(a, b)) > 0.85)) return true;
        }
        return iou(k.box, o.box) > 0.8;
      });
      if (dup) { this.masks.delete(o.id); this.embeds.delete(o.id); continue; }
      keep.push(o);
    }
    if (keep.length !== this.objects.length) this.objects = this.objects.filter((o) => keep.includes(o));
  }

  private async geometryOnce(): Promise<void> {
    if (this.geometry !== undefined || !this.raster) return;
    const r = this.raster;
    const md = await this.time('metric-depth', () => (this.deps.metric ?? estimateMetricDepth)(r));
    if (!md.ok) { this.note(md.reason); this.geometry = null; return; }
    this.metricName = 'Depth Anything V2 metric indoor small';
    const w = WORKING;
    const h = Math.max(32, Math.round((WORKING * r.height) / r.width));
    const grid = resampleDepth(md.depth, w, h);
    const notWall = new Uint8Array(w * h);
    for (const o of this.objects) {
      const m = this.masks.get(o.id);
      if (!m || WALLISH.test(o.label)) continue;
      const s = shrinkMask(m, w, h);
      for (let i = 0; i < s.length; i++) if (s[i]) notWall[i] = 1;
    }
    const trained = this.deps.trainedFovDeg === undefined ? 60 : this.deps.trainedFovDeg;
    const legacy = await this.time('geometry', async () => solveCamera(grid, { notWall, ...(trained ? { trainedFovDeg: trained } : {}) }));
    // Independent reads of the room box: image lines (vanishing points) give the camera, depth gives the scale, and the families vote.
    const rel = await this.time('relative-depth', () => (this.deps.relative ?? estimateDepthMap)(r).catch(() => ({ ok: false as const, reason: 'failed' })));
    if (!rel.ok) this.note(`relative depth: ${rel.reason}`);
    const segMask = new Uint8Array(640 * Math.max(16, Math.round((r.height * 640) / r.width)));
    for (const o of this.objects) {
      const m = this.masks.get(o.id);
      if (!m || WALLISH.test(o.label)) continue;
      const sm = shrinkMask(m, 640, Math.max(16, Math.round((r.height * 640) / r.width)));
      for (let i = 0; i < sm.length; i++) if (sm[i]) segMask[i] = 1;
    }
    const lines = await this.time('lines', async () => detectSegments(r, { width: 640, maskOut: segMask }));
    const vp = await this.time('vanishing', async () => solveManhattan(lines.segments, lines.width, lines.height));
    const door = this.objects.filter((o) => /door/.test(o.label) && !/glass|patio|sliding/.test(o.label) && o.box[1] > 0.03 && o.box[3] < 0.97 && o.box[3] - o.box[1] > 0.25).sort((a, b) => b.confidence - a.confidence)[0];
    const ens = await this.time('room-ensemble', async () => estimateRoomEnsemble({ metric: grid, relative: rel.ok ? rel.map : null, vp, notWall, ...(door ? { anchor: { name: 'door', sizeM: 2.05, axis: 'height' as const, box: door.box, tolerance: 0.04 } } : {}), legacyMetric: legacy ? { box: legacy.box } : null, trainedFovDeg: trained }));
    const own = ens?.vpBox ?? (legacy ? { box: legacy.box, frame: legacy.fr, cloud: legacy.cloud, grid: legacy.grid, cam: legacy.cam } : null);
    if (!own) { this.note('no floor plane could be fitted to the depth map, so no room geometry'); this.geometry = null; return; }
    const fusedBox: RoomBox = ens ? { ...own.box, width: ens.width, depth: ens.depth, height: ens.height, notes: [...own.box.notes, ...ens.notes] } : own.box;
    this.geometry = { grid: own.grid, cam: own.cam, fr: own.frame, box: own.box, fused: fusedBox, sweep: legacy?.sweep ?? [], vp, estimators: ens?.estimators ?? [] };
    if (rel.ok) this.crossCheckFrom(rel.map);
    // surface colours from the plane masks
    const { fr, cam, box, grid: pg } = this.geometry;
    const floor = new Uint8Array(w * h);
    const ceil = new Uint8Array(w * h);
    const wall = new Uint8Array(w * h);
    const obj = new Uint8Array(w * h);
    for (const o of this.objects) {
      const m = this.masks.get(o.id);
      if (!m) continue;
      const s = shrinkMask(m, w, h);
      for (let i = 0; i < s.length; i++) if (s[i]) obj[i] = 1;
    }
    const cloudY = (u: number, v: number): { y: number; a: number; b: number } | null => {
      const d = pg.data[v * w + u] as number;
      if (!(d > 0.2 && d < 19.5)) return null;
      const a = (u - cam.cx) / cam.f;
      const b = -(v - cam.cy) / cam.f;
      const z = cam.kind === 'z' ? d : d / Math.sqrt(1 + a * a + b * b);
      const p: [number, number, number] = [a * z, b * z, z];
      return { y: p[0] * fr.up[0] + p[1] * fr.up[1] + p[2] * fr.up[2] + fr.cameraHeight, a: p[0] * fr.right[0] + p[1] * fr.right[1] + p[2] * fr.right[2], b: p[0] * fr.forward[0] + p[1] * fr.forward[1] + p[2] * fr.forward[2] };
    };
    const phi = (box.yawDeg * Math.PI) / 180;
    for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) {
      if (obj[v * w + u]) continue;
      const q = cloudY(u, v);
      if (!q) continue;
      if (Math.abs(q.y) < 0.08 + 0.04 * q.b && v > h * 0.45) floor[v * w + u] = 1;
      else if (box.walls.ceiling && q.y > box.height.value - 0.1 && q.y < box.height.value + 0.3) ceil[v * w + u] = 1;
      else if (q.y > 0.3 && q.y < Math.min(box.height.value - 0.3, 2.3)) {
        const o1 = q.a * Math.sin(phi) + q.b * Math.cos(phi);
        const o2 = q.a * Math.cos(phi) - q.b * Math.sin(phi);
        const near = (l: { s: number } | undefined, o: number): boolean => !!l && Math.abs(o - l.s) < 0.12;
        if (near(box.lines.back, o1) || near(box.lines.left, o2) || near(box.lines.right, o2)) wall[v * w + u] = 1;
      }
    }
    const app = (m: Uint8Array): Appearance | null => {
      // a surface that is barely in view (under 1.2 percent of the frame) is not read: a few pixels at a corner are not its colour
      if (m.reduce((a, b) => a + b, 0) < w * h * 0.012) return null;
      const bb = bbox(m, w, h);
      return bb ? measureAppearance(r, { width: w, height: h, data: m }, bb, { dominant: true }) : null;
    };
    this.debugMasks = { floor, ceil, wall, w, h };
    this.surfaces = { floor: app(floor), ceiling: app(ceil), walls: app(wall) };
  }

  /** Positions and sizes are measured in the geometry's own metric; the reported room is the fused one, so scale each axis to it. */
  private rescale(p: Placement, g: Geometry): Placement {
    const k = (a: number, b: number): number => (a > 0.5 && b > 0.5 ? b / a : 1);
    const sx = k(g.box.width.value, g.fused.width.value);
    const sz = k(g.box.depth.value, g.fused.depth.value);
    const sy = k(g.box.height.value, g.fused.height.value);
    if (sx === 1 && sz === 1 && sy === 1) return p;
    const r = (v: number): number => Math.round(v * 100) / 100;
    return { ...p, centre: { ...p.centre, x: r(p.centre.x * sx), z: r(p.centre.z * sz) }, size: { w: r(p.size.w * sx), d: r(p.size.d * sz), h: r(p.size.h * sy) }, y: { low: r(p.y.low * sy), high: r(p.y.high * sy) }, range: r(p.range * Math.sqrt(sx * sz)), against: p.against.map((a) => ({ ...a, gap: r(a.gap * (a.wall === 'back' ? sz : sx)) })) };
  }

  private placeAll(_redo: boolean): void {
    const g = this.geometry;
    if (!g) return;
    for (const o of this.objects) {
      if (o.placement) continue;
      const m = this.masks.get(o.id);
      if (!m) continue;
      const pl = placeObject(shrinkMask(m, g.grid.width, g.grid.height), g.grid, g.cam, g.fr, g.box, o.label);
      o.placement = pl ? this.rescale(pl, g) : null;
    }
    // relations
    for (const o of this.objects) {
      const p = o.placement;
      o.relations = [];
      if (!p) continue;
      for (const a of p.against) o.relations.push(`against the ${a.wall} wall (gap ${a.gap} m)`);
      if (p.kind === 'floor' || p.kind === 'surface') {
        const near = this.objects
          .filter((q) => q !== o && q.placement && (q.placement.kind === 'floor' || q.placement.kind === 'surface') && q.placement.centre.frame === p.centre.frame)
          .map((q) => ({ q, dx: (q.placement as Placement).centre.x - p.centre.x, dz: (q.placement as Placement).centre.z - p.centre.z }))
          .sort((a, b) => Math.hypot(a.dx, a.dz) - Math.hypot(b.dx, b.dz))
          .slice(0, 2);
        for (const n of near) {
          const gap = Math.max(0, Math.hypot(n.dx, n.dz) - ((n.q.placement as Placement).size.w + p.size.w) / 2);
          const dir = Math.abs(n.dx) > Math.abs(n.dz) ? (n.dx > 0 ? 'right of' : 'left of') : n.dz > 0 ? 'in front of' : 'behind';
          o.relations.push(`${dir === 'right of' ? 'left of' : dir === 'left of' ? 'right of' : dir === 'in front of' ? 'behind' : 'in front of'} ${n.q.label} ${n.q.id} (about ${Math.round(gap * 100) / 100} m apart)`.replace(/^/, ''));
        }
      }
    }
  }

  private crossCheckFrom(map: DisparityMap): void {
    if (this.crossCheck) return;
    // The door anchor: a detected door that is whole in the frame.
    const door = this.objects.filter((o) => /door/.test(o.label) && !/glass|patio|sliding/.test(o.label) && o.box[1] > 0.03 && o.box[3] < 0.97 && o.box[3] - o.box[1] > 0.25).sort((a, b) => b.confidence - a.confidence)[0];
    const est = estimateRoomFromDepth(map, door ? { anchor: { name: 'door', sizeM: 2.05, axis: 'height', box: door.box, tolerance: 0.04 } } : {});
    if (est) this.crossCheck = { width: est.width.value, depth: est.depth.value, height: est.height.value, basis: `relative depth, scale from ${door ? `the detected door ${door.id}` : 'a standard ceiling'}; width a lower bound` };
  }

  private illuminant(): Illuminant | null {
    const refs: { hex: string; kind: 'ceiling' | 'wall' }[] = [];
    if (this.surfaces.ceiling) refs.push({ hex: this.surfaces.ceiling.colour.hex, kind: 'ceiling' });
    if (this.surfaces.walls) refs.push({ hex: this.surfaces.walls.colour.hex, kind: 'wall' });
    return estimateIlluminant(refs);
  }

  report(): PerceptionReport {
    const g = this.geometry ?? null;
    const fovs = g ? g.sweep.filter((s) => s.score >= Math.max(...g.sweep.map((x) => x.score)) - 0.12).map((s) => s.fov) : [];
    return {
      version: PERCEPTION_VERSION,
      photo: { width: this.raster?.width ?? 0, height: this.raster?.height ?? 0 },
      models: { labeller: this.clipReady ? 'CLIP ViT-B/32 (MIT)' : null, detector: this.florenceReady ? 'Florence-2 base (MIT)' : null, segmenter: this.samReady ? 'SAM 2.1 Hiera tiny (Apache-2.0)' : null, depth: this.metricName ? `${this.metricName} (Apache-2.0)` : null },
      unavailable: [...this.unavailable],
      camera: g ? { fovDeg: g.vp?.fovDeg ?? g.cam.fovDeg, fovRange: g.vp ? g.vp.fovRange : [Math.min(...fovs, g.cam.fovDeg), Math.max(...fovs, g.cam.fovDeg)], kind: g.cam.kind, cameraHeight: Math.round(g.box.cameraHeight * (g.fused.height.value / Math.max(0.5, g.box.height.value)) * 100) / 100, yawDeg: g.vp?.yawDeg ?? g.box.yawDeg } : null,
      room: g?.fused ?? null,
      estimators: g?.estimators ?? [],
      vanishing: g?.vp ? { fovDeg: g.vp.fovDeg, fovRange: g.vp.fovRange, pitchDeg: g.vp.pitchDeg, yawDeg: g.vp.yawDeg, rollDeg: g.vp.rollDeg, explained: g.vp.explained, segments: g.vp.segmentsUsed } : null,
      crossCheck: this.crossCheck,
      surfaces: this.surfaces,
      illuminant: this.illuminant(),
      objects: this.objects.map((o) => ({ ...o })),
      notFound: [...this.asked].filter((n) => !this.objects.some((o) => o.asked === n || o.label === n)),
      caption: this.caption,
      timingsMs: { ...this.timings },
      notes: [...this.notes],
    };
  }

  /** The annotated picture (data URL), or null without a photo. */
  async overlay(): Promise<string | null> {
    if (!this.raster) return null;
    const items: OverlayItem[] = this.objects.map((o, i) => {
      const m = this.masks.get(o.id);
      const c = o.appearance?.colour.lab;
      return { box: o.box, label: `${i + 1} ${o.label}`, ...(m ? { mask: m } : {}), ...(o.appearance ? { rgb: hexRgb(o.appearance.colour.hex) } : {}), ...(c ? {} : {}) };
    });
    return overlayDataUrl(drawOverlay(this.raster, items));
  }

  /** Full-resolution mask of an object (for tests and the CLI). */
  maskOf(id: string): Mask | undefined {
    return this.masks.get(id);
  }
}

const hexRgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// ---- text for the model ----

const sw = (a: Appearance | null, ill?: Illuminant | null): string => (a ? `${a.colour.name} ${a.colour.hex}${ill ? ` (lit like white ${normaliseHex(a.colour.hex, ill)})` : ''}` : 'not measured');

export function perceptionText(rep: PerceptionReport, maxObjects = 30): string {
  const L: string[] = [];
  L.push('Perception report (MEASURED from the photo by vision models; advisory evidence, you decide, and each number can be wrong: check it against the image).');
  L.push(`Models: ${[rep.models.detector, rep.models.labeller, rep.models.segmenter, rep.models.depth].filter(Boolean).join('; ') || 'none ran'}.${rep.unavailable.length > 0 ? ` Unavailable: ${rep.unavailable.join(' | ')}.` : ''}`);
  if (rep.room && rep.camera) {
    const r = rep.room;
    const d = (x: RoomBox['width']): string => `${x.value} m (${x.low}-${x.high}, ${x.confidence}: ${x.basis})`;
    L.push(`Room (metric depth, planes fitted): width ${d(r.width)}; depth ${d(r.depth)}; height ${d(r.height)}. Camera ${r.cameraHeight} m above the floor, horizontal field of view about ${rep.camera.fovDeg} degrees (plausible ${rep.camera.fovRange[0]}-${rep.camera.fovRange[1]}), ${Math.abs(rep.camera.yawDeg) <= 6 ? 'facing the back wall' : `turned ${Math.abs(rep.camera.yawDeg)} degrees ${rep.camera.yawDeg > 0 ? 'right' : 'left'} of the back wall`}. Walls found: ${(['back', 'left', 'right', 'ceiling'] as const).filter((k) => r.walls[k]).join(', ') || 'none'}.${r.notes.length > 0 ? ` ${r.notes.join('; ')}.` : ''}`);
  }
  if (rep.crossCheck) L.push(`Cross-check (relative depth, ${rep.crossCheck.basis}): ${rep.crossCheck.width} x ${rep.crossCheck.depth} x ${rep.crossCheck.height} m. Where the two disagree, say which you trust and why.`);
  const s = rep.surfaces;
  if (s.floor || s.walls || s.ceiling) L.push(`Surfaces (pixels on the fitted planes, furniture removed): floor ${sw(s.floor, rep.illuminant)}${s.floor ? ` (${s.floor.pattern.kind}, ${s.floor.finish})` : ''}; walls ${sw(s.walls)}; ceiling ${sw(s.ceiling)}.`);
  if (rep.illuminant) L.push(`White reference (${rep.illuminant.reference}): exposure lift ${rep.illuminant.exposure}x, cast gains ${rep.illuminant.gains.map((g) => g.toFixed(2)).join('/')}. Colours below are as seen in the photo; "lit like white" is what they would read under that reference.`);
  if (rep.caption) L.push(`Caption: ${rep.caption}`);
  const objs = rep.objects.slice(0, maxObjects);
  if (objs.length > 0) {
    L.push(`Objects (${rep.objects.length} found; box = [x0,y0,x1,y1] of the photo; confidence is a weak ranking, a low one means check; sizes are the VISIBLE extents; room x from the left wall, z from the back wall toward the camera):`);
    objs.forEach((o, i) => {
      const a = o.appearance;
      const p = o.placement;
      const bits = [
        `${i + 1}. ${o.label}${o.detectorLabel ? ` (detector said "${o.detectorLabel}")` : ''} [${o.id}] conf ${o.confidence}${o.labelAlternatives ? `, label ${o.labelConfidence} (also ${o.labelAlternatives.filter((x) => x.label !== o.label).slice(0, 2).map((x) => `${x.label} ${x.p}`).join(', ')})` : ''}, box [${o.box.join(',')}], ${(o.areaFraction * 100).toFixed(1)}% of frame${o.mask ? `, mask ${o.mask.score}` : ', no mask'}`,
        a ? `colour ${a.colour.name} ${a.colour.hex}${rep.illuminant ? ` (lit like white ${normaliseHex(a.colour.hex, rep.illuminant)})` : ''} (Lab ${a.colour.lab.join(',')}), palette ${a.palette.map((c) => `${c.name} ${Math.round(c.share * 100)}%`).join(' / ')}, luminance ${a.luminance}, ${a.pattern.kind}${a.pattern.kind === 'plain' ? '' : ` (period ~${a.pattern.periodPx}px)`}, ${a.finish}` : '',
        p ? `${p.kind}, at x ${p.centre.x} z ${p.centre.z} m${p.centre.frame === 'camera' ? ' (camera frame: side walls not both found)' : ''}, visible size ${p.size.w} wide x ${p.size.h} high x ${p.size.d} deep m, ${p.y.low}-${p.y.high} m above the floor` : '',
        o.relations.length > 0 ? o.relations.join('; ') : '',
      ].filter(Boolean);
      L.push(bits.join('; '));
    });
    if (rep.objects.length > maxObjects) L.push(`(${rep.objects.length - maxObjects} more in the report)`);
  }
  if (rep.notFound.length > 0) L.push(`Asked for but no box found: ${rep.notFound.join(', ')} (absent from the photo, hidden, or missed by the detector: look).`);
  return L.join('\n');
}

