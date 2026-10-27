/**
 * The design record stored with a building's plan: what the designer meant
 * (brief, programme, circulation, every piece with its intended relations).
 * The review loop checks the finished building against it, so "bed centred on
 * the north wall, nightstands each side, picture centred above" is something
 * the checker can measure, not only a sentence.
 */
import { z } from 'zod';

const RoomId = z.string().regex(/^[a-z][a-z0-9-]{0,23}$/, 'room ids are short lowercase slugs');
const Compass = z.enum(['north', 'south', 'east', 'west']);

/** Handle of a planned piece (the placed entity is `<building>-<handle>`). */
export const ItemHandle = z.string().regex(/^[a-z0-9][a-z0-9-]{0,35}$/, 'piece ids are lowercase slugs (letters, digits, dashes; at most 36 characters)');

/** Relations the checker can measure. */
export const RELATION_TYPES = ['against_wall', 'centred_on_wall', 'in_corner', 'flanks', 'beside', 'above_centred', 'centred_on_opening', 'on_top', 'faces'] as const;

/** One intended relation of a piece. */
export const DesignRelation = z.preprocess(
  // Models often name the opening of a `centred_on_opening` relation "opening" instead of "target".
  (v) => (typeof v === 'object' && v !== null && !Array.isArray(v) && (v as Record<string, unknown>)['target'] === undefined && typeof (v as Record<string, unknown>)['opening'] === 'string' ? { ...v, target: (v as Record<string, unknown>)['opening'] } : v),
  z.object({
  type: z.enum(RELATION_TYPES),
  /** Another planned piece (handle), an opening id, or a room wall for `faces`. */
  target: z.string().max(64).optional(),
  wall: Compass.optional(),
  /** Intended gap in metres (flank, beside, above). */
  gap: z.number().min(0).max(5).optional(),
  /** For `flanks`: which side of the target. */
  side: z.enum(['left', 'right']).optional(),
  }),
);
export type DesignRelation = z.infer<typeof DesignRelation>;

/** A piece the designer intends to place. */
export const DesignItem = z.object({
  id: ItemHandle,
  kind: z.string().min(1).max(40),
  room: RoomId,
  /** The designer's words: "bed centred on the north wall". */
  intent: z.string().max(240).default(''),
  relations: z.array(DesignRelation).max(6).default([]),
});
export type DesignItem = z.infer<typeof DesignItem>;

/** What each room is for. */
export const DesignProgramme = z.object({ room: RoomId, purpose: z.string().max(160).default(''), targetArea: z.number().min(0).max(1000).optional() });

/** Circulation: where people enter and how they move. */
export const DesignCirculation = z.object({
  entrance: z.union([RoomId, z.literal('outside')]).optional(),
  notes: z.string().max(500).default(''),
  routes: z.array(z.array(RoomId).min(2).max(12)).max(12).default([]),
});

/**
 * A mapping the model declared between a planned piece and what is in the world ("planned screen = entity widescreen-1"),
 * or the reason a planned piece is not built. Kept with the plan and honoured by every later check.
 */
export const DesignDeclared = z.object({
  /** World entities that stand for the planned piece. */
  entities: z.array(z.string().max(80)).max(40).default([]),
  /** Why it is mapped, or why the piece is not built when `entities` is empty. */
  reason: z.string().max(240).default(''),
});
export type DesignDeclared = z.infer<typeof DesignDeclared>;

/** The record kept on the building plan. */
export const DesignRecord = z.object({
  brief: z.string().max(500).default(''),
  programme: z.array(DesignProgramme).max(40).default([]),
  circulation: DesignCirculation.optional(),
  furniture: z.array(DesignItem).max(160).default([]),
  /** The ids the designer gave openings in the plan, mapped to the entity ids the builder assigned. */
  openingAliases: z.record(z.string().max(40), z.string().max(80)).default({}),
  /** Planned handle to what the model declared for it (see {@link DesignDeclared}). */
  declared: z.record(ItemHandle, DesignDeclared).default({}),
});
export type DesignRecord = z.infer<typeof DesignRecord>;
