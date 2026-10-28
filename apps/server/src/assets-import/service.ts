/**
 * On-demand import of SimReady Central models, run by the local Aether server.
 *
 * A job goes: search (or a pinned ref) -> licence check -> download with hash checks -> USD to glTF conversion ->
 * decimation / texture reduction / compression -> a record under `<imported dir>/<id>/`. The network and the converter are
 * injected, so the state machine, the caps and the refusals are tested without either.
 *
 * Safety (docs/SECURITY.md, "Asset import"):
 * - the only network targets are the SimReady search service and huggingface.co dataset URLs built from a parsed result or
 *   a pinned `<owner>/<dataset>@<40-hex>/<package>` ref (no URL is ever taken from a request);
 * - only licences on the allow-list are imported, and the check runs again inside the fetch;
 * - one job at a time, a short queue, a per-window start limit, a download cap (150 MB), a time budget per job;
 * - downloaded files are data: the converter reads them with `python -I`, nothing in them is run.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  CatalogEntry,
  IMPORT_ID_RE,
  IMPORT_JOB_RE,
  ImportedAsset,
  STAGE_PROGRESS,
  simreadyFetchCommand,
  importCredit,
  importIdFor,
  searchSimready,
  slugOf,
  type CatalogEntryInput,
  type ImportJobView,
  type ImportRequest,
  type ImportStage,
  type SimreadyHit,
  type SimreadyRef,
  type SimreadyResult,
} from '@aether/assets';
import { IMPORT_LIMITS, fetchPackage, parseTarget, type FetchedPackage, type FetchOptions } from '@aether/assets/simready-fetch';
import type { Logger } from '../logger';

/** Largest triangle count an imported model may have after the pipeline (budget 20,000). */
export const MAX_IMPORT_TRIS = 22_000;
/** Largest main file the pipeline may produce. */
export const MAX_IMPORT_BYTES = 6 * 1024 * 1024;

/** The message shown when the converter's Python environment is missing. */
export const TOOLS_MISSING = 'conversion tools not installed: run npm run assets:simready-setup';

/** A row of the interior pipeline: `[package, id, type, category, styles, name, options]`. */
export type ConvertRow = readonly [string, string, string, string, string, string, { tex: number; tris: number; tags: string }];

export interface ConvertInput {
  /** Absolute path of the fetched USD (untrusted data). */
  usd: string;
  usdSha256: string;
  row: ConvertRow;
  author: string;
  licence: string;
  archive: string;
  pack: string;
  /** Empty temp folder the converter may use. */
  work: string;
  signal: AbortSignal;
  onStage: (stage: 'converting' | 'optimising') => void;
}

export interface ConvertOutput {
  /** Library-shaped entry with `s/<id>.<hash>.glb` style paths. */
  entry: CatalogEntryInput;
  /** Folder holding `s/...` (the files the entry names). */
  libDir: string;
  files: Array<{ path: string; sha256: string; bytes: number }>;
}

export interface ImportServiceDeps {
  /** Where finished imports live (`~/.local/share/aether/imported`). */
  dir: string;
  /** Download cache for the SimReady packages. */
  srcDir: string;
  logger: Logger;
  /** Null when the converter is ready, else why not. */
  toolsMissing: () => string | null;
  search?: (opts: Parameters<typeof searchSimready>[0]) => Promise<SimreadyResult>;
  fetchPackage?: (ref: SimreadyRef, opts: FetchOptions) => Promise<FetchedPackage>;
  convert: (input: ConvertInput) => Promise<ConvertOutput>;
  now?: () => number;
  newId?: () => string;
  /** Aborted when the server stops. */
  shutdownSignal?: AbortSignal;
  limits?: Partial<ServiceLimits>;
}

export interface ServiceLimits {
  /** Whole-job time budget. */
  jobMs: number;
  /** Jobs waiting behind the running one. */
  maxQueued: number;
  /** Job starts allowed per window. */
  startsPerWindow: number;
  windowMs: number;
  /** Finished jobs kept in memory for polling. */
  keepJobs: number;
}

export const DEFAULT_LIMITS: ServiceLimits = { jobMs: 12 * 60_000, maxQueued: 3, startsPerWindow: 10, windowMs: 10 * 60_000, keepJobs: 40 };

/** Thrown by {@link ImportService.start} for refusals the route maps to a status. */
export class ImportRefused extends Error {
  constructor(
    readonly code: 'busy' | 'rate-limited' | 'invalid',
    message: string,
  ) {
    super(message);
  }
}

interface Job {
  id: string;
  query: string;
  req: ImportRequest;
  stage: ImportStage;
  message: string;
  progress: number;
  error?: string;
  assetId?: string;
  createdAt: number;
}

const INDEX = 'index.json';
const CATEGORY_WORDS: ReadonlyArray<[RegExp, string]> = [
  [/lamp|light|lantern|sconce/, 'lighting'],
  [/plant|flower|pot\b|vase|cactus/, 'plants'],
  [/kettle|pan\b|pot\b|mug|cup|plate|bowl|toaster|microwave|fridge|refrigerator|oven|cooker|sink|kitchen|cutlery|knife|fork|spoon/, 'kitchen'],
  [/hammer|wrench|screwdriver|drill|saw|pliers|tool|ladder|toolbox/, 'tools'],
  [/bottle|can\b|food|fruit|apple|bread|cereal|snack/, 'food'],
  [/chair|table|desk|sofa|couch|shelf|bookcase|cabinet|stool|bench|bed|dresser|armchair|ottoman|drawer|wardrobe/, 'furniture'],
];

const categoryOf = (text: string): string => CATEGORY_WORDS.find(([re]) => re.test(text))?.[1] ?? 'props';

/** `chair_office_fabric_manager_a01` -> `Chair office fabric manager`. */
export function nameOf(pkg: string): string {
  const words = pkg.toLowerCase().split(/[_\s.-]+/).filter((w) => w !== '' && !/^[a-z]?\d{1,3}$/.test(w) && !/^[a-z]\d{2}$/.test(w));
  const s = (words.length > 0 ? words : [pkg]).join(' ').slice(0, 48);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Keep paths and noise out of what a client sees. */
export function cleanMessage(text: string, home = homedir()): string {
  return text.split(home).join('~').replace(/\s+/g, ' ').trim().slice(0, 300);
}

export class ImportService {
  private readonly jobs = new Map<string, Job>();
  private readonly starts: number[] = [];
  private tail: Promise<void> = Promise.resolve();
  private queued = 0;
  private readonly limits: ServiceLimits;
  private readonly now: () => number;

  constructor(private readonly deps: ImportServiceDeps) {
    this.limits = { ...DEFAULT_LIMITS, ...deps.limits };
    this.now = deps.now ?? Date.now;
    mkdirSync(deps.dir, { recursive: true });
  }

  /** Queue a job. Throws {@link ImportRefused} for a full queue, the rate limit or an invalid request. */
  start(req: ImportRequest): ImportJobView {
    const t = this.now();
    while (this.starts.length > 0 && t - this.starts[0]! > this.limits.windowMs) this.starts.shift();
    if (this.starts.length >= this.limits.startsPerWindow) throw new ImportRefused('rate-limited', 'Too many imports in a short time. Try again in a few minutes.');
    if (this.queued >= this.limits.maxQueued) throw new ImportRefused('busy', 'Other imports are waiting. Try again shortly.');
    if (req.ref !== undefined) {
      try {
        parseTarget(req.ref);
      } catch (e) {
        throw new ImportRefused('invalid', e instanceof Error ? e.message : 'invalid ref');
      }
    }
    this.starts.push(t);
    const id = (this.deps.newId ?? ((): string => randomBytes(8).toString('hex')))();
    const job: Job = { id, query: (req.query ?? req.ref ?? '').slice(0, 120), req, stage: 'queued', message: this.queued > 0 ? 'Waiting for the import before it' : 'Queued', progress: 0, createdAt: t };
    this.jobs.set(id, job);
    for (const old of [...this.jobs.keys()].slice(0, Math.max(0, this.jobs.size - this.limits.keepJobs))) {
      const j = this.jobs.get(old);
      if (j && (j.stage === 'ready' || j.stage === 'failed')) this.jobs.delete(old);
    }
    this.queued++;
    this.tail = this.tail.then(() => this.run(job)).catch(() => undefined);
    return this.view(job);
  }

  /** The state of a job, or null for an unknown id. */
  status(id: string): ImportJobView | null {
    if (!IMPORT_JOB_RE.test(id)) return null;
    const j = this.jobs.get(id);
    return j ? this.view(j) : null;
  }

  /** Every finished import on disk, newest first. */
  list(): ImportedAsset[] {
    const out: ImportedAsset[] = [];
    if (!existsSync(this.deps.dir)) return out;
    for (const name of readdirSync(this.deps.dir)) {
      if (!IMPORT_ID_RE.test(name)) continue;
      const a = this.read(name);
      if (a) out.push(a);
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  /** One finished import (validated again from disk), or null. */
  read(id: string): ImportedAsset | null {
    if (!IMPORT_ID_RE.test(id)) return null;
    try {
      const parsed = ImportedAsset.safeParse(JSON.parse(readFileSync(join(this.deps.dir, id, 'imported.json'), 'utf8')));
      return parsed.success && parsed.data.id === id ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /** Absolute path of a file of an import when it is one the record lists, else null. */
  filePath(id: string, rel: string): string | null {
    const a = this.read(id);
    if (!a || !Object.hasOwn(a.provenance.files, rel)) return null;
    const p = resolve(this.deps.dir, id, rel);
    return p.startsWith(resolve(this.deps.dir, id) + '/') && existsSync(p) ? p : null;
  }

  private view(j: Job): ImportJobView {
    const asset = j.stage === 'ready' && j.assetId ? this.read(j.assetId) : null;
    return { id: j.id, stage: j.stage, message: j.message, progress: j.progress, query: j.query, ...(j.error ? { error: j.error } : {}), ...(asset ? { asset } : {}) };
  }

  private set(j: Job, stage: ImportStage, message: string, progress?: number): void {
    j.stage = stage;
    j.message = cleanMessage(message);
    j.progress = progress ?? STAGE_PROGRESS[stage];
  }

  private async run(j: Job): Promise<void> {
    this.queued--;
    const work = join(this.deps.srcDir, '_work', j.id);
    const budget = AbortSignal.timeout(this.limits.jobMs);
    const signal = this.deps.shutdownSignal ? AbortSignal.any([budget, this.deps.shutdownSignal]) : budget;
    try {
      const missing = this.deps.toolsMissing();
      if (missing) throw new Error(missing);
      const ref = await this.resolve(j);
      signal.throwIfAborted();
      const key = `${ref.repo}@${ref.rev}/${ref.pkg}`;
      const have = this.indexed(key);
      if (have) {
        j.assetId = have;
        this.set(j, 'ready', 'Already imported');
        return;
      }
      this.set(j, 'licence', `Checking the licence of ${ref.pkg}`);
      const net = this.deps.fetchPackage ?? fetchPackage;
      const pkg = await net(ref, {
        dir: join(this.deps.srcDir, 'simready'),
        limits: IMPORT_LIMITS,
        signal,
        onProgress: (m, done, total) => this.set(j, 'downloading', m.startsWith('[') ? `Downloading ${ref.pkg}: ${m}` : m, STAGE_PROGRESS.downloading + (0.4 * done) / Math.max(1, total)),
      });
      signal.throwIfAborted();
      const licence = pkg.licence;
      if (licence !== 'CC0-1.0' && licence !== 'CC-BY-4.0' && licence !== 'MIT') throw new Error(`licence ${licence.slice(0, 40)} cannot be imported`);
      const id = importIdFor(ref.pkg, pkg.usd.sha256);
      const name = nameOf(ref.pkg);
      const words = `${ref.pkg.replace(/[_-]+/g, ' ')} ${j.query}`.toLowerCase();
      const tags = [...new Set(words.split(/[^a-z]+/).filter((w) => w.length > 2))].slice(0, 12).join(' ');
      const type = slugOf(/^[a-z]{2,20}/.exec(ref.pkg.toLowerCase())?.[0] ?? 'prop', 23);
      const row: ConvertRow = [ref.pkg, id, type.length >= 2 ? type : 'prop', categoryOf(words), 'modern contemporary', name, { tex: 512, tris: 20000, tags }];
      rmSync(work, { recursive: true, force: true });
      mkdirSync(work, { recursive: true });
      this.set(j, 'converting', `Converting ${name} from USD to glTF`);
      const out = await this.deps.convert({
        usd: join(pkg.dir, pkg.usd.path),
        usdSha256: pkg.usd.sha256,
        row,
        author: pkg.author,
        licence,
        archive: `https://huggingface.co/datasets/${ref.repo}/tree/${ref.rev}/${ref.pkg}`,
        pack: `simready-${ref.owner.toLowerCase()}`.slice(0, 64),
        work,
        signal,
        onStage: (s) => this.set(j, s, s === 'converting' ? `Converting ${name} from USD to glTF` : `Reducing and compressing ${name}`),
      });
      signal.throwIfAborted();
      const asset = this.store(id, name, j.query, ref, pkg, licence, out);
      this.index(key, asset.id);
      j.assetId = asset.id;
      this.set(j, 'ready', `${name} is ready (${asset.entry.tris} triangles, ${(asset.entry.bytes / 1024) | 0} KB)`);
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'failed';
      const msg = signal.aborted ? (budget.aborted ? 'The import took too long and was stopped.' : 'The server is stopping.') : raw;
      j.error = cleanMessage(msg).slice(0, 400);
      this.set(j, 'failed', j.error);
      this.deps.logger.warn('asset import failed', { job: j.id, error: j.error });
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  /** Pick the package: the pinned ref, or the best allowed hit of the search. */
  private async resolve(j: Job): Promise<SimreadyRef> {
    if (j.req.ref !== undefined) return parseTarget(j.req.ref);
    this.set(j, 'searching', `Searching SimReady Central for "${j.query}"`);
    const search = this.deps.search ?? searchSimready;
    const r = await search({ query: j.query, limit: 8, maxSize: j.req.maxSize ?? 3, timeoutMs: 25_000 });
    if (!r.ok) throw new Error(r.error);
    const best: SimreadyHit | undefined = r.accepted.filter((h) => h.importable).sort((a, b) => b.score - a.score)[0];
    if (!best) {
      throw new Error(r.rejected.length > 0 ? `Nothing for "${j.query}" has a licence Aether imports (${r.rejected.length} found with other licences, none imported).` : `SimReady Central has nothing for "${j.query}".`);
    }
    this.deps.logger.info('asset import picked', { job: j.id, pkg: best.ref.pkg, fetch: simreadyFetchCommand(best.ref) });
    return best.ref;
  }

  private indexed(key: string): string | null {
    try {
      const idx = JSON.parse(readFileSync(join(this.deps.dir, INDEX), 'utf8')) as Record<string, string>;
      const id = idx[key];
      return typeof id === 'string' && this.read(id) ? id : null;
    } catch {
      return null;
    }
  }

  private index(key: string, id: string): void {
    let idx: Record<string, string> = {};
    try {
      idx = JSON.parse(readFileSync(join(this.deps.dir, INDEX), 'utf8')) as Record<string, string>;
    } catch {
      /* first import */
    }
    idx[key] = id;
    const tmp = join(this.deps.dir, `${INDEX}.tmp`);
    writeFileSync(tmp, JSON.stringify(idx));
    renameSync(tmp, join(this.deps.dir, INDEX));
  }

  /** Check the converter's output against the caps, move its files into place and write the record. */
  private store(id: string, name: string, query: string, ref: SimreadyRef, pkg: FetchedPackage, licence: 'CC0-1.0' | 'CC-BY-4.0' | 'MIT', out: ConvertOutput): ImportedAsset {
    const entry = CatalogEntry.parse(out.entry);
    if (entry.tris > MAX_IMPORT_TRIS) throw new Error(`the model still has ${entry.tris} triangles after reduction (limit ${MAX_IMPORT_TRIS})`);
    const main = out.files.find((f) => f.path === entry.file);
    if (!main || main.bytes > MAX_IMPORT_BYTES) throw new Error('the converted model is missing or too large');
    const dest = join(this.deps.dir, id);
    const staging = `${dest}.new`;
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(join(staging, 's'), { recursive: true });
    const hashes: Record<string, string> = {};
    for (const f of out.files) {
      if (!/^s\/[a-z0-9_-]{1,64}(\.lod[12]|\.lite)?\.[0-9a-f]{8}\.glb$/.test(f.path)) throw new Error('the converter produced an unexpected file name');
      const from = resolve(out.libDir, f.path);
      if (!from.startsWith(resolve(out.libDir) + '/') || !statSync(from).isFile()) throw new Error('the converter produced an unexpected file');
      copyFileSync(from, join(staging, f.path));
      hashes[f.path] = f.sha256;
    }
    const credit = importCredit({ name, author: pkg.author, licence, repo: ref.repo });
    const asset: ImportedAsset = ImportedAsset.parse({
      id,
      entry: { ...entry, id, name: name.slice(0, 60) },
      base: `/api/assets/imported/files/${id}/`,
      credit,
      provenance: { repo: ref.repo, revision: ref.rev, package: ref.pkg, usdSha256: pkg.usd.sha256, packageHash: pkg.packageHash, files: hashes },
      query: query.slice(0, 120),
      createdAt: this.now(),
    });
    writeFileSync(join(staging, 'imported.json'), `${JSON.stringify(asset)}\n`);
    rmSync(dest, { recursive: true, force: true });
    renameSync(staging, dest);
    return asset;
  }
}

/** Default import folder: `$AETHER_IMPORT_DIR` or `~/.local/share/aether/imported`. */
export const defaultImportDir = (env: Readonly<Record<string, string | undefined>> = process.env): string => resolve(env['AETHER_IMPORT_DIR'] ?? join(env['HOME'] ?? homedir(), '.local', 'share', 'aether', 'imported'));
