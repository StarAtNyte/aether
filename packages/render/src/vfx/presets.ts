/**
 * Particle effect presets: what a spark burst, a dust puff, a flame or an
 * explosion is made of. Pure data (no three.js), read by the pool when it
 * writes particles and by the agent docs.
 *
 * Every number describes the analytic motion the vertex shader evaluates
 * (see `material.ts`): a particle is born at `origin` with a velocity, slows
 * with `drag`, falls (or rises, negative `gravity`), wanders by `turbulence`,
 * grows from `size[0]` to `size[1]` and fades from `color0` to `color1` over
 * its `life`. Nothing is integrated on the CPU after birth.
 */
import type { VfxPreset } from '@aether/core';

/** Sprite cells of the shared atlas (`atlas.ts`). */
export const SPRITE = { glow: 0, smoke: 1, star: 2, ring: 3, flake: 4 } as const;
export type SpriteCell = (typeof SPRITE)[keyof typeof SPRITE];

/** How particles leave the emitter. */
export type EmitShape = 'sphere' | 'cone' | 'ring' | 'point';

/** One layer of an effect (an explosion is a fireball, sparks, smoke and a shockwave). */
export interface VfxLayer {
  /** Additive light (sparks, fire) or alpha-blended matter (smoke, dust, water). */
  blend: 'add' | 'alpha';
  sprite: SpriteCell;
  /** Particles of a burst [min, max] (scaled by the effect scale). */
  burst: readonly [number, number];
  /** Particles per second of a continuous emitter (0: burst only). */
  rate: number;
  /** Lifetime in seconds [min, max]. */
  life: readonly [number, number];
  /** Initial speed in m/s [min, max]. */
  speed: readonly [number, number];
  shape: EmitShape;
  /** Half-angle of the cone around the emission direction (radians). */
  spread: number;
  /** Radius of the emission volume (m). */
  radius: number;
  /** Downward acceleration (m/s²; negative rises like hot air). */
  gravity: number;
  /** Linear drag (1/s). */
  drag: number;
  /** Wander amplitude (m), grows with age. */
  turbulence: number;
  /** Size in metres at birth and at death. */
  size: readonly [number, number];
  /** Random size variation ±fraction. */
  sizeJitter: number;
  color0: string;
  color1: string;
  /** Random picks instead of color0 (confetti). */
  palette?: readonly string[];
  /** HDR multiplier of additive colours (bloom picks it up). */
  intensity: number;
  /** Opacity at full life. */
  alpha: number;
  /** Velocity stretch (s): > 0 draws streaks along the motion (sparks, droplets). */
  stretch: number;
  /** Spin of billboards (rad/s, random sign). */
  spin: number;
  /** Rest on the emitter's ground instead of falling through it. */
  floor: boolean;
}

export interface VfxDef {
  layers: readonly VfxLayer[];
  /** Longest life of any layer (s): how long a burst stays alive. */
  maxLife: number;
  /** Continuous emitters only: whether `rate` makes sense for an entity (fire yes, explosion no). */
  continuous: boolean;
  description: string;
}

const L = (l: Partial<VfxLayer> & Pick<VfxLayer, 'blend' | 'sprite'>): VfxLayer => ({
  burst: [12, 16], rate: 0, life: [0.5, 1], speed: [1, 2], shape: 'sphere', spread: Math.PI, radius: 0.05, gravity: 0, drag: 1, turbulence: 0,
  size: [0.1, 0.05], sizeJitter: 0.25, color0: '#ffffff', color1: '#ffffff', intensity: 1, alpha: 1, stretch: 0, spin: 0, floor: false, ...l,
});

const def = (description: string, continuous: boolean, ...layers: VfxLayer[]): VfxDef => ({ layers, continuous, description, maxLife: Math.max(...layers.map((l) => l.life[1])) });

const SPARKS = L({ blend: 'add', sprite: SPRITE.glow, burst: [22, 30], rate: 18, life: [0.3, 0.65], speed: [3.5, 8.5], shape: 'cone', spread: Math.PI * 0.55, gravity: 9.8, drag: 1.6, size: [0.05, 0.018], color0: '#ffe2a0', color1: '#ff5a1a', intensity: 7, stretch: 0.045, floor: true });
const DUST = L({ blend: 'alpha', sprite: SPRITE.smoke, burst: [9, 13], rate: 6, life: [0.6, 1.15], speed: [0.9, 2.3], shape: 'ring', radius: 0.18, gravity: -0.35, drag: 3.2, turbulence: 0.06, size: [0.22, 0.85], color0: '#b9ab94', color1: '#a59c8e', alpha: 0.42, spin: 0.8, floor: true });
const SMOKE = L({ blend: 'alpha', sprite: SPRITE.smoke, burst: [10, 14], rate: 7, life: [2, 3.6], speed: [0.35, 0.9], shape: 'cone', spread: 0.35, radius: 0.15, gravity: -0.55, drag: 0.7, turbulence: 0.28, size: [0.45, 1.9], color0: '#5f5d5b', color1: '#8c8a87', alpha: 0.45, spin: 0.5 });
const FIRE = L({ blend: 'add', sprite: SPRITE.smoke, burst: [12, 16], rate: 30, life: [0.4, 0.8], speed: [0.45, 1.0], shape: 'cone', spread: 0.28, radius: 0.1, gravity: -2.4, drag: 1.2, turbulence: 0.06, size: [0.3, 0.06], color0: '#ffb04a', color1: '#d93c0c', intensity: 1.5, alpha: 0.8, spin: 1.2 });
const EMBERS = L({ blend: 'add', sprite: SPRITE.glow, burst: [8, 12], rate: 6, life: [1.4, 2.8], speed: [0.3, 0.9], shape: 'cone', spread: 0.6, radius: 0.12, gravity: -0.45, drag: 0.35, turbulence: 0.32, size: [0.035, 0.01], color0: '#ffb466', color1: '#ff4a12', intensity: 3.5 });

/** Every preset by name. */
export const VFX_PRESETS: Readonly<Record<VfxPreset, VfxDef>> = Object.freeze({
  sparks: def('hot sparks that streak, fall and skid on the ground (hits, metal, coins)', true, SPARKS),
  dust: def('a soft ring of dust that rolls out over the ground (landing, stomp)', false, DUST),
  footstep: def('a small puff of dust under a foot', false, L({ ...DUST, burst: [3, 5], rate: 4, life: [0.35, 0.7], speed: [0.4, 1.1], radius: 0.08, size: [0.09, 0.34], alpha: 0.3 })),
  sparkle: def('twinkling stars that float up and a soft glow (pickups, magic items)', true,
    L({ blend: 'add', sprite: SPRITE.star, burst: [16, 22], rate: 10, life: [0.5, 0.95], speed: [1.3, 3.2], shape: 'sphere', gravity: -0.6, drag: 2.6, size: [0.16, 0], color0: '#fff4b8', color1: '#ffc24a', intensity: 5, spin: 3.5 }),
    L({ blend: 'add', sprite: SPRITE.glow, burst: [1, 1], life: [0.22, 0.22], speed: [0, 0], shape: 'point', size: [0.5, 1.4], sizeJitter: 0, color0: '#fff1b0', color1: '#ffb030', intensity: 2.2, alpha: 0.8 })),
  fire: def('a licking flame with embers (torches, campfires, braziers)', true, FIRE, L({ ...EMBERS, burst: [3, 5], rate: 5 })),
  smoke: def('slow grey smoke that rises and spreads (chimneys, wrecks, defeat)', true, SMOKE),
  magic: def('cool glowing motes that swirl and drift (spells, portals, checkpoints)', true,
    L({ blend: 'add', sprite: SPRITE.glow, burst: [26, 34], rate: 26, life: [0.6, 1.25], speed: [0.6, 1.7], shape: 'sphere', radius: 0.2, gravity: -1, drag: 2, turbulence: 0.16, size: [0.11, 0], color0: '#9edcff', color1: '#b36bff', intensity: 5 }),
    L({ blend: 'add', sprite: SPRITE.ring, burst: [1, 1], life: [0.5, 0.5], speed: [0, 0], shape: 'point', size: [0.3, 2.2], sizeJitter: 0, color0: '#a8e4ff', color1: '#9b6bff', intensity: 1.8, alpha: 0.6 })),
  explosion: def('a fireball, flying sparks, a shockwave and lingering smoke', false,
    L({ blend: 'add', sprite: SPRITE.smoke, burst: [24, 30], life: [0.25, 0.55], speed: [3, 8.5], shape: 'sphere', radius: 0.3, gravity: -1.2, drag: 4.2, turbulence: 0.12, size: [0.5, 1.7], color0: '#ffc977', color1: '#4a1406', intensity: 1.9, alpha: 0.8, spin: 1.5 }),
    L({ ...SPARKS, burst: [36, 48], speed: [6, 15], spread: Math.PI * 0.8, life: [0.45, 1.1] }),
    L({ ...SMOKE, burst: [14, 18], life: [2.2, 4], speed: [1, 2.6], shape: 'sphere', radius: 0.5, size: [1, 3.2], alpha: 0.5, color0: '#3e3a37', color1: '#7a7672' }),
    L({ blend: 'add', sprite: SPRITE.ring, burst: [1, 1], life: [0.38, 0.38], speed: [0, 0], shape: 'point', size: [0.5, 5], sizeJitter: 0, color0: '#fff4dc', color1: '#ffb070', intensity: 1.2, alpha: 0.5 })),
  splash: def('water droplets thrown up and a ring of spray', false,
    L({ blend: 'alpha', sprite: SPRITE.glow, burst: [20, 26], life: [0.4, 0.8], speed: [2.2, 4.8], shape: 'cone', spread: 0.6, radius: 0.12, gravity: 9.8, drag: 0.6, size: [0.07, 0.035], color0: '#eef6ff', color1: '#cfe4f5', alpha: 0.85, stretch: 0.035, floor: true }),
    L({ blend: 'alpha', sprite: SPRITE.ring, burst: [1, 1], life: [0.7, 0.7], speed: [0, 0], shape: 'point', size: [0.3, 1.8], sizeJitter: 0, color0: '#f2f8ff', color1: '#d8e8f5', alpha: 0.5 })),
  muzzle: def('a short bright flash with a few sparks (shots, blasts)', false,
    L({ blend: 'add', sprite: SPRITE.star, burst: [3, 4], life: [0.05, 0.09], speed: [0.2, 1.2], shape: 'point', size: [0.42, 0.18], color0: '#fff6cc', color1: '#ff9a2a', intensity: 9, spin: 0 }),
    L({ ...SPARKS, burst: [6, 9], speed: [4, 9], spread: 0.35, life: [0.12, 0.3] })),
  embers: def('glowing embers that drift up and wink out (fires, forges, lava)', true, EMBERS),
  confetti: def('a celebration of tumbling coloured paper (wins)', false,
    L({ blend: 'alpha', sprite: SPRITE.flake, burst: [70, 90], life: [2, 3.6], speed: [4, 8.5], shape: 'cone', spread: 0.55, radius: 0.3, gravity: 4.2, drag: 2.3, turbulence: 0.22, size: [0.09, 0.08], color0: '#ffffff', color1: '#ffffff', palette: ['#ff5a5f', '#ffd166', '#06d6a0', '#4cc9f0', '#b388ff', '#ff9f1c'], alpha: 1, spin: 7, floor: true })),
  mist: def('billowing spray and drifting mist at the foot of a waterfall or rapids (scale 2-4 for a big fall)', true,
    L({ blend: 'alpha', sprite: SPRITE.smoke, burst: [8, 12], rate: 16, life: [3, 6], speed: [0.8, 2.6], shape: 'cone', spread: 1.1, radius: 1.4, gravity: -0.35, drag: 0.8, turbulence: 0.7, size: [1, 4], color0: '#eef5f7', color1: '#dde7eb', alpha: 0.15, spin: 0.3 }),
    L({ blend: 'alpha', sprite: SPRITE.glow, burst: [16, 22], rate: 36, life: [0.6, 1.3], speed: [2.5, 6], shape: 'cone', spread: 0.9, radius: 1, gravity: 9.8, drag: 0.5, size: [0.08, 0.05], color0: '#f4f9fb', color1: '#d9e8ee', alpha: 0.7, floor: true })),
  fountain: def('a jet of water that rises, arcs and falls back in droplets (fountains, geysers; scale for height)', true,
    L({ blend: 'alpha', sprite: SPRITE.glow, burst: [20, 30], rate: 90, life: [1, 1.4], speed: [6.5, 7.5], shape: 'cone', spread: 0.07, radius: 0.05, gravity: 9.8, drag: 0.15, size: [0.09, 0.07], color0: '#f2f8fb', color1: '#d6e7ee', alpha: 0.75, stretch: 0.04, floor: true }),
    L({ blend: 'alpha', sprite: SPRITE.smoke, burst: [4, 6], rate: 6, life: [1.2, 2.2], speed: [0.3, 0.8], shape: 'ring', radius: 0.5, gravity: -0.2, drag: 1, turbulence: 0.2, size: [0.4, 1.4], color0: '#eef5f8', color1: '#e2ebef', alpha: 0.2 })),
  drips: def('water dripping from a ledge, eave, cave roof or wet stone', true,
    L({ blend: 'alpha', sprite: SPRITE.glow, burst: [3, 5], rate: 5, life: [0.8, 1.4], speed: [0, 0.05], shape: 'sphere', radius: 0.6, gravity: 9.8, drag: 0, size: [0.035, 0.035], sizeJitter: 0.3, color0: '#e8f2f7', color1: '#d2e4ee', alpha: 0.8, stretch: 0.03, floor: true })),
  spray: def('sea spray bursting off rocks or a breakwater, carried by the wind', true,
    L({ blend: 'alpha', sprite: SPRITE.smoke, burst: [8, 12], rate: 10, life: [1, 2.2], speed: [2.5, 5], shape: 'cone', spread: 0.7, radius: 0.8, gravity: 2.5, drag: 1.2, turbulence: 0.5, size: [0.6, 2.6], color0: '#f6fafb', color1: '#e3edf1', alpha: 0.35, spin: 0.4 }),
    L({ blend: 'alpha', sprite: SPRITE.glow, burst: [14, 20], rate: 22, life: [0.5, 1], speed: [3, 6.5], shape: 'cone', spread: 0.8, radius: 0.6, gravity: 9.8, drag: 0.4, size: [0.06, 0.04], color0: '#ffffff', color1: '#dcebf1', alpha: 0.7, stretch: 0.03, floor: true })),
  steam: def('white steam that billows up and thins out (baths, vents, kettles, hot springs, vents in the street)', true,
    L({ blend: 'alpha', sprite: SPRITE.smoke, burst: [6, 9], rate: 9, life: [2, 3.8], speed: [0.4, 1.1], shape: 'cone', spread: 0.3, radius: 0.25, gravity: -0.8, drag: 0.6, turbulence: 0.35, size: [0.35, 2.2], color0: '#f4f6f7', color1: '#e9eef0', alpha: 0.3, spin: 0.4 })),
  bubbles: def('bubbles that wobble upward (underwater, aquariums, potions, springs)', true,
    L({ blend: 'add', sprite: SPRITE.ring, burst: [6, 10], rate: 8, life: [1.6, 3], speed: [0.2, 0.5], shape: 'sphere', radius: 0.3, gravity: -1.1, drag: 0.8, turbulence: 0.15, size: [0.04, 0.09], sizeJitter: 0.5, color0: '#dff4ff', color1: '#bfe6ff', intensity: 0.9, alpha: 0.7 })),
  motes: def('dust motes floating and glinting in a sunbeam (temples, attics, old halls, forest light)', true,
    L({ blend: 'add', sprite: SPRITE.glow, burst: [20, 30], rate: 10, life: [5, 9], speed: [0.02, 0.08], shape: 'sphere', radius: 3, gravity: -0.01, drag: 0.2, turbulence: 0.35, size: [0.018, 0.018], sizeJitter: 0.5, color0: '#fff1cf', color1: '#ffe2a8', intensity: 1.6, alpha: 0.8 })),
  fireflies: def('fireflies blinking and drifting at dusk (meadows, gardens, swamps)', true,
    L({ blend: 'add', sprite: SPRITE.glow, burst: [12, 18], rate: 4, life: [3, 6], speed: [0.1, 0.35], shape: 'sphere', radius: 4, gravity: -0.03, drag: 0.4, turbulence: 0.9, size: [0.07, 0.02], sizeJitter: 0.3, color0: '#e9ff8a', color1: '#9cff4a', intensity: 4, alpha: 1 })),
  leaves: def('leaves tumbling down from a tree canopy', true,
    L({ blend: 'alpha', sprite: SPRITE.flake, burst: [4, 6], rate: 2, life: [5, 8], speed: [0.1, 0.4], shape: 'sphere', radius: 3, gravity: 0.7, drag: 1.4, turbulence: 0.9, size: [0.09, 0.08], color0: '#c9862f', color1: '#8c5a22', palette: ['#c9862f', '#b4541f', '#d6a63a', '#7f8a2e'], alpha: 1, spin: 3, floor: true })),
  petals: def('blossom petals drifting down (cherry trees, weddings, gardens)', true,
    L({ blend: 'alpha', sprite: SPRITE.flake, burst: [6, 9], rate: 4, life: [5, 9], speed: [0.1, 0.3], shape: 'sphere', radius: 3, gravity: 0.45, drag: 1.6, turbulence: 1, size: [0.05, 0.045], color0: '#ffd1dc', color1: '#ffb7c9', palette: ['#ffd1dc', '#ffc2d1', '#fff0f3'], alpha: 1, spin: 4, floor: true })),
  snowfall: def('snow falling over a small area (a courtyard, a lamp pool; the whole world uses environment.weather)', true,
    L({ blend: 'alpha', sprite: SPRITE.glow, burst: [30, 40], rate: 40, life: [4, 7], speed: [0, 0.1], shape: 'sphere', radius: 6, gravity: 0.5, drag: 1.5, turbulence: 0.6, size: [0.05, 0.05], sizeJitter: 0.4, color0: '#ffffff', color1: '#f1f6fb', alpha: 0.9, floor: true })),
  rainfall: def('rain over a small area or pouring off a roof edge (the whole world uses environment.weather)', true,
    L({ blend: 'alpha', sprite: SPRITE.glow, burst: [40, 60], rate: 160, life: [0.5, 0.8], speed: [6, 8], shape: 'cone', spread: 0.05, radius: 5, gravity: 9.8, drag: 0, size: [0.02, 0.02], color0: '#d6e2ec', color1: '#c3d3e0', alpha: 0.5, stretch: 0.06, floor: true })),
  ash: def('grey ash and a few glowing cinders drifting down (volcanoes, burnt ruins, battlefields)', true,
    L({ blend: 'alpha', sprite: SPRITE.flake, burst: [14, 20], rate: 12, life: [5, 9], speed: [0.05, 0.2], shape: 'sphere', radius: 6, gravity: 0.25, drag: 1.2, turbulence: 0.7, size: [0.05, 0.04], color0: '#6f6a66', color1: '#55504d', alpha: 0.8, spin: 2, floor: true }),
    L({ ...EMBERS, burst: [2, 4], rate: 2, radius: 5, gravity: 0.15, life: [3, 5] })),
  sandswirl: def('wind-blown sand or dust swirling low over the ground (deserts, arenas, dust devils)', true,
    L({ blend: 'alpha', sprite: SPRITE.smoke, burst: [8, 12], rate: 10, life: [1.8, 3.2], speed: [1.5, 3.5], shape: 'ring', radius: 2, gravity: -0.2, drag: 0.9, turbulence: 0.8, size: [0.6, 2.4], color0: '#d2b48a', color1: '#c4a67e', alpha: 0.3, spin: 1.5, floor: true })),
  shockwave: def('an expanding ring of light (impacts, power-ups)', false,
    L({ blend: 'add', sprite: SPRITE.ring, burst: [1, 1], life: [0.42, 0.42], speed: [0, 0], shape: 'point', size: [0.3, 4.5], sizeJitter: 0, color0: '#ffffff', color1: '#bfe0ff', intensity: 2.2, alpha: 0.75 })),
});

/** Presets that make sense as a continuous emitter on an entity. */
export const CONTINUOUS_VFX: readonly VfxPreset[] = (Object.keys(VFX_PRESETS) as VfxPreset[]).filter((k) => VFX_PRESETS[k].continuous);

/** Particle budget of a render tier (both blend layers together). */
export function vfxBudget(tier: 'low' | 'medium' | 'high' | 'ultra', lowMemory = false): number {
  if (lowMemory) return 1024;
  return tier === 'low' ? 1536 : tier === 'medium' ? 4096 : tier === 'high' ? 8192 : 12288;
}
