/**
 * NVIDIA SimReady Central as a searchable, licence-filtered asset SOURCE (not part of the shipped library).
 *
 * The public search service (`POST <api>/search`, a semantic index of about 3,600 USD packages on Hugging Face)
 * returns candidate files; this module enriches each hit with the licence of its package and keeps only the hits whose
 * licence we accept. It only finds candidates: nothing here downloads a model. Importing one is a dev step
 * (`npm run assets:simready -- fetch <repo>@<rev>/<package>`, then the converter and `build.ts --simready`).
 *
 * Pure and portable: `fetch` is injected, every failure becomes a result (`ok: false`) and the studio never needs the
 * service at run time.
 */

/** Public search API of the SimReady Central Space. */
export const SIMREADY_API = 'https://nvidia-simready-central.hf.space';

/** Licences a candidate may carry (canonical SPDX-style ids). Everything else is rejected with a reason. */
export const SIMREADY_ALLOWED = ['CC0-1.0', 'CC-BY-4.0', 'MIT', 'Apache-2.0', 'BSD-3-Clause', 'BSD-2-Clause'] as const;
/** Allowed licences the catalog schema accepts today (`AssetLicence`); the others can be found but not yet imported. */
export const SIMREADY_IMPORTABLE: ReadonlySet<string> = new Set(['CC0-1.0', 'CC-BY-4.0', 'MIT']);

const CANON: Readonly<Record<string, string>> = {
  'cc0-1.0': 'CC0-1.0',
  cc0: 'CC0-1.0',
  'cc-0': 'CC0-1.0',
  'cc-by-4.0': 'CC-BY-4.0',
  'cc-by-4': 'CC-BY-4.0',
  mit: 'MIT',
  'apache-2.0': 'Apache-2.0',
  'apache-2': 'Apache-2.0',
  'bsd-3-clause': 'BSD-3-Clause',
  'bsd-2-clause': 'BSD-2-Clause',
};

/** The verdict on one licence string. */
export interface LicenceVerdict {
  /** Canonical id when the whole expression is on the allow-list, else null. */
  licence: string | null;
  allowed: boolean;
  /** Why it is not allowed (empty when allowed). */
  reason: string;
}

/** Judge one licence expression ("CC-BY 4.0", "cc-by-4.0", "A AND B"). Every term of an AND must be allowed. */
export function judgeLicence(raw: string | null | undefined): LicenceVerdict {
  const text = (raw ?? '').trim();
  if (text === '' || /^(none|null|unknown|n\/a|unlicensed|other)$/i.test(text)) return { licence: null, allowed: false, reason: 'no licence stated' };
  const terms = text.split(/\s+AND\s+/i);
  const out: string[] = [];
  for (const term of terms) {
    const key = term.trim().toLowerCase().replace(/[\s_]+/g, '-');
    const canon = CANON[key];
    if (canon) {
      out.push(canon);
      continue;
    }
    const parts = key.split('-');
    if (key.startsWith('licenseref')) return { licence: null, allowed: false, reason: `custom licence (${term.trim()})` };
    if (parts.includes('nc')) return { licence: null, allowed: false, reason: `non-commercial (${term.trim()})` };
    if (parts.includes('nd')) return { licence: null, allowed: false, reason: `no-derivatives (${term.trim()})` };
    if (parts.includes('sa') || /gpl/.test(key)) return { licence: null, allowed: false, reason: `share-alike / copyleft (${term.trim()})` };
    return { licence: null, allowed: false, reason: `licence not on the allow-list (${term.trim()})` };
  }
  return { licence: [...new Set(out)].join(' AND '), allowed: true, reason: '' };
}

/** A parsed SimReady Central result URL. */
export interface SimreadyRef {
  owner: string;
  dataset: string;
  /** `owner/dataset`. */
  repo: string;
  /** Commit SHA the service indexed (never a branch). */
  rev: string;
  /** Package folder at the dataset root (kept unchanged on disk). */
  pkg: string;
  /** Path of the USD inside the package. */
  file: string;
}

const SEG = '[A-Za-z0-9][A-Za-z0-9._-]{0,127}';
const URL_RE = new RegExp(`^https://huggingface\\.co/datasets/(${SEG})/(${SEG})/(?:blob|resolve)/([0-9a-f]{40})/(${SEG})/((?:${SEG}/)*${SEG}\\.usd[acz]?)$`);

/** Parse `https://huggingface.co/datasets/<owner>/<name>/blob/<sha>/<package>/<path>.usd`; null for anything else. */
export function parseSimreadyUrl(url: string): SimreadyRef | null {
  const m = URL_RE.exec(url);
  if (!m) return null;
  const [, owner, dataset, rev, pkg, file] = m as unknown as [string, string, string, string, string, string];
  if (file.split('/').includes('..')) return null;
  return { owner, dataset, repo: `${owner}/${dataset}`, rev, pkg, file };
}

/** The shell command that imports one package (printed by the search, run by a person). */
export const fetchCommand = (r: Pick<SimreadyRef, 'repo' | 'rev' | 'pkg'>): string => `npm run assets:simready -- fetch ${r.repo}@${r.rev}/${r.pkg}`;

/** One enriched search hit. */
export interface SimreadyHit {
  ref: SimreadyRef;
  url: string;
  score: number;
  /** Size of the root USD file in bytes (from the search service). */
  usdBytes: number | null;
  author: string | null;
  /** The licence strings found, verbatim. */
  licenceRaw: { packaging: string | null; card: string | null };
  /** Canonical licence when allowed. */
  licence: string | null;
  allowed: boolean;
  /** The catalog schema can take this licence now. */
  importable: boolean;
  /** Why a hit was rejected, or a note on an accepted one. */
  reason: string;
  /** The packaging.json `package_hash` (sha256), when published. */
  packageHash: string | null;
  fetch: string;
}

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface SimreadySearchOptions {
  query: string;
  /** Accepted hits wanted (default 8, at most 30). */
  limit?: number;
  /** Largest side in metres the asset may have (Z up: bounds X, Y and Z). */
  maxSize?: number;
  /** Smallest side in metres. */
  minSize?: number;
  fetch?: FetchLike;
  api?: string;
  timeoutMs?: number;
}

/** What a search returns: accepted hits, the rejected ones with reasons, or the failure. */
export type SimreadyResult =
  | { ok: true; query: string; accepted: SimreadyHit[]; rejected: SimreadyHit[]; considered: number }
  | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

async function getJson(f: FetchLike, url: string, timeoutMs: number, init?: Parameters<FetchLike>[1]): Promise<unknown> {
  const res = await f(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const text = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null);

/** Licence + author of one package and its dataset: the package file governs, the dataset card must not contradict it. */
export async function enrichRef(ref: SimreadyRef, f: FetchLike, cards: Map<string, Promise<{ license: string | null; author: string | null }>>, timeoutMs = 20_000): Promise<Pick<SimreadyHit, 'author' | 'licenceRaw' | 'licence' | 'allowed' | 'importable' | 'reason' | 'packageHash'>> {
  let packaging: string | null = null;
  let packageHash: string | null = null;
  let packagingErr = '';
  try {
    const j = await getJson(f, `https://huggingface.co/datasets/${ref.repo}/resolve/${ref.rev}/${ref.pkg}/com.nvidia.simready.packaging.json`, timeoutMs);
    if (isRecord(j)) {
      packaging = text(j['license'], 120);
      const h = j['package_hash'];
      if (isRecord(h)) packageHash = typeof h['sha256'] === 'string' && /^[0-9a-f]{64}$/.test(h['sha256']) ? h['sha256'] : null;
    }
  } catch (e) {
    packagingErr = e instanceof Error ? e.message : 'failed';
  }
  let card = cards.get(ref.repo);
  if (!card) {
    card = getJson(f, `https://huggingface.co/api/datasets/${ref.repo}`, timeoutMs)
      .then((j) => {
        const data = isRecord(j) && isRecord(j['cardData']) ? j['cardData'] : {};
        const lic = data['license'];
        return { license: Array.isArray(lic) ? lic.filter((x): x is string => typeof x === 'string').join(' AND ') || null : text(lic, 120), author: isRecord(j) ? text(j['author'], 80) : null };
      })
      .catch(() => ({ license: null, author: null }));
    cards.set(ref.repo, card);
  }
  const c = await card;
  const author = c.author ?? ref.owner;
  const pv = packaging !== null ? judgeLicence(packaging) : null;
  const cv = c.license !== null ? judgeLicence(c.license) : null;
  const base = { author, licenceRaw: { packaging, card: c.license }, packageHash };
  if (!pv && !cv) return { ...base, licence: null, allowed: false, importable: false, reason: `no licence found${packagingErr ? ` (packaging.json: ${packagingErr})` : ''}` };
  const bad = [pv && !pv.allowed ? `package: ${pv.reason}` : '', cv && !cv.allowed ? `dataset card: ${cv.reason}` : ''].filter(Boolean);
  if (bad.length > 0) return { ...base, licence: null, allowed: false, importable: false, reason: bad.join('; ') };
  const lic = (pv ?? cv)!.licence!;
  const notes: string[] = [];
  if (pv && cv && pv.licence !== cv.licence) notes.push(`package says ${pv.licence}, dataset card ${cv.licence}`);
  if (!pv) notes.push('licence from the dataset card only (no package file)');
  const importable = lic.split(' AND ').every((l) => SIMREADY_IMPORTABLE.has(l));
  if (!importable) notes.push('allowed to find, but the catalog schema does not take this licence yet');
  return { ...base, licence: lic, allowed: true, importable, reason: notes.join('; ') };
}

/** Search the service, enrich every hit with its licence and split accepted from rejected. Never throws. */
export async function searchSimready(opts: SimreadySearchOptions): Promise<SimreadyResult> {
  const f: FetchLike = opts.fetch ?? (globalThis.fetch as unknown as FetchLike | undefined) ?? (async () => { throw new Error('no fetch available'); });
  const api = opts.api ?? SIMREADY_API;
  const timeout = opts.timeoutMs ?? 30_000;
  const want = Math.min(30, Math.max(1, opts.limit ?? 8));
  const query = opts.query.trim().slice(0, 200);
  if (query === '') return { ok: false, error: 'empty query' };
  // The service is semantic and returns every licence: ask for more than wanted, then filter.
  const body: Record<string, unknown> = { description: query, limit: Math.min(60, want * 3), return_metadata: true };
  if (opts.maxSize !== undefined) for (const a of ['x', 'y', 'z']) body[`max_bbox_${a}`] = opts.maxSize;
  if (opts.minSize !== undefined) for (const a of ['x', 'y', 'z']) body[`min_bbox_${a}`] = opts.minSize;
  let raw: unknown;
  try {
    raw = await getJson(f, `${api}/search`, timeout, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch (e) {
    return { ok: false, error: `SimReady Central search is not reachable (${e instanceof Error ? e.message : 'failed'}). It is optional: the library works without it.` };
  }
  if (!Array.isArray(raw)) return { ok: false, error: 'SimReady Central answered in an unexpected shape' };
  const cards = new Map<string, Promise<{ license: string | null; author: string | null }>>();
  const hits: Array<{ ref: SimreadyRef; url: string; score: number; usdBytes: number | null }> = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!isRecord(r) || typeof r['url'] !== 'string') continue;
    const ref = parseSimreadyUrl(r['url']);
    if (!ref) continue;
    const key = `${ref.repo}@${ref.rev}/${ref.pkg}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const meta = isRecord(r['metadata']) ? r['metadata'] : {};
    hits.push({ ref, url: r['url'], score: typeof r['score'] === 'number' ? r['score'] : 0, usdBytes: typeof meta['size'] === 'number' ? Math.round(meta['size']) : null });
  }
  // Licence lookups, a few at a time.
  const enriched: SimreadyHit[] = [];
  for (let i = 0; i < hits.length; i += 6) {
    const batch = hits.slice(i, i + 6);
    const done = await Promise.all(batch.map((h) => enrichRef(h.ref, f, cards)));
    batch.forEach((h, k) => enriched.push({ ...h, ...done[k]!, fetch: fetchCommand(h.ref) }));
  }
  const accepted = enriched.filter((h) => h.allowed).slice(0, want);
  const rejected = enriched.filter((h) => !h.allowed);
  return { ok: true, query, accepted, rejected, considered: enriched.length };
}

/** One printable line per hit. */
export function describeSimreadyHit(h: SimreadyHit): string {
  const size = h.usdBytes === null ? '' : `, usd ${h.usdBytes >= 1e6 ? `${(h.usdBytes / 1e6).toFixed(1)} MB` : `${Math.round(h.usdBytes / 1024)} KB`}`;
  return `${h.ref.pkg} — ${h.licence ?? 'no licence'} by ${h.author ?? h.ref.owner} (${h.ref.repo}, score ${h.score.toFixed(2)}${size})${h.importable ? '' : ' [not importable yet]'}`;
}
