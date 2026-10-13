/**
 * Build input of the offline generator library: the objects
 * `scripts/build-generator-library.ts` asks the coding model to write, with
 * the nouns that select each one. Not imported by the runtime (the shipped
 * catalog lives in `library-index.ts`).
 *
 * Keywords are whole words matched plural-insensitively; ambiguous everyday
 * words ("well", "slide", "tank") only appear inside a qualifying phrase.
 */
import type { GeneratorCategory } from './types';

/** One object the library should contain. */
export interface LibrarySpec {
  id: string;
  category: GeneratorCategory;
  /** What to build (sent to the coding model). */
  description: string;
  keywords: readonly string[];
  /** Parameters worth exposing. */
  paramsHint: string;
}

/** Objects written by the coding model (the four few-shot examples are added as-is). */
export const LIBRARY_SPECS: readonly LibrarySpec[] = [
  { id: 'pagoda', category: 'architecture', description: 'Multi-tier East Asian pagoda with upturned eaves on every tier, a stone base and a finial spire, about 12 m tall', keywords: ['pagoda'], paramsHint: 'tiers (int 3-7), roofColor, wallColor' },
  { id: 'piano', category: 'props', description: 'Grand piano with a lifted lid on a prop stick, black and white keys, three legs, pedals and a bench', keywords: ['piano', 'grand piano'], paramsHint: 'color, lidOpen (boolean)' },
  { id: 'traffic-cone', category: 'props', description: 'Orange traffic cone with a square black base and two white reflective bands, 0.7 m tall', keywords: ['traffic cone', 'road cone', 'safety cone'], paramsHint: 'color, height' },
  { id: 'hot-air-balloon', category: 'vehicles', description: 'Hot air balloon: a striped teardrop envelope, ropes and a wicker basket with a burner, hovering 1 m above its base point', keywords: ['hot air balloon', 'balloon'], paramsHint: 'color, stripeColor, height' },
  { id: 'sailing-ship', category: 'vehicles', description: 'Wooden sailing ship (galleon) with a curved hull, deck, two masts with square sails and a bowsprit, about 14 m long', keywords: ['sailing ship', 'ship', 'galleon', 'pirate ship', 'sailboat'], paramsHint: 'hullColor, sailColor, length' },
  { id: 'castle-gate', category: 'architecture', description: 'Castle gatehouse: two crenellated stone towers flanking an arched gate with a portcullis and a wall walk on top', keywords: ['castle gate', 'gatehouse', 'portcullis'], paramsHint: 'stoneColor, height' },
  { id: 'wishing-well', category: 'architecture', description: 'Stone wishing well: round stone wall with water inside, two wooden posts, a small pitched roof, a crank and a bucket', keywords: ['wishing well', 'stone well', 'water well', 'old well'], paramsHint: 'stoneColor, roofColor' },
  { id: 'cart', category: 'vehicles', description: 'Wooden hand cart with two spoked wheels, plank bed, side rails and two pull handles', keywords: ['cart', 'wagon', 'handcart', 'wheelbarrow'], paramsHint: 'woodColor, length' },
  { id: 'scarecrow', category: 'props', description: 'Scarecrow on a wooden cross post: burlap sack head with a straw hat, plaid shirt arms outstretched, straw tufts', keywords: ['scarecrow'], paramsHint: 'shirtColor, hatColor' },
  { id: 'saguaro-cactus', category: 'nature', description: 'Saguaro cactus: tall ribbed column with two or three upturned arms and small flowers on top', keywords: ['saguaro', 'saguaro cactus', 'desert cactus'], paramsHint: 'height, arms (int 0-4), color' },
  { id: 'palm-hut', category: 'architecture', description: 'Tropical beach hut on short stilts: bamboo walls, thatched palm-leaf conical roof, small ladder and doorway', keywords: ['palm hut', 'beach hut', 'tiki hut', 'thatched hut', 'bungalow'], paramsHint: 'roofColor, size' },
  { id: 'torii-gate', category: 'architecture', description: 'Japanese torii gate: two vermilion pillars on black bases, two crossbeams with the top one curved upward at the ends', keywords: ['torii', 'torii gate', 'shrine gate'], paramsHint: 'color, height' },
  { id: 'satellite-dish', category: 'props', description: 'Large radio telescope satellite dish: parabolic reflector on a tilt mount, receiver arm and a concrete base', keywords: ['satellite dish', 'radio telescope', 'antenna dish', 'dish antenna'], paramsHint: 'diameter, tilt (degrees), color' },
  { id: 'robot', category: 'props', description: 'Friendly retro robot standing upright: boxy torso with a control panel, round head with glowing eyes and an antenna, jointed arms and legs', keywords: ['robot', 'droid', 'android', 'mech'], paramsHint: 'color, eyeColor, height' },
  { id: 'dragon-statue', category: 'props', description: 'Stone dragon statue on a plinth: coiled body, raised head with horns, folded wings, tail wrapping around', keywords: ['dragon statue', 'dragon'], paramsHint: 'color, height' },
  { id: 'skyscraper', category: 'architecture', description: 'Modern glass skyscraper with setbacks, window grid bands, a lobby base and a rooftop antenna, about 60 m tall', keywords: ['skyscraper', 'office tower', 'high rise', 'highrise'], paramsHint: 'height, floors (int), glassColor, lights (boolean)' },
  { id: 'bus', category: 'vehicles', description: 'City bus: long boxy body with rounded corners, window strip, doors, six wheels with hubs, headlights and a route sign', keywords: ['bus', 'city bus', 'school bus'], paramsHint: 'color, length' },
  { id: 'train-engine', category: 'vehicles', description: 'Old steam locomotive on a short rail segment: boiler with smokestack and dome, cab, cowcatcher, six driving wheels with rods', keywords: ['train', 'train engine', 'locomotive', 'steam engine'], paramsHint: 'color, trimColor' },
  { id: 'airplane', category: 'vehicles', description: 'Propeller airplane parked on its landing gear: fuselage, main wings, tail fin and stabilizers, cockpit canopy and a nose propeller', keywords: ['airplane', 'aeroplane', 'plane', 'aircraft', 'biplane'], paramsHint: 'color, wingspan' },
  { id: 'helicopter', category: 'vehicles', description: 'Helicopter on skids: rounded cabin with windows, tail boom with tail rotor, main rotor with four blades', keywords: ['helicopter', 'chopper'], paramsHint: 'color, length' },
  { id: 'toy-tank', category: 'vehicles', description: 'Chunky toy tank: rounded hull on two tread blocks with road wheels, turret with a short barrel, bright toy colors', keywords: ['toy tank', 'army tank'], paramsHint: 'color, trackColor' },
  { id: 'swing-set', category: 'props', description: 'Playground swing set: A-frame metal posts, top bar, two swings hanging on chains with seats', keywords: ['swing set', 'playground swing'], paramsHint: 'color, seats (int 1-4)' },
  { id: 'playground-slide', category: 'props', description: 'Playground slide: ladder with rails up to a small platform and a long curved chute down to the ground', keywords: ['playground slide', 'kids slide', 'water slide'], paramsHint: 'color, height' },
  { id: 'picnic-table', category: 'props', description: 'Wooden picnic table with two attached benches and A-frame legs', keywords: ['picnic table', 'picnic bench'], paramsHint: 'woodColor, length' },
  { id: 'beach-umbrella', category: 'props', description: 'Beach umbrella with a striped canopy on a slightly tilted pole planted in the sand, with a beach towel underneath', keywords: ['beach umbrella', 'parasol', 'sun umbrella', 'umbrella'], paramsHint: 'color, stripeColor, tilt' },
  { id: 'surfboard', category: 'props', description: 'Surfboard standing upright planted in sand, with a pointed nose, a fin and a center stripe', keywords: ['surfboard', 'surf board'], paramsHint: 'color, stripeColor, length' },
  { id: 'coral', category: 'nature', description: 'Branching coral cluster: several knobbly branching arms and a few fan shapes on a rock base, vivid colors', keywords: ['coral', 'coral reef'], paramsHint: 'color, size, branches (int)' },
  { id: 'seaweed', category: 'nature', description: 'Clump of tall wavy kelp ribbons with small bladders, rooted on a rock', keywords: ['seaweed', 'kelp', 'sea grass'], paramsHint: 'color, height, strands (int)' },
  { id: 'jellyfish', category: 'nature', description: 'Translucent glowing jellyfish: domed bell and long wavy tentacles, floating with its lowest tentacle tips at y = 0', keywords: ['jellyfish', 'jelly fish'], paramsHint: 'color, size' },
  { id: 'mushroom-house', category: 'architecture', description: 'Fairy-tale mushroom house: thick stalk with a round door and windows, huge spotted red cap as the roof, a tiny chimney', keywords: ['mushroom house', 'toadstool house', 'fairy house', 'gnome house'], paramsHint: 'capColor, height' },
  { id: 'wizard-tower', category: 'architecture', description: 'Crooked wizard tower: stone round tower that leans slightly, small windows, a balcony, a tall pointed starry blue roof with a glowing orb on top', keywords: ['wizard tower', 'mage tower', 'magic tower', 'sorcerer tower'], paramsHint: 'roofColor, height' },
  { id: 'cave-entrance', category: 'nature', description: 'Rocky cave entrance: a rough rock mound with a dark arched opening framed by glowing crystals', keywords: ['cave', 'cave entrance', 'crystal cave', 'grotto'], paramsHint: 'rockColor, crystalColor, size' },
  { id: 'volcano', category: 'terrain', description: 'Volcano: a wide rocky cone with a crater and glowing lava rivers running down its flanks, about 30 m tall', keywords: ['volcano', 'volcanic mountain'], paramsHint: 'height, lavaColor' },
  { id: 'waterfall', category: 'terrain', description: 'Waterfall: a stepped rock cliff with a wide translucent water sheet falling into a round pool with foam rocks', keywords: ['waterfall', 'cascade'], paramsHint: 'height, waterColor' },
  { id: 'snowman-deluxe', category: 'props', description: 'Snowman of three snowballs with a carrot nose, coal eyes and buttons, stick arms, a top hat and a knitted scarf', keywords: ['snowman', 'snow man'], paramsHint: 'scarfColor, height' },
  { id: 'igloo', category: 'architecture', description: 'Igloo: dome of snow blocks with visible block seams and a tunnel entrance', keywords: ['igloo'], paramsHint: 'size' },
  { id: 'ferris-wheel', category: 'architecture', description: 'Ferris wheel: A-frame supports, spoked wheel with rim lights and eight hanging gondolas', keywords: ['ferris wheel', 'big wheel', 'observation wheel'], paramsHint: 'diameter, color, gondolas (int 6-16)' },
  { id: 'wind-turbine', category: 'architecture', description: 'Modern wind turbine: tall tapered white tower, nacelle and three long slim blades', keywords: ['wind turbine', 'turbine'], paramsHint: 'height' },
  { id: 'mailbox', category: 'props', description: 'Rural mailbox on a wooden post with a rounded top and a red flag', keywords: ['mailbox', 'letterbox', 'post box'], paramsHint: 'color' },
  { id: 'totem-pole', category: 'props', description: 'Carved totem pole: stacked painted animal faces with beaks and wings near the top', keywords: ['totem', 'totem pole'], paramsHint: 'height' },
] as const;
