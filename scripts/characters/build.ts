/**
 * Build the character library (offline; needs the Rocketbox sources, see
 * docs/CHARACTERS.md):
 *
 *   npm run characters:build
 *
 * Reads `$AETHER_CHARACTER_SRC` (default `~/.local/share/aether/characters-src`,
 * a checkout of the Rocketbox `Assets/` folder subset the fetch step pulls),
 * converts every cast body and the two motion sets, writes content-hashed
 * files to `assets/lib/c/`, records checksums in `assets/characters.json` and
 * regenerates `packages/assets/src/characters/generated.ts`.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, EXTTextureWebP } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { CAST_SOURCES, CLIPS, type CastSource } from './cast';
import { bakeClip, convertAvatar, footContacts, jointNames, readOpt, type BakedClip, type UvPlanes } from './convert';
import { authoredClips } from './authored';

const REPO = new URL('../../', import.meta.url).pathname;
const SRC = process.env['AETHER_CHARACTER_SRC'] ?? join(homedir(), '.local/share/aether/characters-src');
const OUT = join(REPO, 'assets/lib/c');
const COMMIT = '0943055db6ec570bcef9f2c8b41c9e5467c808f9';

const round3 = (v: number): number => Math.round(v * 1000) / 1000;
const sha = (d: Uint8Array): string => createHash('sha256').update(d).digest('hex');

async function io(): Promise<NodeIO> {
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  return new NodeIO().registerExtensions([EXTMeshoptCompression, EXTTextureWebP]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
}

function emit(name: string, data: Uint8Array): { path: string; sha256: string; bytes: number } {
  const h = sha(data);
  const rel = `c/${name}.${h.slice(0, 8)}.glb`;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(REPO, 'assets/lib', rel), data);
  return { path: rel, sha256: h, bytes: data.byteLength };
}

/** Convert one body's textures; the mesh's UV planes (a first conversion without textures) drive the outfit masks. */
function emitRaw(name: string, ext: string, data: Uint8Array): { path: string; sha256: string; bytes: number } {
  const h = sha(data);
  const rel = `c/${name}.${h.slice(0, 8)}.${ext}`;
  writeFileSync(join(REPO, 'assets/lib', rel), data);
  return { path: rel, sha256: h, bytes: data.byteLength };
}

function textures(c: CastSource, uv: UvPlanes, height: number): { masks: Uint8Array | undefined; files: Record<string, Uint8Array | undefined>; refs: { top: number; bottom: number; hair: number }; debug: string } {
  const dir = join(SRC, 'Assets/Avatars/Adults', c.src, 'Textures');
  const tmp = join(tmpdir(), `aether-char-${c.id}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const uvFile = join(tmp, '..', `aether-char-${c.id}.uv.bin`);
  writeFileSync(uvFile, Buffer.concat([uv.bodyY, uv.bodyHw, uv.headY].map((a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength))));
  const r = spawnSync('python3', ['-I', join(REPO, 'scripts/characters/textures.py'), dir, tmp, uvFile, String(height)], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`textures failed for ${c.id}: ${r.stderr}`);
  const f = (n: string): Uint8Array | undefined => readOpt(join(tmp, n));
  const refs = JSON.parse(readFileSync(join(tmp, 'refs.json'), 'utf8')) as { top: number; bottom: number; hair: number };
  return { masks: f('masks.webp'), files: { bodyColor: f('body_color.webp'), bodyNormal: f('body_normal.webp'), bodyMr: f('body_mr.webp'), headColor: f('head_color.webp'), headNormal: f('head_normal.webp'), headMr: f('head_mr.webp'), hair: f('hair.webp') }, refs, debug: join(tmp, '_debug') };
}

/** Animation document: the skeleton's node tree plus one animation per clip. */
function animationDoc(skeleton: Document, clips: BakedClip[]): Document {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('motions');
  const byName = new Map<string, ReturnType<Document['createNode']>>();
  const copy = (src: ReturnType<Document['createNode']>, parent: ReturnType<Document['createNode']> | null): void => {
    const n = doc.createNode(src.getName()).setTranslation(src.getTranslation()).setRotation(src.getRotation());
    byName.set(src.getName(), n);
    if (parent) parent.addChild(n);
    else scene.addChild(n);
    for (const c of src.listChildren()) copy(c, n);
  };
  const skin = skeleton.getRoot().listSkins()[0];
  const root = skin?.getSkeleton();
  if (!root) throw new Error('avatar has no skeleton root');
  copy(root, null);
  for (const c of clips) {
    const anim = doc.createAnimation(c.name).setExtras({ stride: c.stride, duration: Math.round(c.duration * 1000) / 1000 });
    for (const t of c.tracks) {
      const node = byName.get(t.node);
      if (!node) continue;
      const input = doc.createAccessor(`${c.name}-t`, buffer).setType('SCALAR').setArray(t.times);
      const output = doc
        .createAccessor(`${c.name}-${t.node}`, buffer)
        .setType(t.path === 'rotation' ? 'VEC4' : 'VEC3');
      if (t.path === 'rotation') {
        // Unit quaternions as normalised int16: half the size, error below 3e-5.
        const q = new Int16Array(t.values.length);
        for (let i = 0; i < q.length; i++) q[i] = Math.round((t.values[i] as number) * 32767);
        output.setArray(q).setNormalized(true);
      } else output.setArray(t.values);
      const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
      anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(t.path).setSampler(sampler));
    }
  }
  return doc;
}

/** Reference hip height (m) of a motion set: the root bone's height in its idle clip. */
function idleHip(idle: BakedClip): number {
  const t = idle.tracks.find((x) => x.node === 'Bip01' && x.path === 'translation');
  return t ? Math.round((t.values[1] as number) * 1000) / 1000 : 0.9;
}

const SRC_DIRS = ['static', 'xy', 'xyz'].map((d) => join(SRC, 'Assets/Animations', `all_animations_max_motextr_${d}`));

function clipFile(prefix: string, base: string): string | null {
  for (const d of SRC_DIRS) {
    const f = join(d, `${prefix}_${base}.max.fbx`);
    if (existsSync(f)) return f;
  }
  return null;
}

async function main(): Promise<void> {
  const nio = await io();
  mkdirSync(OUT, { recursive: true });
  for (const f of readdirSync(OUT)) rmSync(join(OUT, f));
  const cast: Array<Record<string, unknown>> = [];
  let firstSkeleton: Document | null = null;
  let boneSet = new Set<string>();
  for (const c of CAST_SOURCES) {
    const fbx = join(SRC, 'Assets/Avatars/Adults', c.src, 'Export', `${c.src}.fbx`);
    const first = convertAvatar(fbx, c.id, {});
    const tex = textures(c, first.uv, first.info.height);
    if (process.env['AETHER_CHARACTER_DEBUG']) {
      mkdirSync(process.env['AETHER_CHARACTER_DEBUG'], { recursive: true });
      writeFileSync(join(process.env['AETHER_CHARACTER_DEBUG'], `${c.id}-masks.png`), readFileSync(join(tex.debug, 'masks.png')));
    }
    const { doc, info } = convertAvatar(fbx, c.id, tex.files);
    if (!firstSkeleton) {
      firstSkeleton = doc;
      boneSet = new Set([...jointNames(doc), 'Bip01']);
    }
    doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
    const file = emit(c.id, await nio.writeBinary(doc));
    const masks = tex.masks ? emitRaw(`${c.id}.masks`, 'webp', tex.masks) : null;
    console.log(c.id, info.triangles, 'tris', info.height.toFixed(2), 'm', (file.bytes / 1024).toFixed(0), 'KB');
    cast.push({ ...c, ...info, tintTop: round3(tex.refs.top), tintBottom: round3(tex.refs.bottom), tintHair: round3(tex.refs.hair), height: Math.round(info.height * 1000) / 1000, hip: Math.round(info.hip * 1000) / 1000, file: file.path, sha256: file.sha256, bytes: file.bytes, masks: masks?.path ?? null, maskBytes: masks?.bytes ?? 0, source: `Assets/Avatars/Adults/${c.src}` });
  }
  if (!firstSkeleton) throw new Error('empty cast');
  const sets: Array<Record<string, unknown>> = [];
  for (const [gender, prefix] of [['male', 'm'], ['female', 'f']] as const) {
    const clips: BakedClip[] = [];
    for (const [base, name] of CLIPS) {
      const f = clipFile(prefix, base);
      if (!f) {
        console.warn('missing clip', prefix, base);
        continue;
      }
      clips.push(bakeClip(f, name, boneSet));
    }
    const idle = clips.find((c) => c.name === 'idle');
    if (!idle) throw new Error('no idle clip');
    clips.push(...authoredClips(firstSkeleton, idle, boneSet));
    const doc = animationDoc(firstSkeleton, clips);
    const file = emit(`motions-${gender}`, await nio.writeBinary(doc));
    console.log('motions', gender, clips.length, 'clips', (file.bytes / 1024).toFixed(0), 'KB');
    sets.push({ gender, file: file.path, sha256: file.sha256, bytes: file.bytes, clips: clips.map((c) => ({ name: c.name, duration: Math.round(c.duration * 1000) / 1000, stride: c.stride, ...(c.stride > 0.3 && c.duration > 0.4 ? { contacts: footContacts(c, firstSkeleton as Document) } : {}) })), hip: idleHip(idle) });
  }
  const record = { source: 'Microsoft Rocketbox', licence: 'MIT', url: 'https://github.com/microsoft/Microsoft-Rocketbox', commit: COMMIT, cast, motions: sets };
  writeFileSync(join(REPO, 'assets/characters.json'), `${JSON.stringify(record, null, 1)}\n`);
  const licence = readFileSync(join(SRC, 'LICENSE.md'), 'utf8');
  writeFileSync(join(REPO, 'assets/characters-LICENSE.md'), licence);
  const ts = `/** Generated by scripts/characters/build.ts. Do not edit. */\nimport type { CharacterLibrary } from './library';\n\nexport const GENERATED_LIBRARY: CharacterLibrary = ${JSON.stringify(
    {
      cast: cast.map((c) => ({ id: c['id'], gender: c['gender'], look: c['look'], file: c['file'], height: c['height'], hip: c['hip'], triangles: c['triangles'], faces: c['faces'], bytes: c['bytes'], masks: c['masks'], tintTop: c['tintTop'], tintBottom: c['tintBottom'], tintHair: c['tintHair'] })),
      motions: sets.map((s) => ({ gender: s['gender'], file: s['file'], bytes: s['bytes'], hip: s['hip'], clips: s['clips'] })),
    },
    null,
    1,
  )} as unknown as CharacterLibrary;\n`;
  mkdirSync(join(REPO, 'packages/assets/src/characters'), { recursive: true });
  writeFileSync(join(REPO, 'packages/assets/src/characters/generated.ts'), ts);
}

await main();
