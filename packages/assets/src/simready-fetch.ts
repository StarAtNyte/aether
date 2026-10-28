/**
 * Node-only half of the SimReady Central source: download one USD package at a pinned revision into a directory and
 * verify every file. Shared by the CLI (`scripts/assets/simready.ts`) and the local server's on-demand import
 * (`apps/server`, `POST /api/assets/import`). The browser never loads this file (`@aether/assets/simready-fetch`).
 *
 * Everything that comes from the network is untrusted data: hosts are allow-listed (huggingface.co and *.hf.co over
 * https, also after redirects), the revision must be a 40-hex commit, sizes are capped, and nothing downloaded is run.
 * Tokens and secrets are never read from the environment or logged.
 */
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { SIMREADY_ALLOWED, enrichRef, type FetchLike, type SimreadyRef } from './simready';

/** Where SimReady packages are downloaded (never inside the repository). */
export const SIMREADY_DIR = resolve(process.env['AETHER_ASSET_SRC'] ?? join(homedir(), '.cache', 'aether-asset-src'), 'simready');

/** Caps of the developer CLI. The on-demand import passes lower ones. */
export const CLI_LIMITS = { fileBytes: 256 * 1024 * 1024, packageBytes: 768 * 1024 * 1024, files: 400 } as const;
/** Caps of the on-demand import: one package at most 150 MB. */
export const IMPORT_LIMITS = { fileBytes: 150 * 1024 * 1024, packageBytes: 150 * 1024 * 1024, files: 200 } as const;

export interface FetchLimits {
  fileBytes: number;
  packageBytes: number;
  files: number;
}

/** True for hosts a download may come from. */
export const hostAllowed = (h: string): boolean => h === 'huggingface.co' || h.endsWith('.huggingface.co') || h.endsWith('.hf.co');

/** Throws unless `url` is https on an allowed host (no credentials, no odd port). */
export function checkUrl(url: string): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error('refusing to download from an unparseable URL');
  }
  if (u.protocol !== 'https:' || !hostAllowed(u.hostname) || u.username !== '' || u.password !== '' || (u.port !== '' && u.port !== '443')) throw new Error(`refusing to download from ${u.origin}`);
}

/** The subset of `fetch` the downloader uses (a stream body for files, json for listings). */
export type StreamFetch = (url: string, init?: { redirect?: 'follow'; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; url: string; body: ReadableStream<Uint8Array> | null; json(): Promise<unknown> }>;

export interface FetchOptions {
  /** Target directory root (default {@link SIMREADY_DIR}). */
  dir?: string;
  limits?: FetchLimits;
  /** Network (tests inject a mock). */
  fetch?: StreamFetch;
  /** One line per step, no URLs with tokens (none are used). */
  onProgress?: (message: string, done: number, total: number) => void;
  signal?: AbortSignal;
}

const defaultFetch = (): StreamFetch => globalThis.fetch as unknown as StreamFetch;

function withSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const t = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([t, signal]) : t;
}

async function getJson(f: StreamFetch, url: string, signal?: AbortSignal): Promise<unknown> {
  checkUrl(url);
  const res = await f(url, { signal: withSignal(60_000, signal) });
  if (!res.ok) throw new Error(`GET ${new URL(url).pathname.slice(0, 80)}: HTTP ${res.status}`);
  return res.json();
}

interface TreeFile {
  path: string;
  size: number;
  oid: string;
  lfsSha256: string | null;
}

async function listPackage(f: StreamFetch, ref: SimreadyRef, signal?: AbortSignal): Promise<TreeFile[]> {
  const raw = await getJson(f, `https://huggingface.co/api/datasets/${ref.repo}/tree/${ref.rev}/${ref.pkg}?recursive=true&expand=false`, signal);
  if (!Array.isArray(raw)) throw new Error('unexpected tree listing');
  if (raw.length >= 1000) throw new Error('tree listing was cut at 1000 entries; refusing a package this large');
  const out: TreeFile[] = [];
  for (const e of raw as Array<Record<string, unknown>>) {
    if (e['type'] !== 'file') continue;
    const path = String(e['path']);
    const rel = path.slice(ref.pkg.length + 1);
    if (!path.startsWith(`${ref.pkg}/`) || rel.startsWith('/') || rel.split('/').some((s) => s === '..' || s === '' || s.includes('\\'))) throw new Error(`unsafe path in listing: ${path.slice(0, 120)}`);
    const lfs = e['lfs'] as { oid?: string } | undefined;
    const size = Number(e['size']);
    if (!Number.isFinite(size) || size < 0) throw new Error(`bad size in listing for ${rel.slice(0, 80)}`);
    out.push({ path: rel, size, oid: String(e['oid']), lfsSha256: lfs?.oid && /^[0-9a-f]{64}$/.test(lfs.oid) ? lfs.oid : null });
  }
  return out;
}

async function download(f: StreamFetch, ref: SimreadyRef, file: TreeFile, dest: string, limits: FetchLimits, signal?: AbortSignal): Promise<void> {
  if (file.size > limits.fileBytes) throw new Error(`${file.path}: ${file.size} bytes is over the per-file cap`);
  const url = `https://huggingface.co/datasets/${ref.repo}/resolve/${ref.rev}/${ref.pkg}/${file.path.split('/').map(encodeURIComponent).join('/')}`;
  checkUrl(url);
  const res = await f(url, { redirect: 'follow', signal: withSignal(300_000, signal) });
  if (!res.ok || !res.body) throw new Error(`GET ${file.path}: HTTP ${res.status}`);
  checkUrl(res.url);
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  let bytes = 0;
  const sha256 = createHash('sha256');
  const blob = createHash('sha1').update(`blob ${file.size}\0`);
  const stream = Readable.fromWeb(res.body as never);
  stream.on('data', (c: Buffer) => {
    bytes += c.byteLength;
    if (bytes > file.size) stream.destroy(new Error(`${file.path}: more bytes than listed`));
    sha256.update(c);
    blob.update(c);
  });
  try {
    await pipeline(stream, createWriteStream(tmp));
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  if (bytes !== file.size) {
    rmSync(tmp, { force: true });
    throw new Error(`${file.path}: got ${bytes} bytes, listed ${file.size}`);
  }
  const got = sha256.digest('hex');
  if (file.lfsSha256 !== null) {
    if (got !== file.lfsSha256) {
      rmSync(tmp, { force: true });
      throw new Error(`${file.path}: sha256 mismatch (got ${got}, LFS says ${file.lfsSha256})`);
    }
  } else if (blob.digest('hex') !== file.oid) {
    rmSync(tmp, { force: true });
    throw new Error(`${file.path}: git blob id mismatch`);
  }
  renameSync(tmp, dest);
}

/** Lowercase hex SHA-256 of a file. */
export const sha256File = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');

/** Parse `owner/dataset@<40-hex>/package`. */
export function parseTarget(target: string): SimreadyRef {
  const m = /^([A-Za-z0-9][A-Za-z0-9._-]{0,127})\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})@([0-9a-f]{40})\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/.exec(target);
  if (!m) throw new Error('target must be <owner>/<dataset>@<40-hex revision>/<package> (a pinned commit, never a branch)');
  return { owner: m[1]!, dataset: m[2]!, repo: `${m[1]}/${m[2]}`, rev: m[3]!, pkg: m[4]!, file: '' };
}

/** Directory a fetched package lives in. */
export const packageDir = (r: Pick<SimreadyRef, 'owner' | 'dataset' | 'rev' | 'pkg'>, root: string = SIMREADY_DIR): string => join(root, r.owner, r.dataset, r.rev, r.pkg);

export interface FetchedPackage {
  dir: string;
  licence: string;
  author: string;
  packageHash: string | null;
  usd: { path: string; sha256: string; bytes: number };
  licenceRaw: { packaging: string | null; card: string | null };
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/**
 * Licence check, listing, download and verification of one package. Refuses a licence that is not on the allow-list,
 * a package over the caps and any file whose hash differs from what the Hub lists or the package's own bill of materials pins.
 */
export async function fetchPackage(ref: SimreadyRef, opts: FetchOptions = {}): Promise<FetchedPackage> {
  const net = opts.fetch ?? defaultFetch();
  const limits = opts.limits ?? CLI_LIMITS;
  const say = opts.onProgress ?? ((): void => undefined);
  const info = await enrichRef(ref, net as unknown as FetchLike, new Map());
  if (!info.allowed || !info.licence) throw new Error(`refused ${ref.repo}/${ref.pkg}: ${info.reason}. Allowed: ${SIMREADY_ALLOWED.join(', ')}.`);
  const files = await listPackage(net, ref, opts.signal);
  if (files.length === 0 || files.length > limits.files) throw new Error(`package lists ${files.length} files`);
  const total = files.reduce((s, x) => s + x.size, 0);
  if (total > limits.packageBytes) throw new Error(`package is ${(total / 1e6).toFixed(0)} MB, over the ${(limits.packageBytes / 1e6).toFixed(0)} MB cap`);
  const dir = packageDir(ref, opts.dir);
  const marker = `${dir}.fetched.json`;
  if (!existsSync(marker)) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    for (const [i, file] of files.entries()) {
      const dest = resolve(dir, file.path);
      if (!dest.startsWith(resolve(dir) + sep)) throw new Error(`path escapes the package: ${file.path.slice(0, 120)}`);
      say(`[${i + 1}/${files.length}] ${file.path} (${(file.size / 1024).toFixed(0)} KB)`, i, files.length);
      await download(net, ref, file, dest, limits, opts.signal);
    }
    // Bill of materials: packaging.json pins its hash, it pins every file.
    const packaging = JSON.parse(readFileSync(join(dir, 'com.nvidia.simready.packaging.json'), 'utf8')) as { metadata?: Array<{ name: string; hash?: { sha256?: string } }> };
    const bomPath = join(dir, '.metadata', 'com.nvidia.simready.packaging.bom.json');
    if (existsSync(bomPath)) {
      const pinned = packaging.metadata?.find((m) => m.name === 'com.nvidia.simready.packaging.bom.json')?.hash?.sha256;
      if (pinned && sha256File(bomPath) !== pinned) throw new Error('bill of materials does not match the hash packaging.json pins');
      const bom = JSON.parse(readFileSync(bomPath, 'utf8')) as { items: Array<{ relative_path: string; size: number; hash: { sha256?: string } }> };
      let checked = 0;
      for (const item of bom.items) {
        const p = resolve(dir, item.relative_path);
        if (!p.startsWith(resolve(dir) + sep)) throw new Error(`unsafe bill-of-materials path ${item.relative_path.slice(0, 120)}`);
        if (!existsSync(p)) continue;
        if (item.hash.sha256 && sha256File(p) !== item.hash.sha256) throw new Error(`${item.relative_path}: differs from the bill of materials`);
        checked++;
      }
      say(`bill of materials: ${checked} files verified`, files.length, files.length);
    } else say('note: the package has no bill of materials; only the Hugging Face hashes were checked', files.length, files.length);
    writeFileSync(marker, `${JSON.stringify({ ref, fetched: new Date().toISOString().slice(0, 10), files: files.length })}\n`);
  } else say(`already fetched: ${dir}`, files.length, files.length);
  const usdRel = walk(dir).find((p) => /simready_usd\/[^/]+\.usd[acz]?$/.test(p.slice(dir.length + 1)));
  if (!usdRel) throw new Error('no simready_usd/*.usd in the package');
  return {
    dir,
    licence: info.licence,
    author: info.author ?? ref.owner,
    packageHash: info.packageHash,
    usd: { path: usdRel.slice(dir.length + 1), sha256: sha256File(usdRel), bytes: statSync(usdRel).size },
    licenceRaw: info.licenceRaw,
  };
}
