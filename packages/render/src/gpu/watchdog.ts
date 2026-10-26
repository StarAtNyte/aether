/**
 * Black-screen watchdog (pure, unit-tested): decides when the viewport has shown nothing for too long and what to
 * give up next.
 *
 * A viewport can stay black without any error: a driver that links a program wrongly, a post chain that writes
 * nothing, a frame loop that never gets going on a machine that cannot keep up. The watchdog looks at two facts only:
 * whether frames are being drawn, and whether a tiny read-back of the drawn image is one flat dark colour. It does
 * not judge the picture beyond that. When either fact says "nothing to see" for long enough it names the next step
 * of {@link WATCHDOG_STEPS}; the renderer applies it and the clock starts over. A single sample that shows an
 * image ends the watch.
 */

/** What the watchdog asks for, in order, each one cheaper and plainer than the one before. */
export const WATCHDOG_STEPS = Object.freeze(['low-tier', 'no-effects', 'simple-materials', 'minimal'] as const);
export type WatchdogStep = (typeof WATCHDOG_STEPS)[number];

/** Why a step was taken. */
export type WatchdogReason = 'no-frame' | 'black-frame';

/** Tunables of {@link BlackScreenWatchdog} (milliseconds). */
export const WATCHDOG_DEFAULTS = Object.freeze({
  /** No frame drawn this long after the world was handed over (the load hold alone may take 20 s). */
  firstFrameMs: 35_000,
  /** The same wait after a step has been taken. */
  stepFrameMs: 12_000,
  /** Time between read-backs (each one waits for the GPU). */
  sampleEveryMs: 1_200,
  /** Dark read-backs in a row that count as a black view. */
  darkSamples: 3,
  /** The watch ends this long after it began, healthy or not. */
  giveUpMs: 240_000,
});

/** Tunables as numbers. */
export type WatchdogOptions = { [K in keyof typeof WATCHDOG_DEFAULTS]: number };

/** A read-back of the viewport reduced to a few numbers. */
export interface FrameSample {
  /** Mean Rec.709 luminance, 0..255. */
  mean: number;
  /** Largest minus smallest luminance. */
  spread: number;
  /** Share of texels above 245 (the exposure trim reads this; the watchdog does not). */
  high?: number;
  /** Share of texels below 14. */
  low?: number;
}

/** Reduce RGBA bytes (any size) to {@link FrameSample}. */
export function measureFrame(rgba: ArrayLike<number>): FrameSample {
  let sum = 0;
  let lo = 255;
  let hi = 0;
  let bright = 0;
  let dark = 0;
  const n = Math.floor(rgba.length / 4);
  for (let i = 0; i < n; i++) {
    const l = 0.2126 * (rgba[i * 4] as number) + 0.7152 * (rgba[i * 4 + 1] as number) + 0.0722 * (rgba[i * 4 + 2] as number);
    sum += l;
    if (l < lo) lo = l;
    if (l > hi) hi = l;
    if (l > 245) bright++;
    if (l < 14) dark++;
  }
  return n === 0 ? { mean: 0, spread: 0 } : { mean: sum / n, spread: hi - lo, high: bright / n, low: dark / n };
}

/** One flat colour that is dark: what a view that drew nothing looks like. */
export function isBlackFrame(s: FrameSample): boolean {
  return s.spread <= 2 && s.mean < 12;
}

/** What the watchdog decided. */
export interface WatchdogAction {
  step: WatchdogStep | 'exhausted';
  reason: WatchdogReason;
  /** 1-based number of this step (the count of steps taken, including this one). */
  taken: number;
  /** One honest sentence for the user. */
  message: string;
}

/** The clock and the evidence of one watch. */
export class BlackScreenWatchdog {
  private readonly o: WatchdogOptions;
  private begunAt = -1;
  private since = 0;
  private framesAtStep = 0;
  private lastSample = -Infinity;
  private dark = 0;
  private taken = 0;
  private over = false;
  private lastTick = 0;
  private waiting = false;
  /** An image was seen. */
  healthy = false;
  /** Last read-back (diagnostics). */
  last: FrameSample | null = null;

  constructor(opts: Partial<WatchdogOptions> = {}) {
    this.o = { ...WATCHDOG_DEFAULTS, ...opts };
  }

  /** Start the clock (the first world was handed to the renderer). Later calls do nothing. */
  begin(now: number, frames: number): void {
    if (this.begunAt >= 0) return;
    this.begunAt = now;
    this.since = now;
    this.lastSample = now;
    this.lastTick = now;
    this.framesAtStep = frames;
  }

  /** The watch is over (an image was seen, every step was spent, or it ran out of time). */
  get finished(): boolean {
    return this.over || this.healthy;
  }

  /** Steps taken so far. */
  get stepsTaken(): number {
    return this.taken;
  }

  /** True when {@link tick} wants a read-back of the frame just drawn. */
  wantsSample(now: number, frames: number): boolean {
    return this.begunAt >= 0 && !this.finished && frames > this.framesAtStep && now - this.lastSample >= this.o.sampleEveryMs;
  }

  /**
   * Advance the watch. `frames` counts frames drawn so far; `sample` is the read-back of the frame just drawn (null when
   * none was taken). Returns the next step when one is due.
   * `preparing` pauses no-frame and give-up clocks while the host intentionally holds drawing for CPU preparation.
   */
  tick(now: number, frames: number, sample: FrameSample | null, preparing = false): WatchdogAction | null {
    if (this.begunAt < 0 || this.finished) return null;
    if (preparing || this.waiting) {
      const elapsed = Math.max(0, now - this.lastTick);
      this.begunAt += elapsed; this.since += elapsed;
    }
    this.lastTick = now; this.waiting = preparing;
    if (preparing) return null;
    if (now - this.begunAt > this.o.giveUpMs) {
      this.over = true;
      return null;
    }
    if (sample) {
      this.lastSample = now;
      this.last = sample;
      if (!isBlackFrame(sample)) {
        this.healthy = true;
        return null;
      }
      if (++this.dark >= this.o.darkSamples) return this.step(now, frames, 'black-frame');
      return null;
    }
    if (frames <= this.framesAtStep && now - this.since >= (this.taken === 0 ? this.o.firstFrameMs : this.o.stepFrameMs)) return this.step(now, frames, 'no-frame');
    return null;
  }

  private step(now: number, frames: number, reason: WatchdogReason): WatchdogAction {
    this.taken++;
    this.dark = 0;
    this.since = now;
    this.lastSample = now;
    this.framesAtStep = frames;
    const step = WATCHDOG_STEPS[this.taken - 1];
    if (!step) {
      this.over = true;
      return { step: 'exhausted', reason, taken: this.taken, message: 'The viewport is still blank after every simpler graphics mode. Copy the diagnostics and send them with a report.' };
    }
    const what = reason === 'no-frame' ? 'No picture was drawn' : 'The picture came out black';
    return { step, reason, taken: this.taken, message: `${what}; ${STEP_TEXT[step]}` };
  }
}

const STEP_TEXT: Record<WatchdogStep, string> = {
  'low-tier': 'switched to the lowest graphics tier.',
  'no-effects': 'turned off post effects, baked room light and cascaded shadows.',
  'simple-materials': 'drawing everything with plain materials.',
  minimal: 'shadows off and resolution halved.',
};

/** A line the GPU stack printed that matters for a blank view. */
export interface GpuLogLine {
  at: number;
  level: 'warn' | 'error';
  text: string;
}

/** Shader and program trouble as three and the drivers phrase it. */
const SHADER_TROUBLE = /shader|program|compil|link(ing|ed)?\b|GLSL|WGSL|framebuffer|incomplete|context lost|INVALID_OPERATION|VALIDATE_STATUS/i;

/** True for a console line that reports a shader compile or program link failure (not a driver performance hint). */
export function isShaderFailure(text: string): boolean {
  if (!SHADER_TROUBLE.test(text)) return false;
  if (/performance|deprecated|lazy initialization|premult|implementation-defined|GPU stall|ReadPixels/i.test(text)) return false;
  return /error|fail|invalid|could not|cannot|not complete|incomplete|lost/i.test(text);
}

/**
 * A ring of the GPU-related lines of the console (warnings and errors), kept for the diagnostics and to notice a shader
 * or link failure as it happens. Wraps `console.warn` and `console.error` once; the original still prints.
 */
export class GpuLogCapture {
  readonly lines: GpuLogLine[] = [];
  /** Shader or link failures seen. */
  shaderFailures = 0;
  /** The first such failure (text). */
  firstShaderFailure: string | null = null;
  /** Told about each shader failure (once per distinct text). */
  onShaderFailure: ((text: string) => void) | null = null;
  private readonly seen = new Set<string>();

  constructor(private readonly limit = 60) {}

  /** Record one console line. */
  push(level: 'warn' | 'error', args: readonly unknown[], at = Date.now()): void {
    const text = args
      .map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.message : safeJson(a)))
      .join(' ')
      .slice(0, 600);
    // The diagnostics report itself is logged through the console: never feed it back into the next report.
    if (/graphics diagnostics/i.test(text)) return;
    const failure = isShaderFailure(text);
    const gpu = failure || /webgl|three|aether\/render|texture|gpu|context/i.test(text);
    if (!gpu) return;
    const key = text.slice(0, 160);
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.lines.push({ at, level, text });
    if (this.lines.length > this.limit) this.lines.shift();
    if (failure) {
      this.shaderFailures++;
      this.firstShaderFailure ??= text;
      try {
        this.onShaderFailure?.(text);
      } catch {
        /* a listener must not break logging */
      }
    }
  }

  /** Wrap the console (idempotent per instance). Returns the function that undoes it. */
  install(target: Pick<Console, 'warn' | 'error'> = console): () => void {
    const warn = target.warn;
    const error = target.error;
    target.warn = (...a: unknown[]) => {
      this.push('warn', a);
      warn.apply(target, a as []);
    };
    target.error = (...a: unknown[]) => {
      this.push('error', a);
      error.apply(target, a as []);
    };
    return () => {
      target.warn = warn;
      target.error = error;
    };
  }
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}
