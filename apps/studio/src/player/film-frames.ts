/**
 * A story film's frames as raw pixels, for the offline footage pipeline (`scripts/demo/render-clean.ts`): the picture
 * path of `exportStoryFilm` (same story runner, same exclusive capture session, same fixed film clock) with nothing
 * encoded here and with sub-frame accumulation. The caller chooses the codec and the bitrate (the pipeline pipes the
 * frames into ffmpeg), so the picture is never squeezed through the in-page encoder's bitrate.
 *
 * Sub-frames: every output frame is the average of N draws, each at its own film time inside the shutter and at its
 * own sub-pixel shift (supersampling: no edge crawl on thin lines, plus motion blur where the camera or the people move).
 */
import type { WorldDoc } from '@aether/core';
import type { RenderTier, WorldRenderer } from '@aether/render';
import { abortError } from '../publish/video/export';
import { filmRenderer, storyFilmSeconds } from './film-export';
import { StoryRunner } from './story-runner';

/** What {@link renderStoryFrames} reports with each finished frame (diagnostics of the capture itself). */
export interface FrameInfo {
  index: number;
  /** Film time of the frame (s). */
  time: number;
  /** Wall time of the frame (ms). */
  ms: number;
  /** The render tier in effect, the performance ladder's level, the adaptive resolution scale. */
  tier: string;
  ladder: number;
  scale: number;
  /** Times the cached sun map was drawn, the eye's exposure (EV), the frames the renderer has drawn. */
  sunDraws: number;
  eyeEv: number;
  drawn: number;
  /** The post effects running for this frame. */
  effects: string;
}

export interface FrameRenderOptions {
  fps: number;
  width: number;
  height: number;
  /** Default `ultra`. */
  tier?: RenderTier;
  /** Sub-frames per output frame, averaged (default 1). */
  subframes?: number;
  /** Shutter as a share of the frame interval (0: every sub-frame at the frame's time, 0.5: 180 degrees); default 0. */
  shutter?: number;
  /** Draws per sub-frame before the readback (temporal anti-aliasing and occlusion converge); default 1. */
  settle?: number;
  /** Frame range delivered (default all of the film). */
  from?: number;
  to?: number;
  /** Frames drawn and dropped before `from` (the world, the sun map and the eye settle on the opening pose); default 0. */
  warmup?: number;
  /** A camera path that replaces the story's camera: keys in film seconds, smoothed and eased (see {@link cameraSampler}). */
  path?: { keys: PathKey[]; sigma?: number; ease?: number };
  /** Post effects forced on or off for the capture (e.g. `{ taa: false }`: no history blending across moments). */
  effects?: Record<string, boolean>;
  /** Called per delivered frame with tight top-down RGBA8 (the buffer is reused: consume it before returning). */
  onFrame: (index: number, rgba: Uint8Array, info: FrameInfo) => Promise<void> | void;
  signal?: AbortSignal;
}

export interface PathKey {
  t: number;
  pos: [number, number, number];
  target: [number, number, number];
  fov: number;
}

/**
 * A camera that moves without micro-jitter or sudden speed changes: the keys (a live drone tour sampled every 100 ms
 * carries the frame-time noise of its recording) are resampled at 120 Hz and low-passed with a Gaussian of `sigma`
 * seconds (default 0.35), then the time is remapped so the camera eases in and out over `ease` seconds (default 0.9:
 * speed ramps linearly from 0 to cruise and back), covering the same path in the same total time.
 */
export function cameraSampler(keys: PathKey[], sigma = 0.35, ease = 0.9): (t: number, total: number) => { pos: [number, number, number]; target: [number, number, number]; fov: number } {
  const ks = [...keys].sort((a, b) => a.t - b.t);
  const t0 = ks[0]!.t;
  const T = Math.max(1e-3, ks[ks.length - 1]!.t - t0);
  const hz = 120;
  const m = Math.max(2, Math.ceil(T * hz) + 1);
  const raw: number[][] = [];
  let j = 0;
  for (let i = 0; i < m; i++) {
    const t = t0 + (i / (m - 1)) * T;
    while (j < ks.length - 2 && ks[j + 1]!.t < t) j++;
    const a = ks[j]!;
    const b = ks[Math.min(j + 1, ks.length - 1)]!;
    const u = b.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : 0;
    const l = (x: number, y: number): number => x + (y - x) * u;
    raw.push([l(a.pos[0], b.pos[0]), l(a.pos[1], b.pos[1]), l(a.pos[2], b.pos[2]), l(a.target[0], b.target[0]), l(a.target[1], b.target[1]), l(a.target[2], b.target[2]), l(a.fov, b.fov)]);
  }
  const rad = Math.max(1, Math.round(sigma * hz * 3));
  const w: number[] = [];
  for (let k = -rad; k <= rad; k++) w.push(Math.exp(-0.5 * (k / (sigma * hz)) ** 2));
  const smooth = raw.map((_, i) => {
    const o = new Array<number>(7).fill(0);
    let sum = 0;
    for (let k = -rad; k <= rad; k++) {
      // Mirror at the ends so the smoothing does not pull the first and last poses inward.
      let q = i + k;
      if (q < 0) q = -q;
      if (q > m - 1) q = 2 * (m - 1) - q;
      q = Math.max(0, Math.min(m - 1, q));
      const wk = w[k + rad]!;
      sum += wk;
      for (let c = 0; c < 7; c++) o[c]! += raw[q]![c]! * wk;
    }
    return o.map((v) => v / sum);
  });
  // Time remap: the camera's speed ramps up over `ease` seconds and down over the last `ease`.
  const e = Math.min(ease, T / 2);
  const speed = (t: number): number => (e <= 0 ? 1 : Math.min(1, t / e, (T - t) / e));
  const steps = 2000;
  const cum: number[] = [0];
  for (let i = 1; i <= steps; i++) cum.push(cum[i - 1]! + speed(((i - 0.5) / steps) * T));
  const total = cum[steps]!;
  return (tt: number) => {
    const t = Math.max(0, Math.min(T, tt - 0));
    const f = (t / T) * steps;
    const i0 = Math.min(steps - 1, Math.floor(f));
    const s = ((cum[i0]! + (cum[i0 + 1]! - cum[i0]!) * (f - i0)) / total) * (m - 1);
    const a = Math.min(m - 2, Math.floor(s));
    const u = s - a;
    const p = smooth[a]!;
    const q = smooth[a + 1]!;
    const l = (c: number): number => p[c]! + (q[c]! - p[c]!) * u;
    return { pos: [l(0), l(1), l(2)], target: [l(3), l(4), l(5)], fov: l(6) };
  };
}

type Probe = { activeEffects: Record<string, boolean>; governor?: { level: number }; adaptive?: { scale: number }; sunMapDraws: number; eyeEv: number; framesDrawn: number; renderTier: string };

/** Sub-pixel shifts from the R2 low-discrepancy sequence: any count of them covers the pixel evenly. */
function shift(k: number): [number, number] {
  return [((0.7548776662 * (k + 1)) % 1) - 0.5, ((0.5698402909 * (k + 1)) % 1) - 0.5];
}

export async function renderStoryFrames(renderer: WorldRenderer, world: WorldDoc, opts: FrameRenderOptions): Promise<{ frames: number; fps: number }> {
  const story = world.story;
  if (!story) throw new Error('this world has no film');
  const { fps, width, height } = opts;
  const frames = Math.max(1, Math.round(storyFilmSeconds(story) * fps));
  const from = Math.max(0, opts.from ?? 0);
  const to = Math.min(frames, opts.to ?? frames);
  const n = Math.max(1, Math.min(64, Math.floor(opts.subframes ?? 1)));
  const span = n > 1 ? Math.max(0, Math.min(1, opts.shutter ?? 0)) / fps : 0;
  const settle = Math.max(1, Math.min(32, Math.floor(opts.settle ?? 1)));
  const warmup = Math.max(0, Math.floor(opts.warmup ?? 0));
  const prevTier = renderer.renderTierChoice;
  renderer.setRenderTier(opts.tier ?? 'ultra');
  renderer.stopTour();
  if (opts.effects) renderer.setEffects(opts.effects);
  await renderer.preparePost();
  renderer.setFixedClock(0, 0);
  const pose = { pos: [0, 0, 0] as [number, number, number], target: [0, 0, -1] as [number, number, number], fov: 50, roll: 0 };
  let clock = 0;
  const runner = new StoryRunner(filmRenderer(renderer, pose), world, story, { onOverlay: () => undefined, now: () => clock * 1000, audio: null });
  runner.prepare();
  const camera = opts.path ? cameraSampler(opts.path.keys, opts.path.sigma, opts.path.ease) : null;
  const session = renderer.beginCapture(width, height, { vignette: true });
  // The capture flags may have resized the sun maps (the post chain rebuilds): wait for it before the first draw.
  await renderer.preparePost();
  const acc = n > 1 ? new Uint32Array(width * height * 4) : null;
  const out = new Uint8Array(width * height * 4);
  const probe = renderer as unknown as Probe;
  let last = 0;
  try {
    // Warm-up: the opening pose drawn `warmup` times at film time of `from` (no time passes), so programs, cells, the
    // sun map, the history buffers and the eye are settled before the first delivered frame.
    const t0From = from / fps;
    for (let w = 0; w < warmup; w++) {
      clock = t0From;
      runner.step();
      if (camera) {
        const c = camera(t0From, 0);
        pose.pos = c.pos;
        pose.target = c.target;
        pose.fov = c.fov;
      }
      renderer.setFixedClock(t0From, 0);
      await session.frame(pose, { dt: w === 0 && from > 0 ? 0 : 0.05, frames: settle });
      if (opts.signal?.aborted) throw abortError();
    }
    last = t0From;
    for (let i = from; i < to; i++) {
      if (opts.signal?.aborted) throw abortError();
      const started = performance.now();
      const tFrame = i / fps;
      for (let s = 0; s < n; s++) {
        const tt = Math.max(0, tFrame - span / 2 + (n > 1 ? ((s + 0.5) / n) * span : 0));
        // Film time never runs back; the world steps by what passed since the last draw (the frame's interval, in pieces).
        const dtStep = i === from && s === 0 ? 0 : Math.max(0, tt - last);
        clock = tt;
        runner.step();
        if (camera) {
          const c = camera(tt, 0);
          pose.pos = c.pos;
          pose.target = c.target;
          pose.fov = c.fov;
          pose.roll = 0;
        }
        renderer.setFixedClock(tt, dtStep);
        const px = await session.frame(pose, { dt: dtStep, frames: settle, ...(n > 1 ? { jitter: shift(i * 7 + s) } : {}) });
        last = tt;
        if (acc) {
          if (s === 0) acc.fill(0);
          for (let k = 0; k < acc.length; k++) acc[k] = (acc[k] as number) + (px[k] as number);
        } else out.set(px);
      }
      if (acc) {
        for (let k = 0; k < out.length; k++) out[k] = Math.round((acc[k] as number) / n);
        for (let k = 3; k < out.length; k += 4) out[k] = 255;
      }
      await opts.onFrame(i, out, {
        index: i,
        time: tFrame,
        ms: performance.now() - started,
        tier: probe.renderTier,
        ladder: probe.governor?.level ?? -1,
        scale: probe.adaptive?.scale ?? -1,
        sunDraws: probe.sunMapDraws,
        eyeEv: Math.round((probe.eyeEv ?? 0) * 1000) / 1000,
        drawn: probe.framesDrawn,
        effects: Object.keys(probe.activeEffects).filter((k) => probe.activeEffects[k]).join(','),
      });
    }
  } finally {
    runner.dispose();
    session.end();
    if (opts.effects) renderer.setEffects({});
    renderer.setFixedClock(null);
    renderer.setRenderTier(prevTier);
  }
  return { frames: to - from, fps };
}

/** Types only: the story format the footage pipeline hands the runner. */
export type { WorldDoc };
