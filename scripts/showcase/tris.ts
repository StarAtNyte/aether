/**
 * Triangle counts of the generators the showcase worlds use (a budgeting
 * aid for art direction): `npx tsx scripts/showcase/tris.ts [id…]`.
 */
import { generateBuiltinSync, getBuiltinGenerator, loadLibraryGenerator, resolveParams } from '@aether/procgen';
import { createNodeSandbox } from '@aether/procgen/node';

const DEFAULT_IDS = ['hero-cherry-tree', 'pagoda', 'torii-gate', 'waterfall', 'train-engine', 'robot', 'satellite-dish', 'hero-lantern', 'lighthouse', 'wizard-tower', 'hot-air-balloon', 'wind-turbine', 'tree-oak', 'tree-pine', 'bush', 'rock', 'grass-tuft', 'flowers', 'house', 'bridge', 'dock', 'boat', 'island', 'crystal', 'cloud'];

async function main(): Promise<void> {
  const ids = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_IDS;
  const sandbox = createNodeSandbox({ timeoutMs: 5000 });
  try {
    for (const id of ids) {
      let tris = 0;
      let parts = 0;
      let colored = 0;
      if (getBuiltinGenerator(id)) {
        const out = generateBuiltinSync(id, {}, 1);
        for (const p of out.parts) tris += p.indices.length / 3;
        parts = out.parts.length;
        colored = out.parts.filter((p) => p.colors && p.colors.length > 0).length;
      } else {
        const def = await loadLibraryGenerator(id);
        if (!def) {
          console.log(`${id.padEnd(20)} unknown`);
          continue;
        }
        const out = await sandbox.run(def, resolveParams(def.params, {}), 1, { timeoutMs: 5000 });
        for (const p of out.parts) tris += p.indices.length / 3;
        parts = out.parts.length;
        colored = out.parts.filter((p) => p.colors && p.colors.length > 0).length;
      }
      console.log(`${id.padEnd(20)} ${String(Math.round(tris)).padStart(8)} triangles  ${parts} parts (${colored} vertex-coloured)`);
    }
  } finally {
    sandbox.dispose();
  }
}

void main();
