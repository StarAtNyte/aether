/**
 * Build the offline generator library: asks the Codex CLI you are signed in
 * to (ChatGPT login, no API key) to write one procedural generator per object
 * in `LIBRARY_SPECS`, accepts only generators that pass the sandbox run,
 * output validation and the silhouette check, and stores them as JSON in
 * `packages/procgen/library/` plus the generated catalog
 * `packages/procgen/src/library-index.ts`.
 *
 * Calls are sequential (one at a time), resumable (existing files are kept
 * unless --force) and bounded by --max-calls (default 60). The four reviewed
 * few-shot examples are added without any model call.
 *
 *   npx tsx scripts/build-generator-library.ts [--max-calls=60] [--only=piano,bus]
 *     [--limit=5] [--model=<id>] [--effort=low|medium|high] [--force] [--index-only] [--mock]
 *
 * `--mock` uses the offline provider (pipeline check without model calls; its
 * placeholder generators are written to a temporary directory, never shipped).
 */
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import type { GeneratorDef } from '@aether/core';
import { buildCoderPrompt, createMockProvider, requestGenerator, type CompletionRequest, type Provider, type UsageTotals } from '@aether/agent';
import { BEHAVIOR_CATALOG, RULE_DOCS, SCRIPT_API_DTS } from '@aether/logic';
import { GENERATOR_API_DTS, GENERATOR_EXAMPLES, catalog } from '@aether/procgen';
import { createNodeSandbox } from '@aether/procgen/node';
import { LIBRARY_SPECS, type LibrarySpec } from '../packages/procgen/src/library-specs';
import { LibraryFileSchema, acceptLibraryGenerator, renderLibraryIndex, serializeLibraryFile, type LibraryEntryData, type LibraryFile } from '../packages/procgen/src/library-tools';
import { createHeadlessProvider } from '../apps/bridge/src/headless';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_PATH = join(ROOT, 'packages/procgen/src/library-index.ts');

/** Example ids → library metadata (their defs come from GENERATOR_EXAMPLES). */
const EXAMPLE_META: Readonly<Record<string, Omit<LibrarySpec, 'id' | 'paramsHint'>>> = {
  lighthouse: { category: 'architecture', description: 'Striped lighthouse with a gallery, railing and a glowing lamp room.', keywords: ['lighthouse', 'light house', 'beacon tower'] },
  bookshelf: { category: 'props', description: 'Bookshelf full of colourful books.', keywords: ['bookshelf', 'bookcase', 'book shelf', 'library shelf'] },
  rocket: { category: 'vehicles', description: 'Retro rocket ship on its fins, ready for launch.', keywords: ['rocket', 'rocket ship', 'spaceship', 'space ship'] },
  fountain: { category: 'architecture', description: 'Tiered stone fountain with water basins.', keywords: ['fountain', 'water fountain'] },
};

interface Args {
  maxCalls: number;
  only: Set<string> | null;
  limit: number;
  model: string | undefined;
  effort: 'low' | 'medium' | 'high';
  force: boolean;
  indexOnly: boolean;
  mock: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const get = (name: string): string | undefined => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const effort = get('effort') ?? 'low';
  if (effort !== 'low' && effort !== 'medium' && effort !== 'high') throw new Error('--effort must be low, medium or high');
  const model = get('model');
  if (model !== undefined && !/^[A-Za-z0-9._:-]{1,64}$/.test(model)) throw new Error('invalid --model');
  const only = get('only');
  return {
    maxCalls: Math.max(0, Math.min(200, Number(get('max-calls') ?? 60) || 0)),
    only: only ? new Set(only.split(',').map((s) => s.trim()).filter(Boolean)) : null,
    limit: Math.max(0, Number(get('limit') ?? 1000) || 0),
    model,
    effort,
    force: argv.includes('--force'),
    indexOnly: argv.includes('--index-only'),
    mock: argv.includes('--mock'),
  };
}

/** Wrap a provider so it refuses calls beyond `max` (counted across the whole run). */
function budgeted(inner: Provider, max: number): Provider & { calls: () => number } {
  let n = 0;
  return {
    name: inner.name,
    calls: () => n,
    async complete(req: CompletionRequest, signal?: AbortSignal) {
      if (n >= max) throw new Error(`call budget exhausted (${max})`);
      n++;
      return inner.complete(req, signal);
    },
  };
}

async function readLibrary(dir: string): Promise<Map<string, LibraryFile>> {
  const out = new Map<string, LibraryFile>();
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return out;
  }
  for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
    const parsed = LibraryFileSchema.safeParse(JSON.parse(await readFile(join(dir, name), 'utf8')) as unknown);
    if (!parsed.success || `${parsed.data.entry.id}.json` !== name) {
      console.warn(`skipping invalid library file ${name}`);
      continue;
    }
    out.set(parsed.data.entry.id, parsed.data);
  }
  return out;
}

function fileFor(entry: Omit<LibraryEntryData, 'size' | 'params'>, def: GeneratorDef, check: Extract<Awaited<ReturnType<typeof acceptLibraryGenerator>>, { ok: true }>, provenance: LibraryFile['provenance']): LibraryFile {
  return {
    version: 1,
    entry: { ...entry, params: def.params, size: check.size },
    def,
    provenance,
    checks: { triangles: check.triangles, parts: check.parts, colliders: check.colliders },
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dir = args.mock ? await mkdtemp(join(tmpdir(), 'aether-library-')) : join(ROOT, 'packages/procgen/library');
  await mkdir(dir, { recursive: true });
  const sandbox = createNodeSandbox();
  const library = await readLibrary(dir);
  const now = new Date().toISOString();

  // 1. Reviewed few-shot examples (no model call).
  for (const ex of GENERATOR_EXAMPLES) {
    const meta = EXAMPLE_META[ex.def.id];
    if (!meta || (library.has(ex.def.id) && !args.force)) continue;
    const check = await acceptLibraryGenerator(ex.def, sandbox);
    if (!check.ok) throw new Error(`example ${ex.def.id} fails the library check: ${check.error}`);
    const file = fileFor({ id: ex.def.id, ...meta, keywords: [...meta.keywords] }, ex.def, check, { source: 'example', createdAt: now, attempts: 0 });
    await writeFile(join(dir, `${ex.def.id}.json`), serializeLibraryFile(file));
    library.set(ex.def.id, file);
    console.log(`example  ${ex.def.id.padEnd(18)} ok   ${check.triangles} tris`);
  }

  // 2. Model-written generators, sequentially, within the call budget.
  if (!args.indexOnly) {
    const builtin = new Set(catalog().map((g) => g.id));
    const base = args.mock ? createMockProvider() : createHeadlessProvider('codex', { effort: args.effort, ...(args.model ? { model: args.model } : {}), timeoutMs: 300_000 });
    const provider = budgeted(base, args.maxCalls);
    const system = buildCoderPrompt({ generators: catalog(), behaviors: BEHAVIOR_CATALOG, ruleDocs: RULE_DOCS, generatorApiDts: GENERATOR_API_DTS, generatorExamples: GENERATOR_EXAMPLES, scriptApiDts: SCRIPT_API_DTS });
    const todo = LIBRARY_SPECS.filter((s) => (!args.only || args.only.has(s.id)) && (args.force || !library.has(s.id))).slice(0, args.limit);
    let written = 0;
    for (const spec of todo) {
      if (builtin.has(spec.id)) throw new Error(`${spec.id} collides with a built-in generator`);
      if (provider.calls() >= args.maxCalls) {
        console.log(`call budget reached (${args.maxCalls}); stopping`);
        break;
      }
      const usage: UsageTotals = { inputTokens: 0, outputTokens: 0, calls: 0 };
      let last: Awaited<ReturnType<typeof acceptLibraryGenerator>> | null = null;
      const t0 = performance.now();
      let result;
      try {
        result = await requestGenerator(
          {
            provider,
            system,
            usage,
            attempts: 2,
            validate: async (def) => {
              last = await acceptLibraryGenerator(def, sandbox);
              return last.ok ? { ok: true } : { ok: false, error: last.error };
            },
          },
          { id: spec.id, description: `${spec.description}. Make it detailed and recognizable from any side, with a coherent colour palette.`, paramsHint: spec.paramsHint },
        );
      } catch (e) {
        console.log(`codex    ${spec.id.padEnd(18)} FAIL ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
        continue;
      }
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      const check = last as Awaited<ReturnType<typeof acceptLibraryGenerator>> | null;
      if (!result.ok || !check?.ok) {
        console.log(`codex    ${spec.id.padEnd(18)} FAIL ${secs}s ${usage.calls} call(s): ${result.ok ? 'check failed' : result.error.slice(0, 200)}`);
        continue;
      }
      const def: GeneratorDef = { ...result.def, id: spec.id };
      const file = fileFor({ id: spec.id, description: spec.description.slice(0, 300), category: spec.category, keywords: [...spec.keywords] }, def, check, {
        source: 'codex',
        ...(args.model ? { model: args.model } : {}),
        effort: args.effort,
        createdAt: new Date().toISOString(),
        attempts: usage.calls,
      });
      await writeFile(join(dir, `${spec.id}.json`), serializeLibraryFile(file));
      library.set(spec.id, file);
      written++;
      console.log(`codex    ${spec.id.padEnd(18)} ok   ${secs}s ${usage.calls} call(s) ${check.triangles} tris ${check.size.join('×')} m`);
    }
    console.log(`model calls: ${provider.calls()} / ${args.maxCalls}; new generators: ${written}`);
  }
  sandbox.dispose();

  // 3. Catalog module (only for the shipped library).
  if (!args.mock) {
    await writeFile(INDEX_PATH, renderLibraryIndex([...library.values()].map((f) => f.entry)));
    console.log(`library: ${library.size} generators → ${INDEX_PATH}`);
  } else {
    console.log(`mock run wrote ${library.size} files to ${dir}`);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
