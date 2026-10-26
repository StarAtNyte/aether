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
import { PlanPoint, PlanPolygon, WallDado } from './params';
import { DesignRecord } from './design-record';
import { CeilingDetail, Cornice, DoorStyle, Muntins, Niche, PictureRail, Skirting, WindowStyle } from './shell';

/** Room types (drive furniture layouts, floor finishes, lighting and windows). */
export const RoomType = z.enum([
  'living', 'kitchen', 'dining', 'bedroom', 'bathroom', 'office', 'hall', 'entry', 'cafe', 'meeting', 'open-office',
  'lobby', 'storage', 'laundry', 'terrace', 'garage', 'studio', 'kids',
]);
export type RoomType = z.infer<typeof RoomType>;

/** Interior styles (palettes and furniture choices). */
export const ArchStyle = z.enum(['modern', 'scandinavian', 'industrial', 'japandi', 'classic', 'mediterranean']);
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
    /** Additive: a vaulted (gable) ceiling over a rectangular room: the ridge rises `rise` m above the eaves (the level must be that much taller), optional exposed trusses. */
    vault: z.object({ rise: z.number().min(0.2).max(4), ridge: z.enum(['x', 'z']).default('z'), trusses: z.number().int().min(0).max(14).default(0), beam: Color.default('#f4f2ee') }).optional(),
    /**
     * Finish of every interior wall face of the room (paint, wallpaper, panelling, brick, tiles…).
     * Overrides the type default; `wallColor` still tints it when it has no colour of its own.
     */
    finish: MaterialSpec.optional(),
    /**
     * Per-wall finishes keyed by the compass side the wall is on seen from inside the room
     * ("the back wall" = the one opposite the entrance): an accent wall or one wallpapered wall.
     */
    walls: z.partialRecord(Compass, MaterialSpec).optional(),
    /** Lower covering of every wall face of the room (wainscot / dado with a chair rail). */
    dado: WallDado.optional(),
    /**
     * Additive room-shell vocabulary (see `shell.ts`, `query_scene {q:"vocabulary"}`): the ceiling style (coved, barrel, coffered,
     * beamed, tray; `vault` above is the gable form), crown moulding, picture rail, skirting profile, per-wall dados or
     * panelling (override `dado` on that wall) and wall niches. Rectangular rooms only; every field is optional.
     */
    ceiling: CeilingDetail.optional(),
    cornice: Cornice.optional(),
    /** false: no recessed downlights (a room rebuilt from a photograph only has the ones the photo shows). Default: a grid in habitable rooms. */
    downlights: z.boolean().optional(),
    pictureRail: PictureRail.optional(),
    skirting: Skirting.optional(),
    dados: z.partialRecord(Compass, WallDado).optional(),
    niches: z.array(Niche).max(8).optional(),
    /** Auto-furnish (layouts per room type). */
    furnish: z.boolean().default(true),
    /**
     * Dress the room after its pieces: rug, the missing armchair or bedside table, lamps, plants, curtains and styling
     * where the measured layout has room (default: the same as `furnish`).
     */
    dress: z.boolean().optional(),
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
  style: DoorStyle.optional(),
  /** Additive: leaf colour (`#rrggbb`); default from the interior style. */
  color: Color.optional(),
  /** For doors to "outside": which wall of the room (default: the longest exterior wall). */
  side: Compass.optional(),
  /** The main entrance (player starts in front of it; at most one). */
  main: z.boolean().default(false),
  /**
   * Exact centre in metres along the wall of the first room (or of the inner room for a door to
   * "outside"), from the left end seen from inside the room. Overrides `at`.
   */
  along: z.number().min(0).max(200).optional(),
  /** Swing doors only: a dynamic leaf on a revolute hinge joint with limits, driven by a motor (overrides `physicalDoors`). */
  physical: z.boolean().optional(),
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
  style: WindowStyle.optional(),
  /** Additive: glazing bars per sash or light (see `shell.ts`). */
  muntins: Muntins.optional(),
  /** Additive: frame and sash colour (`#rrggbb`); default from the interior style. */
  frame: Color.optional(),
  /** Additive: interior architrave and apron round the opening. */
  casing: z.boolean().optional(),
  /** Additive: bay windows: projection outside the wall and the angle of the side lights. */
  bay: z.object({ depth: z.number().min(0.15).max(1.5).default(0.5), angle: z.number().min(20).max(70).default(35) }).optional(),
  /** Colour of the daylight that glows through the glass (an emissive pane outside it); omitted: the scene outside shows. */
  daylight: Color.optional(),
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
  /**
   * A garden on the plot round the building: a paved approach from the front door, hedges along the back and the sides,
   * planted beds along the front, trees in the corners (see `site.ts`).
   */
  garden: z.boolean().default(false),
  /** The land round the plot: `estate` = rolling terrain with the plot level, groves, meadow and wildflowers; `none` = the world's own ground. */
  surroundings: z.enum(['none', 'estate']).default('none'),
});

/**
 * The front of the building: an entrance with a door surround and a canopy on columns, a sign with emissive lettering, a cornice at
 * the roofline, a paved forecourt with lamp posts, planters and benches, and the light over the door (see `facade.ts`). Every part is
 * on once a facade is given; switch off what does not suit. Without a facade the building keeps the plain style articulation.
 */
export const PlanFacade = z.object({
  /** Lettering of the sign (the name of the place); none = no sign. */
  sign: z.string().trim().min(1).max(24).optional(),
  signColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#ffe0a0'),
  signPanel: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#1b1d21'),
  canopy: z.boolean().default(true),
  doorSurround: z.boolean().default(true),
  cornice: z.boolean().default(true),
  forecourt: z.boolean().default(true),
  lamps: z.boolean().default(true),
  planters: z.boolean().default(true),
  bench: z.boolean().default(true),
  /** Real lights over the door, on the sign and on the lamp posts. */
  light: z.boolean().default(true),
  /** Window surrounds on the outdoor face (default: from the style). */
  surround: z.enum(['box', 'board', 'stone', 'none']).optional(),
});
export type PlanFacade = z.infer<typeof PlanFacade>;

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
  /** Swing doors are physical: dynamic leaves on hinge joints (stops, no clipping through the player). */
  physicalDoors: z.boolean().default(true),
  site: PlanSite.optional(),
  /** The front: entrance, canopy, sign, cornice, forecourt, lamps, planters (see {@link PlanFacade}). */
  facade: PlanFacade.optional(),
  /**
   * People living in or visiting the building (0 to 8): idle-animated characters standing where people do (near the
   * sofa, at the counter), clear of doorways and walkways. Compiled with the building; omit for an empty house.
   */
  residents: z.number().int().min(0).max(8).optional(),
  /** Where a walkthrough starts (plan frame: x, z in metres, and the yaw in degrees, 0 faces -Z); default: inside the main entrance. */
  spawn: z.object({ at: PlanPoint, yaw: z.number().min(-360).max(360).default(0) }).optional(),
  /** What the designer intended (see `design-record.ts`); kept with the plan, never compiled. */
  design: DesignRecord.optional(),
});
export type BuildingPlan = z.infer<typeof BuildingPlan>;
export type BuildingPlanInput = z.input<typeof BuildingPlan>;

/** Upper bound of entities one building may compile into (the world limit is 5000). */
export const MAX_BUILDING_ENTITIES = 1800;
