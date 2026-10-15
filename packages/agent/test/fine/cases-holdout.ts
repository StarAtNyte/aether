/**
 * Holdout cases: different wording, written after the parser was tuned on
 * `cases.ts`. Their first-run accuracy is the honest estimate of how the
 * parser does on phrasing it was not built around.
 */
import type { EditCase } from './types';

const A = 'apartment-l0-';
const P = 'penthouse-l0-';

export const HOLDOUT: readonly EditCase[] = [
  // apartment
  { id: 'h-couch-darker-green', world: 'apartment', prompt: 'could you please make the couch a darker green', expect: { t: [`${A}living-f0`], p: ['color'] } },
  { id: 'h-armchair-grey-fabric', world: 'apartment', prompt: "I'd like the armchair in grey fabric", expect: { t: [`${A}living-f1`], p: ['color'] } },
  { id: 'h-nudge-shelf', world: 'apartment', prompt: 'nudge the bookshelf a little to the right', expect: { t: [`${A}living-f3`], p: ['transform.position'] } },
  { id: 'h-sofa-2m-left', world: 'apartment', prompt: 'put the sofa 2 meters to the left', expect: { t: [`${A}living-f0`], p: ['transform.position'] } },
  { id: 'h-armchair-around', world: 'apartment', prompt: 'turn the armchair around', expect: { t: [`${A}living-f1`], p: ['transform.rotation'] } },
  { id: 'h-shelf-shrink', world: 'apartment', prompt: 'shrink the bookshelf a bit', expect: { t: [`${A}living-f3`] } },
  { id: 'h-bath-walls-blue', world: 'apartment', prompt: 'paint the bathroom walls light blue', expect: { wall: { room: `${A}bath`, all: true } } },
  { id: 'h-hall-rug-green', world: 'apartment', prompt: 'make the hallway rug green', expect: { t: [`${A}hall-f2`], p: ['color'] } },
  { id: 'h-bed2-plant-copy', world: 'apartment', prompt: 'duplicate the plant in bedroom 2', expect: { added: [1, 1], allow: ['apartment', /^apartment-l0-bed2/] } },
  { id: 'h-brighter-it', world: 'apartment', prompt: 'make it a bit brighter', expect: { env: ['sunIntensity'] } },
  { id: 'h-8am', world: 'apartment', prompt: 'set the time to 8am', expect: { env: ['timeOfDay'] } },
  { id: 'h-foggy', world: 'apartment', prompt: 'make it foggy', expect: { env: ['fog'] } },
  { id: 'h-desk-rename', world: 'apartment', prompt: 'rename the desk in the main bedroom to Workstation', expect: { t: [`${A}master-f7`], p: ['^name'] } },
  { id: 'h-bedroom-wall-ask', world: 'apartment', prompt: 'paint the bedroom walls white', expect: { ask: 2 } },
  { id: 'h-living-couch-velvet', world: 'apartment', prompt: 'the sofa should be velvet', expect: { t: [`${A}living-f0`], p: ['upholstery'] } },
  { id: 'h-kitchen-stools-black', world: 'apartment', prompt: 'make the bar stools black', expect: { t: [2, 3, 4, 5].map((n) => `${A}kitchen-f${n}`) } },
  { id: 'h-plant-bath-remove', world: 'apartment', prompt: 'take the plant out of the bathroom', expect: { removed: [`${A}bath-f4`], allow: ['apartment'] } },
  // penthouse
  { id: 'h-pent-sofa-bigger', world: 'penthouse', prompt: 'make the sofa a lot bigger', expect: { t: [`${P}living-f0`] } },
  { id: 'h-pent-tv-off-screen', world: 'penthouse', prompt: 'remove the tv', expect: { removed: [`${P}living-f6`], allow: ['penthouse'] } },
  { id: 'h-pent-bookshelf-oak', world: 'penthouse', prompt: 'change the bookshelf to oak', expect: { t: [`${P}living-f8`] } },
  { id: 'h-pent-night-time', world: 'penthouse', prompt: 'night time please', expect: { env: ['sky'] } },
  // games
  { id: 'h-coins-silver', world: 'coins', prompt: 'make the coins silver', expect: { t: Array.from({ length: 10 }, (_, i) => `coin-${i + 1}`) } },
  { id: 'h-palms-shorter', world: 'coins', prompt: 'make the palm trees shorter', expect: { t: Array.from({ length: 11 }, (_, i) => `palm-${i + 1}`), p: ['height|scale'] } },
  { id: 'h-ball-bouncier', world: 'coins', prompt: 'make the beach ball bouncier', expect: { t: ['beach-ball-1'], p: ['restitution'] } },
  { id: 'h-boat-smaller', world: 'coins', prompt: 'make the sailboat smaller', expect: { t: ['boat-1'] } },
  { id: 'h-castle-right', world: 'coins', prompt: 'move the sandcastle a bit to the right', expect: { t: ['sandcastle-1'], p: ['transform.position'] } },
  { id: 'h-double-time', world: 'coins', prompt: 'double the time limit', expect: { game: ['state'] } },
  { id: 'h-mira-full-name', world: 'lantern', prompt: 'rename Mira the lamplighter to Wren the keeper', expect: { t: ['guide-1'], p: ['name'] } },
  { id: 'h-campfire-glow', world: 'lantern', prompt: 'make the campfire light brighter', expect: { t: ['campfire-1-light-1'], p: ['light.intensity'] } },
  { id: 'h-rivals-blue', world: 'kart', prompt: 'make the rival cars blue', expect: { t: ['rival-1', 'rival-2'] } },
  { id: 'h-yellow-jacket-slow', world: 'kart', prompt: 'slow down Yellow Jacket', expect: { t: ['rival-2'], p: ['speed'] } },
  { id: 'h-grandstand-remove', world: 'kart', prompt: 'remove the grandstand', expect: { removed: ['grandstand-1'] } },
  { id: 'h-tents-bigger', world: 'camp', prompt: 'make the tents bigger', expect: { t: ['tent-1', 'tent-2'] } },
  { id: 'h-lake-green', world: 'camp', prompt: 'turn the lake green', expect: { t: ['lake-1'], p: ['color'] } },
  { id: 'h-jetty-remove', world: 'camp', prompt: 'remove the jetty', expect: { removed: ['jetty-1'] } },
  { id: 'h-tent-rotate-45', world: 'camp', prompt: 'rotate the first tent 45 degrees', expect: { t: ['tent-1'], p: ['rotation'] } },
  { id: 'h-night-fog', world: 'camp', prompt: 'make it night with fog', expect: { env: ['sky', 'fog'] } },
  { id: 'h-windmill-spin', world: 'meadow', prompt: 'make the windmill spin faster', expect: { decline: true } },
  { id: 'h-station-white', world: 'meadow', prompt: 'paint the station white', expect: { t: ['station-house-1'], p: ['color'] } },
  { id: 'h-slow-train', world: 'meadow', prompt: 'slow down the train', expect: { t: ['engine-1', 'carriage-1', 'carriage-2', 'carriage-3'], p: ['speed'] } },
  { id: 'h-add-tree-cottage', world: 'meadow', prompt: 'add a tree near the first cottage', expect: { added: [1, 1] } },
  // blocks
  { id: 'h-well-north', world: 'blocks', prompt: 'move the well 5 blocks north', expect: { voxel: ['edits'] } },
  { id: 'h-lamppost-ask', world: 'blocks', prompt: 'remove the lamppost', expect: { ask: 2 } },
  { id: 'h-peaceful', world: 'blocks', prompt: 'no monsters please', expect: { voxel: ['game.mobs'] } },
  // conversation
  { id: 'h-it-bigger', world: 'camp', prior: ['make the first tent red'], prompt: 'a bit bigger please', expect: { t: ['tent-1'] } },
  { id: 'h-also-second', world: 'camp', prior: ['make the first tent red'], prompt: 'and the second tent too', expect: { t: ['tent-2'], p: ['color'] } },
  { id: 'h-undo-it', world: 'camp', prior: ['make the first tent red'], prompt: 'undo', expect: { history: 'undo' } },
  { id: 'h-thanks', world: 'camp', prompt: 'thanks, that looks great', expect: { decline: true } },
];
