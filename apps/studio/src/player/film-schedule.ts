/**
 * The pure parts of a story film's offline render (`film-export.ts`): how long the film runs, which frame shows which
 * film time and how far each frame steps the world, where the offline audio render stops to drive the score, and which
 * container, mime type and audio codec a chosen video codec goes into. No DOM, no WebCodecs: unit-tested.
 */
import { END_HANDOVER_SECONDS, END_HOLD_SECONDS } from './story';

/** Frame rates a film renders at. */
export const FILM_FPS = [30, 60] as const;
export type FilmFps = (typeof FILM_FPS)[number];

/** The film's frame size (1080p). */
export const FILM_SIZE = Object.freeze({ width: 1920, height: 1080 });

/** Seconds the export keeps after the last shot: the end card's hold and its hand-over to the live last view. */
export const FILM_TAIL_SECONDS = END_HOLD_SECONDS + END_HANDOVER_SECONDS;

/** The sound fades out over the film's last seconds (s). */
export const FILM_AUDIO_FADE_SECONDS = 1.6;

/** Render quantum of WebAudio (frames): an offline context suspends only on its boundaries. */
export const RENDER_QUANTUM = 128;

/** The running time of the exported film: the shots (`storyDuration`) and, with an end card, its tail. */
export function filmSeconds(shotsSeconds: number, endCard: boolean): number {
  const s = Number.isFinite(shotsSeconds) ? Math.max(0, shotsSeconds) : 0;
  return s + (endCard ? FILM_TAIL_SECONDS : 0);
}

/** A frame rate the film renders at (anything else: 30). */
export function filmFps(fps: number): FilmFps {
  return (FILM_FPS as readonly number[]).includes(fps) ? (fps as FilmFps) : 30;
}

/** The film's frames at a fixed timestep: frame `i` shows film time `i / fps` and steps the world by `1 / fps`. */
export interface FrameSchedule {
  fps: FilmFps;
  frames: number;
  seconds: number;
  /** Film time (s) of frame `i`. */
  time(i: number): number;
  /** Seconds the world steps before frame `i` (0 for the first: the film opens on its pose). */
  dt(i: number): number;
  /** Timestamp (µs) of frame `i`, exact on the frame grid (no rounding drift). */
  timestampUs(i: number): number;
  /** Duration (µs) of frame `i` (the gaps between rounded timestamps, so they add up to the film). */
  durationUs(i: number): number;
}

export function frameSchedule(seconds: number, fps: number): FrameSchedule {
  const f = filmFps(fps);
  const s = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const frames = Math.max(1, Math.round(s * f));
  const ts = (i: number): number => Math.round((i * 1e6) / f);
  return {
    fps: f,
    frames,
    seconds: frames / f,
    time: (i) => i / f,
    dt: (i) => (i <= 0 ? 0 : 1 / f),
    timestampUs: ts,
    durationUs: (i) => ts(i + 1) - ts(i),
  };
}

/**
 * Where the offline audio render stops to drive the film (the cues, the ambience, one-shot sounds): every `step` seconds
 * after 0, on render-quantum boundaries (an offline context cannot suspend between them), strictly increasing and inside
 * the film. The sounds of a step fire at that stop, as the live film's fire on the frame that passes them.
 */
export function audioStops(seconds: number, step: number, sampleRate: number): number[] {
  const out: number[] = [];
  if (!(seconds > 0) || !(step > 0) || !(sampleRate > 0)) return out;
  const q = RENDER_QUANTUM / sampleRate;
  let last = 0;
  for (let k = 1; k * step < seconds; k++) {
    const t = Math.round((k * step) / q) * q;
    if (t <= last + 1e-9 || t >= seconds) continue;
    out.push(t);
    last = t;
  }
  return out;
}

/** The video codecs the exporter may pick (see `publish/video/export.ts` `chooseVideoCodec`). */
export type FilmVideoChoice = { container: 'mp4'; codec: string } | { container: 'webm'; codec: string };

/** How the film's streams are muxed. */
export interface FilmMuxPlan {
  container: 'mp4' | 'webm';
  ext: 'mp4' | 'webm';
  mime: string;
  /** The audio track's codec (Opus in both containers: `Opus`/`dOps` in MP4, `A_OPUS` in WebM), null for no audio. */
  audio: 'opus' | null;
  /** The type string a `<video>` checks it can play. */
  type: string;
}

/** The container for a video codec choice and whether an audio track came out of the encoder. */
export function filmMuxPlan(choice: FilmVideoChoice, audio: boolean): FilmMuxPlan {
  const container = choice.container;
  const mime = container === 'mp4' ? 'video/mp4' : 'video/webm';
  return { container, ext: container, mime, audio: audio ? 'opus' : null, type: `${mime}; codecs="${choice.codec}${audio ? ', opus' : ''}"` };
}

/** Bar height (px) of the film's letterbox: a 2.39:1 frame scaled by the story's amount (the player's `.pl-story__bar`). */
export function letterboxBar(width: number, height: number, amount: number): number {
  const a = Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : 1;
  return Math.max(0, (height - width / 2.39) / 2) * a;
}

/** A file name for the film: `<world>-film-<fps>fps.<ext>` in lowercase ASCII. */
export function filmFileName(name: string, fps: number, ext: string): string {
  const slug = name.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().toLowerCase().replace(/[\s_-]+/g, '-').slice(0, 48) || 'film';
  return `${slug}-film-${fps}fps.${ext}`;
}
