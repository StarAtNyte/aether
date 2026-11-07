/**
 * The character pipeline's last step (`scripts/blender/character/build.py` calls it; see docs/BLENDER-HARNESS.md):
 * turn the Blender export of a character into a body the runtime plays, and optionally install it in the asset library.
 *
 *   npx tsx scripts/characters/finish-character.ts --in <dir>/<id>.blender.glb --meta <dir>/<id>.meta.json --out <dir>/<id>.glb [--install]
 *
 * - Checks the skeleton is the shared Biped (the `Bip01_*` bones the female and male motion sets drive), so every clip of
 *   the motion set plays on it; clips the file carries (a character's extra beats) are kept, and the runtime adds them to
 *   the motion set (`characters/system.ts`).
 * - Anime style (`meta.style: 'anime'`): the toon path of `packages/render/src/characters/toon.ts`: the body material
 *   marked `toon: 'body'`, a second node sharing the geometry for the inverted-hull outline (`toon: 'outline'`), the
 *   `_TOON` vertex attribute (outline width, shade bias, rim strength, spare: from `_TOON` in the export, else
 *   `COLOR_0`, else defaults), and the spring chains and colliders in the scene extras. Realistic style keeps the
 *   export's glTF PBR materials.
 * - Meshopt compression; with `--install`, `assets/lib/c/<id>.<hash8>.glb` and the original cast entries
 *   (`assets/characters-original.json`, `packages/assets/src/characters/original.ts`), keeping the other originals.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type Document, type Node, type Primitive } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { gltfIO } from './kaho/source';

const REPO = new URL('../../', import.meta.url).pathname;

/** The Biped bones a body must have for the shared motion sets. */
export const REQUIRED_BONES = [
  'Bip01', 'Bip01_Pelvis', 'Bip01_Spine', 'Bip01_Spine1', 'Bip01_Spine2', 'Bip01_Neck', 'Bip01_Head',
  'Bip01_L_Clavicle', 'Bip01_L_UpperArm', 'Bip01_L_Forearm', 'Bip01_L_Hand', 'Bip01_R_Clavicle', 'Bip01_R_UpperArm', 'Bip01_R_Forearm', 'Bip01_R_Hand',
  'Bip01_L_Thigh', 'Bip01_L_Calf', 'Bip01_L_Foot', 'Bip01_L_Toe0', 'Bip01_R_Thigh', 'Bip01_R_Calf', 'Bip01_R_Foot', 'Bip01_R_Toe0',
] as const;

export interface CharacterMeta {
  id: string;
  name?: string;
  style: 'anime' | 'realistic';
  gender?: 'female' | 'male';
  look?: string;
  /** +1 when the body faces +Z in the file (Blender's -Y forward exports as +Z). */
  faces?: 1 | -1;
  springs?: unknown[];
  colliders?: unknown[];
}

/** The cast entry of an original body (packages/assets CastFile). */
interface CastEntry {
  id: string;
  gender: string;
  look: string;
  file: string;
  height: number;
  hip: number;
  triangles: number;
  faces: 1 | -1;
  bytes: number;
  style?: 'toon';
}

const arg = (k: string): string | undefined => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/** World matrix of a node (its parents' transforms applied). */
function worldOf(n: Node): Matrix4 {
  const chain: Node[] = [];
  for (let c: Node | null = n; c; c = c.getParentNode()) chain.unshift(c);
  const m = new Matrix4();
  for (const c of chain) {
    const t = c.getTranslation();
    const r = c.getRotation();
    const s = c.getScale();
    m.multiply(new Matrix4().compose(new Vector3(t[0], t[1], t[2]), new Quaternion(r[0], r[1], r[2], r[3]), new Vector3(s[0], s[1], s[2])));
  }
  return m;
}

/** The per-vertex toon values: the export's `_TOON`, else `COLOR_0` (RGB[A]), else outline 1, bias 0, rim 1. */
function toonAccessor(doc: Document, prim: Primitive): void {
  if (prim.getAttribute('_TOON')) return;
  const pos = prim.getAttribute('POSITION');
  if (!pos) return;
  const n = pos.getCount();
  const out = new Float32Array(n * 4);
  const col = prim.getAttribute('COLOR_0');
  const v: number[] = [];
  for (let i = 0; i < n; i++) {
    if (col) {
      col.getElement(i, v);
      out.set([v[0] ?? 1, v[1] ?? 0, v[2] ?? 1, v[3] ?? 0], i * 4);
    } else out.set([1, 0, 1, 0], i * 4);
  }
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  prim.setAttribute('_TOON', doc.createAccessor('toon', buffer).setType('VEC4').setArray(out));
  if (col) prim.setAttribute('COLOR_0', null);
}

export async function finishCharacter(inFile: string, meta: CharacterMeta, outFile: string, install: boolean): Promise<{ entry: CastEntry; sha: string }> {
  const io = await gltfIO();
  const doc = await io.read(inFile);
  const root = doc.getRoot();
  const scene = root.listScenes()[0];
  if (!scene) throw new Error('the export has no scene');
  const names = new Set(root.listNodes().map((n) => n.getName()));
  const missing = REQUIRED_BONES.filter((b) => !names.has(b));
  if (missing.length > 0) throw new Error(`the skeleton is not the shared Biped: missing ${missing.join(', ')}`);
  const skinned = root.listNodes().filter((n) => n.getMesh() && n.getSkin());
  const body = skinned.find((n) => n.getName() === `${meta.id}-body`) ?? skinned[0];
  if (!body) throw new Error('no skinned mesh in the export');
  body.setName(`${meta.id}-body`);
  const mesh = body.getMesh()!;
  mesh.setName(`${meta.id}-body`);
  const anime = meta.style === 'anime';
  if (anime) {
    const outline = doc.createMesh(`${meta.id}-outline`);
    const lines = new Map<string, ReturnType<Document['createMaterial']>>();
    for (const prim of mesh.listPrimitives()) {
      toonAccessor(doc, prim);
      const mat = prim.getMaterial() ?? doc.createMaterial(`${meta.id}-toon`);
      mat.setExtras({ ...(mat.getExtras() as object), toon: 'body' }).setMetallicFactor(0).setRoughnessFactor(1);
      prim.setMaterial(mat);
      let line = lines.get(mat.getName());
      if (!line) {
        line = doc.createMaterial(`${mat.getName()}-outline`).setBaseColorTexture(mat.getBaseColorTexture()).setRoughnessFactor(1).setMetallicFactor(0).setExtras({ toon: 'outline' });
        lines.set(mat.getName(), line);
      }
      // The outline shares the body's accessors (and morph targets): one geometry, two draws.
      const p = doc.createPrimitive().setMaterial(line).setMode(prim.getMode());
      const idx = prim.getIndices();
      if (idx) p.setIndices(idx);
      for (const sem of prim.listSemantics()) p.setAttribute(sem, prim.getAttribute(sem));
      for (const t of prim.listTargets()) p.addTarget(t);
      outline.addPrimitive(p);
    }
    const w = mesh.getWeights();
    if (w.length > 0) outline.setWeights(w);
    const extras = mesh.getExtras() as { targetNames?: string[] };
    if (extras.targetNames) outline.setExtras({ targetNames: extras.targetNames });
    const node = doc.createNode(`${meta.id}-outline`).setMesh(outline).setSkin(body.getSkin());
    const parent = body.getParentNode();
    if (parent) parent.addChild(node);
    else scene.addChild(node);
    scene.setExtras({ ...(scene.getExtras() as object), toon: { springs: meta.springs ?? [], colliders: meta.colliders ?? [] } });
  }
  // Height and hip in the bind pose.
  let minY = Infinity;
  let maxY = -Infinity;
  let triangles = 0;
  const v: number[] = [];
  const bodyWorld = worldOf(body);
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION')!;
    const p = new Vector3();
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v);
      p.set(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0).applyMatrix4(bodyWorld);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    triangles += (prim.getIndices()?.getCount() ?? pos.getCount()) / 3;
  }
  const pelvis = root.listNodes().find((n) => n.getName() === 'Bip01_Pelvis')!;
  const hip = new Vector3().setFromMatrixPosition(worldOf(pelvis)).y - minY;
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  const glb = await io.writeBinary(doc);
  writeFileSync(outFile, glb);
  const sha = createHash('sha256').update(glb).digest('hex');
  const rel = `c/${meta.id}.${sha.slice(0, 8)}.glb`;
  const entry: CastEntry = {
    id: meta.id,
    gender: meta.gender ?? 'female',
    look: (meta.look ?? meta.name ?? meta.id).slice(0, 200),
    file: rel,
    height: Math.round((maxY - minY) * 1000) / 1000,
    hip: Math.round(hip * 1000) / 1000,
    triangles: Math.round(triangles),
    faces: meta.faces ?? 1,
    bytes: glb.byteLength,
    ...(anime ? { style: 'toon' as const } : {}),
  };
  if (install) installCast(entry, glb, sha);
  return { entry, sha };
}

/** Write the body into the library and its entry into the original cast (the other originals kept). */
export function installCast(entry: CastEntry, glb: Uint8Array, sha: string): void {
  const dir = join(REPO, 'assets/lib/c');
  for (const f of readdirSync(dir)) if (new RegExp(`^${entry.id}\\.[0-9a-f]{8}\\.glb$`).test(f)) rmSync(join(dir, f));
  writeFileSync(join(REPO, 'assets/lib', entry.file), glb);
  const recordFile = join(REPO, 'assets/characters-original.json');
  const record = existsSync(recordFile) ? (JSON.parse(readFileSync(recordFile, 'utf8')) as { cast: Array<CastEntry & { sha256: string }> }) : { cast: [] };
  const cast = record.cast.filter((c) => c.id !== entry.id);
  cast.push({ ...entry, sha256: sha });
  cast.sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(recordFile, `${JSON.stringify({ source: 'scripts/blender/character/build.py (scripts/characters/finish-character.ts)', licence: 'MIT', author: 'this project', cast }, null, 1)}\n`);
  const entries = cast.map(({ sha256: _sha, ...e }) => e);
  writeFileSync(
    join(REPO, 'packages/assets/src/characters/original.ts'),
    `/** Generated by scripts/characters/finish-character.ts. Do not edit. The project's own bodies (MIT), not from Rocketbox. */\nimport type { CastFile } from './library';\n\nexport const ORIGINAL_CAST: CastFile[] = ${JSON.stringify(entries, null, 1)} as CastFile[];\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const inFile = arg('in');
  const metaFile = arg('meta');
  const outFile = arg('out');
  if (!inFile || !metaFile || !outFile) throw new Error('usage: finish-character.ts --in <x.blender.glb> --meta <x.meta.json> --out <x.glb> [--install]');
  const meta = JSON.parse(readFileSync(metaFile, 'utf8')) as CharacterMeta;
  const { entry } = await finishCharacter(inFile, meta, outFile, process.argv.includes('--install'));
  console.log(JSON.stringify(entry));
}
