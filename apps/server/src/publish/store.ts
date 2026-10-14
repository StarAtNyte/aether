/**
 * The local library of published builds (the local app only): immutable,
 * size-capped directories under `DATA_DIR/published/<id>/`, each the
 * contents of one game zip the studio built. Uploaded content is untrusted
 * and is never executed here: the zip is read with entry-count, per-file
 * and total caps (a compression bomb stops at the cap), every name must be
 * a safe relative path with an allowed extension, `game.json` must be an
 * Aether game whose world validates, and files are written to a temporary
 * directory that is renamed into place only when complete.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { z } from 'zod';
import { inspectUntrusted, validateWorld } from '@aether/core';
import { readZip, safeEntryName } from '@aether/assets/zip';

/** Build ids: 12 lowercase base36 characters. */
export const BUILD_ID_RE = /^[a-z0-9]{12}$/;
/** File types a build may contain. */
export const ALLOWED_EXT = /\.(html|js|mjs|css|json|webmanifest|wasm|png|jpe?g|webp|svg|glb|hdr|woff2?|txt|md|aethersave)$/i;
/** Names that may appear without an extension. */
const ALLOWED_PLAIN = new Set(['.nojekyll']);

/** Limits of the store. */
export interface PublishStoreLimits {
  maxBuilds: number;
  maxBuildBytes: number;
  maxTotalBytes: number;
  maxFiles: number;
  maxFileBytes: number;
}

export const DEFAULT_PUBLISH_LIMITS: PublishStoreLimits = {
  maxBuilds: 100,
  maxBuildBytes: 256 * 1024 * 1024,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
  maxFiles: 2000,
  maxFileBytes: 128 * 1024 * 1024,
};

/** What the store keeps about a build. */
export const BuildMeta = z.object({
  v: z.literal(1),
  id: z.string().regex(BUILD_ID_RE),
  title: z.string().max(120),
  createdAt: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  files: z.number().int().nonnegative(),
});
export type BuildMeta = z.infer<typeof BuildMeta>;

/** A failure the routes turn into a 4xx answer. */
export class PublishStoreError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 413 | 507,
    message: string,
  ) {
    super(message);
    this.name = 'PublishStoreError';
  }
}

const META = 'aether-build.json';

/** Clean a title for listing. */
function cleanTitle(t: unknown): string {
  // eslint-disable-next-line no-control-regex
  return typeof t === 'string' ? t.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled game' : 'Untitled game';
}

/** Check a game's `game.json` (format and world) without running anything in it. */
export function checkGameJson(bytes: Uint8Array): { ok: true; title: string } | { ok: false; error: string } {
  if (bytes.byteLength > 16 * 1024 * 1024) return { ok: false, error: 'game.json is too large' };
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return { ok: false, error: 'game.json is not valid JSON' };
  }
  const guard = inspectUntrusted(value);
  if (!guard.ok) return { ok: false, error: `game.json was rejected (${guard.message})` };
  if (typeof value !== 'object' || value === null || (value as Record<string, unknown>)['format'] !== 'aether-game') return { ok: false, error: 'game.json is not an Aether game' };
  const w = validateWorld((value as Record<string, unknown>)['world']);
  if (!w.ok) return { ok: false, error: `the world is invalid (${w.issues[0]?.message ?? 'invalid'})` };
  return { ok: true, title: cleanTitle((value as Record<string, unknown>)['title']) };
}

/** The published-build store. */
export class PublishStore {
  readonly dir: string;

  constructor(
    dir: string,
    private readonly limits: PublishStoreLimits = DEFAULT_PUBLISH_LIMITS,
    private readonly now: () => number = Date.now,
  ) {
    this.dir = resolve(dir);
  }

  /** Every build, newest first. */
  async list(): Promise<BuildMeta[]> {
    let names: string[] = [];
    try {
      names = await readdir(this.dir);
    } catch {
      return [];
    }
    const out: BuildMeta[] = [];
    for (const n of names) {
      if (!BUILD_ID_RE.test(n)) continue;
      const m = await this.meta(n);
      if (m) out.push(m);
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  /** One build's metadata, or null. */
  async meta(id: string): Promise<BuildMeta | null> {
    if (!BUILD_ID_RE.test(id)) return null;
    try {
      const r = BuildMeta.safeParse(JSON.parse(await readFile(join(this.dir, id, META), 'utf8')));
      return r.success ? r.data : null;
    } catch {
      return null;
    }
  }

  /** Validate and store a build zip. */
  async add(zip: Uint8Array): Promise<BuildMeta> {
    const L = this.limits;
    if (zip.byteLength > L.maxBuildBytes) throw new PublishStoreError(413, `The build is larger than ${Math.round(L.maxBuildBytes / 1024 / 1024)} MB.`);
    const existing = await this.list();
    if (existing.length >= L.maxBuilds) throw new PublishStoreError(507, `The local library holds ${L.maxBuilds} builds, the most it keeps. Delete some first.`);
    const used = existing.reduce((s, b) => s + b.bytes, 0);
    const r = await readZip(zip, { maxEntries: L.maxFiles, maxEntryBytes: L.maxFileBytes, maxTotalBytes: L.maxBuildBytes });
    if (!r.ok) throw new PublishStoreError(400, `The build was rejected: ${r.error}.`);
    let bytes = 0;
    for (const e of r.entries) {
      const base = e.name.split('/').pop() ?? '';
      if (!safeEntryName(e.name) || (!ALLOWED_EXT.test(e.name) && !ALLOWED_PLAIN.has(base))) throw new PublishStoreError(400, `The build contains a file type that is not allowed: ${e.name.slice(0, 80)}`);
      bytes += e.data.byteLength;
    }
    if (used + bytes > L.maxTotalBytes) throw new PublishStoreError(507, 'The local library is full. Delete some builds first.');
    const index = r.entries.find((e) => e.name === 'index.html');
    const game = r.entries.find((e) => e.name === 'game.json');
    if (!index || !game) throw new PublishStoreError(400, 'The build has no index.html or game.json.');
    const check = checkGameJson(game.data);
    if (!check.ok) throw new PublishStoreError(400, `The build was rejected: ${check.error}.`);
    const id = randomId();
    const tmp = join(this.dir, `.tmp-${id}-${randomBytes(4).toString('hex')}`);
    const meta: BuildMeta = { v: 1, id, title: check.title, createdAt: this.now(), bytes, files: r.entries.length };
    try {
      for (const e of r.entries) {
        const file = this.inside(tmp, e.name);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, e.data, { flag: 'wx' });
      }
      await writeFile(join(tmp, META), JSON.stringify(meta), { flag: 'wx' });
      await rename(tmp, join(this.dir, id));
    } catch (err) {
      await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
      throw err;
    }
    return meta;
  }

  /** Remove a build. */
  async remove(id: string): Promise<boolean> {
    if (!BUILD_ID_RE.test(id)) return false;
    const m = await this.meta(id);
    if (!m) return false;
    await rm(join(this.dir, id), { recursive: true, force: true });
    return true;
  }

  /**
   * The absolute path of a file of a build, or null when the build or file
   * does not exist, the path is not a safe relative name, or it is the
   * store's own metadata. `''` and paths ending in `/` mean `index.html`.
   */
  async file(id: string, path: string): Promise<{ file: string; size: number } | null> {
    if (!BUILD_ID_RE.test(id)) return null;
    let rel: string;
    try {
      rel = decodeURIComponent(path);
    } catch {
      return null;
    }
    if (rel === '' || rel.endsWith('/')) rel = `${rel}index.html`;
    if (!safeEntryName(rel) || rel === META) return null;
    const file = this.inside(join(this.dir, id), rel);
    try {
      const st = await stat(file);
      return st.isFile() ? { file, size: st.size } : null;
    } catch {
      return null;
    }
  }

  /** Copy a build's files into `dest` (deploy jobs get a throwaway copy). */
  async copyTo(id: string, dest: string): Promise<number> {
    if (!(await this.meta(id))) throw new PublishStoreError(404, 'That build does not exist.');
    const root = join(this.dir, id);
    let count = 0;
    const walk = async (rel: string): Promise<void> => {
      for (const name of await readdir(join(root, rel))) {
        const r = rel ? `${rel}/${name}` : name;
        if (r === META) continue;
        const st = await stat(join(root, r));
        if (st.isDirectory()) await walk(r);
        else if (st.isFile()) {
          const target = this.inside(dest, r);
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, await readFile(join(root, r)));
          count++;
        }
      }
    };
    await walk('');
    return count;
  }

  /** `rel` resolved inside `root` (throws when it would escape). */
  private inside(root: string, rel: string): string {
    const base = resolve(root);
    const file = resolve(base, rel);
    if (!file.startsWith(base + sep)) throw new PublishStoreError(400, 'unsafe path');
    return file;
  }
}

/** A random build id. */
function randomId(): string {
  const bytes = randomBytes(12);
  let out = '';
  for (const b of bytes) out += (b % 36).toString(36);
  return out;
}
