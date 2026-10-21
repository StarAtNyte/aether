/**
 * The structured description of a room read from a photograph.
 *
 * A vision model fills this in from the picture; everything after it (the design
 * plan, the placement steps, the checklist the render is compared against, the
 * camera the compare render uses) is derived from it. It is untrusted model
 * output: every field is bounded, every id is a slug, every number is finite.
 *
 * Frame of the description (the model is told this in its prompt):
 * - Metres, measured on the INSIDE faces of the walls. The room is the rectangle
 *   x 0..width (west to east) by z 0..depth (north to south); north is −Z.
 * - The camera stands inside the room (or at most 1 m outside it) looking into it.
 *   The model chooses the compass so that the camera is in the south half and
 *   looks towards the north (heading within ±70°).
 * - A wall is named by the compass side it faces from the inside. `along` is the
 *   distance in metres from the LEFT corner of that wall, seen from inside the
 *   room facing it (north wall: from the west corner; east wall: from the north
 *   corner; south wall: from the east corner; west wall: from the south corner).
 */
import { z } from 'zod';
import { Color } from '@aether/core';
import { ArchStyle, Compass, RoomType } from '../plan';
import { applyReality } from './reality';

/** Largest room the photo flow reconstructs (metres per side). */
export const PHOTO_MAX_SIDE = 16;

const Slug = z.string().regex(/^[a-z][a-z0-9-]{0,23}$/, 'ids are short lowercase slugs (letters, digits, dashes; at most 24 characters)');
const Handle = z.string().regex(/^[a-z0-9][a-z0-9-]{0,35}$/, 'ids are lowercase slugs (letters, digits, dashes; at most 36 characters)');
/** Free text: clipped to `n` characters (a long sentence is not a reason to refuse a whole description). */
const Text = (n: number) => z.preprocess((v) => (typeof v === 'string' && v.length > n ? v.slice(0, n) : v), z.string().max(n));
/** Accept numbers the model wrote as strings ("2.4", "2.4 m"). */
const Num = (min: number, max: number) =>
  z.preprocess((v) => {
    if (typeof v === 'string') {
      const m = /^\s*(-?\d+(?:\.\d+)?)/.exec(v);
      return m ? Number(m[1]) : v;
    }
    return v;
  }, z.number().finite().min(min).max(max));
const Pair = z.tuple([Num(-50, 50), Num(-50, 50)]);

/**
 * Where something appears in the photograph: [x0, y0, x1, y1] in 0..1 of the image width and height, origin top-left.
 * An unusable box (outside the image, empty) is dropped, not refused.
 */
const Box = z.preprocess((v) => {
  if (!Array.isArray(v) || v.length !== 4) return undefined;
  const n = v.map((x) => (typeof x === 'number' ? x : typeof x === 'string' ? Number(x) : Number.NaN));
  if (n.some((x) => !Number.isFinite(x))) return undefined;
  const [a, b, c, d] = n as [number, number, number, number];
  const clamp = (x: number): number => Math.max(0, Math.min(1, x));
  const x0 = clamp(Math.min(a, c));
  const x1 = clamp(Math.max(a, c));
  const y0 = clamp(Math.min(b, d));
  const y1 = clamp(Math.max(b, d));
  return x1 - x0 < 0.015 || y1 - y0 < 0.015 ? undefined : [x0, y0, x1, y1];
}, z.tuple([z.number(), z.number(), z.number(), z.number()]).optional());

/** Wall `along` limit (metres). */
const ALONG_MAX = 100;

/** The camera the photo implies. */
export const PhotoCamera = z.object({
  /** Camera position on the floor plan (metres, x east, z south). */
  x: Num(-4, PHOTO_MAX_SIDE + 4),
  z: Num(-4, PHOTO_MAX_SIDE + 4),
  /** Eye height above the floor. */
  height: Num(0.3, 2.6).default(1.35),
  /** Direction looked in: degrees clockwise from north (0 = north, 90 = east, -45 = north-west). */
  heading: Num(-360, 360),
  /** Angle the camera looks up (positive) or down (negative), degrees. */
  pitch: Num(-45, 45).default(0),
  /** HORIZONTAL field of view of the photo in degrees (a phone wide lens is about 70, an interior wide lens 85-100). */
  fov: Num(25, 120).default(75),
});
export type PhotoCamera = z.infer<typeof PhotoCamera>;

/** A window, door or open passage. */
export const PhotoOpening = z.object({
  id: Slug,
  kind: z.enum(['window', 'door', 'opening']),
  wall: Compass,
  /** Centre of the opening, metres from the left corner of that wall (see the module docs). */
  along: Num(0, ALONG_MAX),
  width: Num(0.4, 8),
  height: Num(0.4, 4).optional(),
  /** Bottom above the floor (windows: the sill). */
  sill: Num(0, 2.5).optional(),
  /** Seen in the photo (false: assumed, e.g. a door behind the camera). */
  visible: z.boolean().default(true),
  /** Where it appears in the photo (the visible extent). */
  box: Box,
  /** What it looks like: frame colour, panes, view. */
  note: Text(160).default(''),
  /** Windows: the daylight beyond the glass is bright and glowing in the photo (sunlit street, overexposed sky). */
  glow: z.boolean().optional(),
  /** Windows: colour of that glow (#rrggbb); default a warm white. */
  daylight: Color.optional(),
});
export type PhotoOpening = z.infer<typeof PhotoOpening>;

/** Param values of a part: numbers, colours, words, switches. */
const ParamValue = z.union([z.number().finite(), z.string().max(40), z.boolean()]);

/**
 * One piece: furniture, a lamp, a picture, a curtain, a cornice, a TV. `kind` is a part of the parts library
 * (the model is shown the catalogue); `params` are the part's own parameters (sizes, colours, finishes).
 */
export const PhotoItem = z.object({
  id: Handle,
  kind: z.string().min(1).max(40),
  /** The piece in the photographer's words ("white upholstered armchair by the window"). */
  label: Text(120).default(''),
  /** Floor and wall pieces: the wall they stand against or hang on. */
  wall: Compass.optional(),
  /** Centre along that wall (metres from its left corner), or omit with `at`. */
  along: Num(0, ALONG_MAX).optional(),
  /** Floor pieces: distance from the wall face to the back of the piece (0 = touching). */
  gap: Num(0, 6).optional(),
  /** Floor pieces away from walls: centre on the floor plan. */
  at: Pair.optional(),
  /** Compass the front of the piece faces, or the id of a piece it faces (a chair facing the desk). */
  faces: z.union([Compass, Handle]).optional(),
  /** Surface pieces (lamp, TV set, vase): the id of the piece they stand on. */
  on: Handle.optional(),
  /** Offset of a surface piece from the centre of its host: [across, depth] in metres. */
  offset: Pair.optional(),
  /** Curtains: the id of the window they belong to. */
  opening: Slug.optional(),
  /** Wall pieces: bottom above the floor, in metres. */
  bottom: Num(0, 5).optional(),
  /** Wall pieces hung above another piece: the id of that piece and the gap above its top. */
  above: Handle.optional(),
  aboveGap: Num(0, 3).optional(),
  /** Part parameters (see the catalogue). */
  params: z.record(z.string().max(32), ParamValue).default({}),
  /** Seen in the photo (false: assumed from what is typical or hidden behind other things). */
  visible: z.boolean().default(true),
  /** Where it appears in the photo (the visible extent; curtains: both panels together). */
  box: Box,
  /** 0..1: how sure the model is that this piece exists as described. */
  confidence: Num(0, 1).default(0.7),
});
export type PhotoItem = z.infer<typeof PhotoItem>;

/** What one assumption of the reconstruction is. */
export const PhotoAssumption = z.object({
  id: Handle.optional(),
  /** What was assumed ("the room is about 3.6 m wide"). */
  text: Text(220),
  /** 0..1 */
  confidence: Num(0, 1).default(0.5),
  /** A sentence the user can send to change it ("make the room 4.5 m wide"). */
  adjust: Text(160).default(''),
});
export type PhotoAssumption = z.infer<typeof PhotoAssumption>;

/** Colour and finish of one wall as seen. */
export const PhotoWallFinish = z.object({
  color: Color.optional(),
  /** Material of the wall surface (plaster, paint, wallpaper, brick, panelling). */
  material: Text(30).optional(),
  /** Seen in the photo. */
  visible: z.boolean().default(true),
});

/** Light as the photo shows it. */
export const PhotoLight = z.object({
  /** Hour of the day 0..24 the light suggests. */
  timeOfDay: Num(0, 24).default(14),
  sky: z.enum(['day', 'dawn', 'sunset', 'night', 'overcast']).default('day'),
  /** The wall whose window the light comes through, or "none" (lamps only). */
  from: z.union([Compass, z.literal('none')]).default('none'),
  warmth: z.enum(['cool', 'neutral', 'warm']).default('neutral'),
  /** 0 = very dim, 1 = very bright. */
  brightness: Num(0, 1).default(0.6),
  note: Text(160).default(''),
});
export type PhotoLight = z.infer<typeof PhotoLight>;

/** Most openings a description may list. */
export const MAX_PHOTO_OPENINGS = 24;
/** Most furniture and decor items a description may list. */
export const MAX_PHOTO_ITEMS = 80;

/** The full description of a room photograph. */
export const RoomDescription = z.object({
  /** One or two sentences: what the picture shows. */
  summary: Text(300).default(''),
  /** Kind of room (bedroom, living, kitchen, …). */
  roomType: RoomType.default('bedroom'),
  style: ArchStyle.default('modern'),
  /** Interior size in metres: width (west-east), depth (north-south), ceiling height. */
  footprint: z.object({ width: Num(1.6, PHOTO_MAX_SIDE), depth: Num(1.6, PHOTO_MAX_SIDE), ceiling: Num(2.2, 6) }),
  camera: PhotoCamera,
  walls: z.partialRecord(Compass, PhotoWallFinish).default({}),
  floor: z.object({ material: Text(30).default('oak'), color: Color.optional(), note: Text(120).default('') }).default({ material: 'oak', note: '' }),
  ceiling: z
    .object({
      color: Color.optional(),
      /** Crown moulding along the top of the walls: drop, projection and colour. */
      cornice: z.object({ height: Num(0.04, 0.4), depth: Num(0.03, 0.3).optional(), color: Color.optional() }).optional(),
      /**
       * A vaulted (gable) ceiling: `footprint.ceiling` is then the height of the walls at the eaves, `rise` the extra height of
       * the ridge, `ridge` the direction the ridge runs (default: along the longer side), `trusses` exposed timber trusses.
       */
      vault: z.object({ rise: Num(0.3, 3.5), ridge: z.enum(['x', 'z']).optional(), trusses: Num(0, 14).optional(), color: Color.optional() }).optional(),
    })
    .default({}),
  openings: z.array(PhotoOpening).max(MAX_PHOTO_OPENINGS).default([]),
  items: z.array(PhotoItem).max(MAX_PHOTO_ITEMS).default([]),
  light: PhotoLight.default({ timeOfDay: 14, sky: 'day', from: 'none', warmth: 'neutral', brightness: 0.6, note: '' }),
  /** Dominant colours of the picture, #rrggbb. */
  palette: z.array(Color).max(8).default([]),
  assumptions: z.array(PhotoAssumption).max(16).default([]),
});
export type RoomDescription = z.infer<typeof RoomDescription>;

/** Result of {@link parseRoomDescription}. */
export type ParsedDescription = { ok: true; value: RoomDescription; fixes: string[] } | { ok: false; error: string };

/** Kind names models use that are not part kinds, mapped to the part that fits. */
export const KIND_SYNONYMS: Readonly<Record<string, string>> = Object.freeze({
  picture: 'art',
  painting: 'art',
  poster: 'art',
  frame: 'art',
  'framed-picture': 'art',
  'wall-art': 'art',
  photo: 'art',
  curtains: 'curtain',
  drapes: 'curtain',
  drape: 'curtain',
  molding: 'cornice',
  moulding: 'cornice',
  crown: 'cornice',
  'crown-molding': 'cornice',
  'crown-moulding': 'cornice',
  television: 'tv-set',
  'tv-stand': 'sideboard',
  'tv-cabinet': 'sideboard',
  'tv-unit': 'sideboard',
  cabinet: 'sideboard',
  dresser: 'sideboard',
  chest: 'sideboard',
  lamp: 'table-lamp',
  'bedside-lamp': 'table-lamp',
  'desk-lamp': 'table-lamp',
  'standing-lamp': 'floor-lamp',
  'floor-light': 'floor-lamp',
  'bedside-table': 'nightstand',
  'night-stand': 'nightstand',
  'side-table': 'nightstand',
  'end-table': 'nightstand',
  stool: 'bar-stool',
  couch: 'sofa',
  carpet: 'rug',
  mat: 'rug',
  'accent-chair': 'armchair',
  'easy-chair': 'armchair',
  'lounge-chair': 'armchair',
  closet: 'wardrobe',
  armoire: 'wardrobe',
  shelf: 'bookshelf',
  shelves: 'bookshelf',
  bookcase: 'bookshelf',
  'dining-chair': 'chair',
  'ceiling-lamp': 'ceiling-light',
  chandelier: 'pendant',
  'pendant-light': 'pendant',
  'pendant-lamp': 'pendant',
  'wall-lamp': 'sconce',
  'wall-light': 'sconce',
  houseplant: 'plant',
  'indoor-plant': 'plant',
  table: 'dining-table',
  socket: 'switch',
  outlet: 'switch',
  'power-socket': 'switch',
  'wall-socket': 'switch',
  'light-switch': 'switch',
  'four-poster': 'bed',
  'four-poster-bed': 'bed',
  'canopy-bed': 'bed',
  'side-chair': 'chair',
  palm: 'plant',
  frond: 'plant',
  'palm-frond': 'plant',
  'working-desk': 'desk',
});

/**
 * Parse an untrusted description (a JSON value). Light repairs are made and reported: kind synonyms are mapped to parts,
 * `along` values beyond the wall are clamped, duplicate ids are renamed. Everything else is validated strictly.
 */
export function parseRoomDescription(raw: unknown, knownKinds: readonly string[]): ParsedDescription {
  const parsed = RoomDescription.safeParse(raw);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { ok: false, error: `${i ? `${i.path.join('.') || '(root)'}: ${i.message}` : 'invalid description'}` };
  }
  const d = parsed.data;
  const fixes: string[] = [];
  const kinds = new Set(knownKinds);
  const wallLength = (w: 'north' | 'south' | 'east' | 'west'): number => (w === 'north' || w === 'south' ? d.footprint.width : d.footprint.depth);
  const clampAlong = (along: number | undefined, wall: 'north' | 'south' | 'east' | 'west', what: string): number | undefined => {
    if (along === undefined) return undefined;
    const max = wallLength(wall);
    if (along < 0 || along > max) {
      const c = Math.max(0, Math.min(max, along));
      fixes.push(`${what}: along ${along} m is off its ${wall} wall (${max} m); moved to ${Math.round(c * 100) / 100} m`);
      return c;
    }
    return along;
  };
  const openingIds = new Set<string>();
  const openings = d.openings.map((o) => {
    let id = o.id;
    for (let n = 2; openingIds.has(id); n++) id = `${o.id.slice(0, 20)}-${n}`;
    if (id !== o.id) fixes.push(`opening id ${o.id} was used twice; renamed ${id}`);
    openingIds.add(id);
    const along = clampAlong(o.along, o.wall, `${o.kind} ${id}`) ?? o.along;
    return { ...o, id, along };
  });
  const itemIds = new Set<string>();
  const items: PhotoItem[] = [];
  for (const it of d.items) {
    let id = it.id;
    for (let n = 2; itemIds.has(id); n++) id = `${it.id.slice(0, 32)}-${n}`;
    if (id !== it.id) fixes.push(`piece id ${it.id} was used twice; renamed ${id}`);
    itemIds.add(id);
    let kind = it.kind.trim().toLowerCase().replace(/[\s_]+/g, '-');
    if (!kinds.has(kind)) {
      const mapped = KIND_SYNONYMS[kind];
      if (mapped && kinds.has(mapped)) {
        fixes.push(`"${it.kind}" is not a part; used ${mapped}`);
        kind = mapped;
      } else {
        fixes.push(`"${it.kind}" (${it.label || id}) matches no part of the library and was left out; say so in the assumptions`);
        continue;
      }
    }
    const along = it.wall ? clampAlong(it.along, it.wall, `${kind} ${id}`) : it.along;
    items.push({ ...it, id, kind, ...(along !== undefined ? { along } : {}) });
  }
  const real = applyReality({ ...d, openings, items });
  return { ok: true, value: real.description, fixes: [...fixes, ...real.fixes] };
}
