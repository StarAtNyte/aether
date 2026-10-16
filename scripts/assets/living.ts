/**
 * Living models for the asset library, authored in code (MIT, first-party): animals sculpted as smooth signed-distance
 * bodies, skinned to a real skeleton and animated with real clips, in place of the cube-shaped stand-ins.
 *
 *   npx tsx scripts/assets/living.ts                 # build GLBs + merge into assets/catalog.json
 *   LIVING_DUMP=/tmp/dir npx tsx scripts/assets/living.ts [id ...]    # write GLBs only (model sheets)
 *
 * Models face -Z, stand on y = 0 and are centred in x / z. Clips: idle, walk, run (and species extras).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { Catalog, type CatalogEntryInput } from '../../packages/assets/src/schema';
import { pickRoles } from '../../packages/assets/src/info';
import { colliderFor, tagsFor } from './describe';
import { hullPoints } from './process';
import { mergeIntoCatalog } from './creatures';
import { buildCreature, type Creature } from './living-kit';
import { quadruped, type QuadSpec } from './living-quad';
import { bird, type BirdSpec } from './living-bird';
import { butterfly, fish, type FishSpec } from './living-fish';

const ROOT = resolve(import.meta.dirname, '../..');
const LIB = join(ROOT, 'assets', 'lib');

/** Fallow deer: a spotted summer coat, a stag with antlers and a doe without. */
export const DEER: QuadSpec = {
  id: 'deer',
  name: 'Deer (stag)',
  tags: 'stag fallow red roe buck antlers woodland forest wildlife animal',
  torso: 0.86,
  hipHeight: 0.78,
  backRise: 0.05,
  torsoWidth: 0.14,
  rumpDepth: 0.245,
  waistDepth: 0.24,
  chestDepth: 0.27,
  belly: 0.05,
  neck: 0.4,
  neckAngle: 0.85,
  neckR: [0.135, 0.07],
  head: { skull: [0.15, 0.093, 0.072], muzzle: 0.14, muzzleDrop: 0.28, muzzleW0: 0.78, muzzleW1: 0.5, pitch: -0.3, droop: 0.0 },
  tail: 0.13,
  tailRise: 0.25,
  tailR: [0.04, 0.036, 0.03, 0.02],
  earX: 0.42,
  ear: { len: 0.21, width: 0.1, tilt: 0.85, pitch: 0.15 },
  legSpread: 0.78,
  foreLeg: [0.25, 0.29, 0.24],
  hindLeg: [0.27, 0.27, 0.23],
  hindKnee: 0.35,
  hindHock: 0.4,
  toe: 0.045,
  foreR: [0.056, 0.036, 0.025, 0.018],
  hindR: [0.07, 0.042, 0.027, 0.018],
  hooves: true,
  antlers: true,
  eye: 0.02,
  coat: { base: '#9b6a3b', back: '#7c4f2a', belly: '#eadfc9', mask: '#6b4a31', maskAmount: 0.55, legs: '#7b5a3c', throat: '#eadfc9', rump: '#efe5cf', inner: '#d3a695', mottle: 0.5, streak: 0.14, spots: { color: '#f3e9d2', scale: 26, cut: 0.74, amount: 0.8 } },
  voxel: 0.013,
  k: 0.1,
  tris: 9000,
  swing: 0.5,
  flex: 0.75,
  walkSpeed: 1.5,
  runSpeed: 5.5,
  bob: 0.014,
  gait: 'trot',
  tailSway: 0.08,
  grazeDip: 0.9,
};

/** A tabby house cat. */
export const CAT: QuadSpec = {
  id: 'cat',
  name: 'Cat',
  tags: 'tabby kitten kitty pet feline domestic house animal',
  torso: 0.3,
  hipHeight: 0.2,
  backRise: 0.012,
  torsoWidth: 0.055,
  rumpDepth: 0.075,
  waistDepth: 0.07,
  chestDepth: 0.08,
  belly: 0.03,
  neck: 0.055,
  neckAngle: 0.7,
  neckR: [0.05, 0.04],
  head: { skull: [0.062, 0.054, 0.056], muzzle: 0.03, muzzleDrop: 0.12, muzzleW0: 0.55, muzzleW1: 0.4, pitch: -0.12, droop: 0.0 },
  tail: 0.26,
  tailRise: 0.4,
  tailR: [0.022, 0.02, 0.017, 0.012],
  earX: 0.35,
  ear: { len: 0.07, width: 0.062, tilt: 0.15, pitch: -0.05 },
  legSpread: 0.8,
  foreLeg: [0.09, 0.085, 0.03],
  hindLeg: [0.1, 0.09, 0.035],
  hindKnee: 0.65,
  hindHock: 0.8,
  toe: 0.025,
  foreR: [0.025, 0.017, 0.012, 0.011],
  hindR: [0.034, 0.019, 0.013, 0.011],
  paw: true,
  whiskers: true,
  eye: 0.014,
  coat: { base: '#c58b45', back: '#b0702c', belly: '#ecd2a6', mask: '#d9a769', maskAmount: 0.4, legs: '#c58b45', inner: '#e0a79c', mottle: 0.4, streak: 0.1, stripes: { color: '#6e3f14', freq: 85, cut: 0.35, amount: 0.75 } },
  voxel: 0.0055,
  k: 0.05,
  tris: 7000,
  swing: 0.6,
  flex: 0.9,
  walkSpeed: 1.2,
  runSpeed: 4.2,
  bob: 0.01,
  gait: 'bound',
  tailSway: 0.14,
  grazeDip: 0.5,
};


const BIRDS: BirdSpec[] = [
  { id: 'bird', name: 'Songbird (robin)', tags: 'robin sparrow finch songbird small bird garden perched flying', body: 0.14, bodyH: 0.04, bodyW: 0.036, head: 0.025, neck: 0.03, beak: 0.02, beakH: 0.008, tail: 0.09, tailW: 0.05, leg: 0.05, legR: 0.0025, span: 0.12, chord: 0.045, tipChord: 0.035, flapHz: 9,
    coat: { back: '#7a6a55', belly: '#e9d6bf', head: '#7a6a55', throat: '#d9672e', wing: '#6d5d49', wingTip: '#4a3e31', tail: '#5c4c3b' }, beakColor: '#2a2420', legColor: '#7a6a5a' },
  { id: 'crow', name: 'Crow', tags: 'raven rook corvid black bird scavenger flying perched', body: 0.3, bodyH: 0.06, bodyW: 0.052, head: 0.04, neck: 0.05, beak: 0.06, beakH: 0.022, tail: 0.2, tailW: 0.1, leg: 0.1, legR: 0.004, span: 0.4, chord: 0.11, tipChord: 0.08, flapHz: 4.5,
    coat: { back: '#1c1d22', belly: '#26272d', head: '#1c1d22', wing: '#202228', wingTip: '#16171b', tail: '#1c1d22' }, beakColor: '#17181a', legColor: '#222222' },
  { id: 'seagull', name: 'Seagull', tags: 'gull sea coast shore harbour white bird flying soaring', body: 0.38, bodyH: 0.07, bodyW: 0.06, head: 0.04, neck: 0.07, beak: 0.06, beakH: 0.016, hook: true, tail: 0.13, tailW: 0.1, leg: 0.1, legR: 0.0035, span: 0.5, chord: 0.1, tipChord: 0.06, flapHz: 3,
    coat: { back: '#aeb8c0', belly: '#f4f4f2', head: '#f4f4f2', wing: '#aeb8c0', wingTip: '#1e2226', tail: '#f4f4f2' }, beakColor: '#e8b73a', legColor: '#d98a6a' },
  { id: 'hawk', name: 'Hawk', tags: 'falcon eagle buzzard kite raptor bird of prey soaring flying', body: 0.42, bodyH: 0.08, bodyW: 0.065, head: 0.045, neck: 0.06, beak: 0.04, beakH: 0.022, hook: true, tail: 0.22, tailW: 0.12, leg: 0.13, legR: 0.005, span: 0.58, chord: 0.16, tipChord: 0.1, flapHz: 2.4,
    coat: { back: '#6b4b32', belly: '#e6d8c0', head: '#7b5a40', wing: '#6b4b32', wingTip: '#2b2018', tail: '#8a5a35' }, beakColor: '#3a3a38', legColor: '#e0b83a' },
  { id: 'duck', name: 'Duck (mallard)', tags: 'mallard drake waterfowl pond lake swimming bird', body: 0.4, bodyH: 0.08, bodyW: 0.07, head: 0.035, neck: 0.08, beak: 0.05, beakH: 0.014, tail: 0.08, tailW: 0.07, leg: 0.07, legR: 0.004, span: 0.42, chord: 0.12, tipChord: 0.08, flapHz: 6, swims: true,
    coat: { back: '#8a7c68', belly: '#c9c3b6', head: '#1f5a3a', throat: '#f1efe8', wing: '#85776a', wingTip: '#3a3a52', tail: '#3b3b40' }, beakColor: '#d9c23a', legColor: '#e08a2a' },
  { id: 'parrot', name: 'Parrot (macaw)', tags: 'macaw tropical jungle colourful bird perched flying', body: 0.34, bodyH: 0.06, bodyW: 0.05, head: 0.04, neck: 0.05, beak: 0.05, beakH: 0.03, hook: true, tail: 0.35, tailW: 0.07, leg: 0.07, legR: 0.004, span: 0.4, chord: 0.1, tipChord: 0.07, flapHz: 5,
    coat: { back: '#d9232b', belly: '#d9232b', head: '#d9232b', wing: '#1f62d0', wingTip: '#1f62d0', tail: '#d9232b' }, beakColor: '#e8e4d8', legColor: '#555555' },
];


const FISH: FishSpec[] = [
  { id: 'fish', name: 'Trout', tags: 'trout salmon river lake pond swimming silver fish', length: 0.38, depth: 0.088, width: 0.05, tailSpan: 0.2, hz: 2.2,
    coat: { back: '#5f6f3c', belly: '#e6e1cf', side: '#a9a37a', fin: '#8c7f58', lateral: '#c76f6f', spots: { color: '#2a2a22', scale: 120, cut: 0.74 } } },
  { id: 'koi', name: 'Koi', tags: 'koi carp goldfish pond garden orange white swimming fish', length: 0.55, depth: 0.1, width: 0.062, tailSpan: 0.22, hz: 1.6,
    coat: { back: '#efe9dc', belly: '#f4efe6', fin: '#f3e6cf', patches: [{ color: '#ee5a1b', scale: 7, cut: 0.5 }, { color: '#1c1c1c', scale: 11, cut: 0.66 }] } },
];

/** Every creature this script ships. */
export function creatures(): Creature[] {
  const doe: QuadSpec = { ...DEER, id: 'doe', name: 'Deer (doe)', antlers: false, tags: DEER.tags.replace('stag ', 'doe hind fawn '), torso: 0.8, hipHeight: 0.74, neck: 0.36 };
  return [quadruped(DEER), quadruped(doe), quadruped(CAT), ...BIRDS.map(bird), ...FISH.map(fish), butterfly({ id: 'butterfly', name: 'Butterfly (monarch)', tags: 'monarch moth insect meadow garden flower flying', span: 0.05, base: '#e8761a', edge: '#1a120d', spot: '#f4f0e6', veins: '#1a120d', body: '#1a120d' })];
}

const sha = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');

async function encode(nio: NodeIO, doc: Document): Promise<Uint8Array> {
  const plain = await nio.writeBinary(doc);
  try {
    const copy = await nio.readBinary(plain);
    copy.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
    const packed = await nio.writeBinary(copy);
    return packed.byteLength < plain.byteLength ? packed : plain;
  } catch {
    return plain;
  }
}

async function main(): Promise<void> {
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const nio = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const only = process.argv.slice(2);
  const dump = process.env['LIVING_DUMP'];
  const entries: CatalogEntryInput[] = [];
  const assets: Array<{ id: string; pack: string; licence: string; authors: null; source: { archive: string; path: string }; files: Array<{ path: string; sha256: string; bytes: number }> }> = [];
  for (const c of creatures()) {
    if (only.length > 0 && !only.includes(c.id)) continue;
    const t0 = Date.now();
    const built = await buildCreature(c);
    if (dump) {
      mkdirSync(dump, { recursive: true });
      writeFileSync(join(dump, `${c.id}.glb`), await nio.writeBinary(built.doc));
      console.log(`${c.id}: ${built.tris} tris, size ${built.size.join(' x ')}, ${Date.now() - t0} ms (dump only)`);
      continue;
    }
    const glb = await encode(nio, built.doc);
    const h = sha(glb);
    const rel = `m/${c.id}.${h.slice(0, 8)}.glb`;
    mkdirSync(join(LIB, 'm'), { recursive: true });
    for (const f of readdirSync(join(LIB, 'm'))) if (new RegExp(`^${c.id}\\.[0-9a-f]{8}\\.glb$`).test(f) && `m/${f}` !== rel) unlinkSync(join(LIB, 'm', f));
    writeFileSync(join(LIB, rel), glb);
    const clips = built.doc.getRoot().listAnimations().map((a) => a.getName());
    const entry: CatalogEntryInput = {
      id: c.id,
      name: c.name,
      kind: 'model',
      category: 'animals',
      tags: tagsFor(c.id, c.name, 'animals', `${c.tags} animated realistic modelled skinned`, 'realistic'),
      style: 'realistic',
      pack: 'aether-creatures',
      size: built.size,
      tris: built.tris,
      bytes: glb.byteLength,
      file: rel,
      lods: [],
      collider: colliderFor('hull', built.positions, hullPoints),
      placement: 'floor',
      facing: '-z',
      source: 'scripts/assets/living.ts',
      anims: { ...pickRoles(clips), ...(c.roles ?? {}), clips },
    };
    entries.push(entry);
    assets.push({ id: c.id, pack: 'aether-creatures', licence: 'MIT', authors: null, source: { archive: 'Aether (code-authored)', path: 'scripts/assets/living.ts' }, files: [{ path: rel, sha256: h, bytes: glb.byteLength }] });
    console.log(`${c.id}: ${built.tris} tris, ${(glb.byteLength / 1024).toFixed(0)} KB, size ${built.size.join(' x ')}, clips ${clips.join(',')}, ${Date.now() - t0} ms`);
  }
  if (only.length > 0 || dump) return;
  Catalog.shape.entries.parse(entries);
  const out = {
    $comment: 'Living models shipped with the library. Generated by scripts/assets/living.ts; merged into catalog.json and manifest.json.',
    packs: [{ id: 'aether-creatures', title: 'Aether creatures', author: 'Aether (code-authored models)', licence: 'MIT', licenceUrl: 'https://opensource.org/license/mit', url: 'https://opensource.org/license/mit', version: '1' }],
    sources: [{ id: 'aether-creatures', provider: 'Aether', title: 'Code-authored animals', version: '1', author: 'Aether', licence: 'MIT', licenceEvidence: 'generated by scripts/assets/living.ts', archive: 'scripts/assets/living.ts', sha256: null, retrieved: '2026-10-16' }],
    entries,
    assets,
  };
  writeFileSync(join(ROOT, 'assets', 'living.json'), `${JSON.stringify(out, null, 1)}\n`);
  mergeIntoCatalog(out as unknown as Parameters<typeof mergeIntoCatalog>[0]);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : err);
    process.exit(1);
  });
}
