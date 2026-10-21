/**
 * The structured form of a small edit: what the local parser extracts from
 * "make the sofa dark green velvet" or "move the lamp a bit left".
 * Commands are plain JSON so the last one can be remembered ("do the same
 * for the other bedroom") and replayed on another target.
 */

/** Spatial relation between a referent and an anchor ("left of the window"). */
export type Relation = 'left of' | 'right of' | 'above' | 'below' | 'behind' | 'in front of' | 'next to' | 'near' | 'on' | 'under' | 'inside';

/** A reference to something in the world, as written by the user. */
export interface Ref {
  /** The phrase as written (for messages). */
  text: string;
  /** Head noun, singular lowercase ("sofa"); '' for a bare pronoun. */
  noun: string;
  /** Other descriptive words ("round", "wooden", "red"). */
  adjectives: string[];
  /** 1-based position among matches; -1 = last. */
  ordinal?: number;
  /** Every match ("all the chairs"); also set by a plural noun. */
  all?: boolean;
  /** The user said "all", "every", "each" or "both" (as opposed to a plain plural). */
  allWord?: boolean;
  /** "the other bedroom": a match other than the last target. */
  other?: boolean;
  /** "it", "this", "that", "these", "them", "the same". */
  pronoun?: 'it' | 'this' | 'that' | 'these' | 'those' | 'them' | 'same';
  /** Room phrase ("bedroom", "second bedroom", "kitchen"). */
  room?: Ref;
  /** Spatial relation to another referent. */
  relation?: { rel: Relation; anchor: Ref };
  /** A named part of the thing ("legs", "cushions", "frame"). */
  part?: string;
  /** Wall side or compass word ("back", "left", "north", "feature"). */
  side?: string;
  /** Colour named as an adjective ("the red chair"), hex. */
  colorAdj?: string;
  /** "the whole apartment", "the entire scene": a request about everything, not one thing. */
  whole?: boolean;
}

/** Where to put an added thing relative to the world. */
export interface Placement {
  relation?: { rel: Relation; anchor: Ref };
  room?: Ref;
  /** Wall side ("on the back wall"). */
  side?: string;
}

/** Colour and/or material requested. */
export interface Look {
  /** Hex colour. */
  color?: string;
  /** Colour words as written ("dark green"). */
  colorText?: string;
  /** Material word key into MATERIAL_WORDS (or 'wallpaper'). */
  material?: string;
  /** Pattern word ("striped", "floral") – recorded for messages only. */
  pattern?: string;
  /** Whole-object opacity ("transparent"). */
  opacity?: number;
  /** Self-lit ("glowing"). */
  glow?: boolean;
  /** Metallic sheen. */
  metal?: boolean;
  /** Raw gloss / roughness hints. */
  finish?: 'glossy' | 'matte';
  /** A tone word that came without a colour ("dark" in "dark marble"). */
  tone?: string;
  /** Relative change to the current colour ("darker", "a bit lighter"). */
  adjust?: { dir: 'darker' | 'lighter' | 'brighter' | 'duller' | 'warmer' | 'cooler'; amount: number };
}

/** Everything the parser can produce. */
export type Command =
  | { op: 'paint'; ref: Ref; look: Look }
  | { op: 'move'; ref: Ref; direction?: 'left' | 'right' | 'forward' | 'back' | 'up' | 'down' | 'north' | 'south' | 'east' | 'west'; metres: number; to?: { rel: Relation; anchor: Ref }; toRoom?: Ref }
  | { op: 'rotate'; ref: Ref; degrees: number; absolute?: boolean }
  | { op: 'scale'; ref: Ref; factor: number; axis?: 'x' | 'y' | 'z' }
  | { op: 'resize'; ref: Ref; dimension: 'width' | 'height' | 'depth' | 'length' | 'radius' | 'size' | 'thickness'; value: number; relative?: boolean }
  | { op: 'shape'; ref: Ref; word: string }
  | { op: 'remove'; ref: Ref }
  | { op: 'add'; noun: string; count: number; adjectives: string[]; look?: Look; placement?: Placement; text: string }
  | { op: 'duplicate'; ref: Ref; count: number; placement?: Placement }
  | { op: 'rename'; ref: Ref; name: string }
  | { op: 'visibility'; ref: Ref; visible: boolean }
  | { op: 'light'; ref?: Ref; intensity?: number; factor?: number; color?: string; on?: boolean; warmth?: 'warmer' | 'cooler' }
  | { op: 'speed'; ref: Ref; factor?: number; value?: number; what?: string }
  | { op: 'behavior'; ref: Ref; behavior: 'spin' | 'bob'; enabled: boolean }
  | { op: 'door'; ref: Ref; open?: boolean; outwards?: boolean; hinge?: 'left' | 'right' }
  | { op: 'dialogue'; ref: Ref; text: string }
  | { op: 'env'; set: EnvIntent }
  | { op: 'game'; key: GameKey; value?: number; factor?: number; ref?: Ref; label?: string }
  | { op: 'density'; ref: Ref; factor: number; fallbackAdd?: { noun: string; count: number } }
  | { op: 'physics'; ref: Ref; what: 'bouncy' | 'heavy' | 'light' | 'static' | 'dynamic' | 'slippery' | 'sticky' }
  | { op: 'voxel'; what: 'replace-block' | 'structure-style'; from?: string; to?: string; ref?: Ref }
  | {
      op: 'feel';
      /** Events the clause is about ([] = the whole game). */
      events: FeelEventName[];
      tier?: 'off' | 'subtle' | 'normal' | 'punchy';
      /** Burst at those events ('none' removes it). */
      vfx?: VfxName | 'none';
      /** One cue field up, down, off or on. */
      tweak?: { knob: 'shake' | 'hitStop' | 'flash' | 'rumble' | 'text' | 'fovKick' | 'vignette'; mode: 'off' | 'less' | 'more' | 'on' };
      footsteps?: boolean;
      /** A continuous emitter on things ('none' removes it). */
      attach?: { ref: Ref; vfx: VfxName | 'none' };
    }
  | { op: 'repeat'; ref: Ref }
  | { op: 'undo' }
  | { op: 'redo' };

/** Feel events and particle presets (mirrors `@aether/core` FeelEvent / VfxPreset). */
export type FeelEventName = 'pickup' | 'hit' | 'damage' | 'death' | 'win' | 'checkpoint' | 'jump' | 'land' | 'explosion' | 'launch';
export type VfxName = 'sparks' | 'dust' | 'sparkle' | 'fire' | 'smoke' | 'magic' | 'explosion' | 'splash' | 'footstep' | 'muzzle' | 'embers' | 'confetti' | 'shockwave';

/** Environment changes in words. */
export interface EnvIntent {
  sky?: 'day' | 'dawn' | 'sunset' | 'night' | 'overcast' | 'space' | 'studio';
  timeOfDay?: number;
  /** Shift the time by this many hours ("a bit later"). */
  timeShift?: number;
  weather?: 'clear' | 'rain' | 'snow' | 'dust' | 'fireflies' | 'petals' | 'leaves';
  fog?: 'none' | 'more' | 'less' | 'on';
  sunFactor?: number;
  ambientFactor?: number;
  bloomFactor?: number;
  exposureFactor?: number;
  gravity?: 'zero' | 'low' | 'normal' | 'high';
  groundMaterial?: Look;
  groundNone?: boolean;
  /** Season-like theme: winter, autumn, spring. */
  season?: 'winter' | 'autumn' | 'spring' | 'summer';
}

/** Game-level numbers. */
export type GameKey = 'playerSpeed' | 'jumpHeight' | 'timeLimit' | 'targetScore' | 'cameraMode' | 'lives' | 'difficulty' | 'cameraFov';
