/**
 * The per-vertex `_TOON` values (outline width, shade bias, rim, cloth) of a finished body's head region, most common
 * first: what the toon shader will be given for the hair, the face and the neck.
 *
 *   npx tsx scripts/characters/toon-values.ts <finished.glb> [minimum height, default 1.4]
 */
import { readFileSync } from 'node:fs';
import { gltfIO } from './kaho/source';

const file = process.argv[2];
if (!file) throw new Error('usage: toon-values.ts <finished.glb> [min height]');
const min = Number(process.argv[3] ?? '1.4');
const io = await gltfIO();
const doc = await io.readBinary(new Uint8Array(readFileSync(file)));
for (const mesh of doc.getRoot().listMeshes()) {
  if (/outline/i.test(mesh.getName())) continue;
  const prim = mesh.listPrimitives()[0]!;
  const toon = prim.getAttribute('_TOON')!;
  const pos = prim.getAttribute('POSITION')!;
  const hist = new Map<string, number>();
  const v: number[] = [];
  const p: number[] = [];
  for (let i = 0; i < toon.getCount(); i++) {
    toon.getElement(i, v);
    pos.getElement(i, p);
    if (p[1]! < min) continue;
    const k = `${v[0]!.toFixed(2)} ${v[1]!.toFixed(2)} ${v[2]!.toFixed(2)} ${v[3]!.toFixed(2)}`;
    hist.set(k, (hist.get(k) ?? 0) + 1);
  }
  process.stdout.write(`${JSON.stringify([...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8))}\n`);
}
