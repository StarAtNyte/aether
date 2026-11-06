/**
 * Assemble the Cloudwatch Harbour world around the baked glb pieces (scripts/blender/cloudwatch/bake_export.py).
 *
 *   npx tsx scripts/blender/cloudwatch/world.ts <bake-out-dir>
 *
 * Copies the pieces to apps/studio/public/templates/models/cloudwatch-harbour/ and writes the template
 * apps/studio/public/templates/worlds/cloudwatch-harbour.json in canonical form (the form `showcase:bake` checks).
 * One `model` entity per piece; the model loader centres a model on X/Z and puts its base at Y = 0, so each entity sits at
 * its piece's bounds centre and floor and the pieces line up exactly as they were in Blender.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stableStringify, validateWorld, type WorldDocInput } from '@aether/core';

const SLUG = 'cloudwatch-harbour';
const REPO = join(import.meta.dirname, '..', '..', '..');
const src = process.argv[2];
if (!src) throw new Error('usage: world.ts <bake-out-dir>');

interface Piece {
  file: string;
  bytes: number;
  triangles: number;
  min: [number, number, number];
  max: [number, number, number];
}
const pieces = JSON.parse(readFileSync(join(src, 'pieces.json'), 'utf8')) as Record<string, Piece>;
/** Draw order is the file order; the sky first. */
const ORDER = ['sky', 'sun', 'clouds', 'sea', 'glitter', 'terrain', 'terrain_far', 'forest', 'infra', 'town', 'shrine', 'trees', 'props', 'people'];
const NAMES: Record<string, string> = {
  sky: 'Dusk sky', sun: 'Sun', clouds: 'Cloudscape', sea: 'Sea', glitter: 'Sun glitter on the sea', terrain: 'Town terraces and lanes', terrain_far: 'Hillside, headlands and sea floor', forest: 'Wooded ridges',
  infra: 'Stair, lookout, harbour and railway', town: 'Houses', shrine: 'Shrine gate and hall', trees: 'Garden trees and hedges', props: 'Lanterns, signs and street life', people: 'People',
};

const outDir = join(REPO, 'apps/studio/public/templates/models', SLUG);
mkdirSync(outDir, { recursive: true });
const entities: NonNullable<WorldDocInput['entities']> = {};
let tris = 0;
let bytes = 0;
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
    weather: 'fireflies',
    ambientIntensity: 0.5,
    sunIntensity: 2,
    ground: null,
    bloom: 0.75,
    exposure: 1,
    look: { style: 'anime', vignette: 0.14 },
    lightBake: { quality: 'off' },
    surroundings: { preset: 'none' },
  },
  entities,
  opening: { position: eye, target, fov: 54 },
  startMode: 'orbit',
};
const valid = validateWorld(world);
if (!valid.ok) throw new Error(`invalid world: ${valid.issues.slice(0, 4).map((i) => `${i.path}: ${i.message}`).join('; ')}`);
const text = `${stableStringify({ format: 'aether-world', version: 1, world: valid.world })}\n`;
writeFileSync(join(REPO, 'apps/studio/public/templates/worlds', `${SLUG}.json`), text);
console.log(`${SLUG}: ${Object.keys(entities).length} pieces, ${tris} triangles, ${(bytes / 1048576).toFixed(2)} MB`);
