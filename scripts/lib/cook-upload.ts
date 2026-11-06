/**
 * Pushing cooked packages (scripts/cook.ts) to the hosted dataset the player reads them from (player/source.ts
 * `HOSTED_COOKED_BASE`). The dataset mirrors the local layout:
 *
 *   <slug>/manifest.json          the only mutable file: which cook a reader opens
 *   <slug>/<id>/packs/<nnnn>.bin  immutable, named by the cook's id (IR hash and generator code version)
 *   <slug>/<id>/programs/<t>.json immutable
 *
 * Order: the `<id>/` folder first, then a check that every file the manifest names is on the dataset, then the manifest.
 * A reader therefore never sees a manifest that points at files not there yet. An id already complete on the dataset is
 * not uploaded again; older ids stay (builds and caches that still name them keep working).
 *
 * The hub calls are injected ({@link HubOps}), so the order is testable without a network; {@link hfCliOps} is the real
 * one (the `hf` CLI for writes, the public API for reads).
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { cookFiles, parseCookManifest, type CookManifest } from '../../packages/render/src/cook/format';

export { cookFiles };

/** The dataset of cooked packages. */
export const COOKED_REPO = 'StarAtNyte1/aether-cooked';
/** Where the write token lives when `HF_TOKEN` is not set. */
export const TOKEN_FILE = join(homedir(), '.config/aether/hf-write.token');
/** The `hf` CLI. */
export const HF_CLI = process.env['HF_CLI'] ?? join(homedir(), '.local/bin/hf');

/** What the uploader needs from the hub. */
export interface HubOps {
  /** Every file path under `dir` on the dataset (recursive, repository-relative), or an empty list when it does not exist. */
  listFiles(dir: string): Promise<string[]>;
  /** The dataset's `<slug>/manifest.json`, parsed, or null when there is none (or it does not parse). */
  readManifest(slug: string): Promise<{ dir?: unknown } | null>;
  /** Upload a local folder to `pathInRepo` (one commit). */
  uploadFolder(localDir: string, pathInRepo: string, message: string): Promise<void>;
  /** Upload one local file to `pathInRepo` (one commit). */
  uploadFile(localFile: string, pathInRepo: string, message: string): Promise<void>;
}

/** Outcome of {@link uploadPackage}. */
export interface UploadResult {
  slug: string;
  id: string;
  /** The `<id>/` folder was uploaded (false: it was already complete on the dataset). */
  files: boolean;
  /** The manifest was uploaded (false: the dataset's already named this id). */
  manifest: boolean;
}

/** Read and check the local package of `slug` under `root` (the cook's `--out`, `cooked/` by default). */
export function readLocalPackage(root: string, slug: string): { manifest: CookManifest; id: string; manifestPath: string; dir: string } {
  const manifestPath = join(root, slug, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`${slug}: no cooked package at ${manifestPath}`);
  const parsed = parseCookManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
  if (!parsed.ok) throw new Error(`${slug}: the local manifest does not parse: ${parsed.error}`);
  const m = parsed.manifest;
  const id = m.dir.replace(/\/$/, '');
  if (!/^[0-9a-f]{16}$/.test(id)) throw new Error(`${slug}: unexpected cook folder ${m.dir}`);
  const dir = join(root, slug, id);
  for (const f of cookFiles(m)) {
    const p = join(dir, f);
    if (!existsSync(p) || !statSync(p).isFile()) throw new Error(`${slug}: the manifest names ${f}, which is not in ${dir}`);
  }
  for (const p of m.packs) if (statSync(join(dir, p.file)).size !== p.bytes) throw new Error(`${slug}: ${p.file} is not the size the manifest gives`);
  return { manifest: m, id, manifestPath, dir };
}

/** Files of `expected` (relative to `${slug}/${id}/`) missing from `listed` (repository paths). */
function missing(listed: readonly string[], slug: string, id: string, expected: readonly string[]): string[] {
  const have = new Set(listed);
  return expected.filter((f) => !have.has(`${slug}/${id}/${f}`));
}

/**
 * Upload the local package of `slug`: its `<id>/` folder unless the dataset already holds every file of it, then (after
 * checking the files are all there) its manifest, unless the dataset's manifest already names this id.
 */
export async function uploadPackage(root: string, slug: string, ops: HubOps, log: (s: string) => void = () => undefined): Promise<UploadResult> {
  const local = readLocalPackage(root, slug);
  const { id, manifest } = local;
  const expected = cookFiles(manifest);
  let files = false;
  let gone = missing(await ops.listFiles(`${slug}/${id}`), slug, id, expected);
  if (gone.length > 0) {
    log(`${slug}: uploading ${slug}/${id}/ (${gone.length} of ${expected.length} files missing on the dataset)`);
    await ops.uploadFolder(local.dir, `${slug}/${id}`, `Add cooked package ${slug}/${id}`);
    files = true;
    gone = missing(await ops.listFiles(`${slug}/${id}`), slug, id, expected);
    if (gone.length > 0) throw new Error(`${slug}: after the upload the dataset still lacks ${gone.slice(0, 3).join(', ')}${gone.length > 3 ? ', …' : ''}; the manifest was not uploaded`);
  } else log(`${slug}: ${slug}/${id}/ already on the dataset`);
  const remote = await ops.readManifest(slug);
  if (remote && remote.dir === manifest.dir) {
    log(`${slug}: the dataset's manifest already opens ${id}`);
    return { slug, id, files, manifest: false };
  }
  log(`${slug}: uploading ${slug}/manifest.json (${remote ? `was ${String(remote.dir)}` : 'new'})`);
  await ops.uploadFile(local.manifestPath, `${slug}/manifest.json`, `Point ${slug} at cooked package ${id}`);
  return { slug, id, files, manifest: true };
}

// --- The real hub -----------------------------------------------------------------------------------------------------

/**
 * The write token, handed to the `hf` CLI as `HF_TOKEN`: the token file when it exists (a shell's own `HF_TOKEN` is
 * often a read token), else `HF_TOKEN`. Never printed.
 */
export function hubToken(file: string = TOKEN_FILE): string {
  if (existsSync(file)) {
    const t = readFileSync(file, 'utf8').trim();
    if (!t) throw new Error(`${file} is empty`);
    return t;
  }
  const env = process.env['HF_TOKEN']?.trim();
  if (env) return env;
  throw new Error(`no Hugging Face write token: create ${file} or set HF_TOKEN`);
}

/** Run the `hf` CLI with the token in its environment only; its output is passed on with the token masked. */
function runHf(args: string[], token: string, log: (s: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(HF_CLI, args, { env: { ...process.env, HF_TOKEN: token, HF_HUB_DISABLE_PROGRESS_BARS: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    const take = (b: Buffer): void => {
      const text = b.toString('utf8').split(token).join('***');
      tail = (tail + text).slice(-2000);
      for (const line of text.split('\n')) if (line.trim()) log(`  hf: ${line.trim()}`);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`hf ${args[0]} exited with ${code}: ${tail.slice(-400)}`))));
  });
}

/** The real hub: reads through the public API (no token), writes with `hf upload`. */
export function hfCliOps(opts: { repo?: string; log?: (s: string) => void; fetch?: typeof fetch } = {}): HubOps {
  const repo = opts.repo ?? COOKED_REPO;
  const log = opts.log ?? ((s: string) => void process.stdout.write(`${s}\n`));
  const get = opts.fetch ?? fetch;
  let token: string | null = null;
  const tok = (): string => (token ??= hubToken());
  return {
    async listFiles(dir) {
      const out: string[] = [];
      let url: string | null = `https://huggingface.co/api/datasets/${repo}/tree/main/${dir.split('/').map(encodeURIComponent).join('/')}?recursive=true&expand=false`;
      while (url) {
        const res: Response = await get(url, { cache: 'no-store' });
        if (res.status === 404) return [];
        if (!res.ok) throw new Error(`listing ${dir}: HTTP ${res.status}`);
        for (const e of (await res.json()) as Array<{ type: string; path: string }>) if (e.type === 'file') out.push(e.path);
        // The tree API pages with a Link header.
        const next: RegExpMatchArray | null = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '');
        url = next ? next[1]! : null;
      }
      return out;
    },
    async readManifest(slug) {
      const res = await get(`https://huggingface.co/datasets/${repo}/resolve/main/${encodeURIComponent(slug)}/manifest.json`, { cache: 'no-store' });
      if (!res.ok) return null;
      try {
        return JSON.parse(await res.text()) as { dir?: unknown };
      } catch {
        return null;
      }
    },
    async uploadFolder(localDir, pathInRepo, message) {
      await runHf(['upload', repo, localDir, pathInRepo, '--repo-type', 'dataset', '--commit-message', message], tok(), log);
    },
    async uploadFile(localFile, pathInRepo, message) {
      await runHf(['upload', repo, localFile, pathInRepo, '--repo-type', 'dataset', '--commit-message', message], tok(), log);
    },
  };
}
