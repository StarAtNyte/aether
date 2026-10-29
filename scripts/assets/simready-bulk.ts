/**
 * Bulk, resumable SimReady -> GLB pipeline. Deterministic: no model or LLM calls anywhere.
 *
 *   npm run assets:simready -- bulk [--max=600] [--concurrency=2] [--time-budget=8] [--chunk=12] [--publish-every=50]
 *       [--queries=chair,sofa] [--discover-only] [--rediscover] [--no-publish] [--no-push] [--max-pkg-mb=400] [--min-free-gb=6]
 *
 * discover  scripts/assets/simready-queries.json (category terms, 60 hits each) -> licence gate -> denylist, size and
 *           "already have" filters -> at most two variants per name stem
 * convert   pinned, hash-verified fetch -> usd2glb.py -> the library's interior pipeline (build.ts --import-one, triangle
 *           budget by size, meshopt, 512 px textures, distance level, light copy) -> front from the shape -> quality gates ->
 *           192 px thumbnail -> gates again. Failures go to rejected.json with reasons, never to the dataset.
 * publish   every `--publish-every` accepted models: hf-dataset build + verify + upload --pin (a commit per batch) and the
 *           small assets/hub.json pin pushed to main. The models live in the hub dataset only, never in git.
 *
 * State (resumable): ~/.local/share/aether/simready-bulk/{state.json,out/,rejected.json,run.log}. The write token is read by
 * hf-dataset.ts from ~/.config/aether/hf-write.token or HF_TOKEN and never touches this file. Downloaded files are untrusted
 * data: they live in their own cache directory, are read by `python -I` only and are deleted after conversion.
 */
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statfsSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = resolve(import.meta.dirname, '../..');
export const BULK_DIR = process.env['AETHER_BULK_DIR'] ?? join(homedir(), '.local', 'share', 'aether', 'simready-bulk');
export const OUT = join(BULK_DIR, 'out');
const WORK = join(BULK_DIR, 'work');
const STATE = join(BULK_DIR, 'state.json');
const REJECTED = join(BULK_DIR, 'rejected.json');
// The headless browser serves the bulk output for thumbnails (read when browser.ts is loaded, below).
process.env['AETHER_BROWSER_EXTRA_DIR'] = OUT;

import { CatalogEntry, type CatalogEntryInput } from '../../packages/assets/src/schema';
import { enrichRef, SIMREADY_API, parseSimreadyUrl, type FetchLike, type SimreadyRef } from '../../packages/assets/src/simready';
import { fetchPackage, packageDir, SIMREADY_DIR } from '../../packages/assets/src/simready-fetch';
import { hubLicenceAllowed } from '../../packages/assets/src/hub';
import { BACKED_TYPES, FRONT_FIX_REV, FRONT_OVERRIDES } from './front';
import { acquireLock } from './bulk-lock';
import { loadFrontOverrides, placeOf } from './front-overrides';
import { budgetFor, gateModel, gateThumb } from './simready-gate';

const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string): boolean => process.argv.includes(`--${name}`);
const sha = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const stamp = (): string => new Date().toISOString().slice(11, 19);
const log = (m: string): void => void console.log(`${stamp()} ${m}`);

type Status = 'discovered' | 'fetched' | 'converted' | 'rejected' | 'published' | 'skipped';

interface Rec {
  key: string;
  id: string;
  repo: string;
  rev: string;
  pkg: string;
  file: string;
  query: string;
  type: string;
  category: string;
  place: string;
  symmetric: boolean;
  priority: number;
  score: number;
  usdBytes: number | null;
  status: Status;
  reason?: string;
  licence?: string;
  author?: string;
  packageHash?: string | null;
  usdSha256?: string;
  attempts?: number;
  /** The front rules (`front.ts`, FRONT_FIX_REV) this model was converted with; absent: converted before they existed. */
  fixRev?: number;
  tris?: number;
  bytes?: number;
  secs?: number;
  trianglesIn?: number | null;
  size?: [number, number, number];
  front?: { rot: number | null; sure: boolean; why: string };
  hashes?: Record<string, string>;
  thumb?: boolean;
  updated?: string;
}

interface State {
  version: 1;
  created: string;
  queriesDone: string[];
  records: Record<string, Rec>;
  runs: Array<{ start: string; end?: string; converted: number; rejected: number }>;
}

interface QueryFile {
  limit: number;
  denylist: string[];
  queries: Array<{ q: string; type: string; category: string; place: string; symmetric?: boolean }>;
}

function loadState(): State {
  if (existsSync(STATE)) return JSON.parse(readFileSync(STATE, 'utf8')) as State;
  return { version: 1, created: new Date().toISOString(), queriesDone: [], records: {}, runs: [] };
}

function saveState(s: State): void {
  mkdirSync(BULK_DIR, { recursive: true });
  const tmp = `${STATE}.tmp`;
  writeFileSync(tmp, JSON.stringify(s));
  renameSync(tmp, STATE);
  const rej = Object.values(s.records)
    .filter((r) => r.status === 'rejected' || r.status === 'skipped')
    .map((r) => ({ id: r.id, key: r.key, status: r.status, reason: r.reason ?? '', query: r.query }));
  writeFileSync(REJECTED, `${JSON.stringify(rej, null, 1)}\n`);
}

const touch = (r: Rec, status: Status, reason?: string): void => {
  r.status = status;
  if (reason !== undefined) r.reason = reason;
  else delete r.reason;
  r.updated = new Date().toISOString();
};

// ---------------------------------------------------------------- discovery

const netFetch: FetchLike = (url, init) => globalThis.fetch(url, init as RequestInit) as unknown as ReturnType<FetchLike>;

async function search(q: string, limit: number): Promise<Array<{ ref: SimreadyRef; score: number; usdBytes: number | null }>> {
  const body: Record<string, unknown> = { description: q, limit, return_metadata: true };
  for (const a of ['x', 'y', 'z']) body[`max_bbox_${a}`] = 4;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${SIMREADY_API}/search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = (await res.json()) as unknown;
      if (!Array.isArray(raw)) throw new Error('unexpected shape');
      const out: Array<{ ref: SimreadyRef; score: number; usdBytes: number | null }> = [];
      for (const r of raw as Array<Record<string, unknown>>) {
        const ref = typeof r['url'] === 'string' ? parseSimreadyUrl(r['url']) : null;
        if (!ref) continue;
        const meta = (r['metadata'] ?? {}) as Record<string, unknown>;
        out.push({ ref, score: typeof r['score'] === 'number' ? r['score'] : 0, usdBytes: typeof meta['size'] === 'number' ? Math.round(meta['size']) : null });
      }
      return out;
    } catch (e) {
      if (attempt >= 3) throw e;
      await sleep(3000 * (attempt + 1));
    }
  }
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Name stem: the package without its variant suffix (`_a01`, `_b02`, `_03`). */
export function stemOf(pkg: string): string {
  const parts = pkg.toLowerCase().split(/[_-]/);
  while (parts.length > 1 && /^([a-z]\d{1,3}|v?\d{1,3}|[a-z])$/.test(parts[parts.length - 1] as string)) parts.pop();
  return parts.join('_');
}

/** True when a package name carries a denylisted word (whole words only: "screwdriver" is not "screw"). */
export function denied(pkg: string, deny: readonly string[]): string | null {
  const lower = pkg.toLowerCase();
  const parts = lower.split(/[_\-.]/);
  for (const w of deny) if (w.includes('_') ? lower.includes(w) : parts.includes(w)) return w;
  return /robot_?arm/.test(lower) ? 'robot_arm' : null;
}

function haveSets(): { ids: Set<string>; pkgs: Set<string> } {
  const ids = new Set<string>();
  const pkgs = new Set<string>();
  try {
    for (const e of (JSON.parse(readFileSync(join(ROOT, 'assets', 'catalog.json'), 'utf8')) as { entries: Array<{ id: string }> }).entries) ids.add(e.id);
    for (const p of (JSON.parse(readFileSync(join(ROOT, 'assets', 'sources.json'), 'utf8')) as { simready?: { packages: Array<{ package: string }> } }).simready?.packages ?? []) pkgs.add(p.package.toLowerCase());
  } catch { /* nothing to compare with */ }
  const stage = join(homedir(), '.local', 'share', 'aether', 'hf-assets-stage', 'index.json');
  if (existsSync(stage)) {
    try {
      for (const r of (JSON.parse(readFileSync(stage, 'utf8')) as { rows: Array<{ id: string; source: { path: string } }> }).rows) {
        ids.add(r.id);
        const p = r.source.path.split('/')[0];
        if (p && /simready/.test(r.id)) pkgs.add(p.toLowerCase());
      }
    } catch { /* ignore */ }
  }
  return { ids, pkgs };
}

function uniqueId(state: State, pkg: string, key: string): string {
  let id = `simready-${slug(pkg)}`;
  if (id.length > 64) id = `${id.slice(0, 56).replace(/-+$/, '')}-${sha(key).slice(0, 6)}`;
  const clash = Object.values(state.records).find((r) => r.id === id && r.key !== key);
  return clash ? `${id.slice(0, 57).replace(/-+$/, '')}-${sha(key).slice(0, 6)}` : id;
}

/**
 * The search is semantic and returns its nearest packages whatever they are, so the type, category and placement come from the
 * package's own name when a query term names it (`cart_mobile` -> cart), and from the query that found it only as a last resort.
 */
/** True for packages named by a code only (`D00825`): nothing in the name says what they are. */
export const opaque = (pkg: string): boolean => !/[a-z]{3}/i.test(pkg.replace(/[_\-.]?[a-z]?\d+[a-z0-9]*/gi, ''));

export function classify(pkg: string, qf: QueryFile, found: QueryFile['queries'][number]): QueryFile['queries'][number] {
  if (opaque(pkg)) return found;
  const parts = pkg.toLowerCase().replace(/^(sm|sim)_/, '').split(/[_\-.]/).filter((w) => !/^\d+$/.test(w));
  const singular = (w: string): string => (w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
  const words = parts.map(singular);
  const hit = (q: QueryFile['queries'][number]): boolean => {
    const t = q.type.split('-');
    const last = singular(q.q.split(' ').pop() as string);
    return words.includes(q.type) || words.includes(last) || t.every((x) => words.includes(x));
  };
  for (const w of words.slice(0, 3)) {
    const q = qf.queries.find((x) => singular(x.q.split(' ').pop() as string) === w || x.type === w);
    if (q) return q;
  }
  const any = qf.queries.find(hit);
  if (any) return any;
  const first = pkg.toLowerCase().replace(/^(sm|sim)_/, '').split('_')[0] ?? '';
  return { q: found.q, type: /^[a-z][a-z-]{2,30}$/.test(first) ? first : (words[0] ?? found.type), category: 'props', place: found.place === 'wall' || found.place === 'ceiling' ? 'floor' : found.place, symmetric: false };
}

async function discover(state: State, qf: QueryFile, only: string[] | null): Promise<void> {
  const queries = qf.queries.filter((q) => !only || only.some((o) => q.q.includes(o)));
  const todo = queries.filter((q) => flag('rediscover') || !state.queriesDone.includes(q.q));
  log(`discovery: ${todo.length} of ${queries.length} queries to run (${qf.limit} hits each)`);
  const have = haveSets();
  let n = 0;
  for (const q of todo) {
    let hits: Awaited<ReturnType<typeof search>>;
    try {
      hits = await search(q.q, qf.limit);
    } catch (e) {
      log(`  query "${q.q}" failed: ${e instanceof Error ? e.message : e}`);
      continue;
    }
    const qi = qf.queries.indexOf(q);
    hits.forEach((h, rank) => {
      const key = `${h.ref.repo}@${h.ref.rev}/${h.ref.pkg}`;
      if (state.records[key]) return;
      const id = uniqueId(state, h.ref.pkg, key);
      const c = classify(h.ref.pkg, qf, q);
      const rec: Rec = { key, id, repo: h.ref.repo, rev: h.ref.rev, pkg: h.ref.pkg, file: h.ref.file, query: q.q, type: c.type, category: c.category, place: c.place, symmetric: c.symmetric === true, priority: rank * 1000 + qi, score: h.score, usdBytes: h.usdBytes, status: 'discovered' };
      state.records[key] = rec;
      const deny = denied(h.ref.pkg, qf.denylist);
      if (deny) touch(rec, 'skipped', `denylist: ${deny}`);
      else if (opaque(h.ref.pkg) && rank >= 8) touch(rec, 'skipped', 'opaque package name and not a top match');
      else if (have.ids.has(id) || have.pkgs.has(h.ref.pkg.toLowerCase())) touch(rec, 'skipped', 'already have');
      else if (h.usdBytes !== null && h.usdBytes > Number(arg('max-usd-mb') ?? 60) * 1e6) touch(rec, 'skipped', `usd file ${(h.usdBytes / 1e6).toFixed(0)} MB over the cap`);
      n++;
    });
    state.queriesDone.push(q.q);
    saveState(state);
    await sleep(400);
  }
  log(`discovery: ${n} new packages from ${todo.length} queries; ${Object.keys(state.records).length} known`);
  // At most two variants per name stem (best score first).
  const byStem = new Map<string, Rec[]>();
  for (const r of Object.values(state.records)) if (r.status === 'discovered') (byStem.get(`${r.repo}/${stemOf(r.pkg)}`) ?? byStem.set(`${r.repo}/${stemOf(r.pkg)}`, []).get(`${r.repo}/${stemOf(r.pkg)}`)!).push(r);
  let dropped = 0;
  for (const list of byStem.values()) {
    list.sort((a, b) => b.score - a.score);
    for (const r of list.slice(2)) {
      touch(r, 'skipped', `variant of ${stemOf(r.pkg)} (two kept)`);
      dropped++;
    }
  }
  if (dropped > 0) log(`discovery: ${dropped} near-identical variants dropped`);
  // Licence gate (package file + dataset card), a few at a time. Only CC0 and CC BY 4.0 can enter the hub dataset.
  const cards = new Map<string, Promise<{ license: string | null; author: string | null }>>();
  const pending = Object.values(state.records).filter((r) => r.status === 'discovered' && r.licence === undefined);
  log(`licence gate: ${pending.length} packages`);
  for (let i = 0; i < pending.length; i += 8) {
    await Promise.all(pending.slice(i, i + 8).map(async (r) => {
      try {
        const ref: SimreadyRef = { owner: r.repo.split('/')[0] as string, dataset: r.repo.split('/')[1] as string, repo: r.repo, rev: r.rev, pkg: r.pkg, file: r.file };
        const info = await enrichRef(ref, netFetch, cards);
        r.packageHash = info.packageHash;
        if (info.author) r.author = info.author;
        if (!info.allowed || !info.licence) touch(r, 'skipped', `licence: ${info.reason}`.slice(0, 200));
        else if (!hubLicenceAllowed(info.licence)) touch(r, 'skipped', `licence ${info.licence} is allowed to find but not accepted by the hub dataset (CC0-1.0 and CC-BY-4.0 only)`);
        else r.licence = info.licence;
      } catch (e) {
        r.reason = `licence lookup failed: ${e instanceof Error ? e.message : e}`.slice(0, 160);
      }
    }));
    if (i % 80 === 0) saveState(state);
  }
  saveState(state);
}

// ---------------------------------------------------------------- conversion

const PY = process.env['AETHER_USD_PYTHON'] ?? process.env['AETHER_SIMREADY_PY'] ?? join(homedir(), '.local', 'share', 'aether', 'simready', 'venv', 'bin', 'python');

const prettyName = (pkg: string, query: string): string => {
  if (opaque(pkg)) return `${query.charAt(0).toUpperCase()}${query.slice(1)} ${pkg}`.slice(0, 60);
  const words = pkg.replace(/^(sm|sim)_/i, '').split(/[_-]+/).filter((w) => w !== '' && !/^([a-z]\d{1,3}|v?\d{1,3})$/i.test(w));
  const s = words.join(' ').toLowerCase();
  return (s.charAt(0).toUpperCase() + s.slice(1)).slice(0, 60) || pkg.slice(0, 60);
};

interface ChildResult {
  code: number | null;
  out: string;
  err: string;
  timedOut: boolean;
}

/** Run the library build for one job; the whole process group is killed on timeout or abort. */
function runBuild(job: string, work: string, signal: AbortSignal): Promise<ChildResult> {
  return new Promise((done) => {
    const libDir = join(work, 'lib');
    const tiers = join(work, 'tiers');
    mkdirSync(libDir, { recursive: true });
    mkdirSync(tiers, { recursive: true });
    const child = spawn(process.execPath, ['--import', 'tsx', join(ROOT, 'scripts', 'assets', 'build.ts'), `--import-one=${job}`], {
      cwd: ROOT,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env['PATH'] ?? '', HOME: work, TMPDIR: work, AETHER_ASSET_LIB: libDir, AETHER_TIER_CACHE: tiers, AETHER_USD_PYTHON: PY, AETHER_TIER_PY: PY, AETHER_ASSET_SRC: join(work, 'src'), NODE_ENV: 'production' },
    });
    let out = '';
    let err = '';
    let timedOut = false;
    child.stdout.on('data', (c: Buffer) => void (out = (out + c.toString()).slice(-4000)));
    child.stderr.on('data', (c: Buffer) => void (err = (err + c.toString()).slice(-3000)));
    const kill = (): void => {
      timedOut = true;
      try {
        process.kill(-(child.pid as number), 'SIGKILL');
      } catch { /* already gone */ }
    };
    if (signal.aborted) kill();
    signal.addEventListener('abort', kill, { once: true });
    child.on('error', (e) => done({ code: 1, out, err: `${err}${e.message}`, timedOut }));
    child.on('close', (code) => {
      signal.removeEventListener('abort', kill);
      done({ code, out, err, timedOut });
    });
  });
}

const rejectReason = (s: string): string | null => /REJECT ([^\n]{1,200})/.exec(s)?.[1] ?? null;

async function convertOne(state: State, r: Rec): Promise<void> {
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), Number(arg('timeout-min') ?? 8) * 60_000);
  const ref: SimreadyRef = { owner: r.repo.split('/')[0] as string, dataset: r.repo.split('/')[1] as string, repo: r.repo, rev: r.rev, pkg: r.pkg, file: r.file };
  const work = join(WORK, r.id);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  try {
    const got = await fetchPackage(ref, { limits: { fileBytes: 300 * 1024 * 1024, packageBytes: Number(arg('max-pkg-mb') ?? 400) * 1024 * 1024, files: 300 }, signal: ac.signal });
    r.usdSha256 = got.usd.sha256;
    r.packageHash = got.packageHash;
    r.author = got.author;
    r.licence = got.licence;
    touch(r, 'fetched');
    if (!hubLicenceAllowed(got.licence)) {
      touch(r, 'skipped', `licence ${got.licence} not accepted by the hub dataset`);
      return;
    }
    const row = [r.pkg, r.id, r.type, r.category, 'realistic', prettyName(r.pkg, r.query), { tex: 512, place: r.place, tags: `${r.query} ${r.pkg.replace(/[_-]+/g, ' ').replace(/\b[a-z]?\d{1,3}\b/g, '')} simready`.replace(/\s+/g, ' ').trim().slice(0, 300) }];
    const job = join(work, 'job.json');
    writeFileSync(job, JSON.stringify({ usd: join(got.dir, got.usd.path), usdSha256: got.usd.sha256, row, author: got.author, licence: got.licence, archive: `simready:${r.repo}`, pack: 'simready', work, convert: ['--resmooth=50'], bulk: { symmetric: r.symmetric } }));
    const res = await runBuild(job, work, ac.signal);
    if (res.timedOut || ac.signal.aborted) {
      touch(r, 'rejected', `timeout after ${arg('timeout-min') ?? 8} min`);
      return;
    }
    if (res.code !== 0) {
      touch(r, 'rejected', rejectReason(res.err) ?? `converter failed: ${(res.err || res.out).trim().split('\n').slice(-2).join(' ').slice(0, 200)}`);
      return;
    }
    const result = JSON.parse(readFileSync(join(work, 'result.json'), 'utf8')) as { entry: CatalogEntryInput; files: Array<{ path: string; sha256: string; bytes: number }>; front?: Rec['front']; source: { size: [number, number, number]; trianglesIn: number | null } };
    const entry = result.entry;
    const libDir = join(work, 'lib');
    const dest = join(OUT, r.id);
    rmSync(dest, { recursive: true, force: true });
    const paths = [entry.file, ...(entry.lods ?? []).map((l) => l.file), entry.lite].filter((p): p is string => !!p);
    for (const p of paths) {
      mkdirSync(join(dest, 'lib', p.split('/')[0] as string), { recursive: true });
      cpSync(join(libDir, p), join(dest, 'lib', p));
    }
    r.front = result.front;
    r.size = entry.size as [number, number, number];
    r.trianglesIn = result.source.trianglesIn;
    r.tris = entry.tris;
    r.bytes = result.files[0]?.bytes ?? entry.bytes;
    r.hashes = Object.fromEntries(result.files.map((f) => [f.path, f.sha256]));
    const budget = budgetFor(Math.max(...r.size));
    const g = await gateModel(join(dest, 'lib', entry.file as string), { budget, size: r.size });
    if (!g.ok) {
      rmSync(dest, { recursive: true, force: true });
      touch(r, 'rejected', g.reasons.join('; '));
      return;
    }
    if (r.front && !r.front.sure) log(`  front unsure: ${r.id} (${r.front.why})`);
    writeFileSync(join(dest, 'entry.json'), JSON.stringify(entry));
    r.fixRev = FRONT_FIX_REV;
    touch(r, 'converted');
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (/^refused /.test(m)) touch(r, 'skipped', m.slice(0, 200));
    else if (/over the .* cap|lists \d+ files|tree listing was cut/.test(m)) touch(r, 'rejected', `package too big: ${m.slice(0, 120)}`);
    else if (ac.signal.aborted) touch(r, 'rejected', `timeout after ${arg('timeout-min') ?? 8} min`);
    else {
      r.attempts = (r.attempts ?? 0) + 1;
      touch(r, r.attempts >= 2 ? 'rejected' : 'discovered', `${r.attempts >= 2 ? '' : 'retry: '}${m.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timer);
    r.secs = Math.round((Date.now() - t0) / 1000);
    // The source cache is kept small: the package is deleted whatever happened.
    rmSync(packageDir(ref), { recursive: true, force: true });
    rmSync(`${packageDir(ref)}.fetched.json`, { force: true });
    rmSync(work, { recursive: true, force: true });
  }
}

/** Thumbnails of the converted models of a chunk (one headless browser), then the thumbnail gate and record.json. */
async function thumbs(state: State, recs: Rec[]): Promise<void> {
  const todo = recs.filter((r) => r.status === 'converted' && !r.thumb);
  if (todo.length === 0) return;
  const { withBrowserPage } = await import('./browser');
  const { SETUP } = await import('./thumb-render');
  try {
    await withBrowserPage(async (page) => {
      await page.addScriptTag({ type: 'module', content: SETUP });
      await page.waitForFunction(() => (window as unknown as { __thumbReady?: boolean }).__thumbReady === true, undefined, { timeout: 30_000 });
      for (const r of todo) {
        const dest = join(OUT, r.id);
        const entry = JSON.parse(readFileSync(join(dest, 'entry.json'), 'utf8')) as CatalogEntryInput;
        try {
          const b64 = await page.evaluate(([u]) => (window as unknown as { __thumb: { model(u: string, i: null, b: boolean, f: false): Promise<string> } }).__thumb.model(u as string, null, false, false), [`/extra/${r.id}/lib/${entry.file}`] as const);
          const data = Buffer.from(b64, 'base64');
          const bad = gateThumb(data);
          if (bad.length > 0) {
            rmSync(dest, { recursive: true, force: true });
            touch(r, 'rejected', bad.join('; '));
            continue;
          }
          const rel = `t/${r.id}.${sha(data).slice(0, 8)}.webp`;
          mkdirSync(join(dest, 'lib', 't'), { recursive: true });
          writeFileSync(join(dest, 'lib', rel), data);
          entry.thumb = rel;
          writeRecord(r, entry);
          r.thumb = true;
        } catch (e) {
          touch(r, 'rejected', `thumbnail failed: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
          rmSync(dest, { recursive: true, force: true });
        }
      }
    });
  } catch (e) {
    log(`thumbnail browser failed: ${e instanceof Error ? e.message : e}`);
  }
  saveState(state);
}

function writeRecord(r: Rec, entry: CatalogEntryInput): void {
  const e = CatalogEntry.parse({ ...entry, source: `simready/${r.repo}/${r.rev}/${r.pkg}`, tags: [...new Set((entry.tags ?? []).map((t) => String(t).toLowerCase()).filter((t) => /^[a-z0-9-]{1,32}$/.test(t)))].slice(0, 32) });
  const author = (r.author ?? r.repo.split('/')[0] ?? 'unknown').slice(0, 400);
  const dataset = r.repo;
  const record = {
    entry: e,
    licence: r.licence,
    author,
    source: {
      name: `NVIDIA SimReady Central, Hugging Face dataset ${dataset}`,
      url: `https://huggingface.co/datasets/${dataset}/tree/${r.rev}/${r.pkg}`,
      dataset,
      revision: r.rev,
      path: r.file ? `${r.pkg}/${r.file.replace(/^.*?simready_usd\//, 'simready_usd/')}`.slice(0, 300) : r.pkg,
      ...(r.usdSha256 ? { sha256: r.usdSha256 } : {}),
      ...(r.packageHash ? { packageHash: r.packageHash } : {}),
    },
    converted: 'Converted by Aether from OpenUSD to GLB (world transforms baked, triangulated, welded, Z-up to Y-up, metres), reduced in triangles and textures and compressed (meshopt). Modified from the source package; not NVIDIA-validated.',
    provenance: {
      derivedFrom: { dataset, revision: r.rev, package: r.pkg, usd: r.file ? r.file.replace(/^.*?simready_usd\//, 'simready_usd/') : null, usdSha256: r.usdSha256 ?? null, packageHash: r.packageHash ?? null },
      front: r.front ?? null,
      note: 'A derivative: the package was converted to a browser-sized GLB by Aether. It is not a SimReady package and has not been validated by NVIDIA.',
    },
  };
  writeFileSync(join(OUT, r.id, 'record.json'), JSON.stringify(record));
}

// ---------------------------------------------------------------- publishing

const tsx = (script: string, args: string[]): { status: number; out: string } => {
  const r = spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'scripts', 'assets', script), ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 90 * 60_000 });
  return { status: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
};

/** Push the small pin file to main from a throwaway worktree (the run's own checkout stays untouched). */
function pushPin(message: string): void {
  if (flag('no-push')) return;
  const git = (cwd: string, ...a: string[]): { status: number; out: string } => {
    const r = spawnSync('git', a, { cwd, encoding: 'utf8' });
    return { status: r.status ?? 1, out: `${r.stdout}${r.stderr}`.trim() };
  };
  const tmp = mkdtempSync(join(tmpdir(), 'aether-pin-'));
  try {
    if (git(ROOT, 'fetch', '-q', 'origin', 'main').status !== 0) return log('pin push: fetch failed');
    if (git(ROOT, 'worktree', 'add', '--detach', tmp, 'origin/main').status !== 0) return log('pin push: worktree failed');
    cpSync(join(ROOT, 'assets', 'hub.json'), join(tmp, 'assets', 'hub.json'));
    if (git(tmp, 'diff', '--quiet', '--', 'assets/hub.json').status === 0) return;
    git(tmp, 'add', 'assets/hub.json');
    const c = git(tmp, 'commit', '-q', '-m', message);
    if (c.status !== 0) return log(`pin push: commit failed ${c.out.slice(0, 120)}`);
    const p = git(tmp, 'push', 'origin', 'HEAD:main');
    log(p.status === 0 ? 'pinned assets/hub.json on main' : `pin push failed: ${p.out.slice(-160)}`);
  } finally {
    git(ROOT, 'worktree', 'remove', '--force', tmp);
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function publish(state: State): Promise<void> {
  const release = await acquireLock(BULK_DIR);
  try {
    publishLocked(state);
  } finally {
    release();
  }
}

function publishLocked(state: State): void {
  const ready = Object.values(state.records).filter((r) => r.status === 'converted' && r.thumb);
  if (ready.length === 0) return;
  log(`publish: staging (${ready.length} new models)`);
  const b = tsx('hf-dataset.ts', ['build']);
  log(`  build: ${b.out.split('\n').slice(-3).join(' | ').slice(0, 300)}`);
  if (b.status !== 0) return;
  const v = tsx('hf-dataset.ts', ['verify']);
  log(`  verify: ${v.out.split('\n').slice(-4).join(' | ').slice(0, 400)}`);
  if (v.status !== 0) return;
  const list = join(BULK_DIR, 'publish-ids.json');
  writeFileSync(list, JSON.stringify(ready.map((r) => r.id)));
  const u = tsx('hf-dataset.ts', ['upload', '--pin', `--only=${list}`, `--message=Add ${ready.length} SimReady-derived models`]);
  log(`  upload: ${u.out.split('\n').slice(-3).join(' | ').slice(0, 300)}`);
  if (u.status !== 0) return;
  for (const r of ready) touch(r, 'published');
  saveState(state);
  pushPin(`Pin the asset hub dataset after ${Object.values(state.records).filter((x) => x.status === 'published').length} more SimReady-derived models`);
}

// ---------------------------------------------------------------- main

function summary(state: State, started: number): void {
  const all = Object.values(state.records);
  const count = (s: Status): number => all.filter((r) => r.status === s).length;
  const reasons = new Map<string, number>();
  for (const r of all.filter((x) => x.status === 'rejected' || x.status === 'skipped')) {
    const k = (r.reason ?? '').replace(/\d+(\.\d+)?/g, 'N').split(/[;:]/)[0]!.slice(0, 60);
    reasons.set(`${r.status}: ${k}`, (reasons.get(`${r.status}: ${k}`) ?? 0) + 1);
  }
  const done = all.filter((r) => (r.status === 'converted' || r.status === 'published') && r.secs);
  const bytes = done.reduce((n, r) => n + (r.bytes ?? 0), 0);
  const avg = done.length ? done.reduce((n, r) => n + (r.secs ?? 0), 0) / done.length : 0;
  const waiting = all.filter((r) => r.status === 'discovered' && r.licence).length;
  log('---- summary ----');
  log(`known ${all.length} | waiting ${waiting} | converted ${count('converted')} | published ${count('published')} | rejected ${count('rejected')} | skipped ${count('skipped')}`);
  log(`main files ${(bytes / 1e6).toFixed(1)} MB, ${avg.toFixed(0)} s per asset (wall time per worker), run ${((Date.now() - started) / 60000).toFixed(0)} min`);
  for (const [k, n] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 12)) log(`  ${String(n).padStart(5)}  ${k}`);
}

/** Does a front fix newer than the one this model was built with apply to it? */
export function needsFrontFix(r: Pick<Rec, 'id' | 'type' | 'status' | 'front' | 'fixRev' | 'symmetric'>, seen: Record<string, import('./front-overrides').FrontOverride> = loadFrontOverrides()): boolean {
  if (r.status !== 'converted' && r.status !== 'published') return false;
  // The vision check decides: a model it covers is converted again only when its rotation or mounting differs from the build's.
  const v = seen[r.id];
  if (v) {
    const entryFile = join(OUT, r.id, 'entry.json');
    const placed = existsSync(entryFile) ? (JSON.parse(readFileSync(entryFile, 'utf8')) as { placement?: string }).placement : undefined;
    // A wall or ceiling model also needs its pivot at the mount point (the entry records `mountY`).
    const pivoted = (v.mounting !== 'wall' && v.mounting !== 'ceiling') || !existsSync(entryFile) || (JSON.parse(readFileSync(entryFile, 'utf8')) as { mountY?: number }).mountY !== undefined;
    return (v.rot % 360) !== ((r.front?.rot ?? 0) % 360) || (placed !== undefined && placed !== placeOf(v.mounting)) || !pivoted;
  }
  if ((r.fixRev ?? 0) >= FRONT_FIX_REV) return false;
  if (FRONT_OVERRIDES[r.id] !== undefined) return true;
  if (r.symmetric) return false;
  return BACKED_TYPES.has(r.type) || r.front?.sure === false;
}

/** Put the models a front fix affects back in the queue (their files stay until the new ones replace them); returns their ids. */
function markReprocess(state: State, which: string | undefined): Set<string> {
  const named = which && which !== 'front' ? new Set(which.split(',')) : null;
  const ids = new Set<string>();
  for (const r of Object.values(state.records)) {
    if (named ? !named.has(r.id) || (r.status !== 'converted' && r.status !== 'published') : !needsFrontFix(r)) continue;
    ids.add(r.id);
    r.attempts = 0;
    delete r.thumb;
    touch(r, 'discovered');
  }
  log(`reprocess: ${ids.size} models queued${ids.size ? ` (${[...ids].slice(0, 6).join(', ')}${ids.size > 6 ? ', ...' : ''})` : ''}`);
  return ids;
}

export async function bulk(): Promise<void> {
  const started = Date.now();
  const qf = JSON.parse(readFileSync(join(import.meta.dirname, 'simready-queries.json'), 'utf8')) as QueryFile;
  if (arg('deny')) qf.denylist.push(...(arg('deny') as string).split(','));
  if (!existsSync(PY)) throw new Error(`${PY} not found: run npm run assets:simready-setup`);
  if (arg('reprocess') !== undefined || flag('reprocess')) {
    // A reprocess rewrites out/ and the shared staging folder: wait for any other publisher (publish.lock) and hold the lock.
    const release = await acquireLock(BULK_DIR);
    process.on('exit', release);
  }
  mkdirSync(OUT, { recursive: true });
  mkdirSync(WORK, { recursive: true });
  const state = loadState();
  const retry = arg('retry');
  if (retry) for (const r of Object.values(state.records)) if (r.status === 'rejected' && (r.reason ?? '').includes(retry)) { touch(r, 'discovered'); r.attempts = 0; }
  // `--reprocess` converts again the already converted or published models that a front fix affects (backed pieces, pieces
  // whose front was unsure, the checked overrides) and only those: the run is then limited to them and publishes them over
  // the old files. `--reprocess=id1,id2` names models instead.
  const reprocess = arg('reprocess');
  const redo = reprocess !== undefined || flag('reprocess') ? markReprocess(state, reprocess) : null;
  state.runs.push({ start: new Date().toISOString(), converted: 0, rejected: 0 });
  const only = arg('queries')?.split(',') ?? null;
  await discover(state, qf, only);
  if (flag('discover-only')) {
    summary(state, started);
    return;
  }
  const max = Number(arg('max') ?? 600);
  const conc = Math.max(1, Number(arg('concurrency') ?? 2));
  const chunkSize = Math.max(conc, Number(arg('chunk') ?? 12));
  const publishEvery = Number(arg('publish-every') ?? 50);
  const deadline = arg('time-budget') ? started + Number(arg('time-budget')) * 3600_000 : Infinity;
  const queue = Object.values(state.records)
    .filter((r) => r.status === 'discovered' && r.licence && (!redo || redo.has(r.id)) && (!only || only.includes(r.query) || only.some((o) => r.query.includes(o))))
    .sort((a, b) => a.priority - b.priority);
  // A resumed run first finishes thumbnails that an interrupted run left open.
  await thumbs(state, Object.values(state.records).filter((r) => r.status === 'converted' && !r.thumb));
  let attempted = 0;
  log(`convert: ${queue.length} waiting, max ${max}, concurrency ${conc}, chunk ${chunkSize}, budget ${Number.isFinite(deadline) ? `${arg('time-budget')} h` : 'none'}`);
  let sincePublish = Object.values(state.records).filter((r) => r.status === 'converted' && r.thumb).length;
  while (queue.length > 0 && attempted < max && Date.now() < deadline) {
    const free = statfsSync(homedir());
    if ((Number(free.bavail) * Number(free.bsize)) / 1e9 < Number(arg('min-free-gb') ?? 6)) {
      log('stopping: free disk space under the limit');
      break;
    }
    const chunk = queue.splice(0, Math.min(chunkSize, max - attempted));
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < chunk.length && Date.now() < deadline) {
        const r = chunk[next++] as Rec;
        const n = ++attempted;
        await convertOne(state, r);
        saveState(state);
        log(`[${n}/${Math.min(max, n + queue.length + (chunk.length - next))}] ${r.id} ${r.status} ${r.tris ?? ''}${r.tris ? ' tris ' : ''}${r.bytes ? `${(r.bytes / 1024).toFixed(0)} KB ` : ''}${r.secs}s${r.reason ? ` (${r.reason.slice(0, 110)})` : ''}`);
      }
    };
    await Promise.all(Array.from({ length: conc }, worker));
    await thumbs(state, chunk);
    for (const r of chunk) if (r.status === 'rejected' && r.reason && /thumbnail/.test(r.reason)) log(`  ${r.id} rejected (${r.reason.slice(0, 110)})`);
    saveState(state);
    sincePublish = Object.values(state.records).filter((r) => r.status === 'converted' && r.thumb).length;
    if (!flag('no-publish') && sincePublish >= publishEvery) await publish(state);
  }
  if (!flag('no-publish') && sincePublish > 0) await publish(state);
  const run = state.runs[state.runs.length - 1]!;
  run.end = new Date().toISOString();
  saveState(state);
  summary(state, started);
}
