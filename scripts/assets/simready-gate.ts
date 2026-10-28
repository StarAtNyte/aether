/**
 * Automatic quality gates of the bulk SimReady import (deterministic, no model calls). A converted model is checked on its
 * own files; a failure goes to `rejected.json` with the reasons and never reaches the dataset.
 *
 *   model gates   triangles within the budget, main file size, UVs and a base-colour texture or a real colour, normals not
 *                 inverted (signed volume of the triangle soup), plausible size, textures not all black or all white
 *   thumbnail     not blank, not near-uniform, not a black or white block (decoded with ffmpeg)
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

/** Triangle budget by size: a mug does not need what a wardrobe needs. */
export const budgetFor = (longest: number): number => (longest < 0.25 ? 3000 : longest < 0.6 ? 6000 : longest < 1.2 ? 10000 : 14000);

export const GATES = { maxMainBytes: 600 * 1024, minLongest: 0.05, maxLongest: 4, budgetSlack: 1.05 } as const;

export interface GateResult {
  ok: boolean;
  reasons: string[];
  stats: { tris: number; signedVolumeRatio: number; textures: number; texMean: number | null };
}

/** Mean and spread (0..255) of a decoded image, 16 x 16 grey, via ffmpeg. Null when ffmpeg cannot decode it. */
function imageStats(bytes: Uint8Array, alphaAware = false): { mean: number; std: number; opaque: number } | null {
  const w = 24;
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-vf', `scale=${w}:${w}:flags=area`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { input: bytes, maxBuffer: 1 << 24 });
  if (r.status !== 0 || r.stdout.length !== w * w * 4) return null;
  const v: number[] = [];
  let opaque = 0;
  for (let i = 0; i < w * w; i++) {
    const a = r.stdout[i * 4 + 3] as number;
    if (alphaAware && a < 40) continue;
    opaque++;
    v.push(0.2126 * (r.stdout[i * 4] as number) + 0.7152 * (r.stdout[i * 4 + 1] as number) + 0.0722 * (r.stdout[i * 4 + 2] as number));
  }
  if (v.length === 0) return { mean: 0, std: 0, opaque: 0 };
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const std = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  return { mean, std, opaque: opaque / (w * w) };
}

/** Thumbnail check: something is drawn, it is not one flat colour and not black or white. */
export function gateThumb(webp: Uint8Array): string[] {
  const s = imageStats(webp, true);
  if (!s) return ['thumbnail cannot be decoded'];
  const out: string[] = [];
  if (s.opaque < 0.04) out.push(`thumbnail is blank (${(s.opaque * 100).toFixed(1)}% drawn)`);
  else {
    if (s.std < 5) out.push(`thumbnail is near-uniform (std ${s.std.toFixed(1)})`);
    if (s.mean < 10) out.push(`thumbnail is black (mean ${s.mean.toFixed(0)})`);
    if (s.mean > 250) out.push(`thumbnail is white (mean ${s.mean.toFixed(0)})`);
  }
  return out;
}

let io: NodeIO | null = null;
async function reader(): Promise<NodeIO> {
  await MeshoptDecoder.ready;
  io ??= new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  return io;
}

/** Gate the main GLB of one converted model. `budget` is the triangle budget it was built with. */
export async function gateModel(file: string, o: { budget: number; size: [number, number, number] }): Promise<GateResult> {
  const reasons: string[] = [];
  const raw = readFileSync(file);
  if (raw.byteLength > GATES.maxMainBytes) reasons.push(`main file ${(raw.byteLength / 1024).toFixed(0)} KB over ${GATES.maxMainBytes / 1024} KB`);
  const longest = Math.max(...o.size);
  if (!(longest >= GATES.minLongest && longest <= GATES.maxLongest)) reasons.push(`size ${o.size.map((v) => v.toFixed(2)).join(' x ')} m outside ${GATES.minLongest} to ${GATES.maxLongest} m`);
  if (o.size.some((v) => !Number.isFinite(v))) reasons.push('size is not finite');
  const doc = await (await reader()).readBinary(new Uint8Array(raw));
  let tris = 0;
  let vol = 0;
  let missingUv = 0;
  let prims = 0;
  const nodes = doc.getRoot().listNodes().filter((n) => n.getMesh());
  for (const n of nodes) {
    const m = n.getWorldMatrix();
    for (const p of n.getMesh()!.listPrimitives()) {
      prims++;
      const pos = p.getAttribute('POSITION');
      if (!pos) continue;
      const idx = p.getIndices();
      const count = idx ? idx.getCount() : pos.getCount();
      tris += Math.floor(count / 3);
      if (!p.getAttribute('TEXCOORD_0')) missingUv++;
      const a = [0, 0, 0];
      const b = [0, 0, 0];
      const c = [0, 0, 0];
      const get = (out: number[], i: number): void => {
        const q = pos.getElement(i, [0, 0, 0]);
        out[0] = m[0]! * q[0]! + m[4]! * q[1]! + m[8]! * q[2]! + m[12]!;
        out[1] = m[1]! * q[0]! + m[5]! * q[1]! + m[9]! * q[2]! + m[13]!;
        out[2] = m[2]! * q[0]! + m[6]! * q[1]! + m[10]! * q[2]! + m[14]!;
      };
      for (let t = 0; t + 2 < count; t += 3) {
        get(a, idx ? idx.getScalar(t) : t);
        get(b, idx ? idx.getScalar(t + 1) : t + 1);
        get(c, idx ? idx.getScalar(t + 2) : t + 2);
        vol += (a[0]! * (b[1]! * c[2]! - b[2]! * c[1]!) - a[1]! * (b[0]! * c[2]! - b[2]! * c[0]!) + a[2]! * (b[0]! * c[1]! - b[1]! * c[0]!)) / 6;
      }
    }
  }
  if (tris === 0) reasons.push('no triangles');
  if (tris > o.budget * GATES.budgetSlack) reasons.push(`${tris} triangles over the budget ${o.budget}`);
  const boxVol = Math.max(1e-9, o.size[0] * o.size[1] * o.size[2]);
  const ratio = vol / boxVol;
  // Closed shells have a clearly positive volume when wound outwards; open or thin meshes sum to about nothing and pass.
  if (ratio < -0.03) reasons.push(`normals inverted (signed volume ${(ratio * 100).toFixed(1)}% of the box)`);
  const mats = doc.getRoot().listMaterials();
  const textured = mats.filter((m) => m.getBaseColorTexture());
  if (textured.length > 0 && missingUv > 0) reasons.push(`${missingUv} of ${prims} primitives have no UVs but the model is textured`);
  if (textured.length === 0) {
    const flat = mats.length === 0 || mats.every((m) => m.getBaseColorFactor().slice(0, 3).every((v) => v >= 0.995));
    if (flat) reasons.push('no base-colour texture and only the default white colour');
  }
  let texMean: number | null = null;
  for (const m of textured) {
    const img = m.getBaseColorTexture()!.getImage();
    if (!img) continue;
    const s = imageStats(img);
    if (!s) continue;
    texMean = texMean === null ? s.mean : Math.min(texMean, s.mean);
    if (s.mean < 6 && s.std < 4) reasons.push(`base-colour texture is black (mean ${s.mean.toFixed(0)})`);
    else if (s.mean > 250 && s.std < 4) reasons.push(`base-colour texture is white (mean ${s.mean.toFixed(0)})`);
  }
  return { ok: reasons.length === 0, reasons, stats: { tris, signedVolumeRatio: ratio, textures: doc.getRoot().listTextures().length, texMean } };
}
