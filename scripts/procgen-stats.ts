/**
 * Triangle, vertex and part counts of built-in generators with their default params (or `id:json` overrides), for
 * keeping geometry budgets in view while art-directing them.
 *
 * Run: `npx tsx scripts/procgen-stats.ts house 'house:{"variant":2,"floors":2}' tower`
 */
import { BUILTIN_GENERATORS, generateBuiltinSync } from '@aether/procgen';

const specs = process.argv.slice(2);
const ids = specs.length > 0 ? specs : Object.keys(BUILTIN_GENERATORS);
for (const spec of ids) {
  const i = spec.indexOf(':');
  const id = i < 0 ? spec : spec.slice(0, i);
  const params = i < 0 ? {} : (JSON.parse(spec.slice(i + 1)) as Record<string, never>);
  const t0 = performance.now();
  const out = generateBuiltinSync(id, params, 1);
  const ms = performance.now() - t0;
  const tris = out.parts.reduce((s, p) => s + p.indices.length / 3, 0);
  const verts = out.parts.reduce((s, p) => s + p.positions.length / 3, 0);
  const mats = out.parts.map((p) => p.material.finish ?? p.material.preset ?? (p.material.emissiveIntensity ? 'glow' : 'plain')).join(',');
  process.stdout.write(`${spec.padEnd(36)} tris ${String(tris).padStart(6)} verts ${String(verts).padStart(6)} parts ${String(out.parts.length).padStart(2)} colliders ${String(out.colliders.length).padStart(2)} ${ms.toFixed(1)} ms  [${mats}]\n`);
}
