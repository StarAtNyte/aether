/**
 * The character library: the cast of people and the motion sets, as built by
 * `scripts/characters/build.ts` (see `generated.ts`) plus the hand-written
 * traits (age, wardrobe, skin) the resolver and the planner use to pick someone.
 *
 * Pure data and lookups, no three.js: usable from the planner (Node), the
 * renderer and tests.
 */
import { GENERATED_LIBRARY } from './generated';
import { ORIGINAL_CAST, ORIGINAL_LODS } from './original';
import { libraryUrl } from '../registry';

/** One baked body as written by the build. */
export interface CastFile {
  id: string;
  gender: 'male' | 'female';
  look: string;
  /** Path under the library base (`c/marcus.1a2b3c4d.glb`). */
  file: string;
  /** Standing height in metres. */
  height: number;
  /** Hip height in metres (root bone, bind pose). */
  hip: number;
  triangles: number;
  /** +1 when the mesh faces +Z in the file. */
  faces: 1 | -1;
  bytes: number;
  /** Mean luminance (0..1) of the recolourable outfit regions, for tinting. */
  /** Outfit mask image (`c/marcus.masks.1a2b3c4d.webp`), absent when none was built. */
  masks?: string | null;
  tintTop?: number;
  tintBottom?: number;
  tintHair?: number;
  /**
   * Drawing style: `toon` bodies (the project's own anime cast, `scripts/characters/anime-kaho.ts`) are cel shaded with
   * an outline, swing spring bones and pose on twos; absent = the realistic Rocketbox look. Toon bodies are only used when
   * named (`character.body`), never picked at random.
   */
  style?: 'toon';
  /** The far level of detail (the same skeleton, clips and materials, fewer triangles, no morphs), when one was built. */
  lod1?: LodFile;
  /**
   * A body converted from someone else's model (`scripts/characters/vrm-character.ts`): where it came from and under
   * which licence; the credits list it as theirs. Absent = this project's own body (MIT) or a Rocketbox one.
   */
  credit?: { source: string; author: string; licence: string; licenceUrl: string; url: string; line?: string };
}

/** A reduced level of detail of a body, under the library base. */
export interface LodFile {
  file: string;
  triangles: number;
  bytes: number;
}

/** One clip of a motion set. */
export interface ClipInfo {
  name: string;
  duration: number;
  /** Planar speed the clip was captured at (m/s); 0 for in-place clips. */
  stride: number;
  /** Foot contacts of a gait clip as `[cycle phase 0..1, foot]` (0 = left, 1 = right). */
  contacts?: ReadonlyArray<readonly [number, number]>;
}

/** A motion set (shared by every body of one gender). */
export interface MotionFile {
  gender: 'male' | 'female';
  file: string;
  bytes: number;
  /** Hip height (m) of the skeleton the clips were authored on (idle pose). */
  hip: number;
  clips: ClipInfo[];
}

/** The shape of `generated.ts`. */
export interface CharacterLibrary {
  cast: CastFile[];
  motions: MotionFile[];
}

/** Age bracket of a body. */
export type Age = 'young' | 'adult' | 'old';
/** Skin tone bracket of a body (informational: used to vary a crowd). */
export type Skin = 'light' | 'tan' | 'dark';

/** Traits kept by hand per cast id. */
export interface CastTraits {
  age: Age;
  skin: Skin;
  /** Wardrobes the outfit plausibly fits, best first. */
  wardrobes: readonly string[];
  /** Words that name this person ("grey", "balding"), for prompt matching. */
  words: readonly string[];
}

/** Traits by cast id (the visible outfit decides the wardrobes). */
export const CAST_TRAITS: Readonly<Record<string, CastTraits>> = {
  marcus: { age: 'old', skin: 'light', wardrobes: ['elder', 'formal', 'merchant', 'villager'], words: ['grey', 'gray', 'white-haired', 'grandfather', 'old'] },
  dario: { age: 'young', skin: 'dark', wardrobes: ['bandit', 'casual', 'worker', 'traveller'], words: ['curly', 'hoodie'] },
  tomas: { age: 'adult', skin: 'light', wardrobes: ['guard', 'traveller', 'worker', 'villager'], words: ['vest', 'jacket'] },
  felix: { age: 'young', skin: 'light', wardrobes: ['casual', 'villager', 'traveller'], words: ['red', 'sweater'] },
  kofi: { age: 'adult', skin: 'dark', wardrobes: ['guard', 'casual', 'worker', 'bandit'], words: ['denim'] },
  walter: { age: 'adult', skin: 'light', wardrobes: ['merchant', 'villager', 'worker', 'formal'], words: ['balding', 'bald'] },
  sophie: { age: 'young', skin: 'light', wardrobes: ['formal', 'merchant', 'casual'], words: ['blouse', 'skirt'] },
  edith: { age: 'old', skin: 'light', wardrobes: ['elder', 'villager', 'traveller', 'merchant'], words: ['grandmother', 'granny'] },
  rosa: { age: 'adult', skin: 'tan', wardrobes: ['villager', 'merchant', 'formal'], words: ['dress'] },
  juno: { age: 'young', skin: 'light', wardrobes: ['casual', 'traveller', 'worker'], words: ['blonde', 'blond'] },
  kaho: { age: 'young', skin: 'light', wardrobes: ['casual', 'traveller'], words: ['anime', 'schoolgirl', 'uniform', 'ponytail', 'sailor'] },
};

/**
 * How a body's face morphs are driven, kept by hand per cast id. A story asks for an expression at 0..1; the body shows
 * `weight * caps[name]`. Bodies converted from VRM models carry the VRM presets as their morphs, and at full weight those
 * are extreme anime poses (`happy` squeezes the eyes shut, `aa` and `surprised` open the mouth wide), so they are scaled
 * down; stacking two of them (a smile on top of a held surprise) breaks the face, so the emotions are exclusive.
 */
export interface FaceTuning {
  /** Largest weight each morph is shown at (a story weight of 1 maps to it); a morph left out shows as asked. */
  caps: Readonly<Record<string, number>>;
  /** An expression the body has no morph for, drawn with another morph at a weight scale (VRM has no `teary`: `sad`). */
  alias?: Readonly<Record<string, { morph: string; scale: number }>>;
  /** Raising one of these eases the others of the list back to 0 (the latest emotion wins, none stack). */
  exclusive?: readonly string[];
  /** Easing time constant (s) of the two-stage blend toward a new weight (smooth start and settle). */
  ease?: number;
}

/** The caps of the VRM-converted bodies (VRM1_Constraint_Twist_Sample): subtle, film-friendly faces. */
const VRM_FACE_TUNING: FaceTuning = {
  caps: { smile: 0.5, blink: 1, mouth_open: 0.35, sad: 0.5, surprised: 0.45, determined: 0.5, teary: 0.5 },
  alias: { teary: { morph: 'sad', scale: 0.6 } },
  exclusive: ['smile', 'sad', 'surprised', 'teary', 'determined'],
  ease: 0.12,
};

/** Face tuning by cast id; a body without an entry shows its morphs as asked. */
export const CAST_FACES: Readonly<Record<string, FaceTuning>> = {
  'kaho-vrm': VRM_FACE_TUNING,
  'mio-vrm': VRM_FACE_TUNING,
};

/**
 * The morph weights a tuned body shows for the asked expression weights (each 0..1): aliases resolved, each morph
 * scaled by its cap and kept within it. Pure (the rig and the tests use it).
 */
export function faceMorphWeights(tuning: FaceTuning, asked: Readonly<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, w0] of Object.entries(asked)) {
    const w = Math.max(0, Math.min(1, w0));
    const alias = tuning.alias?.[name];
    const morph = alias ? alias.morph : name;
    const cap = tuning.caps[morph] ?? 1;
    const v = w * (alias ? alias.scale : 1) * cap;
    out[morph] = Math.min(cap, (out[morph] ?? 0) + v);
  }
  return out;
}

/** A cast member with its traits. */
export interface CastMember extends CastFile {
  traits: CastTraits;
  /** How its face morphs are driven, when tuned (see {@link CAST_FACES}). */
  face?: FaceTuning;
}

const FALLBACK_TRAITS: CastTraits = { age: 'adult', skin: 'light', wardrobes: ['casual'], words: [] };

/** Every body of the library: the Rocketbox cast, then the project's own bodies. */
export const CAST: readonly CastMember[] = [...GENERATED_LIBRARY.cast, ...ORIGINAL_CAST].map((c) => {
  const face = CAST_FACES[c.id];
  return face ? { ...c, traits: CAST_TRAITS[c.id] ?? FALLBACK_TRAITS, face } : { ...c, traits: CAST_TRAITS[c.id] ?? FALLBACK_TRAITS };
});

/** True for a body drawn in the toon style. */
export function isToonBody(c: Pick<CastFile, 'style'>): boolean {
  return c.style === 'toon';
}

/** The far level of detail of a body (its cast entry's, or the project's own bodies' `ORIGINAL_LODS`), or null. */
export function farLevelOf(c: Pick<CastFile, 'id' | 'lod1'>): LodFile | null {
  return c.lod1 ?? ORIGINAL_LODS[c.id] ?? null;
}

/** A body by id. */
export function castById(id: string): CastMember | undefined {
  return CAST.find((c) => c.id === id);
}

/** The motion set of a gender. */
export function motionSet(gender: 'male' | 'female'): MotionFile | undefined {
  return GENERATED_LIBRARY.motions.find((m) => m.gender === gender);
}

/** Clip table of a gender, by name. */
export function clipTable(gender: 'male' | 'female'): ReadonlyMap<string, ClipInfo> {
  return new Map((motionSet(gender)?.clips ?? []).map((c) => [c.name, c]));
}

/** Public URL of a library file under `base` (the catalog base, `/assets/lib/` by default). */
export function characterUrl(file: string, base = '/assets/lib/'): string {
  return libraryUrl(file, { base });
}
