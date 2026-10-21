/**
 * Game-feel presets: what each event does at each tier, and the resolution
 * of a world's `feel` into concrete numbers. Pure data, shared by the
 * renderer (which plays the cues), the studio and the agent (which describes
 * them). See `feel-schema.ts` for the IR.
 *
 * The values follow one idea: a satisfying moment is several small answers
 * within about a tenth of a second (a burst, a pop of the body, a flash, a
 * short freeze, a shake), and the camera and the picture move, never the
 * body's simulated position.
 */
import type { FeelCue, FeelEvent, FeelSpec, FeelTier, VfxPreset } from './feel-schema';

/** A cue with every field decided. */
export interface ResolvedCue {
  tier: FeelTier;
  shake: number;
  hitStop: number;
  fovKick: number;
  flash: number;
  flashColor: string;
  vignette: number;
  rumble: number;
  squash: number;
  text: boolean;
  duck: number;
  vfx: VfxPreset | 'none';
  vfxColor: string | undefined;
  vfxScale: number;
}

type Base = Omit<ResolvedCue, 'tier' | 'vfxColor'> & { vfxColor?: string };

/** The `normal` tier of every event. */
const NORMAL: Readonly<Record<FeelEvent, Base>> = Object.freeze({
  pickup: { shake: 0, hitStop: 0, fovKick: 0, flash: 0.05, flashColor: '#fff2c2', vignette: 0, rumble: 0.15, squash: 0.25, text: true, duck: 0, vfx: 'sparkle', vfxScale: 1 },
  hit: { shake: 0.35, hitStop: 0.05, fovKick: 1.5, flash: 0.1, flashColor: '#ffffff', vignette: 0, rumble: 0.4, squash: 0, text: true, duck: 0, vfx: 'sparks', vfxScale: 1 },
  damage: { shake: 0.45, hitStop: 0.06, fovKick: -2, flash: 0.28, flashColor: '#ff2a2a', vignette: 0.55, rumble: 0.6, squash: 0.2, text: true, duck: 0.2, vfx: 'sparks', vfxColor: '#ff6a4a', vfxScale: 0.9 },
  death: { shake: 0.7, hitStop: 0.12, fovKick: -6, flash: 0.45, flashColor: '#ff2020', vignette: 0.85, rumble: 0.9, squash: 0, text: false, duck: 0.6, vfx: 'smoke', vfxScale: 1.2 },
  win: { shake: 0.12, hitStop: 0, fovKick: 3, flash: 0.32, flashColor: '#fff4d6', vignette: 0, rumble: 0.5, squash: 0.2, text: false, duck: 0.45, vfx: 'confetti', vfxScale: 1.4 },
  checkpoint: { shake: 0.06, hitStop: 0, fovKick: 1, flash: 0.14, flashColor: '#d6ecff', vignette: 0, rumble: 0.2, squash: 0.15, text: false, duck: 0, vfx: 'magic', vfxScale: 1 },
  jump: { shake: 0, hitStop: 0, fovKick: 0, flash: 0, flashColor: '#ffffff', vignette: 0, rumble: 0, squash: 0.15, text: false, duck: 0, vfx: 'dust', vfxScale: 0.55 },
  land: { shake: 0.12, hitStop: 0, fovKick: 0, flash: 0, flashColor: '#ffffff', vignette: 0, rumble: 0.2, squash: 0.35, text: false, duck: 0, vfx: 'dust', vfxScale: 1 },
  explosion: { shake: 0.8, hitStop: 0.08, fovKick: 4, flash: 0.42, flashColor: '#ffd59a', vignette: 0.2, rumble: 1, squash: 0, text: false, duck: 0.5, vfx: 'explosion', vfxScale: 1 },
  launch: { shake: 0.1, hitStop: 0, fovKick: 6, flash: 0, flashColor: '#ffffff', vignette: 0, rumble: 0.3, squash: 0.3, text: false, duck: 0, vfx: 'dust', vfxScale: 0.8 },
});

/** Multipliers of a tier relative to `normal`. */
interface TierScale {
  shake: number;
  hitStop: number;
  fovKick: number;
  flash: number;
  vignette: number;
  rumble: number;
  squash: number;
  vfxScale: number;
}

export const FEEL_TIER_SCALE: Readonly<Record<FeelTier, Readonly<TierScale>>> = Object.freeze({
  off: { shake: 0, hitStop: 0, fovKick: 0, flash: 0, vignette: 0, rumble: 0, squash: 0, vfxScale: 0 },
  subtle: { shake: 0.45, hitStop: 0.4, fovKick: 0.5, flash: 0.5, vignette: 0.6, rumble: 0.5, squash: 0.6, vfxScale: 0.8 },
  normal: { shake: 1, hitStop: 1, fovKick: 1, flash: 1, vignette: 1, rumble: 1, squash: 1, vfxScale: 1 },
  punchy: { shake: 1.6, hitStop: 1.9, fovKick: 1.6, flash: 1.35, vignette: 1.2, rumble: 1.3, squash: 1.4, vfxScale: 1.35 },
});

/** Every feel event, in a stable order. */
export const FEEL_EVENTS: readonly FeelEvent[] = ['pickup', 'hit', 'damage', 'death', 'win', 'checkpoint', 'jump', 'land', 'explosion', 'launch'];

/** One line per event for docs and prompts. */
export const FEEL_EVENT_DOCS: Readonly<Record<FeelEvent, string>> = Object.freeze({
  pickup: 'a collectible was picked up (coins, gems, keys, items given in dialogue)',
  hit: 'something was struck (an NPC hit by another, a hazard touched without damage)',
  damage: 'the player lost health',
  death: 'the player lost the game',
  win: 'the player won',
  checkpoint: 'a checkpoint was reached',
  jump: 'the player left the ground in a jump',
  land: 'the player landed after a fall (scaled by the fall speed)',
  explosion: 'an explosive went off or an explode action ran',
  launch: 'a launcher (jump pad, cannon) threw something',
});

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * The concrete cue of `event` in a world's feel (`undefined` = the `normal` tier). Fields written in the event's cue
 * win over the tier; `intensity` (0..2, default 1) scales the tier's values, not the written ones (a hard landing
 * shakes more than a hop).
 */
export function resolveFeelCue(feel: Pick<FeelSpec, 'preset' | 'events'> | undefined, event: FeelEvent, intensity = 1): ResolvedCue {
  const cue: FeelCue | undefined = feel?.events?.[event];
  const tier: FeelTier = cue?.tier ?? feel?.preset ?? 'normal';
  const base = NORMAL[event];
  const k = FEEL_TIER_SCALE[tier];
  const amt = Number.isFinite(intensity) ? clamp(intensity, 0, 2) : 1;
  const off = tier === 'off';
  return {
    tier,
    shake: cue?.shake ?? clamp(base.shake * k.shake * amt, 0, 1),
    hitStop: cue?.hitStop ?? clamp(base.hitStop * k.hitStop * Math.min(1, amt), 0, 0.25),
    fovKick: cue?.fovKick ?? clamp(base.fovKick * k.fovKick * amt, -20, 20),
    flash: cue?.flash ?? clamp(base.flash * k.flash * Math.min(1, amt), 0, 1),
    flashColor: cue?.flashColor ?? base.flashColor,
    vignette: cue?.vignette ?? clamp(base.vignette * k.vignette * Math.min(1, amt), 0, 1),
    rumble: cue?.rumble ?? clamp(base.rumble * k.rumble * amt, 0, 1),
    squash: cue?.squash ?? clamp(base.squash * k.squash * amt, 0, 1),
    text: cue?.text ?? (off ? false : base.text),
    duck: cue?.duck ?? (off ? 0 : base.duck),
    vfx: cue?.vfx ?? (off ? 'none' : base.vfx),
    vfxColor: cue?.vfxColor ?? base.vfxColor,
    vfxScale: cue?.vfxScale ?? clamp(base.vfxScale * (off ? 1 : k.vfxScale) * (0.6 + 0.4 * amt), 0.2, 4),
  };
}

/** One-line description of a world's feel for summaries and prompts (`''` when the world has none). */
export function describeFeel(feel: FeelSpec | undefined): string {
  if (!feel) return '';
  const parts: string[] = [`feel ${feel.preset}`];
  for (const ev of FEEL_EVENTS) {
    const c = feel.events[ev];
    if (!c) continue;
    const bits: string[] = [];
    if (c.tier) bits.push(c.tier);
    if (c.vfx) bits.push(c.vfx);
    if (c.shake !== undefined) bits.push(`shake ${c.shake}`);
    if (c.hitStop !== undefined) bits.push(`hit-stop ${c.hitStop}s`);
    if (c.flash !== undefined) bits.push(`flash ${c.flash}`);
    parts.push(`${ev}: ${bits.join(' ') || 'custom'}`);
  }
  if (feel.footsteps === false) parts.push('no footstep dust');
  return parts.join('; ');
}
