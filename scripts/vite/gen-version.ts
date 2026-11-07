/**
 * Code version of generated geometry (`__AETHER_GEN_VERSION__`). It salts the keys of the persistent geometry cache
 * (packages/render/src/geometry/ddc.ts) and the id of every cooked package (packages/render/src/cook/format.ts), so a
 * build whose generators would make different geometry never reads entries an older build made.
 *
 * The version is a hash of the code that decides a generator output and its stored form, and of nothing else: the
 * modules reachable from {@link GEN_ENTRIES} (the generation lane, the custom-generator sandbox, the compute worker and
 * the output-key function), bundled by esbuild with tree shaking and hashed after bundling. So:
 * - an edit outside that graph (the player, views, the editor, scheduling, cooking, docs) leaves the version alone;
 * - inside a reached module, only code that survives tree shaking counts: an unused export, a comment or a type changes
 *   nothing; a used function, constant, table, dependency (zod, meshoptimizer) or bundled JSON changes the version.
 * Zod schemas are built at module load, which esbuild must assume has side effects; for this hash only, a top-level
 * schema declaration is marked pure (`/* @__PURE__ *\/`), so a schema the graph never uses (the player's tour stops in
 * the IR schema) does not count. A schema it does use (material finishes, generator definitions) still does.
 *
 * Too narrow a version would serve wrong geometry silently; the cooked load backs it with a spot check (the lanes
 * regenerate a few package entries live and compare geometry fingerprints, geometry/fingerprint.ts).
 */
import { build, type Plugin } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Where generator output is decided: every module these reach (after tree shaking) is an input of the version.
 * - gen.worker.ts: the generation lane (built-in generators, validation, preparation, the entry codec, the cache);
 * - sandbox.worker.ts: the runtime custom generators run in;
 * - compute.worker.ts: built-in generators run off the page when there is no lane;
 * - generate.ts: parameter resolution and the output key (`proceduralOutputKey`) the page sends with each request.
 */
export const GEN_ENTRIES: readonly string[] = [
  'packages/render/src/geometry/gen.worker.ts',
  'packages/procgen/src/sandbox/sandbox.worker.ts',
  'packages/procgen/src/compute/compute.worker.ts',
  'packages/procgen/src/generate.ts',
];

/** Methods of a zod schema a top-level declaration may start with (`Base.extend({...})`). */
const SCHEMA_METHODS = 'extend|merge|omit|pick|partial|required|and|or|array|optional|nullable|nullish|strict|strip|passthrough|refine|superRefine|transform|default|describe|catch|brand|readonly|pipe';
const SCHEMA_DECL = new RegExp(`^(export\\s+)?const\\s+[A-Za-z_$][\\w$]*\\s*(:[^=\\n]+)?=\\s*(?=z\\s*\\.|[A-Za-z_$][\\w$]*\\.(?:${SCHEMA_METHODS})\\()`, 'gm');

/** Index just past the end of the expression starting at `from` (at the `;` or line end where brackets close), or -1. */
function expressionEnd(src: string, from: number): number {
  let depth = 0;
  let last = '';
  for (let i = from; i < src.length; i++) {
    const c = src[i]!;
    if (c === '/' && src[i + 1] === '/') {
      i = src.indexOf('\n', i);
      if (i < 0) return -1;
      i--;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i + 2);
      if (i < 0) return -1;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
      last = c;
      continue;
    }
    if (c === '`') {
      // Template literal: skip it, with nested `${ … }` (no templates inside templates in schema code).
      let d = 0;
      for (i++; i < src.length; i++) {
        if (src[i] === '\\') i++;
        else if (d === 0 && src[i] === '`') break;
        else if (src[i] === '$' && src[i + 1] === '{') (d++, i++);
        else if (d > 0 && src[i] === '}') d--;
      }
      last = '`';
      continue;
    }
    if (c === '/' && /[(,=:[!&|?{};+\-*%<>~^]|^$/.test(last)) {
      // Regular expression literal (`.regex(/…/)`).
      let cls = false;
      for (i++; i < src.length; i++) {
        if (src[i] === '\\') i++;
        else if (src[i] === '[') cls = true;
        else if (src[i] === ']') cls = false;
        else if (!cls && src[i] === '/') break;
      }
      last = 'r';
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    if (depth < 0) return -1;
    if (depth === 0 && c === ';') return i;
    if (depth === 0 && c === '\n') {
      // A statement without a semicolon ends where the next line does not continue it.
      const rest = src.slice(i + 1).match(/^\s*(\S)/);
      if (!rest || !/[.?:|&+\-*/,)\]}]/.test(rest[1]!)) return i;
    }
    if (!/\s/.test(c)) last = c;
  }
  return depth === 0 ? src.length : -1;
}

/** `src` with every top-level zod schema declaration's initializer wrapped in a pure IIFE (dropped when unused). */
export function markSchemasPure(src: string, file = '<source>'): string {
  if (!/from\s+['"]zod['"]/.test(src)) return src;
  let out = '';
  let at = 0;
  for (const m of src.matchAll(SCHEMA_DECL)) {
    const start = m.index + m[0].length;
    if (start < at) continue;
    const end = expressionEnd(src, start);
    if (end < 0) throw new Error(`gen-version: cannot find the end of the schema declared at ${file}:${src.slice(0, m.index).split('\n').length}`);
    out += `${src.slice(at, start)}/* @__PURE__ */ (() => (${src.slice(start, end).trimEnd()}))()`;
    at = end;
  }
  return out + src.slice(at);
}

/** What {@link generationCode} hashed. */
export interface GenerationCode {
  /** 16 hex: the version. */
  version: string;
  /** Repository files with code in the bundle (relative, sorted): the inputs. */
  inputs: string[];
}

/** Options of {@link generationCode} (tests). */
export interface GenerationCodeOptions {
  /** Source to use instead of a file's (path relative to the repository root): measures what an edit would do. */
  patch?: Readonly<Record<string, string>>;
}

const sourcePlugin = (patch: Readonly<Record<string, string>>): Plugin => ({
  name: 'gen-version-source',
  setup(b) {
    b.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, (args) => {
      const rel = relative(ROOT, args.path).split('\\').join('/');
      if (rel.includes('node_modules/')) return undefined;
      const src = patch[rel] ?? readFileSync(args.path, 'utf8');
      return { contents: markSchemasPure(src, rel), loader: /\.tsx?$/.test(args.path) ? (args.path.endsWith('x') ? 'tsx' : 'ts') : 'js', resolveDir: join(args.path, '..') };
    });
  },
});

/** The version and its inputs: the generation entry points bundled with tree shaking, hashed. */
export async function generationCode(opts: GenerationCodeOptions = {}): Promise<GenerationCode> {
  const r = await build({
    absWorkingDir: ROOT,
    entryPoints: GEN_ENTRIES.map((e) => join(ROOT, e)),
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    treeShaking: true,
    minifySyntax: true,
    minifyWhitespace: true,
    // Stable output names: the content hash of a chunk does not depend on the folder the tree is checked out in.
    entryNames: '[dir]/[name]',
    chunkNames: 'chunk-[hash]',
    outdir: join(ROOT, '.gen-version-out'),
    outbase: ROOT,
    write: false,
    metafile: true,
    logLevel: 'silent',
    legalComments: 'none',
    plugins: [sourcePlugin(opts.patch ?? {})],
  });
  const h = createHash('sha256');
  const outDir = join(ROOT, '.gen-version-out');
  const files = r.outputFiles.map((f) => ({ name: relative(outDir, f.path).split('\\').join('/'), text: f.text })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const f of files) {
    if (f.text.includes(ROOT)) throw new Error(`gen-version: ${f.name} contains the checkout path; the version would differ between checkouts`);
    h.update(f.name);
    h.update('\u0000');
    h.update(f.text);
    h.update('\u0000');
  }
  const used = new Set<string>();
  for (const o of Object.values(r.metafile.outputs)) for (const [k, v] of Object.entries(o.inputs)) if (v.bytesInOutput > 0) used.add(k.split('\\').join('/'));
  const inputs = [...used].map((k) => relative(ROOT, join(ROOT, k)).split('\\').join('/')).sort();
  // An input outside the checkout (a node_modules linked to another checkout's) changes the bundle's chunk hashes, so
  // this tree's version would not be the deployed build's.
  const outside = inputs.filter((k) => k.startsWith('../'));
  if (outside.length) throw new Error(`gen-version: ${outside.length} inputs resolve outside the checkout (${outside[0]}); install its own node_modules`);
  return { version: h.digest('hex').slice(0, 16), inputs };
}

/** Hex digest (16 chars) of the generation code ({@link generationCode}). */
export async function generationCodeVersion(): Promise<string> {
  return (await generationCode()).version;
}
