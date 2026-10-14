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
import { MaterialSpec } from '@aether/core';

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

const ext = z.number().min(-3).max(3).default(0);

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
  /** Skirting boards on interior faces. */
  skirting: z.enum(['none', 'a', 'b', 'both']).default('both'),
  skirtingMaterial: MaterialSpec.default({ finish: 'paint', color: '#f1eee8' }),
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
});
export type StairParams = z.infer<typeof StairParams>;

/** `arch-door` (moving leaf) params. */
export const DoorParams = z.object({
  width: z.number().min(0.4).max(3).default(0.9),
  height: z.number().min(1.5).max(4).default(2.1),
  thickness: z.number().min(0.02).max(0.12).default(0.045),
  style: z.enum(['panel', 'flush', 'glass', 'slab']).default('panel'),
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
});
export type FrameParams = z.infer<typeof FrameParams>;

/** `arch-window` params (the window sits at its sill height; local y = 0 is the sill). */
export const WindowParams = z.object({
  width: z.number().min(0.3).max(12).default(1.2),
  height: z.number().min(0.3).max(10).default(1.4),
  wallThickness: z.number().min(0.02).max(1.5).default(0.25),
  style: z.enum(['casement', 'fixed', 'sliding', 'grid', 'picture']).default('casement'),
  /** Vertical mullions (0 = automatic from the width). */
  mullions: z.number().int().min(0).max(12).default(0),
  frame: MaterialSpec.default({ finish: 'black-metal' }),
  glass: MaterialSpec.default({ finish: 'glass' }),
  /** Interior sill board. */
  sill: z.boolean().default(true),
  sillMaterial: MaterialSpec.default({ finish: 'marble' }),
});
export type WindowParams = z.infer<typeof WindowParams>;

/** `arch-railing` params: a polyline railing (balconies, terraces, stair wells). */
export const RailingParams = z.object({
  points: z.array(PlanPoint).min(2).max(ARCH_LIMITS.MAX_RAILING_POINTS),
  height: z.number().min(0.3).max(2).default(1.05),
  style: z.enum(['glass', 'bars', 'cable', 'solid']).default('glass'),
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
  'arch-railing': RailingParams,
  'arch-column': ColumnParams,
  'arch-basin': BasinParams,
});

/** Id of a structural generator. */
export type StructureId = keyof typeof STRUCTURE_SCHEMAS;
