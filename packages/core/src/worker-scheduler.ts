/**
 * One budget for every busy web worker of the page (docs/ARCHITECTURE-STREAMING.md, "Worker scheduler").
 *
 * Every pool keeps its workers (starting one costs a JavaScript realm and a module load) but takes a token before it
 * gives a worker a job, and gives it back when the worker has nothing left. At most {@link workerBudget} tokens are out
 * at once: the hardware threads but two, which stay for the main thread and the browser's GPU process, and fewer when
 * the device has little memory.
 *
 * - **Classes**, most urgent first: `interactive` (raycasts, an edit's regeneration), `visible` (generation of the cells
 *   in view), `load` (merges, procedural fields, atlases), `volume` (the light volume), `bake` (lightmaps), `background`
 *   (verification, export, diagnostics). A free slot goes to the most urgent waiter, the oldest first within a class. A
 *   waiter moves up one class for every {@link AGE_MS} it has waited, to just short of `interactive`, so a merge behind
 *   a whole world's generation still runs.
 * - **Yielding.** A token whose class is outranked by a waiter that cannot start (no slot), whose class has a waiter
 *   of its own that has waited {@link FAIR_MS}, or whose class is paused, reports {@link WorkToken.yieldRequested}: pools that feed a worker a stream of jobs stop feeding it and give the
 *   token back when it drains. A single long job (a lightmap bake) runs to its end; it only does not start while more
 *   urgent work waits.
 * - **Reserve.** `volume`, `bake` and `background` together hold at most the budget less one, so a raycast or a cell in
 *   view never waits for a bake to end. `load` may go one token over the budget and `interactive` two: their jobs are
 *   short, and the first picture or the user waits on them.
 * - **Pauses.** While a pause reason is on, the classes it names get no new token and their holders are asked to yield:
 *   `bake` and `background` for the first picture, and `volume` too for the view moving, a time-of-day drag or an editor
 *   drag ({@link MOTION_PAUSED}). A held pause (the view moving, see
 *   {@link WorkerScheduler.holdPause}) that has been on without a break for {@link PAUSE_LIMIT_MS} stops holding work
 *   back until it lapses; the first picture and drags end by themselves.
 *
 * `globalThis.__AETHER_WORKER_SCHEDULER = false` (set before the page starts) turns the budget off: every token is
 * granted at once and pools size themselves as before (A/B runs). `__AETHER_WORKER_BUDGET` forces the budget.
 * `globalThis.__aetherWorkers` reads {@link WorkerScheduler.snapshot}: per class queued, running and wait times.
 */

export const WORK_CLASSES = ['interactive', 'visible', 'load', 'volume', 'bake', 'background'] as const;
export type WorkClass = (typeof WORK_CLASSES)[number];

/** A waiter moves up one class per this many milliseconds of waiting. */
export const AGE_MS = 500;
/** A waiter of the holder's own class asks it to yield once it has waited this long (lanes of one class take turns). */
export const FAIR_MS = 200;
/** A held pause (the view moving) on for longer than this without a break no longer holds work back (a game's view moves all the time). */
export const PAUSE_LIMIT_MS = 15_000;

const RANK: Readonly<Record<WorkClass, number>> = { interactive: 0, visible: 1, load: 2, volume: 3, bake: 4, background: 5 };
/** Classes a pause holds back unless it names others (the first picture). */
const PAUSED_BY_DEFAULT: readonly WorkClass[] = ['bake', 'background'];
/** What a moving view or a drag holds back: the light volume's bake too (a single job that cannot be parked once it runs). */
export const MOTION_PAUSED: readonly WorkClass[] = ['volume', 'bake', 'background'];
/** Classes that share the budget less one. */
const RESERVED = new Set<WorkClass>(['volume', 'bake', 'background']);

/** A slot of the budget, held while a worker has work. */
export interface WorkToken {
  readonly cls: WorkClass;
  /** More urgent work waits for a slot, or the class is paused: stop feeding the worker and release once it drains. */
  readonly yieldRequested: boolean;
  /** Give the slot back (idempotent). */
  release(): void;
}

/** Per-class counters of {@link WorkerScheduler.snapshot}. */
export interface WorkClassStats {
  queued: number;
  running: number;
  /** Tokens granted since the page started. */
  granted: number;
  /** Granted after waiting (not at once). */
  waited: number;
  /** Milliseconds waited, summed, longest, and the longest of a waiter still queued. */
  waitMs: number;
  maxWaitMs: number;
  oldestQueuedMs: number;
  /** Yields asked of holders (pause or a more urgent waiter). */
  yields: number;
}

export interface WorkerSchedulerSnapshot {
  enabled: boolean;
  budget: number;
  running: number;
  paused: string[];
  classes: Record<WorkClass, WorkClassStats>;
}

interface NavLike {
  hardwareConcurrency?: number;
  deviceMemory?: number;
}

/**
 * Busy workers this device affords: the hardware threads but two (the main thread and the GPU process), at least one;
 * at most two at ≤ 4 GB of device memory and one at ≤ 2 GB (each busy worker holds a realm and its job's buffers).
 */
export function workerBudget(nav: NavLike | undefined = (globalThis as { navigator?: NavLike }).navigator): number {
  const forced = Number((globalThis as { __AETHER_WORKER_BUDGET?: unknown }).__AETHER_WORKER_BUDGET);
  if (Number.isFinite(forced) && forced >= 1) return Math.floor(forced);
  const threads = Number(nav?.hardwareConcurrency) || 4;
  const memory = Number(nav?.deviceMemory) || 8;
  let budget = Math.max(1, Math.floor(threads) - 2);
  if (memory <= 2) budget = 1;
  else if (memory <= 4) budget = Math.min(budget, 2);
  return budget;
}

/** The scheduler is on unless `__AETHER_WORKER_SCHEDULER === false`. */
export function workerSchedulerEnabled(): boolean {
  return (globalThis as { __AETHER_WORKER_SCHEDULER?: unknown }).__AETHER_WORKER_SCHEDULER !== false;
}

/** Workers a pool should keep at most: its own cap, and no more than the budget while the scheduler is on. */
export function lanesWithinBudget(own: number): number {
  return workerSchedulerEnabled() ? Math.max(1, Math.min(own, workerBudget())) : own;
}

interface Waiter {
  cls: WorkClass;
  since: number;
  resolve: (t: WorkToken) => void;
  reject: (e: Error) => void;
  signal?: AbortSignal | undefined;
  onAbort?: () => void;
}

export interface WorkerSchedulerOptions {
  budget?: number;
  enabled?: boolean;
  clock?: () => number;
}

export class WorkerScheduler {
  readonly budget: number;
  readonly enabled: boolean;
  private readonly clock: () => number;
  private readonly running: Record<WorkClass, number>;
  private readonly stats: Record<WorkClass, WorkClassStats>;
  private readonly waiters: Waiter[] = [];
  /** Pause reasons: until when (ms, Infinity for one that is switched off explicitly). */
  private readonly pauses = new Map<string, number>();
  /** The classes each pause holds back. */
  private readonly pauseClasses = new Map<string, ReadonlySet<WorkClass>>();
  /** Held pauses: since when they have been on without a break. */
  private readonly pauseSince = new Map<string, number>();
  private pauseTimer: ReturnType<typeof setTimeout> | null = null;
  private pauseTimerAt = Infinity;
  private pumping = false;

  constructor(opts: WorkerSchedulerOptions = {}) {
    this.budget = Math.max(1, Math.floor(opts.budget ?? workerBudget()));
    this.enabled = opts.enabled ?? workerSchedulerEnabled();
    this.clock = opts.clock ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    const zero = (): WorkClassStats => ({ queued: 0, running: 0, granted: 0, waited: 0, waitMs: 0, maxWaitMs: 0, oldestQueuedMs: 0, yields: 0 });
    this.running = Object.fromEntries(WORK_CLASSES.map((c) => [c, 0])) as Record<WorkClass, number>;
    this.stats = Object.fromEntries(WORK_CLASSES.map((c) => [c, zero()])) as Record<WorkClass, WorkClassStats>;
  }

  /** Tokens out now. */
  get busy(): number {
    let n = 0;
    for (const c of WORK_CLASSES) n += this.running[c];
    return n;
  }

  /** `bake` and `background` are paused now. */
  get paused(): boolean {
    if (!this.enabled || this.pauses.size === 0) return false;
    const t = this.clock();
    for (const until of this.pauses.values()) if (until > t) return true;
    return false;
  }

  isPaused(cls: WorkClass): boolean {
    return this.pausedFor(cls);
  }

  /**
   * `cls` is paused: a pause switched on explicitly (the first picture, a drag) holds until it is switched off; a held one
   * (the view moving) while it lasts, up to {@link PAUSE_LIMIT_MS} without a break.
   */
  private pausedFor(cls: WorkClass): boolean {
    if (!this.enabled || this.pauses.size === 0 || cls === 'interactive' || cls === 'visible' || cls === 'load') return false;
    const t = this.clock();
    for (const [reason, until] of this.pauses) {
      if (!this.pauseClasses.get(reason)?.has(cls)) continue;
      if (until === Infinity) return true;
      if (until > t && t - (this.pauseSince.get(reason) ?? t) < PAUSE_LIMIT_MS) return true;
    }
    return false;
  }

  /** A slot for `cls` now, or null (a more urgent or older waiter, no slot, or a pause). */
  tryAcquire(cls: WorkClass): WorkToken | null {
    if (!this.enabled) return this.grant(cls, -1);
    if (!this.canStart(cls)) return null;
    // Waiters of this class or a more urgent one go first.
    const r = RANK[cls];
    const t = this.clock();
    for (const w of this.waiters) if (this.effectiveRank(w, t) <= r && !this.held(w, t)) return null;
    return this.grant(cls, -1);
  }

  /** A slot for `cls`: at once when one is free, else when it comes up. Rejects when `signal` aborts. */
  acquire(cls: WorkClass, signal?: AbortSignal): Promise<WorkToken> {
    const now = this.tryAcquire(cls);
    if (now) return Promise.resolve(now);
    if (signal?.aborted) return Promise.reject(new Error('aborted'));
    return new Promise<WorkToken>((resolve, reject) => {
      const w: Waiter = { cls, since: this.clock(), resolve, reject, signal };
      if (signal) {
        w.onAbort = () => {
          const i = this.waiters.indexOf(w);
          if (i >= 0) {
            this.waiters.splice(i, 1);
            this.stats[cls].queued--;
            reject(new Error('aborted'));
          }
        };
        signal.addEventListener('abort', w.onAbort, { once: true });
      }
      this.waiters.push(w);
      this.stats[cls].queued++;
    });
  }

  /** Run `job` holding a slot of `cls`. */
  async run<T>(cls: WorkClass, job: () => Promise<T> | T, signal?: AbortSignal): Promise<T> {
    const token = await this.acquire(cls, signal);
    try {
      return await job();
    } finally {
      token.release();
    }
  }

  /** Switch a pause reason on or off; it holds back `classes` (default `bake` and `background`). */
  setPaused(reason: string, on: boolean, classes: readonly WorkClass[] = PAUSED_BY_DEFAULT): void {
    if (on) {
      this.pauses.set(reason, Infinity);
      this.pauseClasses.set(reason, new Set(classes));
    } else if (this.pauses.delete(reason)) this.pump();
  }

  /** Hold a pause reason for `ms` from now (extended by every call: the view moving); it holds back `classes`. */
  holdPause(reason: string, ms: number, classes: readonly WorkClass[] = PAUSED_BY_DEFAULT): void {
    const t = this.clock();
    if (!this.pauseClasses.has(reason)) this.pauseClasses.set(reason, new Set(classes));
    const until = t + Math.max(0, ms);
    const prev = this.pauses.get(reason);
    if (prev === Infinity || (prev !== undefined && prev >= until)) return;
    if (prev === undefined || prev <= t) this.pauseSince.set(reason, t);
    this.pauses.set(reason, until);
    this.armPauseTimer(until);
    // The limit runs out while the pause is still held: look again then.
    const since = this.pauseSince.get(reason) ?? t;
    if (t - since < PAUSE_LIMIT_MS) this.armPauseTimer(since + PAUSE_LIMIT_MS);
  }

  snapshot(): WorkerSchedulerSnapshot {
    const t = this.clock();
    const classes = {} as Record<WorkClass, WorkClassStats>;
    for (const c of WORK_CLASSES) {
      const s = this.stats[c];
      let oldest = 0;
      for (const w of this.waiters) if (w.cls === c) oldest = Math.max(oldest, t - w.since);
      classes[c] = { ...s, running: this.running[c], waitMs: Math.round(s.waitMs), maxWaitMs: Math.round(s.maxWaitMs), oldestQueuedMs: Math.round(oldest) };
    }
    const paused = [...this.pauses].filter(([, until]) => until > t).map(([r]) => r);
    return { enabled: this.enabled, budget: this.budget, running: this.busy, paused, classes };
  }

  /** A waiter's class less its age (one class per {@link AGE_MS}); only `interactive` reaches 0. */
  private effectiveRank(w: Waiter, t: number): number {
    if (w.cls === 'interactive') return 0;
    return Math.max(0.5, RANK[w.cls] - (t - w.since) / AGE_MS);
  }

  /** A waiter its class's pause holds back. */
  private held(w: Waiter, _t: number): boolean {
    return this.pausedFor(w.cls);
  }

  /** Capacity for one more `cls` token (queue order aside). */
  private canStart(cls: WorkClass): boolean {
    if (this.pausedFor(cls)) return false;
    const busy = this.busy;
    // A raycast or an edit may take a slot over the budget: the user waits on it, and it is short. Load-critical work
    // (merges, transcodes, atlases: short jobs the first picture waits for) may take one too, so it never queues behind a
    // world's generation.
    if (cls === 'interactive') return busy < this.budget + 2;
    if (cls === 'load') return busy < this.budget + 1;
    if (busy >= this.budget) return false;
    if (RESERVED.has(cls) && this.budget > 1) {
      let low = 0;
      for (const c of RESERVED) low += this.running[c];
      if (low >= this.budget - 1) return false;
    }
    return true;
  }

  private grant(cls: WorkClass, since: number): WorkToken {
    this.running[cls]++;
    const s = this.stats[cls];
    s.granted++;
    if (since >= 0) {
      const waited = this.clock() - since;
      s.waited++;
      s.waitMs += waited;
      if (waited > s.maxWaitMs) s.maxWaitMs = waited;
    }
    let released = false;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const sched = this;
    let asked = false;
    return {
      cls,
      get yieldRequested(): boolean {
        if (released || !sched.enabled) return false;
        const y = sched.isPaused(cls) || sched.outranked(cls);
        if (y && !asked) {
          asked = true;
          s.yields++;
        }
        return y;
      },
      release(): void {
        if (released) return;
        released = true;
        sched.running[cls]--;
        sched.pump();
      },
    };
  }

  /** A waiter more urgent than `cls` (after aging), or of `cls` that has waited {@link FAIR_MS}, cannot start for want of a slot. */
  private outranked(cls: WorkClass): boolean {
    if (this.waiters.length === 0) return false;
    const r = RANK[cls];
    const t = this.clock();
    // A waiter of the holder's own class gets a turn once it has waited a little (a stream does not stop for every job).
    for (const w of this.waiters) {
      if (this.held(w, t)) continue;
      if (w.cls === cls ? t - w.since >= FAIR_MS : this.effectiveRank(w, t) < r) return true;
    }
    return false;
  }

  /** Hand free slots to waiters, most urgent (with aging) and oldest first. */
  private pump(): void {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (;;) {
        if (this.waiters.length === 0) return;
        const t = this.clock();
        let best = -1;
        let bestRank = Infinity;
        for (let i = 0; i < this.waiters.length; i++) {
          const w = this.waiters[i] as Waiter;
          if (this.held(w, t)) continue;
          const r = this.effectiveRank(w, t);
          if (r < bestRank) {
            best = i;
            bestRank = r;
          }
        }
        if (best < 0) return;
        const w = this.waiters[best] as Waiter;
        if (!this.canStart(w.cls)) {
          // The most urgent waiter has no slot: nothing less urgent starts before it, except under the reserve rule
          // (a load waiter may start while a bake waiter is held back by the reserve).
          if (!RESERVED.has(w.cls) || this.busy >= this.budget) return;
          const other = this.firstStartable(t);
          if (other < 0) return;
          this.take(other);
          continue;
        }
        this.take(best);
      }
    } finally {
      this.pumping = false;
    }
  }

  private firstStartable(t: number): number {
    let best = -1;
    let bestRank = Infinity;
    for (let i = 0; i < this.waiters.length; i++) {
      const w = this.waiters[i] as Waiter;
      if (RESERVED.has(w.cls) || this.held(w, t) || !this.canStart(w.cls)) continue;
      const r = this.effectiveRank(w, t);
      if (r < bestRank) {
        best = i;
        bestRank = r;
      }
    }
    return best;
  }

  private take(i: number): void {
    const w = this.waiters.splice(i, 1)[0] as Waiter;
    this.stats[w.cls].queued--;
    if (w.signal && w.onAbort) w.signal.removeEventListener('abort', w.onAbort);
    w.resolve(this.grant(w.cls, w.since));
  }

  private armPauseTimer(until: number): void {
    if (this.pauseTimer !== null && this.pauseTimerAt <= until) return;
    if (this.pauseTimer !== null) clearTimeout(this.pauseTimer);
    this.pauseTimerAt = until;
    this.pauseTimer = setTimeout(() => this.onPauseTimer(), Math.max(0, until - this.clock()) + 1);
  }

  private onPauseTimer(): void {
    this.pauseTimer = null;
    this.pauseTimerAt = Infinity;
    const t = this.clock();
    let next = Infinity;
    for (const [reason, until] of this.pauses) {
      if (until === Infinity) continue;
      if (until <= t) {
        this.pauses.delete(reason);
        this.pauseSince.delete(reason);
      } else next = Math.min(next, until);
    }
    if (next < Infinity) this.armPauseTimer(next);
    this.pump();
  }
}

const KEY = '__aetherWorkerScheduler';

/** The page's scheduler (one per realm, shared by every bundle that imports this module). */
export function workerScheduler(): WorkerScheduler {
  const g = globalThis as Record<string, unknown>;
  let s = g[KEY] as WorkerScheduler | undefined;
  if (!s) {
    s = new WorkerScheduler();
    g[KEY] = s;
    try {
      Object.defineProperty(globalThis, '__aetherWorkers', { configurable: true, get: () => (g[KEY] as WorkerScheduler).snapshot() });
    } catch {
      // a frozen global: no readout
    }
  }
  return s;
}

/**
 * A pool lane's hold on a slot: {@link claim} before giving the lane's worker a job (true: go; false: a token was asked
 * for and `onGrant` runs when it comes), {@link release} when the worker has nothing left.
 */
export class WorkerSlot {
  private token: WorkToken | null = null;
  private waiting: AbortController | null = null;
  private disposed = false;

  constructor(
    readonly cls: WorkClass,
    private readonly scheduler: WorkerScheduler = workerScheduler(),
  ) {}

  get held(): boolean {
    return this.token !== null;
  }

  /** The holder should stop feeding its worker and release once it drains. */
  get mustYield(): boolean {
    return this.token?.yieldRequested ?? false;
  }

  claim(onGrant: () => void): boolean {
    if (this.token) return true;
    if (this.disposed) return false;
    const t = this.scheduler.tryAcquire(this.cls);
    if (t) {
      this.token = t;
      return true;
    }
    if (!this.waiting) {
      const ac = new AbortController();
      this.waiting = ac;
      this.scheduler.acquire(this.cls, ac.signal).then(
        (tok) => {
          if (this.waiting === ac) this.waiting = null;
          if (this.disposed || this.token) {
            tok.release();
            return;
          }
          this.token = tok;
          onGrant();
        },
        () => {
          if (this.waiting === ac) this.waiting = null;
        },
      );
    }
    return false;
  }

  /** Give the slot back, and stop waiting for one. */
  release(): void {
    if (this.waiting) {
      const ac = this.waiting;
      this.waiting = null;
      ac.abort();
    }
    const t = this.token;
    this.token = null;
    t?.release();
  }

  dispose(): void {
    this.disposed = true;
    this.release();
  }
}

/** A worker as the page uses it (the subset {@link gateWorker} wraps). */
export interface GateableWorker {
  postMessage(message: unknown, transfer?: Transferable[] | StructuredSerializeOptions): void;
  terminate(): void;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  onmessageerror?: ((e: MessageEvent) => void) | null;
  addEventListener(type: string, listener: (e: Event) => void, opts?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: string, listener: (e: Event) => void, opts?: boolean | EventListenerOptions): void;
}

/**
 * Put a request/reply worker under the budget: messages wait for a slot of `cls` before they are posted, the slot is
 * held while replies are outstanding and given back when the last comes (or the worker fails or is terminated).
 * `isReply` tells replies from progress messages (default: every message answers one request). With the scheduler
 * off it returns the worker unchanged.
 */
export function gateWorker<W extends GateableWorker>(worker: W, cls: WorkClass, isReply: (data: unknown) => boolean = () => true): W {
  if (!workerSchedulerEnabled()) return worker;
  const slot = new WorkerSlot(cls);
  const post = worker.postMessage.bind(worker);
  const terminate = worker.terminate.bind(worker);
  const queue: Array<[unknown, Transferable[] | StructuredSerializeOptions | undefined]> = [];
  let outstanding = 0;
  let dead = false;
  let failure: unknown = null;
  const flush = (): void => {
    while (!dead && queue.length > 0) {
      // A stream of requests yields between replies when more urgent work waits.
      if (outstanding > 0 && slot.mustYield) return;
      if (!slot.claim(flush)) return;
      const [m, t] = queue.shift() as [unknown, Transferable[] | undefined];
      outstanding++;
      try {
        post(m, t as Transferable[]);
      } catch (e) {
        // Thrown to the caller when it posted the message itself (see postMessage below); a late one is dropped.
        outstanding--;
        failure = e;
      }
    }
    if (outstanding === 0 && queue.length === 0) slot.release();
  };
  const settle = (e: Event): void => {
    if (dead) return;
    if (e.type === 'message') {
      if (!isReply((e as MessageEvent).data)) return;
      if (outstanding > 0) outstanding--;
    } else outstanding = 0;
    if (outstanding === 0) slot.release();
    flush();
  };
  // Added before the client sets its handlers, so these run first: a reply's handler that posts the next request finds the slot free.
  worker.addEventListener('message', settle);
  worker.addEventListener('error', settle);
  worker.addEventListener('messageerror', settle);
  worker.postMessage = ((m: unknown, t?: Transferable[] | StructuredSerializeOptions) => {
    if (dead) return post(m, t as Transferable[]);
    queue.push([m, t]);
    failure = null;
    flush();
    const f = failure;
    failure = null;
    if (f !== null) throw f;
  }) as W['postMessage'];
  worker.terminate = () => {
    dead = true;
    queue.length = 0;
    outstanding = 0;
    slot.dispose();
    terminate();
  };
  return worker;
}
