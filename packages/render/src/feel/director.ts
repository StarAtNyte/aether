/**
 * The game-feel director: plays resolved cues (`resolveFeelCue` in
 * `@aether/core`) on the picture — trauma camera shake, hit-stop, FOV kick,
 * flash and vignette pulses, the squash of the player's body — and keeps
 * their state between frames. Pure arithmetic over a camera pose (no scene,
 * no DOM), so it is unit-tested headlessly.
 *
 * Shake is "trauma": events add trauma (0..1), it decays linearly, and the
 * camera moves by trauma² times a smooth seeded noise (offset and a little
 * yaw, pitch and roll). Squaring makes small knocks subtle and big ones
 * violent. The noise stream is seeded, so a replay shot of the same events
 * shakes the same way.
 *
 * Juice moves the picture, never the body: the shake is applied to the
 * camera for the draw and removed straight after it; the simulation never
 * sees it. Hit-stop pauses the fixed-step simulation (the studio stops
 * stepping, which changes when steps run, not what they compute) and slows
 * animation and particles to a crawl.
 *
 * Reduce motion turns shake, FOV kicks and flashes off and keeps the gentler
 * cues (squash, a short hit-stop, the vignette at half strength).
 */
import type { ResolvedCue } from '@aether/core';
import type { PerspectiveCamera } from 'three';

/** Trauma lost per second. */
const TRAUMA_DECAY = 1.35;
/** Largest camera offset at full trauma (m) and largest rotations (radians). */
const MAX_OFFSET = 0.14;
const MAX_YAW = 0.022;
const MAX_PITCH = 0.018;
const MAX_ROLL = 0.045;
/** Noise speed of the shake (Hz-ish). */
const SHAKE_FREQ = 17;
/** Time scale while frozen by hit-stop. */
export const HIT_STOP_SCALE = 0.04;
/** Flash and vignette decay time constants (s). */
const FLASH_TAU = 0.11;
const VIGNETTE_TAU = 0.32;
/** FOV kick: the target decays over FOV_TAU, the lens follows it over FOV_ATTACK. */
const FOV_TAU = 0.28;
const FOV_ATTACK = 0.035;

/** A 1D smooth value noise in [-1, 1], seeded per channel. */
export function shakeNoise(seed: number, channel: number, t: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hashUnit(seed, channel, i), hashUnit(seed, channel, i + 1), u) * 2 - 1;
}

function hashUnit(seed: number, channel: number, i: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(channel + 1, 0xc2b2ae35) ^ Math.imul(i, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Flash colour and strength the studio overlay draws. */
export interface FeelPulse {
  r: number;
  g: number;
  b: number;
  /** Flash opacity 0..1. */
  flash: number;
  /** Vignette strength 0..1 (its colour is the flash colour of the last vignette cue). */
  vignette: number;
  vr: number;
  vg: number;
  vb: number;
}

/** Saved camera pose around one draw. */
interface SavedPose {
  px: number;
  py: number;
  pz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  fov: number;
  applied: boolean;
  fovChanged: boolean;
}

/** The feel state of one renderer. */
export class FeelDirector {
  private trauma = 0;
  private shakeTime = 0;
  private seed = 1;
  private freeze = 0;
  private fovTarget = 0;
  private fovNow = 0;
  private squashAmp = 0;
  private squashAge = 10;
  private squashSign = 1;
  private reduce = false;
  private readonly saved: SavedPose = { px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1, fov: 50, applied: false, fovChanged: false };
  /** Current pulses (read by the studio overlay each frame). */
  readonly pulse: FeelPulse = { r: 1, g: 1, b: 1, flash: 0, vignette: 0, vr: 0, vg: 0, vb: 0 };
  /** Cues played (diagnostics, tests). */
  played = 0;
  /** Whole effect off (edit mode, captures). */
  enabled = true;

  /** Reduce motion (accessibility): no shake, no FOV kick, no flash. */
  setReducedMotion(on: boolean): void {
    this.reduce = on;
    if (on) {
      this.trauma = 0;
      this.fovTarget = 0;
      this.fovNow = 0;
      this.pulse.flash = 0;
    }
  }

  get reducedMotion(): boolean {
    return this.reduce;
  }

  /** Seed of the shake noise (from the world seed). */
  setSeed(seed: number): void {
    this.seed = Number.isFinite(seed) ? Math.trunc(seed) | 0 : 1;
  }

  /** Current trauma 0..1. */
  get traumaLevel(): number {
    return this.trauma;
  }

  /** Seconds of hit-stop left. */
  get frozenFor(): number {
    return this.freeze;
  }

  /** True while hit-stop holds the game. */
  get frozen(): boolean {
    return this.freeze > 0;
  }

  /** Multiplier of game-time effects (animation, particles): ~0 while frozen. */
  get timeScale(): number {
    return this.freeze > 0 ? HIT_STOP_SCALE : 1;
  }

  /** FOV offset in degrees applied at the next draw. */
  get fovOffset(): number {
    return this.fovNow;
  }

  /** True while anything is still moving (the renderer keeps drawing). */
  get active(): boolean {
    return this.trauma > 0 || this.freeze > 0 || Math.abs(this.fovNow) > 0.01 || Math.abs(this.fovTarget) > 0.01 || this.pulse.flash > 0.002 || this.pulse.vignette > 0.002 || this.squashAge < 1.2;
  }

  /** Body squash now: vertical scale and horizontal scale of the player's body. */
  squash(out: { y: number; xz: number }): { y: number; xz: number } {
    const t = this.squashAge;
    const s = t < 1.2 ? this.squashAmp * Math.exp(-t * 9) * Math.cos(t * 24) * this.squashSign : 0;
    out.y = 1 - s * 0.32;
    out.xz = 1 + s * 0.18;
    return out;
  }

  /** Play a cue. `stretch` makes the body stretch instead of squash (a jump). */
  play(cue: ResolvedCue, opts: { seed?: number; stretch?: boolean } = {}): void {
    if (!this.enabled || (cue.tier === 'off' && cue.shake === 0 && cue.flash === 0 && cue.hitStop === 0 && cue.squash === 0 && cue.vignette === 0)) return;
    this.played++;
    if (opts.seed !== undefined) this.seed = (this.seed ^ Math.imul(opts.seed | 0, 0x9e3779b1)) | 0;
    if (!this.reduce) {
      this.trauma = Math.min(1, this.trauma + Math.max(0, cue.shake));
      if (cue.fovKick !== 0) this.fovTarget = Math.max(-20, Math.min(20, this.fovTarget + cue.fovKick));
      if (cue.flash > 0) this.setFlash(cue.flashColor, cue.flash);
    }
    const hit = this.reduce ? Math.min(cue.hitStop, 0.04) : cue.hitStop;
    if (hit > this.freeze) this.freeze = Math.min(0.25, hit);
    if (cue.vignette > 0) this.setVignette(cue.flashColor, this.reduce ? cue.vignette * 0.5 : cue.vignette);
    if (cue.squash > 0) {
      this.squashAmp = Math.min(1, cue.squash);
      this.squashAge = 0;
      this.squashSign = opts.stretch ? -1 : 1;
    }
  }

  private setFlash(hex: string, strength: number): void {
    const v = parseHex(hex);
    const p = this.pulse;
    p.r = ((v >> 16) & 255) / 255;
    p.g = ((v >> 8) & 255) / 255;
    p.b = (v & 255) / 255;
    p.flash = Math.min(1, Math.max(p.flash, strength));
  }

  private setVignette(hex: string, strength: number): void {
    const v = parseHex(hex);
    const p = this.pulse;
    // A vignette darkens toward a deep version of the colour (blood red for damage, black otherwise).
    const k = hex.toLowerCase() === '#ffffff' ? 0 : 0.55;
    p.vr = (((v >> 16) & 255) / 255) * k;
    p.vg = (((v >> 8) & 255) / 255) * k * 0.2;
    p.vb = ((v & 255) / 255) * k * 0.2;
    p.vignette = Math.min(1, Math.max(p.vignette, strength));
  }

  /** Advance by `dt` real seconds (hit-stop counts down in real time). */
  update(dt: number): void {
    const step = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 0;
    if (step === 0) return;
    if (this.freeze > 0) this.freeze = Math.max(0, this.freeze - step);
    this.trauma = Math.max(0, this.trauma - TRAUMA_DECAY * step);
    this.shakeTime += step;
    this.fovTarget *= Math.exp(-step / FOV_TAU);
    if (Math.abs(this.fovTarget) < 0.01) this.fovTarget = 0;
    this.fovNow += (this.fovTarget - this.fovNow) * (1 - Math.exp(-step / FOV_ATTACK));
    if (Math.abs(this.fovNow) < 0.005 && this.fovTarget === 0) this.fovNow = 0;
    const p = this.pulse;
    p.flash *= Math.exp(-step / FLASH_TAU);
    if (p.flash < 0.002) p.flash = 0;
    p.vignette *= Math.exp(-step / VIGNETTE_TAU);
    if (p.vignette < 0.002) p.vignette = 0;
    if (this.squashAge < 10) this.squashAge += step;
  }

  /** Clear every running cue (session end, world switch). */
  reset(): void {
    this.trauma = 0;
    this.freeze = 0;
    this.fovTarget = 0;
    this.fovNow = 0;
    this.squashAge = 10;
    this.pulse.flash = 0;
    this.pulse.vignette = 0;
  }

  /** Shake offset and rotation now (metres, radians) — for tests and overlays. */
  shake(out: { x: number; y: number; z: number; yaw: number; pitch: number; roll: number }): typeof out {
    const k = this.reduce ? 0 : this.trauma * this.trauma;
    const t = this.shakeTime * SHAKE_FREQ;
    out.x = MAX_OFFSET * k * shakeNoise(this.seed, 0, t);
    out.y = MAX_OFFSET * k * shakeNoise(this.seed, 1, t);
    out.z = MAX_OFFSET * k * 0.5 * shakeNoise(this.seed, 2, t);
    out.yaw = MAX_YAW * k * shakeNoise(this.seed, 3, t);
    out.pitch = MAX_PITCH * k * shakeNoise(this.seed, 4, t);
    out.roll = MAX_ROLL * k * shakeNoise(this.seed, 5, t);
    return out;
  }

  private readonly shakeScratch = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };

  /** Apply the shake and FOV kick to `camera` for one draw; {@link restore} undoes it exactly. */
  apply(camera: PerspectiveCamera): void {
    const s = this.saved;
    s.applied = false;
    s.fovChanged = false;
    if (!this.enabled) return;
    const fov = this.reduce ? 0 : this.fovNow;
    const shaking = !this.reduce && this.trauma > 0;
    if (!shaking && fov === 0) return;
    s.px = camera.position.x;
    s.py = camera.position.y;
    s.pz = camera.position.z;
    s.qx = camera.quaternion.x;
    s.qy = camera.quaternion.y;
    s.qz = camera.quaternion.z;
    s.qw = camera.quaternion.w;
    s.fov = camera.fov;
    s.applied = true;
    if (shaking) {
      const sh = this.shake(this.shakeScratch);
      // Offset in the camera's own frame (right, up, back).
      const e = camera.matrixWorld.elements;
      camera.position.x += (e[0] as number) * sh.x + (e[4] as number) * sh.y + (e[8] as number) * sh.z;
      camera.position.y += (e[1] as number) * sh.x + (e[5] as number) * sh.y + (e[9] as number) * sh.z;
      camera.position.z += (e[2] as number) * sh.x + (e[6] as number) * sh.y + (e[10] as number) * sh.z;
      // Local rotation: q = q * (yaw about Y, pitch about X, roll about Z) for small angles.
      mulSmallRotation(camera.quaternion, sh.pitch, sh.yaw, sh.roll);
    }
    if (fov !== 0) {
      camera.fov = Math.max(10, Math.min(130, s.fov + fov));
      camera.updateProjectionMatrix();
      s.fovChanged = true;
    }
    camera.updateMatrixWorld();
  }

  /** Undo {@link apply}. */
  restore(camera: PerspectiveCamera): void {
    const s = this.saved;
    if (!s.applied) return;
    s.applied = false;
    camera.position.set(s.px, s.py, s.pz);
    camera.quaternion.set(s.qx, s.qy, s.qz, s.qw);
    if (s.fovChanged) {
      camera.fov = s.fov;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
  }
}

/** q ← q · R(x, y, z) for small Euler angles (radians), normalised. */
function mulSmallRotation(q: { x: number; y: number; z: number; w: number; set(x: number, y: number, z: number, w: number): unknown }, ax: number, ay: number, az: number): void {
  // Small-angle quaternion of the local rotation.
  const rx = ax * 0.5;
  const ry = ay * 0.5;
  const rz = az * 0.5;
  const bw = 1;
  const x = q.w * rx + q.x * bw + q.y * rz - q.z * ry;
  const y = q.w * ry - q.x * rz + q.y * bw + q.z * rx;
  const z = q.w * rz + q.x * ry - q.y * rx + q.z * bw;
  const w = q.w * bw - q.x * rx - q.y * ry - q.z * rz;
  const l = Math.hypot(x, y, z, w) || 1;
  q.set(x / l, y / l, z / l, w / l);
}

function parseHex(hex: string): number {
  return /^#[0-9a-f]{6}$/i.test(hex) ? parseInt(hex.slice(1), 16) : 0xffffff;
}
