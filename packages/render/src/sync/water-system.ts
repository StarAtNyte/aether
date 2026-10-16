/**
 * Water behaviour in the scene: where the surfaces are, what disturbs them and whether the eye is under one.
 *
 * Things that move through water make rings: a body that crosses the surface splashes (stronger the faster it
 * falls), one that wades or swims shed a ring every few steps. The system watches the tracked bodies (people,
 * animals, vehicles, rolling props and the player's avatar), writes the rings into the shared
 * {@link RippleField} and lets the shader draw them. It owns no GPU resources and allocates nothing per frame.
 */
import { Vector3, type Camera } from 'three';
import type { WorldDoc } from '@aether/core';
import { UNDERWATER, WATER_CLASSES, underwaterDensity } from '../materials/water-params';
import { RippleField } from '../materials/water-state';
import { findWaterSurfaces, surfaceAt, type WaterSurface } from './water-surfaces';

/** One body the system watches. */
interface Mover {
  /** Writes the body's feet position (world) into the vector; false when the body is gone. */
  read: (out: Vector3) => boolean;
  last: Vector3;
  primed: boolean;
  surface: WaterSurface | null;
  cooldown: number;
}

/** Horizontal speed (m/s) under which a wading body stirs nothing. */
export const WADE_MIN_SPEED = 0.35;
/** A body is "in" the water from this depth (m) of its feet below the surface, and wades up to this depth. */
export const WADE_DEPTH: readonly [number, number] = Object.freeze([-0.06, 0.9]) as readonly [number, number];

/** What the eye sees below a surface: the colour water takes and how fast things fade. */
export interface UnderwaterLook {
  color: string;
  density: number;
  surface: WaterSurface;
}

const _p = new Vector3();

/** Watches water surfaces and the bodies that disturb them. */
export class WaterSystem {
  private surfaces: WaterSurface[] = [];
  private readonly movers = new Map<string, Mover>();
  private readonly list: Mover[] = [];
  private lookCache: UnderwaterLook | null = null;
  private lookFor: WaterSurface | null = null;

  /** The water surfaces of the current world, largest first. */
  get all(): readonly WaterSurface[] {
    return this.surfaces;
  }

  /** Read the surfaces of `world` (call after the world changes). */
  setWorld(world: Pick<WorldDoc, 'entities'>): void {
    this.surfaces = findWaterSurfaces(world);
    this.lookCache = null;
    this.lookFor = null;
  }

  /** The largest surface: the one body the planar reflection mirrors. */
  get dominant(): WaterSurface | null {
    return this.surfaces[0] ?? null;
  }

  /** Watch a body: `read` writes its feet position (world). Replaces a body with the same key. */
  track(key: string, read: (out: Vector3) => boolean): void {
    this.untrack(key);
    const m: Mover = { read, last: new Vector3(), primed: false, surface: null, cooldown: 0 };
    this.movers.set(key, m);
    this.list.push(m);
  }

  /** Stop watching a body. */
  untrack(key: string): void {
    const m = this.movers.get(key);
    if (!m) return;
    this.movers.delete(key);
    const i = this.list.indexOf(m);
    if (i >= 0) this.list.splice(i, 1);
  }

  /** Stop watching everything. */
  clearMovers(): void {
    this.movers.clear();
    this.list.length = 0;
  }

  /** Number of watched bodies. */
  get tracked(): number {
    return this.list.length;
  }

  /** Advance by `dt` seconds: emit rings for crossings and wading. Returns the number of rings emitted. */
  update(dt: number): number {
    RippleField.expire();
    if (this.surfaces.length === 0 || !(dt > 0)) return 0;
    let emitted = 0;
    for (let i = 0; i < this.list.length; i++) {
      const m = this.list[i] as Mover;
      if (!m.read(_p)) continue;
      if (!Number.isFinite(_p.x + _p.y + _p.z)) continue;
      if (!m.primed) {
        m.primed = true;
        m.last.copy(_p);
        m.surface = surfaceAt(this.surfaces, _p.x, _p.z, _p.y);
        continue;
      }
      const dx = _p.x - m.last.x;
      const dz = _p.z - m.last.z;
      const vy = (_p.y - m.last.y) / dt;
      const speed = Math.hypot(dx, dz) / dt;
      const jump = Math.hypot(dx, dz, _p.y - m.last.y) > 25 * dt + 3;
      m.last.copy(_p);
      if (jump) {
        m.surface = surfaceAt(this.surfaces, _p.x, _p.z, _p.y);
        continue;
      }
      const s = surfaceAt(this.surfaces, _p.x, _p.z, _p.y + 0.3) ?? surfaceAt(this.surfaces, _p.x, _p.z, _p.y);
      const depth = s ? s.y - _p.y : Number.NEGATIVE_INFINITY;
      const inside = s !== null && depth >= WADE_DEPTH[0] && depth <= WADE_DEPTH[1] + 8;
      const was = m.surface;
      if (inside && s) {
        if (!was || was.id !== s.id) {
          const strength = Math.min(1, 0.4 + Math.abs(Math.min(0, vy)) * 0.11);
          if (RippleField.emit(_p.x, _p.z, strength) >= 0) emitted++;
          m.cooldown = 0.3;
        } else if (depth <= WADE_DEPTH[1] && speed > WADE_MIN_SPEED) {
          m.cooldown -= dt;
          if (m.cooldown <= 0) {
            if (RippleField.emit(_p.x, _p.z, Math.min(0.7, 0.16 + speed * 0.07)) >= 0) emitted++;
            m.cooldown = Math.max(0.12, Math.min(0.55, 0.36 / (0.5 + speed * 0.35)));
          }
        }
      } else if (was && !inside && speed > 0.2) {
        // Leaving the water: a last small ring where the body came out.
        if (RippleField.emit(_p.x, _p.z, 0.3) >= 0) emitted++;
      }
      m.surface = inside ? s : null;
    }
    return emitted;
  }

  /**
   * The look under a surface when the camera is below one (inside its footprint), else null. The object is cached per
   * surface: do not keep it.
   */
  underwater(camera: Camera): UnderwaterLook | null {
    if (this.surfaces.length === 0) return null;
    const p = camera.position;
    const s = surfaceAt(this.surfaces, p.x, p.z, p.y);
    if (!s || p.y >= s.y - 0.02) return null;
    // A thin disc on a lawn is not a pool to dive in: below its top by less than a metre of "depth" it is only the ground.
    if (s.y - p.y > 400) return null;
    if (this.lookFor !== s || !this.lookCache) {
      const c = WATER_CLASSES[s.kind];
      this.lookCache = { color: mixHex(c.shallow, c.deep, 0.55), density: Math.max(UNDERWATER.minDensity, underwaterDensity(s.kind)), surface: s };
      this.lookFor = s;
    }
    return this.lookCache;
  }
}

function mixHex(a: string, b: string, t: number): string {
  const ca = Number.parseInt(a.slice(1), 16);
  const cb = Number.parseInt(b.slice(1), 16);
  const ch = (shift: number): number => Math.round(((ca >> shift) & 255) * (1 - t) + ((cb >> shift) & 255) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}
