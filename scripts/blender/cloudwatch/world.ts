/**
 * Assemble the Cloudwatch Harbour world around the baked glb pieces (scripts/blender/cloudwatch/bake_export.py).
 *
 *   npx tsx scripts/blender/cloudwatch/world.ts <bake-out-dir>
 *   npx tsx scripts/blender/cloudwatch/world.ts --refresh      # keep the pieces, rewrite the rest (story, people, play)
 *
 * Copies the pieces to apps/studio/public/templates/models/cloudwatch-harbour/ and writes the template
 * apps/studio/public/templates/worlds/cloudwatch-harbour.json in canonical form (the form `showcase:bake` checks).
 * One `model` entity per piece; the model loader centres a model on X/Z and puts its base at Y = 0, so each entity sits at
 * its piece's bounds centre and floor and the pieces line up exactly as they were in Blender.
 *
 * The pieces people stand on (terrain, stair and lookout, houses, shrine) are static triangle-mesh bodies, so play has
 * real ground; the world opens on its short film (`story.ts`, start mode `story`), whose girl (`cw-kaho`) is also the
 * body the visitor plays.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stableStringify, validateWorld, type WorldDocInput } from '@aether/core';
import { KAHO, KAHO_END, STORY } from './story';

const SLUG = 'cloudwatch-harbour';
const REPO = join(import.meta.dirname, '..', '..', '..');
const src = process.argv[2];
if (!src) throw new Error('usage: world.ts <bake-out-dir> | --refresh');
const refresh = src === '--refresh';
const TEMPLATE = join(REPO, 'apps/studio/public/templates/worlds', `${SLUG}.json`);

interface Piece {
  file: string;
  bytes: number;
  triangles: number;
  min: [number, number, number];
  max: [number, number, number];
}
const pieces = refresh ? {} : (JSON.parse(readFileSync(join(src, 'pieces.json'), 'utf8')) as Record<string, Piece>);
/** Draw order is the file order; the sky first. */
const ORDER = ['sky', 'sun', 'clouds', 'sea', 'glitter', 'terrain', 'terrain_far', 'forest', 'infra', 'town', 'shrine', 'trees', 'props', 'people', 'train', 'birds', 'laundry'];
/** Pieces with solid ground and walls (static triangle meshes); the rest are scenery only. */
const SOLID = new Set(['terrain', 'terrain_far', 'infra', 'town', 'shrine']);
const NAMES: Record<string, string> = {
  sky: 'Dusk sky', sun: 'Sun', clouds: 'Cloudscape', sea: 'Sea', glitter: 'Sun glitter on the sea', terrain: 'Town terraces and lanes', terrain_far: 'Hillside, headlands and sea floor', forest: 'Wooded ridges',
  infra: 'Stair, lookout, harbour and railway', town: 'Houses', shrine: 'Shrine gate and hall', trees: 'Garden trees and hedges', props: 'Lanterns, signs and street life', people: 'People',
  train: 'Local train', birds: 'Gulls', laundry: 'Laundry in the wind',
};

const outDir = join(REPO, 'apps/studio/public/templates/models', SLUG);
mkdirSync(outDir, { recursive: true });
const entities: NonNullable<WorldDocInput['entities']> = {};
let tris = 0;
let bytes = 0;
if (refresh) {
  // The pieces as the template has them (positions included); only their bodies are set again below.
  const old = JSON.parse(readFileSync(TEMPLATE, 'utf8')) as { world: { entities: Record<string, NonNullable<WorldDocInput['entities']>[string]> } };
  for (const key of ORDER) {
    const e = old.world.entities[`cw-${key}`];
    if (e) entities[`cw-${key}`] = e;
  }
}
for (const key of ORDER) {
  const p = pieces[key];
  if (!p) continue;
  copyFileSync(join(src, p.file), join(outDir, p.file));
  const id = `cw-${key}`;
  const c = [(p.min[0] + p.max[0]) / 2, p.min[1], (p.min[2] + p.max[2]) / 2].map((v) => Math.round(v * 1000) / 1000) as [number, number, number];
  entities[id] = {
    id,
    name: NAMES[key] ?? key,
    tags: ['scenery', 'blender'],
    transform: { position: c, rotation: [0, 0, 0], scale: [1, 1, 1] },
    shape: { kind: 'model', url: `./templates/models/${SLUG}/${p.file}` },
    castShadow: false,
    receiveShadow: false,
    state: {},
  };
  tris += p.triangles;
  bytes += p.bytes;
}

for (const key of ORDER) {
  const e = entities[`cw-${key}`];
  if (!e) continue;
  if (SOLID.has(key)) e.physics = { body: 'static', collider: 'trimesh', friction: 0.8 };
  else delete e.physics;
}
// The girl of the film, standing at the lookout railing where it leaves her (the body the visitor plays, too).
entities[KAHO] = {
  id: KAHO,
  name: 'Kaho',
  tags: ['person', 'story'],
  transform: { position: KAHO_END, rotation: [0, 172, 0], scale: [1, 1, 1] },
  shape: { kind: 'none' },
  character: { body: 'kaho', gender: 'female', age: 'young' },
  // The painted pieces draw unlit (no shadow lands on them): a moving caster would only redraw the sun map.
  castShadow: false,
  receiveShadow: false,
  state: {},
};

// Shot A of the design doc (the lookout), Blender (x, y, z) -> glTF/Aether (x, z, -y).
const eye: [number, number, number] = [2.0, 45.65, -130.9];
const target: [number, number, number] = [-50.1, 24.6, 163.2];
const world: WorldDocInput = {
  version: 1,
  id: SLUG,
  name: 'Cloudwatch Harbour',
  description:
    'A hillside fishing town at summer dusk in a hand-painted animation style: a stone stair climbs past a shrine gate to a lookout, tiled roofs step down to the harbour, a single-track railway crosses the stair under sagging wires, and a towering cumulonimbus lights up over the sea. Made in Blender by script and baked to painted, unlit pieces.',
  seed: 7,
  environment: {
    sky: 'sunset',
    timeOfDay: 18.7,
    fog: null,
    weather: 'clear',
    ambientIntensity: 0.5,
    sunIntensity: 2,
    ground: null,
    bloom: 0.75,
    exposure: 1,
    // The compositing layer's rays and flare come from the painted sun (the sun piece seen from the lookout), not the sky's sun light.
    look: { style: 'anime', vignette: 0.14, satsuei: { sunDirection: [-0.558, 0.1005, 0.8237], gradientTop: '#9a8cd8', gradientBottom: '#ffc89a', gradientAmount: 0.12 } },
    lightBake: { quality: 'off' },
    surroundings: { preset: 'none' },
  },
  entities,
  // Play: the girl, from the foot of the stair on the harbour road.
  player: { mode: 'thirdPerson', spawn: [1.2, 1.75, 25.5], yaw: 0, moveSpeed: 6, jumpSpeed: 6, character: { body: 'kaho', gender: 'female', age: 'young' } },
  opening: { position: eye, target, fov: 54 },
  startMode: 'story',
  story: STORY,
};
const valid = validateWorld(world);
if (!valid.ok) throw new Error(`invalid world: ${valid.issues.slice(0, 4).map((i) => `${i.path}: ${i.message}`).join('; ')}`);
const text = `${stableStringify({ format: 'aether-world', version: 1, world: valid.world })}\n`;
writeFileSync(TEMPLATE, text);
console.log(`${SLUG}: ${Object.keys(entities).length} pieces, ${tris} triangles, ${(bytes / 1048576).toFixed(2)} MB`);
