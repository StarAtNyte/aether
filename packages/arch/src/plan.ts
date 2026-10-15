/**
 * BuildingPlan — the declarative, LLM-friendly description of a building
 * that the compiler turns into World IR entities (walls with mitred joins,
 * floors, ceilings, doors, windows, stairs, roof, furniture, lights).
 *
 * Plan coordinates are metres in the building's frame: x to the east, z to
 * the SOUTH (three.js convention: north is −Z). Room outlines are wall
 * CENTRELINES; adjacent rooms share edges. Every list is bounded.
 */
import { z } from 'zod';
import { Color, MaterialSpec } from '@aether/core';
import { PlanPoint, PlanPolygon } from './params';
import { DesignRecord } from './design-record';

/** Room types (drive furniture layouts, floor finishes, lighting and windows). */
export const RoomType = z.enum([
  'living', 'kitchen', 'dining', 'bedroom', 'bathroom', 'office', 'hall', 'entry', 'cafe', 'meeting', 'open-office',
  'lobby', 'storage', 'laundry', 'terrace', 'garage', 'studio', 'kids',
]);
export type RoomType = z.infer<typeof RoomType>;

/** Interior styles (palettes and furniture choices). */
export const ArchStyle = z.enum(['modern', 'scandinavian', 'industrial', 'japandi', 'classic']);
export type ArchStyle = z.infer<typeof ArchStyle>;

/** Compass sides (north = −Z). */
export const Compass = z.enum(['north', 'south', 'east', 'west']);
export type Compass = z.infer<typeof Compass>;

const Slug = z.string().regex(/^[a-z][a-z0-9-]{0,23}$/, 'room / building ids are short lowercase slugs (≤ 24 chars)');
/** Room reference: a room id, or "outside". */
const RoomRef = z.union([Slug, z.literal('outside')]);

/** A piece placed explicitly in a room (kept across re-layouts). */
export const PlanItem = z.object({
  kind: z.string().min(1).max(40),
  /** Generator params (validated by the furniture catalogue). */
  params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).default({}),
  /** Position in level plan coordinates; omit to let the layout choose. */
  at: PlanPoint.optional(),
  /** Yaw in degrees (0: front faces +Z / south). */
  yaw: z.number().min(-360).max(360).optional(),
  /** Place against this wall of the room (layout chooses the spot). */
  against: Compass.optional(),
});
export type PlanItem = z.infer<typeof PlanItem>;

/** A room (or outdoor terrace) on a level. */
export const PlanRoom = z
  .object({
    id: Slug,
    name: z.string().max(60).optional(),
    type: RoomType.default('living'),
    /** Axis-aligned rectangle `[x0, z0, x1, z1]` (alternative to `polygon`). */
    rect: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
    polygon: PlanPolygon.optional(),
    /** Floor finish (default from room type and style). */
    floor: MaterialSpec.optional(),
    /** Interior wall paint colour (default from style). */
    wallColor: Color.optional(),
    /** Additive: paint colour of single walls, by the compass side each faces from inside (overrides `wallColor`). */
    wallColors: z.partialRecord(Compass, Color).optional(),
    /** Auto-furnish (layouts per room type). */
    furnish: z.boolean().default(true),
    /** Explicit pieces (in addition to, or instead of with `furnish: false`, the layout). */
    items: z.array(PlanItem).max(60).default([]),
    /** Furniture kinds the layout must leave out ("tv", "rug" …). */
    omit: z.array(z.string().max(40)).max(20).default([]),
  })
  .refine((r) => r.rect !== undefined || r.polygon !== undefined, { message: 'a room needs `rect` [x0,z0,x1,z1] or `polygon`' });
export type PlanRoom = z.infer<typeof PlanRoom>;

/** A door, sliding door or open passage between two rooms (or a room and outside). */
export const PlanDoor = z.object({
  between: z.tuple([RoomRef, RoomRef]),
  /** Position along the shared wall span (0–1). */
  at: z.number().min(0).max(1).default(0.5),
  width: z.number().min(0.6).max(4).default(0.9),
  height: z.number().min(1.8).max(4).default(2.1),
  kind: z.enum(['swing', 'sliding', 'opening']).default('swing'),
  style: z.enum(['panel', 'flush', 'glass', 'slab']).optional(),
  /** For doors to "outside": which wall of the room (default: the longest exterior wall). */
  side: Compass.optional(),
  /** The main entrance (player starts in front of it; at most one). */
  main: z.boolean().default(false),
  /**
   * Exact centre in metres along the wall of the first room (or of the inner room for a door to
   * "outside"), from the left end seen from inside the room. Overrides `at`.
   */
  along: z.number().min(0).max(200).optional(),
});
export type PlanDoor = z.infer<typeof PlanDoor>;

/** Windows on one exterior wall of a room. */
export const PlanWindow = z.object({
  room: Slug,
  side: Compass,
  count: z.number().int().min(1).max(8).default(1),
  width: z.number().min(0.4).max(8).default(1.2),
  height: z.number().min(0.4).max(4).default(1.4),
  sill: z.number().min(0).max(2.5).default(0.9),
  style: z.enum(['casement', 'fixed', 'sliding', 'grid', 'picture']).optional(),
  /**
   * Exact centres in metres along the exterior wall of `side`, from the left end seen from inside
   * the room (one window per centre). Overrides the even spread of `count`.
   */
  centres: z.array(z.number().min(0).max(200)).max(8).optional(),
});
export type PlanWindow = z.infer<typeof PlanWindow>;

/** A stair from this level to the next one up. */
export const PlanStair = z.object({
  /** Plan position of the first riser (bottom of the stair). */
  at: PlanPoint,
  /** Direction of travel of the first flight. */
  heading: Compass.default('north'),
  shape: z.enum(['straight', 'l', 'u']).default('straight'),
  width: z.number().min(0.7).max(2.5).default(1),
  turn: z.enum(['left', 'right']).default('left'),
});
export type PlanStair = z.infer<typeof PlanStair>;

/** A railing (balcony edge, gallery) on a level. */
export const PlanRailing = z.object({
  points: z.array(PlanPoint).min(2).max(32),
  style: z.enum(['glass', 'bars', 'cable', 'solid']).default('glass'),
});

/** One storey. */
export const PlanLevel = z.object({
  name: z.string().max(60).optional(),
  /** Floor-to-floor height (ceilings sit 0.22 m lower). */
  height: z.number().min(2.4).max(8).default(3),
  rooms: z.array(PlanRoom).min(1).max(40),
  doors: z.array(PlanDoor).max(80).default([]),
  windows: z.array(PlanWindow).max(80).default([]),
  /** Add windows to exterior walls of habitable rooms automatically (in addition to `windows`). */
  autoWindows: z.boolean().default(true),
  stairs: z.array(PlanStair).max(4).default([]),
  railings: z.array(PlanRailing).max(16).default([]),
});
export type PlanLevel = z.infer<typeof PlanLevel>;

/** Roof over the top level. */
export const PlanRoof = z.object({
  shape: z.enum(['flat', 'gable', 'hip', 'shed']).default('flat'),
  pitch: z.number().min(5).max(60).default(30),
  overhang: z.number().min(0).max(1.5).default(0.4),
  finish: MaterialSpec.optional(),
});

/** Outdoor site works: a raised terrace and an optional pool in it. */
export const PlanSite = z.object({
  /** Terrace outline in plan coordinates (around or beside the building). */
  terrace: PlanPolygon.optional(),
  terraceFinish: MaterialSpec.default({ finish: 'stone', color: '#d9d2c4' }),
  /** Pool centre, size (x by z). Must lie on the terrace. */
  pool: z.object({ at: PlanPoint, width: z.number().min(2).max(30).default(8), length: z.number().min(2).max(30).default(4) }).optional(),
  /** Low hedges / planters along the terrace edge. */
  planting: z.boolean().default(true),
});

/** A whole building. */
export const BuildingPlan = z.object({
  id: Slug.default('house'),
  name: z.string().max(80).default('House'),
  style: ArchStyle.default('modern'),
  /** Position of the plan origin in the world (x, z) and its rotation (degrees). */
  origin: PlanPoint.default([0, 0]),
  rotation: z.number().min(-360).max(360).default(0),
  /** Ground floor height above the ground (plinth). */
  plinth: z.number().min(0.05).max(1.5).default(0.15),
  exteriorWall: z.object({ thickness: z.number().min(0.12).max(0.6).default(0.28), finish: MaterialSpec.default({ finish: 'plaster', color: '#ece9e3' }) }).default({ thickness: 0.28, finish: { finish: 'plaster', color: '#ece9e3' } }),
  interiorWall: z.object({ thickness: z.number().min(0.06).max(0.3).default(0.12) }).default({ thickness: 0.12 }),
  levels: z.array(PlanLevel).min(1).max(6),
  roof: PlanRoof.default({ shape: 'flat', pitch: 30, overhang: 0.4 }),
  site: PlanSite.optional(),
  /** What the designer intended (see `design-record.ts`); kept with the plan, never compiled. */
  design: DesignRecord.optional(),
});
export type BuildingPlan = z.infer<typeof BuildingPlan>;
export type BuildingPlanInput = z.input<typeof BuildingPlan>;

/** Upper bound of entities one building may compile into (the world limit is 5000). */
export const MAX_BUILDING_ENTITIES = 1800;
