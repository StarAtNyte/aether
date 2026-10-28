/**
 * Client of the Aether asset hub (see `hub.ts`): loads the compact index lazily from the pinned dataset commit, searches it
 * in memory, and fetches single models with a hash check. Transport only: `fetch`, the cache and the clock are injected, so
 * it runs in the studio, in a worker and in tests. It never throws to callers: a hub that cannot be reached (offline,
 * private, blocked, a bad answer) is the state `unavailable` and every call says so in its result; the bundled library keeps
 * working without it.
 *
 * Reproducible: the dataset commit is pinned in `assets/hub.json`. A pinned commit is immutable, so cached answers are never
 * revalidated; an unpinned `main` is revalidated with its ETag.
 */
import {
  HUB_MAX_FETCH_BYTES, HubConfig, HubMinIndex, hubFileUrl, hubItems, hubModelPath, hubThumbPath, readHubEmbeddings, searchHubItems, similarHubIds, verifyHubBytes,
  type HubHit, type HubItem, type HubSearchOptions,
} from './hub';

/** The slice of the Cache API the client uses (tests pass a map-backed one). */
export interface HubCache {
  match(url: string): Promise<Response | undefined>;
  put(url: string, res: Response): Promise<void>;
}

export type HubStatus = 'idle' | 'loading' | 'ready' | 'unavailable';
export interface HubState {
  status: HubStatus;
  /** Why the hub is unavailable, in words for a tooltip (never a stack or a URL with secrets). */
  reason?: string;
  count?: number;
}

export interface HubClientOptions {
  config: HubConfig;
  fetch?: typeof fetch;
  /** Origin the dataset is read from. Default `https://huggingface.co`; the dev server's token proxy is `/__hub`. */
  base?: string;
  /**
   * A private dataset is only reachable through a base that adds the credential on the server side (the dev proxy).
   * Without one the client does not even try: it is simply unavailable.
   */
  privateOk?: boolean;
  cache?: HubCache | null;
  /** Abort a request after this many ms. */
  timeoutMs?: number;
}

export type HubSearchResult =
  | { ok: true; hits: Array<HubHit & { thumbUrl: string }>; total: number }
  | { ok: false; reason: string };

export type HubModelResult =
  | { ok: true; item: HubItem; bytes: Uint8Array; revision: string; fromCache: boolean }
  | { ok: false; reason: string };

const CACHE_NAME = 'aether-hub-v1';

/** The browser's Cache API as a {@link HubCache}, or null where there is none (private windows, tests). */
export async function browserHubCache(): Promise<HubCache | null> {
  try {
    if (typeof caches === 'undefined') return null;
    const c = await caches.open(CACHE_NAME);
    return { match: (u) => c.match(u), put: (u, r) => c.put(u, r) };
  } catch {
    return null;
  }
}

export class HubClient {
  private readonly cfg: HubConfig;
  private readonly f: typeof fetch;
  private readonly base: string;
  private readonly cache: HubCache | null;
  private readonly timeoutMs: number;
  private readonly privateOk: boolean;
  private state: HubState = { status: 'idle' };
  private loading: Promise<HubItem[] | null> | null = null;
  private items: HubItem[] | null = null;
  private embeddings: Promise<Awaited<ReturnType<typeof readHubEmbeddings>>> | null = null;
  private listeners = new Set<(s: HubState) => void>();

  constructor(o: HubClientOptions) {
    this.cfg = HubConfig.parse(o.config);
    this.f = o.fetch ?? ((...a) => globalThis.fetch(...a));
    this.base = (o.base ?? 'https://huggingface.co').replace(/\/+$/, '');
    this.cache = o.cache ?? null;
    this.timeoutMs = o.timeoutMs ?? 15_000;
    this.privateOk = o.privateOk ?? false;
    if (this.cfg.visibility === 'private' && !this.privateOk) this.state = { status: 'unavailable', reason: 'The asset hub is not public yet.' };
  }

  get config(): HubConfig {
    return this.cfg;
  }
  get revision(): string {
    return this.cfg.revision;
  }
  getState(): HubState {
    return this.state;
  }
  subscribe(fn: (s: HubState) => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  private set(s: HubState): void {
    this.state = s;
    for (const fn of this.listeners) fn(s);
  }

  url(path: string): string {
    return hubFileUrl(this.cfg, path, this.base);
  }
  /** Thumbnail URL of an asset (an `<img src>`; the page's content-security policy decides whether it loads). */
  thumbUrl(id: string): string {
    return this.url(hubThumbPath(id));
  }

  /** GET with a timeout, no credentials, no referrer. A pinned commit is cache-first; `main` revalidates with its ETag. */
  private async get(path: string): Promise<Response | null> {
    const url = this.url(path);
    const pinned = this.cfg.revision !== 'main';
    let cached: Response | undefined;
    try {
      cached = await this.cache?.match(url);
    } catch {
      cached = undefined;
    }
    if (cached && pinned) return cached;
    const headers: Record<string, string> = {};
    const etag = cached?.headers.get('x-hub-etag');
    if (etag) headers['If-None-Match'] = etag;
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), this.timeoutMs) : null;
    try {
      const res = await this.f(url, { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'follow', mode: 'cors', headers, ...(ctl ? { signal: ctl.signal } : {}) });
      if (res.status === 304 && cached) return cached;
      if (!res.ok) return cached ?? null;
      const tag = res.headers.get('etag');
      if (this.cache && res.headers.get('content-length') !== '0') {
        const copy = res.clone();
        const stored = new Response(await copy.arrayBuffer(), { status: 200, headers: { 'content-type': copy.headers.get('content-type') ?? 'application/octet-stream', ...(tag ? { 'x-hub-etag': tag } : {}) } });
        try {
          await this.cache.put(url, stored);
        } catch {
          /* quota or a private window: the answer is still good */
        }
      }
      return res;
    } catch {
      return cached ?? null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** The index, loaded once. Null when the hub is unavailable (state says why). */
  async load(): Promise<HubItem[] | null> {
    if (this.items) return this.items;
    if (this.state.status === 'unavailable' && this.cfg.visibility === 'private' && !this.privateOk) return null;
    this.loading ??= this.loadIndex();
    return this.loading;
  }

  private async loadIndex(): Promise<HubItem[] | null> {
    this.set({ status: 'loading' });
    const fail = (reason: string): null => {
      this.loading = null;
      this.set({ status: 'unavailable', reason });
      return null;
    };
    const res = await this.get('index.min.json');
    if (!res) return fail(this.cfg.visibility === 'private' ? 'The asset hub is not public yet.' : 'The asset hub cannot be reached (offline or blocked). The bundled library still works.');
    try {
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > 2_000_000) return fail('The asset hub index is larger than expected.');
      if (this.cfg.indexSha256 && !(await verifyHubBytes(buf, this.cfg.indexSha256))) return fail('The asset hub index does not match the pinned revision.');
      const min = HubMinIndex.safeParse(JSON.parse(new TextDecoder().decode(buf)));
      if (!min.success || min.data.dataset !== this.cfg.dataset) return fail('The asset hub index could not be read.');
      this.items = hubItems(min.data);
      this.set({ status: 'ready', count: this.items.length });
      return this.items;
    } catch {
      return fail('The asset hub index could not be read.');
    }
  }

  /** Ranked matches with thumbnail URLs. Never throws. */
  async search(query: string, o: HubSearchOptions = {}): Promise<HubSearchResult> {
    const items = await this.load();
    if (!items) return { ok: false, reason: this.state.reason ?? 'The asset hub is unavailable.' };
    const hits = searchHubItems(items, query, o).map((h) => ({ ...h, thumbUrl: this.thumbUrl(h.item.id) }));
    return { ok: true, hits, total: items.length };
  }

  /** One item of the index by id. */
  async item(id: string): Promise<HubItem | null> {
    return (await this.load())?.find((i) => i.id === id) ?? null;
  }

  /** Download one model and check it against the index's SHA-256. The bytes are still untrusted until the GLB validator has seen them. */
  async fetchModel(id: string): Promise<HubModelResult> {
    const item = await this.item(id);
    if (!item) return { ok: false, reason: this.state.status === 'unavailable' ? (this.state.reason ?? 'The asset hub is unavailable.') : `The hub has no model "${id.slice(0, 40)}".` };
    const path = hubModelPath(id);
    const cachedBefore = await this.cache?.match(this.url(path)).catch(() => undefined);
    const res = await this.get(path);
    if (!res) return { ok: false, reason: 'The model could not be downloaded (offline or blocked).' };
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > HUB_MAX_FETCH_BYTES) return { ok: false, reason: 'The model is larger than the hub allows.' };
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > HUB_MAX_FETCH_BYTES || bytes.byteLength !== item.bytes) return { ok: false, reason: 'The downloaded model does not match the hub index (size).' };
    if (!(await verifyHubBytes(bytes, item.sha256))) {
      return { ok: false, reason: 'The downloaded model failed its hash check and was discarded.' };
    }
    return { ok: true, item, bytes, revision: this.cfg.revision, fromCache: cachedBefore !== undefined };
  }

  /** Assets that look like `id` (image embeddings of the thumbnails; fetched on first use, checked against their header's hash). */
  async similar(id: string, limit = 8): Promise<Array<{ id: string; score: number }>> {
    if (!(await this.load())) return [];
    this.embeddings ??= (async () => {
      const [h, b] = await Promise.all([this.get('embeddings.json'), this.get('embeddings.bin')]);
      if (!h || !b) return null;
      try {
        return await readHubEmbeddings(await h.json(), new Uint8Array(await b.arrayBuffer()));
      } catch {
        return null;
      }
    })();
    const emb = await this.embeddings;
    return emb ? similarHubIds(emb, id, limit) : [];
  }
}
