/**
 * Fidelity: deterministic measures of how closely the built room follows the photo.
 *
 * The vision judge is the brain of the compare loop, but its absolute scores wander from one call to the next. These
 * measures do not: the same room gives the same numbers, every time. They compare the built room with the structured
 * description the model read off the photo (what is where, how big, what colour), plus, when the host supplies them,
 * the measures of the render against the photo itself (framing of the described boxes, pixel similarity, colour of
 * the regions). The loop uses them as a floor (a round may not make them worse) and shows them to the model as eyes.
 *
 * Every measure is 0..1 (1 = the room matches), null when there is nothing to measure. The sub-score is the weighted
 * mean of the measures that exist (see {@link FIDELITY_WEIGHTS}):
 *
 *   openings     per described window and door: built on the same wall with the same kind (else 0), then
 *                1 − 0.5·min(1, |Δcentre| / 0.6 m) − 0.25·min(1, |Δwidth| / 0.5 m) − 0.25·min(1, |Δsill|+|Δhead| / 0.6 m);
 *                built openings no description accounts for count as zeros
 *   inventory    F1 of the described pieces against the built ones: same id and kind 1, same id other kind 0.5,
 *                another piece of the same kind standing in for it 0.8, missing 0; extra built pieces lower the precision
 *   placement    per matched piece: 1 − min(1, error / 1.2 m), the error being the plan distance between where the
 *                description puts the piece and where it stands (wall pieces add the height difference; a surface piece
 *                not on its host, a curtain off its window count their distance)
 *   sizes        per described size (room width, depth and ceiling; a piece's width, height, depth params):
 *                1 − min(1, relative error / 0.6)
 *   materials    per described colour (each visible wall, floor, ceiling, each colour param of a piece):
 *                1 − min(1, ΔE00 / 20)
 *   clearance    1 − Σ penalties of the geometric checker findings (overlap, through a wall, blocked window or door,
 *                floating, outside, taller than the room): 0.12 per error, 0.04 per warning, floored at 0
 *   framing      1 − mean box error of the described boxes against the built pieces seen through the fitted camera
 *   similarity   pixel similarity of the graded render to the photo (structure, edges, colour)
 *   regionColour per described box: 1 − min(1, ΔE00 / 25) between the mean colour inside the box in the photo and
 *                inside the piece's box in the render
 */
import type { Entity, EntityId, Json, WorldDoc } from '@aether/core';
import { furnitureOfEntity } from '../furniture/assets';
import { rotateYaw, type P2 } from '../math2';
import type { Compass } from '../plan';
import { reviewFindings } from '../scene/dispatch';
import { readScene } from '../scene/read';
import type { Scene, SceneItem, SceneRoom } from '../scene/types';
import type { FramingReport } from './calibrate';
import { hexDeltaE } from './colour';
import type { PhotoItem, PhotoOpening, RoomDescription } from './description';
import { PHOTO_BUILDING_ID, PHOTO_ROOM_ID, PHOTO_WALL_INSET, deriveBuild } from './derive';

/** The measures. */
export interface FidelityMetrics {
  openings: number | null;
  inventory: number | null;
  placement: number | null;
  sizes: number | null;
  materials: number | null;
  clearance: number | null;
  framing: number | null;
  similarity: number | null;
  regionColour: number | null;
}
export type FidelityMetric = keyof FidelityMetrics;

/** Weights of the measures in the sub-score (they sum to 1; missing measures are left out and the rest renormalised). */
export const FIDELITY_WEIGHTS: Readonly<Record<FidelityMetric, number>> = Object.freeze({
  framing: 0.25,
  openings: 0.15,
  inventory: 0.15,
  placement: 0.1,
  similarity: 0.1,
  regionColour: 0.1,
  sizes: 0.05,
  materials: 0.05,
  clearance: 0.05,
});

/** Measures that describe the structure of the room: a round may not lower any of these by more than a sliver. */
export const STRUCTURAL_METRICS: readonly FidelityMetric[] = ['openings', 'inventory', 'clearance'];

/** One concrete difference, for the model and the log. */
export interface FidelityIssue {
  metric: FidelityMetric;
  /** Description id (piece, opening, wall) it is about. */
  id: string;
  /** 0..1 how far off (1 = completely). */
  severity: number;
  text: string;
}

/** Result of {@link measureFidelity}. */
export interface FidelityReport {
  metrics: FidelityMetrics;
  /** Weighted sub-score 0..1 of the measures that exist (null when none does). */
  score: number | null;
  /** The worst differences first. */
  issues: FidelityIssue[];
}

/** Render-side measures the host made (null when it could not). */
export interface RenderMeasures {
  framing?: FramingReport | null;
  similarity?: number | null;
  regionColour?: number | null;
}

/** Geometric checker codes that count against clearance. */
const CLEARANCE_CODES: ReadonlySet<string> = new Set(['item_overlap', 'item_through_wall', 'doorway_blocked', 'window_blocked', 'wall_item_floating', 'item_outside', 'taller_than_room', 'blocked_path']);

const PLACEMENT_SCALE = 1.2;
const SIZE_SCALE = 0.6;
const DELTA_E_SCALE = 20;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const mean = (xs: readonly number[]): number | null => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);
const r2 = (v: number): number => Math.round(v * 100) / 100;

/** Combine measures into the sub-score with {@link FIDELITY_WEIGHTS}. */
export function fidelityScore(m: FidelityMetrics): number | null {
  let sum = 0;
  let w = 0;
  for (const k of Object.keys(FIDELITY_WEIGHTS) as FidelityMetric[]) {
    const v = m[k];
    if (v === null || !Number.isFinite(v)) continue;
    sum += FIDELITY_WEIGHTS[k] * v;
    w += FIDELITY_WEIGHTS[k];
  }
  return w > 0 ? sum / w : null;
}

/** Room size of the description as the shell has it: interior width, depth. */
interface Frame {
  W: number;
  D: number;
}

/** Point on the inside face of a wall at `along` metres from its left corner (description frame = plan frame). */
function facePoint(f: Frame, wall: Compass, along: number): P2 {
  switch (wall) {
    case 'north':
      return [along, 0];
    case 'east':
      return [f.W, along];
    case 'south':
      return [f.W - along, f.D];
    case 'west':
      return [0, f.D - along];
  }
}

/** Unit normal pointing into the room from a wall. */
function inward(wall: Compass): P2 {
  return wall === 'north' ? [0, 1] : wall === 'south' ? [0, -1] : wall === 'east' ? [-1, 0] : [1, 0];
}

/** Distance from the wall face to the nearest point of a footprint, measured into the room. */
function depthFromWall(f: Frame, wall: Compass, fp: readonly P2[]): { near: number; far: number } {
  const d = fp.map((p) => (wall === 'north' ? p[1] : wall === 'south' ? f.D - p[1] : wall === 'east' ? f.W - p[0] : p[0]));
  return { near: Math.min(...d), far: Math.max(...d) };
}

const itemEntityId = (handle: string): EntityId => `${PHOTO_BUILDING_ID}-${handle}`;

/** Handle of a built piece (curtain panels map to their curtain). */
function handleOf(id: EntityId): string {
  const h = id.startsWith(`${PHOTO_BUILDING_ID}-`) ? id.slice(PHOTO_BUILDING_ID.length + 1) : id;
  return h;
}

/** Built pieces by description handle; curtain panels are listed under the curtain's handle. */
function builtByHandle(scene: Scene): Map<string, SceneItem[]> {
  const out = new Map<string, SceneItem[]>();
  for (const it of scene.items) {
    if (!it.id.startsWith(`${PHOTO_BUILDING_ID}-`)) continue;
    let h = handleOf(it.id);
    if (it.kind === 'curtain') h = h.replace(/-[lr]$/, '');
    const list = out.get(h) ?? [];
    list.push(it);
    out.set(h, list);
  }
  return out;
}

function centreOf(items: readonly SceneItem[]): [number, number, number] {
  const n = Math.max(1, items.length);
  return [items.reduce((s, i) => s + i.pos[0], 0) / n, Math.min(...items.map((i) => i.y0)), items.reduce((s, i) => s + i.pos[2], 0) / n];
}

// ---------------------------------------------------------------------------
// Openings
// ---------------------------------------------------------------------------

function measureOpenings(room: SceneRoom, openings: readonly PhotoOpening[], issues: FidelityIssue[]): number | null {
  if (openings.length === 0) return null;
  const used = new Set<EntityId>();
  const scores: number[] = [];
  for (const o of openings) {
    const isWindow = o.kind === 'window';
    const cands = room.walls
      .filter((w) => w.compass === o.wall)
      .flatMap((w) => w.openings)
      .filter((x) => !used.has(x.id) && (x.kind === 'window') === isWindow);
    const along = (c: number): number => c - PHOTO_WALL_INSET;
    const best = cands.sort((a, b) => Math.abs(along(a.centre) - o.along) - Math.abs(along(b.centre) - o.along))[0];
    if (!best) {
      scores.push(0);
      issues.push({ metric: 'openings', id: o.id, severity: 1, text: `${o.kind} ${o.id} is missing from the ${o.wall} wall` });
      continue;
    }
    used.add(best.id);
    const dPos = Math.abs(along(best.centre) - o.along);
    const dW = Math.abs(best.width - o.width);
    const sill = o.sill ?? (isWindow ? 0.9 : 0);
    const head = o.height !== undefined ? sill + o.height : null;
    const dV = Math.abs(best.sill - sill) + (head !== null ? Math.abs(best.top - head) : 0);
    const s = clamp01(1 - 0.5 * Math.min(1, dPos / 0.6) - 0.25 * Math.min(1, dW / 0.5) - 0.25 * Math.min(1, dV / 0.6));
    scores.push(s);
    if (s < 0.85) issues.push({ metric: 'openings', id: o.id, severity: 1 - s, text: `${o.kind} ${o.id}: centre ${r2(along(best.centre))} m (photo ${r2(o.along)}), ${r2(best.width)} m wide (photo ${r2(o.width)}), sill ${r2(best.sill)} m (photo ${r2(sill)})` });
  }
  // Openings the description does not account for (a window added by hand, a door in the wrong wall).
  for (const w of room.walls) {
    for (const x of w.openings) {
      if (used.has(x.id)) continue;
      scores.push(0);
      issues.push({ metric: 'openings', id: x.id, severity: 0.6, text: `an extra ${x.kind} on the ${w.compass} wall at ${r2(x.centre - PHOTO_WALL_INSET)} m that the photo does not show` });
    }
  }
  return mean(scores);
}

// ---------------------------------------------------------------------------
// Inventory, placement, sizes
// ---------------------------------------------------------------------------

interface Match {
  item: PhotoItem;
  built: SceneItem[];
}

function measureInventory(items: readonly PhotoItem[], built: Map<string, SceneItem[]>, issues: FidelityIssue[]): { score: number | null; matches: Match[] } {
  const want = items.filter((i) => i.kind !== 'cornice');
  const matches: Match[] = [];
  const claimed = new Set<string>();
  let hit = 0;
  const missing: PhotoItem[] = [];
  for (const it of want) {
    const b = built.get(it.id);
    if (!b || b.length === 0) {
      missing.push(it);
      continue;
    }
    claimed.add(it.id);
    if (b.every((x) => x.kind === it.kind)) {
      hit += 1;
      matches.push({ item: it, built: b });
    } else {
      hit += 0.5;
      issues.push({ metric: 'inventory', id: it.id, severity: 0.5, text: `${it.id} was described as a ${it.kind} but is built as a ${b[0]?.kind ?? '?'}` });
    }
  }
  // A piece placed again under another id stands in for the missing one of the same kind.
  const extras = [...built.entries()].filter(([h]) => !claimed.has(h) && !/^cornice-/.test(h));
  for (const it of missing) {
    const sub = extras.find(([h, b]) => !claimed.has(h) && b[0]?.kind === it.kind && !want.some((w) => w.id === h));
    if (sub) {
      claimed.add(sub[0]);
      hit += 0.8;
      matches.push({ item: it, built: sub[1] });
      continue;
    }
    issues.push({ metric: 'inventory', id: it.id, severity: 1, text: `${it.label || it.kind} (${it.id}) is missing` });
  }
  const builtCount = [...built.keys()].filter((h) => !/^cornice-/.test(h)).length;
  for (const [h, b] of extras) if (!claimed.has(h)) issues.push({ metric: 'inventory', id: h, severity: 0.4, text: `${b[0]?.kind ?? 'a piece'} ${h} is not in the photo` });
  if (want.length === 0 && builtCount === 0) return { score: null, matches };
  const recall = want.length === 0 ? 1 : hit / want.length;
  const precision = builtCount === 0 ? 0 : Math.min(1, hit / builtCount);
  return { score: recall + precision === 0 ? 0 : (2 * recall * precision) / (recall + precision), matches };
}

/** Where the description puts a piece: plan point and, for wall pieces, bottom height. Null when it gives no position. */
function describedSpot(f: Frame, d: RoomDescription, it: PhotoItem, built: SceneItem[], all: Map<string, SceneItem[]>): { at: P2; y: number | null } | null {
  const b = built[0];
  if (!b) return null;
  if (it.kind === 'curtain' && it.opening) {
    const o = d.openings.find((x) => x.id === it.opening);
    return o ? { at: facePoint(f, o.wall, o.along), y: null } : null;
  }
  if (b.mount === 'surface' && it.on) {
    const host = all.get(it.on)?.[0];
    if (!host) return null;
    const off = it.offset ?? [0, 0];
    const [ox, oz] = rotateYaw(off[0], off[1], host.yaw);
    return { at: [host.pos[0] + ox, host.pos[2] + oz], y: host.y1 };
  }
  if (b.mount === 'wall' && it.wall && it.along !== undefined) {
    let y: number | null = it.bottom ?? null;
    if (it.above) {
      const host = all.get(it.above)?.[0];
      if (host) y = host.y1 + (it.aboveGap ?? 0.35);
    }
    return { at: facePoint(f, it.wall, it.along), y };
  }
  if (b.mount === 'ceiling') return { at: it.at ?? [f.W / 2, f.D / 2], y: null };
  if (it.wall && it.along !== undefined) {
    // A floor piece against a wall: its centre stands its own half depth (measured on the built piece) off the wall.
    const p = facePoint(f, it.wall, it.along);
    const n = inward(it.wall);
    const dd = depthFromWall(f, it.wall, b.footprint);
    const half = (dd.far - dd.near) / 2;
    const off = (it.gap ?? 0.02) + half;
    return { at: [p[0] + n[0] * off, p[1] + n[1] * off], y: null };
  }
  if (it.at) return { at: [it.at[0], it.at[1]], y: null };
  return null;
}

function measurePlacement(f: Frame, d: RoomDescription, matches: readonly Match[], all: Map<string, SceneItem[]>, issues: FidelityIssue[]): number | null {
  const scores: number[] = [];
  for (const m of matches) {
    const spot = describedSpot(f, d, m.item, m.built, all);
    if (!spot) continue;
    const c = centreOf(m.built);
    const plan = Math.hypot(c[0] - spot.at[0], c[2] - spot.at[1]);
    const vert = spot.y !== null ? Math.abs(c[1] - spot.y) : 0;
    const err = Math.hypot(plan, vert);
    const s = clamp01(1 - err / PLACEMENT_SCALE);
    scores.push(s);
    if (err > 0.25) issues.push({ metric: 'placement', id: m.item.id, severity: 1 - s, text: `${m.item.id} stands ${r2(err)} m from where the photo has it (${r2(plan)} m in plan${vert > 0.05 ? `, ${r2(vert)} m in height` : ''})` });
  }
  return mean(scores);
}

const SIZE_KEYS: ReadonlyArray<['width' | 'height' | 'depth', 0 | 1 | 2]> = [
  ['width', 0],
  ['height', 1],
  ['depth', 2],
];

function measureSizes(d: RoomDescription, room: SceneRoom, matches: readonly Match[], issues: FidelityIssue[]): number | null {
  const scores: number[] = [];
  const rel = (got: number, want: number): number => Math.abs(got - want) / Math.max(0.05, Math.abs(want));
  const push = (id: string, what: string, got: number, want: number): void => {
    const e = rel(got, want);
    const s = clamp01(1 - e / SIZE_SCALE);
    scores.push(s);
    if (e > 0.2) issues.push({ metric: 'sizes', id, severity: 1 - s, text: `${id} ${what} is ${r2(got)} m (photo ${r2(want)} m)` });
  };
  const inset = room.walls[0]?.inset ?? PHOTO_WALL_INSET;
  push('room', 'width', room.bbox[2] - room.bbox[0] - 2 * inset, d.footprint.width);
  push('room', 'depth', room.bbox[3] - room.bbox[1] - 2 * inset, d.footprint.depth);
  push('room', 'ceiling', room.ceiling, d.footprint.ceiling);
  for (const m of matches) {
    const b = m.built[0];
    if (!b) continue;
    for (const [key, axis] of SIZE_KEYS) {
      const v = m.item.params[key];
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue;
      push(m.item.id, key, b.size[axis], v);
    }
  }
  return mean(scores);
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

function colourOf(spec: unknown): string | null {
  if (typeof spec !== 'object' || spec === null) return null;
  const c = (spec as { color?: unknown }).color;
  return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : null;
}

/** The colour of the face of the wall entity that looks into the room along a scene wall. */
function wallFaceColour(world: WorldDoc, room: SceneRoom, compass: Compass): string | null {
  const w = room.walls.find((x) => x.compass === compass);
  if (!w) return null;
  const m: P2 = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
  const inside: P2 = [m[0] - w.out[0] * 0.3, m[1] - w.out[1] * 0.3];
  for (const e of Object.values(world.entities)) {
    if (e.arch?.role !== 'wall' || e.shape.kind !== 'procedural' || e.parent !== room.levelId) continue;
    const p = e.shape.params as Record<string, Json>;
    const len = typeof p['length'] === 'number' ? p['length'] : 0;
    const dir = rotateYaw(1, 0, e.transform.rotation[1]);
    const a: P2 = [e.transform.position[0], e.transform.position[2]];
    const t = (m[0] - a[0]) * dir[0] + (m[1] - a[1]) * dir[1];
    const off = -(m[0] - a[0]) * dir[1] + (m[1] - a[1]) * dir[0];
    if (t < -0.02 || t > len + 0.02 || Math.abs(off) > 0.05) continue;
    const side = -(inside[0] - a[0]) * dir[1] + (inside[1] - a[1]) * dir[0];
    return colourOf(side < 0 ? p['finishA'] : p['finishB']);
  }
  return null;
}

function entityParams(e: Entity | undefined): Record<string, Json> {
  if (!e) return {};
  return furnitureOfEntity(e)?.params ?? {};
}

function measureMaterials(world: WorldDoc, d: RoomDescription, room: SceneRoom, matches: readonly Match[], issues: FidelityIssue[]): number | null {
  const scores: number[] = [];
  const push = (id: string, what: string, want: string | undefined, got: string | null): void => {
    if (!want || !got) return;
    const de = hexDeltaE(want, got);
    if (de === null) return;
    const s = clamp01(1 - de / DELTA_E_SCALE);
    scores.push(s);
    if (de > 6) issues.push({ metric: 'materials', id, severity: 1 - s, text: `${what} is ${got}, the photo shows ${want} (ΔE ${Math.round(de)})` });
  };
  for (const c of ['north', 'east', 'south', 'west'] as const) {
    const f = d.walls[c];
    if (!f?.color || f.visible === false) continue;
    push(`wall-${c}`, `the ${c} wall`, f.color, wallFaceColour(world, room, c));
  }
  const slab = world.entities[room.id];
  if (slab?.shape.kind === 'procedural') push('floor', 'the floor', d.floor.color, colourOf((slab.shape.params as Record<string, Json>)['finish']));
  const ceil = world.entities[`${room.id}-ceil`];
  if (ceil?.shape.kind === 'procedural') push('ceiling', 'the ceiling', d.ceiling.color, colourOf((ceil.shape.params as Record<string, Json>)['finish']));
  for (const m of matches) {
    const got = entityParams(world.entities[m.built[0]?.id ?? '']);
    for (const [k, v] of Object.entries(m.item.params)) {
      if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v)) continue;
      const g = got[k];
      push(m.item.id, `${m.item.id} ${k}`, v, typeof g === 'string' ? g : null);
    }
  }
  return mean(scores);
}

// ---------------------------------------------------------------------------
// Clearance
// ---------------------------------------------------------------------------

function measureClearance(world: WorldDoc, issues: FidelityIssue[]): number {
  let penalty = 0;
  for (const f of reviewFindings(world, PHOTO_BUILDING_ID, { fast: true })) {
    if (!CLEARANCE_CODES.has(f.code)) continue;
    const p = f.severity === 'error' ? 0.12 : f.severity === 'warning' ? 0.04 : 0;
    if (p === 0) continue;
    penalty += p;
    issues.push({ metric: 'clearance', id: handleOf(f.entities[0] ?? f.code), severity: Math.min(1, p * 4), text: f.message.slice(0, 160) });
  }
  return clamp01(1 - penalty);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/**
 * Measure the built room against the description (and the render measures the host made). Deterministic: the same
 * world and description always give the same report. Null when the room cannot be read.
 */
export function measureFidelity(world: WorldDoc, d: RoomDescription, render: RenderMeasures = {}): FidelityReport | null {
  const scene = readScene(world, PHOTO_BUILDING_ID);
  const room = scene?.rooms.find((r) => r.key === PHOTO_ROOM_ID);
  if (!scene || !room) return null;
  const f: Frame = { W: d.footprint.width, D: d.footprint.depth };
  const issues: FidelityIssue[] = [];
  // The reference openings are the photo's plus the door the builder assumed when none was visible.
  const assumed = deriveBuild(d).assumedDoor;
  const openings = measureOpenings(room, assumed ? [...d.openings, assumed] : d.openings, issues);
  const built = builtByHandle(scene);
  const inv = measureInventory(d.items, built, issues);
  const metrics: FidelityMetrics = {
    openings,
    inventory: inv.score,
    placement: measurePlacement(f, d, inv.matches, built, issues),
    sizes: measureSizes(d, room, inv.matches, issues),
    materials: measureMaterials(world, d, room, inv.matches, issues),
    clearance: measureClearance(world, issues),
    framing: render.framing ? clamp01(render.framing.score) : null,
    similarity: render.similarity !== undefined && render.similarity !== null && Number.isFinite(render.similarity) ? clamp01(render.similarity) : null,
    regionColour: render.regionColour !== undefined && render.regionColour !== null && Number.isFinite(render.regionColour) ? clamp01(render.regionColour) : null,
  };
  if (render.framing) {
    for (const row of render.framing.rows) if (row.error > 0.25) issues.push({ metric: 'framing', id: row.label, severity: row.error, text: `${row.label} appears ${row.got ? 'elsewhere in the picture' : 'nowhere in the picture'} (box error ${Math.round(row.error * 100)}%)` });
  }
  issues.sort((a, b) => b.severity - a.severity || a.id.localeCompare(b.id) || a.metric.localeCompare(b.metric));
  return { metrics, score: fidelityScore(metrics), issues };
}

const LABELS: Readonly<Record<FidelityMetric, string>> = { openings: 'openings', inventory: 'inventory', placement: 'placement', sizes: 'sizes', materials: 'colours', clearance: 'clearance', framing: 'framing', similarity: 'similarity', regionColour: 'region colour' };

/** One line of the measures ("fidelity 81%: openings 100, inventory 95, …"). */
export function fidelityLine(r: FidelityReport): string {
  const parts = (Object.keys(FIDELITY_WEIGHTS) as FidelityMetric[]).flatMap((k) => (r.metrics[k] === null ? [] : [`${LABELS[k]} ${Math.round((r.metrics[k] as number) * 100)}`]));
  return `measured fidelity ${r.score === null ? 'n/a' : `${Math.round(r.score * 100)}%`}${parts.length > 0 ? ` (${parts.join(', ')})` : ''}`;
}

/** The measures and the worst differences, for the model. */
export function fidelityText(r: FidelityReport, limit = 10): string {
  const worst = r.issues.slice(0, limit);
  return [`Measured (deterministic, against your description and the photo): ${fidelityLine(r)}.`, ...(worst.length > 0 ? ['Largest measured differences:', ...worst.map((i) => `- [${LABELS[i.metric]}] ${i.text}`)] : [])].join('\n');
}
