/**
 * The room-shell vocabulary: everything that makes the inside of a room look like a particular room beyond its
 * rectangle, walls, floor and openings. Ceilings (flat, coved, vaulted, barrel, coffered, beamed, tray), crown
 * moulding and picture rail, skirting profiles, panelled wainscot, wall niches, window and door styles.
 *
 * These are zod schemas shared by the building plan (`plan.ts`), the design plan the AI writes (`scene/design.ts`),
 * the structural generators (`params.ts`) and the room-from-photo description. Every field is optional and bounded,
 * every default is the plain room the plan produced before the vocabulary existed (backward compatible), and
 * `describeShellVocabulary` is the on-demand reference the AI reads through `query_scene {q:"vocabulary"}` instead of
 * carrying it in the always-on prompt.
 */
import { z } from 'zod';
import { Color, MaterialSpec } from '@aether/core';

/** Ceiling shapes. */
export const CEILING_STYLES = ['flat', 'coved', 'vaulted', 'barrel', 'coffered', 'beamed', 'tray'] as const;
export const CeilingStyle = z.enum(CEILING_STYLES);
export type CeilingStyle = z.infer<typeof CeilingStyle>;

/** Crown moulding profiles. */
export const CORNICE_PROFILES = ['plain', 'cove', 'classic', 'stepped'] as const;
export const CorniceProfile = z.enum(CORNICE_PROFILES);
export type CorniceProfile = z.infer<typeof CorniceProfile>;

/** Crown moulding (cornice) round the top of every wall of a room. */
export const Cornice = z.object({
  /** Drop on the wall (metres). */
  height: z.number().min(0.04).max(0.5).default(0.12),
  /** Projection from the wall (metres). */
  depth: z.number().min(0.03).max(0.4).default(0.1),
  profile: CorniceProfile.default('classic'),
  /** Paint colour (default: the ceiling's). */
  color: Color.optional(),
});
export type Cornice = z.infer<typeof Cornice>;

/** A picture rail: a slim moulding on the wall, `drop` metres below the ceiling. */
export const PictureRail = z.object({
  drop: z.number().min(0.05).max(1.2).default(0.3),
  color: Color.optional(),
});
export type PictureRail = z.infer<typeof PictureRail>;

/** Ceiling description of a room (every field optional; `style` default flat). */
export const CeilingDetail = z.object({
  style: CeilingStyle.default('flat'),
  /** Paint colour of the ceiling field. */
  color: Color.optional(),
  cornice: Cornice.optional(),
  /**
   * vaulted / barrel: the ridge stands `rise` m above the eaves (the storey must be that much taller; the plan builder
   * adds it). coved: radius of the curve between wall and ceiling field (default 0.25 m).
   */
  rise: z.number().min(0.1).max(4).optional(),
  /** vaulted / barrel: direction the ridge or the barrel axis runs (default: along the longer side). */
  ridge: z.enum(['x', 'z']).optional(),
  /** vaulted: exposed timber trusses along the ridge. */
  trusses: z.number().int().min(0).max(14).optional(),
  /** Colour of trusses, beams and coffer ribs. */
  beam: Color.optional(),
  /** coffered: a grid of recessed panels framed by ribs. */
  coffers: z.object({ nx: z.number().int().min(1).max(10).default(3), nz: z.number().int().min(1).max(10).default(3), rib: z.number().min(0.03).max(0.5).default(0.12), depth: z.number().min(0.03).max(0.5).default(0.12) }).optional(),
  /** beamed: exposed beams across the room. */
  beams: z.object({ count: z.number().int().min(1).max(16).default(4), dir: z.enum(['x', 'z']).optional(), width: z.number().min(0.04).max(0.6).default(0.15), depth: z.number().min(0.04).max(0.6).default(0.2) }).optional(),
  /** tray: a raised central field inside a lower border. */
  tray: z.object({ inset: z.number().min(0.15).max(2).default(0.5), drop: z.number().min(0.04).max(0.5).default(0.12) }).optional(),
});
export type CeilingDetail = z.infer<typeof CeilingDetail>;

/** Skirting (base board) profiles. */
export const SKIRTING_PROFILES = ['square', 'bevel', 'ogee', 'stepped'] as const;
export const SkirtingProfile = z.enum(SKIRTING_PROFILES);
export type SkirtingProfile = z.infer<typeof SkirtingProfile>;

/** Skirting of every wall of a room. */
export const Skirting = z.object({
  height: z.number().min(0.03).max(0.5).default(0.1),
  depth: z.number().min(0.008).max(0.06).default(0.02),
  profile: SkirtingProfile.default('bevel'),
  color: Color.optional(),
});
export type Skirting = z.infer<typeof Skirting>;

/** How a wall covering is dressed: flat boards, moulded frames, battens, bead-board. */
export const PANEL_STYLES = ['flat', 'shaker', 'raised', 'batten', 'beadboard'] as const;
export const PanelStyle = z.enum(PANEL_STYLES);
export type PanelStyle = z.infer<typeof PanelStyle>;

/** A recess in a wall face (alcove, niche, shelf alcove beside a chimney breast). */
export const Niche = z.object({
  /** The wall, named by the compass side it faces from inside. */
  wall: z.enum(['north', 'south', 'east', 'west']),
  /** Centre along that wall, metres from its left corner seen from inside. */
  along: z.number().min(0).max(200),
  width: z.number().min(0.2).max(4).default(0.8),
  height: z.number().min(0.2).max(3.2).default(1.6),
  /** Bottom above the floor. */
  sill: z.number().min(0).max(2.5).default(0.6),
  /** Depth into the wall (clamped to the wall thickness). */
  depth: z.number().min(0.04).max(0.6).default(0.15),
  /** Shelves inside the recess (evenly spaced). */
  shelves: z.number().int().min(0).max(6).default(0),
  /** Colour of the back and sides (default: the wall's). */
  color: Color.optional(),
  /** Round-headed recess. */
  arched: z.boolean().default(false),
});
export type Niche = z.infer<typeof Niche>;

/** Window styles. `sash` is a double-hung window (meeting rail, muntins), `bay` projects outside the wall. */
export const WINDOW_STYLES = ['casement', 'fixed', 'sliding', 'grid', 'picture', 'sash', 'arched', 'bay'] as const;
export const WindowStyle = z.enum(WINDOW_STYLES);
export type WindowStyle = z.infer<typeof WindowStyle>;

/** Glazing bars: `cols` panes across and `rows` panes up (per sash). */
export const Muntins = z.object({ cols: z.number().int().min(1).max(8).default(2), rows: z.number().int().min(1).max(8).default(3) });
export type Muntins = z.infer<typeof Muntins>;

/** Door styles. `double` and `french` hang two leaves; `arched` has a rounded fanlight above the leaf. */
export const DOOR_STYLES = ['panel', 'flush', 'glass', 'slab', 'glazed', 'double', 'french', 'arched'] as const;
export const DoorStyle = z.enum(DOOR_STYLES);
export type DoorStyle = z.infer<typeof DoorStyle>;

/** Colours, finishes and trims shared by the plan layers; helper for a paint spec from a colour. */
export function paint(color: string): z.infer<typeof MaterialSpec> {
  return { finish: 'paint', color };
}

const REFERENCE: ReadonlyArray<readonly [string, string]> = [
  [
    'ceiling (room.ceiling)',
    `{style: ${CEILING_STYLES.join('|')}, color, cornice?:{height,depth,profile:${CORNICE_PROFILES.join('|')},color}, rise (vaulted/barrel ridge height above the eaves; coved radius), ridge:"x"|"z", trusses:0-14 (vaulted), beam:colour, coffers:{nx,nz,rib,depth}, beams:{count,dir,width,depth}, tray:{inset,drop}}. footprint ceiling height is the eaves/wall height; vaulted and barrel ceilings add rise on top. flat is the default; coffered and beamed need a ceiling of 2.6 m or more to read.`,
  ],
  [
    'cornice and picture rail (room.cornice, room.pictureRail)',
    `cornice {height 0.04-0.5, depth 0.03-0.4, profile ${CORNICE_PROFILES.join('|')}, color} runs on every wall top, mitred in the corners (a vaulted ceiling has none). pictureRail {drop 0.05-1.2 below the ceiling, color}.`,
  ],
  [
    'skirting (room.skirting)',
    `{height 0.03-0.5, depth, profile ${SKIRTING_PROFILES.join('|')}, color}: every wall; default none beyond the thin 8 cm plain board.`,
  ],
  [
    'wall finishes (room.finish, room.walls.<compass>, room.wallColors)',
    'MaterialSpec {finish, color}: paint, plaster, wallpaper, wallpaper-stripe, wallpaper-floral, wallpaper-damask, wallpaper-geometric, panelling, wood-slats, brick, tile, subway-tile, stone, limestone, concrete, cladding, fabric, velvet, leather, marble. Tintable finishes take color as their colour; natural ones keep their own and color tints them.',
  ],
  [
    'dado, wainscot and panelling (room.dado, room.dados.<compass>)',
    `{height 0.2-4 (full height = panelled room), material:{finish,color}, rail: bool (chair rail), style: ${PANEL_STYLES.join('|')}, panels: how many panel bays across 3 m (default 3)}. shaker/raised draw real moulded frames; batten draws vertical strips; beadboard draws grooves.`,
  ],
  [
    'niches (room.niches)',
    '[{wall, along, width, height, sill, depth, shelves, color, arched}]: a recess into the wall face (alcove beside a chimney breast, display niche); depth is limited to the wall thickness.',
  ],
  [
    'windows (opening.style, muntins, frame, bay, casing)',
    `style ${WINDOW_STYLES.join('|')}; muntins {cols,rows} glazing bars per sash; frame colour (#rrggbb); casing: interior architrave true|false; bay {depth, angle} for bay; arched rounds the head. sash = double-hung with a meeting rail (tall windows of old houses), casement = side-hung, picture = one pane, grid = many small panes.`,
  ],
  [
    'doors (opening.style)',
    `style ${DOOR_STYLES.join('|')}: panel (moulded panels), flush, glass (frame with a glass panel), slab, glazed (upper half glass), double (two panelled leaves), french (two glazed leaves), arched (leaf with a rounded fanlight); colour via color.`,
  ],
  [
    'curtains, blinds, pelmets (parts curtain, blind)',
    'curtain params: style pleated|pinch|eyelet|ripple|sheer, color, width, height, pelmet none|box|valance|swag, rod rod|track|none, tieback bool, closed 0..1 (how far drawn across the window), panels 1|2. blind params: style roller|roman|venetian|shutter|vertical, color, drawn 0..1 (how far lowered). Both anchor to a window with opening:<id>.',
  ],
  [
    'fireplaces and built-ins (parts fireplace, bookshelf, wardrobe, niche)',
    'fireplace params: style stone|marble|brick|concrete|plaster surround, mantel none|shelf|classic, breast (chimney breast to the ceiling), width. bookshelf and wardrobe take builtin:true (full height to the ceiling, flush to the wall, with a face frame and crown) and shelves/fill. Place a builtin between two niches or beside a fireplace.',
  ],
];

/** The shell vocabulary as the on-demand reference text (kept out of the always-on prompt). */
export function describeShellVocabulary(topic?: string): string {
  const t = topic?.trim().toLowerCase();
  const rows = t ? REFERENCE.filter(([k, v]) => k.toLowerCase().includes(t) || v.toLowerCase().includes(t)) : REFERENCE;
  const use = rows.length > 0 ? rows : REFERENCE;
  return [
    'Room shell vocabulary (all optional; defaults give the plain room). Set these on a room in design_plan (room.ceiling, room.cornice, room.pictureRail, room.skirting, room.dado, room.dados, room.niches, room.walls, room.finish) and on openings (style, muntins, frame, casing, bay).',
    ...use.map(([k, v]) => `- ${k}: ${v}`),
  ].join('\n');
}
