/**
 * Stand-in lint: finds people, animals and vehicles that a world shows as a
 * bare primitive (capsule, box, sphere) or as a voxel mini-figure next to
 * realistic content. A person must carry `entity.character` (a rigged cast
 * member), an animal must be a modelled, animated library creature, a vehicle
 * must be a modelled body with wheels. Block worlds (`world.voxel`) are exempt:
 * their avatars belong to that style.
 *
 * Pure and fast (one pass, no catalog access): the voxel figure ids of the
 * library are listed here because the lint must run in the planner, the
 * verifier and the tests without loading the asset catalog.
 */
import type { Entity, WorldDoc } from './schema';

/** What kind of being the entity is meant to be. */
export type StandInKind = 'person' | 'animal' | 'vehicle';

/** One finding: an entity that is a stand-in for a person, animal or vehicle. */
export interface StandIn {
  /** Entity id. */
  id: string;
  kind: StandInKind;
  /** Why it was flagged (short, actionable; fed back to the planner). */
  reason: string;
}

/** Library ids of the cube-headed voxel mini-figures (Kenney Mini Characters, Mini Market clerk). */
export const VOXEL_PERSON_ASSET_IDS: ReadonlySet<string> = new Set([
  'man', 'man-b', 'man-c', 'man-d', 'man-e', 'man-f',
  'woman', 'woman-b', 'woman-c', 'woman-d', 'woman-e', 'woman-f',
  'shopkeeper',
]);

/**
 * Library ids of the cube-shaped stylised pets (Kenney Cube Pets) that read as toys beside realistic content. The ones
 * that now have modelled, skinned replacements (cat, deer, fish, parrot) left this list when the replacement shipped.
 */
export const CUBE_PET_ASSET_IDS: ReadonlySet<string> = new Set([
  'beaver', 'bee', 'boar', 'bunny', 'chick', 'crab', 'elephant', 'giraffe', 'koala', 'lion', 'monkey', 'panda', 'penguin', 'polar-bear', 'tiger',
]);

const PERSON_WORDS: ReadonlySet<string> = new Set([
  'villager', 'villagers', 'guard', 'guards', 'npc', 'pedestrian', 'pedestrians', 'monk', 'monks', 'ghost', 'ghosts', 'enemy', 'enemies', 'shopkeeper', 'citizen', 'citizens',
  'person', 'people', 'human', 'kid', 'child', 'zombie', 'soldier', 'bandit', 'knight', 'merchant', 'traveller', 'traveler', 'spectator', 'spectators', 'crowd', 'resident',
  'customer', 'waiter', 'worker', 'hiker', 'guide', 'driver', 'player',
]);
const ANIMAL_WORDS: ReadonlySet<string> = new Set([
  'wolf', 'wolves', 'dog', 'dogs', 'deer', 'bird', 'birds', 'cat', 'cats', 'horse', 'horses', 'cow', 'cows', 'sheep', 'fox', 'bear', 'rabbit', 'pig', 'pigs', 'llama', 'zebra', 'animal', 'animals',
  'stag', 'doe', 'fawn', 'duck', 'ducks', 'crow', 'crows', 'gull', 'gulls', 'seagull', 'seagulls', 'hawk', 'hawks', 'eagle', 'parrot', 'sparrow', 'robin', 'owl', 'fish', 'fishes', 'koi', 'trout', 'salmon', 'carp', 'butterfly', 'butterflies', 'bee', 'bees', 'dragonfly', 'insect',
]);
const VEHICLE_WORDS: ReadonlySet<string> = new Set(['car', 'cars', 'kart', 'karts', 'truck', 'bus', 'van', 'taxi', 'vehicle', 'rival', 'jeep', 'tractor']);

/** Species that fly or swim: shown as a ball, cone or box of at most {@link SMALL_BEING} metres they are toys, not animals. */
const SMALL_SPECIES: ReadonlySet<string> = new Set([
  'bird', 'birds', 'duck', 'ducks', 'crow', 'crows', 'gull', 'gulls', 'seagull', 'seagulls', 'hawk', 'hawks', 'eagle', 'parrot', 'sparrow', 'robin', 'owl', 'fish', 'fishes', 'koi', 'trout', 'salmon', 'carp', 'butterfly', 'butterflies', 'bee', 'bees', 'dragonfly',
]);
/** Words that make the name a thing about the animal rather than the animal (a bird house, a fish tank). */
const NOT_A_BEING: ReadonlySet<string> = new Set(['house', 'houses', 'feeder', 'bath', 'tank', 'cage', 'nest', 'statue', 'sign', 'stall', 'market', 'pond', 'table', 'food', 'net', 'rod', 'bowl', 'box', 'shop', 'tower', 'fountain', 'mobile', 'lamp', 'light', 'mosaic', 'painting', 'mural', 'ring', 'door', 'doors', 'bay', 'garage', 'airlock', 'gate', 'hangar', 'shed', 'ramp', 'park', 'parking']);
/** Largest extent (m) of a flying or swimming stand-in. */
const SMALL_BEING = 1.6;

/** Primitive shapes that are only ever a collider proxy for a being. */
const PROXY_PRIMITIVES: ReadonlySet<string> = new Set(['capsule', 'box', 'sphere', 'cylinder', 'cone']);

function words(e: Entity): string[] {
  const text = `${e.id} ${e.name} ${e.tags.join(' ')}`.toLowerCase();
  return text.split(/[^a-z]+/).filter((w) => w.length > 0);
}

function kindOf(e: Entity): StandInKind | null {
  const ws = words(e);
  if (e.npc || e.behaviors.some((b) => b.type === 'npc')) {
    // An NPC that is an animal archetype is an animal; the rest are people.
    const arch = e.npc?.archetype;
    if (arch === 'predator' || arch === 'prey' || ws.some((w) => ANIMAL_WORDS.has(w))) return 'animal';
    return 'person';
  }
  // "Vehicle bay door", "car park": a part of a building named after vehicles is not one.
  if (e.behaviors.some((b) => b.type === 'vehicle') || (ws.some((w) => VEHICLE_WORDS.has(w)) && !ws.some((w) => NOT_A_BEING.has(w)))) return 'vehicle';
  if (ws.some((w) => PERSON_WORDS.has(w) && w !== 'player')) return 'person';
  if (ws.some((w) => ANIMAL_WORDS.has(w))) return 'animal';
  return null;
}

/** True when a primitive has the proportions of a standing body or a vehicle hull (not a pole, a ball or a slab). */
function isBodyProxy(e: Entity, kind: StandInKind): boolean {
  if (e.shape.kind !== 'primitive') return false;
  if (!PROXY_PRIMITIVES.has(e.shape.primitive)) return false;
  const [w, h, d] = e.shape.size;
  const small = kind === 'animal' && words(e).some((x) => SMALL_SPECIES.has(x));
  if (Math.max(w, h, d) < (small ? 0.1 : 0.3) || Math.max(w, h, d) > 8) return false;
  // A character-like entity (npc) is a stand-in in any proxy shape; by name alone only a capsule (a standing body) or,
  // for a vehicle, a box counts: a glowing sphere called "neon-cat" is a beacon, a box called "fan" a ceiling fan.
  if (e.npc || e.behaviors.some((b) => b.type === 'npc' || b.type === 'vehicle')) return true;
  if (kind === 'animal' && Math.max(w, h, d) <= SMALL_BEING) {
    const ws = words(e);
    if (ws.some((x) => SMALL_SPECIES.has(x)) && !ws.some((x) => NOT_A_BEING.has(x))) return true;
  }
  return kind === 'vehicle' ? e.shape.primitive === 'box' : e.shape.primitive === 'capsule';
}

/**
 * Find every stand-in character, animal or vehicle of `world`. Entities with a
 * `character`, modelled creatures and vehicles, and the parts of a being (children
 * of a flagged entity) are never reported.
 */
export function findStandIns(world: WorldDoc): StandIn[] {
  if (world.voxel) return [];
  const out: StandIn[] = [];
  for (const e of Object.values(world.entities)) {
    if (e.template || !e.visible || e.character) continue;
    // Parts of a being (a head sphere, a torch) are reported through their parent.
    let parentIsBeing = false;
    for (let p = e.parent ? world.entities[e.parent] : undefined, hops = 0; p && hops < 8; p = p.parent ? world.entities[p.parent] : undefined, hops++) {
      if (kindOf(p) !== null) parentIsBeing = true;
    }
    if (parentIsBeing) continue;
    const kind = kindOf(e) ?? (e.shape.kind === 'asset' && VOXEL_PERSON_ASSET_IDS.has(e.shape.id) ? 'person' : null);
    if (!kind) continue;
    const s = e.shape;
    if (s.kind === 'asset') {
      if (kind === 'person' && VOXEL_PERSON_ASSET_IDS.has(s.id)) out.push({ id: e.id, kind, reason: `"${s.id}" is a block mini-figure; give the entity a "character" (a rigged person) instead` });
      else if (kind === 'animal' && CUBE_PET_ASSET_IDS.has(s.id)) out.push({ id: e.id, kind, reason: `"${s.id}" is a cube toy; use a modelled animal (deer, cat, dog, fox, wolf, horse, cow, sheep, pig, llama, zebra, bird, hawk, seagull, crow, duck, parrot, fish, koi, butterfly)` });
      continue;
    }
    if (s.kind !== 'primitive') continue;
    if (!isBodyProxy(e, kind)) continue;
    if (kind === 'person') out.push({ id: e.id, kind, reason: 'a bare primitive stands in for a person; give the entity a "character"' });
    else if (kind === 'animal') out.push({ id: e.id, kind, reason: 'a bare primitive stands in for an animal; use a modelled, animated library creature (deer, cat, bird, hawk, seagull, crow, duck, parrot, fish, koi, butterfly, dog, fox, wolf, horse, cow, sheep, pig)' });
    else if (kind === 'vehicle') out.push({ id: e.id, kind, reason: 'a bare primitive stands in for a vehicle; use a modelled vehicle with wheels' });
  }
  return out;
}
