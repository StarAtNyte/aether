/**
 * Which library files the hosted build ships next to the bundle (the rest of the library is served
 * from a pinned CDN copy, see `asset-library.ts`). Pure and deterministic: the result depends only on
 * the catalog, the bundled example worlds and the source tree.
 *
 * Shipped:
 *   - every thumbnail (`t/`), surface texture (`x/`) and character file (`c/`): small, and the library
 *     grid, the materials and the people are used by every world;
 *   - every model / material / sky whose catalog id the bundled example worlds name, or that the
 *     source names as a string literal (the planner's offline showcase worlds, default skies, the
 *     starter set): its file, its LODs, its lite sky, its material maps; a textured file as its KTX2 twin only.
 * Everything else is fetched on demand from the CDN.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

interface Entry {
  id: string;
  kind: string;
  file?: string;
  lite?: string;
  thumb?: string;
  lods?: { file: string }[];
  material?: { maps: Record<string, string | undefined>; small?: Record<string, string | undefined> };
}

/** A small set that every fresh project can reach without a network: common furniture, props and nature. */
export const STARTER_IDS: readonly string[] = [
  'sofa', 'chair', 'table', 'bed', 'lamp', 'bookshelf', 'tree', 'bush', 'rock', 'crate', 'barrel', 'door', 'fence', 'bench', 'plant',
];

function walk(dir: string, accept: (f: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'test' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, accept, out);
    else if (accept(p)) out.push(p);
  }
  return out;
}

/** Every quoted identifier-like string in the files (a superset of the catalog ids they name). */
function literals(files: readonly string[]): Set<string> {
  const out = new Set<string>();
  const re = /(['"`])([a-z0-9][a-z0-9_.-]*)\1/g;
  for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(re)) out.add(m[2] as string);
  return out;
}

function jsonStrings(v: unknown, out: Set<string>): void {
  if (typeof v === 'string') out.add(v);
  else if (Array.isArray(v)) for (const x of v) jsonStrings(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) jsonStrings(x, out);
}

/** Library-relative paths to ship (`m/sofa.0123abcd.glb`, ...), sorted. */
export function shippedPaths(root: string, libDir: string): string[] {
  const catalog = JSON.parse(readFileSync(join(root, 'assets', 'catalog.json'), 'utf8')) as { entries: Entry[] };
  const ktx = JSON.parse(readFileSync(join(root, 'assets', 'ktx2.json'), 'utf8')) as { entries: Record<string, { file: string }> };
  const wanted = new Set<string>(STARTER_IDS);

  const worlds = join(root, 'apps', 'studio', 'public', 'templates', 'worlds');
  for (const f of readdirSync(worlds).filter((n) => n.endsWith('.json'))) jsonStrings(JSON.parse(readFileSync(join(worlds, f), 'utf8')), wanted);

  const srcDirs = [join(root, 'apps', 'studio', 'src'), ...readdirSync(join(root, 'packages')).map((p) => join(root, 'packages', p, 'src'))];
  const files: string[] = [];
  for (const d of srcDirs) {
    try {
      walk(d, (f) => /\.tsx?$/.test(f), files);
    } catch {
      /* package without src */
    }
  }
  for (const s of literals(files)) wanted.add(s);

  const out = new Set<string>();
  const add = (p: string | undefined): void => {
    if (!p) return;
    // A textured file ships as its GPU-compressed twin only (every WebGL2 / WebGPU browser reads it); the
    // original, for a browser that cannot, comes from the CDN.
    const twin = Object.hasOwn(ktx.entries, p) ? ktx.entries[p]?.file : undefined;
    out.add(twin ?? p);
  };
  for (const e of catalog.entries) {
    if (e.thumb) out.add(e.thumb);
    if (!wanted.has(e.id)) continue;
    add(e.file);
    add(e.lite);
    for (const l of e.lods ?? []) add(l.file);
    for (const m of [e.material?.maps, e.material?.small]) for (const p of Object.values(m ?? {})) add(p);
  }
  // Whole directories that are always shipped.
  for (const dir of ['t', 'x', 'c']) for (const n of readdirSync(join(libDir, dir))) out.add(`${dir}/${n}`);
  return [...out].filter((p) => statSync(join(libDir, p), { throwIfNoEntry: false })?.isFile()).sort();
}
