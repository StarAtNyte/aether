/**
 * 100+ small-edit cases over the bundled default projects (arch, voxel,
 * game, scene). Each names the entities a minimal correct edit changes; the
 * eval measures target accuracy, over-edit rate and latency.
 */
import type { EditCase } from './types';

const A = 'apartment-l0-';
const P = 'penthouse-l0-';
const L = 'home-l0-room-';

const arch: EditCase[] = [
  // --- colours and materials of furniture ---------------------------------
  { id: 'a-sofa-green-velvet', world: 'apartment', prompt: 'make the sofa dark green velvet', expect: { t: [`${A}living-f0`], p: ['color', 'upholstery'] } },
  { id: 'a-sofa-legs-black', world: 'apartment', prompt: 'make the sofa legs black', expect: { t: [`${A}living-f0`], p: ['legs'] } },
  { id: 'a-sofa-couch-blue', world: 'apartment', prompt: 'paint the couch navy blue', expect: { t: [`${A}living-f0`], p: ['color'] } },
  { id: 'a-armchair-leather', world: 'apartment', prompt: 'change the armchair to brown leather', expect: { t: [`${A}living-f1`], p: ['color', 'upholstery'] } },
  { id: 'a-sofa-darker', world: 'apartment', prompt: 'make the sofa a bit darker', expect: { t: [`${A}living-f0`], p: ['color'] } },
  { id: 'a-rug-ambiguous', world: 'apartment', prompt: 'make the rug red', expect: { ask: 3 } },
  { id: 'a-rug-hall', world: 'apartment', prompt: 'make the rug in the hallway navy blue', expect: { t: [`${A}hall-f2`], p: ['color'] } },
  { id: 'a-curtains-living', world: 'apartment', prompt: 'make the curtains in the living room beige', expect: { t: [`${A}living-f4`, `${A}living-f5`, `${A}living-f6`, `${A}living-f7`], p: ['color'] } },
  { id: 'a-bed-bedroom2', world: 'apartment', prompt: 'make the bed in bedroom 2 grey', expect: { t: [`${A}bed2-f0`] } },
  { id: 'a-bookshelf-white', world: 'apartment', prompt: 'make the bookshelf white', expect: { t: [`${A}living-f3`] } },
  { id: 'a-island-concrete', world: 'apartment', prompt: 'make the kitchen island concrete', expect: { t: [`${A}kitchen-f1`], p: ['worktop'] } },
  { id: 'a-sideboard-already', world: 'apartment', prompt: 'make the hallway console walnut', expect: { decline: true } },
  { id: 'a-selected-red', world: 'apartment', prompt: 'make this red', selection: [`${A}living-f1`], expect: { t: [`${A}living-f1`], p: ['color'] } },
  { id: 'a-selected-it-green', world: 'apartment', prompt: 'make it forest green', selection: [`${A}living-f0`], expect: { t: [`${A}living-f0`], p: ['color'] } },
  // --- walls, floors ----------------------------------------------------------
  { id: 'a-wallpaper-back', world: 'apartment', prompt: "wallpaper on the main bedroom's back wall", expect: { wall: { room: `${A}master`, side: 'back' } } },
  { id: 'a-wallpaper-ask-room', world: 'apartment', prompt: "put wallpaper on the bedroom's back wall", expect: { ask: 2 } },
  { id: 'a-kitchen-walls-white', world: 'apartment', prompt: 'paint the kitchen walls white', expect: { wall: { room: `${A}kitchen`, all: true } } },
  { id: 'a-bed2-walls-grey', world: 'apartment', prompt: 'make the walls in bedroom 2 light grey', expect: { wall: { room: `${A}bed2`, all: true } } },
  { id: 'a-living-left-wall', world: 'apartment', prompt: 'paint the left wall of the living room terracotta', expect: { wall: { room: `${A}living`, side: 'left' } } },
  { id: 'a-kitchen-floor-oak', world: 'apartment', prompt: 'change the kitchen floor to oak', expect: { t: [`${A}kitchen`], p: ['finish'] } },
  { id: 'a-bath-tiles', world: 'apartment', prompt: 'swap the bathroom tiles to white subway tiles', expect: { t: [`${A}bath`], p: ['subway'], allow: [/^apartment-l0-w\d+$/] } },
  { id: 'a-front-door-inwards', world: 'apartment', prompt: 'make the front door open inwards', expect: { t: [`${A}d0-leaf`], p: ['swingAngle'] } },
  { id: 'a-door-ambiguous', world: 'apartment', prompt: 'make the door open outwards', expect: { ask: 3 } },
  { id: 'a-living-floor-herringbone', world: 'apartment', prompt: 'make the living room floor herringbone wood', expect: { t: [`${A}living`], p: ['herringbone'] } },
  // --- geometry ----------------------------------------------------------------
  { id: 'a-sofa-left', world: 'apartment', prompt: 'move the sofa a bit to the left', expect: { t: [`${A}living-f0`], p: ['transform.position'] } },
  { id: 'a-bookshelf-right', world: 'apartment', prompt: 'move the bookshelf 1 meter to the right', expect: { t: [`${A}living-f3`], p: ['transform.position'] } },
  { id: 'a-armchair-rotate', world: 'apartment', prompt: 'rotate the armchair 90 degrees', expect: { t: [`${A}living-f1`], p: ['transform.rotation'] } },
  { id: 'a-sofa-wider', world: 'apartment', prompt: 'make the sofa wider', expect: { t: [`${A}living-f0`], p: ['width|scale'] } },
  { id: 'a-sofa-3m', world: 'apartment', prompt: 'make the sofa 3 meters wide', expect: { t: [`${A}living-f0`], p: ['width'] } },
  { id: 'a-armchair-bigger', world: 'apartment', prompt: 'make the armchair bigger', expect: { t: [`${A}living-f1`], p: ['width|scale|size'] } },
  // --- add / remove -------------------------------------------------------------
  { id: 'a-remove-sofa', world: 'apartment', prompt: 'remove the sofa', expect: { removed: [`${A}living-f0`], allow: ['apartment'] } },
  { id: 'a-remove-bookshelf', world: 'apartment', prompt: 'get rid of the bookshelf', expect: { removed: [`${A}living-f3`], allow: ['apartment'] } },
  { id: 'a-add-plant', world: 'apartment', prompt: 'add a plant next to the sofa', expect: { added: [1, 3], allow: ['apartment', /^apartment-l0-living/] } },
  { id: 'a-add-rug-living', world: 'apartment', prompt: 'add a rug in the living room', expect: { added: [1, 3], allow: ['apartment', /^apartment-l0-living/] } },
  // --- lights -------------------------------------------------------------------
  { id: 'a-hall-brighter', world: 'apartment', prompt: 'brighter lights in the hallway', expect: { t: [`${A}hall-f3`], p: ['light.intensity'] } },
  { id: 'a-kitchen-dim', world: 'apartment', prompt: 'dim the pendant lights in the kitchen', expect: { t: [`${A}kitchen-f6`], p: ['light.intensity'] } },
  { id: 'a-bath-off', world: 'apartment', prompt: 'turn off the lights in the bathroom', expect: { t: [`${A}bath-f5`], p: ['light.intensity'] } },
  { id: 'a-hall-warmer', world: 'apartment', prompt: 'make the hallway light warmer', expect: { t: [`${A}hall-f3`], p: ['light.color'] } },
  // --- world ---------------------------------------------------------------------
  { id: 'a-night', world: 'apartment', prompt: 'make it night', expect: { env: ['sky'] } },
  { id: 'a-six-pm', world: 'apartment', prompt: 'set the time to 6pm', expect: { env: ['timeOfDay'] } },
  { id: 'a-rename', world: 'apartment', prompt: 'rename the sofa to Big Comfy Couch', expect: { t: [`${A}living-f0`], p: ['^name'] } },
  // --- conversation ---------------------------------------------------------------
  { id: 'a-same-other-bedroom', world: 'apartment', prior: ['paint the main bedroom walls sage green'], prompt: 'do the same for the other bedroom', expect: { wall: { room: `${A}bed2`, all: true } } },
  { id: 'a-that-darker', world: 'apartment', prior: ['make the sofa dark green velvet'], prompt: 'make that a bit lighter', expect: { t: [`${A}living-f0`], p: ['color'] } },
  { id: 'a-undo', world: 'apartment', prior: ['make the sofa red'], prompt: 'undo that', expect: { history: 'undo' } },
];

const penthouse: EditCase[] = [
  { id: 'p-second-chair', world: 'penthouse', prompt: 'remove the second chair in the dining room', expect: { removed: [`${P}dining-f2`], allow: ['penthouse'] } },
  { id: 'p-chairs-black', world: 'penthouse', prompt: 'make the dining chairs black', expect: { t: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `${P}dining-f${n}`), p: ['color'] } },
  { id: 'p-lamp-ambiguous', world: 'penthouse', prompt: 'make the lamp blue', expect: { ask: 2 } },
  { id: 'p-lamp-left', world: 'penthouse', prompt: 'move the table lamp in the living room a bit to the left', expect: { t: [`${P}living-f7`], p: ['transform.position'] } },
  { id: 'p-rug-under-table', world: 'penthouse', prompt: 'add a rug under the coffee table', expect: { added: [1, 2], allow: ['penthouse', /^penthouse-l0-living/] } },
  { id: 'p-table-round', world: 'penthouse', prompt: 'make the dining table in the dining room round', expect: { t: [`${P}dining-f0`], p: ['shape'] } },
  { id: 'p-table-ambiguous', world: 'penthouse', prompt: 'make the dining table round', expect: { ask: 2 } },
  { id: 'p-sofa-velvet', world: 'penthouse', prompt: 'make the sofa burgundy velvet', expect: { t: [`${P}living-f0`], p: ['color', 'upholstery'] } },
  { id: 'p-tv-hide', world: 'penthouse', prompt: 'hide the tv', expect: { t: [`${P}living-f6`], p: ['visible'] } },
  { id: 'p-guest-wall', world: 'penthouse', prompt: "wallpaper on the guest bedroom's back wall", expect: { wall: { room: `${P}guest`, side: 'back' } } },
  { id: 'p-night', world: 'penthouse', prompt: 'turn the sky to night', expect: { env: ['sky'] } },
  { id: 'p-art-frame-brass', world: 'penthouse', prompt: 'make the art frame in the dining room brass', expect: { t: [`${P}dining-f11`], p: ['frame'] } },
  { id: 'p-sideboard-oak', world: 'penthouse', prompt: 'make the sideboard in the dining room oak', expect: { t: [`${P}dining-f10`], p: ['body'] } },
  { id: 'p-bath-floor-marble', world: 'penthouse', prompt: 'make the bathroom floor marble', expect: { t: [`${P}bath`], p: ['marble'] } },
];

const living: EditCase[] = [
  { id: 'l-painting-fireplace', world: 'living', prompt: 'add a painting above the fireplace', expect: { added: [1, 2], allow: [/^home-l0-room/, 'home'] } },
  { id: 'l-fireplace-white', world: 'living', prompt: 'paint the fireplace white', expect: { t: [`${L}f0`] } },
  { id: 'l-armchair-second', world: 'living', prompt: 'make the second armchair mustard yellow', expect: { t: [`${L}f5`], p: ['color'] } },
  { id: 'l-armchairs-both', world: 'living', prompt: 'make both armchairs grey', expect: { t: [`${L}f4`, `${L}f5`], p: ['color'] } },
  { id: 'l-floor-lamp-off', world: 'living', prompt: 'turn off the floor lamp', expect: { decline: true } },
  { id: 'l-rug-left', world: 'living', prompt: 'move the rug a little to the left', expect: { t: [`${L}f2`], p: ['transform.position'] } },
];

const games: EditCase[] = [
  // lantern isles
  { id: 'g-mira-rename', world: 'lantern', prompt: 'rename Mira to Wren', expect: { t: ['guide-1'], p: ['name'] } },
  { id: 'g-mira-says', world: 'lantern', prompt: 'make Mira say welcome to my island', expect: { t: ['guide-1'], p: ['lines'] } },
  { id: 'g-lanterns-spin', world: 'lantern', prompt: 'make the lanterns spin faster', expect: { t: Array.from({ length: 12 }, (_, i) => `paper-lantern-${i + 1}`), p: ['speed'] } },
  { id: 'g-lifts-slower', world: 'lantern', prompt: 'make the rune lifts slower', expect: { t: ['rune-lift-1', 'rune-lift-2', 'rune-lift-3'], p: ['speed'] } },
  { id: 'g-cottage-red', world: 'lantern', prompt: 'make the cottage red', expect: { t: ['cottage-1'], p: ['color'] } },
  { id: 'g-campfire-bigger', world: 'lantern', prompt: 'make the campfire bigger', expect: { t: ['campfire-1'] } },
  { id: 'g-lantern-post-remove', world: 'lantern', prompt: 'remove the first lantern post', expect: { removed: ['lantern-post-1'] } },
  { id: 'g-player-faster', world: 'lantern', prompt: 'make the player faster', expect: { player: ['moveSpeed'] } },
  { id: 'g-jump-higher', world: 'lantern', prompt: 'let me jump higher', expect: { player: ['jumpSpeed'] } },
  { id: 'g-sky-night', world: 'lantern', prompt: 'make it night', expect: { env: ['sky'] } },
  { id: 'g-need-8', world: 'lantern', prompt: 'collect 8 lanterns to win', expect: { game: ['rule', 'hud'] } },
  { id: 'g-bridge-move', world: 'lantern', prompt: 'move the first rope bridge 2 meters north', expect: { t: ['bridge-1'], p: ['transform.position'] } },
  { id: 'g-fog', world: 'lantern', prompt: 'add some fog', expect: { env: ['fog'] } },
  { id: 'g-rain', world: 'lantern', prompt: 'make it rain', expect: { env: ['weather'] } },
  // coin island
  { id: 'c-coins-bigger', world: 'coins', prompt: 'make the coins bigger', expect: { t: Array.from({ length: 10 }, (_, i) => `coin-${i + 1}`), p: ['scale'] } },
  { id: 'c-coins-green', world: 'coins', prompt: 'make the coins green', expect: { t: Array.from({ length: 10 }, (_, i) => `coin-${i + 1}`), p: ['color'] } },
  { id: 'c-time-90', world: 'coins', prompt: 'give me 90 seconds', expect: { game: ['state', 'test'] } },
  { id: 'c-more-time', world: 'coins', prompt: 'give me more time', expect: { game: ['state'] } },
  { id: 'c-goal-15', world: 'coins', prompt: 'collect 15 coins to win', expect: { game: ['rule', 'hud'], added: [5, 5] } },
  { id: 'c-coin-spin-slower', world: 'coins', prompt: 'make the coins spin slower', expect: { t: Array.from({ length: 10 }, (_, i) => `coin-${i + 1}`), p: ['speed'] } },
  { id: 'c-beachball-blue', world: 'coins', prompt: 'make the beach ball blue', expect: { t: ['beach-ball-1'], p: ['color'] } },
  { id: 'c-boat-faster', world: 'coins', prompt: 'make the sailboat bob faster', expect: { t: ['boat-1'], p: ['period'] } },
  { id: 'c-remove-rocks', world: 'coins', prompt: 'remove all the rocks', expect: { removed: ['rock-1', 'rock-2', 'rock-3', 'rock-4', 'rock-5'] } },
  { id: 'c-palms-taller', world: 'coins', prompt: 'make the palm trees taller', expect: { t: Array.from({ length: 11 }, (_, i) => `palm-${i + 1}`), p: ['height|scale'] } },
  { id: 'c-ground-snow', world: 'coins', prompt: 'make the ground snowy', expect: { env: ['ground'] } },
  { id: 'c-sunset', world: 'coins', prompt: 'turn the sky to sunset', expect: { env: ['sky'] } },
  { id: 'c-low-gravity', world: 'coins', prompt: 'low gravity', expect: { env: ['gravity'] } },
  { id: 'c-add-palm', world: 'coins', prompt: 'add a palm tree near the pier', expect: { added: [1, 1] } },
  { id: 'c-add-3-crates', world: 'coins', prompt: 'add 3 crates', expect: { added: [3, 3] } },
  { id: 'c-selected-bigger', world: 'coins', prompt: 'make it a bit bigger', selection: ['sandcastle-1'], expect: { t: ['sandcastle-1'] } },
  // kart canyon
  { id: 'k-rival-slower', world: 'kart', prompt: 'make the rivals slower', expect: { t: ['rival-1', 'rival-2'], p: ['speed'] } },
  { id: 'k-blue-comet-faster', world: 'kart', prompt: 'make Blue Comet faster', expect: { t: ['rival-1'], p: ['speed'] } },
  { id: 'k-my-kart-red', world: 'kart', prompt: 'make my kart red', expect: { t: ['kart-1'] } },
  { id: 'k-kart-topspeed', world: 'kart', prompt: 'make my kart faster', expect: { t: ['kart-1'], p: ['maxSpeed'] } },
  { id: 'k-harder', world: 'kart', prompt: 'make the game harder', expect: { t: ['rival-1', 'rival-2'], p: ['speed'] } },
  { id: 'k-golden-hour', world: 'kart', prompt: 'make it golden hour', expect: { env: ['sky'] } },
  { id: 'k-grandstand-move', world: 'kart', prompt: 'move the grandstand 5 meters back', expect: { t: ['grandstand-1'], p: ['transform.position'] } },
  { id: 'k-balloons-red', world: 'kart', prompt: 'make the balloons orange', expect: { t: Array.from({ length: 8 }, (_, i) => `balloon-${i + 1}`) } },
];

const scenes: EditCase[] = [
  { id: 's-tent-red', world: 'camp', prompt: 'make the second tent red', expect: { t: ['tent-2'], p: ['color'] } },
  { id: 's-tents-yellow', world: 'camp', prompt: 'make the tents yellow', expect: { t: ['tent-1', 'tent-2'], p: ['color'] } },
  { id: 's-campfire-bigger', world: 'camp', prompt: 'make the campfire a lot bigger', expect: { t: ['campfire-1'] } },
  { id: 's-logs-remove', world: 'camp', prompt: 'remove the third log seat', expect: { removed: ['log-seat-3'] } },
  { id: 's-lake-bluer', world: 'camp', prompt: 'make the lake darker blue', expect: { t: ['lake-1'], p: ['color'] } },
  { id: 's-tent-left', world: 'camp', prompt: 'move the first tent 2 meters to the left', expect: { t: ['tent-1'], p: ['transform.position'] } },
  { id: 's-lantern-brighter', world: 'camp', prompt: 'make the lantern lights brighter', expect: { t: ['lantern-post-1-light-1', 'lantern-post-2-light-1'], p: ['light.intensity'] } },
  { id: 's-add-bench', world: 'camp', prompt: 'add a bench next to the campfire', expect: { added: [1, 1] } },
  { id: 's-winter', world: 'camp', prompt: 'make it a winter scene', expect: { env: ['weather', 'ground'] } },
  { id: 's-remove-fog', world: 'camp', prompt: 'remove the fog', expect: { env: ['fog'] } },
  { id: 's-time-noon', world: 'camp', prompt: 'make it noon', expect: { env: ['sky'] } },
  { id: 's-jetty-longer', world: 'camp', prompt: 'make the jetty longer', expect: { t: ['jetty-1'] } },
  { id: 'm-train-faster', world: 'meadow', prompt: 'make the train faster', expect: { t: ['engine-1', 'carriage-1', 'carriage-2', 'carriage-3'], p: ['speed'] } },
  { id: 'm-windmill-red', world: 'meadow', prompt: 'make the windmill red', expect: { t: ['windmill-1'] } },
  { id: 'm-windmill-taller', world: 'meadow', prompt: 'make the windmill taller', expect: { t: ['windmill-1'] } },
  { id: 'm-station-rename', world: 'meadow', prompt: 'rename the station to Hilltop', expect: { t: ['station-house-1'], p: ['name'] } },
  { id: 'm-animals-slower', world: 'meadow', prompt: 'make the animals slower', expect: { t: [...Array.from({ length: 12 }, (_, i) => `sheep-1-${i + 1}`), ...Array.from({ length: 5 }, (_, i) => `cows-1-${i + 1}`)], p: ['speed'] } },
  { id: 'm-autumn', world: 'meadow', prompt: 'make it autumn', expect: { env: ['weather'], allow: [/^meadow-tree/] } },
  { id: 'm-cottage-add', world: 'meadow', prompt: 'add another cottage', expect: { added: [1, 1] } },
  { id: 'm-dawn', world: 'meadow', prompt: 'make it dusk', expect: { env: ['sky'] } },
];

const blocks: EditCase[] = [
  { id: 'b-no-mobs', world: 'blocks', prompt: 'turn off the monsters', expect: { voxel: ['game.mobs'] } },
  { id: 'b-longer-days', world: 'blocks', prompt: 'make the days longer', expect: { voxel: ['game.dayLength'] } },
  { id: 'b-creative', world: 'blocks', prompt: 'switch to creative mode', expect: { voxel: ['game.mode'] } },
  { id: 'b-add-tower', world: 'blocks', prompt: 'add a tower', expect: { voxel: ['edits'] } },
  { id: 'b-remove-well', world: 'blocks', prompt: 'remove the well', expect: { voxel: ['edits'] } },
  { id: 'b-house-red', world: 'blocks', prompt: 'make the first house red', expect: { voxel: ['edits'] } },
  { id: 'b-night', world: 'blocks', prompt: 'make it night', expect: { env: ['sky'] } },
  { id: 'b-planks-stone', world: 'blocks', prompt: 'turn the oak planks into stone bricks', expect: { voxel: ['edits'] } },
  { id: 'b-bigger-castle', world: 'blocks', prompt: 'make the second house bigger', expect: { voxel: ['edits'] } },
];

const chat: EditCase[] = [
  { id: 'x-chain-it', world: 'camp', prior: ['make the second tent red'], prompt: 'now make it a bit bigger', expect: { t: ['tent-2'] } },
  { id: 'x-same-other', world: 'camp', prior: ['make the first tent yellow'], prompt: 'do the same for the other tent', expect: { t: ['tent-2'], p: ['color'] } },
  { id: 'x-selection-delete', world: 'camp', prompt: 'delete this', selection: ['rock-1'], expect: { removed: ['rock-1'] } },
  { id: 'x-two-in-one', world: 'camp', prompt: 'make the first tent red and the second tent blue', expect: { t: ['tent-1', 'tent-2'], p: ['color'] } },
  { id: 'x-redo', world: 'camp', prior: ['make the first tent red'], prompt: 'redo', expect: { history: 'redo' } },
  { id: 'x-vague', world: 'camp', prompt: 'make the thing better', expect: { decline: true } },
  { id: 'x-question', world: 'camp', prompt: 'what is in this scene?', expect: { decline: true } },
  { id: 'x-unknown-noun', world: 'camp', prompt: 'make the unicorn pink', expect: { decline: true } },
];

/** Regressions: phrasing that broke the first version (found by hand-trying prompts after the first eval was green). */
const regressions: EditCase[] = [
  { id: 'r-hall-mirror-bigger', world: 'apartment', prompt: 'make the hallway mirror bigger', expect: { t: [`${A}hall-f1`] } },
  { id: 'r-curtains-longer', world: 'apartment', prompt: 'make the living room curtains longer', expect: { t: [4, 5, 6, 7].map((n) => `${A}living-f${n}`), p: ['height'] } },
  { id: 'r-closer-to-window', world: 'apartment', prompt: 'can you move the bookshelf closer to the window', expect: { t: [`${A}living-f3`], p: ['transform.position'] } },
  { id: 'r-raise-pendant-ask', world: 'apartment', prompt: 'raise the pendant light in the kitchen', expect: { ask: 2 } },
  { id: 'r-whole-apartment', world: 'apartment', prompt: 'make the whole apartment warmer', expect: { decline: true } },
  { id: 'r-dark-marble', world: 'apartment', prompt: 'the kitchen floor should be dark marble', expect: { t: [`${A}kitchen`], p: ['marble'] } },
  { id: 'r-palms-should-be-taller', world: 'coins', prompt: 'the palm trees should be taller', expect: { t: Array.from({ length: 11 }, (_, i) => `palm-${i + 1}`), p: ['height|scale'] } },
  { id: 'r-two-sizes', world: 'camp', prompt: 'make the rocks bigger and the logs smaller', expect: { t: [...Array.from({ length: 6 }, (_, i) => `rock-${i + 1}`), 'woodpile-1-log-1', 'woodpile-1-log-2'] } },
  { id: 'r-benches', world: 'camp', prompt: 'add 2 benches near the lake', expect: { added: [2, 2] } },
  { id: 'r-foggy-rainy', world: 'camp', prompt: 'make it foggy and rainy', expect: { env: ['weather', 'fog'] } },
  { id: 'r-scene-description', world: 'camp', prompt: 'a cozy village by a lake at sunset', expect: { decline: true } },
  { id: 'r-take-out', world: 'apartment', prompt: 'take the plant out of the bathroom', expect: { removed: [`${A}bath-f4`], allow: ['apartment'] } },
];

/** Every case. */
export const CASES: readonly EditCase[] = [...arch, ...penthouse, ...living, ...games, ...scenes, ...blocks, ...chat, ...regressions];
