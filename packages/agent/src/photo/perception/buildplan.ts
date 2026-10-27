/**
 * The PERCEPTION-DRIVEN FIRST BUILD. The perception report already holds, per object, a mask, a label (with the labeller's
 * alternatives), a position and extents in room metres, the wall or neighbour it stands against and a measured colour; and the
 * room box with the colours of floor, walls and ceiling. This file turns that into a BUILD PLAN (one record per real object,
 * merged with the two-seat inventory by the ids the seeding already gave), shows it to the model as a compact table, lets the
 * model accept, edit or drop every row with a reason, and places everything in one batch so each object has a linked built
 * piece before the first measured comparison. The measurements are a strong default; the model decides.
 *
 * Pure planning (`makeBuildPlan`, `planText`, `applyDecisions`, `placeItemsOf`, `surfaceOps`) is separate from the one
 * orchestrating generator (`buildFromMeasurements`) so each part is testable on synthetic reports.
 */
import { furnitureByKind, furnitureSize, itemEntityId, readScene, type FurnitureDef } from '@aether/arch';
import { PHOTO_BUILDING_ID, PHOTO_ROOM_ID, PHOTO_WALL_INSET, deltaE2000, hexToLab, normaliseHex } from '@aether/arch/photo';
import type { WorldDoc } from '@aether/core';
import { z } from 'zod';
import type { AgentEvent, ContentBlock, ToolDef } from '../../types';
import type { CompleteFn, InventoryItem } from '../objects';
import { COLOUR_PARAMS } from './tool';
import type { PerceivedObject, PerceptionReport } from './perceive';

export const BUILD_PLAN_TOOL_NAME = 'review_build_plan';
export const BUILD_PLAN_SEED = 7331;

type Compass = 'north' | 'east' | 'south' | 'west';
const COMPASS: Compass[] = ['north', 'east', 'south', 'west'];
export type PlanMount = 'floor' | 'wall' | 'surface' | 'ceiling';
export type PlanAction = 'place' | 'adjust' | 'keep' | 'drop';

export interface PlanRow {
  /** Row number in the table the model reads. */
  n: number;
  /** Inventory (ledger) id: the ONE record of this real object. */
  itemId: string;
  perceivedId: string;
  label: string;
  /** What the labeller thought it could also be, best first. */
  alternatives: string[];
  /** place: no piece yet, one is built. adjust: a piece is linked but off the measurement. keep: a piece is linked and agrees. drop: not built (reason). */
  action: PlanAction;
  /** The piece that already stands for it (keep, adjust), else null. */
  entity: string | null;
  /** Part kind of the parts library, or null when only a library model can stand for it. */
  kind: string | null;
  /** 'auto' (the finder picks for the kind and size) or a library model id (from the like-crop list). */
  model: string | null;
  /** Library models that look like the crop, best first. */
  candidates: string[];
  mount: PlanMount;
  /** Centre on the floor plane (world metres). */
  at: [number, number] | null;
  /** Against a wall (floor pieces), or hung on it (wall pieces): the wall, metres along it (place_items t) and the gap. */
  wall: { compass: Compass; t: number; gap: number } | null;
  /** Host row handle or entity id (surface pieces), with the offset in the host. */
  on: string | null;
  offset: [number, number] | null;
  /** Bottom height of a wall piece. */
  y: number | null;
  /** Width, height, depth of the piece (metres, its own frame). */
  fit: [number, number, number] | null;
  yaw: number | null;
  faces: [number, number] | null;
  /** Window a curtain hangs at (entity id of the built opening). */
  opening: string | null;
  /** Colour to give the main material (albedo estimate), else null. */
  hex: string | null;
  finish: string;
  /** Handle given to place_items; the entity id follows from it. */
  handle: string;
  notes: string[];
  /** Why a row is dropped (by the plan, then by the model). */
  reason: string;
  /** What the model did with the row. */
  decision: 'accept' | 'edit' | 'drop' | 'default';
  /** Set after the batch: the pieces built for it. */
  built: string[];
  refused: string;
}

export interface SurfacePlan {
  /** build_architecture ops that set floor and wall colours from the measured surfaces. */
  ops: Array<Record<string, unknown>>;
  lines: string[];
}

export interface BuildPlan {
  rows: PlanRow[];
  shell: { width: number; depth: number; ceiling: number };
  /** Index of the compass wall the camera looks at (0 north, 1 east, 2 south, 3 west). */
  back: number;
  surfaces: SurfacePlan;
  line: string;
}

export interface PlanInput {
  items: readonly InventoryItem[];
  report: PerceptionReport;
  shell: { width: number; depth: number; ceiling: number };
  camera: { x: number; z: number; heading: number };
  world: WorldDoc;
  /** Library models that look like each perceived crop (id -> model ids). */
  like?: ReadonlyMap<string, readonly string[]>;
  /** The shell the first build made: floor and wall material, to keep the finish and set the measured colour. */
  rooms?: { floor?: { finish?: string; color?: string } | undefined; finish?: { finish?: string; color?: string } | undefined; wallColor?: string | undefined };
}

const r2 = (v: number): number => Math.round(v * 100) / 100;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// ---------------------------------------------------------------------------------------------------------------- kinds

const SYNONYMS: ReadonlyArray<[RegExp, string]> = [
  [/\b(bedside|night)\s*(table|stand|cabinet)|\bnightstand\b/, 'nightstand'],
  [/\b(couch|settee|loveseat|sofa)\b/, 'sofa'],
  [/\b(tv|television|flat screen|monitor)\b/, 'tv'],
  [/\b(wardrobe|closet|armoire|cupboard)\b/, 'wardrobe'],
  [/\b(bookcase|bookshelf|shelf|shelves|shelving)\b/, 'bookshelf'],
  [/\b(painting|picture|poster|artwork|framed|photo frame|frame|print)\b/, 'art'],
  [/\bmirror\b/, 'mirror'],
  [/\b(dresser|chest of drawers|sideboard|cabinet|drawers)\b/, 'sideboard'],
  [/\b(stool|bar stool)\b/, 'bar-stool'],
  [/\boffice chair\b|\bswivel chair\b/, 'office-chair'],
  [/\barmchair\b|\barm chair\b|\blounge chair\b/, 'armchair'],
  [/\b(chair|seat)\b/, 'chair'],
  [/\b(desk|writing table|work table)\b/, 'desk'],
  [/\b(coffee table|side table|end table)\b/, 'coffee-table'],
  [/\b(dining table|table)\b/, 'dining-table'],
  [/\b(bed|bunk|mattress)\b/, 'bed'],
  [/\b(rug|carpet|mat)\b/, 'rug'],
  [/\b(plant|houseplant|flower|potted|tree)\b/, 'plant'],
  [/\bcurtains?\b|\bdrapes?\b/, 'curtain'],
  [/\bblinds?\b/, 'blind'],
  [/\b(sconce|wall light|wall lamp)\b/, 'sconce'],
  [/\b(pendant|chandelier|ceiling lamp|ceiling light)\b/, 'pendant'],
  [/\bfloor lamp\b|\bstanding lamp\b/, 'floor-lamp'],
  [/\b(table lamp|desk lamp|bedside lamp|lamp)\b/, 'table-lamp'],
  [/\bfridge|refrigerator\b/, 'fridge'],
  [/\bsink|washbasin\b/, 'sink'],
  [/\btoilet\b/, 'toilet'],
];
/** What a label stands for in the structure of the room, not a piece to build. */
const STRUCTURE_RE = /^(wall|floor|ceiling|room|house|building|window|door|window frame|door frame|doorway|baseboard|skirting|rail|curtain rail|sky|view|outside)$/;
const OPENING_RE = /^(window|glass window|door|glass door|sliding door|doorway)$/;

interface Resolved {
  kind: string | null;
  def: FurnitureDef | null;
  label: string;
}

/** The part kind a label (or its alternatives) stands for, placement-aware for lamps. */
export function resolveKind(labels: readonly string[], placementKind: PlanMount | null): Resolved {
  for (const raw of labels) {
    const label = raw.toLowerCase().trim();
    if (!label) continue;
    let kind: string | undefined;
    for (const [re, k] of SYNONYMS) if (re.test(label)) { kind = k; break; }
    kind ??= furnitureByKind(label)?.kind;
    if (kind === 'table-lamp' && /\blamp\b/.test(label) && !/table|desk|bedside/.test(label)) kind = placementKind === 'wall' ? 'sconce' : placementKind === 'floor' ? 'floor-lamp' : placementKind === 'ceiling' ? 'pendant' : 'table-lamp';
    if (kind === 'tv' && placementKind === 'surface') kind = 'tv-set';
    if (kind) {
      const def = furnitureByKind(kind);
      if (def) return { kind: def.kind, def, label };
    }
  }
  return { kind: null, def: null, label: labels[0] ?? '' };
}

/** The part-colour parameter that carries the main visible colour of a part. */
export function colourParam(def: FurnitureDef | null): string | null {
  if (!def) return null;
  for (const k of ['linen', 'color', 'upholstery', 'shade', 'seat', 'body', 'top', 'potColor']) if (def.params[k]?.type === 'color') return k;
  for (const k of COLOUR_PARAMS) if (def.params[k]?.type === 'color') return k;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------- frames

/** Compass index (0 north, 1 east, 2 south, 3 west) of the wall the camera looks at. */
export const backWallIndex = (headingDeg: number): number => ((Math.round((((headingDeg % 360) + 360) % 360) / 90) % 4) + 4) % 4;

/** Room frame (u from the left wall, v from the back wall) to world metres. */
export function roomToWorld(u: number, v: number, back: number, W: number, D: number): [number, number] {
  switch (back) {
    case 0: return [u, v];
    case 1: return [W - v, u];
    case 2: return [W - u, D - v];
    default: return [v, D - u];
  }
}

/** Metres along a wall (place_items t, left to right seen from inside, from the wall centreline's start) of a world point. */
export function alongWall(compass: Compass, x: number, z: number, W: number, D: number): number {
  const a = compass === 'north' ? x : compass === 'east' ? z : compass === 'south' ? W - x : D - z;
  return r2(a + PHOTO_WALL_INSET);
}

interface Box2 { x0: number; z0: number; x1: number; z1: number }
const overlapShare = (a: Box2, b: Box2): number => {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
  if (w <= 0 || h <= 0) return 0;
  const i = w * h;
  const u = (a.x1 - a.x0) * (a.z1 - a.z0) + (b.x1 - b.x0) * (b.z1 - b.z0) - i;
  return u > 0 ? i / u : 0;
};
const boxAt = (x: number, z: number, ex: number, ez: number): Box2 => ({ x0: x - ex / 2, z0: z - ez / 2, x1: x + ex / 2, z1: z + ez / 2 });

// ---------------------------------------------------------------------------------------------------------------- plan

const blank = (n: number, it: InventoryItem, po: PerceivedObject): PlanRow => ({
  n, itemId: it.id, perceivedId: po.id, label: it.label.replace(/ \(found by measurement\)$/, ''), alternatives: (po.labelAlternatives ?? []).map((a) => a.label).filter((l) => l !== po.label).slice(0, 3),
  action: 'place', entity: null, kind: null, model: null, candidates: [], mount: 'floor', at: null, wall: null, on: null, offset: null, y: null, fit: null, yaw: null, faces: null, opening: null,
  hex: null, finish: '', handle: `bp-${slug(po.id)}`, notes: [], reason: '', decision: 'default', built: [], refused: '',
});

interface SceneBits { id: string; kind: string; mount: string; pos: [number, number, number]; yaw: number; size: [number, number, number]; box: Box2; wall?: { compass: string; t: number } | undefined }

function sceneBits(world: WorldDoc): { items: SceneBits[]; openings: Array<{ id: string; kind: string; compass: Compass; t: number; width: number; sill: number; top: number }> } {
  const scene = readScene(world, PHOTO_BUILDING_ID);
  if (!scene) return { items: [], openings: [] };
  const items = scene.items.map((i) => {
    const xs = i.footprint.map((p) => p[0]);
    const zs = i.footprint.map((p) => p[1]);
    return { id: i.id, kind: i.kind, mount: i.mount, pos: i.pos, yaw: i.yaw, size: i.size, box: { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs) }, ...(i.wall ? { wall: { compass: i.wall.compass, t: i.wall.t } } : {}) };
  });
  const openings = scene.rooms.flatMap((r) => r.walls.flatMap((w) => w.openings.map((o) => ({ id: o.id, kind: o.kind, compass: w.compass as Compass, t: o.centre, width: o.width, sill: o.sill, top: o.top }))));
  return { items, openings };
}

/** Which part kinds stand for the same thing (a nightstand built where a table was measured is still the thing). */
const KIND_FAMILY: Record<string, string> = { 'dining-table': 'table', 'coffee-table': 'table', desk: 'table', nightstand: 'table', sideboard: 'table', chair: 'seat', 'office-chair': 'seat', armchair: 'seat', 'bar-stool': 'seat', sofa: 'seat', 'table-lamp': 'lamp', 'floor-lamp': 'lamp', sconce: 'lamp', pendant: 'lamp', art: 'art', mirror: 'art' };
const family = (k: string): string => KIND_FAMILY[k] ?? k;

/** The plan: one row per perceived object of the inventory, with where, how big, what colour, and what to do. */
export function makeBuildPlan(inp: PlanInput): BuildPlan {
  const { report, shell } = inp;
  const W = shell.width;
  const D = shell.depth;
  const back = backWallIndex(inp.camera.heading);
  const rb = report.room;
  const lr = back % 2 === 0 ? W : D;
  const fb = back % 2 === 0 ? D : W;
  // Measured room against the shell: positions follow the walls, so a shell of another size takes them in proportion (within 40 percent).
  const su = rb && rb.width.value > 1 ? clamp(lr / rb.width.value, 0.6, 1.4) : 1;
  const sv = rb && rb.depth.value > 1 ? clamp(fb / rb.depth.value, 0.6, 1.4) : 1;
  const bits = sceneBits(inp.world);
  const byPerceived = new Map(report.objects.map((o) => [o.id, o]));
  const rows: PlanRow[] = [];
  const takenEntities = new Set(inp.items.flatMap((i) => i.entities));
  const ill = report.illuminant;
  const hexOf = (po: PerceivedObject): string | null => {
    const h = po.appearance?.colour.hex;
    if (!h) return null;
    return ill ? normaliseHex(h, ill) : h;
  };
  // Floor pieces first, so surface pieces can find their host.
  const deferred: Array<{ row: PlanRow; cx: number; cz: number; mw: number; md: number; nat: [number, number, number]; h: number }> = [];
  const order = [...inp.items].filter((it) => it.measured?.id && byPerceived.has(it.measured.id) && it.category !== 'structure' && it.category !== 'view');
  for (const it of order) {
    const po = byPerceived.get(it.measured!.id) as PerceivedObject;
    const row = blank(rows.length + 1, it, po);
    rows.push(row);
    const pl = po.placement;
    const label = (po.label || it.kind).toLowerCase();
    if (STRUCTURE_RE.test(label) && !OPENING_RE.test(label)) { row.action = 'drop'; row.reason = `${label} is part of the shell, not a piece`; continue; }
    if (OPENING_RE.test(label)) {
      row.mount = 'wall';
      row.kind = /door/.test(label) ? 'door' : 'window';
      row.action = 'drop';
      row.reason = 'an opening of the shell: matched to the built openings below';
      if (pl) openingRow(row, po, pl, { back, W, D, su, sv, rb: rb ?? null }, bits.openings);
      continue;
    }
    const alt = [po.label, ...(po.labelAlternatives ?? []).filter((a) => a.p >= 0.12).map((a) => a.label)];
    if (!pl || pl.samples < 12) { row.action = it.entities.length > 0 ? 'keep' : 'drop'; row.reason = it.entities.length > 0 ? '' : 'no depth under the mask: the position is unknown (place it by hand if it is real)'; row.entity = it.entities[0] ?? null; continue; }
    const mount0: PlanMount = pl.kind;
    const res = resolveKind([it.kind, ...alt], mount0);
    row.kind = res.kind;
    // World centre of the visible surface.
    let cx: number;
    let cz: number;
    if (pl.centre.frame === 'room') {
      [cx, cz] = roomToWorld(pl.centre.x * su, pl.centre.z * sv, back, W, D);
    } else {
      // No side walls were found: the camera frame (x to the right, z the distance from the back wall when known) around the camera.
      const h = (inp.camera.heading * Math.PI) / 180;
      const fwd = rb?.camera ? rb.camera.z - pl.centre.z : pl.centre.z;
      cx = inp.camera.x + Math.cos(h) * pl.centre.x + Math.sin(h) * fwd;
      cz = inp.camera.z + Math.sin(h) * pl.centre.x - Math.cos(h) * fwd;
      row.notes.push('side walls not found: position from the camera frame (less certain)');
    }
    cx = clamp(cx, 0.05, W - 0.05);
    cz = clamp(cz, 0.05, D - 0.05);
    const mw = pl.size.w;
    const md = pl.size.d;
    // Axis-aligned extents in the world.
    const ex = back % 2 === 0 ? mw : md;
    const ez = back % 2 === 0 ? md : mw;
    row.mount = res.def ? (res.def.mount as PlanMount) : mount0;
    // Colour (albedo estimate) and finish.
    row.hex = hexOf(po);
    const a = po.appearance;
    row.finish = a ? `${a.finish}${a.pattern.kind === 'plain' ? '' : `, ${a.pattern.kind}`}` : '';
    row.candidates = [...(inp.like?.get(po.id) ?? [])].slice(0, 3);
    // An existing piece that stands for it: the ledger's link, else the built piece of the same sort standing at the measured spot.
    let ent: SceneBits | null = it.entities.length > 0 ? bits.items.find((b) => it.entities.includes(b.id)) ?? null : null;
    if (!ent && res.kind) {
      let bestD = Infinity;
      for (const b of bits.items) {
        if (takenEntities.has(b.id) || family(b.kind) !== family(res.kind)) continue;
        const d = Math.hypot(b.pos[0] - cx, b.pos[2] - cz);
        const reach = Math.max(0.5, 0.6 * Math.max(b.size[0], b.size[2]));
        // Close enough: it agrees. The very same kind a little further off is the piece the description built a bit off the measurement (moved below).
        if ((d < reach || (b.kind === res.kind && d < 1.6)) && d < bestD) { bestD = d; ent = b; }
      }
      if (ent) { takenEntities.add(ent.id); row.notes.push(`the built ${ent.kind} ${ent.id} is where it was measured: linked`); }
    }
    if (ent) {
      row.entity = ent.id;
      const d = Math.hypot(ent.pos[0] - cx, ent.pos[2] - cz);
      const farWall = ent.wall !== undefined;
      if (!farWall && d > 0.5 && row.mount === 'floor') {
        row.action = 'adjust';
        row.at = [r2(cx), r2(cz)];
        row.notes.push(`built ${r2(d)} m from the measured spot (${r2(ent.pos[0])}, ${r2(ent.pos[2])} against ${r2(cx)}, ${r2(cz)}): move`);
      } else row.action = 'keep';
      continue;
    }
    if (!res.kind && row.candidates.length === 0) { row.action = 'drop'; row.reason = `no part and no look-alike library model for "${label}"`; continue; }
    if (!res.kind) { row.kind = null; row.model = row.candidates[0] as string; row.notes.push(`no part named "${label}": the closest looking library model ${row.model} stands in`); }
    else row.model = 'auto';
    const def = res.def;
    // Natural size of the part (or the model's, unknown here: the part's, as the finder fits to it).
    const nat = def ? furnitureSize(def) : ([mw, pl.size.h, md] as [number, number, number]);
    const handle = row.handle;
    row.handle = handle;
    if (row.mount === 'ceiling') {
      row.at = [r2(cx), r2(cz)];
      row.fit = null;
    } else if (row.mount === 'wall') {
      // Hung on the nearest wall.
      const gaps: Array<[Compass, number]> = [['north', cz], ['south', D - cz], ['west', cx], ['east', W - cx]];
      gaps.sort((p, q) => p[1] - q[1]);
      const [compass] = gaps[0] as [Compass, number];
      const along = compass === 'north' || compass === 'south' ? ex : ez;
      row.wall = { compass, t: alongWall(compass, cx, cz, W, D), gap: 0 };
      row.y = r2(Math.max(0, pl.y.low));
      row.fit = [r2(clamp(along, nat[0] * 0.5, nat[0] * 2)), r2(clamp(pl.size.h, nat[1] * 0.5, nat[1] * 2)), nat[2]];
      if (row.kind === 'curtain' || row.kind === 'blind') {
        const o = bits.openings.filter((x) => x.compass === compass && x.kind !== 'door').sort((p, q) => Math.abs(p.t - row.wall!.t) - Math.abs(q.t - row.wall!.t))[0];
        if (o && Math.abs(o.t - row.wall.t) < Math.max(1, o.width)) { row.opening = o.id; row.fit = [r2(clamp(Math.max(along, o.width + 0.3), nat[0] * 0.5, nat[0] * 2.4)), r2(clamp(pl.size.h, nat[1] * 0.5, nat[1] * 1.3)), nat[2]]; }
        else { row.action = 'drop'; row.reason = `no window on the ${compass} wall near ${row.wall.t} m to hang it at`; continue; }
      }
    } else if (row.mount === 'surface') {
      // On the floor piece whose footprint holds the centre: resolved once every floor piece has its place.
      deferred.push({ row, cx, cz, mw, md, nat, h: pl.size.h });
    } else {
      // Floor piece: against the nearest wall when the gap is under about 15 cm, else free-standing facing the way a person uses it.
      const gaps: Array<[Compass, number]> = [['north', cz - ez / 2], ['south', D - cz - ez / 2], ['west', cx - ex / 2], ['east', W - cx - ex / 2]];
      // The report's own wall relation (measured on the points of the mask) wins over the gap computed from the centre and the extents.
      const side = (w: 'back' | 'left' | 'right'): Compass => COMPASS[(back + (w === 'back' ? 0 : w === 'left' ? 3 : 1)) % 4] as Compass;
      const rel = pl.against.filter((x) => x.gap < 0.15).sort((p, q) => p.gap - q.gap)[0];
      if (rel) gaps.unshift([side(rel.wall), rel.gap]);
      gaps.sort((p, q) => p[1] - q[1]);
      const [compass, gap] = gaps[0] as [Compass, number];
      const against = gap < 0.15;
      const alongAxisIsX = compass === 'north' || compass === 'south';
      let lw: number;
      let ld: number;
      if (against) { lw = alongAxisIsX ? ex : ez; ld = alongAxisIsX ? ez : ex; }
      else {
        // The part's long side follows the measured long side.
        const longMeasuredX = ex >= ez;
        const longNat = nat[0] >= nat[2];
        const widthAlongX = longMeasuredX === longNat ? true : false;
        lw = widthAlongX ? ex : ez;
        ld = widthAlongX ? ez : ex;
        row.yaw = widthAlongX ? 0 : 90;
      }
      // The depth seen is only the visible part: never less than three quarters of the part's own.
      ld = Math.max(ld, nat[2] * 0.75);
      const h = clamp(pl.y.high, nat[1] * 0.5, nat[1] * 2);
      row.fit = [r2(clamp(lw, nat[0] * 0.5, nat[0] * 2)), r2(h), r2(clamp(ld, nat[2] * 0.5, nat[2] * 2))];
      if (against) {
        row.wall = { compass, t: alongWall(compass, cx, cz, W, D), gap: r2(Math.max(0.02, gap)) };
        row.yaw = null;
        if (gap > 0.02) row.notes.push(`measured ${r2(Math.max(0, gap))} m from the ${compass} wall: stands against it`);
      } else {
        row.at = [r2(cx), r2(cz)];
        // Seats face the table, desk or bed next to them; everything else faces the camera (the front is what the photo shows).
        const seat = family(res.kind ?? '') === 'seat' || res.kind === 'bar-stool';
        const target = seat ? rows.filter((r) => r.n < row.n && r.at && ['desk', 'dining-table', 'coffee-table', 'bed'].includes(r.kind ?? '')).map((r) => ({ r, d: Math.hypot(r.at![0] - cx, r.at![1] - cz) })).filter((q) => q.d < 1.8).sort((p, q) => p.d - q.d)[0] : undefined;
        if (res.kind !== 'rug' && res.kind !== 'plant') { row.faces = target ? [target.r.at![0], target.r.at![1]] : [r2(inp.camera.x), r2(inp.camera.z)]; row.yaw = null; }
      }
    }
    void handle;
  }
  for (const dfr of deferred) {
    const { row, cx, cz, mw, md, nat } = dfr;
    const hosts = [
      ...bits.items.filter((b) => b.mount === 'floor').map((b) => ({ ref: b.id, box: b.box })),
      ...rows.filter((r) => r !== row && r.mount === 'floor' && r.action !== 'drop' && !r.entity && r.kind).flatMap((r) => { const fb = floorBox(r, inp, bits.items); return fb ? [{ ref: r.handle, box: fb }] : []; }),
    ];
    const host = hosts
      .map((h) => ({ ...h, d: Math.hypot((h.box.x0 + h.box.x1) / 2 - cx, (h.box.z0 + h.box.z1) / 2 - cz), inside: cx >= h.box.x0 - 0.12 && cx <= h.box.x1 + 0.12 && cz >= h.box.z0 - 0.12 && cz <= h.box.z1 + 0.12 }))
      .filter((h) => h.inside)
      .sort((p, q) => p.d - q.d)[0];
    if (!host) { row.action = 'drop'; row.reason = `nothing measured to stand it on near (${r2(cx)}, ${r2(cz)})`; continue; }
    row.on = host.ref;
    row.offset = [0, 0];
    row.fit = [r2(clamp(mw, nat[0] * 0.6, nat[0] * 1.6)), r2(clamp(dfr.h, nat[1] * 0.6, nat[1] * 1.6)), r2(clamp(md, nat[2] * 0.6, nat[2] * 1.6))];
  }
  // A rug snaps under the bed it overlaps the most (the same centre, a rug does not stop short of a bed); decor a bed carries is not floor.
  for (const r of rows) {
    if (r.kind !== 'rug' || !r.at || !r.fit) continue;
    const rugBox = boxAt(r.at[0], r.at[1], r.fit[0], r.fit[2]);
    const hit = rows.map((b) => ({ b, fb: b.kind === 'bed' && b.action !== 'drop' ? floorBox(b, inp, bits.items) : null })).find((x) => x.fb && overlapShare(rugBox, x.fb) > 0.2);
    if (hit?.fb) {
      const cxb = (hit.fb.x0 + hit.fb.x1) / 2;
      const czb = (hit.fb.z0 + hit.fb.z1) / 2;
      const alongX = !hit.b.wall || hit.b.wall.compass === 'north' || hit.b.wall.compass === 'south';
      r.at = alongX ? [r2(cxb), r.at[1]] : [r.at[0], r2(czb)];
      r.notes.push(`snapped under ${hit.b.handle} (the bed it overlaps), centred on it ${alongX ? 'across' : 'along'} the wall`);
    }
  }
  // Duplicates: two floor pieces of the same sort on the same ground are one object (the lower confidence one is dropped).
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i] as PlanRow;
    if (a.action === 'drop' || a.mount !== 'floor' || !a.kind) continue;
    for (let j = i + 1; j < rows.length; j++) {
      const b = rows[j] as PlanRow;
      if (b.action === 'drop' || b.mount !== 'floor' || b.kind !== a.kind) continue;
      const pa = a.at ?? a.wall ? floorBox(a, inp, bits.items) : null;
      const pb = b.at ?? b.wall ? floorBox(b, inp, bits.items) : null;
      if (pa && pb && overlapShare(pa, pb) > 0.5) {
        const ca = byPerceived.get(a.perceivedId)?.confidence ?? 0;
        const cb = byPerceived.get(b.perceivedId)?.confidence ?? 0;
        const loser = cb > ca && b.action !== 'keep' && b.action !== 'adjust' ? a : b;
        if (loser.action === 'keep' || loser.action === 'adjust') continue;
        loser.action = 'drop';
        loser.reason = `same ${a.kind} as #${loser === a ? b.n : a.n} (footprints overlap by more than half)`;
      }
    }
  }
  // A floor piece planned onto ground an existing piece already covers is that piece (same family: linked) or would be refused for the overlap (dropped with the reason).
  const linkedNow = new Set(rows.flatMap((r) => (r.entity ? [r.entity] : [])));
  for (const r of rows) {
    if (r.action !== 'place' || r.mount !== 'floor' || !r.kind) continue;
    const fb = floorBox(r, inp, bits.items);
    if (!fb) continue;
    const area = (b: Box2): number => (b.x1 - b.x0) * (b.z1 - b.z0);
    const hit = bits.items.filter((b) => b.mount === 'floor').map((b) => {
      const w = Math.min(fb.x1, b.box.x1) - Math.max(fb.x0, b.box.x0);
      const h = Math.min(fb.z1, b.box.z1) - Math.max(fb.z0, b.box.z0);
      return { b, share: w > 0 && h > 0 ? (w * h) / Math.max(0.01, Math.min(area(fb), area(b.box))) : 0 };
    }).filter((x) => x.share > 0.35).sort((p, q) => q.share - p.share)[0];
    if (!hit) continue;
    if (family(hit.b.kind) === family(r.kind) && !linkedNow.has(hit.b.id)) {
      r.action = 'keep'; r.entity = hit.b.id; linkedNow.add(hit.b.id);
      r.notes.push(`the built ${hit.b.kind} ${hit.b.id} already stands on this ground: linked, not built twice`);
    } else {
      r.action = 'drop';
      r.reason = `its footprint overlaps the built ${hit.b.kind} ${hit.b.id} by ${Math.round(hit.share * 100)}%${family(hit.b.kind) === family(r.kind) ? ' (already linked to another object: the same piece)' : ' (the room checks would refuse it: say so with an edit if the photo shows both)'}`;
    }
  }
  const surfaces = surfaceOps(report, inp.rooms);
  const counts = { place: 0, adjust: 0, keep: 0, drop: 0 } as Record<PlanAction, number>;
  for (const r of rows) counts[r.action]++;
  const line = `Build plan from the measurements: ${rows.length} perceived objects: ${counts.place} to build, ${counts.keep} already built where measured, ${counts.adjust} built but off the measurement, ${counts.drop} not built by default${surfaces.lines.length > 0 ? `; surfaces: ${surfaces.lines.join('; ')}` : ''}.`;
  return { rows, shell, back, surfaces, line };
}

function floorBox(r: PlanRow, inp: PlanInput, items: SceneBits[]): Box2 | null {
  if (!r.fit) return r.entity ? items.find((b) => b.id === r.entity)?.box ?? null : null;
  if (r.at) return boxAt(r.at[0], r.at[1], r.yaw === 90 ? r.fit[2] : r.fit[0], r.yaw === 90 ? r.fit[0] : r.fit[2]);
  if (r.wall) {
    const W = inp.shell.width;
    const D = inp.shell.depth;
    const { compass, t, gap } = r.wall;
    const a = t - PHOTO_WALL_INSET;
    const [lw, ld] = [r.fit[0], r.fit[2]];
    switch (compass) {
      case 'north': return { x0: a - lw / 2, z0: gap, x1: a + lw / 2, z1: gap + ld };
      case 'south': return { x0: W - a - lw / 2, z0: D - gap - ld, x1: W - a + lw / 2, z1: D - gap };
      case 'west': return { x0: gap, z0: D - a - lw / 2, x1: gap + ld, z1: D - a + lw / 2 };
      default: return { x0: W - gap - ld, z0: a - lw / 2, x1: W - gap, z1: a + lw / 2 };
    }
  }
  return null;
}

/** A window or door the shell may lack: matched to a built opening on the wall (linked), else proposed. */
function openingRow(row: PlanRow, po: PerceivedObject, pl: NonNullable<PerceivedObject['placement']>, f: { back: number; W: number; D: number; su: number; sv: number; rb: PerceptionReport['room'] }, openings: ReturnType<typeof sceneBits>['openings']): void {
  const isDoor = row.kind === 'door';
  const [cx, cz] = pl.centre.frame === 'room' ? roomToWorld(pl.centre.x * f.su, pl.centre.z * f.sv, f.back, f.W, f.D) : [f.W / 2, f.D / 2];
  const gaps: Array<[Compass, number]> = [['north', cz], ['south', f.D - cz], ['west', cx], ['east', f.W - cx]];
  gaps.sort((p, q) => p[1] - q[1]);
  const compass = (gaps[0] as [Compass, number])[0];
  const t = alongWall(compass, cx, cz, f.W, f.D);
  const along = compass === 'north' || compass === 'south' ? (f.back % 2 === 0 ? pl.size.w : pl.size.d) : (f.back % 2 === 0 ? pl.size.d : pl.size.w);
  const width = r2(clamp(Math.max(along, 0.5), 0.5, isDoor ? 2 : 4));
  const near = openings.filter((o) => o.compass === compass && (isDoor ? o.kind !== 'window' : o.kind === 'window')).sort((p, q) => Math.abs(p.t - t) - Math.abs(q.t - t))[0];
  row.wall = { compass, t, gap: 0 };
  row.fit = [width, r2(clamp(pl.size.h, 0.5, 3)), 0.1];
  row.y = r2(Math.max(0, pl.y.low));
  if (near && Math.abs(near.t - t) < Math.max(0.7, 0.6 * near.width)) {
    row.action = 'keep';
    row.entity = near.id;
    row.reason = '';
    row.notes.push(`the built ${near.kind} ${near.id} is at ${r2(near.t)} m on the ${compass} wall (measured ${t} m, width ${width} m): linked`);
  } else {
    row.action = 'place';
    row.reason = '';
    row.notes.push(`no ${isDoor ? 'door' : 'window'} on the ${compass} wall near ${t} m: added to the shell (width ${width} m, height ${row.fit[1]} m, sill ${row.y} m)`);
  }
  row.hex = null;
  void po;
}

// ---------------------------------------------------------------------------------------------------------------- surfaces

/** build_architecture ops that give floor and walls the measured colour (illuminant-normalised), when the first shell is off by a visible amount. */
export function surfaceOps(report: PerceptionReport, rooms: PlanInput['rooms']): SurfacePlan {
  const ops: Array<Record<string, unknown>> = [];
  const lines: string[] = [];
  const ill = report.illuminant;
  const target = (hex: string | undefined): string | null => (hex ? (ill ? normaliseHex(hex, ill) : hex) : null);
  const off = (planned: string | undefined, measured: string): number => {
    const a = planned ? hexToLab(planned) : null;
    const b = hexToLab(measured);
    return a && b ? deltaE2000(a, b) : 99;
  };
  const floor = target(report.surfaces.floor?.colour.hex);
  if (floor) {
    const dE = off(rooms?.floor?.color, floor);
    if (dE > 6) {
      ops.push({ op: 'set_material', building: PHOTO_BUILDING_ID, target: 'floor', room: PHOTO_ROOM_ID, material: { ...(rooms?.floor?.finish ? { finish: rooms.floor.finish } : {}), color: floor } });
      lines.push(`floor ${rooms?.floor?.color ?? 'unset'} -> ${floor} (${report.surfaces.floor?.finish ?? 'matte'})`);
    }
  }
  const wall = target(report.surfaces.walls?.colour.hex);
  if (wall) {
    const was = rooms?.wallColor ?? rooms?.finish?.color;
    if (off(was, wall) > 6) {
      ops.push({ op: 'set_material', building: PHOTO_BUILDING_ID, target: 'walls', room: PHOTO_ROOM_ID, material: { ...(rooms?.finish?.finish && rooms.finish.finish !== 'paint' ? { finish: rooms.finish.finish } : {}), color: wall } });
      lines.push(`walls ${was ?? 'unset'} -> ${wall}`);
    }
  }
  return { ops, lines };
}

// ---------------------------------------------------------------------------------------------------------------- table and decisions

const whereOf = (r: PlanRow): string => {
  if (r.on) return `on ${r.on}${r.offset ? ` (${r.offset[0]}, ${r.offset[1]})` : ''}`;
  if (r.wall) return `${r.mount === 'wall' ? 'hung on' : 'against'} ${r.wall.compass} wall t ${r.wall.t}${r.mount === 'wall' && r.y !== null ? `, bottom ${r.y} m` : r.wall.gap > 0 ? `, gap ${r.wall.gap}` : ''}`;
  if (r.at) return `at (${r.at[0]}, ${r.at[1]})${r.yaw !== null ? ` yaw ${r.yaw}` : ''}${r.faces ? ` facing (${r.faces[0]}, ${r.faces[1]})` : ''}`;
  return '';
};

/** The table the model reads. */
export function planText(plan: BuildPlan): string {
  const head = `${plan.line}\nShell ${plan.shell.width} x ${plan.shell.depth} x ${plan.shell.ceiling} m; the camera looks at the ${COMPASS[plan.back]} wall (x east, z south). Every row is ONE real object (inventory id = perceived id); colours are measured on the photo and lifted to how the surface would read under a white light.`;
  const lines = plan.rows.map((r) => {
    const what = r.action === 'drop' ? `DROP by default: ${r.reason}` : r.action === 'keep' ? `built: ${r.entity}` : `${r.action === 'adjust' ? `built ${r.entity}, move` : 'build'} ${r.kind ?? ''}${r.model && r.model !== 'auto' ? ` model ${r.model}` : r.model === 'auto' ? ' (finder picks the model)' : ''}`;
    return `#${r.n} ${r.itemId} [${r.perceivedId}] "${r.label}"${r.alternatives.length > 0 ? ` (or ${r.alternatives.join(', ')})` : ''} | ${what} | ${whereOf(r)}${r.fit ? ` | size ${r.fit.join(' x ')}` : ''}${r.hex ? ` | colour ${r.hex}` : ''}${r.finish ? ` ${r.finish}` : ''}${r.candidates.length > 0 ? ` | look-alike models ${r.candidates.join(', ')}` : ''}${r.opening ? ` | at window ${r.opening}` : ''}${r.notes.length > 0 ? ` | ${r.notes.join('; ')}` : ''}`;
  });
  return `${head}\n${lines.join('\n')}`;
}

export const BUILD_PLAN_TOOL: ToolDef = {
  name: BUILD_PLAN_TOOL_NAME,
  description:
    'Settle the build plan made from the measurements of the photo. For every row you disagree with give a decision; rows you do not list are accepted as they are. verdict "drop" (not built; give the reason: a false detection, a duplicate, a wrong label, not in the room) or "edit" (change fields: kind, model (a library model id from the look-alike list, or "auto"), x and z (floor centre), wall + t (+ gap) to stand it against or hang it on a wall, y (bottom of a wall piece), w h d (size in metres), yaw, color (#rrggbb)). The plan is the strong default: change a row only when you can point to the photo or the numbers.',
  inputSchema: {
    type: 'object',
    properties: {
      decisions: {
        type: 'array',
        maxItems: 80,
        items: {
          type: 'object',
          properties: {
            n: { type: 'integer' },
            verdict: { type: 'string', enum: ['accept', 'edit', 'drop'] },
            reason: { type: 'string' },
            kind: { type: 'string' }, model: { type: 'string' },
            x: { type: 'number' }, z: { type: 'number' }, wall: { type: 'string' }, t: { type: 'number' }, gap: { type: 'number' }, y: { type: 'number' },
            w: { type: 'number' }, h: { type: 'number' }, d: { type: 'number' }, yaw: { type: 'number' }, color: { type: 'string' },
          },
          required: ['n', 'verdict'],
        },
      },
      summary: { type: 'string' },
    },
    required: ['decisions'],
    additionalProperties: false,
  },
};

const Decision = z.object({
  n: z.number().int(),
  verdict: z.enum(['accept', 'edit', 'drop']),
  reason: z.string().max(300).optional(),
  kind: z.string().max(40).optional(), model: z.string().max(90).optional(),
  x: z.number().finite().optional(), z: z.number().finite().optional(), wall: z.string().max(10).optional(), t: z.number().finite().optional(), gap: z.number().finite().min(0).max(3).optional(), y: z.number().finite().optional(),
  w: z.number().finite().min(0.02).max(10).optional(), h: z.number().finite().min(0.02).max(10).optional(), d: z.number().finite().min(0.02).max(10).optional(), yaw: z.number().finite().optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});
const DecisionInput = z.object({ decisions: z.array(z.unknown()).max(80), summary: z.string().max(600).optional() });
export type PlanDecision = z.infer<typeof Decision>;

export function parseDecisions(input: unknown): { decisions: PlanDecision[]; skipped: number } | null {
  const p = DecisionInput.safeParse(input);
  if (!p.success) return null;
  const decisions: PlanDecision[] = [];
  let skipped = 0;
  for (const d of p.data.decisions) {
    const q = Decision.safeParse(d);
    if (q.success) decisions.push(q.data);
    else skipped++;
  }
  return { decisions, skipped };
}

/** Apply the model's decisions to the plan (a drop needs a reason of at least 8 characters). Returns what was done, in words. */
export function applyDecisions(plan: BuildPlan, decisions: readonly PlanDecision[]): { done: string[]; ignored: string[] } {
  const done: string[] = [];
  const ignored: string[] = [];
  for (const d of decisions) {
    const row = plan.rows.find((r) => r.n === d.n);
    if (!row) { ignored.push(`#${d.n}: no such row`); continue; }
    if (d.verdict === 'accept') {
      row.decision = 'accept';
      if (row.action === 'drop') { row.action = row.entity ? 'keep' : 'place'; row.reason = ''; row.notes.push('built on the model\'s decision although the plan dropped it'); }
      done.push(`#${d.n} accepted`);
      continue;
    }
    if (d.verdict === 'drop') {
      if (!d.reason || d.reason.trim().length < 8) { ignored.push(`#${d.n}: a drop needs a reason (at least 8 characters)`); continue; }
      row.decision = 'drop';
      row.action = 'drop';
      row.reason = d.reason.trim();
      done.push(`#${d.n} dropped (${row.reason.slice(0, 60)})`);
      continue;
    }
    // edit
    row.decision = 'edit';
    if (row.action === 'drop') row.action = row.entity ? 'adjust' : 'place';
    if (d.kind) {
      const def = furnitureByKind(d.kind);
      if (def) { row.kind = def.kind; row.mount = def.mount as PlanMount; if (!row.model) row.model = 'auto'; }
      else ignored.push(`#${d.n}: unknown kind "${d.kind}"`);
    }
    if (d.model) row.model = d.model.replace(/^model:/, '');
    if (row.kind === null && row.model === 'auto') { ignored.push(`#${d.n}: "auto" needs a kind; name a kind or a library model id`); row.model = row.candidates[0] ?? null; }
    if (d.x !== undefined && d.z !== undefined) { row.at = [r2(d.x), r2(d.z)]; row.wall = row.mount === 'wall' ? row.wall : null; }
    if (d.wall) {
      const c = d.wall.toLowerCase() as Compass;
      if (COMPASS.includes(c)) row.wall = { compass: c, t: d.t ?? row.wall?.t ?? 0, gap: d.gap ?? row.wall?.gap ?? 0.02 };
      else ignored.push(`#${d.n}: wall must be north, east, south or west`);
      if (row.mount !== 'wall') row.at = null;
    } else if (d.t !== undefined && row.wall) row.wall = { ...row.wall, t: d.t, ...(d.gap !== undefined ? { gap: d.gap } : {}) };
    if (d.y !== undefined) row.y = d.y;
    if (d.w !== undefined || d.h !== undefined || d.d !== undefined) {
      const f = row.fit ?? [0.5, 0.5, 0.5];
      row.fit = [d.w ?? f[0], d.h ?? f[1], d.d ?? f[2]];
    }
    if (d.yaw !== undefined) { row.yaw = d.yaw; row.faces = null; }
    if (d.color) row.hex = d.color.toLowerCase();
    if (d.reason) row.notes.push(`edited: ${d.reason.slice(0, 80)}`);
    done.push(`#${d.n} edited`);
  }
  return { done, ignored };
}

// ---------------------------------------------------------------------------------------------------------------- place_items

/** The batch, in the order that lets later pieces rest on earlier ones: rugs, floor pieces large to small, surface pieces, wall pieces, ceiling pieces. */
export function placeItemsOf(plan: BuildPlan): Array<{ row: PlanRow; item: Record<string, unknown> }> {
  const phase = (r: PlanRow): number => (r.kind === 'rug' ? 0 : r.mount === 'floor' ? 1 : r.mount === 'surface' ? 2 : r.mount === 'wall' ? 3 : 4);
  const area = (r: PlanRow): number => (r.fit ? r.fit[0] * r.fit[2] : 0);
  const rows = plan.rows.filter((r) => r.action === 'place' && r.kind !== 'window' && r.kind !== 'door' && !(r.kind === null && (r.model === null || r.model === 'auto'))).sort((a, b) => phase(a) - phase(b) || (phase(a) === 1 ? area(b) - area(a) : a.n - b.n));
  return rows.map((row) => {
    const def = row.kind ? furnitureByKind(row.kind) ?? null : null;
    const item: Record<string, unknown> = { room: PHOTO_ROOM_ID, id: row.handle, name: row.label.slice(0, 60) };
    if (row.kind) item['kind'] = row.kind;
    else if (row.model) item['kind'] = `model:${row.model}`;
    if (row.kind && row.model) item['model'] = row.model === 'auto' ? 'auto' : `model:${row.model}`;
    const params: Record<string, unknown> = {};
    if (row.hex && def) {
      const key = colourParam(def);
      if (key) params[key] = row.hex;
    }
    // Parts take their size from parameters; models are scaled to the fit.
    if (def && row.fit && (!row.model || row.model === 'auto')) {
      if (def.params['width']?.type === 'number') params['width'] = row.fit[0];
      if (def.params['depth']?.type === 'number') params['depth'] = row.fit[2];
      if (def.params['height']?.type === 'number' && row.mount !== 'wall') params['height'] = row.fit[1];
      if (def.params['height']?.type === 'number' && row.mount === 'wall') params['height'] = row.fit[1];
    }
    if (Object.keys(params).length > 0) item['params'] = params;
    if (row.fit && row.model) item['fit'] = row.fit;
    if (row.opening) { item['opening'] = row.opening; delete item['wall']; }
    else if (row.on) { item['on'] = row.on; if (row.offset) item['offset'] = row.offset; if (row.yaw !== null) item['yaw'] = row.yaw; }
    else if (row.wall) {
      item['wall'] = row.wall.compass;
      item['t'] = row.wall.t;
      if (row.mount === 'floor') item['gap'] = row.wall.gap;
      if (row.mount === 'wall' && row.y !== null) item['y'] = row.y;
    } else if (row.at) {
      item['at'] = row.at;
      if (row.faces) item['faces'] = { point: row.faces };
      else if (row.yaw !== null) item['yaw'] = row.yaw;
    }
    return { row, item };
  });
}

/** The refusal reason of each item (1-based) that a place_items reply reports refused. */
export function refusalsOf(text: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const block of text.split(/\n(?=\[\d+[^\]]*\] )/)) {
    const m = /^\[(\d+)[^\]]*\] refused: ([\s\S]*)$/.exec(block);
    if (m) out.set(Number(m[1]), (m[2] ?? '').replace(/\s*\n\s*/g, ' ').slice(0, 900));
  }
  return out;
}

/** The entities a handle produced in the world (the piece, or its parts: curtain panels). */
export function entitiesOfHandle(world: WorldDoc, handle: string): string[] {
  const base = itemEntityId(PHOTO_BUILDING_ID, handle);
  const ids = Object.keys(world.entities);
  if (world.entities[base]) return [base];
  return ids.filter((id) => id.startsWith(`${base}-`));
}

// ---------------------------------------------------------------------------------------------------------------- orchestration

export interface BuildDeps {
  report: PerceptionReport;
  items: () => InventoryItem[];
  /** Record the entities that stand for an inventory object in the ledger. */
  link: (itemId: string, entities: string[]) => void;
  /** Record that an object was not built, with the reason. */
  rejected?: (itemId: string, reason: string) => void;
  world: () => WorldDoc;
  shell: { width: number; depth: number; ceiling: number };
  camera: { x: number; z: number; heading: number };
  rooms?: PlanInput['rooms'];
  complete: CompleteFn;
  photoUrl: string;
  overlay?: () => Promise<string | null>;
  like?: (perceivedId: string) => Promise<string[]>;
  tool: (name: string, input: Record<string, unknown>) => Promise<{ content: string; isError: boolean; edited: boolean; events: AgentEvent[] }>;
  signal?: AbortSignal;
}

export interface BuildOutcome {
  plan: BuildPlan;
  placed: number;
  refused: number;
  dropped: number;
  linked: number;
  calls: number;
  /** Anything in the plan the model changed. */
  decisions: { accepted: number; edited: number; dropped: number };
  text: string;
}

export const BUILD_PLAN_SYSTEM =
  'You are a careful surveyor building a 3D room from one photograph. Specialised vision models have MEASURED the photo: for every object a mask, a label, a position and size in room metres, the wall it stands against and its colour. A plan was made from those numbers. You see the photo, the annotated photo and the plan table. Check each row against the photo: remove false detections (a thing that is not in the room), duplicates (one object listed twice), wrong labels (change the kind). Change a position, size or colour only when the photo clearly shows the plan is off. Rows you do not mention are built as planned. Call review_build_plan once.';

const MAX_PER_BATCH = 40;

/** The first build from the measurements: plan, model review, one batch of place_items, links in the ledger. */
export async function* buildFromMeasurements(deps: BuildDeps): AsyncGenerator<AgentEvent, BuildOutcome> {
  const aborted = (): void => { if (deps.signal?.aborted) throw new Error('aborted'); };
  let calls = 0;
  const like = new Map<string, readonly string[]>();
  if (deps.like) {
    for (const o of deps.report.objects.slice(0, 40)) {
      aborted();
      const ids = await deps.like(o.id).catch(() => [] as string[]);
      if (ids.length > 0) like.set(o.id, ids);
    }
  }
  const plan = makeBuildPlan({ items: deps.items(), report: deps.report, shell: deps.shell, camera: deps.camera, world: deps.world(), like, ...(deps.rooms ? { rooms: deps.rooms } : {}) });
  const empty: BuildOutcome = { plan, placed: 0, refused: 0, dropped: 0, linked: 0, calls: 0, decisions: { accepted: 0, edited: 0, dropped: 0 }, text: '' };
  if (plan.rows.length === 0) return { ...empty, text: 'The build plan has no perceived objects.' };
  yield { type: 'photo', phase: 'building', text: plan.line };
  // Surfaces first: floor and wall colours from the measured surfaces, before the furniture stands on them.
  if (plan.surfaces.ops.length > 0) {
    const out = await deps.tool('build_architecture', { ops: plan.surfaces.ops, message: 'Floor and wall colours measured on the photo' });
    for (const ev of out.events) yield ev;
    yield { type: 'photo', phase: 'building', text: out.isError ? `Surface colours were refused: ${out.content.slice(0, 200)}` : `Surfaces set from the measurements: ${plan.surfaces.lines.join('; ')}.` };
  }
  // Openings the shell lacks (a window or door the masks show on a wall).
  const addOpenings = plan.rows.filter((r) => (r.kind === 'window' || r.kind === 'door') && r.action === 'place' && r.wall && r.fit);
  if (addOpenings.length > 0) {
    for (const r of addOpenings) {
      aborted();
      const isDoor = r.kind === 'door';
      const op = { op: isDoor ? 'add_door' : 'add_window', building: PHOTO_BUILDING_ID, level: 0, [isDoor ? 'door' : 'window']: { id: r.handle, kind: r.kind, room: PHOTO_ROOM_ID, wall: r.wall!.compass, along: r.wall!.t, width: r.fit![0], height: r.fit![1], ...(isDoor ? {} : { sill: r.y ?? 0.9, style: 'picture' }) } };
      const out = await deps.tool('build_architecture', { ops: [op], message: `${isDoor ? 'Door' : 'Window'} ${r.perceivedId} measured on the photo` });
      for (const ev of out.events) yield ev;
      if (out.isError) r.refused = out.content.slice(0, 300);
      else {
        const ids = entitiesOfHandle(deps.world(), r.handle);
        if (ids.length > 0) { r.built = ids; deps.link(r.itemId, ids); }
      }
    }
  }
  // Already built pieces that agree with the measurement are linked now (the ledger records entity <-> perceived object).
  let linked = 0;
  for (const r of plan.rows) if ((r.action === 'keep' || r.action === 'adjust') && r.entity) { deps.link(r.itemId, [r.entity]); linked++; }
  // The model reviews the plan.
  const n = { accepted: 0, edited: 0, dropped: 0 };
  const review = async (extra: string, rowsShown: PlanRow[] | null): Promise<string> => {
    const overlay = deps.overlay ? await deps.overlay().catch(() => null) : null;
    const text = rowsShown ? `${extra}\n${planText({ ...plan, rows: rowsShown })}` : `${planText(plan)}${extra ? `\n${extra}` : ''}`;
    const content: ContentBlock[] = [{ type: 'text', text: `${text}\nCall review_build_plan with your decisions (rows you leave out are built as planned).` }, { type: 'text', text: 'Image 1: the PHOTO' }, { type: 'image', dataUrl: deps.photoUrl }, ...(overlay ? [{ type: 'text' as const, text: 'Image 2: the photo annotated with the measured objects (ids p1, p2, ...)' }, { type: 'image' as const, dataUrl: overlay }] : [])];
    calls++;
    const res = await deps.complete({ role: 'critic', system: BUILD_PLAN_SYSTEM, messages: [{ role: 'user', content }], tools: [BUILD_PLAN_TOOL], maxTokens: 8000, temperature: 0, seed: BUILD_PLAN_SEED });
    const call = res.content.find((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use' && b.name === BUILD_PLAN_TOOL_NAME);
    const parsed = call ? parseDecisions(call.input) : null;
    if (!parsed) return 'The assistant gave no usable decisions: the plan stands as made from the measurements.';
    const got = applyDecisions({ ...plan, rows: rowsShown ?? plan.rows }, parsed.decisions);
    for (const d of parsed.decisions) {
      const row = plan.rows.find((r) => r.n === d.n);
      if (!row) continue;
      if (row.decision === 'accept') n.accepted++;
      else if (row.decision === 'edit') n.edited++;
      else if (row.decision === 'drop') n.dropped++;
    }
    return `${got.done.length} decisions${got.ignored.length > 0 ? `; ignored: ${got.ignored.slice(0, 4).join(' | ')}` : ''}`;
  };
  aborted();
  let reviewLine = '';
  try { reviewLine = await review('', null); } catch (e) { if (deps.signal?.aborted) throw e; reviewLine = `The plan review failed (${String(e instanceof Error ? e.message : e).slice(0, 120)}): the plan stands as measured.`; }
  yield { type: 'photo', phase: 'building', text: `Build plan reviewed: ${reviewLine}; ${n.dropped} rows dropped with reasons, ${n.edited} edited, ${n.accepted} accepted.` };
  // Moves of built pieces that are off the measurement (accepted by default).
  const moves = plan.rows.filter((r) => r.action === 'adjust' && r.entity && r.at);
  if (moves.length > 0) {
    const out = await deps.tool('edit_items', { edits: moves.map((r) => ({ op: 'move', ref: r.entity, at: r.at })), message: 'Move pieces to where the photo measures them' });
    for (const ev of out.events) yield ev;
  }
  // The batch.
  let placed = 0;
  let refused = 0;
  const run = async function* (batch: Array<{ row: PlanRow; item: Record<string, unknown> }>): AsyncGenerator<AgentEvent> {
    for (let at = 0; at < batch.length; at += MAX_PER_BATCH) {
      aborted();
      const part = batch.slice(at, at + MAX_PER_BATCH);
      const out = await deps.tool('place_items', { items: part.map((p) => p.item), message: `Build ${part.length} objects from the measurements` });
      for (const ev of out.events) yield ev;
      const bad = refusalsOf(out.content);
      const world = deps.world();
      part.forEach((p, i) => {
        const why = bad.get(i + 1);
        const ids = why ? [] : entitiesOfHandle(world, p.row.handle);
        if (why || ids.length === 0) { p.row.refused = why ?? (out.isError ? out.content.slice(0, 300) : 'not placed'); p.row.built = []; refused++; }
        else { p.row.refused = ''; p.row.built = ids; deps.link(p.row.itemId, ids); placed++; linked++; }
      });
    }
  };
  yield* run(placeItemsOf(plan));
  // Refused rows go back to the model once, with the reasons (space refusals give numbers and a widen call).
  const bounced = plan.rows.filter((r) => r.action === 'place' && r.refused && r.kind !== 'window' && r.kind !== 'door');
  if (bounced.length > 0 && placed + refused > 0) {
    yield { type: 'photo', phase: 'building', text: `${bounced.length} of the planned pieces were refused by the placement checks; the assistant settles them once. ${bounced.slice(0, 3).map((r) => `${r.label}: ${r.refused.slice(0, 200)}`).join(' | ')}` };
    try {
      const shown = bounced.map((r) => ({ ...r, notes: [...r.notes, `REFUSED: ${r.refused}`] }));
      const before = bounced.map((r) => r.refused);
      void before;
      const shownPlan = { ...plan, rows: shown };
      const overlay = null as string | null;
      void overlay;
      calls++;
      const content: ContentBlock[] = [{ type: 'text', text: `These rows were refused by the room checks (read the numbers: a smaller size, another wall or spot, or drop it with a reason):\n${planText(shownPlan)}\nCall review_build_plan with edits or drops for them; a row you leave alone is not built.` }, { type: 'text', text: 'Image 1: the PHOTO' }, { type: 'image', dataUrl: deps.photoUrl }];
      const res = await deps.complete({ role: 'critic', system: BUILD_PLAN_SYSTEM, messages: [{ role: 'user', content }], tools: [BUILD_PLAN_TOOL], maxTokens: 6000, temperature: 0, seed: BUILD_PLAN_SEED + 1 });
      const call = res.content.find((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use' && b.name === BUILD_PLAN_TOOL_NAME);
      const parsed = call ? parseDecisions(call.input) : null;
      if (parsed) {
        const got = applyDecisions(plan, parsed.decisions.filter((d) => bounced.some((r) => r.n === d.n)));
        for (const r of bounced) if (r.decision === 'drop') { r.refused = ''; }
        const again = bounced.filter((r) => r.action === 'place' && r.decision === 'edit');
        for (const r of again) r.refused = '';
        if (again.length > 0) {
          const before2 = refused;
          refused -= again.length;
          yield* run(placeItemsOf({ ...plan, rows: again }));
          void before2;
        }
        yield { type: 'photo', phase: 'building', text: `Refused pieces settled: ${got.done.length} decisions.` };
      }
    } catch (e) {
      if (deps.signal?.aborted) throw e;
    }
  }
  for (const r of plan.rows) if (r.action === 'drop' && !r.entity) deps.rejected?.(r.itemId, r.reason || 'not built');
  const dropped = plan.rows.filter((r) => r.action === 'drop').length;
  const stillRefused = plan.rows.filter((r) => r.action === 'place' && r.refused).length;
  const why = plan.rows.filter((r) => r.refused).slice(0, 4).map((r) => `${r.label} [${r.perceivedId}]: ${r.refused.slice(0, 160)}`).join(' | ');
  const text = `First build from the measurements${why ? ` (refused: ${why})` : ''}: ${placed} pieces placed in one batch, ${plan.rows.filter((r) => r.action === 'keep' || r.action === 'adjust').length} already built and linked, ${stillRefused} refused after the second look, ${dropped} not built (${plan.rows.filter((r) => r.action === 'drop').slice(0, 6).map((r) => `${r.label}: ${r.reason}`.slice(0, 70)).join('; ')}). ${linked} of ${plan.rows.length} perceived objects have a linked piece.`;
  yield { type: 'photo', phase: 'building', text };
  return { plan, placed, refused: stillRefused, dropped, linked, calls, decisions: n, text };
}
