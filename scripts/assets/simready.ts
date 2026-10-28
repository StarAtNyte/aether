/**
 * NVIDIA SimReady Central as an asset source (dev tool; the studio never needs it).
 *
 *   npm run assets:simready -- search "range cooker" [--limit=8] [--max-size=2] [--min-size=0.2] [--json]
 *   npm run assets:simready -- fetch LGElectronics/simready-assets@<40-hex revision>/cooking_ldgl6924s
 *
 * search: asks the public SimReady Central service (semantic search over USD packages), looks up the licence of every
 *   hit (the package's own `com.nvidia.simready.packaging.json` and the dataset card) and prints ONLY the hits whose
 *   licence is on the allow-list (CC0, CC-BY-4.0 in all its spellings, MIT, Apache-2.0, BSD). Everything else is listed
 *   as rejected with the reason.
 * fetch: downloads one package at a pinned revision (never a branch) into
 *   `~/.cache/aether-asset-src/simready/<owner>/<dataset>/<revision>/<package>` (outside the repository, the package
 *   folder name unchanged), after re-checking the licence. Every file is verified: Git LFS sha256, Git blob id for the
 *   small files, then the package's own bill of materials (sha256 of every file), whose hash packaging.json pins.
 *   Downloaded files are untrusted data: nothing in them is ever run, and the converter reads them with `python -I`.
 *
 * Importing into the library afterwards: see docs/ASSETS.md, "SimReady Central".
 */
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { SIMREADY_ALLOWED, describeSimreadyHit, enrichRef, searchSimready, type FetchLike, type SimreadyRef } from '../../packages/assets/src/simready';

/** Where SimReady packages are downloaded (never inside the repository). */
export const SIMREADY_DIR = resolve(process.env['AETHER_ASSET_SRC'] ?? join(homedir(), '.cache', 'aether-asset-src'), 'simready');

const MAX_FILE_BYTES = 256 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 768 * 1024 * 1024;
const MAX_FILES = 400;
const HOSTS = (h: string): boolean => h === 'huggingface.co' || h.endsWith('.huggingface.co') || h.endsWith('.hf.co');

const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

function checkUrl(url: string): void {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !HOSTS(u.hostname)) throw new Error(`refusing to download from ${u.origin}`);
}

async function getJson(url: string): Promise<unknown> {
  checkUrl(url);
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);
  return (await res.json()) as unknown;
}

interface TreeFile {
  path: string;
  size: number;
  oid: string;
  lfsSha256: string | null;
}

async function listPackage(ref: SimreadyRef): Promise<TreeFile[]> {
  const raw = await getJson(`https://huggingface.co/api/datasets/${ref.repo}/tree/${ref.rev}/${ref.pkg}?recursive=true&expand=false`);
  if (!Array.isArray(raw)) throw new Error('unexpected tree listing');
  if (raw.length >= 1000) throw new Error('tree listing was cut at 1000 entries; refusing a package this large');
  const out: TreeFile[] = [];
  for (const e of raw as Array<Record<string, unknown>>) {
    if (e['type'] !== 'file') continue;
    const path = String(e['path']);
    const rel = path.slice(ref.pkg.length + 1);
    if (!path.startsWith(`${ref.pkg}/`) || rel.startsWith('/') || rel.split('/').some((s) => s === '..' || s === '' || s.includes('\\'))) throw new Error(`unsafe path in listing: ${path}`);
    const lfs = e['lfs'] as { oid?: string } | undefined;
    out.push({ path: rel, size: Number(e['size']), oid: String(e['oid']), lfsSha256: lfs?.oid && /^[0-9a-f]{64}$/.test(lfs.oid) ? lfs.oid : null });
  }
  return out;
}

async function download(ref: SimreadyRef, f: TreeFile, dest: string): Promise<void> {
  if (f.size > MAX_FILE_BYTES) throw new Error(`${f.path}: ${f.size} bytes is over the per-file cap`);
  const url = `https://huggingface.co/datasets/${ref.repo}/resolve/${ref.rev}/${ref.pkg}/${f.path.split('/').map(encodeURIComponent).join('/')}`;
  checkUrl(url);
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(300_000) });
  if (!res.ok || !res.body) throw new Error(`GET ${url}: HTTP ${res.status}`);
  checkUrl(res.url);
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  let bytes = 0;
  const sha256 = createHash('sha256');
  const blob = createHash('sha1').update(`blob ${f.size}\0`);
  const stream = Readable.fromWeb(res.body as never);
  stream.on('data', (c: Buffer) => {
    bytes += c.byteLength;
    if (bytes > f.size) stream.destroy(new Error(`${f.path}: more bytes than listed`));
    sha256.update(c);
    blob.update(c);
  });
  await pipeline(stream, createWriteStream(tmp));
  if (bytes !== f.size) throw new Error(`${f.path}: got ${bytes} bytes, listed ${f.size}`);
  const got = sha256.digest('hex');
  if (f.lfsSha256 !== null) {
    if (got !== f.lfsSha256) throw new Error(`${f.path}: sha256 mismatch (got ${got}, LFS says ${f.lfsSha256})`);
  } else if (blob.digest('hex') !== f.oid) throw new Error(`${f.path}: git blob id mismatch`);
  renameSync(tmp, dest);
}

const sha256File = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');

/** Parse `owner/dataset@<40-hex>/package`. */
export function parseTarget(target: string): SimreadyRef {
  const m = /^([A-Za-z0-9][A-Za-z0-9._-]{0,127})\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})@([0-9a-f]{40})\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/.exec(target);
  if (!m) throw new Error('target must be <owner>/<dataset>@<40-hex revision>/<package> (a pinned commit, never a branch)');
  return { owner: m[1]!, dataset: m[2]!, repo: `${m[1]}/${m[2]}`, rev: m[3]!, pkg: m[4]!, file: '' };
}

/** Directory a fetched package lives in. */
export const packageDir = (r: Pick<SimreadyRef, 'owner' | 'dataset' | 'rev' | 'pkg'>): string => join(SIMREADY_DIR, r.owner, r.dataset, r.rev, r.pkg);

export interface FetchedPackage {
  dir: string;
  licence: string;
  author: string;
  packageHash: string | null;
  usd: { path: string; sha256: string; bytes: number };
  licenceRaw: { packaging: string | null; card: string | null };
}

export async function fetchPackage(ref: SimreadyRef): Promise<FetchedPackage> {
  const f = fetch as unknown as FetchLike;
  const info = await enrichRef(ref, f, new Map());
  if (!info.allowed || !info.licence) throw new Error(`refused ${ref.repo}/${ref.pkg}: ${info.reason}. Allowed: ${SIMREADY_ALLOWED.join(', ')}.`);
  const files = await listPackage(ref);
  if (files.length === 0 || files.length > MAX_FILES) throw new Error(`package lists ${files.length} files`);
  const total = files.reduce((s, x) => s + x.size, 0);
  if (total > MAX_PACKAGE_BYTES) throw new Error(`package is ${(total / 1e6).toFixed(0)} MB, over the cap`);
  const dir = packageDir(ref);
  const marker = `${dir}.fetched.json`;
  if (!existsSync(marker)) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    for (const [i, file] of files.entries()) {
      const dest = resolve(dir, file.path);
      if (!dest.startsWith(resolve(dir) + sep)) throw new Error(`path escapes the package: ${file.path}`);
      process.stdout.write(`[${i + 1}/${files.length}] ${file.path} (${(file.size / 1024).toFixed(0)} KB)\n`);
      await download(ref, file, dest);
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
        if (!p.startsWith(resolve(dir) + sep)) throw new Error(`unsafe bill-of-materials path ${item.relative_path}`);
        if (!existsSync(p)) continue;
        if (item.hash.sha256 && sha256File(p) !== item.hash.sha256) throw new Error(`${item.relative_path}: differs from the bill of materials`);
        checked++;
      }
      console.log(`bill of materials: ${checked} files verified`);
    } else console.log('note: the package has no bill of materials; only the Hugging Face hashes were checked');
    writeFileSync(marker, `${JSON.stringify({ ref, fetched: new Date().toISOString().slice(0, 10), files: files.length })}\n`);
  } else console.log(`already fetched: ${dir}`);
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

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (cmd === 'search') {
    const query = rest.join(' ');
    const maxSize = arg('max-size');
    const minSize = arg('min-size');
    const r = await searchSimready({ query, limit: Number(arg('limit') ?? 8), ...(maxSize ? { maxSize: Number(maxSize) } : {}), ...(minSize ? { minSize: Number(minSize) } : {}) });
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify(r, null, 2));
      process.exit(r.ok ? 0 : 2);
    }
    if (!r.ok) {
      console.error(r.error);
      process.exit(2);
    }
    console.log(`SimReady Central: "${r.query}", ${r.considered} hits looked at, ${r.accepted.length} with an allowed licence (${SIMREADY_ALLOWED.join(', ')}), ${r.rejected.length} rejected.`);
    for (const h of r.accepted) console.log(`  ${describeSimreadyHit(h)}${h.reason ? `\n    note: ${h.reason}` : ''}\n    ${h.importable ? h.fetch : '(not importable until the catalog schema takes this licence)'}`);
    if (r.rejected.length > 0) {
      console.log('Rejected (not shown as results):');
      for (const h of r.rejected) console.log(`  ${h.ref.pkg} (${h.ref.repo}): ${h.reason}`);
    }
    return;
  }
  if (cmd === 'fetch') {
    if (!rest[0]) throw new Error('usage: fetch <owner>/<dataset>@<40-hex revision>/<package>');
    const got = await fetchPackage(parseTarget(rest[0]));
    console.log(`ok ${got.dir}\n  licence ${got.licence} (package: ${got.licenceRaw.packaging}, dataset card: ${got.licenceRaw.card}), author ${got.author}\n  usd ${got.usd.path} ${got.usd.bytes} bytes sha256 ${got.usd.sha256}\n  package_hash ${got.packageHash}`);
    return;
  }
  console.error('usage: assets:simready -- search "<text>" [--limit=8] [--max-size=2] [--json]\n       assets:simready -- fetch <owner>/<dataset>@<40-hex revision>/<package>');
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
