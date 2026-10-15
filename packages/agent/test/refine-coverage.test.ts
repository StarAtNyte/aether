/**
 * Coverage matrix: every kind of editable property of the World IR is
 * reachable by a plain-language prompt (docs/CONTRACTS.md, "Fine edits").
 * Each row names the property, a prompt, a fixture world and the changed
 * path (regex) that proves the right thing changed.
 */
import { loadCatalog } from '@aether/assets';
import { applyPatches } from '@aether/core';
import { catalog } from '@aether/procgen';
import { beforeAll, describe, expect, it } from 'vitest';
import { worldChanges } from '../src/refine/changes';
import { planFineEdit } from '../src/refine/plan';
import { loadFixture, type FixtureName } from './fine/fixtures';

interface Row {
  property: string;
  world: FixtureName;
  prompt: string;
  /** Regex source matched against "scope:id.path" of every change. */
  changed: string;
  selection?: string[];
}

const ROWS: Row[] = [
  // transform
  { property: 'transform.position', world: 'camp', prompt: 'move the first tent 2 meters to the left', changed: 'entity:tent-1\\.transform\\.position' },
  { property: 'transform.rotation', world: 'camp', prompt: 'rotate the first tent 45 degrees', changed: 'entity:tent-1\\.transform\\.rotation' },
  { property: 'transform.scale', world: 'camp', prompt: 'make the lake bigger', changed: 'entity:lake-1\\.transform\\.scale' },
  { property: 'shape.params.size', world: 'camp', prompt: 'make the campfire bigger', changed: 'entity:campfire-1\\.shape\\.params\\.size' },
  { property: 'shape.params.height', world: 'coins', prompt: 'make the palm trees taller', changed: 'entity:palm-1\\.shape\\.params\\.height' },
  { property: 'shape.params.width', world: 'apartment', prompt: 'make the sofa 3 meters wide', changed: 'entity:apartment-l0-living-f0\\.shape\\.params\\.width' },
  { property: 'shape (variant)', world: 'penthouse', prompt: 'make the dining table in the dining room round', changed: 'entity:penthouse-l0-dining-f0\\.shape\\.params' },
  // materials
  { property: 'material.color (primitive)', world: 'coins', prompt: 'make the beach ball blue', changed: 'entity:beach-ball-1\\.(material\\.color|shape)' },
  { property: 'shape.params.color (generator)', world: 'camp', prompt: 'make the first tent red', changed: 'entity:tent-1\\.shape\\.params\\.color' },
  { property: 'material.finish / preset', world: 'camp', prompt: 'make the lake ice', changed: 'entity:lake-1\\.material\\.preset' },
  { property: 'material.opacity', world: 'camp', prompt: 'make the lake transparent', changed: 'entity:lake-1\\.material\\.opacity' },
  { property: 'material.emissive', world: 'coins', prompt: 'make the beach ball glow', changed: 'entity:beach-ball-1\\.material\\.emissive' },
  { property: 'material.roughness', world: 'coins', prompt: 'make the beach ball glossy', changed: 'entity:beach-ball-1\\.material\\.roughness' },
  { property: 'wall finish (per face)', world: 'apartment', prompt: "wallpaper on the main bedroom's back wall", changed: 'entity:apartment-l0-w\\d+\\.shape\\.params\\.finish[AB]' },
  { property: 'floor finish', world: 'apartment', prompt: 'change the kitchen floor to oak', changed: 'entity:apartment-l0-kitchen\\.shape\\.params\\.finish' },
  { property: 'furniture slot (upholstery)', world: 'apartment', prompt: 'make the sofa velvet', changed: 'entity:apartment-l0-living-f0\\.shape\\.params\\.upholstery' },
  // physics
  { property: 'physics.restitution', world: 'coins', prompt: 'make the beach ball bouncy', changed: 'entity:beach-ball-1\\.physics\\.restitution' },
  { property: 'physics.mass', world: 'coins', prompt: 'make the beach ball heavier', changed: 'entity:beach-ball-1\\.physics\\.mass' },
  { property: 'physics.friction', world: 'coins', prompt: 'make the beach ball slippery', changed: 'entity:beach-ball-1\\.physics\\.friction' },
  // lights
  { property: 'light.intensity', world: 'apartment', prompt: 'brighter lights in the hallway', changed: 'entity:apartment-l0-hall-f3\\.light\\.intensity' },
  { property: 'light.color', world: 'apartment', prompt: 'make the hallway light cooler', changed: 'entity:apartment-l0-hall-f3\\.light\\.color' },
  // environment
  { property: 'environment.sky', world: 'camp', prompt: 'make it night', changed: 'environment:.*sky' },
  { property: 'environment.timeOfDay', world: 'camp', prompt: 'set the time to 6pm', changed: 'environment:.*timeOfDay' },
  { property: 'environment.weather', world: 'camp', prompt: 'make it rain', changed: 'environment:.*weather' },
  { property: 'environment.fog', world: 'camp', prompt: 'add some fog', changed: 'environment:.*fog' },
  { property: 'environment.gravity', world: 'camp', prompt: 'low gravity', changed: 'environment:.*gravity' },
  { property: 'environment.ground', world: 'camp', prompt: 'make the ground snowy', changed: 'environment:.*ground' },
  { property: 'environment.sunIntensity', world: 'camp', prompt: 'make the scene brighter', changed: 'environment:.*(sunIntensity|ambientIntensity)' },
  { property: 'environment.bloom', world: 'camp', prompt: 'more glow', changed: 'environment:.*bloom' },
  // player / camera
  { property: 'player.moveSpeed', world: 'lantern', prompt: 'make the player faster', changed: 'player:.*moveSpeed' },
  { property: 'player.jumpSpeed', world: 'lantern', prompt: 'let me jump higher', changed: 'player:.*jumpSpeed' },
  { property: 'player.mode (camera)', world: 'lantern', prompt: 'switch to first person view', changed: 'player:.*mode' },
  // behaviours
  { property: 'behaviors[spin].speed', world: 'coins', prompt: 'make the coins spin faster', changed: 'entity:coin-1\\.behaviors\\.\\d+\\.params\\.speed' },
  { property: 'behaviors[patrol].speed', world: 'kart', prompt: 'slow down Yellow Jacket', changed: 'entity:rival-2\\.behaviors\\.\\d+\\.params\\.speed' },
  { property: 'behaviors[bob].period', world: 'coins', prompt: 'make the sailboat bob faster', changed: 'entity:boat-1\\.behaviors\\.\\d+\\.params\\.period' },
  { property: 'behaviors[vehicle].maxSpeed', world: 'kart', prompt: 'make my kart faster', changed: 'entity:kart-1\\.behaviors\\.\\d+\\.params\\.maxSpeed' },
  { property: 'behaviors[npc].lines', world: 'lantern', prompt: 'make Mira say welcome to my island', changed: 'entity:guide-1\\.behaviors\\.\\d+\\.params\\.lines' },
  { property: 'behaviors[npc].name + name', world: 'lantern', prompt: 'rename Mira to Wren', changed: 'entity:guide-1\\.name' },
  { property: 'behaviors (add spin)', world: 'coins', prompt: 'make the beach ball spin', changed: 'entity:beach-ball-1\\.behaviors' },
  { property: 'visible', world: 'camp', prompt: 'hide the lake', changed: 'entity:lake-1\\.visible' },
  { property: 'name', world: 'meadow', prompt: 'rename the station to Hilltop', changed: 'entity:station-house-1\\.name' },
  // game rules
  { property: 'state / time limit', world: 'coins', prompt: 'give me 90 seconds', changed: 'state:.*timeLeft' },
  { property: 'rule threshold + hud (goal)', world: 'coins', prompt: 'collect 15 coins to win', changed: 'rule:all-coins' },
  { property: 'difficulty (speeds + timer)', world: 'kart', prompt: 'make the game harder', changed: 'entity:rival-1\\.behaviors' },
  // add / remove / duplicate
  { property: 'add entity', world: 'camp', prompt: 'add a bench next to the campfire', changed: 'entity:bench.*' },
  { property: 'duplicate entity', world: 'camp', prompt: 'duplicate the first tent', changed: 'entity:tent-3' },
  { property: 'remove entity', world: 'camp', prompt: 'remove the jetty', changed: 'entity:jetty-1' },
  // scatter / vegetation
  { property: 'scatter.count (density)', world: 'camp', prompt: 'make the pine forest denser', changed: 'entity:pine-forest-\\d+\\.shape\\.count' },
  { property: 'scatter.scaleRange', world: 'camp', prompt: 'make the pine forest taller', changed: 'entity:pine-forest-\\d+\\.shape\\.scaleRange' },
  // voxel
  { property: 'voxel.game.mobs', world: 'blocks', prompt: 'turn off the monsters', changed: 'voxel:game\\.mobs' },
  { property: 'voxel.game.dayLength', world: 'blocks', prompt: 'make the days longer', changed: 'voxel:game\\.dayLength' },
  { property: 'voxel.edits (palette)', world: 'blocks', prompt: 'make the first house red', changed: 'voxel:edits' },
  { property: 'voxel.edits (add structure)', world: 'blocks', prompt: 'add a tower', changed: 'voxel:edits' },
  { property: 'voxel.edits (replace block)', world: 'blocks', prompt: 'turn the oak planks into stone bricks', changed: 'voxel:edits' },
  { property: 'selection ("this")', world: 'camp', prompt: 'make this red', selection: ['tent-2'], changed: 'entity:tent-2\\.shape\\.params\\.color' },
];

beforeAll(async () => {
  await loadCatalog();
});

describe('every editable property is reachable by prompt', () => {
  for (const row of ROWS) {
    it(`${row.property}: "${row.prompt}"`, () => {
      const world = loadFixture(row.world);
      const r = planFineEdit({ world, text: row.prompt, ...(row.selection ? { selection: row.selection } : {}), catalogs: { generators: catalog() } });
      expect(r.kind, `${r.reason ?? ''} ${r.detail ?? ''}`).toBe('edit');
      const after = applyPatches(world, r.patches);
      expect(after.errors).toEqual([]);
      const lines = worldChanges(world, after.world).map((c) => `${c.scope}:${c.id}${c.id ? '.' : ''}${c.path}`);
      expect(lines.some((l) => new RegExp(row.changed).test(l)), `changes: ${lines.slice(0, 8).join(' | ')}`).toBe(true);
    });
  }

  it('lists audio as the one area without properties (sounds are rule actions)', () => {
    // No entity or environment field controls sound; rules play named sounds. Documented in CONTRACTS.md.
    expect(ROWS.some((r) => /audio|sound/i.test(r.property))).toBe(false);
  });
});
