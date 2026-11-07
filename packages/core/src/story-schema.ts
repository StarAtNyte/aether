/**
 * A world's short film (additive, optional `world.story`): a shot list the player plays as the default experience of a
 * world published with start mode `story`. Plain JSON, so an agent can author one like any other part of the world.
 *
 * Film grammar, as data:
 * - a shot is a held, moving or panning camera between two poses (`camera` to `cameraTo`), entered by a cut, a fade or a
 *   white flash; durations vary, a held wide shot is a shot with no `cameraTo`;
 * - `caption` is a subtitle line, `title` a large card over the shot (the opening title);
 * - `grade` and `gradeTo` are the shot's colour script (exposure, a soft gradient overlay, glow, grain, the town's lamps),
 *   blended across the shot; `hour` sets the time of day for the shot's dynamic light (a re-lightable bake re-weights,
 *   never re-bakes);
 * - `moves` carry entities along paths over the shot (a person walking or running up a stair, a train passing); a person's
 *   walk or run follows from the speed;
 * - `endCard` closes the film.
 *
 * Nothing here changes physics or the world's entities: the player applies it as runtime poses and post-pass values.
 */
import './zod-config';
import { z } from 'zod';

const V3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'color must be #rrggbb');
const Id = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'ids are lowercase slugs');

/** Most shots in a story. */
export const MAX_STORY_SHOTS = 48;
/** Longest shot (s). */
export const MAX_SHOT_SECONDS = 30;

/** A camera pose of a shot. */
export const StoryCamera = z.object({
  position: V3,
  target: V3,
  /** Vertical field of view in degrees (default: the previous shot's, else 50). */
  fov: z.number().min(8).max(100).optional(),
  /** Dutch tilt: roll about the view axis in degrees (+ clockwise); keep it for the story's turn. */
  roll: z.number().min(-45).max(45).optional(),
});
export type StoryCamera = z.infer<typeof StoryCamera>;

/** A shot's colour script and compositing: post-pass values only (no program changes). */
export const StoryGrade = z.object({
  exposureEv: z.number().min(-3).max(3).optional(),
  saturation: z.number().min(0).max(2).optional(),
  contrast: z.number().min(0.5).max(1.5).optional(),
  /** Warm (+) or cool (−) white balance, −1..1. */
  temperature: z.number().min(-1).max(1).optional(),
  /** The soft gradient overlay a compositor lays over a shot: top and bottom colours and how much of them. */
  gradientTop: Hex.optional(),
  gradientBottom: Hex.optional(),
  gradientAmount: z.number().min(0).max(1).optional(),
  bloom: z.number().min(0).max(3).optional(),
  diffusion: z.number().min(0).max(1).optional(),
  godRays: z.number().min(0).max(1).optional(),
  flare: z.number().min(0).max(1).optional(),
  dust: z.number().min(0).max(1).optional(),
  grain: z.number().min(0).max(1).optional(),
  chroma: z.number().min(0).max(1).optional(),
  vignette: z.number().min(0).max(1).optional(),
  /** The town's lamps, lanterns and windows: 0 off .. 1 on. */
  practicals: z.number().min(0).max(1).optional(),
});
export type StoryGrade = z.infer<typeof StoryGrade>;

/** An entity carried along a path during a shot. */
export const StoryMove = z.object({
  entity: Id,
  /** Points it passes through (world metres); one point places it. */
  path: z.array(V3).min(1).max(64),
  /** Fractions of the shot when the move starts and ends (default the whole shot). */
  start: z.number().min(0).max(1).default(0),
  end: z.number().min(0).max(1).default(1),
  /** `inOut` eases into and out of the move (a person setting off and stopping); `linear` keeps the pace (a train). */
  ease: z.enum(['linear', 'inOut', 'in', 'out']).default('inOut'),
  /** Turn to face the way it moves (default true); `face` turns it toward a point once it stops. */
  orient: z.boolean().default(true),
  face: V3.optional(),
});
export type StoryMove = z.infer<typeof StoryMove>;

/** A one-shot sound of a shot, `at` seconds in (the player's procedural sound set: no files). */
export const StorySound = z.object({
  at: z.number().min(0),
  /** A sound the player synthesizes: `crossing-bell`, `train-pass`, `train-whistle`, `gull`, `steps`, `wind-gust`, `chime`, `heartbeat`. */
  sound: z.string().min(1).max(32),
  gain: z.number().min(0).max(2).default(1),
  /** How long it lasts (s), for sustained sounds (the crossing bell, a train passing). */
  seconds: z.number().min(0).max(30).optional(),
});
export type StorySound = z.infer<typeof StorySound>;

/** A named clip an entity plays during a shot (a person waving), `at` seconds in. */
export const StoryAction = z.object({
  entity: Id,
  at: z.number().min(0),
  clip: z.string().min(1).max(48),
  loop: z.boolean().default(false),
});
export type StoryAction = z.infer<typeof StoryAction>;

/** The ambience bed of a shot (0 silent .. 1 full), blended toward over the shot's first second. */
export const StoryAmbience = z.object({
  wind: z.number().min(0).max(1).optional(),
  waves: z.number().min(0).max(1).optional(),
  cicadas: z.number().min(0).max(1).optional(),
  gulls: z.number().min(0).max(1).optional(),
  town: z.number().min(0).max(1).optional(),
});
export type StoryAmbience = z.infer<typeof StoryAmbience>;

export const StoryShot = z.object({
  name: z.string().min(1).max(60).optional(),
  duration: z.number().min(0.4).max(MAX_SHOT_SECONDS),
  camera: StoryCamera,
  /** Where the camera ends (a dolly, a pan, a crane); absent: a held shot. */
  cameraTo: StoryCamera.optional(),
  ease: z.enum(['linear', 'inOut', 'in', 'out']).default('inOut'),
  /** The camera's target follows this entity (a pan that keeps a running person in frame), offset by `trackOffset`. */
  track: Id.optional(),
  trackOffset: V3.optional(),
  /** Hand-held breath (0..1); keep it 0 except on an impact. */
  shake: z.number().min(0).max(1).default(0),
  /** How the shot begins: a cut, a fade from black, or a white flash. */
  transition: z.enum(['cut', 'fade', 'flash']).default('cut'),
  transitionSeconds: z.number().min(0).max(4).default(0.6),
  /** A subtitle line, shown from `captionAt[0]` to `captionAt[1]` seconds into the shot (default most of the shot). */
  caption: z.string().min(1).max(160).optional(),
  captionAt: z.tuple([z.number().min(0), z.number().min(0)]).optional(),
  /** A large card over the shot (the film's title). */
  title: z.string().min(1).max(60).optional(),
  subtitle: z.string().min(1).max(80).optional(),
  /** Time of day of the shot (hours). */
  hour: z.number().min(0).max(24).optional(),
  grade: StoryGrade.optional(),
  /** The grade the shot ends on (blended from `grade`). */
  gradeTo: StoryGrade.optional(),
  moves: z.array(StoryMove).max(8).default([]),
  /**
   * Camera poses the move passes through between `camera` and `cameraTo` (a crane or a curved dolly): the path is a
   * centripetal spline through them, timed by `ease`.
   */
  via: z.array(StoryCamera).max(6).optional(),
  /** Seconds the camera's aim lags a tracked entity (a camera operator's weight; 0 locks on). */
  trackLag: z.number().min(0).max(2).optional(),
  /** The score's cue from this shot on (the player's procedural score): `intro`, `run`, `tension`, `hush`, `hope`, `climax`, `coda`, or `none`. */
  music: z.string().min(1).max(32).optional(),
  /** One-shot sounds. */
  sounds: z.array(StorySound).max(16).optional(),
  /** The ambience bed from this shot on. */
  ambience: StoryAmbience.optional(),
  /** Clips the shot's people play. */
  actions: z.array(StoryAction).max(8).optional(),
});
export type StoryShot = z.infer<typeof StoryShot>;

export const StoryEndCard = z.object({
  title: z.string().min(1).max(60),
  lines: z.array(z.string().min(1).max(100)).max(4).default([]),
});
export type StoryEndCard = z.infer<typeof StoryEndCard>;

export const Story = z.object({
  title: z.string().min(1).max(60).optional(),
  shots: z.array(StoryShot).min(1).max(MAX_STORY_SHOTS),
  /** Cinema bars (0 none .. 1 a full 2.39:1 frame). */
  letterbox: z.number().min(0).max(1).default(1),
  endCard: StoryEndCard.optional(),
  /** Where the character starts when the visitor plays from the story (default: the world's spawn). */
  playFrom: z.object({ position: V3, yaw: z.number().default(0) }).optional(),
});
export type Story = z.infer<typeof Story>;
export type StoryInput = z.input<typeof Story>;

/** Running time of a story in seconds (its shots, without the end card). */
export function storyDuration(story: Pick<Story, 'shots'>): number {
  let t = 0;
  for (const s of story.shots) t += s.duration;
  return t;
}
