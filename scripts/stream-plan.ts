/**
 * The cell-streaming plan of a template (packages/render/src/streaming/cell-streaming.ts): which top-level entities
 * stream, in how many cells, why the others stay resident, and which cells are resident at its opening view.
 *
 *   npx tsx scripts/stream-plan.ts [slug ...] [--tier=low] [--discrete] [--cooked=<cooked dir>] [--cells]
 *
 * `--cooked` reads `<dir>/<slug>/manifest.json` for the cells' first weights and the opening view, as the player does.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createWorld, type AssetShape, type WorldDocInput } from '@aether/core';
import { assetInfo, effectiveAssetId, fitScale, setCatalog } from '@aether/assets';
import { boxDistance, CellStreamer, cookedCellBytes, planStreaming, streamingBudget, streamingConfig, worldPartition } from '../packages/render/src/streaming/cell-streaming';

const args = process.argv.slice(2);
const flag = (k: string): string | undefined => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const tier = flag('tier') ?? 'low';
const cookedDir = flag('cooked');
const slugs = args.filter((a) => !a.startsWith('--'));
setCatalog(JSON.parse(readFileSync(resolve('assets/catalog.json'), 'utf8')) as unknown);
const assetSize = (shape: AssetShape): readonly [number, number, number] | null => {
  const info = assetInfo(effectiveAssetId(shape));
  if (!info || info.kind !== 'model') return null;
  const k = fitScale(info.size, shape.fitSize);
  return [info.size[0] * k, info.size[1] * k, info.size[2] * k];
};
for (const slug of slugs.length ? slugs : ['lisbon-hills', 'kestrel-outpost']) {
  const doc = JSON.parse(readFileSync(resolve(`apps/studio/public/templates/worlds/${slug}.json`), 'utf8')) as { world: WorldDocInput };
  const mPath = cookedDir ? join(cookedDir, slug, 'manifest.json') : null;
  const manifest = mPath && existsSync(mPath) ? (JSON.parse(readFileSync(mPath, 'utf8')) as { opening: WorldDocInput['opening']; cells: Array<{ key: string; bytes: number }> }) : null;
  const world = createWorld({ ...doc.world, ...(!doc.world.opening && manifest?.opening ? { opening: manifest.opening } : {}) });
  const p = worldPartition(world);
  if (!p) { console.log(slug, 'no partition'); continue; }
  const plan = planStreaming(world, p, assetSize);
  const s = new CellStreamer(plan, streamingConfig(p.cellSize, tier, streamingBudget(!args.includes('--discrete'))));
  if (manifest) cookedCellBytes(world, p, s, manifest.cells);
  const eye = world.opening?.position ?? world.player.spawn;
  const target = world.opening?.target;
  const dx = target ? target[0] - eye[0] : 0, dz = target ? target[2] - eye[2] : 0;
  const len = Math.hypot(dx, dz);
  const resident = new Set(s.primeAround([{ x: eye[0], z: eye[2], ...(len > 0 ? { dir: [dx / len, dz / len] as [number, number] } : {}) }]));
  console.log(slug, `cell ${p.cellSize} m`, JSON.stringify(s.stats()), 'pinned', JSON.stringify(plan.pinned));
  if (args.includes('--cells')) {
    for (const k of s.keys()) {
      const b = s.box(k)!;
      console.log(`  ${resident.has(k) ? '*' : ' '} ${k} ${s.members(k).length} entities, box ${b.map(Math.round).join(',')}, ${Math.round(boxDistance(b, eye[0], eye[2]))} m from the eye`);
    }
  }
}
