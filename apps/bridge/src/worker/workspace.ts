/**
 * Throwaway workspaces for agentic asset builds: a private temp folder with
 * the generator API (`GENERATOR_API.d.ts`), worked examples, the checker
 * (`check.mjs`), the task (`task.md`) and an empty `out/` folder. Nothing
 * else (no secrets, no repository). Removed after the job, whatever happens.
 *
 * The checker is bundled once per process from `check-entry.ts` (esbuild)
 * into one self-contained file the agent runs with plain `node`.
 */
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GeneratorDef, type GeneratorDef as GeneratorDefType } from '@aether/core';
import { GENERATOR_API_DTS, GENERATOR_EXAMPLES, staticCheckSource } from '@aether/procgen';

/** The artifact an asset build must produce. */
export const ASSET_ARTIFACT = 'out/generator.json';

/** What to build. */
export interface AssetSpec {
  id: string;
  description: string;
  paramsHint?: string;
}

let checkScript: Promise<string> | null = null;

/** Bundle the checker (once per process) into a private temp folder; resolves to its path. */
export function bundledCheckScript(): Promise<string> {
  checkScript ??= (async () => {
    const entry = fileURLToPath(new URL('./check-entry.ts', import.meta.url));
    const dir = await mkdtemp(join(tmpdir(), 'aether-check-'));
    await chmod(dir, 0o700);
    const outfile = join(dir, 'check.mjs');
    const { build } = await import('esbuild');
    await build({
      entryPoints: [entry],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      outfile,
      minify: true,
      legalComments: 'none',
      logLevel: 'silent',
      // Bundled CommonJS dependencies may call require() for Node built-ins.
      banner: { js: "import { createRequire as __aetherRequire } from 'node:module'; const require = __aetherRequire(import.meta.url);" },
    });
    await chmod(outfile, 0o400);
    return outfile;
  })().catch((e: unknown) => {
    checkScript = null;
    throw e;
  });
  return checkScript;
}

/** The task given to the coding agent. */
export function assetTask(spec: AssetSpec): string {
  return [
    `# Build a procedural 3D asset: "${spec.id}"`,
    '',
    `What it should be: ${spec.description.slice(0, 2000)}`,
    ...(spec.paramsHint ? ['', `Parameters to expose (hint): ${spec.paramsHint.slice(0, 1000)}`] : []),
    '',
    '## Deliverable',
    `Write \`${ASSET_ARTIFACT}\`: a JSON object \`{"id": "${spec.id}", "description": "…", "params": {…}, "source": "…"}\`.`,
    '- `source` is the BODY of `function generate(params, api) { … }` and must end with `return api.build();`.',
    '- `params` maps names to `{ "type": "number"|"int"|"boolean"|"color"|"enum", "default": …, "min"?, "max"?, "options"?, "description"? }`.',
    '- Use only the `api` described in `GENERATOR_API.d.ts` (read it first) and plain JavaScript: no imports, no `require`, no `fetch`, no `eval`, no timers, no globals.',
    '- Units are metres, Y is up, the object stands on y = 0 (api.build() places it). Aim for a recognisable, well-proportioned, art-directed silhouette with several materials and enough detail (hundreds to a few thousand triangles).',
    '- `examples/` has complete, working examples of the format.',
    '',
    '## Loop',
    `1. Write or edit \`${ASSET_ARTIFACT}\`.`,
    `2. Run \`node check.mjs ${ASSET_ARTIFACT}\`. It validates everything and renders \`out/preview.png\` (front, side, top, three-quarter).`,
    '3. Look at the preview and the report; fix problems, improve proportions and detail.',
    '4. Stop when the checker prints `RESULT: PASS` and the preview looks right.',
    '',
    'Work only inside this folder. There is no network access. Do not create other files outside `out/`.',
  ].join('\n');
}

/** Create the workspace for `spec`; resolves to its folder and task. */
export async function createAssetWorkspace(spec: AssetSpec, opts: { root?: string; checkScript?: string } = {}): Promise<{ dir: string; task: string; artifact: string }> {
  const dir = await mkdtemp(join(opts.root ?? tmpdir(), 'aether-asset-'));
  try {
    await chmod(dir, 0o700);
    const task = assetTask(spec);
    await writeFile(join(dir, 'task.md'), task, { encoding: 'utf8', mode: 0o600 });
    await writeFile(join(dir, 'GENERATOR_API.d.ts'), GENERATOR_API_DTS, { encoding: 'utf8', mode: 0o600 });
    await mkdir(join(dir, 'examples'), { mode: 0o700 });
    for (const ex of GENERATOR_EXAMPLES) {
      await writeFile(join(dir, 'examples', `${ex.def.id}.json`), `${JSON.stringify({ prompt: ex.prompt, ...ex.def }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    }
    await mkdir(join(dir, 'out'), { mode: 0o700 });
    await copyFile(opts.checkScript ?? (await bundledCheckScript()), join(dir, 'check.mjs'));
    await chmod(join(dir, 'check.mjs'), 0o400);
    return { dir, task, artifact: ASSET_ARTIFACT };
  } catch (e) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw e;
  }
}

/** Remove a workspace (always safe to call). */
export async function removeWorkspace(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true, maxRetries: 2 }).catch(() => undefined);
}

/**
 * Parse the artifact (untrusted): JSON, the generator schema, the expected id
 * and the static source screen. The host still runs it in its sandbox.
 */
export function parseAssetArtifact(text: string | null, id: string): { ok: true; def: GeneratorDefType } | { ok: false; error: string } {
  if (text === null) return { ok: false, error: `the agent did not leave a readable ${ASSET_ARTIFACT}` };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: `${ASSET_ARTIFACT} is not valid JSON` };
  }
  const r = GeneratorDef.safeParse(typeof json === 'object' && json !== null ? { ...(json as object), id } : json);
  if (!r.success) return { ok: false, error: `${ASSET_ARTIFACT} is not a valid generator (${r.error.issues[0]?.message ?? 'invalid'})` };
  const screen = staticCheckSource(r.data.source);
  if (!screen.ok) return { ok: false, error: `the generator source was rejected (${screen.problems.slice(0, 3).join('; ')})` };
  return { ok: true, def: r.data };
}
