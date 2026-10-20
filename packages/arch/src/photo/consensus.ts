/**
 * One description from several independent reads of the same photograph.
 *
 * A single vision read of a photo is a sample: two reads of the same picture list 16 or 18 pieces, choose different
 * compass frames (the window on the north wall in one, on the west wall in the other), and put the same bed half a
 * metre apart. Everything after the read (the build, the checklist, the fidelity measures) inherits that sample, and
 * the compare loop cannot repair a description it is measured against. So the photo is read N times and the reads
 * are reconciled here, deterministically:
 *
 * 1. Frames. Every read is turned into the frame of an anchor read by a quarter-turn rotation (0..3 steps): the
 *    pieces seen in both reads are matched by where they appear in the PHOTO (their boxes do not depend on the
 *    compass), and their walls vote for the rotation; without votes the camera headings decide. The anchor is the
 *    read that agrees most with the others (ties: the canonical order of the reads, so the result does not depend on
 *    the order the reads arrived in).
 * 2. Matching. Openings and pieces are matched across reads within a class (`kindClass`: a nightstand and a coffee
 *    table read as "side table" are the same thing) by their photo box (centre distance, overlap) or, without boxes,
 *    by their position on the plan as a fraction of the room. Greedy one-to-one assignment by ascending cost, ties
 *    by index: deterministic.
 * 3. Votes. A cluster seen in a strict majority of the reads is kept. Per kept cluster: the kind, the placement mode
 *    (wall / at / on / opening / above), the wall and every reference (host, window, facing piece) by majority; the
 *    positions as the median of each read's value as a FRACTION of its wall or room (reads disagree on the room size
 *    too), sizes and other numbers by the median, colours by the medoid under CIEDE2000 (a colour a read actually
 *    gave, the one closest to all the others), words by majority. The room size, camera, wall finishes, floor,
 *    ceiling and light are reconciled the same way.
 * 4. Ids are canonical (`bed-1`, `art-2`, `window-1`, in photo order left to right), so the checklist built from the
 *    consensus is identical whenever the consensus is.
 *
 * Contested clusters (seen by some reads but not a majority, or kept without being unanimous) are reported, so an AI
 * reconciliation pass that looks at the photo can add or remove them, each with a reason ({@link ConsensusChoice}).
 */
import type { Compass } from '../plan';
import { hexDeltaE } from './colour';
import { parseRoomDescription, type ParsedDescription, type PhotoItem, type PhotoOpening, type RoomDescription } from './description';

const WALLS: readonly Compass[] = ['north', 'east', 'south', 'west'];
type Box = [number, number, number, number];
type P2 = [number, number];

/** Classes of kinds that reads confuse with each other; any other kind is its own class. */
const KIND_CLASS: Readonly<Record<string, string>> = Object.freeze({
  nightstand: 'side-table',
  'coffee-table': 'side-table',
  armchair: 'seat',
  chair: 'seat',
  'office-chair': 'seat',
  'bar-stool': 'seat',
  sofa: 'seat',
  sideboard: 'storage',
  wardrobe: 'storage',
  bookshelf: 'storage',
  drawer: 'storage',
  'table-lamp': 'lamp',
  'floor-lamp': 'lamp',
  pendant: 'ceiling-lamp',
  'ceiling-light': 'ceiling-lamp',
  art: 'wall-picture',
  mirror: 'wall-picture',
  whiteboard: 'wall-picture',
  'tv-set': 'screen',
  tv: 'screen',
  desk: 'table',
  'dining-table': 'table',
  plant: 'plant',
  tree: 'plant',
});

/** The class a kind is matched within. */
export function kindClass(kind: string): string {
  return KIND_CLASS[kind] ?? kind;
}

/** Box centre distance (fractions of the photo) below which two boxes can be the same thing. */
const BOX_MATCH = 0.14;
/** Plan distance (fraction of the room diagonal) below which two unboxed pieces can be the same thing. */
const PLAN_MATCH = 0.22;

// ---------------------------------------------------------------------------
// Small arithmetic
// ---------------------------------------------------------------------------

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Median (mean of the two middle values for an even count); null for none. */
export function medianOf(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

/** Most frequent value; ties go to the value seen first (the anchor read comes first). */
export function modeOf<T>(xs: readonly T[], key: (x: T) => string = (x) => JSON.stringify(x)): T | undefined {
  const counts = new Map<string, { n: number; first: number; v: T }>();
  xs.forEach((x, i) => {
    const k = key(x);
    const c = counts.get(k);
    if (c) c.n++;
    else counts.set(k, { n: 1, first: i, v: x });
  });
  let best: { n: number; first: number; v: T } | undefined;
  for (const c of counts.values()) if (!best || c.n > best.n || (c.n === best.n && c.first < best.first)) best = c;
  return best?.v;
}

/** The colour closest to all the others (sum of CIEDE2000); ties go to the first. Unparseable colours are ignored. */
export function medoidColour(xs: readonly string[]): string | undefined {
  const ok = xs.filter((x) => hexDeltaE(x, x) !== null);
  let best: string | undefined;
  let bestSum = Infinity;
  for (const a of ok) {
    let sum = 0;
    for (const b of ok) sum += hexDeltaE(a, b) ?? 0;
    if (sum < bestSum - 1e-9) {
      best = a;
      bestSum = sum;
    }
  }
  return best;
}

const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

function boxCentre(b: Box): P2 {
  return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
}

function iou(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return union > 0 ? inter / union : 0;
}

/** Box match cost (null: too far apart to be the same thing). */
function boxCost(a: Box, b: Box): number | null {
  const ca = boxCentre(a);
  const cb = boxCentre(b);
  const d = Math.hypot(ca[0] - cb[0], ca[1] - cb[1]);
  const o = iou(a, b);
  if (d > BOX_MATCH && o < 0.3) return null;
  return d + (1 - o) * 0.1;
}

// ---------------------------------------------------------------------------
// Frames: a quarter-turn rotation from one read's compass to another's
// ---------------------------------------------------------------------------

/** The wall a read's wall is in a frame rotated `r` quarter turns clockwise. */
export function rotateWall(w: Compass, r: number): Compass {
  return WALLS[(WALLS.indexOf(w) + r + 4 * 4) % 4] as Compass;
}

/** A plan point of a room `W` × `D` in the frame rotated `r` quarter turns (and the room size there). */
export function rotatePoint(p: P2, W: number, D: number, r: number): { p: P2; W: number; D: number } {
  let [x, z] = p;
  let w = W;
  let d = D;
  for (let k = 0; k < ((r % 4) + 4) % 4; k++) {
    // One quarter turn: the west wall becomes the north wall (see the module docs of description.ts for `along`).
    const nx = d - z;
    const nz = x;
    x = nx;
    z = nz;
    const t = w;
    w = d;
    d = t;
  }
  return { p: [x, z], W: w, D: d };
}

/** Rotate a whole description `r` quarter turns: walls, positions, the camera, the ridge. Ids and boxes are kept. */
export function rotateDescription(d: RoomDescription, r: number): RoomDescription {
  const q = ((r % 4) + 4) % 4;
  if (q === 0) return d;
  const { width: W, depth: D } = d.footprint;
  const rw = (w: Compass): Compass => rotateWall(w, q);
  const pt = (p: P2): P2 => rotatePoint(p, W, D, q).p;
  const odd = q % 2 === 1;
  const walls: RoomDescription['walls'] = {};
  for (const w of WALLS) {
    const f = d.walls[w];
    if (f) walls[rw(w)] = f;
  }
  const cam = pt([d.camera.x, d.camera.z]);
  const vault = d.ceiling.vault;
  return {
    ...d,
    footprint: odd ? { ...d.footprint, width: D, depth: W } : d.footprint,
    camera: { ...d.camera, x: cam[0], z: cam[1], heading: d.camera.heading + 90 * q },
    walls,
    ceiling: vault?.ridge && odd ? { ...d.ceiling, vault: { ...vault, ridge: vault.ridge === 'x' ? 'z' : 'x' } } : d.ceiling,
    openings: d.openings.map((o) => ({ ...o, wall: rw(o.wall) })),
    items: d.items.map((it) => ({
      ...it,
      ...(it.wall ? { wall: rw(it.wall) } : {}),
      ...(it.at ? { at: pt(it.at) } : {}),
      ...(it.faces && (WALLS as readonly string[]).includes(it.faces) ? { faces: rw(it.faces as Compass) } : {}),
    })),
    light: { ...d.light, from: d.light.from === 'none' ? 'none' : rw(d.light.from) },
  };
}

// ---------------------------------------------------------------------------
// Positions on the plan, as fractions of the room
// ---------------------------------------------------------------------------

function wallLength(d: RoomDescription, w: Compass): number {
  return w === 'north' || w === 'south' ? d.footprint.width : d.footprint.depth;
}

/** Point on the plan at `along` on a wall, `gap` into the room. */
function wallPoint(d: RoomDescription, w: Compass, along: number, gap: number): P2 {
  const { width: W, depth: D } = d.footprint;
  switch (w) {
    case 'north':
      return [along, gap];
    case 'east':
      return [W - gap, along];
    case 'south':
      return [W - along, D - gap];
    case 'west':
      return [gap, D - along];
  }
}

/** Where a piece is on the plan, as fractions of the room (null: nowhere that can be told). */
function planFraction(d: RoomDescription, it: PhotoItem, depth = 0): P2 | null {
  const { width: W, depth: D } = d.footprint;
  if (it.at) return [it.at[0] / W, it.at[1] / D];
  if (it.wall && it.along !== undefined) {
    const p = wallPoint(d, it.wall, it.along, it.gap ?? 0.3);
    return [p[0] / W, p[1] / D];
  }
  if (depth > 3) return null;
  const host = it.on ?? it.above;
  if (host) {
    const h = d.items.find((x) => x.id === host);
    if (h) return planFraction(d, h, depth + 1);
  }
  if (it.opening) {
    const o = d.openings.find((x) => x.id === it.opening);
    if (o) {
      const p = wallPoint(d, o.wall, o.along, 0.1);
      return [p[0] / W, p[1] / D];
    }
  }
  return null;
}

function openingFraction(d: RoomDescription, o: PhotoOpening): P2 {
  const p = wallPoint(d, o.wall, o.along, 0);
  return [p[0] / d.footprint.width, p[1] / d.footprint.depth];
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** Something that can be matched across reads. */
interface Entry {
  cls: string;
  box: Box | undefined;
  plan: P2 | null;
  wall: Compass | undefined;
}

function itemEntry(d: RoomDescription, it: PhotoItem): Entry {
  return { cls: kindClass(it.kind), box: it.box as Box | undefined, plan: planFraction(d, it), wall: it.wall };
}

function openingEntry(d: RoomDescription, o: PhotoOpening): Entry {
  return { cls: o.kind === 'window' ? 'window' : 'passage', box: o.box as Box | undefined, plan: openingFraction(d, o), wall: o.wall };
}

/** Match cost of two entries (null: not the same thing). `framed`: the plan positions are in the same frame. */
function entryCost(a: Entry, b: Entry, framed: boolean): number | null {
  if (a.cls !== b.cls) return null;
  if (a.box && b.box) return boxCost(a.box, b.box);
  if (framed && a.plan && b.plan) {
    const d = Math.hypot(a.plan[0] - b.plan[0], a.plan[1] - b.plan[1]);
    return d <= PLAN_MATCH ? 0.5 + d : null;
  }
  return null;
}

/** Greedy one-to-one assignment by ascending cost (ties: lower indices first). Returns pairs [i, j]. */
function assign(costs: ReadonlyArray<ReadonlyArray<number | null>>): Array<[number, number]> {
  const all: Array<[number, number, number]> = [];
  costs.forEach((row, i) => row.forEach((c, j) => (c !== null ? all.push([c, i, j]) : undefined)));
  all.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
  const usedI = new Set<number>();
  const usedJ = new Set<number>();
  const out: Array<[number, number]> = [];
  for (const [, i, j] of all) {
    if (usedI.has(i) || usedJ.has(j)) continue;
    usedI.add(i);
    usedJ.add(j);
    out.push([i, j]);
  }
  return out;
}

function entries(d: RoomDescription): Entry[] {
  return [...d.openings.map((o) => openingEntry(d, o)), ...d.items.map((it) => itemEntry(d, it))];
}

/**
 * The quarter turns that bring read `b` into the frame of read `a`: the walls of the things both reads see (matched by
 * their photo boxes) vote; without votes, the turn that brings the camera headings closest.
 */
export function frameRotation(a: RoomDescription, b: RoomDescription): number {
  const ea = entries(a);
  const eb = entries(b);
  const pairs = assign(ea.map((x) => eb.map((y) => (x.box && y.box ? entryCost(x, y, false) : null))));
  const votes = [0, 0, 0, 0];
  for (const [i, j] of pairs) {
    const wa = ea[i]?.wall;
    const wb = eb[j]?.wall;
    if (wa && wb) (votes[(WALLS.indexOf(wa) - WALLS.indexOf(wb) + 4) % 4] as number)++;
  }
  const headingGap = (r: number): number => {
    const diff = (((b.camera.heading + 90 * r - a.camera.heading) % 360) + 540) % 360 - 180;
    return Math.abs(diff);
  };
  let best = 0;
  for (let r = 1; r < 4; r++) {
    const vr = votes[r] as number;
    const vb = votes[best] as number;
    if (vr > vb || (vr === vb && headingGap(r) < headingGap(best))) best = r;
  }
  return best;
}

/** How many things two reads (in one frame) agree on, as a fraction of the larger read. */
function agreement(a: RoomDescription, b: RoomDescription): number {
  const ea = entries(a);
  const eb = entries(b);
  const n = assign(ea.map((x) => eb.map((y) => entryCost(x, y, true)))).length;
  return n / Math.max(1, ea.length, eb.length);
}

// ---------------------------------------------------------------------------
// Clusters
// ---------------------------------------------------------------------------

/** One member of a cluster: a piece (or opening) of one read, in the anchor frame. */
export interface Member<T> {
  /** Index of the read (in {@link ReadClusters.reads}). */
  read: number;
  value: T;
}

/** The same piece or opening across reads. */
export interface Cluster<T> {
  /** Stable id of the cluster in this reconciliation (`c-item-3`, `c-open-1`): what a reconciliation pass names. */
  key: string;
  members: Array<Member<T>>;
}

/** The reads in one frame and their clusters. */
export interface ReadClusters {
  /** The reads in canonical order, the anchor first, each rotated into the anchor's frame. */
  reads: RoomDescription[];
  /** Quarter turns applied to each read (same order as `reads`). */
  rotations: number[];
  openings: Array<Cluster<PhotoOpening>>;
  items: Array<Cluster<PhotoItem>>;
}

function cluster<T>(reads: readonly RoomDescription[], pick: (d: RoomDescription) => readonly T[], entry: (d: RoomDescription, t: T) => Entry, prefix: string): Array<Cluster<T>> {
  const clusters: Array<Cluster<T> & { entries: Entry[] }> = [];
  reads.forEach((d, r) => {
    const own = pick(d).map((v) => ({ v, e: entry(d, v) }));
    const costs = own.map((o) =>
      clusters.map((c) => {
        let best: number | null = null;
        for (const e of c.entries) {
          const cost = entryCost(o.e, e, true);
          if (cost !== null && (best === null || cost < best)) best = cost;
        }
        return best;
      }),
    );
    const taken = new Set<number>();
    for (const [i, j] of assign(costs)) {
      const c = clusters[j];
      const o = own[i];
      if (!c || !o) continue;
      c.members.push({ read: r, value: o.v });
      c.entries.push(o.e);
      taken.add(i);
    }
    own.forEach((o, i) => {
      if (!taken.has(i)) clusters.push({ key: '', members: [{ read: r, value: o.v }], entries: [o.e] });
    });
  });
  return clusters.map((c, i) => ({ key: `c-${prefix}-${i + 1}`, members: c.members }));
}

/** A canonical text of a read (the tie-break that makes the result independent of the order of the reads). */
function canonical(d: RoomDescription): string {
  return JSON.stringify(d);
}

/** Bring the reads into one frame and match their openings and pieces. Pure and deterministic. */
export function clusterReads(input: readonly RoomDescription[]): ReadClusters {
  const sorted = [...input].sort((a, b) => (canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0));
  if (sorted.length <= 1) {
    const d = sorted[0];
    if (!d) return { reads: [], rotations: [], openings: [], items: [] };
    return { reads: [d], rotations: [0], openings: d.openings.map((o, i) => ({ key: `c-open-${i + 1}`, members: [{ read: 0, value: o }] })), items: d.items.map((it, i) => ({ key: `c-item-${i + 1}`, members: [{ read: 0, value: it }] })) };
  }
  // The anchor: the read that agrees most with the others once each is turned into its frame.
  let anchor = 0;
  let bestScore = -1;
  for (let a = 0; a < sorted.length; a++) {
    const A = sorted[a] as RoomDescription;
    let s = 0;
    for (let b = 0; b < sorted.length; b++) if (b !== a) s += agreement(A, rotateDescription(sorted[b] as RoomDescription, frameRotation(A, sorted[b] as RoomDescription)));
    if (s > bestScore + 1e-9) {
      bestScore = s;
      anchor = a;
    }
  }
  const A = sorted[anchor] as RoomDescription;
  const order = [anchor, ...sorted.map((_, i) => i).filter((i) => i !== anchor)];
  const rotations = order.map((i) => (i === anchor ? 0 : frameRotation(A, sorted[i] as RoomDescription)));
  const reads = order.map((i, k) => rotateDescription(sorted[i] as RoomDescription, rotations[k] as number));
  return {
    reads,
    rotations,
    openings: cluster(reads, (d) => d.openings, openingEntry, 'open'),
    items: cluster(reads, (d) => d.items, itemEntry, 'item'),
  };
}

// ---------------------------------------------------------------------------
// The consensus description
// ---------------------------------------------------------------------------

/** What a reconciliation pass decided about the contested clusters (keys of {@link Cluster}). */
export interface ConsensusChoice {
  /** Clusters below the majority to keep after all. */
  add?: readonly string[];
  /** Kept clusters (not unanimous) to leave out. */
  remove?: readonly string[];
}

/** One cluster in the report: how many reads saw it and what became of it. */
export interface ClusterReport {
  key: string;
  /** The id it has in the consensus (absent: left out). */
  id?: string;
  kind: string;
  label: string;
  support: number;
  kept: boolean;
  /** The first member's photo box, for a reconciliation pass. */
  box?: Box;
  /** Where the first member put it, in words. */
  where: string;
}

/** What a consensus came from. */
export interface ConsensusReport {
  reads: number;
  /** Pieces and openings of each read (canonical order, anchor first). */
  itemsPerRead: number[];
  openingsPerRead: number[];
  rotations: number[];
  items: ClusterReport[];
  openings: ClusterReport[];
  /** Pieces dropped because what they stand on, hang above or belong to was left out. */
  orphans: string[];
}

/** Result of {@link consensusDescription}. */
export type ConsensusResult = { ok: true; description: RoomDescription; fixes: string[]; report: ConsensusReport } | { ok: false; error: string; report: ConsensusReport };

/** Strict majority of `n`. */
export function majority(n: number): number {
  return Math.floor(n / 2) + 1;
}

/** Medians of a list of optional numbers, when at least half of them are present. */
function medianOpt(xs: ReadonlyArray<number | undefined>): number | undefined {
  const v = xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  if (v.length === 0 || v.length * 2 < xs.length) return undefined;
  return r3(medianOf(v) as number);
}

function medianBox(xs: ReadonlyArray<Box | undefined>): Box | undefined {
  const v = xs.filter((x): x is Box => Array.isArray(x));
  if (v.length === 0 || v.length * 2 < xs.length) return undefined;
  return [0, 1, 2, 3].map((k) => r3(medianOf(v.map((b) => b[k] as number)) as number)) as Box;
}

/** Merge the part parameters of the members: numbers by the median, colours by the medoid, the rest by majority. */
function mergeParams(ps: ReadonlyArray<PhotoItem['params']>): PhotoItem['params'] {
  const keys: string[] = [];
  for (const p of ps) for (const k of Object.keys(p)) if (!keys.includes(k)) keys.push(k);
  const out: PhotoItem['params'] = {};
  for (const k of keys) {
    const vals = ps.map((p) => p[k]).filter((v): v is string | number | boolean => v !== undefined);
    if (vals.length * 2 < ps.length) continue;
    if (vals.every((v) => typeof v === 'number')) out[k] = r3(medianOf(vals as number[]) as number);
    else if (vals.every(isHex)) out[k] = medoidColour(vals as string[]) ?? (vals[0] as string);
    else {
      const m = modeOf(vals);
      if (m !== undefined) out[k] = m;
    }
  }
  return out;
}

type Placement = 'on' | 'opening' | 'above' | 'wall' | 'at' | 'none';
function placementOf(it: PhotoItem): Placement {
  if (it.on) return 'on';
  if (it.opening) return 'opening';
  if (it.above) return 'above';
  if (it.wall && it.along !== undefined) return 'wall';
  if (it.at) return 'at';
  return 'none';
}

function whereText(it: PhotoItem): string {
  if (it.on) return `on ${it.on}`;
  if (it.opening) return `at window ${it.opening}`;
  if (it.above) return `above ${it.above}`;
  if (it.wall && it.along !== undefined) return `${it.wall} wall, ${Math.round(it.along * 100) / 100} m along`;
  if (it.at) return `floor at ${Math.round(it.at[0] * 100) / 100}, ${Math.round(it.at[1] * 100) / 100}`;
  return 'in the room';
}

/** Photo order: left to right by the box centre, unboxed last; ties by the key. */
function photoOrder<T extends { box?: unknown }>(a: { key: string; v: T }, b: { key: string; v: T }): number {
  const ca = Array.isArray(a.v.box) ? boxCentre(a.v.box as Box) : null;
  const cb = Array.isArray(b.v.box) ? boxCentre(b.v.box as Box) : null;
  if (ca && cb && Math.abs(ca[0] - cb[0]) > 1e-6) return ca[0] - cb[0];
  if (ca && cb && Math.abs(ca[1] - cb[1]) > 1e-6) return ca[1] - cb[1];
  if (ca && !cb) return -1;
  if (!ca && cb) return 1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * The consensus of clustered reads: kept clusters (majority, plus `choice.add`, minus `choice.remove`) merged into one
 * description, validated and repaired like any read (`parseRoomDescription`). Deterministic for the same clusters and choice.
 */
export function consensusDescription(c: ReadClusters, knownKinds: readonly string[], choice: ConsensusChoice = {}): ConsensusResult {
  const n = c.reads.length;
  const need = majority(n);
  const add = new Set(choice.add ?? []);
  const remove = new Set(choice.remove ?? []);
  const keepCluster = (cl: Cluster<unknown>): boolean => {
    const s = new Set(cl.members.map((m) => m.read)).size;
    if (s >= need) return !(remove.has(cl.key) && s < n);
    return add.has(cl.key);
  };
  const report: ConsensusReport = {
    reads: n,
    itemsPerRead: c.reads.map((d) => d.items.length),
    openingsPerRead: c.reads.map((d) => d.openings.length),
    rotations: c.rotations,
    items: [],
    openings: [],
    orphans: [],
  };
  const A = c.reads[0];
  if (!A) return { ok: false, error: 'no reads', report };

  // Room size, camera.
  const W = medianOf(c.reads.map((d) => d.footprint.width)) as number;
  const D = medianOf(c.reads.map((d) => d.footprint.depth)) as number;
  const ceilingH = medianOf(c.reads.map((d) => d.footprint.ceiling)) as number;
  const unwrap = (h: number): number => A.camera.heading + ((((h - A.camera.heading) % 360) + 540) % 360) - 180;
  const camera: RoomDescription['camera'] = {
    x: r3((medianOf(c.reads.map((d) => d.camera.x / d.footprint.width)) as number) * W),
    z: r3((medianOf(c.reads.map((d) => d.camera.z / d.footprint.depth)) as number) * D),
    height: r3(medianOf(c.reads.map((d) => d.camera.height)) as number),
    heading: r3(medianOf(c.reads.map((d) => unwrap(d.camera.heading))) as number),
    pitch: r3(medianOf(c.reads.map((d) => d.camera.pitch)) as number),
    fov: r3(medianOf(c.reads.map((d) => d.camera.fov)) as number),
  };
  const lengthOf = (w: Compass): number => (w === 'north' || w === 'south' ? W : D);

  // Openings.
  const openingIds = new Map<string, string>();
  const keptOpenings = c.openings.filter(keepCluster);
  const openingDraft = keptOpenings.map((cl) => {
    const vals = cl.members.map((m) => m.value);
    const kind = modeOf(vals.map((o) => o.kind)) ?? 'window';
    const same = vals.filter((o) => o.kind === kind);
    const wall = modeOf(same.map((o) => o.wall)) ?? 'north';
    const onWall = cl.members.filter((m) => m.value.kind === kind && m.value.wall === wall);
    const along = medianOf(onWall.map((m) => m.value.along / wallLength(c.reads[m.read] as RoomDescription, wall))) as number;
    const rep = onWall[0]?.value ?? (same[0] as PhotoOpening);
    const glow = modeOf(same.map((o) => o.glow === true));
    const daylight = medoidColour(same.map((o) => o.daylight).filter(isHex));
    const height = medianOpt(same.map((o) => o.height));
    const sill = medianOpt(same.map((o) => o.sill));
    const box = medianBox(same.map((o) => o.box as Box | undefined));
    const v: PhotoOpening = {
      id: rep.id,
      kind,
      wall,
      along: r3(along * lengthOf(wall)),
      width: r3(medianOf(same.map((o) => o.width)) as number),
      ...(height !== undefined ? { height } : {}),
      ...(sill !== undefined ? { sill } : {}),
      visible: modeOf(same.map((o) => o.visible)) ?? true,
      ...(box ? { box } : {}),
      note: rep.note,
      ...(glow ? { glow: true } : {}),
      ...(glow && daylight ? { daylight } : {}),
    };
    return { key: cl.key, v };
  });
  openingDraft.sort(photoOrder);
  const openingCount = new Map<string, number>();
  for (const o of openingDraft) {
    const k = o.v.kind === 'window' ? 'window' : o.v.kind === 'door' ? 'door' : 'opening';
    const i = (openingCount.get(k) ?? 0) + 1;
    openingCount.set(k, i);
    openingIds.set(o.key, `${k}-${i}`);
    o.v = { ...o.v, id: `${k}-${i}` };
  }
  /** (read, opening id of that read) → consensus opening id. */
  const openingOf = new Map<string, string>();
  for (const cl of c.openings) {
    const id = openingIds.get(cl.key);
    if (id) for (const m of cl.members) openingOf.set(`${m.read}:${m.value.id}`, id);
  }

  // Pieces: first the ids (canonical), then the merged fields with references mapped to consensus ids.
  const keptItems = c.items.filter(keepCluster);
  const draft = keptItems.map((cl) => {
    const vals = cl.members.map((m) => m.value);
    const kind = modeOf(vals.map((it) => it.kind)) ?? (vals[0] as PhotoItem).kind;
    return { key: cl.key, cl, kind, v: { box: medianBox(cl.members.filter((m) => m.value.kind === kind).map((m) => m.value.box as Box | undefined)) } };
  });
  // Pieces that stand on or hang above others come after them in the list; inside each group, photo order.
  const dependent = (cl: Cluster<PhotoItem>): boolean => cl.members.filter((m) => m.value.on || m.value.above || m.value.opening).length * 2 > cl.members.length;
  draft.sort((a, b) => Number(dependent(a.cl)) - Number(dependent(b.cl)) || photoOrder(a, b));
  const itemIds = new Map<string, string>();
  const kindCount = new Map<string, number>();
  for (const d of draft) {
    const i = (kindCount.get(d.kind) ?? 0) + 1;
    kindCount.set(d.kind, i);
    itemIds.set(d.key, `${d.kind}-${i}`.slice(0, 36));
  }
  /** (read, piece id of that read) → consensus piece id (kept clusters only). */
  const itemOf = new Map<string, string>();
  for (const cl of c.items) {
    const id = itemIds.get(cl.key);
    if (id) for (const m of cl.members) itemOf.set(`${m.read}:${m.value.id}`, id);
  }
  const ref = (read: number, id: string | undefined, map: Map<string, string>): string | undefined => (id ? map.get(`${read}:${id}`) : undefined);

  const items: PhotoItem[] = [];
  for (const d of draft) {
    const id = itemIds.get(d.key) as string;
    const members = d.cl.members.filter((m) => m.value.kind === d.kind);
    const rep = members[0] as Member<PhotoItem>;
    // Placement: the most common mode. A dependent mode (on, above, at a window) needs its reference in the consensus;
    // when no read's reference made it, the reads that placed the piece on its own (a wall, the floor) decide, and
    // without any the piece is an orphan (a lamp floating where its table was is worse than no lamp).
    const resolves = (m: Member<PhotoItem>, p: Placement): boolean => (p === 'on' ? ref(m.read, m.value.on, itemOf) : p === 'above' ? ref(m.read, m.value.above, itemOf) : p === 'opening' ? ref(m.read, m.value.opening, openingOf) : 'ok') !== undefined;
    const modes = members.map((m) => placementOf(m.value));
    let placement: Placement = modeOf(modes) ?? 'none';
    let inMode = members.filter((m, i) => modes[i] === placement && resolves(m, placement));
    if (inMode.length === 0) {
      const own = members.map((m) => placementOf({ ...m.value, on: undefined, above: undefined, opening: undefined } as PhotoItem));
      placement = modeOf(own.filter((p) => p !== 'none')) ?? 'none';
      inMode = members.filter((_, i) => own[i] === placement);
      if (placement === 'none') {
        report.orphans.push(id);
        continue;
      }
    }
    const base: PhotoItem = {
      id,
      kind: d.kind,
      label: rep.value.label,
      params: mergeParams(members.map((m) => m.value.params)),
      visible: modeOf(members.map((m) => m.value.visible)) ?? true,
      confidence: r3(medianOf(members.map((m) => m.value.confidence)) as number),
      ...(d.v.box ? { box: d.v.box } : {}),
    };
    const faces = modeOf(members.map((m) => m.value.faces).filter((f): f is string => typeof f === 'string').map((f) => ((WALLS as readonly string[]).includes(f) ? f : `#${ref(members.find((x) => x.value.faces === f)?.read ?? 0, f, itemOf) ?? ''}`)));
    const facesV = faces === undefined || faces === '#' ? undefined : faces.startsWith('#') ? faces.slice(1) : faces;
    const facesCount = members.filter((m) => m.value.faces !== undefined).length;
    if (facesV && facesCount * 2 >= members.length) base.faces = facesV as PhotoItem['faces'];
    const bottom = medianOpt(members.map((m) => m.value.bottom));
    if (placement === 'on') {
      const host = modeOf(inMode.map((m) => ref(m.read, m.value.on, itemOf) as string));
      if (!host) {
        report.orphans.push(id);
        continue;
      }
      const off = inMode.map((m) => m.value.offset).filter((o): o is P2 => Array.isArray(o));
      items.push({ ...base, on: host, ...(off.length * 2 >= inMode.length && off.length > 0 ? { offset: [r3(medianOf(off.map((o) => o[0])) as number), r3(medianOf(off.map((o) => o[1])) as number)] as P2 } : {}) });
    } else if (placement === 'opening') {
      const op = modeOf(inMode.map((m) => ref(m.read, m.value.opening, openingOf) as string));
      if (!op) {
        report.orphans.push(id);
        continue;
      }
      const wall = keptOpenings.length > 0 ? openingDraft.find((o) => o.v.id === op)?.v.wall : undefined;
      items.push({ ...base, opening: op, ...(wall ? { wall } : {}), ...(bottom !== undefined ? { bottom } : {}) });
    } else if (placement === 'above') {
      const host = modeOf(inMode.map((m) => ref(m.read, m.value.above, itemOf) as string));
      if (!host) {
        report.orphans.push(id);
        continue;
      }
      const gap = medianOpt(inMode.map((m) => m.value.aboveGap));
      const wall = modeOf(inMode.map((m) => m.value.wall).filter((w): w is Compass => w !== undefined));
      const onWall = wall ? inMode.filter((m) => m.value.wall === wall && m.value.along !== undefined) : [];
      const along = onWall.length * 2 >= inMode.length && onWall.length > 0 ? r3((medianOf(onWall.map((m) => (m.value.along as number) / wallLength(c.reads[m.read] as RoomDescription, wall as Compass))) as number) * lengthOf(wall as Compass)) : undefined;
      items.push({ ...base, above: host, ...(gap !== undefined ? { aboveGap: gap } : {}), ...(wall && along !== undefined ? { wall, along } : {}) });
    } else if (placement === 'wall') {
      const wall = modeOf(inMode.map((m) => m.value.wall as Compass)) as Compass;
      const onWall = inMode.filter((m) => m.value.wall === wall);
      const along = r3((medianOf(onWall.map((m) => (m.value.along as number) / wallLength(c.reads[m.read] as RoomDescription, wall))) as number) * lengthOf(wall));
      const gap = medianOpt(onWall.map((m) => m.value.gap));
      const wallBottom = medianOpt(onWall.map((m) => m.value.bottom));
      items.push({ ...base, wall, along, ...(gap !== undefined ? { gap } : {}), ...(wallBottom !== undefined ? { bottom: wallBottom } : {}) });
    } else if (placement === 'at') {
      const at: P2 = [r3((medianOf(inMode.map((m) => (m.value.at as P2)[0] / (c.reads[m.read] as RoomDescription).footprint.width)) as number) * W), r3((medianOf(inMode.map((m) => (m.value.at as P2)[1] / (c.reads[m.read] as RoomDescription).footprint.depth)) as number) * D)];
      items.push({ ...base, at, ...(bottom !== undefined ? { bottom } : {}) });
    } else items.push({ ...base, ...(bottom !== undefined ? { bottom } : {}) });
  }
  // A piece whose host was itself dropped as an orphan goes too (until nothing changes).
  for (let changed = true; changed; ) {
    changed = false;
    const ids = new Set(items.map((i) => i.id));
    for (let k = items.length - 1; k >= 0; k--) {
      const it = items[k] as PhotoItem;
      const host = it.on ?? it.above;
      if (host && !ids.has(host)) {
        report.orphans.push(it.id);
        items.splice(k, 1);
        changed = true;
      } else if (typeof it.faces === 'string' && !(WALLS as readonly string[]).includes(it.faces) && !ids.has(it.faces)) {
        const { faces: _drop, ...rest } = it;
        items[k] = rest as PhotoItem;
      }
    }
  }

  // Surfaces, light, the rest.
  const walls: RoomDescription['walls'] = {};
  for (const w of WALLS) {
    const fs = c.reads.map((d) => d.walls[w]).filter((f): f is NonNullable<RoomDescription['walls'][Compass]> => f !== undefined);
    if (fs.length * 2 < n) continue;
    const color = medoidColour(fs.map((f) => f.color).filter(isHex));
    const material = modeOf(fs.map((f) => f.material).filter((m): m is string => typeof m === 'string'));
    walls[w] = { ...(color ? { color } : {}), ...(material ? { material } : {}), visible: modeOf(fs.map((f) => f.visible)) ?? true };
  }
  const floorColour = medoidColour(c.reads.map((d) => d.floor.color).filter(isHex));
  const cornices = c.reads.map((d) => d.ceiling.cornice).filter((x): x is NonNullable<RoomDescription['ceiling']['cornice']> => x !== undefined);
  const vaults = c.reads.map((d) => d.ceiling.vault).filter((x): x is NonNullable<RoomDescription['ceiling']['vault']> => x !== undefined);
  const ceilingColour = medoidColour(c.reads.map((d) => d.ceiling.color).filter(isHex));
  const ceiling: RoomDescription['ceiling'] = { ...(ceilingColour ? { color: ceilingColour } : {}) };
  if (cornices.length >= need) {
    const depth = medianOpt(cornices.map((x) => x.depth));
    const color = medoidColour(cornices.map((x) => x.color).filter(isHex));
    ceiling.cornice = { height: r3(medianOf(cornices.map((x) => x.height)) as number), ...(depth !== undefined ? { depth } : {}), ...(color ? { color } : {}) };
  }
  if (vaults.length >= need) {
    const ridge = modeOf(vaults.map((x) => x.ridge).filter((r): r is 'x' | 'z' => r !== undefined));
    const trusses = medianOpt(vaults.map((x) => x.trusses));
    const color = medoidColour(vaults.map((x) => x.color).filter(isHex));
    ceiling.vault = { rise: r3(medianOf(vaults.map((x) => x.rise)) as number), ...(ridge ? { ridge } : {}), ...(trusses !== undefined ? { trusses: Math.round(trusses) } : {}), ...(color ? { color } : {}) };
  }
  const light: RoomDescription['light'] = {
    timeOfDay: r3(medianOf(c.reads.map((d) => d.light.timeOfDay)) as number),
    sky: modeOf(c.reads.map((d) => d.light.sky)) ?? A.light.sky,
    from: modeOf(c.reads.map((d) => d.light.from)) ?? A.light.from,
    warmth: modeOf(c.reads.map((d) => d.light.warmth)) ?? A.light.warmth,
    brightness: r3(medianOf(c.reads.map((d) => d.light.brightness)) as number),
    note: A.light.note,
  };
  const assumptions = n > 1 ? [...A.assumptions.slice(0, 15), { id: 'consensus', text: `Merged from ${n} independent readings of the photo: kept what most of them saw, at the median of their positions and sizes.`, confidence: 0.6, adjust: '' }] : A.assumptions;

  const description: RoomDescription = {
    summary: A.summary,
    roomType: modeOf(c.reads.map((d) => d.roomType)) ?? A.roomType,
    style: modeOf(c.reads.map((d) => d.style)) ?? A.style,
    footprint: { width: r3(W), depth: r3(D), ceiling: r3(ceilingH) },
    camera,
    walls,
    floor: { material: modeOf(c.reads.map((d) => d.floor.material)) ?? A.floor.material, ...(floorColour ? { color: floorColour } : {}), note: A.floor.note },
    ceiling,
    openings: openingDraft.map((o) => o.v),
    items,
    light,
    palette: A.palette,
    assumptions,
  };

  const finalIds = new Set(items.map((i) => i.id));
  const describe = <T extends PhotoItem | PhotoOpening>(cl: Cluster<T>, ids: Map<string, string>, present: (id: string) => boolean): ClusterReport => {
    const first = cl.members[0]?.value as T;
    const id = ids.get(cl.key);
    const kept = id !== undefined && present(id);
    return {
      key: cl.key,
      ...(kept ? { id } : {}),
      kind: first.kind,
      label: 'label' in first ? (first as PhotoItem).label : (first as PhotoOpening).note,
      support: new Set(cl.members.map((m) => m.read)).size,
      kept,
      ...(Array.isArray(first.box) ? { box: first.box as Box } : {}),
      where: 'label' in first ? whereText(first as PhotoItem) : `${(first as PhotoOpening).wall} wall, ${Math.round((first as PhotoOpening).along * 100) / 100} m along`,
    };
  };
  report.items = c.items.map((cl) => describe(cl, itemIds, (id) => finalIds.has(id)));
  report.openings = c.openings.map((cl) => describe(cl, openingIds, () => true));

  const parsed: ParsedDescription = parseRoomDescription(description, knownKinds);
  if (!parsed.ok) return { ok: false, error: parsed.error, report };
  return { ok: true, description: parsed.value, fixes: parsed.fixes, report };
}

/** The clusters a reconciliation pass may decide on: below the majority (to add) or kept without every read (to remove). */
export function contested(report: ConsensusReport): { add: ClusterReport[]; remove: ClusterReport[] } {
  const all = [...report.openings, ...report.items];
  return { add: all.filter((c) => !c.kept && c.support < majority(report.reads)), remove: all.filter((c) => c.kept && c.support < report.reads) };
}
