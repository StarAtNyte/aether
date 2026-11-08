/**
 * "Render video" for a world's short film (`world.story`): the film rendered offline, frame by frame at a fixed timestep,
 * never tied to real time.
 *
 * - Picture: a story runner on a fixed film clock drives the camera, the people, the grade and the hour exactly as the
 *   live film's does; each frame goes through the renderer's exclusive capture session at 1920×1080 on the top tier with
 *   the live film's post layer (vignette and compositing included). The capture steps the characters, water, weather,
 *   environment and eye adaptation by the frame's dt; the renderer's fixed clock (`setFixedClock`) replaces the wall
 *   clock of the compositing layer and of the node frame's `time` (foliage sway); adaptive resolution and the
 *   performance governor do not run (the capture owns the frame, the tier is chosen, not automatic). The overlay (bars,
 *   titles, captions, end card, fades) is painted onto the frame (`film-overlay.ts`).
 * - Sound: the same procedural graph (`story-audio.ts`) on an `OfflineAudioContext`, driven at every frame time by a
 *   second story runner on the same clock, so cues, ambience and one-shot sounds land on the picture's frames.
 * - Encoding: WebCodecs (`VideoEncoder` H.264 into MP4 or VP9 into WebM, `AudioEncoder` Opus) and the studio's own MP4 /
 *   WebM writers (`publish/video/mp4.ts`, `webm.ts`). Without WebCodecs: MediaRecorder on the composited canvas's stream,
 *   in real time, with the offline sound played into the recording.
 */
import type { Story, WorldDoc } from '@aether/core';
import type { RenderTier, WorldRenderer } from '@aether/render';
import { abortError, chooseVideoCodec, drain, encodeOpus, RECORDER_TYPES, videoBitrate, type Choice, type VideoFormat } from '../publish/video/export';
import { Mp4Muxer } from '../publish/video/mp4';
import { WebmMuxer } from '../publish/video/webm';
import { FilmOverlay } from './film-overlay';
import { audioStops, FILM_AUDIO_FADE_SECONDS, FILM_SIZE, filmMuxPlan, filmSeconds, frameSchedule, type FilmFps } from './film-schedule';
import { shotStarts } from './story';
import { StoryAudio } from './story-audio';
import { StoryRunner } from './story-runner';

/** Sample rate of the film's sound. */
export const FILM_SAMPLE_RATE = 48_000;

export interface FilmProgress {
  phase: 'preparing' | 'sound' | 'rendering' | 'encoding' | 'muxing';
  frame: number;
  frames: number;
}

export interface FilmExportOptions {
  fps: FilmFps;
  format?: VideoFormat;
  /** The player's volume and music levels (default 1). */
  volume?: number;
  music?: number;
  /** The tier the film renders on (default the top one, `ultra`). */
  tier?: RenderTier;
  signal?: AbortSignal;
  onProgress?: (p: FilmProgress) => void;
  /** The composited canvas (a preview while rendering). */
  onCanvas?: (canvas: HTMLCanvasElement) => void;
}

export interface FilmResult {
  blob: Blob;
  mime: string;
  ext: 'mp4' | 'webm';
  codec: string;
  width: number;
  height: number;
  fps: number;
  seconds: number;
  frames: number;
  audio: boolean;
  method: 'webcodecs' | 'mediarecorder';
  /** Wall time of the render (ms). */
  ms: number;
}

type RunnerRenderer = ConstructorParameters<typeof StoryRunner>[0];

/** A renderer that draws nothing: the sound pass's runner (cues and sounds only). */
const SILENT: RunnerRenderer = {
  lookAt: () => undefined,
  applyTransforms: () => undefined,
  raycastWorld: () => null,
  setEnvironmentOverride: () => undefined,
  restoreEnvironment: () => undefined,
  stopTour: () => undefined,
} as unknown as RunnerRenderer;

/** The film's running time (s): its shots and, with an end card, the end card's hold and hand-over. */
export function storyFilmSeconds(story: Story): number {
  const starts = shotStarts(story);
  return filmSeconds(starts[starts.length - 1] ?? 0, !!story.endCard);
}

/**
 * The film's sound: the story's score, ambience and one-shot sounds rendered through an `OfflineAudioContext`. The
 * context stops every `step` seconds (the frame grid), where a story runner at that time sends the cues and fires the
 * sounds it passed, then the score is scheduled ahead, as the live player's timer does. Deterministic: the same story
 * renders the same samples. Null where offline audio is missing.
 */
export async function renderFilmAudio(world: WorldDoc, story: Story, seconds: number, opts: { step: number; sampleRate?: number; volume?: number; music?: number }): Promise<AudioBuffer | null> {
  const Ctor = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
  if (!Ctor) return null;
  const sampleRate = opts.sampleRate ?? FILM_SAMPLE_RATE;
  const ctx = new Ctor({ numberOfChannels: 2, length: Math.max(1, Math.ceil(seconds * sampleRate)), sampleRate });
  const audio = StoryAudio.offline(ctx, { volume: opts.volume ?? 1, music: opts.music ?? 1, muted: false });
  let clock = 0;
  const runner = new StoryRunner(SILENT, world, story, { audio, onOverlay: () => undefined, now: () => clock * 1000 });
  let faded = false;
  const run = (t: number): void => {
    clock = t;
    runner.step();
    audio.tick();
    if (!faded && t >= seconds - FILM_AUDIO_FADE_SECONDS) {
      faded = true;
      audio.fadeOut(FILM_AUDIO_FADE_SECONDS);
    }
  };
  run(0);
  for (const t of audioStops(seconds, opts.step, sampleRate)) {
    void ctx.suspend(t).then(() => {
      run(t);
      return ctx.resume();
    });
  }
  return ctx.startRendering();
}

/** The live renderer behind the film's runner: its camera calls become the capture's pose; the rest goes through. */
function filmRenderer(r: WorldRenderer, pose: { pos: [number, number, number]; target: [number, number, number]; fov: number; roll: number }): RunnerRenderer {
  return {
    lookAt: (pos: [number, number, number], target: [number, number, number], fov?: number, roll?: number) => {
      pose.pos = [pos[0], pos[1], pos[2]];
      pose.target = [target[0], target[1], target[2]];
      if (fov !== undefined && Number.isFinite(fov)) pose.fov = fov;
      pose.roll = roll !== undefined && Number.isFinite(roll) ? roll : 0;
    },
    applyTransforms: (p: Float32Array, ids: readonly string[]) => r.applyTransforms(p, ids as string[]),
    raycastWorld: (...a: Parameters<WorldRenderer['raycastWorld']>) => r.raycastWorld(...a),
    setEnvironmentOverride: (...a: Parameters<WorldRenderer['setEnvironmentOverride']>) => r.setEnvironmentOverride(...a),
    restoreEnvironment: () => r.restoreEnvironment(),
    stopTour: () => r.stopTour(),
    modelColliders: (id: string) => r.modelColliders(id),
    setShotGrade: (g: Parameters<WorldRenderer['setShotGrade']>[0]) => r.setShotGrade(g),
    characterRig: (id: string) => r.characterRig(id),
  } as unknown as RunnerRenderer;
}

/**
 * The film's camera at frame `frame` (the pose the export renders it with), stepped from the start on the frame grid
 * without drawing: probes compare it with the live film's.
 */
export function filmCameraAt(renderer: WorldRenderer, world: WorldDoc, frame: number, fps: number): { pos: number[]; target: number[]; fov: number; roll: number } {
  const story = world.story;
  if (!story) throw new Error('this world has no film');
  const pose = { pos: [0, 0, 0] as [number, number, number], target: [0, 0, -1] as [number, number, number], fov: 50, roll: 0 };
  const rec = filmRenderer(renderer, pose) as unknown as Record<string, unknown>;
  let clock = 0;
  const runner = new StoryRunner({ ...rec, applyTransforms: () => undefined, setShotGrade: () => undefined, setEnvironmentOverride: () => undefined, restoreEnvironment: () => undefined, characterRig: () => null } as unknown as RunnerRenderer, world, story, { onOverlay: () => undefined, now: () => clock * 1000, audio: null });
  runner.prepare();
  for (let i = 0; i <= frame; i++) {
    clock = i / fps;
    runner.step();
  }
  return pose;
}

/** Render and encode the world's film (see module docs). The caller stops the live film first and starts it again after. */
export async function exportStoryFilm(renderer: WorldRenderer, world: WorldDoc, opts: FilmExportOptions): Promise<FilmResult> {
  const story = world.story;
  if (!story) throw new Error('this world has no film');
  const started = performance.now();
  const { width, height } = FILM_SIZE;
  const sched = frameSchedule(storyFilmSeconds(story), opts.fps);
  const { fps, frames, seconds } = sched;
  const signal = opts.signal;
  const report = (phase: FilmProgress['phase'], frame: number): void => opts.onProgress?.({ phase, frame, frames });
  report('preparing', 0);
  if (signal?.aborted) throw abortError();
  const choice = await chooseVideoCodec(width, height, fps, opts.format ?? 'auto');
  report('sound', 0);
  let sound: AudioBuffer | null = null;
  try {
    sound = await renderFilmAudio(world, story, seconds, { step: 1 / fps, volume: opts.volume, music: opts.music });
  } catch {
    sound = null;
  }
  if (signal?.aborted) throw abortError();
  const audio = sound && choice ? await encodeOpus(sound, signal, 160_000).catch(() => null) : null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  opts.onCanvas?.(canvas);
  const image = ctx.createImageData(width, height);
  const overlay = new FilmOverlay(story, world.name);

  const prevTier = renderer.renderTierChoice;
  renderer.setRenderTier(opts.tier ?? 'ultra');
  renderer.stopTour();
  await renderer.preparePost();
  renderer.setFixedClock(0, 0);
  const pose = { pos: [0, 0, 0] as [number, number, number], target: [0, 0, -1] as [number, number, number], fov: 50, roll: 0 };
  let clock = 0;
  const runner = new StoryRunner(filmRenderer(renderer, pose), world, story, { onOverlay: () => undefined, now: () => clock * 1000, audio: null });
  runner.prepare();
  const session = renderer.beginCapture(width, height, { vignette: true });
  /** Pose the world at frame `i` and paint the frame (picture and overlay) into the canvas. */
  const paint = async (i: number, t: number, dt: number): Promise<void> => {
    clock = t;
    const frame = runner.step();
    overlay.update(frame, t);
    renderer.setFixedClock(t, dt);
    const px = await session.frame(pose, { dt });
    image.data.set(px);
    ctx.putImageData(image, 0, 0);
    overlay.draw(ctx, width, height, t);
    report('rendering', i + 1);
  };
  try {
    if (!choice) return await recordFilm(canvas, sound, sched, paint, signal, started);
    return await encodeFilm(choice, canvas, audio, sched, paint, signal, () => report('encoding', frames), () => report('muxing', frames), started);
  } finally {
    runner.dispose();
    session.end();
    renderer.setFixedClock(null);
    renderer.setRenderTier(prevTier);
  }
}

/** The WebCodecs path: every frame encoded as it is painted (back-pressure on the queue), then muxed with the sound. */
async function encodeFilm(
  choice: Choice,
  canvas: HTMLCanvasElement,
  audio: Awaited<ReturnType<typeof encodeOpus>>,
  sched: ReturnType<typeof frameSchedule>,
  paint: (i: number, t: number, dt: number) => Promise<void>,
  signal: AbortSignal | undefined,
  onEncoding: () => void,
  onMuxing: () => void,
  started: number,
): Promise<FilmResult> {
  const { width, height } = canvas;
  const { fps, frames, seconds } = sched;
  let failure: unknown = null;
  let avcC: Uint8Array | null = null;
  const encoded: Array<{ timestampUs: number; durationUs: number; key: boolean; data: Uint8Array }> = [];
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      encoded.push({ timestampUs: chunk.timestamp, durationUs: chunk.duration ?? Math.round(1e6 / fps), key: chunk.type === 'key', data });
      const desc = meta?.decoderConfig?.description;
      if (desc && !avcC) avcC = desc instanceof ArrayBuffer ? new Uint8Array(desc.slice(0)) : new Uint8Array((desc as ArrayBufferView).buffer.slice((desc as ArrayBufferView).byteOffset, (desc as ArrayBufferView).byteOffset + (desc as ArrayBufferView).byteLength));
    },
    error: (e) => {
      failure = e;
    },
  });
  encoder.configure({
    codec: choice.codec,
    width,
    height,
    bitrate: videoBitrate(width, height, fps),
    framerate: fps,
    latencyMode: 'quality',
    ...(choice.container === 'mp4' ? { avc: { format: 'avc' as const } } : {}),
  });
  const keyEvery = fps * 2;
  try {
    for (let i = 0; i < frames; i++) {
      if (signal?.aborted) throw abortError();
      if (failure) throw failure instanceof Error ? failure : new Error('the video encoder failed');
      await paint(i, sched.time(i), sched.dt(i));
      const frame = new VideoFrame(canvas, { timestamp: sched.timestampUs(i), duration: sched.durationUs(i) });
      try {
        encoder.encode(frame, { keyFrame: i % keyEvery === 0 });
      } finally {
        frame.close();
      }
      await drain(encoder, 4, signal);
    }
    onEncoding();
    await encoder.flush();
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
  if (failure) throw failure instanceof Error ? failure : new Error('the video encoder failed');
  if (signal?.aborted) throw abortError();
  onMuxing();
  const plan = filmMuxPlan(choice, audio !== null);
  let bytes: Uint8Array;
  const track = audio ? { sampleRate: audio.sampleRate, channels: 2, preSkip: audio.preSkip } : null;
  if (choice.container === 'mp4') {
    if (!avcC) throw new Error('the H.264 encoder did not describe its stream');
    const mux = new Mp4Muxer({ width, height, avcC, frameRate: fps }, track);
    for (const c of encoded) mux.addVideo(c);
    for (const c of audio?.chunks ?? []) mux.addAudio({ ...c, key: true });
    bytes = mux.finalize();
  } else {
    const mux = new WebmMuxer({ codec: choice.id, width, height, frameRate: fps }, track);
    for (const c of encoded) mux.addVideo(c);
    for (const c of audio?.chunks ?? []) mux.addAudio({ ...c, key: true });
    bytes = mux.finalize(Math.round(seconds * 1e6));
  }
  return {
    blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: plan.mime }),
    mime: plan.mime,
    ext: plan.ext,
    codec: choice.codec,
    width,
    height,
    fps,
    seconds,
    frames,
    audio: audio !== null,
    method: 'webcodecs',
    ms: performance.now() - started,
  };
}

/**
 * The fallback without WebCodecs: MediaRecorder on the canvas's stream. A recorder samples in real time, so the film
 * plays at its own speed (frames come as fast as they render; a slow device shows fewer of them, the length stays right),
 * with the offline sound played into the recording from its start.
 */
async function recordFilm(
  canvas: HTMLCanvasElement,
  sound: AudioBuffer | null,
  sched: ReturnType<typeof frameSchedule>,
  paint: (i: number, t: number, dt: number) => Promise<void>,
  signal: AbortSignal | undefined,
  started: number,
): Promise<FilmResult> {
  if (typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') throw new Error('This browser cannot encode video (no WebCodecs and no MediaRecorder).');
  const { fps, frames, seconds } = sched;
  const mime = RECORDER_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
  const stream = canvas.captureStream(fps);
  let ac: AudioContext | null = null;
  let src: AudioBufferSourceNode | null = null;
  if (sound && typeof AudioContext !== 'undefined') {
    ac = new AudioContext({ sampleRate: sound.sampleRate });
    const dest = ac.createMediaStreamDestination();
    src = ac.createBufferSource();
    src.buffer = sound;
    src.connect(dest);
    for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);
  }
  const recorder = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: videoBitrate(canvas.width, canvas.height, fps) });
  const parts: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) parts.push(e.data);
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });
  // The first frame before the clock starts (the recorder opens on it).
  await paint(0, 0, 0);
  recorder.start(1000);
  await ac?.resume();
  src?.start();
  const t0 = performance.now();
  let last = 0;
  let drawn = 1;
  try {
    for (;;) {
      if (signal?.aborted) throw abortError();
      const t = (performance.now() - t0) / 1000;
      if (t >= seconds) break;
      await paint(Math.min(frames - 1, Math.round(t * fps)), t, Math.max(0, t - last));
      last = t;
      drawn++;
      const wait = t0 + ((Math.floor(t * fps) + 1) * 1000) / fps - performance.now();
      if (wait > 1) await new Promise((r) => setTimeout(r, wait));
    }
  } finally {
    if (recorder.state !== 'inactive') recorder.stop();
    src?.stop();
    void ac?.close();
    for (const t of stream.getTracks()) t.stop();
  }
  await stopped;
  if (signal?.aborted) throw abortError();
  const type = recorder.mimeType || mime || 'video/webm';
  const ext = type.includes('mp4') ? 'mp4' : 'webm';
  return { blob: new Blob(parts, { type }), mime: type, ext, codec: type, width: canvas.width, height: canvas.height, fps, seconds, frames: drawn, audio: sound !== null, method: 'mediarecorder', ms: performance.now() - started };
}
