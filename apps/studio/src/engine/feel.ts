/**
 * Pure helpers of the studio's game-feel wiring (unit-tested): which puff a
 * footstep raises on a surface, and how hard a landing was.
 */
import type { VfxPreset } from '@aether/core';

/** Fall speed (m/s, downward) below which a landing is just a step. */
export const LANDING_MIN_SPEED = 4.5;

/** Intensity 0..2 of a landing after falling at `fallSpeed` (negative m/s); 0 = no landing cue. */
export function landingIntensity(fallSpeed: number): number {
  const v = Number.isFinite(fallSpeed) ? -fallSpeed : 0;
  if (v < LANDING_MIN_SPEED) return 0;
  return Math.min(2, 0.35 + (v - LANDING_MIN_SPEED) / 7);
}

/** The puff under a footstep on `surface`, or null where a floor raises nothing (wood, carpet, metal indoors). */
export function footstepEffect(surface: string, speed: number): { vfx: VfxPreset; scale: number; color?: string } | null {
  const pace = Math.max(0.5, Math.min(1.4, 0.55 + (Number.isFinite(speed) ? speed : 0) * 0.1));
  switch (surface) {
    case 'water':
      return { vfx: 'splash', scale: 0.35 * pace };
    case 'sand':
      return { vfx: 'footstep', scale: 1.1 * pace, color: '#d9c7a1' };
    case 'dirt':
      return { vfx: 'footstep', scale: pace, color: '#a8957a' };
    case 'snow':
      return { vfx: 'footstep', scale: 0.9 * pace, color: '#f2f5f8' };
    case 'grass':
      return { vfx: 'footstep', scale: 0.55 * pace, color: '#9a9478' };
    case 'stone':
      return { vfx: 'footstep', scale: 0.45 * pace, color: '#b3aca2' };
    default:
      return null;
  }
}
