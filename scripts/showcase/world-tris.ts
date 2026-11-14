/**
 * Triangle census of a world file: generates every procedural / scatter / mesh entity in Node and totals its triangles by
 * generator (scatter layers count their instances), the budget the player draws before culling and virtual-geometry LOD.
 *
 *   npx tsx scripts/showcase/world-tris.ts <world.json> [--each]
 */
import { readFileSync } from 'node:fs';
import { generate } from '@aether/procgen';
import { createNodeSandbox } from '@aether/procgen/node';

const file = process.argv[2];
if (!file) throw new Error('usage: world-tris.ts <world.json> [--each]');
const each = process.argv.includes('--each');
const doc = JSON.parse(readFileSync(file, 'utf8'));
const world = doc.world ?? doc;
const sandbox = createNodeSandbox({ timeoutMs: 120_000 });
const by = new Map<string, { n: number; tris: number; max: number }>();
let total = 0;
try {
  for (const [id, e] of Object.entries(world.entities as Record<string, { shape: any }>)) {
    const s = e.shape;
    let key: string;
    let tris = 0;
    if (s.kind === 'procedural' || s.kind === 'primitive') {
      key = s.generator ?? s.primitive;
      const out = await generate(s, world, { sandbox });
      tris = out.stats.triangles;
    } else if (s.kind === 'scatter') {
      key = `scatter:${s.of.generator ?? s.of.primitive}`;
      const out = await generate(s.of, world, { sandbox });
      tris = out.stats.triangles * (s.points?.length ?? s.count);
    } else if (s.kind === 'mesh') {
      key = 'mesh';
      tris = world.meshes?.[s.mesh]?.triangleCount ?? 0;
    } else continue;
    if (each) console.log(`${id.padEnd(28)} ${key.padEnd(26)} ${tris}`);
    const b = by.get(key) ?? { n: 0, tris: 0, max: 0 };
    b.n++;
    b.tris += tris;
    b.max = Math.max(b.max, tris);
    by.set(key, b);
    total += tris;
  }
} finally {
  sandbox.dispose();
}
for (const [k, v] of [...by].sort((a, b) => b[1].tris - a[1].tris)) console.log(`${k.padEnd(32)} ${String(v.n).padStart(4)} x  ${String(v.tris).padStart(9)} tris  (max ${v.max})`);
console.log(`total ${total}`);
process.exit(0);
