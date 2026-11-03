/**
 * Human characters in the World IR (additive, optional `entity.character` and
 * `player.character`).
 *
 * A character is how a person LOOKS and carries themselves; what they DO is
 * `entity.npc` (or the player controller). Everything here is plain JSON so
 * a prompt can address it: "a tired old shopkeeper" is
 * `{ age: "old", mood: "tired" }`, "a guard in red" is `{ wardrobe: "guard",
 * top: "#b3262e" }`, "a woman in a green coat" is
 * `{ gender: "female", top: "#2f7d4a" }`.
 *
 * Nothing here changes physics or behaviour: the capsule collider under the
 * entity stays the truth, the character is a visual (and audible) skin whose
 * animation is a pure function of what the simulation already published.
 * The cast, the variant resolution and the animation set live in
 * `@aether/assets` (`characters/`), the renderer in `@aether/render`.
 */
import './zod-config';
import { z } from 'zod';

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'color must be #rrggbb');
/** Lowercase slug (cast ids). */
const Slug = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/, 'use a lowercase slug');

/** How the person carries themselves; picks idle, walk and talk styles. */
export const CharacterMood = z.enum(['neutral', 'tired', 'cheerful', 'angry', 'nervous', 'calm', 'hurt', 'drunk']);
export type CharacterMood = z.infer<typeof CharacterMood>;

/** What the person holds in a hand (a prop attached to the right hand bone). */
export const CharacterHold = z.enum(['none', 'torch', 'lantern', 'sword', 'spear', 'axe', 'staff', 'bag', 'crate', 'book', 'cup', 'paddle', 'backpack', 'umbrella', 'rifle']);
export type CharacterHold = z.infer<typeof CharacterHold>;

/** Which kind of wardrobe the planner picks a body for. */
export const CharacterWardrobe = z.enum(['casual', 'guard', 'merchant', 'villager', 'bandit', 'traveller', 'elder', 'worker', 'formal']);
export type CharacterWardrobe = z.infer<typeof CharacterWardrobe>;

export const CharacterSpec = z.object({
  /** A cast member id (see `CAST` in `@aether/assets`), e.g. "marcus". Omit to choose from the fields below. */
  body: Slug.optional(),
  gender: z.enum(['male', 'female']).optional(),
  age: z.enum(['young', 'adult', 'old']).optional(),
  wardrobe: CharacterWardrobe.optional(),
  /** Recolour the top (jacket, shirt, coat) and the bottom (trousers, skirt) of the outfit, and the hair. */
  top: Hex.optional(),
  bottom: Hex.optional(),
  hair: Hex.optional(),
  /** Body scale around the feet (0.85 to 1.15; the cast stands 1.65 to 1.85 m). */
  scale: z.number().min(0.85).max(1.15).default(1),
  mood: CharacterMood.optional(),
  hold: CharacterHold.optional(),
  /** Additive: `sit` shows the person seated (a paddler in a canoe, a guest on a sofa); the collider and the entity's position are unchanged. Default `stand`. */
  pose: z.enum(['stand', 'sit']).optional(),
  /** Free-form words the resolver may use ("tired", "old") when the fields above are not set. */
  words: z.array(z.string().min(1).max(24)).max(6).optional(),
});
export type CharacterSpec = z.infer<typeof CharacterSpec>;
export type CharacterSpecInput = z.input<typeof CharacterSpec>;
