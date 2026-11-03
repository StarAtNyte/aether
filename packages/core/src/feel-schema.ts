/**
 * Game feel and visual effects in the World IR (additive, all optional).
 *
 * - `world.feel` says how strongly the game answers what happens in it: a
 *   tier for the whole game (`subtle`, `normal`, `punchy`, `off`) and, per
 *   event (pickup, hit, damage, death, win, checkpoint, jump, land,
 *   explosion, launch), a cue that overrides parts of the tier: camera shake
 *   (trauma 0..1), hit-stop (seconds), FOV kick (degrees), a screen flash and
 *   vignette pulse, controller rumble, a squash of the player's body, floating
 *   score text, audio ducking and a particle effect.
 * - `entity.vfx` is a continuous emitter on an entity (a torch's fire, a
 *   chimney's smoke, embers over a brazier, a magic trail).
 * - The rule action `{do: "effect"}` plays a burst at a place and, optionally,
 *   the cue of an event.
 *
 * None of this changes the simulation. The renderer and the studio play it;
 * physics, logic state, the playtest bot and replay proofs never read it, so a
 * sealed replay stays valid whatever the feel says. A world without `feel`
 * plays with the `normal` tier.
 */
import './zod-config';
import { z } from 'zod';

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'color must be #rrggbb');

/** How strongly the game answers events. `off` disables every cue (effects attached to entities still play). */
export const FeelTier = z.enum(['off', 'subtle', 'normal', 'punchy']);
export type FeelTier = z.infer<typeof FeelTier>;

/** Gameplay moments a cue can be attached to. */
export const FeelEvent = z.enum(['pickup', 'hit', 'damage', 'death', 'win', 'checkpoint', 'jump', 'land', 'explosion', 'launch', 'shoot', 'kill']);
export type FeelEvent = z.infer<typeof FeelEvent>;

/** Particle effects the renderer knows (seeded, GPU-instanced, never simulated). */
export const VfxPreset = z.enum([
  'sparks', 'dust', 'sparkle', 'fire', 'smoke', 'magic', 'explosion', 'splash', 'footstep', 'muzzle', 'embers', 'confetti', 'shockwave',
  // Environment emitters (place them on an entity: a fall, a fountain, a vent, a glade).
  'mist', 'fountain', 'drips', 'spray', 'steam', 'bubbles', 'motes', 'fireflies', 'leaves', 'petals', 'snowfall', 'rainfall', 'ash', 'sandswirl', 'groundfog', 'incense', 'candle',
  // Combat, impacts and destruction.
  'impact', 'blood', 'debris', 'glass', 'smokebomb', 'electric',
  // Machines and vehicles.
  'welding', 'thruster', 'exhaust',
  // Magic, sci-fi and game feedback.
  'heal', 'poison', 'frost', 'portal', 'teleport', 'aura', 'hologram', 'levelup',
  // Celebration and rewards.
  'fireworks', 'coins', 'hearts',
]);
export type VfxPreset = z.infer<typeof VfxPreset>;

/** What one event does on screen, in the hands and in the ears. Every field is optional and overrides the tier. */
export const FeelCue = z.object({
  /** Strength tier of this event (default: the game's tier). */
  tier: FeelTier.optional(),
  /** Camera shake: trauma added, 0..1 (the shake is trauma squared and decays in about a second). */
  shake: z.number().min(0).max(1).optional(),
  /** Hit-stop: the game freezes this many seconds (0..0.25). */
  hitStop: z.number().min(0).max(0.25).optional(),
  /** FOV kick in degrees (-20..20; positive widens, springs back). */
  fovKick: z.number().min(-20).max(20).optional(),
  /** Full-screen flash strength 0..1. */
  flash: z.number().min(0).max(1).optional(),
  /** Flash colour (default white; damage defaults to red). */
  flashColor: Hex.optional(),
  /** Vignette pulse strength 0..1. */
  vignette: z.number().min(0).max(1).optional(),
  /** Controller rumble strength 0..1 (where the controller supports it). */
  rumble: z.number().min(0).max(1).optional(),
  /** Squash of the player's body 0..1 (landing, pickup pop). */
  squash: z.number().min(0).max(1).optional(),
  /** Floating score / damage text at the event. */
  text: z.boolean().optional(),
  /** Duck the background sounds (footsteps, ambience) by this much 0..1 for a moment. */
  duck: z.number().min(0).max(1).optional(),
  /** Particle burst at the event (`none` for no burst). */
  vfx: z.union([VfxPreset, z.literal('none')]).optional(),
  /** Tint of the burst. */
  vfxColor: Hex.optional(),
  /** Size of the burst 0.2..4. */
  vfxScale: z.number().min(0.2).max(4).optional(),
});
export type FeelCue = z.infer<typeof FeelCue>;

/** Per-event cues. */
export const FeelEvents = z.object({
  pickup: FeelCue.optional(),
  hit: FeelCue.optional(),
  damage: FeelCue.optional(),
  death: FeelCue.optional(),
  win: FeelCue.optional(),
  checkpoint: FeelCue.optional(),
  jump: FeelCue.optional(),
  land: FeelCue.optional(),
  explosion: FeelCue.optional(),
  launch: FeelCue.optional(),
  shoot: FeelCue.optional(),
  kill: FeelCue.optional(),
});
export type FeelEvents = z.infer<typeof FeelEvents>;

/** `world.feel`: the game's feedback tier and per-event cues. */
export const FeelSpec = z.object({
  /** Tier of every event without its own (default `normal`). */
  preset: FeelTier.default('normal'),
  events: FeelEvents.default({}),
  /** Footstep dust and water splashes under walking people (default true). */
  footsteps: z.boolean().optional(),
});
export type FeelSpec = z.infer<typeof FeelSpec>;
export type FeelSpecInput = z.input<typeof FeelSpec>;

/** `entity.vfx`: a continuous emitter that follows the entity. */
export const EntityVfx = z.object({
  preset: VfxPreset,
  /** Particles per second (default: the preset's rate; 0..400). */
  rate: z.number().min(0).max(400).optional(),
  color: Hex.optional(),
  /** Size multiplier 0.2..4. */
  scale: z.number().min(0.2).max(4).optional(),
  /** Offset from the entity's origin in metres (its local frame). */
  offset: z.tuple([z.number(), z.number(), z.number()]).optional(),
  enabled: z.boolean().default(true),
});
export type EntityVfx = z.infer<typeof EntityVfx>;
