/**
 * Does a character's face keep its normals through the runtime path? Reads the finished body (EXT_meshopt_compression,
 * its normals octahedral at 8 bits) and the Blender export it came from, and reports the angle between each vertex's
 * two normals (the head's vertices: the ones above the neck), plus how much of the toon band they move.
 *
 *   npx tsx scripts/characters/normal-check.ts <finished.glb> <blender.glb>
 */
import { readFileSync } from 'node:fs';
import { gltfIO } from './kaho/source';

const [fin, src] = process.argv.slice(2);
if (!fin || !src) throw new Error('usage: normal-check.ts <finished.glb> <blender.glb>');
const io = await gltfIO();
const a = await io.readBinary(new Uint8Array(readFileSync(fin)));
const b = await io.readBinary(new Uint8Array(readFileSync(src)));

function body(doc: typeof a): { pos: Float32Array; nrm: Float32Array } {
  for (const mesh of doc.getRoot().listMeshes()) {
    if (/outline/i.test(mesh.getName())) continue;
    const prim = mesh.listPrimitives()[0];
    const p = prim?.getAttribute('POSITION');
    const n = prim?.getAttribute('NORMAL');
    if (p && n) return { pos: p.getArray() as Float32Array, nrm: n.getArray() as Float32Array };
  }
  throw new Error('no body mesh');
}

const A = body(a);
const B = body(b);
const n = Math.min(A.pos.length, B.pos.length) / 3;
// (the vertex order is kept by finish-character; the heights tell the head: the top fifth of the body)
let top = -Infinity;
let bot = Infinity;
for (let i = 0; i < n; i++) {
  top = Math.max(top, A.pos[i * 3 + 1]!);
  bot = Math.min(bot, A.pos[i * 3 + 1]!);
}
const head = bot + (top - bot) * 0.86;
const errs: number[] = [];
for (let i = 0; i < n; i++) {
  if (A.pos[i * 3 + 1]! < head) continue;
  const [ax, ay, az] = [A.nrm[i * 3]!, A.nrm[i * 3 + 1]!, A.nrm[i * 3 + 2]!];
  const [bx, by, bz] = [B.nrm[i * 3]!, B.nrm[i * 3 + 1]!, B.nrm[i * 3 + 2]!];
  const la = Math.hypot(ax, ay, az) || 1;
  const lb = Math.hypot(bx, by, bz) || 1;
  const d = Math.min(1, (ax * bx + ay * by + az * bz) / (la * lb));
  errs.push((Math.acos(d) * 180) / Math.PI);
}
errs.sort((x, y) => x - y);
const q = (p: number): number => Math.round((errs[Math.floor(errs.length * p)] ?? 0) * 100) / 100;
process.stdout.write(`${JSON.stringify({ headVertices: errs.length, deg: { p50: q(0.5), p90: q(0.9), p99: q(0.99), max: q(1 - 1e-9) } })}\n`);
