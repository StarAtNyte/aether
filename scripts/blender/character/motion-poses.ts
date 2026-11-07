/**
 * Sample poses of the shared motion set for the character pipeline (scripts/blender/character/build.py): the base pose
 * its own clips start from, and the frames its interpenetration check poses the clothes through.
 *
 *   npx tsx scripts/blender/character/motion-poses.ts --gender female --out <file.json> [--frames 6]
 *
 * Writes { hip, clips: { name: { duration, frames: [ { t, bones: { Bip01_X: { r: [x, y, z, w], t?: [x, y, z] } } } ] } } }
 * with glTF local rotations (and the root's translation) per bone.
 */
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gltfIO } from '../../characters/kaho/source';

const REPO = new URL('../../../', import.meta.url).pathname;
const arg = (k: string, d?: string): string | undefined => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const gender = arg('gender', 'female')!;
const out = arg('out');
const nFrames = Number(arg('frames', '6'));
if (!out) throw new Error('--out <file> is required');
const QA_CLIPS = ['idle', 'walk', 'run', 'jog', 'sprint', 'sit', 'crouch', 'wave', 'jump_air', 'run_stop', 'talk', 'pickup', 'turn_around'];

const dir = join(REPO, 'assets/lib/c');
const file = readdirSync(dir).find((f) => new RegExp(`^motions-${gender}\\.[0-9a-f]{8}\\.glb$`).test(f));
if (!file) throw new Error(`no motions-${gender} file`);
const doc = await (await gltfIO()).read(join(dir, file));
const root = doc.getRoot();
const result: { hip: number; clips: Record<string, { duration: number; frames: Array<{ t: number; bones: Record<string, { r?: number[]; t?: number[] }> }> }> } = { hip: 0, clips: {} };
const bip = root.listNodes().find((n) => n.getName() === 'Bip01');
result.hip = bip ? bip.getTranslation()[1] : 0.9;

function sample(input: Float32Array | number[], output: ArrayLike<number>, size: number, t: number, quat: boolean): number[] {
  const n = input.length;
  if (t <= (input[0] ?? 0)) return Array.from({ length: size }, (_, k) => output[k] ?? 0);
  if (t >= (input[n - 1] ?? 0)) return Array.from({ length: size }, (_, k) => output[(n - 1) * size + k] ?? 0);
  let i = 0;
  while (i < n - 2 && (input[i + 1] ?? 0) < t) i++;
  const a = input[i] ?? 0;
  const b = input[i + 1] ?? 0;
  const f = b > a ? (t - a) / (b - a) : 0;
  const v: number[] = [];
  let dot = 0;
  for (let k = 0; k < size; k++) dot += (output[i * size + k] ?? 0) * (output[(i + 1) * size + k] ?? 0);
  const sgn = quat && dot < 0 ? -1 : 1;
  for (let k = 0; k < size; k++) v.push((output[i * size + k] ?? 0) * (1 - f) + sgn * (output[(i + 1) * size + k] ?? 0) * f);
  if (quat) {
    const l = Math.hypot(...v) || 1;
    for (let k = 0; k < size; k++) v[k] = (v[k] ?? 0) / l;
  }
  return v;
}

for (const anim of root.listAnimations()) {
  const name = anim.getName();
  if (!QA_CLIPS.includes(name)) continue;
  let duration = 0;
  for (const s of anim.listSamplers()) duration = Math.max(duration, (s.getInput()?.getMax([]) as number[])[0] ?? 0);
  const frames = [];
  const count = name === 'idle' ? 1 : nFrames;
  for (let f = 0; f < count; f++) {
    const t = count === 1 ? 0 : (duration * f) / count;
    const bones: Record<string, { r?: number[]; t?: number[] }> = {};
    for (const ch of anim.listChannels()) {
      const node = ch.getTargetNode();
      const path = ch.getTargetPath();
      const s = ch.getSampler();
      if (!node || !s || (path !== 'rotation' && path !== 'translation')) continue;
      if (path === 'translation' && node.getName() !== 'Bip01') continue;
      const input = s.getInput()!.getArray() as Float32Array;
      const acc = s.getOutput()!;
      const size = path === 'rotation' ? 4 : 3;
      const output = new Float32Array(acc.getCount() * size);
      const el: number[] = [];
      for (let i = 0; i < acc.getCount(); i++) output.set(acc.getElement(i, el).slice(0, size), i * size);
      const v = sample(input, output, size, t, path === 'rotation');
      if (path === 'rotation') {
        const l = Math.hypot(...v) || 1;
        for (let k = 0; k < 4; k++) v[k] = (v[k] ?? 0) / l;
      }
      const e = (bones[node.getName()] ??= {});
      if (path === 'rotation') e.r = v;
      else e.t = v;
    }
    frames.push({ t, bones });
  }
  result.clips[name] = { duration, frames };
}
writeFileSync(out, JSON.stringify(result));
console.log(`motion poses: ${Object.keys(result.clips).length} clips -> ${out}`);
