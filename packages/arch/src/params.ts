/**
 * Parameters of the structural `arch-*` generators, as zod schemas. They are
 * the parametric architecture model stored in the World IR (inside each
 * entity's `shape.params`): every value is bounded so a hostile or confused
 * document cannot request unbounded geometry.
 *
 * Local frames (metres, Y up, entity origin):
 * - wall: runs along +X from x = 0 to `length`, centred on z = 0 (side A is
 *   −Z, side B is +Z), base at y = 0.
 * - slab / ceiling / basin / railing: plan coordinates `[x, z]` in the
 *   entity frame; slab top and ceiling surface at y = 0.
 * - door / window: centred on x = 0 and z = 0 (the wall centreline), base at
 *   y = 0 (doors) or the sill (windows sit at their `y` position).
 * - stair: first riser at x = 0, ascends along +X, centred on z = 0.
 * - roof: centred footprint, x = width, z = depth, eaves at y = 0.
 */
import { z } from 'zod';
import { Color, MaterialSpec } from '@aether/core';
import { CeilingStyle, Cornice, DoorStyle, Muntins, PanelStyle, SkirtingProfile, WindowStyle } from './shell';

/** Hard caps of the parametric model. */
export const ARCH_LIMITS = Object.freeze({
  MAX_COORD: 500,
  MAX_WALL_LENGTH: 80,
  MAX_HEIGHT: 30,
  MAX_OPENINGS: 24,
  MAX_POLYGON_POINTS: 128,
  MAX_HOLES: 16,
  MAX_RAILING_POINTS: 64,
  MAX_STEPS: 64,
});

const coord = z.number().finite().min(-ARCH_LIMITS.MAX_COORD).max(ARCH_LIMITS.MAX_COORD);
/** A plan point `[x, z]`. */
export const PlanPoint = z.tuple([coord, coord]);
/** A simple plan polygon (3–128 points, no closing duplicate). */
export const PlanPolygon = z.array(PlanPoint).min(3).max(ARCH_LIMITS.MAX_POLYGON_POINTS);

/** An opening cut through a wall (doorway, window hole, pass-through). */
export const WallOpening = z.object({
  kind: z.enum(['door', 'window', 'opening']).default('door'),
  /** Centre along the wall (metres from the start). */
  offset: z.number().min(0).max(ARCH_LIMITS.MAX_WALL_LENGTH),
  width: z.number().min(0.2).max(12),
  height: z.number().min(0.2).max(ARCH_LIMITS.MAX_HEIGHT),
  /** Bottom of the opening above the wall base (0 for doors). */
  sill: z.number().min(0).max(ARCH_LIMITS.MAX_HEIGHT).default(0),
});
export type WallOpening = z.infer<typeof WallOpening>;

/** A recess in one face of a wall (see `shell.ts` `Niche`): centre along the wall, size, sill, depth, shelves. */
export const WallNiche = z.object({
  offset: z.number().min(0).max(ARCH_LIMITS.MAX_WALL_LENGTH),
  width: z.number().min(0.2).max(4),
  height: z.number().min(0.2).max(3.2),
  sill: z.number().min(0).max(2.5).default(0.6),
  depth: z.number().min(0.04).max(0.6).default(0.15),
  shelves: z.number().int().min(0).max(6).default(0),
  color: Color.optional(),
  arched: z.boolean().default(false),
});
export type WallNiche = z.infer<typeof WallNiche>;

const ext = z.number().min(-3).max(3).default(0);

/** Lower wall covering (dado / wainscot) with an optional chair rail at its top edge. */
export const WallDado = z.object({
  /** Height of the covering above the floor (metres). */
  height: z.number().min(0.2).max(4).default(1.0),
  material: MaterialSpec.default({ finish: 'panelling', color: '#e4e0d8' }),
  /** Moulded rail along the top edge. */
  rail: z.boolean().default(true),
  /** Additive: how the covering is dressed (real moulded frames, battens or grooves on top of the finish). Default: flat. */
  style: PanelStyle.default('flat'),
  /** Additive: panel bays across 3 m of wall (shaker, raised, batten, beadboard). */
  panels: z.number().min(1).max(8).default(3),
});
export type WallDado = z.infer<typeof WallDado>;

/** `arch-wall` params. */
export const WallParams = z.object({
  length: z.number().min(0.05).max(ARCH_LIMITS.MAX_WALL_LENGTH),
  height: z.number().min(0.1).max(ARCH_LIMITS.MAX_HEIGHT).default(2.8),
  thickness: z.number().min(0.02).max(1.5).default(0.15),
  /**
   * Edge extensions (metres) of side A / B at the start / end, past the
   * wall's end points along its axis: positive extends, negative trims.
   * Computed by the wall-join solver so corners mitre and T-junctions butt.
   */
  startA: ext,
  startB: ext,
  endA: ext,
  endB: ext,
  openings: z.array(WallOpening).max(ARCH_LIMITS.MAX_OPENINGS).default([]),
  /** Side A (−Z) and side B (+Z) finishes; the top and ends use side A's. */
  finishA: MaterialSpec.default({ finish: 'plaster' }),
  finishB: MaterialSpec.default({ finish: 'plaster' }),
  /** Optional lower covering (wainscot) of side A / B; the face above keeps `finishA` / `finishB`. */
  dadoA: WallDado.optional(),
  dadoB: WallDado.optional(),
  /**
   * Plinth / base course on one face (an exterior wall's outside): a band `depth` proud of the face from `drop` below the
   * wall base up to `height`, interrupted at openings that reach into it. Omit for none.
   */
  base: z.object({
    side: z.enum(['a', 'b']),
    height: z.number().min(0.05).max(3).default(0.45),
    depth: z.number().min(0.005).max(0.2).default(0.03),
    drop: z.number().min(0).max(1.5).default(0.15),
    material: MaterialSpec.default({ finish: 'stone', color: '#9a958c' }),
  }).optional(),
  /** Skirting boards on interior faces. */
  skirting: z.enum(['none', 'a', 'b', 'both']).default('both'),
  skirtingMaterial: MaterialSpec.default({ finish: 'paint', color: '#f1eee8' }),
  /** Additive: height, projection and profile of the skirting (default: the plain 8 cm board). */
  skirtingStyle: z.object({ height: z.number().min(0.03).max(0.5).default(0.08), depth: z.number().min(0.012).max(0.06).default(0.016), profile: SkirtingProfile.default('square') }).optional(),
  /** Additive: a picture rail on side A / B: centre height above the base and its material. */
  railA: z.object({ y: z.number().min(0.5).max(ARCH_LIMITS.MAX_HEIGHT), material: MaterialSpec.default({ finish: 'paint', color: '#f1eee8' }) }).optional(),
  railB: z.object({ y: z.number().min(0.5).max(ARCH_LIMITS.MAX_HEIGHT), material: MaterialSpec.default({ finish: 'paint', color: '#f1eee8' }) }).optional(),
  /** Additive: recesses in the face of side A / B (they do not cut through; depth is clamped to leave 4 cm of wall). */
  nichesA: z.array(WallNiche).max(8).optional(),
  nichesB: z.array(WallNiche).max(8).optional(),
  /**
   * View-only section cut (metres above the base): the wall is drawn only up
   * to this height with a dark cap on the cut face, like a plan section.
   * Window holes below the cut are filled; doorways stay open. Used by the
   * cutaway / walls-down views as a render override, never stored by the
   * building compiler. Omit (or ≥ height) for the full wall.
   */
  cut: z.number().min(0.05).max(ARCH_LIMITS.MAX_HEIGHT).optional(),
});
export type WallParams = z.infer<typeof WallParams>;

/** `arch-slab` params: a floor plate whose top surface is at y = 0. */
export const SlabParams = z.object({
  polygon: PlanPolygon,
  holes: z.array(PlanPolygon).max(ARCH_LIMITS.MAX_HOLES).default([]),
  thickness: z.number().min(0.01).max(5).default(0.2),
  finish: MaterialSpec.default({ finish: 'oak' }),
  /** Edge band (visible slab edge on facades / exploded views). */
  edge: MaterialSpec.default({ finish: 'concrete' }),
  /** Draw the underside (off for floors above ceilings, which have their own surface). */
  bottom: z.boolean().default(false),
});
export type SlabParams = z.infer<typeof SlabParams>;

/** `arch-ceiling` params: a downward-facing surface at y = 0. */
export const CeilingParams = z.object({
  polygon: PlanPolygon,
  holes: z.array(PlanPolygon).max(ARCH_LIMITS.MAX_HOLES).default([]),
  finish: MaterialSpec.default({ finish: 'paint', color: '#f4f2ee' }),
  /** Recessed cove depth around the edge (0 = flat). */
  cove: z.number().min(0).max(0.4).default(0),
  /** Recessed downlights (plan points): a trim ring and a glowing lens each; no light source of their own. */
  downlights: z.array(PlanPoint).max(24).default([]),
  /** Downlights glow (the walkthrough switches this with the room's lights). */
  lit: z.boolean().default(true),
  /**
   * A vaulted (gable) ceiling over an axis-aligned rectangle: two sloping planes meeting at a ridge `rise` metres above the
   * eaves (the plate's local y = 0 is the ridge; the eaves are at y = -rise). `ridge` is the direction the ridge runs;
   * `trusses` exposed timber trusses (rafters and tie beams) are spaced along it. Other polygons stay flat.
   */
  vault: z
    .object({
      rise: z.number().min(0.2).max(4),
      ridge: z.enum(['x', 'z']).default('z'),
      trusses: z.number().int().min(0).max(14).default(0),
      beam: Color.default('#f4f2ee'),
    })
    .optional(),
  /**
   * Additive: the ceiling style of the room (see `shell.ts`). Without it the ceiling is flat (or vaulted when `vault` is given).
   * `faces` is the rectangle `[x0, z0, x1, z1]` of the INSIDE faces of the walls (the polygon runs to the wall centrelines):
   * the cornice, coves, coffers and beams are laid out inside it. Only axis-aligned rectangles take a style.
   */
  style: CeilingStyle.optional(),
  faces: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  /** Additive: ridge height of a vaulted / barrel ceiling, or radius of a coved one. */
  rise: z.number().min(0.1).max(4).optional(),
  ridge: z.enum(['x', 'z']).optional(),
  trusses: z.number().int().min(0).max(14).optional(),
  /** Additive: colour of beams, coffer ribs and trusses. */
  beamColor: Color.optional(),
  cornice: Cornice.optional(),
  coffers: z.object({ nx: z.number().int().min(1).max(10).default(3), nz: z.number().int().min(1).max(10).default(3), rib: z.number().min(0.03).max(0.5).default(0.12), depth: z.number().min(0.03).max(0.5).default(0.12) }).optional(),
  beams: z.object({ count: z.number().int().min(1).max(16).default(4), dir: z.enum(['x', 'z']).optional(), width: z.number().min(0.04).max(0.6).default(0.15), depth: z.number().min(0.04).max(0.6).default(0.2) }).optional(),
  tray: z.object({ inset: z.number().min(0.15).max(2).default(0.5), drop: z.number().min(0.04).max(0.5).default(0.12) }).optional(),
});
export type CeilingParams = z.infer<typeof CeilingParams>;

/** `arch-roof` params. */
export const RoofParams = z.object({
  shape: z.enum(['flat', 'gable', 'hip', 'shed']).default('gable'),
  /** Footprint along X / Z (the walls' outer extent). */
  width: z.number().min(0.5).max(200),
  depth: z.number().min(0.5).max(200),
  pitch: z.number().min(3).max(65).default(32),
  overhang: z.number().min(0).max(2).default(0.45),
  thickness: z.number().min(0.05).max(1).default(0.22),
  /** Gable / shed: ridge (or slope) along X (true) or Z (false). */
  ridgeAlongX: z.boolean().default(true),
  /** Flat roofs: parapet height (0 = none). */
  parapet: z.number().min(0).max(2).default(0.45),
  finish: MaterialSpec.default({ finish: 'roof-tile' }),
  /** Fascia, soffit and gable end-walls. */
  trim: MaterialSpec.default({ finish: 'paint', color: '#ece9e3' }),
  gableWall: MaterialSpec.default({ finish: 'plaster', color: '#ece8e1' }),
  /** Pitched roofs: gutters along the eaves (with downpipes when `downpipe` > 0). */
  gutters: z.boolean().default(false),
  /** Downpipe length from the eave line down to the ground (metres; 0 = none). */
  downpipe: z.number().min(0).max(60).default(0),
  /** Gutters and downpipes. */
  rainwater: MaterialSpec.default({ finish: 'brushed-metal', color: '#5d6166' }),
});
export type RoofParams = z.infer<typeof RoofParams>;

/** `arch-stair` params. */
export const StairParams = z.object({
  shape: z.enum(['straight', 'l', 'u']).default('straight'),
  width: z.number().min(0.6).max(4).default(1),
  /** Total rise (floor to floor). */
  rise: z.number().min(0.2).max(ARCH_LIMITS.MAX_HEIGHT).default(3),
  /** Tread depth (going). */
  going: z.number().min(0.2).max(0.45).default(0.27),
  /** Riser count (0 = automatic, ~17.5 cm per riser). */
  steps: z.number().int().min(0).max(ARCH_LIMITS.MAX_STEPS).default(0),
  /** L / U stairs: which way the stair turns at the landing. */
  turn: z.enum(['left', 'right']).default('left'),
  /** U stairs: gap between the two flights. */
  gap: z.number().min(0).max(2).default(0.1),
  finish: MaterialSpec.default({ finish: 'oak' }),
  structure: MaterialSpec.default({ finish: 'paint', color: '#efede8' }),
  rail: z.enum(['none', 'left', 'right', 'both']).default('right'),
  railMaterial: MaterialSpec.default({ finish: 'black-metal' }),
  /**
   * A balustrade (guard with a collider) on each open side of the flights and landings, one flag per piece of
   * `stairGuardPieces` in its order; sides against a wall get a wall handrail instead. Omitted: no balustrades, the
   * handrail follows `rail`.
   */
  guards: z.array(z.boolean()).max(12).optional(),
  /** Look of the balustrades. */
  balustrade: z.enum(['glass', 'steel', 'timber']).default('steel'),
  /** Height of the underside of the floor above over the stair's foot (m); balustrades beside the stairwell stay below it. Default: rise − 0.22. */
  soffit: z.number().min(0).max(ARCH_LIMITS.MAX_HEIGHT).optional(),
});
export type StairParams = z.infer<typeof StairParams>;

/** `arch-door` (moving leaf) params. */
export const DoorParams = z.object({
  width: z.number().min(0.4).max(4).default(0.9),
  height: z.number().min(1.5).max(4).default(2.1),
  thickness: z.number().min(0.02).max(0.12).default(0.045),
  style: DoorStyle.default('panel'),
  finish: MaterialSpec.default({ finish: 'paint', color: '#f2f0eb' }),
  hardware: MaterialSpec.default({ finish: 'brushed-metal' }),
  /** Handle side relative to the leaf (opposite the hinge). */
  handle: z.enum(['left', 'right']).default('right'),
});
export type DoorParams = z.infer<typeof DoorParams>;

/** `arch-frame` (door casing / jamb lining) params. */
export const FrameParams = z.object({
  width: z.number().min(0.4).max(12),
  height: z.number().min(0.4).max(ARCH_LIMITS.MAX_HEIGHT),
  wallThickness: z.number().min(0.02).max(1.5).default(0.15),
  casing: z.number().min(0).max(0.2).default(0.07),
  finish: MaterialSpec.default({ finish: 'paint', color: '#f2f0eb' }),
  /** Additive: `arched` fills the head above `springing` with a rounded fanlight opening (the wall hole stays rectangular). */
  head: z.enum(['flat', 'arched']).default('flat'),
  /** Additive: height of the leaf's top edge for an arched head (the fanlight fills the rest); default: 0.78 of the height. */
  springing: z.number().min(0.5).max(ARCH_LIMITS.MAX_HEIGHT).optional(),
});
export type FrameParams = z.infer<typeof FrameParams>;

/** `arch-window` params (the window sits at its sill height; local y = 0 is the sill). */
export const WindowParams = z.object({
  width: z.number().min(0.3).max(12).default(1.2),
  height: z.number().min(0.3).max(10).default(1.4),
  wallThickness: z.number().min(0.02).max(1.5).default(0.25),
  style: WindowStyle.default('casement'),
  /** Additive: glazing bars (`cols` x `rows` panes per sash or light); omitted: the style's own default. */
  muntins: Muntins.optional(),
  /** Additive: interior architrave and apron round the opening (default: on for sash, arched and bay windows). */
  casing: z.boolean().optional(),
  /** Additive: bay windows: how far the bay projects outside the wall and the angle of its side lights (degrees). */
  bay: z.object({ depth: z.number().min(0.15).max(1.5).default(0.5), angle: z.number().min(20).max(70).default(35) }).optional(),
  /** Vertical mullions (0 = automatic from the width). */
  mullions: z.number().int().min(0).max(12).default(0),
  frame: MaterialSpec.default({ finish: 'black-metal' }),
  glass: MaterialSpec.default({ finish: 'glass' }),
  /** Interior sill board. */
  sill: z.boolean().default(true),
  /** Which side of the wall is indoors (`b` = +Z): the sill board goes there, the drip sill outside. */
  interior: z.enum(['a', 'b']).default('b'),
  sillMaterial: MaterialSpec.default({ finish: 'marble' }),
  /**
   * The opening casement is its own entity (`arch-sash`, a child that swings): the window then draws its
   * outer frame, transom and the glass above the transom only. Casement windows without mullions.
   */
  sash: z.boolean().default(false),
  /**
   * Exterior surround (on the outdoor face): `box` a deep projecting frame round the opening (modern window box),
   * `board` flat trim boards with a sill board, `stone` a moulded stone surround with a projecting sill. Omit for none.
   */
  surround: z.object({
    style: z.enum(['box', 'board', 'stone']),
    material: MaterialSpec.default({ finish: 'black-metal' }),
    /** Projection beyond the wall face (metres; box style). */
    depth: z.number().min(0.01).max(0.6).default(0.16),
  }).optional(),
  /**
   * Colour of the daylight seen through the glass: a bright emissive pane just outside it, so a window facing a sunlit
   * street or sky glows the way it does in a photograph instead of showing the dim scene outside. Omitted: none.
   */
  daylight: Color.optional(),
});
export type WindowParams = z.infer<typeof WindowParams>;

/** `arch-sash` params: the opening casement of a window (origin at the centre of its sill rail; hinge on its left edge). */
export const SashParams = z.object({
  width: z.number().min(0.2).max(3).default(1),
  height: z.number().min(0.2).max(3).default(1.2),
  frame: MaterialSpec.default({ finish: 'black-metal' }),
  glass: MaterialSpec.default({ finish: 'glass' }),
});
export type SashParams = z.infer<typeof SashParams>;

/** `arch-railing` params: a polyline railing (balconies, terraces, stair wells). */
export const RailingParams = z.object({
  points: z.array(PlanPoint).min(2).max(ARCH_LIMITS.MAX_RAILING_POINTS),
  height: z.number().min(0.3).max(2).default(1.05),
  style: z.enum(['glass', 'bars', 'cable', 'solid', 'timber']).default('glass'),
  finish: MaterialSpec.default({ finish: 'black-metal' }),
});
export type RailingParams = z.infer<typeof RailingParams>;

/** `arch-column` params. */
export const ColumnParams = z.object({
  shape: z.enum(['round', 'square']).default('round'),
  size: z.number().min(0.05).max(3).default(0.3),
  height: z.number().min(0.2).max(ARCH_LIMITS.MAX_HEIGHT).default(2.8),
  finish: MaterialSpec.default({ finish: 'concrete' }),
});
export type ColumnParams = z.infer<typeof ColumnParams>;

/** `arch-basin` params: a pool recessed below y = 0 (coping at y = 0). */
export const BasinParams = z.object({
  width: z.number().min(0.5).max(60).default(8),
  length: z.number().min(0.5).max(60).default(4),
  depth: z.number().min(0.2).max(4).default(1.4),
  /** Water surface below the coping. */
  freeboard: z.number().min(0).max(0.5).default(0.12),
  finish: MaterialSpec.default({ finish: 'tile', color: '#bfe3ea' }),
  coping: MaterialSpec.default({ finish: 'stone', color: '#d8d2c6' }),
  water: z.boolean().default(true),
});
export type BasinParams = z.infer<typeof BasinParams>;

/** Every structural generator id and its params schema. */
export const STRUCTURE_SCHEMAS = Object.freeze({
  'arch-wall': WallParams,
  'arch-slab': SlabParams,
  'arch-ceiling': CeilingParams,
  'arch-roof': RoofParams,
  'arch-stair': StairParams,
  'arch-door': DoorParams,
  'arch-frame': FrameParams,
  'arch-window': WindowParams,
  'arch-sash': SashParams,
  'arch-railing': RailingParams,
  'arch-column': ColumnParams,
  'arch-basin': BasinParams,
});

/** Id of a structural generator. */
export type StructureId = keyof typeof STRUCTURE_SCHEMAS;
