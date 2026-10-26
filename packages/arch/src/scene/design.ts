/**
 * The design plan the AI writes BEFORE anything is placed: programme,
 * footprint and proportions, circulation, every opening with its wall,
 * offset and size, and the list of furniture with intended relations.
 *
 * `validateDesign` measures it (rooms overlap? does the window fit its wall?
 * does every door lead somewhere? is every room reachable?) and refuses
 * nonsense with numbers; `designToBuildingPlan` turns an acceptable plan into
 * the shell (walls, floors, ceilings, doors, windows, stairs, roof) with NO
 * furniture, so the AI places each piece through the placement tools.
 * `checkConformance` later compares the finished room with what was planned.
 */
import { z } from 'zod';
import { MaterialSpec, Color, type EntityId } from '@aether/core';
import { ArchStyle, Compass, PlanDoor, PlanFacade, PlanRoof, PlanSite, PlanStair, RoomType, type BuildingPlanInput } from '../plan';
import { PlanPoint, PlanPolygon, WallDado } from '../params';
import { CeilingDetail, Cornice, DOOR_STYLES, Muntins, Niche, PictureRail, Skirting, WINDOW_STYLES } from '../shell';
import { DesignItem, DesignRecord, DesignProgramme, DesignCirculation } from '../design-record';
import { area, isSimplePolygon, positive, type P2 } from '../math2';
import { roomPolygon, roomEdges, sharedSpans, exteriorSpans } from '../rooms';
import { overlapArea } from '../rooms';
import { partInfo, partKinds } from './parts';
import { itemEntityId } from './edit';
import { findOpening, findRoom, isLookupError } from './facts';
import { cmr, polygonGap } from './geom';
import type { Scene, SceneItem, SceneOpening, SceneRoom, SceneWall } from './types';
import type { Finding } from './checks';
import { parsePlan } from '../compile';
import { checkStair, fitStair, levelDoors, stairJson } from '../stair-fit';

const Slug = z.string().regex(/^[a-z][a-z0-9-]{0,23}$/, 'ids are short lowercase slugs (letters, digits, dashes; at most 24 characters)');
const RoomRef = z.union([Slug, z.literal('outside')]);

/** A room of the design. */
export const DesignRoom = z
  .object({
    id: Slug,
    type: RoomType,
    name: z.string().max(60).optional(),
    /** Axis-aligned rectangle [x0, z0, x1, z1] (x east, z south) or a polygon of wall centrelines. */
    rect: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
    polygon: PlanPolygon.optional(),
    floor: MaterialSpec.optional(),
    wallColor: Color.optional(),
    /** Paint colour of single walls by the compass side each faces from inside (overrides `wallColor`). */
    wallColors: z.partialRecord(Compass, Color).optional(),
    /** Additive: a vaulted (gable) ceiling over a rectangular room: the ridge rises `rise` m above the eaves (the level must be that much taller), optional exposed trusses. */
    vault: z.object({ rise: z.number().min(0.2).max(4), ridge: z.enum(['x', 'z']).default('z'), trusses: z.number().int().min(0).max(14).default(0), beam: Color.default('#f4f2ee') }).optional(),
    /** Wall covering of the whole room (wallpaper, panelling, brick, tiles…), per-wall accents by compass side from inside, and a wainscot. */
    finish: MaterialSpec.optional(),
    walls: z.partialRecord(Compass, MaterialSpec).optional(),
    dado: WallDado.optional(),
    /** Additive room-shell vocabulary (see `query_scene {q:"vocabulary"}`): ceiling style, crown moulding, picture rail, skirting, per-wall dados and niches. */
    ceiling: CeilingDetail.optional(),
    cornice: Cornice.optional(),
    downlights: z.boolean().optional(),
    pictureRail: PictureRail.optional(),
    skirting: Skirting.optional(),
    dados: z.partialRecord(Compass, WallDado).optional(),
    niches: z.array(Niche).max(8).optional(),
  })
  .refine((r) => r.rect !== undefined || r.polygon !== undefined, { message: 'a room needs rect [x0,z0,x1,z1] or polygon' });

/** An opening: a door, sliding door, open passage or window on one wall of a room. */
export const DesignOpening = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,35}$/).optional(),
  kind: z.enum(['door', 'sliding', 'opening', 'window']),
  room: Slug,
  /** The wall of `room`, named by the compass side it faces from inside. */
  wall: Compass,
  /** Centre of the opening, metres from the LEFT end of that wall as seen from inside the room. */
  along: z.number().min(0).max(200),
  width: z.number().min(0.4).max(8),
  height: z.number().min(0.4).max(4).optional(),
  sill: z.number().min(0).max(2.5).optional(),
  /** Doors: the room beyond, or "outside". */
  to: RoomRef.optional(),
  /** The main entrance (one). */
  main: z.boolean().optional(),
  style: z.string().max(20).optional(),
  /** Windows: colour of the daylight glowing through the glass (#rrggbb). */
  daylight: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  /** Additive: glazing bars, frame / leaf colour, interior casing and bay projection (windows); `color` is the leaf colour of a door. */
  muntins: Muntins.optional(),
  frame: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  casing: z.boolean().optional(),
  bay: z.object({ depth: z.number().min(0.15).max(1.5).default(0.5), angle: z.number().min(20).max(70).default(35) }).optional(),
});
export type DesignOpening = z.infer<typeof DesignOpening>;

/**
 * A stair from this storey to the next: exact (`at` = first riser, `heading` = direction of travel) or just the
 * room it should go in (`{"room":"hall"}`), and the building tools fit one there (against a wall, clear of the
 * doorways, arriving on open floor upstairs).
 */
export const DesignStair = z.object({
  at: PlanStair.shape.at.optional(),
  heading: Compass.optional(),
  shape: z.enum(['straight', 'l', 'u']).optional(),
  width: z.number().min(0.7).max(2.5).optional(),
  turn: z.enum(['left', 'right']).optional(),
  room: Slug.optional(),
});
export type DesignStair = z.infer<typeof DesignStair>;

/** One storey of the design. */
export const DesignLevel = z.object({
  name: z.string().max(60).optional(),
  height: z.number().min(2.4).max(8).optional(),
  rooms: z.array(DesignRoom).min(1).max(40),
  openings: z.array(DesignOpening).max(120).default([]),
  stairs: z.array(DesignStair).max(4).default([]),
});

/** The whole design plan. */
export const DesignPlan = z.object({
  id: Slug.default('house'),
  name: z.string().max(80).default('House'),
  style: ArchStyle.default('modern'),
  /** One or two sentences: what this is and the feel of it. */
  brief: z.string().max(500).default(''),
  programme: z.array(DesignProgramme).max(40).default([]),
  circulation: DesignCirculation.optional(),
  levels: z.array(DesignLevel).min(1).max(6),
  /** Every piece of furniture, decor and lighting with the relations it should end up in. */
  furniture: z.array(DesignItem).max(160).default([]),
  roof: PlanRoof.optional(),
  site: PlanSite.optional(),
  /** The outer walls: a light brick, plaster or cladding, never near-black (the default is the style's own). */
  exteriorWall: z.object({ finish: MaterialSpec.optional(), thickness: z.number().min(0.12).max(0.6).optional() }).optional(),
  /**
   * The front of the building (entrance with door surround and canopy, sign with the name, cornice, forecourt, lamps, planters, bench,
   * door light). On by default for a building made from a design; give `{sign: "<name>"}` to light the name, switch parts off, or `false`
   * for a bare front.
   */
  facade: z.union([PlanFacade, z.literal(false)]).optional(),
  origin: PlanPoint.optional(),
  rotation: z.number().min(-360).max(360).optional(),
});
export type DesignPlan = z.infer<typeof DesignPlan>;

/** Result of {@link validateDesign}. */
export interface DesignValidation {
  /** Problems that must be fixed (nothing was built). */
  errors: string[];
  /** Advice that does not block the build. */
  warnings: string[];
}

interface RoomGeom {
  id: string;
  type: string;
  level: number;
  poly: P2[];
  edges: ReturnType<typeof roomEdges>;
}

const MIN_SIDE: Partial<Record<string, number>> = { bedroom: 2.4, kids: 2.2, bathroom: 1.4, kitchen: 1.8, living: 2.8, dining: 2.2, office: 1.8, hall: 0.9, entry: 0.9 };

/** Measure a design plan against the physical rules. */
export function validateDesign(plan: DesignPlan): DesignValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const geoms: RoomGeom[] = [];
  plan.levels.forEach((lvl, li) => {
    const seen = new Set<string>();
    for (const r of lvl.rooms) {
      if (seen.has(r.id)) errors.push(`level ${li}: two rooms are called "${r.id}"; give every room its own id`);
      seen.add(r.id);
      const poly = positive(roomPolygon(r));
      if (!isSimplePolygon(poly) || area(poly) < 1) {
        errors.push(`room ${r.id}: the outline is degenerate or self-crossing (area ${cmr(area(poly)).toFixed(2)} m²); use rect [x0,z0,x1,z1] with x1 > x0 and z1 > z0`);
        continue;
      }
      const xs = poly.map((p) => p[0]);
      const zs = poly.map((p) => p[1]);
      const w = Math.max(...xs) - Math.min(...xs);
      const d = Math.max(...zs) - Math.min(...zs);
      const side = MIN_SIDE[r.type];
      if (side !== undefined && Math.min(w, d) < side - 1e-6) warnings.push(`room ${r.id} (${r.type}) is only ${cmr(Math.min(w, d)).toFixed(2)} m on its short side; a ${r.type} usually wants at least ${side} m`);
      geoms.push({ id: r.id, type: r.type, level: li, poly, edges: roomEdges(poly) });
    }
    for (let i = 0; i < geoms.length; i++) {
      for (let j = i + 1; j < geoms.length; j++) {
        const a = geoms[i] as RoomGeom;
        const b = geoms[j] as RoomGeom;
        if (a.level !== li || b.level !== li) continue;
        const o = overlapArea(a.poly, b.poly);
        if (o > 0.06) errors.push(`rooms ${a.id} and ${b.id} overlap by ${cmr(o).toFixed(2)} m²; rooms must share edges, not area (room rects are wall centrelines and neighbours share edges exactly)`);
      }
    }
  });
  const byId = (level: number, id: string): RoomGeom | undefined => geoms.find((g) => g.level === level && g.id === id);
  const claims: Array<{ level: number; room: string; wall: string; t0: number; t1: number; label: string; roomB?: string }> = [];
  const doorsGraph = new Map<string, Set<string>>();
  let outside = 0;
  let mains = 0;
  plan.levels.forEach((lvl, li) => {
    const ceiling = (lvl.height ?? 3) - 0.22;
    lvl.openings.forEach((o, oi) => {
      const label = `${o.kind}${o.id ? ` "${o.id}"` : ` #${oi}`} of ${o.room} (${o.wall} wall at ${o.along} m)`;
      const room = byId(li, o.room);
      if (!room) {
        errors.push(`${label}: room "${o.room}" does not exist on level ${li}${lvl.rooms.some((r) => r.id === o.room) ? ' (its outline was rejected above)' : ''}`);
        return;
      }
      const edges = room.edges.filter((e) => e.side === o.wall);
      if (edges.length === 0) {
        errors.push(`${label}: ${o.room} has no ${o.wall} wall (its walls face ${[...new Set(room.edges.map((e) => e.side))].join(', ')})`);
        return;
      }
      const half = o.width / 2;
      if (o.kind === 'window') {
        if (o.to !== undefined) warnings.push(`${label}: windows do not take "to"`);
        const others = geoms.filter((g) => g.level === li && g.id !== room.id).map((g) => g.poly);
        const spans = exteriorSpans(room.poly, others, o.wall);
        const span = spans.find((s) => o.along - half >= s.t0 + 0.12 && o.along + half <= s.t1 - 0.12);
        if (!span) {
          const inAny = spans.find((s) => o.along >= s.t0 && o.along <= s.t1);
          errors.push(
            inAny
              ? `${label}: ${cmr(o.width).toFixed(2)} m wide does not fit the exterior stretch ${cmr(inAny.t0).toFixed(2)}..${cmr(inAny.t1).toFixed(2)} m of that wall (keep 0.12 m clear of the ends): centre it between ${cmr(inAny.t0 + 0.12 + half).toFixed(2)} and ${cmr(inAny.t1 - 0.12 - half).toFixed(2)} m, or make it narrower`
              : spans.length === 0
                ? `${label}: the ${o.wall} wall of ${o.room} is not an exterior wall (it is shared with another room); windows go in exterior walls`
                : `${label}: ${o.along} m is not on an exterior stretch of the ${o.wall} wall; exterior stretches are ${spans.map((s) => `${cmr(s.t0).toFixed(2)}..${cmr(s.t1).toFixed(2)} m`).join(', ')}`,
          );
          return;
        }
        const sill = o.sill ?? 0.9;
        const height = o.height ?? 1.3;
        if (sill + height > ceiling - 0.1) errors.push(`${label}: sill ${sill} + height ${height} reaches ${cmr(sill + height).toFixed(2)} m but the ceiling is at ${cmr(ceiling).toFixed(2)} m; lower it or make it shorter`);
        claims.push({ level: li, room: room.id, wall: o.wall, t0: o.along - half, t1: o.along + half, label });
        return;
      }
      const to = o.to;
      if (to === undefined) {
        errors.push(`${label}: say where it leads with "to" (a room id or "outside")`);
        return;
      }
      if ((o.height ?? 2.1) > ceiling - 0.05) errors.push(`${label}: ${o.height} m tall does not fit under the ceiling (${cmr(ceiling).toFixed(2)} m)`);
      let ok = false;
      if (to === 'outside') {
        const others = geoms.filter((g) => g.level === li && g.id !== room.id).map((g) => g.poly);
        const spans = exteriorSpans(room.poly, others, o.wall);
        const span = spans.find((s) => o.along - half >= s.t0 + 0.12 && o.along + half <= s.t1 - 0.12);
        if (!span) {
          errors.push(
            spans.length === 0
              ? `${label}: the ${o.wall} wall of ${o.room} is not exterior, so it cannot lead outside`
              : `${label}: ${o.along} m (± ${cmr(half).toFixed(2)}) is not inside an exterior stretch of the ${o.wall} wall; exterior stretches are ${spans.map((s) => `${cmr(s.t0).toFixed(2)}..${cmr(s.t1).toFixed(2)} m`).join(', ')}`,
          );
          return;
        }
        ok = true;
        outside++;
        if (o.main) mains++;
      } else {
        const other = byId(li, to);
        if (!other) {
          errors.push(`${label}: leads to "${to}", which is not a room on level ${li}`);
          return;
        }
        const spans = sharedSpans(room.poly, other.poly).filter((s) => s.edge.side === o.wall);
        const span = spans.find((s) => o.along - half >= s.t0 + 0.12 && o.along + half <= s.t1 - 0.12);
        if (!span) {
          errors.push(
            spans.length === 0
              ? `${label}: ${o.room} and ${to} do not share their ${o.wall} wall${sharedSpans(room.poly, other.poly).length > 0 ? ` (they share ${[...new Set(sharedSpans(room.poly, other.poly).map((s) => s.edge.side))].join(', ')})` : ' at all; rooms must touch along an edge'}`
              : `${label}: ${o.along} m (± ${cmr(half).toFixed(2)}) is not inside the wall stretch the two rooms share (${spans.map((s) => `${cmr(s.t0).toFixed(2)}..${cmr(s.t1).toFixed(2)} m`).join(', ')})`,
          );
          return;
        }
        ok = true;
        const a = doorsGraph.get(`${li}:${room.id}`) ?? new Set<string>();
        a.add(`${li}:${to}`);
        doorsGraph.set(`${li}:${room.id}`, a);
        const b = doorsGraph.get(`${li}:${to}`) ?? new Set<string>();
        b.add(`${li}:${room.id}`);
        doorsGraph.set(`${li}:${to}`, b);
        claims.push({ level: li, room: to, wall: '*', t0: 0, t1: 0, label: `${label} (other side)`, roomB: room.id });
      }
      if (ok) claims.push({ level: li, room: room.id, wall: o.wall, t0: o.along - half, t1: o.along + half, label });
    });
  });
  // Openings on the same wall must not overlap (0.1 m of wall between them).
  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      const a = claims[i] as (typeof claims)[number];
      const b = claims[j] as (typeof claims)[number];
      if (a.level !== b.level || a.room !== b.room || a.wall !== b.wall || a.wall === '*') continue;
      const gap = Math.max(a.t0 - b.t1, b.t0 - a.t1);
      if (gap < 0.1 - 1e-6) errors.push(`${a.label} and ${b.label} overlap or leave less than 0.1 m of wall between them (gap ${cmr(gap).toFixed(2)} m)`);
    }
  }
  if (outside === 0 && plan.levels[0]?.rooms.length) errors.push('no door leads outside: add a door with to: "outside" (main: true) on an exterior wall');
  if (outside > 0 && mains === 0) warnings.push('no door is marked main: the first outside door becomes the entrance');
  if (mains > 1) warnings.push('several doors are marked main: only the first is the entrance');
  // Every room reachable from the entrance through doors and openings (per level; upper levels need stairs).
  plan.levels.forEach((lvl, li) => {
    const ids = lvl.rooms.map((r) => r.id).filter((id) => geoms.some((g) => g.level === li && g.id === id));
    if (ids.length < 2) return;
    const start = li === 0 ? lvl.openings.find((o) => o.to === 'outside')?.room ?? ids[0] : ids[0];
    const seen = new Set<string>();
    const queue = [`${li}:${start}`];
    while (queue.length > 0) {
      const c = queue.pop() as string;
      if (seen.has(c)) continue;
      seen.add(c);
      for (const n of doorsGraph.get(c) ?? []) queue.push(n);
    }
    const lost = ids.filter((id) => !seen.has(`${li}:${id}`));
    const upper = li > 0 && lvl.stairs.length === 0 && plan.levels[li - 1]?.stairs.length === 0;
    if (lost.length > 0 && !(li > 0 && lost.length === ids.length)) errors.push(`level ${li}: ${lost.join(', ')} ${lost.length === 1 ? 'has' : 'have'} no door or opening connecting ${lost.length === 1 ? 'it' : 'them'} to ${start}; every room must be reachable on foot (add an opening between neighbours that share a wall)`);
    if (li > 0 && upper) warnings.push(`level ${li} has no stairs from the level below`);
  });
  const known = new Set(partKinds());
  const handles = new Set<string>();
  for (const f of plan.furniture) {
    if (handles.has(f.id)) errors.push(`furniture id "${f.id}" is used twice`);
    handles.add(f.id);
    if (!known.has(f.kind)) errors.push(`furniture "${f.id}": unknown kind "${f.kind}"; the parts are ${[...known].join(', ')}`);
    if (!plan.levels.some((l) => l.rooms.some((r) => r.id === f.room))) errors.push(`furniture "${f.id}": room "${f.room}" is not in the plan`);
  }
  for (const p of plan.programme) if (!plan.levels.some((l) => l.rooms.some((r) => r.id === p.room))) warnings.push(`programme names room "${p.room}" which is not in the plan`);
  return { errors, warnings };
}

/**
 * The shell as a building plan: rooms with no furniture, openings at their exact positions, no automatic
 * windows. The design record travels with it.
 */
export function designToBuildingPlan(plan: DesignPlan, aliases: Readonly<Record<string, string>> = {}): BuildingPlanInput {
  const record: DesignRecord = DesignRecord.parse({ brief: plan.brief, programme: plan.programme, ...(plan.circulation ? { circulation: plan.circulation } : {}), furniture: plan.furniture, openingAliases: aliases });
  let mainDone = false;
  const levels = plan.levels.map((lvl) => {
    const doors: Array<z.input<typeof PlanDoor>> = [];
    const windows: NonNullable<BuildingPlanInput['levels'][number]['windows']> = [];
    for (const o of lvl.openings) {
      if (o.kind === 'window') {
        windows.push({ room: o.room, side: o.wall, count: 1, width: o.width, ...(o.height !== undefined ? { height: o.height } : {}), ...(o.sill !== undefined ? { sill: o.sill } : {}), centres: [o.along], ...(o.daylight ? { daylight: o.daylight } : {}), ...(o.style && (WINDOW_STYLES as readonly string[]).includes(o.style) ? { style: o.style as 'casement' } : {}), ...(o.muntins ? { muntins: o.muntins } : {}), ...(o.frame ? { frame: o.frame } : {}), ...(o.casing !== undefined ? { casing: o.casing } : {}), ...(o.bay ? { bay: o.bay } : {}) });
        continue;
      }
      const to = o.to ?? 'outside';
      const main = o.main === true && to === 'outside' && !mainDone;
      if (main) mainDone = true;
      doors.push({
        between: [o.room, to],
        kind: o.kind === 'sliding' ? 'sliding' : o.kind === 'opening' ? 'opening' : 'swing',
        width: o.width,
        ...(o.height !== undefined ? { height: o.height } : {}),
        ...(to === 'outside' ? { side: o.wall } : {}),
        along: o.along,
        ...(main ? { main: true } : {}),
        ...(o.style && (DOOR_STYLES as readonly string[]).includes(o.style) ? { style: o.style as 'panel' } : {}),
        ...(o.color ? { color: o.color } : {}),
      });
    }
    return {
      ...(lvl.name ? { name: lvl.name } : {}),
      ...(lvl.height !== undefined ? { height: lvl.height } : {}),
      autoWindows: false,
      rooms: lvl.rooms.map((r) => ({ id: r.id, type: r.type, ...(r.name ? { name: r.name } : {}), ...(r.rect ? { rect: r.rect } : {}), ...(r.polygon ? { polygon: r.polygon } : {}), ...(r.floor ? { floor: r.floor } : {}), ...(r.wallColor ? { wallColor: r.wallColor } : {}), ...(r.wallColors ? { wallColors: r.wallColors } : {}), ...(r.vault ? { vault: r.vault } : {}), ...(r.finish ? { finish: r.finish } : {}), ...(r.walls ? { walls: r.walls } : {}), ...(r.dado ? { dado: r.dado } : {}), ...(r.ceiling ? { ceiling: r.ceiling } : {}), ...(r.cornice ? { cornice: r.cornice } : {}), ...(r.downlights !== undefined ? { downlights: r.downlights } : {}), ...(r.pictureRail ? { pictureRail: r.pictureRail } : {}), ...(r.skirting ? { skirting: r.skirting } : {}), ...(r.dados ? { dados: r.dados } : {}), ...(r.niches ? { niches: r.niches } : {}), furnish: false, items: [] })),
      doors,
      windows,
      stairs: lvl.stairs.flatMap((st) => (st.at ? [{ at: st.at, heading: st.heading ?? 'north', shape: st.shape ?? 'straight', width: st.width ?? 1, turn: st.turn ?? 'left' }] : [])),
    };
  });
  // The first outside door is the entrance when none is marked.
  if (!mainDone) {
    for (const l of levels) {
      const d = l.doors.find((x) => x.between[1] === 'outside');
      if (d) {
        d.main = true;
        break;
      }
    }
  }
  return { id: plan.id, name: plan.name, style: plan.style, levels, ...(plan.roof ? { roof: plan.roof } : {}), ...(plan.site ? { site: plan.site } : {}), ...(plan.exteriorWall ? { exteriorWall: { ...(plan.exteriorWall.finish ? { finish: plan.exteriorWall.finish } : {}), ...(plan.exteriorWall.thickness !== undefined ? { thickness: plan.exteriorWall.thickness } : {}) } as never } : {}), ...(plan.facade === false ? {} : { facade: PlanFacade.parse(plan.facade ?? {}) }), ...(plan.origin ? { origin: plan.origin } : {}), ...(plan.rotation !== undefined ? { rotation: plan.rotation } : {}), design: record };
}

/** Result of {@link resolveDesignStairs}. */
export interface StairResolution {
  /** The plan with every stair exact (fitted ones filled in). */
  plan: DesignPlan;
  /** Stairs that do not work, measured (the plan is refused). */
  errors: string[];
  /** What was fitted. */
  lines: string[];
}

/**
 * Make every stair of a design exact and check it: a stair given only by room is fitted there, an exact one is
 * measured (footprint inside a room clear of the walls, floor in front of it, clear of doorways, the stairwell
 * and the top step on open floor upstairs). Problems come back with numbers and a stair that does fit.
 */
export function resolveDesignStairs(plan: DesignPlan): StairResolution {
  if (!plan.levels.some((l) => l.stairs.length > 0)) return { plan, errors: [], lines: [] };
  const errors: string[] = [];
  const lines: string[] = [];
  const shell = parsePlan(designToBuildingPlan({ ...plan, levels: plan.levels.map((l) => ({ ...l, stairs: [] })) }));
  const doors = levelDoors(shell);
  const levels = plan.levels.map((lvl, li) => {
    const done: PlanStair[] = [];
    const stairs: DesignStair[] = [];
    lvl.stairs.forEach((st, si) => {
      const label = `level ${li} stair ${si + 1}`;
      if (!st.at) {
        const fit = fitStair(shell, li, { room: st.room, shape: st.shape, heading: st.heading, width: st.width, others: done });
        if (!fit.ok) {
          errors.push(`${label}: no stair fits${st.room ? ` in ${st.room}` : ''}: ${fit.reasons.join('; ')}`);
          return;
        }
        done.push(fit.stair);
        stairs.push({ ...fit.stair });
        lines.push(`${label}: fitted ${fit.line}`);
        return;
      }
      const exact: PlanStair = { at: st.at, heading: st.heading ?? 'north', shape: st.shape ?? 'straight', width: st.width ?? 1, turn: st.turn ?? 'left' };
      const check = checkStair(shell, li, exact, doors, done);
      if (check.problems.length > 0) {
        let fit = fitStair(shell, li, { room: st.room ?? check.room, near: exact, others: done });
        if (!fit.ok && st.room === undefined && check.room !== undefined) fit = fitStair(shell, li, { near: exact, others: done });
        const better = fit.ok ? ` A stair that fits: ${stairJson(fit.stair)} (${fit.line}), or give just {"room":"${fit.room}"} to have it fitted.` : ` Nothing fits there: ${fit.reasons.join('; ')}.`;
        errors.push(`${label} at (${exact.at.join(', ')}) heading ${exact.heading}: ${check.problems.join('; ')}.${better}`);
        return;
      }
      done.push(exact);
      stairs.push({ ...exact });
    });
    return { ...lvl, stairs };
  });
  return { plan: { ...plan, levels }, errors, lines };
}

/** Text of what a built shell offers: rooms with dimensions, walls with openings, entrance. */
export function describeShell(scene: Scene): string {
  const lines: string[] = [];
  for (const r of scene.rooms) {
    const w = r.bbox[2] - r.bbox[0];
    const d = r.bbox[3] - r.bbox[1];
    lines.push(`room ${r.key} (${r.type}, level ${r.level}): bbox x ${cmr(r.bbox[0])}..${cmr(r.bbox[2])}, z ${cmr(r.bbox[1])}..${cmr(r.bbox[3])} (${cmr(w).toFixed(2)} × ${cmr(d).toFixed(2)} m), ${cmr(r.area).toFixed(1)} m², ceiling ${cmr(r.ceiling).toFixed(2)} m (storey height ${cmr(scene.levels.find((l) => l.id === r.levelId)?.height ?? r.ceiling).toFixed(2)} m, floor to floor)`);
    for (const wl of r.walls) {
      const ops = wl.openings.map((o) => `${o.kind} ${o.id} t ${o.t0}..${o.t1}${o.kind === 'window' ? ` sill ${o.sill}` : ''}${o.leadsTo ? ` -> ${o.leadsTo === 'outside' ? 'outside' : o.leadsTo.replace(`${r.levelId}-`, '')}` : ''}`);
      lines.push(`  ${wl.compass} wall: ${cmr(wl.length)} m (${wl.exterior ? 'exterior' : 'interior'})${ops.length > 0 ? `; ${ops.join('; ')}` : '; no openings'}`);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Conformance
// ---------------------------------------------------------------------------

function itemsOfHandle(scene: Scene, building: EntityId, handle: string): SceneItem[] {
  const id = itemEntityId(building, handle);
  const exact = scene.items.filter((i) => i.id === id);
  if (exact.length > 0) return exact;
  return scene.items.filter((i) => i.id === `${id}-l` || i.id === `${id}-r`);
}

/** Compare the finished building with the design record: every planned piece exists and keeps its relations. */
export function checkConformance(scene: Scene, design: DesignRecord | undefined): Finding[] {
  if (!design) return [];
  const out: Finding[] = [];
  for (const item of design.furniture) {
    const mine = itemsOfHandle(scene, scene.building, item.id);
    const roomKey = item.room;
    if (mine.length === 0) {
      out.push({ code: 'plan_missing', severity: 'warning', message: `planned ${item.kind} "${item.id}" (${item.intent || 'no note'}) was never placed in ${roomKey}`, entities: [], room: roomKey, fix: `Place it with place_items (id "${item.id}"), or resend design_plan without it if the design changed.` });
      continue;
    }
    for (const rel of item.relations) {
      const problem = checkRelation(scene, scene.building, item, mine, rel);
      if (problem) out.push({ code: 'plan_mismatch', severity: 'warning', message: `${item.kind} "${item.id}" was planned to ${describeRelation(rel)}, but ${problem}`, entities: mine.map((m) => m.id), room: roomKey, fix: `Use edit_items (move, snap_to_wall, center_over or anchor_to_opening) to restore: ${item.intent || describeRelation(rel)}.` });
    }
  }
  return out;
}

function describeRelation(r: DesignRecord['furniture'][number]['relations'][number]): string {
  switch (r.type) {
    case 'against_wall':
      return `stand against the ${r.wall ?? 'a'} wall`;
    case 'centred_on_wall':
      return `be centred on the ${r.wall ?? 'a'} wall`;
    case 'in_corner':
      return 'sit in a corner';
    case 'flanks':
      return `flank ${r.target ?? 'its target'} on the ${r.side ?? 'a'} side`;
    case 'beside':
      return `stand beside ${r.target ?? 'its target'}`;
    case 'above_centred':
      return `hang centred above ${r.target ?? 'its target'}`;
    case 'centred_on_opening':
      return `be centred on ${r.target ?? 'its opening'}`;
    case 'on_top':
      return `stand on ${r.target ?? 'its target'}`;
    case 'faces':
      return `face ${r.target ?? 'its target'}`;
  }
}

function span(it: SceneItem, edge: number): { t0: number; t1: number } | null {
  if (it.wall && it.wall.edge === edge) return { t0: it.wall.t - it.wall.width / 2, t1: it.wall.t + it.wall.width / 2 };
  const ag = it.against?.find((a) => a.edge === edge);
  return ag ? { t0: ag.t0, t1: ag.t1 } : null;
}

function wallOfItem(it: SceneItem): { edge: number; compass: string } | null {
  if (it.wall) return { edge: it.wall.edge, compass: it.wall.compass };
  const ag = it.against?.slice().sort((a, b) => a.gap - b.gap)[0];
  return ag ? { edge: ag.edge, compass: ag.compass } : null;
}

/**
 * An opening by id, or by a loose description ("bedroom-north-window", "the window"): when the id is unknown,
 * the opening of the piece's room that the words point at (window / door, compass side), if exactly one does.
 */
type OpeningHit = { opening: SceneOpening; wall: SceneWall; room: SceneRoom };

function looseOpening(scene: Scene, ref: string, roomId: EntityId | null): OpeningHit | null {
  const exact = findOpening(scene, ref);
  if (!isLookupError(exact)) return exact;
  const room = scene.rooms.find((r) => r.id === roomId);
  if (!room) return null;
  const words = ref.toLowerCase();
  const wantKind = /window/.test(words) ? 'window' : /door|entry|entrance/.test(words) ? 'door' : null;
  const side = (['north', 'south', 'east', 'west'] as const).find((c) => words.includes(c));
  const found: OpeningHit[] = [];
  for (const w of room.walls) for (const o of w.openings) if ((!wantKind || o.kind === wantKind) && (!side || w.compass === side)) found.push({ opening: o, wall: w, room });
  return found.length === 1 ? (found[0] as OpeningHit) : null;
}

function checkRelation(scene: Scene, building: EntityId, item: DesignRecord['furniture'][number], mine: SceneItem[], rel: DesignRecord['furniture'][number]['relations'][number]): string | null {
  const it = mine[0] as SceneItem;
  const room = scene.rooms.find((r) => r.id === it.room);
  const target = rel.target ? itemsOfHandle(scene, building, rel.target)[0] : undefined;
  switch (rel.type) {
    case 'against_wall': {
      const wanted = rel.wall;
      const hit = mine.every((m) => (m.wall ? (wanted ? m.wall.compass === wanted : true) : m.against?.some((a) => (wanted ? a.compass === wanted : true) && a.gap <= 0.06)));
      return hit ? null : `it ${it.wall || (it.against && it.against.length > 0) ? `is on the ${wallOfItem(it)?.compass ?? '?'} wall` : 'does not touch any wall'}${wanted ? `, not the ${wanted} wall` : ''}`;
    }
    case 'centred_on_wall': {
      if (!room) return 'it is in no room';
      const w = rel.wall ? room.walls.filter((x) => x.compass === rel.wall).sort((a, b) => b.length - a.length)[0] : room.walls[wallOfItem(it)?.edge ?? 0];
      if (!w) return `the room has no ${rel.wall ?? ''} wall`;
      const all = mine.map((m) => span(m, w.edge)).filter((s): s is { t0: number; t1: number } => s !== null);
      if (all.length === 0) return `it is not on the ${w.compass} wall`;
      const c = (Math.min(...all.map((s) => s.t0)) + Math.max(...all.map((s) => s.t1))) / 2;
      const off = c - w.length / 2;
      return Math.abs(off) <= 0.12 ? null : `its centre is ${cmr(Math.abs(off)).toFixed(2)} m ${off > 0 ? 'right' : 'left'} of the wall centre (t ${cmr(c)} vs ${cmr(w.length / 2)})`;
    }
    case 'in_corner': {
      const near = (it.against ?? []).filter((a) => a.gap <= 0.1);
      return near.length >= 2 ? null : `it touches ${near.length} wall${near.length === 1 ? '' : 's'}, not two`;
    }
    case 'flanks': {
      if (!target) return `its target "${rel.target ?? ''}" is not placed`;
      const w = wallOfItem(target);
      const a = w ? span(it, w.edge) : null;
      const b = w ? span(target, w.edge) : null;
      if (!w || !a || !b) return `it is not on the same wall as ${target.id}`;
      const side = rel.side ?? (a.t1 <= b.t0 + 0.05 ? 'left' : 'right');
      const gap = side === 'left' ? b.t0 - a.t1 : a.t0 - b.t1;
      const want = rel.gap ?? 0.1;
      if (gap < -0.05) return `it overlaps ${target.id} along the wall`;
      return gap <= want + 0.25 && (side === 'left' ? a.t1 <= b.t0 + 0.05 : a.t0 >= b.t1 - 0.05) ? null : `it is ${cmr(Math.max(0, gap)).toFixed(2)} m from ${target.id} on the ${side} (wanted about ${cmr(want).toFixed(2)} m)`;
    }
    case 'beside': {
      if (!target) return `its target "${rel.target ?? ''}" is not placed`;
      const gap = polygonGap(it.footprint, target.footprint);
      const want = rel.gap ?? 0.2;
      return gap <= want + 0.3 ? null : `it is ${cmr(gap).toFixed(2)} m from ${target.id}`;
    }
    case 'above_centred': {
      if (!target) return `its target "${rel.target ?? ''}" is not placed`;
      const tw = wallOfItem(target);
      if (!tw || !it.wall || it.wall.edge !== tw.edge) return `it is not on the same wall as ${target.id}`;
      const ts = span(target, tw.edge);
      if (!ts) return `${target.id} is not on that wall`;
      const off = it.wall.t - (ts.t0 + ts.t1) / 2;
      if (Math.abs(off) > 0.08) return `it is ${cmr(Math.abs(off)).toFixed(2)} m ${off > 0 ? 'right' : 'left'} of the centre of ${target.id}`;
      const gap = it.y0 - target.y1;
      const want = rel.gap ?? 0.3;
      return gap >= -0.02 && gap <= want + 0.5 ? null : `its bottom is ${cmr(gap).toFixed(2)} m above ${target.id} (wanted about ${cmr(want).toFixed(2)} m)`;
    }
    case 'centred_on_opening': {
      const o = rel.target ? looseOpening(scene, rel.target, it.room) : null;
      if (!o) return `the opening "${rel.target ?? ''}" does not exist (use an opening id from the shell description)`;
      if (o.room.id !== it.room) return `it is not in the room of ${o.opening.id}`;
      if (it.kind === 'curtain') {
        // Curtains flank their window: every panel on its wall, within reach of the frame.
        const bad = mine.find((m) => {
          const s = span(m, o.wall.edge);
          return !s || s.t1 < o.opening.t0 - 0.6 || s.t0 > o.opening.t1 + 0.6;
        });
        return bad ? `${bad.id} is not beside ${o.opening.id} on its wall` : null;
      }
      const w = wallOfItem(it);
      if (!w || w.edge !== o.wall.edge) return `it is not on the wall of ${o.opening.id}`;
      const s = span(it, w.edge);
      if (!s) return `it is not on that wall`;
      const off = (s.t0 + s.t1) / 2 - o.opening.centre;
      return Math.abs(off) <= 0.1 ? null : `its centre is ${cmr(Math.abs(off)).toFixed(2)} m from the centre of ${o.opening.id}`;
    }
    case 'on_top': {
      if (!target) return `its target "${rel.target ?? ''}" is not placed`;
      return Math.abs(it.y0 - target.y1) <= 0.05 && Math.hypot(it.pos[0] - target.pos[0], it.pos[2] - target.pos[2]) <= Math.max(target.size[0], target.size[2]) / 2 + 0.05 ? null : `it is not standing on top of ${target.id} (bottom ${cmr(it.y0)} vs top ${cmr(target.y1)})`;
    }
    case 'faces': {
      const to: [number, number] | null = target ? [target.pos[0], target.pos[2]] : rel.wall && room ? (() => {
        const w = room.walls.filter((x) => x.compass === rel.wall).sort((a, b) => b.length - a.length)[0];
        return w ? [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2] : null;
      })() : null;
      if (!to) return `there is nothing to face (${rel.target ?? rel.wall ?? 'no target'})`;
      const dx = to[0] - it.pos[0];
      const dz = to[1] - it.pos[2];
      const want = (Math.atan2(dx, dz) * 180) / Math.PI;
      let diff = Math.abs(((it.yaw - want) % 360 + 540) % 360 - 180);
      diff = Math.min(diff, 360 - diff);
      return diff <= 30 ? null : `it faces ${cmr(diff)}° away from it`;
    }
  }
}

/** The info a model needs about a kind when it writes the plan. */
export function kindHint(kind: string): string {
  const p = partInfo(kind);
  return p ? `${p.kind}: ${p.mount}, ${p.size.map(cmr).join('×')} m` : kind;
}

void findRoom;
