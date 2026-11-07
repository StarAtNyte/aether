/**
 * Build Kaho, the project's own anime-style body (cast id `kaho`), procedurally:
 *
 *   npx tsx scripts/characters/anime-kaho.ts
 *
 * The skeleton is the library's shared Biped (hierarchy and rest rotations
 * read from the female body `juno`) with only bone offsets changed for anime
 * proportions, so the female motion set plays on her unchanged. The mesh,
 * the painted face and every colour are generated here; no model, texture or
 * image is read except the skeleton's transforms. Writes:
 *
 * - `assets/lib/c/kaho.<hash8>.glb`: the body (meshopt), its atlas (PNG), a
 *   second mesh node sharing the geometry for the inverted-hull outline, and
 *   spring chains and colliders in the scene extras;
 * - `packages/assets/src/characters/original.ts`: her cast entry;
 * - `assets/characters-original.json`: checksum record.
 *
 * Licence: MIT, this project's own work.
 */
import { createHash } from 'node:crypto';
import { readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Document } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { Matrix4 } from 'three';
import { buildBody } from './kaho/body';
import { encodePng } from './kaho/png';
import { ATLAS_H, ATLAS_W, paintAtlas } from './kaho/paint';
import { proportionSkeleton } from './kaho/skeleton';
import { gltfIO, readBones } from './kaho/source';

const REPO = new URL('../../', import.meta.url).pathname;
const OUT = join(REPO, 'assets/lib/c');
const SOURCE_BODY = (): string => {
  const f = readdirSync(OUT).find((n) => /^juno\.[0-9a-f]{8}\.glb$/.test(n));
  if (!f) throw new Error('juno body not found in assets/lib/c');
  return join(OUT, f);
};

async function main(): Promise<void> {
  const src = await readBones(SOURCE_BODY());
  const { bones, hip } = proportionSkeleton(src);
  const body = buildBody(bones);
  const part = body.part;
  const atlas = encodePng(ATLAS_W, ATLAS_H, paintAtlas(), 4);

  const doc = new Document();
  const buffer = doc.createBuffer('kaho');
  const scene = doc.createScene('kaho');
  // Skeleton nodes.
  const nodes = bones.map((b) => doc.createNode(b.name).setTranslation([b.t.x, b.t.y, b.t.z]).setRotation([b.r.x, b.r.y, b.r.z, b.r.w]));
  bones.forEach((b, i) => {
    if (b.parent >= 0) nodes[b.parent]?.addChild(nodes[i] as ReturnType<typeof doc.createNode>);
    else scene.addChild(nodes[i] as ReturnType<typeof doc.createNode>);
  });
  const ibm: number[] = [];
  for (const b of bones) ibm.push(...new Matrix4().copy(b.world).invert().elements);
  const skin = doc
    .createSkin('kaho-skin')
    .setSkeleton(nodes[0] as ReturnType<typeof doc.createNode>)
    .setInverseBindMatrices(doc.createAccessor('ibm', buffer).setType('MAT4').setArray(new Float32Array(ibm)));
  for (const n of nodes) skin.addJoint(n);

  // Geometry.
  const n = part.count;
  const jnt = new Uint16Array(n * 4);
  const wgt = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const s = part.skin[i] ?? [];
    for (let k = 0; k < 4; k++) {
      const e = s[k];
      jnt[i * 4 + k] = e ? e[0] : 0;
      wgt[i * 4 + k] = e ? e[1] : 0;
    }
    if (s.length === 0) {
      jnt[i * 4] = 0;
      wgt[i * 4] = 1;
    }
  }
  const toon = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) toon.set(part.toon[i] as readonly number[], i * 4);
  const acc = {
    idx: doc.createAccessor('idx', buffer).setType('SCALAR').setArray(n > 65535 ? new Uint32Array(part.idx) : new Uint16Array(part.idx)),
    pos: doc.createAccessor('pos', buffer).setType('VEC3').setArray(new Float32Array(part.pos)),
    nrm: doc.createAccessor('nrm', buffer).setType('VEC3').setArray(new Float32Array(part.nrm)),
    uv: doc.createAccessor('uv', buffer).setType('VEC2').setArray(new Float32Array(part.uv)),
    jnt: doc.createAccessor('jnt', buffer).setType('VEC4').setArray(jnt),
    wgt: doc.createAccessor('wgt', buffer).setType('VEC4').setArray(wgt),
    toon: doc.createAccessor('toon', buffer).setType('VEC4').setArray(toon),
  };
  const tex = doc.createTexture('kaho-atlas').setImage(atlas).setMimeType('image/png').setURI('kaho-atlas.png');
  const matBody = doc.createMaterial('kaho-toon').setBaseColorTexture(tex).setRoughnessFactor(1).setMetallicFactor(0).setExtras({ toon: 'body' });
  const matLine = doc.createMaterial('kaho-outline').setBaseColorTexture(tex).setRoughnessFactor(1).setMetallicFactor(0).setExtras({ toon: 'outline' });
  const prim = (m: typeof matBody) =>
    doc
      .createPrimitive()
      .setMaterial(m)
      .setIndices(acc.idx)
      .setAttribute('POSITION', acc.pos)
      .setAttribute('NORMAL', acc.nrm)
      .setAttribute('TEXCOORD_0', acc.uv)
      .setAttribute('JOINTS_0', acc.jnt)
      .setAttribute('WEIGHTS_0', acc.wgt)
      .setAttribute('_TOON', acc.toon);
  const meshBody = doc.createMesh('kaho-body').addPrimitive(prim(matBody));
  const meshLine = doc.createMesh('kaho-outline').addPrimitive(prim(matLine));
  scene.addChild(doc.createNode('kaho-body').setMesh(meshBody).setSkin(skin));
  scene.addChild(doc.createNode('kaho-outline').setMesh(meshLine).setSkin(skin));
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minY = Math.min(minY, part.pos[i * 3 + 1] as number);
    maxY = Math.max(maxY, part.pos[i * 3 + 1] as number);
  }
  scene.setExtras({ toon: { springs: body.springs, colliders: body.colliders } });
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  const io = await gltfIO();
  const glb = await io.writeBinary(doc);
  const sha = createHash('sha256').update(glb).digest('hex');
  for (const f of readdirSync(OUT)) if (/^kaho\.[0-9a-f]{8}\.glb$/.test(f)) rmSync(join(OUT, f));
  const rel = `c/kaho.${sha.slice(0, 8)}.glb`;
  writeFileSync(join(REPO, 'assets/lib', rel), glb);
  const triangles = part.idx.length / 3;
  const height = Math.round((maxY - minY) * 1000) / 1000;
  const entry = { id: 'kaho', gender: 'female', look: 'anime girl, summer sailor uniform, chestnut bob with a short ponytail', file: rel, height, hip: Math.round(hip * 1000) / 1000, triangles, faces: 1, bytes: glb.byteLength, style: 'toon' };
  writeFileSync(
    join(REPO, 'packages/assets/src/characters/original.ts'),
    `/** Generated by scripts/characters/anime-kaho.ts. Do not edit. The project's own bodies (MIT), not from Rocketbox. */\nimport type { CastFile } from './library';\n\nexport const ORIGINAL_CAST: CastFile[] = ${JSON.stringify([entry], null, 1)} as CastFile[];\n`,
  );
  writeFileSync(join(REPO, 'assets/characters-original.json'), `${JSON.stringify({ source: 'scripts/characters/anime-kaho.ts', licence: 'MIT', author: 'this project', cast: [{ ...entry, sha256: sha, vertices: n, bones: bones.length }] }, null, 1)}\n`);
  console.log(`kaho: ${triangles} triangles, ${n} vertices, ${bones.length} bones, height ${height} m, hip ${hip.toFixed(3)} m, ${(glb.byteLength / 1024).toFixed(0)} KB (atlas ${(atlas.byteLength / 1024).toFixed(0)} KB) -> ${rel}`);
}

await main();
