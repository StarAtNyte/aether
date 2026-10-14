/**
 * Part materials of generators as the renderer resolves them (a debugging
 * aid for art direction). With no id, audits every built-in and library
 * generator and flags vertex-coloured parts that look like shade masks
 * (near-grey vertex colours on a coloured preset), which would render grey.
 *
 * Run: `npx tsx scripts/showcase/materials.ts [id] [paramsJSON]`
 */
import { BUILTIN_GENERATORS, GENERATOR_LIBRARY, generateBuiltinSync, getBuiltinGenerator, loadLibraryGenerator, resolveParams, type MeshPart } from '@aether/procgen';
import { createNodeSandbox } from '@aether/procgen/node';
import { resolveMaterial } from '@aether/render';

type Sandbox = ReturnType<typeof createNodeSandbox>;

async function partsOf(id: string, params: Record<string, unknown>, sandbox: Sandbox): Promise<MeshPart[]> {
  if (getBuiltinGenerator(id)) return generateBuiltinSync(id, params as never, 1).parts;
  const def = await loadLibraryGenerator(id);
  if (!def) throw new Error(`unknown generator ${id}`);
  return (await sandbox.run(def, resolveParams(def.params, params as never), 1, { timeoutMs: 5000 })).parts;
}

function average(colors: Float32Array): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  const n = colors.length / 3;
  for (let i = 0; i < colors.length; i += 3) {
    r += colors[i] as number;
    g += colors[i + 1] as number;
    b += colors[i + 2] as number;
  }
  return [r / n, g / n, b / n];
}

async function main(): Promise<void> {
  const sandbox = createNodeSandbox({ timeoutMs: 5000 });
  try {
    const single = process.argv[2];
    const ids = single ? [single] : [...Object.keys(BUILTIN_GENERATORS), ...GENERATOR_LIBRARY.map((g) => g.id)];
    const params = JSON.parse(process.argv[3] ?? '{}') as Record<string, unknown>;
    for (const id of ids) {
      let parts: MeshPart[];
      try {
        parts = await partsOf(id, single ? params : {}, sandbox);
      } catch (err) {
        console.log(`${id}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      for (const p of parts) {
        const hasColors = p.colors instanceof Float32Array && p.colors.length > 0;
        const r = resolveMaterial(p.material, { hasVertexColors: hasColors });
        const avg = hasColors && p.colors ? average(p.colors) : null;
        const greyMask = avg !== null && r.color === '#ffffff' && Math.max(...avg) - Math.min(...avg) < 0.03 && Math.min(...avg) > 0.5;
        if (single || greyMask) console.log(`${greyMask ? 'GREY-MASK ' : ''}${id}: ${JSON.stringify(p.material)} → base ${r.color} vc ${r.vertexColors}${avg ? ` avg ${avg.map((v) => v.toFixed(2)).join(',')}` : ''}`);
      }
    }
  } finally {
    sandbox.dispose();
  }
}

void main();
