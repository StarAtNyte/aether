/**
 * Weather particles (rain, snow, dust, fireflies, petals, leaves) as ONE
 * instanced mesh of a tiny unlit shape. Instancing (rather than `Points`) keeps particle size
 * consistent on WebGPU, where point primitives are always 1 px. Particles
 * live in a box that wraps around the camera; each frame only the
 * translation (for fireflies the scale, for petals and leaves the rotation)
 * slots of preallocated matrices are rewritten — no allocations.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  DoubleSide,
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedMesh,
  MeshBasicMaterial,
  NormalBlending,
  OctahedronGeometry,
  PlaneGeometry,
  type BufferGeometry,
  type Camera,
} from 'three';
import { rng, type Environment } from '@aether/core';

/** Weather kind (including 'clear'). */
export type WeatherKind = Environment['weather'];

/** Static configuration of one weather kind. */
export interface WeatherConfig {
  count: number;
  /** Half extents of the wrap box around the camera. */
  half: [number, number, number];
  /** Base velocity in m/s. */
  velocity: [number, number, number];
  /** Horizontal sway amplitude (m/s) and frequency (Hz). */
  sway: number;
  swayHz: number;
  color: string;
  opacity: number;
  additive: boolean;
  /** Pulsing size (fireflies). */
  flicker: boolean;
  /** Tumbling flat flakes (petals, leaves): rotation speed in radians per second (0 = none). */
  tumble?: number;
}

/** Per-kind configuration table. */
export const WEATHER_CONFIGS: Readonly<Record<Exclude<WeatherKind, 'clear'>, WeatherConfig>> = Object.freeze({
  rain: { count: 5000, half: [28, 16, 28], velocity: [1.5, -17, 0.6], sway: 0, swayHz: 0, color: '#a9bfd6', opacity: 0.5, additive: false, flicker: false },
  snow: { count: 3500, half: [26, 14, 26], velocity: [0.3, -1.1, 0.15], sway: 0.45, swayHz: 0.35, color: '#ffffff', opacity: 0.9, additive: false, flicker: false },
  dust: { count: 1400, half: [24, 8, 24], velocity: [1.2, 0.05, 0.4], sway: 0.35, swayHz: 0.2, color: '#d8c39a', opacity: 0.45, additive: false, flicker: false },
  fireflies: { count: 260, half: [20, 3, 20], velocity: [0, 0, 0], sway: 0.6, swayHz: 0.25, color: '#e8ff7a', opacity: 1, additive: true, flicker: true },
  petals: { count: 1400, half: [24, 10, 24], velocity: [0.9, -0.55, 0.35], sway: 0.7, swayHz: 0.3, color: '#ffc3d6', opacity: 0.95, additive: false, flicker: false, tumble: 2.4 },
  leaves: { count: 500, half: [22, 9, 22], velocity: [1.1, -0.9, 0.3], sway: 0.9, swayHz: 0.22, color: '#d9782d', opacity: 0.95, additive: false, flicker: false, tumble: 1.8 },
});

const SEED = 0x7e47e3;

function particleGeometry(kind: Exclude<WeatherKind, 'clear'>): BufferGeometry {
  switch (kind) {
    case 'rain':
      return new BoxGeometry(0.012, 0.55, 0.012);
    case 'snow':
      return new IcosahedronGeometry(0.035, 0);
    case 'dust':
      return new OctahedronGeometry(0.02, 0);
    case 'petals':
      return new PlaneGeometry(0.1, 0.07);
    case 'leaves':
      return new PlaneGeometry(0.11, 0.07);
    default:
      return new OctahedronGeometry(0.045, 0);
  }
}

function wrap(v: number, half: number): number {
  const span = half * 2;
  return ((((v + half) % span) + span) % span) - half;
}

/**
 * Write the rotation part (column-major 3×3) of an instance matrix: a spin
 * `a` around Y followed by a flip `b` around X — a flake turning over as it
 * falls. Pure arithmetic, no allocation.
 */
export function writeTumble(m: Float32Array, k: number, a: number, b: number): void {
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const cb = Math.cos(b);
  const sb = Math.sin(b);
  // R = Ry(a) · Rx(b)
  m[k] = ca;
  m[k + 1] = 0;
  m[k + 2] = -sa;
  m[k + 4] = sa * sb;
  m[k + 5] = cb;
  m[k + 6] = ca * sb;
  m[k + 8] = sa * cb;
  m[k + 9] = -sb;
  m[k + 10] = ca * cb;
}

/** Camera-wrapped instanced weather particles. */
export class WeatherSystem {
  private mesh: InstancedMesh | null = null;
  private config: WeatherConfig | null = null;
  private kind: WeatherKind = 'clear';
  /** World positions, xyz per particle (wrapped into the box around the camera every frame). */
  private offsets = new Float32Array(0);
  private phases = new Float32Array(0);
  private time = 0;

  constructor(private readonly parent: { add(o: InstancedMesh): unknown }) {}

  /** Current weather kind. */
  get current(): WeatherKind {
    return this.kind;
  }

  /** True while particles animate (any weather other than clear). */
  get animating(): boolean {
    return this.mesh !== null;
  }

  /** Number of live particles. */
  get count(): number {
    return this.mesh?.count ?? 0;
  }

  /** Switch weather. Rebuilds buffers only when the kind changes. */
  set(kind: WeatherKind): void {
    if (kind === this.kind) return;
    this.disposeMesh();
    this.kind = kind;
    if (kind === 'clear' || !Object.hasOwn(WEATHER_CONFIGS, kind)) return;
    const cfg = WEATHER_CONFIGS[kind];
    this.config = cfg;
    const random = rng(SEED);
    this.offsets = new Float32Array(cfg.count * 3);
    this.phases = new Float32Array(cfg.count);
    for (let i = 0; i < cfg.count; i++) {
      this.offsets[i * 3] = (random() * 2 - 1) * cfg.half[0];
      this.offsets[i * 3 + 1] = (random() * 2 - 1) * cfg.half[1];
      this.offsets[i * 3 + 2] = (random() * 2 - 1) * cfg.half[2];
      this.phases[i] = random() * Math.PI * 2;
    }
    const material = new MeshBasicMaterial({
      color: cfg.color,
      transparent: true,
      opacity: cfg.opacity,
      depthWrite: false,
      blending: cfg.additive ? AdditiveBlending : NormalBlending,
      fog: !cfg.additive,
    });
    // Flat flakes are seen from both sides while they tumble.
    if (cfg.tumble) material.side = DoubleSide;
    if (cfg.flicker) material.color.multiplyScalar(4); // HDR so fireflies bloom
    const mesh = new InstancedMesh(particleGeometry(kind), material, cfg.count);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.name = `aether:weather:${kind}`;
    mesh.renderOrder = 5;
    this.mesh = mesh;
    this.parent.add(mesh);
  }

  /** Advance particles and wrap them around the camera. Zero allocations. */
  update(dt: number, camera: Camera): void {
    const mesh = this.mesh;
    const cfg = this.config;
    if (!mesh || !cfg) return;
    const step = Math.min(Math.max(dt, 0), 0.1);
    this.time += step;
    const t = this.time;
    const m = mesh.instanceMatrix.array as Float32Array;
    const o = this.offsets;
    const ph = this.phases;
    // Index access, not destructuring: array destructuring may allocate an iterator per frame.
    const half = cfg.half;
    const vel = cfg.velocity;
    const hx = half[0], hy = half[1], hz = half[2];
    const vx = vel[0], vy = vel[1], vz = vel[2];
    const w = cfg.swayHz * Math.PI * 2;
    const tumble = cfg.tumble ?? 0;
    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;
    for (let i = 0; i < cfg.count; i++) {
      const p = ph[i] as number;
      const i3 = i * 3;
      let swayX = 0;
      let swayZ = 0;
      if (cfg.sway > 0) {
        swayX = Math.sin(t * w + p) * cfg.sway;
        swayZ = Math.cos(t * w * 0.8 + p * 1.3) * cfg.sway;
      }
      // Wrap relative to the camera so particles always surround the viewer.
      const x = wrap((o[i3] as number) + (vx + swayX) * step - cx, hx) + cx;
      const y = wrap((o[i3 + 1] as number) + (vy + (cfg.flicker ? Math.sin(t * 0.9 + p) * 0.3 : 0)) * step - cy, hy) + cy;
      const z = wrap((o[i3 + 2] as number) + (vz + swayZ) * step - cz, hz) + cz;
      o[i3] = x;
      o[i3 + 1] = y;
      o[i3 + 2] = z;
      const k = i * 16;
      if (tumble > 0) writeTumble(m, k, t * tumble + p, p * 1.7 + t * tumble * 0.6);
      if (cfg.flicker) {
        const s = Math.max(0.05, 0.5 + 0.5 * Math.sin(t * 2.3 + p * 3.1));
        m[k] = s;
        m[k + 5] = s;
        m[k + 10] = s;
      }
      m[k + 12] = x;
      m[k + 13] = y;
      m[k + 14] = z;
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  private disposeMesh(): void {
    if (!this.mesh) return;
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
    this.mesh.dispose();
    this.mesh = null;
    this.config = null;
  }

  /** Release GPU resources. */
  dispose(): void {
    this.disposeMesh();
    this.kind = 'clear';
  }
}
