/**
 * Hooks for the `?perf=1` diagnostic overlay (apps/studio/src/player/perf/): spans around the work that can freeze a frame
 * (a model swap, a texture upload, a program link, a lip-sync decode, a card mount). Without a sink every hook is one null
 * check; `pb()` returns 0 and `pe()` returns at once, so the normal player pays nothing measurable.
 *
 * Spans nest (a swap that uploads a texture): each span reports its own time, its children's removed ("self").
 */
export interface PerfSink {
  /** A synchronous span ended: `t0`..`t1` (performance.now), `self` ms not spent in nested spans. */
  span(kind: string, t0: number, t1: number, self: number, detail?: string): void;
  /** An asynchronous job (not blocking by itself) started (+1) or ended (-1). */
  job(kind: string, delta: 1 | -1): void;
}

let sink: PerfSink | null = null;
let depth = 0;
const child: number[] = [0];

/** Install (or remove) the sink; the overlay does it once. */
export function setPerfSink(s: PerfSink | null): void {
  sink = s;
  depth = 0;
}

/** The overlay is on. */
export function perfOn(): boolean {
  return sink !== null;
}

/** Begin a span: its start time, or 0 when the overlay is off. */
export function pb(): number {
  if (!sink) return 0;
  child[++depth] = 0;
  return performance.now();
}

/** End the span begun by `pb()` (`t0` 0: nothing). */
export function pe(kind: string, t0: number, detail?: string): void {
  if (t0 === 0 || !sink) return;
  const t1 = performance.now();
  const dur = t1 - t0;
  const self = Math.max(0, dur - (child[depth] ?? 0));
  depth = Math.max(0, depth - 1);
  child[depth] = (child[depth] ?? 0) + dur;
  sink.span(kind, t0, t1, self, detail);
}

/** Begin an asynchronous job; call the result when it ends (a no-op when the overlay is off). */
export function pj(kind: string): () => void {
  const s = sink;
  if (!s) return NOOP;
  s.job(kind, 1);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    s.job(kind, -1);
  };
}
const NOOP = (): void => undefined;
