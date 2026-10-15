/**
 * The benchmark prompt suite: 80 plain-language requests across games,
 * physics scenes, voxel worlds, houses and scenes, written the way a person
 * would type them. The expectations (`mustHave`) were fixed from the user's
 * point of view before any run: what would someone expect to see in the world
 * they asked for? A third of the prompts are deliberately outside what the
 * offline planner knows (`stretch`): they exist to measure where it loses.
 */

/** What the request is for; decides which structural check applies. */
export type PromptKind = 'game' | 'physics' | 'voxel' | 'house' | 'scene';

/** One benchmark prompt. */
export interface BenchPrompt {
  id: string;
  kind: PromptKind;
  prompt: string;
  /**
   * Words a person expects to find in the result (matched, case-insensitive,
   * against entity ids, names, tags, generators and the environment).
   * Each entry is a regular expression source.
   */
  mustHave: readonly string[];
  /** Outside the offline planner's vocabulary on purpose. */
  stretch?: boolean;
  /** A bundled flagship answered by name (template recall, reported apart). */
  flagship?: boolean;
  /** Part of the CI quick subset. */
  quick?: boolean;
}

const p = (id: string, kind: PromptKind, prompt: string, mustHave: readonly string[], extra: Partial<BenchPrompt> = {}): BenchPrompt => ({ id, kind, prompt, mustHave, ...extra });

/** Every prompt, in report order. */
export const PROMPTS: readonly BenchPrompt[] = Object.freeze([
  // --- Games with a win condition (a bot plays them) -------------------------------------------------------------
  p('g01', 'game', 'a coin collecting game: grab 8 coins before time runs out', ['coin'], { quick: true }),
  p('g02', 'game', 'collect 20 coins in 60 seconds', ['coin']),
  p('g03', 'game', 'a treasure hunt with 12 gems in a forest', ['gem|coin|treasure', 'tree']),
  p('g04', 'game', 'a coin hunt on a sandy beach with 5 coins', ['coin', 'beach|sand|palm|water']),
  p('g05', 'game', 'collect 15 coins at night in a haunted village', ['coin', 'night|haunt|ghost|grave']),
  p('g06', 'game', 'scavenger hunt in a snowy valley, find 10 pickups', ['pickup|coin|gem', 'snow']),
  p('g07', 'game', 'a sky parkour course over lava', ['lava', 'platform'], { quick: true }),
  p('g08', 'game', 'an obstacle course with a goal portal at the top', ['platform', 'goal|portal']),
  p('g09', 'game', 'the floor is lava, jump between platforms to reach the exit', ['lava', 'platform']),
  p('g10', 'game', 'a jumping challenge climbing to a golden portal at sunset', ['portal|goal', 'platform']),
  p('g11', 'game', 'climbing course in the desert', ['platform', 'desert|sand|cactus']),
  p('g12', 'game', 'collect coins in a city before the timer ends', ['coin', 'building|house|city|car']),
  p('g13', 'game', 'collect 30 coins quickly', ['coin']),
  p('g14', 'game', 'a platformer: reach the portal', ['platform', 'portal|goal']),
  p('g15', 'game', 'gem hunt on a volcano island, 6 gems', ['gem|coin', 'volcano|lava']),
  p('g16', 'game', 'a coin game on a farm with a barn', ['coin', 'barn|farm']),
  // --- Physics scenes (verified without a player) ----------------------------------------------------------------
  p('p01', 'physics', 'a domino run that knocks over a bell', ['domino', 'bell'], { quick: true }),
  p('p02', 'physics', 'a long domino chain curving across the floor', ['domino']),
  p('p03', 'physics', 'a bowling alley with ten pins', ['pin', 'ball'], { quick: true }),
  p('p04', 'physics', 'bowling with a heavy ball against a crate pyramid', ['crate', 'ball']),
  p('p05', 'physics', 'a cannon that smashes a stack of crates', ['crate|block', 'ball|cannon']),
  p('p06', 'physics', 'a tower of blocks to knock down', ['block|crate']),
  p('p07', 'physics', 'a chain reaction machine with five stations', ['domino|ball|lever|ramp']),
  p('p08', 'physics', 'a marble run down a spiral ramp', ['marble|ball', 'ramp|spiral'], { stretch: true }),
  p('p09', 'physics', 'a pendulum swinging into a row of balls', ['pendulum|ball'], { stretch: true }),
  p('p10', 'physics', 'a seesaw with a heavy block on one end', ['seesaw|plank|lever'], { stretch: true }),
  p('p11', 'physics', 'a bouncing ball dropped on a trampoline', ['ball', 'trampoline|bounce'], { stretch: true }),
  p('p12', 'physics', 'a wrecking ball swinging into a brick wall', ['wreck|ball', 'brick|wall'], { stretch: true }),
  // --- Voxel / block worlds --------------------------------------------------------------------------------------
  p('v01', 'voxel', 'a minecraft-like survival world', ['voxel'], { quick: true }),
  p('v02', 'voxel', 'a village of block houses', ['voxel']),
  p('v03', 'voxel', 'pixel art heart in the sky over a blocky world', ['voxel']),
  p('v04', 'voxel', 'a blocky stone castle on a hill', ['voxel']),
  p('v05', 'voxel', 'a flat creative world to build in', ['voxel']),
  p('v06', 'voxel', 'a cube world with caves and a river', ['voxel']),
  p('v07', 'voxel', 'a voxel desert with a pyramid', ['voxel']),
  p('v08', 'voxel', 'a snowy block world with an igloo', ['voxel']),
  // --- Houses and interiors --------------------------------------------------------------------------------------
  p('h01', 'house', 'a modern two-bedroom apartment', ['bed', 'kitchen|sofa|table'], { quick: true }),
  p('h02', 'house', 'scandinavian living room with a fireplace', ['fireplace|fire', 'sofa|couch']),
  p('h03', 'house', 'a small cafe interior', ['table', 'chair|counter']),
  p('h04', 'house', 'a two-storey villa with a pool', ['pool|water', 'stair|villa|wall']),
  p('h05', 'house', 'an office floor with meeting rooms', ['desk|table', 'chair']),
  p('h06', 'house', 'a cozy one-bedroom flat with a balcony', ['bed', 'balcony|window']),
  p('h07', 'house', 'a three-bedroom family house with a garden', ['bed', 'garden|tree|grass']),
  p('h08', 'house', 'a studio apartment with an open kitchen', ['kitchen|counter', 'bed|sofa']),
  p('h09', 'house', 'a minimalist house with large windows', ['window|glass', 'wall']),
  p('h10', 'house', 'a lakeside cabin with a wooden deck', ['deck|wood|floor', 'cabin|wall'], { stretch: true }),
  // --- Scenes ----------------------------------------------------------------------------------------------------
  p('s01', 'scene', 'a cozy forest camp with a campfire and tents', ['fire', 'tent', 'tree'], { quick: true }),
  p('s02', 'scene', 'an asteroid field in space', ['asteroid|rock', 'space|star|night']),
  p('s03', 'scene', 'a haunted castle at night', ['castle|tower', 'night|haunt|ghost|grave']),
  p('s04', 'scene', 'a medieval village with a windmill', ['house', 'windmill']),
  p('s05', 'scene', 'a snowy mountain cabin with pine trees', ['snow', 'tree|pine']),
  p('s06', 'scene', 'a desert oasis with palm trees and a tent', ['palm|tree', 'desert|sand', 'tent|water']),
  p('s07', 'scene', 'a beach with umbrellas and a lighthouse', ['umbrella', 'lighthouse']),
  p('s08', 'scene', 'a farm with a barn, a tractor and cows', ['barn', 'tractor|cow']),
  p('s09', 'scene', 'a city street with traffic and pedestrians', ['car', 'person|pedestrian|people|walker']),
  p('s10', 'scene', 'a park with a fountain and benches', ['fountain', 'bench']),
  p('s11', 'scene', 'a volcano erupting over a village at night', ['volcano|lava', 'house|village', 'night']),
  p('s12', 'scene', 'a pagoda in a misty mountain valley', ['pagoda', 'fog|mist|mountain']),
  // --- Stretch: outside the offline planner's vocabulary --------------------------------------------------------
  p('x01', 'game', 'a racing game with three laps and checkpoints', ['track|road', 'checkpoint|lap'], { stretch: true }),
  p('x02', 'game', 'a submarine rescue game with oxygen management', ['submarine|sub', 'oxygen'], { stretch: true }),
  p('x03', 'game', 'a maze with a minotaur, find the exit', ['maze|wall', 'minotaur|exit'], { stretch: true }),
  p('x04', 'game', 'a tower defense game with waves of enemies', ['tower', 'enemy|wave'], { stretch: true }),
  p('x05', 'game', 'a platformer with moving enemies and three lives', ['platform', 'enemy', 'life|lives'], { stretch: true }),
  p('x06', 'scene', 'a steampunk airship dock with brass gears', ['airship', 'gear'], { stretch: true }),
  p('x07', 'scene', 'an underwater coral reef with a shipwreck', ['coral', 'shipwreck|ship'], { stretch: true }),
  p('x08', 'scene', 'a cyberpunk alley with neon signs and rain', ['neon', 'rain'], { stretch: true }),
  p('x09', 'scene', 'a medieval blacksmith workshop interior', ['anvil|forge', 'workshop|smith'], { stretch: true }),
  p('x10', 'scene', 'a space station corridor with airlock doors', ['airlock|door', 'corridor|station'], { stretch: true }),
  // --- Flagships named in the prompt (template recall; reported apart) -----------------------------------------
  p('f01', 'game', 'build the lantern isles game', ['lantern'], { flagship: true }),
  p('f02', 'game', 'build the kart canyon race', ['kart|canyon'], { flagship: true }),
  p('f03', 'physics', 'build the chain reaction machines puzzle', ['domino|machine|ball'], { flagship: true }),
  p('f04', 'scene', 'build the sakura river journey', ['sakura|blossom|river'], { flagship: true }),
  p('f05', 'house', 'build the skyline penthouse', ['penthouse|sofa|bed|window'], { flagship: true }),
  // --- A few more everyday asks, scored like the rest ---------------------------------------------------------------
  p('m01', 'scene', 'a playground with swings and a slide', ['swing|slide'], { stretch: true }),
  p('m02', 'scene', 'a campsite by a lake with a canoe', ['lake|water', 'canoe|boat|tent']),
  p('m03', 'scene', 'a snowman family in a snowy garden', ['snowman', 'snow'], { stretch: true }),
  p('m04', 'scene', 'a rainy forest with fireflies', ['tree', 'rain|firefl']),
  p('m05', 'physics', 'a stack of 40 wooden crates falling over', ['crate|block']),
  p('m06', 'scene', 'a lava cave with glowing crystals', ['lava|crystal', 'cave|rock'], { stretch: true }),
  p('m07', 'game', 'collect 6 coins in a space station', ['coin', 'space|star|station']),
  p('m08', 'scene', 'a medieval castle with a moat and drawbridge', ['castle', 'moat|water|bridge']),
]);

/** The CI quick subset. */
export const QUICK_PROMPTS: readonly BenchPrompt[] = PROMPTS.filter((q) => q.quick === true);
