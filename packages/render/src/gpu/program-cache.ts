/**
 * The program set of each quality tier, linked ahead of need (WebGL2): the equivalent of a pipeline-state cache.
 *
 * Programs are most of a load (docs/ARCHITECTURE-STREAMING.md §1.2): a hundred of them per world, the large lit ones
 * 75-100 KB of GLSL each, single links of 1.3-1.9 s on the GPU process. This cache records which programs (the exact
 * vertex and fragment sources three generated) were used on each tier, keeps that set in IndexedDB across visits, and
 * links it again when the renderer starts, while the world is still being generated (the GPU process idles then).
 *
 * - **Boot pre-warm** ({@link ProgramCache.prewarm}): the tier's set, most used first, is compiled and linked with
 *   `KHR_parallel_shader_compile`, a few at a time, without waiting on any of them. A linked program goes into a pool.
 * - **Adoption** ({@link ProgramCache.take}): when three creates a pipeline whose two sources are pooled (or still linking
 *   in the pool), the pooled program is handed over instead of a new link. Its stages are then never compiled by three
 *   ({@link ProgramCache.covers}: their shader objects are made lazily, only for a pipeline that does link).
 * - **No duplicate links**: a set entry three asks for before the pre-warm reached it is dropped from the pre-warm.
 *   The boot pre-warm stops submitting when the world's own compile begins ({@link ProgramCache.worldCompiling}): what is
 *   left would only queue in front of what the world needs.
 * - **Idle priming** ({@link ProgramCache.prime}): after the first picture, the rest of the tier's set (the browser's own
 *   entries, then a cooked world's later pairs) is linked one at a time into the pool while the view is at rest, and kept
 *   there until a mesh that comes into view takes it; then, while the view is at rest, the neighbouring tiers' sets are
 *   linked one at a time and deleted at once. That fills the browser's program cache (memory and disk), so a later tier
 *   change or a returning visit links from it.
 * - Pooled programs of the boot pre-warm no pipeline took are deleted {@link POOL_TRIM_MS} after the first picture (a
 *   program costs memory in the GPU process, megabytes on Mesa); those linked after it for the tier in effect stay until
 *   taken or the tier changes.
 *
 * - **A cooked world's boot set** ({@link ProgramStore.boot}): the programs its load is known to use on the tier (recorded by
 *   the cook, cook/format.ts) are linked first and keep being submitted after the world's compile begins: the compile then
 *   takes them from the pool instead of linking one after another. The rest of the cooked set (the cook's orbit and play,
 *   {@link ProgramStore.later}) links only at rest after the first picture, and other tiers' cooked sets not at all: a
 *   load links before its first picture only what it is known to draw. A tier change before the first picture (a heavy
 *   world settles lower) re-targets the pre-warm at the new tier.
 *
 * The sources are the keys: a build that changes a shader simply misses, and its entries age out of the set (least
 * recently used first, at most {@link SET_CAP} per tier). Opt out with `globalThis.__AETHER_PROGRAM_CACHE = false`.
 */
import type { RenderTier } from './finishing';

/** Most programs kept in the set of one tier. */
export const SET_CAP: Readonly<Record<RenderTier, number>> = { low: 64, medium: 96, high: 128, ultra: 160 };
/** Links the boot pre-warm keeps in flight: enough to keep the driver's threads busy, few enough not to queue far ahead. */
export const PREWARM_IN_FLIGHT = 6;
/** Links in flight for a cooked world's boot set (`__AETHER_EAGER_IN_FLIGHT` overrides; measured in docs/PERFORMANCE.md). */
function EAGER_IN_FLIGHT(): number {
  const n = (globalThis as { __AETHER_EAGER_IN_FLIGHT?: number }).__AETHER_EAGER_IN_FLIGHT;
  return typeof n === 'number' && n >= 1 && n <= 32 ? Math.round(n) : PREWARM_IN_FLIGHT;
}
/** Pooled programs nobody took are deleted this long after the first picture (ms). */
export const POOL_TRIM_MS = 20_000;
/** A set entry not used in this many sessions of its tier is dropped. */
const STALE_SESSIONS = 12;
const DB = 'aether-programs';
const SOURCES = 'sources';
const SETS = 'sets';

/** One program of a set: hashes of its two sources, sessions it was used in, and the last of them. */
export interface SetEntry {
  v: string;
  f: string;
  uses: number;
  last: number;
}
/** A tier's set as stored. */
export interface StoredSet {
  session: number;
  entries: SetEntry[];
}
/** Where sets and sources live (IndexedDB in a browser; a map in tests). */
export interface ProgramStore {
  getSet(tier: RenderTier): Promise<StoredSet | null>;
  putSet(tier: RenderTier, set: StoredSet): Promise<void>;
  getSources(hashes: readonly string[]): Promise<Map<string, string>>;
  putSources(sources: ReadonlyMap<string, string>): Promise<void>;
  /** Delete sources whose hash is not in `keep` (no set refers to them). */
  prune(keep: ReadonlySet<string>): Promise<void>;
  /**
   * Optional: the pairs (`<vertex hash>:<fragment hash>`, in link order) the world's load is known to use (a cooked world's),
   * linked first and not stopped by the world's own compile. Their sources come from {@link getSources}.
   */
  boot?(tier: RenderTier): Promise<ReadonlySet<string> | null>;
  /**
   * Optional: pairs the world may use later (a cooked world's orbit and play), linked only at rest after the first picture
   * ({@link ProgramCache.prime}).
   */
  later?(tier: RenderTier): Promise<ReadonlySet<string> | null>;
}

/** What the cache did (diagnostics, the probe and the perf job read it). */
export interface ProgramCacheStats {
  tier: RenderTier | null;
  /** Programs in the stored set of the boot tier, and of them the cooked boot set's (linked first, see {@link ProgramStore.boot}). */
  set: number;
  eager: number;
  /** Pre-warm links submitted, finished, failed. */
  submitted: number;
  linked: number;
  failed: number;
  /** Pipelines that took a pooled program (no link of their own). */
  adopted: number;
  /** Pipelines that linked a program of their own; and those of them after the first picture that the set did not hold. */
  linkedOwn: number;
  missedAfterFirstPicture: number;
  /** Pooled programs deleted unused. */
  trimmed: number;
  /** Programs linked and deleted at rest to fill the browser's program cache. */
  primed: number;
  /** Programs of the tier in effect linked into the pool after the first picture, for meshes that come into view later. */
  pooledLater: number;
  /** When the pre-warm started and when its last link finished (ms, page clock). */
  startedAt: number;
  doneAt: number;
  /** Tier changes and pre-warm starts, `<ms> <event>` (diagnostics). */
  log: string[];
}

/** 64-bit FNV-1a of a string (two 32-bit lanes) plus its length, as hex: the key of a source. */
export function sourceHash(s: string): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x01000197);
  }
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}${s.length.toString(16)}`;
}

/** Order a stored set for the pre-warm: used most recently first, then most often; at most `cap`. */
export function prewarmOrder(set: StoredSet, cap: number): SetEntry[] {
  return [...set.entries].sort((p, q) => q.last - p.last || q.uses - p.uses).slice(0, cap);
}

/**
 * Merge the pairs used in a session into a stored set: each counts one use and becomes the most recent; entries unused for
 * {@link STALE_SESSIONS} sessions drop out, and the set keeps its `cap` most recent.
 */
export function mergeSet(prev: StoredSet | null, used: Iterable<{ v: string; f: string }>, cap: number, session = (prev?.session ?? 0) + 1): StoredSet {
  const byKey = new Map<string, SetEntry>();
  for (const e of prev?.entries ?? []) if (session - e.last <= STALE_SESSIONS) byKey.set(`${e.v}:${e.f}`, { ...e });
  for (const u of used) {
    const k = `${u.v}:${u.f}`;
    const e = byKey.get(k);
    if (e) {
      if (e.last !== session) e.uses++;
      e.last = session;
    } else byKey.set(k, { v: u.v, f: u.f, uses: 1, last: session });
  }
  return { session, entries: prewarmOrder({ session, entries: [...byKey.values()] }, cap) };
}

/** A pooled program handed to a pipeline. */
export interface AdoptedProgram {
  program: WebGLProgram;
  ready(): boolean;
  done(): void;
}

/** A program the pool holds: linked or still linking. */
interface Pooled {
  program: WebGLProgram;
  shaders: WebGLShader[];
  ready: boolean;
  /** Linked after the first picture for meshes still to come: not trimmed with the boot pool. */
  keep?: boolean;
}

/** The WebGL2 calls the cache makes, called on the context with `call`. */
export type GlApi = Pick<WebGL2RenderingContext, 'createProgram' | 'createShader' | 'shaderSource' | 'compileShader' | 'attachShader' | 'detachShader' | 'linkProgram' | 'getProgramParameter' | 'deleteShader' | 'deleteProgram'>;
/** The unpatched ones by default: the shader-release wrappers on the context must not count the cache's own shaders. */
const GL: GlApi | null = typeof WebGL2RenderingContext === 'undefined' ? null : WebGL2RenderingContext.prototype;

export class ProgramCache {
  /** Pool: vertex source, then fragment source, to the program linked from them. */
  private readonly pool = new Map<string, Map<string, Pooled>>();
  /** Every stage source the pool covers (count of pooled programs using it). */
  private readonly covered = new Map<string, number>();
  /** Pairs of the boot set not submitted yet (vertex, fragment sources); `eager` ones first (see {@link ProgramStore.boot}). */
  private queue: Array<{ v: string; f: string; eager?: boolean }> = [];
  /** Pairs used this session, by tier (source strings; hashed when saved). */
  private readonly used = new Map<RenderTier, Map<string, Set<string>>>();
  /** Every pair this page used, by tier, in first-use order (not cleared by a save; {@link sessionPairs}). */
  private readonly seen = new Map<RenderTier, Map<string, [string, string]>>();
  private readonly hashes = new Map<string, string>();
  private readonly linking = new Set<Pooled>();
  private stopped = false;
  private disposed = false;
  private firstPicture = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private trimTimer: ReturnType<typeof setTimeout> | undefined;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private primeTimer: ReturnType<typeof setTimeout> | undefined;
  private tier: RenderTier | null = null;
  /** The tier the boot pre-warm links (null before it starts), and a counter that makes a superseded load give up. */
  private prewarmTier: RenderTier | null = null;
  private generation = 0;
  /** The session number this page saves each tier under. */
  private readonly sessions = new Map<RenderTier, number>();
  readonly stats: ProgramCacheStats = { tier: null, set: 0, eager: 0, submitted: 0, linked: 0, failed: 0, adopted: 0, linkedOwn: 0, missedAfterFirstPicture: 0, trimmed: 0, primed: 0, pooledLater: 0, startedAt: 0, doneAt: 0, log: [] };
  /** Pairs of the boot set (source strings): a link outside them after the first picture is a miss. */
  private readonly inSet = new Map<string, Set<string>>();

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly parallel: { COMPLETION_STATUS_KHR: number } | null,
    private readonly store: ProgramStore | null,
    private readonly api: GlApi | null = GL,
  ) {}

  /** The tier whose programs are being recorded (null: none, e.g. while a still renders). */
  setTier(tier: RenderTier | null): void {
    if (tier !== this.tier) this.logEvent(`tier ${tier}`);
    // After the first picture the pool holds only programs kept for the tier in effect: another tier builds other ones.
    if (tier !== this.tier && this.firstPicture && this.tier !== null && tier !== null) this.trim(true);
    this.tier = tier;
    if (tier) this.stats.tier ??= tier;
    // The world settled on another tier than the boot guess (a heavy world starts lower): pre-warm that tier's set instead
    // (after the world's compile began, only its boot set: see pump).
    if (tier && this.prewarmTier !== null && tier !== this.prewarmTier && !this.firstPicture) void this.prewarm(tier);
  }

  /**
   * Load the tier's set and link it, a few at a time, into the pool: the store's boot pairs first (a cooked world's), then the
   * stored set (what this browser used on the tier before). Resolves when the set is loaded (not linked).
   */
  async prewarm(tier: RenderTier): Promise<void> {
    this.logEvent(`prewarm ${tier}${this.stopped ? ' (compile begun)' : ''}`);
    this.prewarmTier = tier;
    this.tier = tier;
    this.stats.tier = tier;
    this.queue = [];
    const gen = ++this.generation;
    if (!this.store || this.disposed) return;
    this.stats.startedAt ||= performance.now();
    const [set, boot] = await Promise.all([this.store.getSet(tier).catch(() => null), this.store.boot ? this.store.boot(tier).catch(() => null) : Promise.resolve(null)]);
    if (this.disposed || gen !== this.generation) return;
    const order = set ? prewarmOrder(set, SET_CAP[tier]) : [];
    const bootPairs = [...(boot ?? [])].map((k) => k.split(':') as [string, string]);
    this.stats.set = order.length;
    if (order.length === 0 && bootPairs.length === 0) return;
    const sources = await this.store.getSources([...new Set([...order.flatMap((e) => [e.v, e.f]), ...bootPairs.flat()])]).catch(() => new Map<string, string>());
    if (this.disposed || gen !== this.generation) return;
    const queued = new Set<string>();
    const add = (hv: string, hf: string, eager: boolean): void => {
      const v = sources.get(hv), f = sources.get(hf);
      if (v === undefined || f === undefined || queued.has(`${hv}:${hf}`)) return;
      queued.add(`${hv}:${hf}`);
      this.hashes.set(v, hv);
      this.hashes.set(f, hf);
      let fs = this.inSet.get(v);
      if (!fs) this.inSet.set(v, (fs = new Set()));
      fs.add(f);
      // Already asked for by three while the set was loading (it links that one itself), or already pooled.
      if (this.usedNow(v, f) || this.pool.get(v)?.has(f)) return;
      this.queue.push(eager ? { v, f, eager: true } : { v, f });
    };
    // The boot pairs in their order (the load's own), then the stored set, most recently used first.
    for (const [v, f] of bootPairs) add(v, f, true);
    this.stats.eager = this.queue.length;
    for (const e of order) add(e.v, e.f, false);
    if (this.timer === undefined) this.pump();
  }

  private logEvent(e: string): void {
    if (this.stats.log.length < 64) this.stats.log.push(`${Math.round(performance.now())} ${e} (submitted ${this.stats.submitted})`);
  }

  /** The world's own compile began: stop submitting the boot set (in-flight links finish into the pool). */
  worldCompiling(): void {
    if (!this.stopped) this.logEvent('compile');
    this.stopped = true;
  }

  /** True when a pooled program (linked or linking) uses this stage source: three need not compile its shader. */
  covers(code: string): boolean {
    return (this.covered.get(code) ?? 0) > 0;
  }

  /** A pipeline of these sources links on the synchronous path: record it as used. */
  note(v: string | undefined, f: string | undefined): void {
    if (v !== undefined && f !== undefined) this.record(v, f);
  }

  /**
   * A pipeline of these sources is being created. Returns the pooled program to use, or null when it must link its own.
   * `ready()` says when its link is complete; `done()` (after that) frees its shaders. Records the pair as used either way.
   */
  take(v: string | undefined, f: string | undefined): AdoptedProgram | null {
    if (v === undefined || f === undefined) return null;
    this.record(v, f);
    const fs = this.pool.get(v);
    const p = fs?.get(f);
    if (p && fs) {
      fs.delete(f);
      if (fs.size === 0) this.pool.delete(v);
      this.uncover(v);
      this.uncover(f);
      this.stats.adopted++;
      // Its link may still be running: the pipeline polls it like its own (the pool stops tracking it).
      this.linking.delete(p);
      this.detach(p);
      return {
        program: p.program,
        ready: () => p.ready || this.complete(p.program),
        done: () => {
          p.ready = true;
          this.detach(p);
        },
      };
    }
    // Not pooled: never submit it later as part of the boot set.
    this.queue = this.queue.filter((q) => q.v !== v || q.f !== f);
    this.stats.linkedOwn++;
    if (this.firstPicture && !this.inSet.get(v)?.has(f)) this.stats.missedAfterFirstPicture++;
    return null;
  }

  /** The first picture is on screen: unused pooled programs go after {@link POOL_TRIM_MS}; usage is saved. */
  markFirstPicture(): void {
    if (this.firstPicture) return;
    this.firstPicture = true;
    this.stopped = true;
    for (const q of this.queue) q.eager = false;
    this.trimTimer = setTimeout(() => this.trim(), POOL_TRIM_MS);
    this.scheduleSave(2000);
  }

  /**
   * After the first picture: the tier's programs this load has not linked (the rest of the stored set, then the rest of a
   * cooked world's set) are linked one at a time into the pool while `idle` holds, and kept there, so a mesh that comes into
   * view later (a region streamed in, a lamp alone in its cell) takes its program instead of linking it mid-move. Then, at
   * rest, the sets of `tiers` are linked one at a time and deleted at once: the browser's program cache then holds them for
   * a tier change or the next visit. `idle` and `atRest` are asked before each link.
   */
  async prime(tiers: readonly RenderTier[], atRest: () => boolean, idle: () => boolean = atRest): Promise<void> {
    if (!this.store || this.disposed) return;
    const tier = this.tier;
    const own: Array<{ v: string; f: string }> = this.queue.map((q) => ({ v: q.v, f: q.f }));
    this.queue = [];
    // The rest of a cooked world's set of the tier in effect (its orbit and play), after the browser's own entries.
    const later = tier && this.store.later ? await this.store.later(tier).catch(() => null) : null;
    if (later && later.size > 0 && !this.disposed) {
      const pairs = [...later].map((k) => k.split(':') as [string, string]);
      const sources = await this.store.getSources([...new Set(pairs.flat())]).catch(() => new Map<string, string>());
      for (const [hv, hf] of pairs) {
        const v = sources.get(hv), f = sources.get(hf);
        if (v === undefined || f === undefined) continue;
        this.hashes.set(v, hv);
        this.hashes.set(f, hf);
        let fs = this.inSet.get(v);
        if (!fs) this.inSet.set(v, (fs = new Set()));
        fs.add(f);
        own.push({ v, f });
      }
    }
    const todo: Array<{ v: string; f: string }> = [];
    for (const t of tiers) {
      const set = await this.store.getSet(t).catch(() => null);
      if (!set || this.disposed) continue;
      const order = prewarmOrder(set, SET_CAP[t]);
      const sources = await this.store.getSources([...new Set(order.flatMap((e) => [e.v, e.f]))]).catch(() => new Map<string, string>());
      for (const e of order) {
        const v = sources.get(e.v), f = sources.get(e.f);
        if (v !== undefined && f !== undefined && !this.usedNow(v, f)) todo.push({ v, f });
      }
    }
    const step = (): void => {
      this.primeTimer = undefined;
      if (this.disposed) return;
      // The tier in effect first, kept in the pool; given up when the tier changed (its materials are built again).
      if (own.length > 0 && this.tier === tier) {
        if (!idle() || this.linking.size > 0) {
          this.primeTimer = setTimeout(step, 250);
          return;
        }
        const next = own.shift()!;
        if (this.usedNow(next.v, next.f) || this.pool.get(next.v)?.has(next.f)) {
          this.primeTimer = setTimeout(step, 0);
          return;
        }
        const p = this.poolLink(next.v, next.f, true);
        if (!p) return;
        this.stats.pooledLater++;
        const wait = (): void => {
          this.primeTimer = undefined;
          if (this.disposed) return;
          if (!this.complete(p.program)) {
            this.primeTimer = setTimeout(wait, 50);
            return;
          }
          this.settle(p);
          this.primeTimer = setTimeout(step, 16);
        };
        this.primeTimer = setTimeout(wait, 50);
        return;
      }
      own.length = 0;
      if (todo.length === 0) return;
      if (!atRest() || this.linking.size > 0) {
        this.primeTimer = setTimeout(step, 1000);
        return;
      }
      const next = todo.shift()!;
      if (this.usedNow(next.v, next.f)) {
        this.primeTimer = setTimeout(step, 0);
        return;
      }
      const p = this.link(next.v, next.f);
      if (!p) return;
      const wait = (): void => {
        this.primeTimer = undefined;
        if (this.disposed) return;
        if (!this.complete(p.program)) {
          this.primeTimer = setTimeout(wait, 50);
          return;
        }
        this.linking.delete(p);
        this.release(p);
        this.stats.primed++;
        this.primeTimer = setTimeout(step, 250);
      };
      this.linking.add(p);
      this.primeTimer = setTimeout(wait, 50);
    };
    this.primeTimer = setTimeout(step, 0);
  }

  /**
   * Every pair (vertex and fragment source) this page used on `tier`, in the order first used, however large: the stored
   * set is capped at {@link SET_CAP} and shared by every world, this is not (the cook records a load's exact boot set from it).
   */
  sessionPairs(tier: RenderTier): Array<[string, string]> {
    return [...(this.seen.get(tier)?.values() ?? [])];
  }

  /** Save what this session used (also called on dispose). */
  async save(): Promise<void> {
    if (!this.store || this.used.size === 0) return;
    const sources = new Map<string, string>();
    const keep = new Set<string>();
    const hash = (s: string): string => {
      let h = this.hashes.get(s);
      if (h === undefined) this.hashes.set(s, (h = sourceHash(s)));
      sources.set(h, s);
      return h;
    };
    const tiers: RenderTier[] = ['low', 'medium', 'high', 'ultra'];
    const merged = new Map<RenderTier, StoredSet>();
    for (const tier of tiers) {
      const prev = await this.store.getSet(tier).catch(() => null);
      const pairs = this.used.get(tier);
      // One page is one session of the set, however often it saves.
      const session = this.sessions.get(tier) ?? (prev?.session ?? 0) + 1;
      if (pairs) this.sessions.set(tier, session);
      const set = pairs ? mergeSet(prev, [...pairs].flatMap(([v, fs]) => [...fs].map((f) => ({ v: hash(v), f: hash(f) }))), SET_CAP[tier], session) : prev;
      if (!set) continue;
      if (pairs) merged.set(tier, set);
      for (const e of set.entries) keep.add(e.v).add(e.f);
    }
    this.used.clear();
    try {
      await this.store.putSources(new Map([...sources].filter(([h]) => keep.has(h))));
      for (const [tier, set] of merged) await this.store.putSet(tier, set);
      await this.store.prune(keep);
    } catch {
      /* a full quota: the next visit simply links as before */
    }
  }

  dispose(): void {
    if (this.disposed) return;
    void this.save();
    this.disposed = true;
    for (const t of [this.timer, this.trimTimer, this.saveTimer, this.primeTimer]) if (t !== undefined) clearTimeout(t);
    this.trim(true);
  }

  private usedNow(v: string, f: string): boolean {
    for (const pairs of this.used.values()) if (pairs.get(v)?.has(f)) return true;
    return false;
  }

  private record(v: string, f: string): void {
    const tier = this.tier;
    if (!tier) return;
    let pairs = this.used.get(tier);
    if (!pairs) this.used.set(tier, (pairs = new Map()));
    let fs = pairs.get(v);
    if (!fs) pairs.set(v, (fs = new Set()));
    if (fs.has(f)) return;
    fs.add(f);
    let all = this.seen.get(tier);
    if (!all) this.seen.set(tier, (all = new Map()));
    const k = `${v.length}:${f.length}:${v}\u0000${f}`;
    if (!all.has(k)) all.set(k, [v, f]);
    if (this.firstPicture) this.scheduleSave(10_000);
  }

  private scheduleSave(ms: number): void {
    if (this.saveTimer !== undefined || this.disposed) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.save();
    }, ms);
  }

  private complete(program: WebGLProgram): boolean {
    if (!this.api || this.gl.isContextLost()) return true;
    return this.parallel ? this.api.getProgramParameter.call(this.gl, program, this.parallel.COMPLETION_STATUS_KHR) === true : true;
  }

  /** Compile and link one pair (not waited on). */
  private link(v: string, f: string): Pooled | null {
    const gl = this.gl;
    if (!this.api || gl.isContextLost()) return null;
    const program = this.api.createProgram.call(gl);
    const vs = this.api.createShader.call(gl, gl.VERTEX_SHADER);
    const fs = this.api.createShader.call(gl, gl.FRAGMENT_SHADER);
    if (!program || !vs || !fs) return null;
    this.api.shaderSource.call(gl, vs, v);
    this.api.compileShader.call(gl, vs);
    this.api.shaderSource.call(gl, fs, f);
    this.api.compileShader.call(gl, fs);
    this.api.attachShader.call(gl, program, fs);
    this.api.attachShader.call(gl, program, vs);
    this.api.linkProgram.call(gl, program);
    return { program, shaders: [vs, fs], ready: false };
  }

  /** Submit boot-set links up to {@link PREWARM_IN_FLIGHT}, and poll those in flight. */
  private pump(): void {
    this.timer = undefined;
    if (this.disposed) return;
    for (const p of [...this.linking]) if (this.complete(p.program)) this.settle(p);
    const inFlight = this.queue[0]?.eager === true ? EAGER_IN_FLIGHT() : PREWARM_IN_FLIGHT;
    while (this.linking.size < inFlight && this.queue.length > 0 && (!this.stopped || this.queue[0]!.eager === true)) {
      const next = this.queue.shift()!;
      const p = this.poolLink(next.v, next.f, false);
      if (!p) break;
      this.stats.submitted++;
    }
    if (this.linking.size > 0 || (this.queue.length > 0 && (!this.stopped || this.queue[0]!.eager === true))) this.timer = setTimeout(() => this.pump(), 16);
  }

  /** Link a pair into the pool (in flight until {@link settle}); `keep`: not trimmed (see {@link prime}). */
  private poolLink(v: string, f: string, keep: boolean): Pooled | null {
    const p = this.link(v, f);
    if (!p) return null;
    if (keep) p.keep = true;
    let fs = this.pool.get(v);
    if (!fs) this.pool.set(v, (fs = new Map()));
    fs.set(f, p);
    this.cover(v);
    this.cover(f);
    this.linking.add(p);
    return p;
  }

  /** A pooled link is complete: a failed one leaves the pool, a linked one lets its shaders go. */
  private settle(p: Pooled): void {
    if (!this.linking.delete(p)) return;
    p.ready = true;
    if (this.api && !this.gl.isContextLost() && this.api.getProgramParameter.call(this.gl, p.program, this.gl.LINK_STATUS) !== true) {
      this.stats.failed++;
      this.drop(p);
      return;
    }
    this.stats.linked++;
    this.stats.doneAt = performance.now();
    this.detach(p);
  }

  /** A linked program needs no shaders: detach and delete them (their compiled form is large on Mesa). */
  private detach(p: Pooled): void {
    if (!p.ready || p.shaders.length === 0 || !this.api || this.gl.isContextLost()) return;
    for (const s of p.shaders) {
      this.api.detachShader.call(this.gl, p.program, s);
      this.api.deleteShader.call(this.gl, s);
    }
    p.shaders = [];
  }

  /** Remove a pooled program (failed link) from the pool and delete it. */
  private drop(p: Pooled): void {
    for (const [v, fs] of this.pool) {
      for (const [f, q] of fs) {
        if (q !== p) continue;
        fs.delete(f);
        this.uncover(v);
        this.uncover(f);
      }
      if (fs.size === 0) this.pool.delete(v);
    }
    this.release(p);
  }

  private release(p: Pooled): void {
    if (!this.api || this.gl.isContextLost()) return;
    for (const s of p.shaders) this.api.deleteShader.call(this.gl, s);
    p.shaders = [];
    this.api.deleteProgram.call(this.gl, p.program);
  }

  /**
   * Delete pooled programs nobody took; those linked after the first picture for the tier in effect ({@link prime}) only
   * with `all` (a tier change, dispose). One still linking stays pooled (a later trim, or a pipeline, takes it).
   */
  private trim(all = false): void {
    this.trimTimer = undefined;
    for (const [v, fs] of [...this.pool]) {
      for (const [f, p] of [...fs]) {
        if (p.keep && !all) continue;
        if (!p.ready && !this.complete(p.program) && !this.disposed) continue;
        this.linking.delete(p);
        this.release(p);
        this.stats.trimmed++;
        fs.delete(f);
        this.uncover(v);
        this.uncover(f);
      }
      if (fs.size === 0) this.pool.delete(v);
    }
    if (this.disposed) {
      this.pool.clear();
      this.covered.clear();
    }
  }

  private cover(code: string): void {
    this.covered.set(code, (this.covered.get(code) ?? 0) + 1);
  }

  private uncover(code: string): void {
    const n = (this.covered.get(code) ?? 0) - 1;
    if (n > 0) this.covered.set(code, n);
    else this.covered.delete(code);
  }
}

/** The IndexedDB store of program sets and sources (null where IndexedDB is missing). */
export function indexedDbProgramStore(): ProgramStore | null {
  if (typeof indexedDB === 'undefined') return null;
  let db: Promise<IDBDatabase | null> | null = null;
  const open = (): Promise<IDBDatabase | null> =>
    (db ??= new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains(SOURCES)) d.createObjectStore(SOURCES);
          if (!d.objectStoreNames.contains(SETS)) d.createObjectStore(SETS);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    }));
  const wrap = <T>(req: IDBRequest<T>): Promise<T | null> =>
    new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  const finished = (tx: IDBTransaction): Promise<void> =>
    new Promise((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  return {
    async getSet(tier) {
      const d = await open();
      if (!d) return null;
      const set = (await wrap(d.transaction(SETS, 'readonly').objectStore(SETS).get(tier))) as StoredSet | null | undefined;
      return set && Array.isArray(set.entries) ? set : null;
    },
    async putSet(tier, set) {
      const d = await open();
      if (!d) return;
      const tx = d.transaction(SETS, 'readwrite');
      tx.objectStore(SETS).put(set, tier);
      await finished(tx);
    },
    async getSources(hashes) {
      const out = new Map<string, string>();
      const d = await open();
      if (!d) return out;
      const st = d.transaction(SOURCES, 'readonly').objectStore(SOURCES);
      const values = await Promise.all(hashes.map((h) => wrap(st.get(h) as IDBRequest<{ code: string } | undefined>)));
      hashes.forEach((h, i) => {
        const v = values[i];
        if (v && typeof v.code === 'string') out.set(h, v.code);
      });
      return out;
    },
    async putSources(sources) {
      const d = await open();
      if (!d || sources.size === 0) return;
      const tx = d.transaction(SOURCES, 'readwrite');
      const st = tx.objectStore(SOURCES);
      const at = Date.now();
      const present = new Set(((await wrap(st.getAllKeys())) ?? []).map(String));
      for (const [h, code] of sources) if (!present.has(h)) st.put({ code, at, bytes: code.length }, h);
      await finished(tx);
    },
    async prune(keep) {
      const d = await open();
      if (!d) return;
      const tx = d.transaction(SOURCES, 'readwrite');
      const st = tx.objectStore(SOURCES);
      for (const k of ((await wrap(st.getAllKeys())) ?? []).map(String)) if (!keep.has(k)) st.delete(k);
      await finished(tx);
    },
  };
}

/** The parts of three's WebGL backend that {@link installLazyStages} wraps. */
interface StageBackend {
  isWebGPUBackend?: boolean;
  createProgram?(program: { stage: string; code: string }): void;
  get(key: object): Record<string, unknown>;
  set(key: object, value: object): void;
}

/**
 * Three compiles a shader object for every programmable stage when the stage is created. A stage the pool covers usually
 * never needs one (its pipeline takes the pooled program): its shader is compiled on first use instead.
 */
export function installLazyStages(backend: StageBackend, cache: ProgramCache): () => void {
  const original = backend.createProgram;
  if (backend.isWebGPUBackend === true || typeof original !== 'function') return () => undefined;
  const wrapped = function (this: StageBackend, program: { stage: string; code: string }): void {
    if (program.stage === 'compute' || !cache.covers(program.code)) return original.call(this, program);
    const self = this;
    let compiled = false;
    self.set(program, {
      get shaderGPU(): unknown {
        if (compiled) return undefined;
        compiled = true;
        // Replaces this record with the compiled one.
        original.call(self, program);
        return self.get(program)['shaderGPU'];
      },
    });
  };
  backend.createProgram = wrapped;
  return () => {
    if (backend.createProgram === wrapped) backend.createProgram = original;
  };
}
