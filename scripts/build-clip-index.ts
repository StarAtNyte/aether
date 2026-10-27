/**
 * Embed the library thumbnails with the CLIP vision tower (OpenAI CLIP ViT-B/32, MIT) into assets/clip-index.json, the small index
 * behind `find_model {like_crop}` (appearance retrieval). Entry ids and thumbnails come from assets/catalog.json; the embedding of
 * each is int8 (x127 of the unit vector), base64. Run after the catalog changes:  npx tsx scripts/build-clip-index.ts
 * Needs ffmpeg (webp decode) and the CLIP weights (fetched on first use, see docs/THIRD_PARTY.md).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadClip } from '../packages/agent/src/photo/perception/clip';

const cat = JSON.parse(readFileSync('assets/catalog.json', 'utf8')) as { entries: { id: string; thumb?: string }[] };
const l = await loadClip();
if (!l.ok) throw new Error(l.reason);
const ids: string[] = [];
const rows: Int8Array[] = [];
for (const e of cat.entries) {
  if (!e.thumb) continue;
  const dec = spawnSync('ffmpeg', ['-v', 'error', '-i', `assets/lib/${e.thumb}`, '-vf', 'scale=224:224:flags=area', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { maxBuffer: 1 << 26 });
  if (dec.status !== 0 || dec.stdout.length !== 224 * 224 * 4) { console.log('skip', e.id); continue; }
  const raster = { width: 224, height: 224, data: new Uint8ClampedArray(dec.stdout.buffer, dec.stdout.byteOffset, dec.stdout.length) };
  const [emb] = await l.model.embed(raster, [{ box: [0, 0, 1, 1] }]);
  if (!emb) continue;
  ids.push(e.id);
  rows.push(Int8Array.from(emb, (v) => Math.round(v * 127)));
  if (ids.length % 100 === 0) console.log(ids.length);
}
const all = new Int8Array(rows.length * 512);
rows.forEach((r, i) => all.set(r, i * 512));
writeFileSync('assets/clip-index.json', JSON.stringify({ model: 'openai/clip-vit-base-patch32 (Xenova ONNX uint8 vision tower)', dim: 512, count: ids.length, ids, emb: Buffer.from(all.buffer).toString('base64') }));
console.log('wrote assets/clip-index.json', ids.length);
await l.model.dispose();
