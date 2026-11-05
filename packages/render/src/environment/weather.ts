/**
 * Weather particles (rain, snow, dust, fireflies, petals, leaves) as ONE
 * instanced mesh of a tiny unlit shape. Instancing (rather than `Points`) keeps particle size
 * consistent on WebGPU, where point primitives are always 1 px. Particles
 * live in a box that wraps around the camera. Snow, dust and fireflies are soft round sprites and
 * rain tapered streaks (camera-facing quads with a baked soft texture, never solid boxes or
 * polyhedra), so they read as light and water instead of confetti; petals and leaves tumble as flat
 * flakes. Each frame only the preallocated instance matrices are rewritten — no allocations.
 */
import {
  AdditiveBlending,
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshBasicMaterial,
  NoColorSpace,
  NormalBlending,
  PlaneGeometry,
  RGBAFormat,
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
  /**
   * How a particle is drawn: a round `sprite` facing the camera, a tapered `streak` along the velocity
   * (rain), or a flat `flake` that tumbles (petals, leaves).
   */
  shape: 'sprite' | 'streak' | 'flake';
  /** Particle width and height in metres (at flicker scale 1). */
  size: [number, number];
  /** Sprite edge: 'glow' fades smoothly (fireflies, dust), 'flake' stays crisper (snow). */
  edge?: 'glow' | 'flake';
}

/** Per-kind configuration table. */
export const WEATHER_CONFIGS: Readonly<Record<Exclude<WeatherKind, 'clear'>, WeatherConfig>> = Object.freeze({
  rain: { count: 5000, half: [28, 16, 28], velocity: [1.5, -17, 0.6], sway: 0, swayHz: 0, color: '#c4d4e6', opacity: 0.55, additive: false, flicker: false, shape: 'streak', size: [0.02, 0.75] },
  snow: { count: 3500, half: [26, 14, 26], velocity: [0.3, -1.1, 0.15], sway: 0.45, swayHz: 0.35, color: '#ffffff', opacity: 0.9, additive: false, flicker: false, shape: 'sprite', size: [0.085, 0.085], edge: 'flake' },
  dust: { count: 1400, half: [24, 8, 24], velocity: [1.2, 0.05, 0.4], sway: 0.35, swayHz: 0.2, color: '#d8c39a', opacity: 0.4, additive: false, flicker: false, shape: 'sprite', size: [0.07, 0.07], edge: 'glow' },
  fireflies: { count: 260, half: [20, 3, 20], velocity: [0, 0, 0], sway: 0.6, swayHz: 0.25, color: '#e8ff7a', opacity: 1, additive: true, flicker: true, shape: 'sprite', size: [0.13, 0.13], edge: 'glow' },
  petals: { count: 1400, half: [24, 10, 24], velocity: [0.9, -0.55, 0.35], sway: 0.7, swayHz: 0.3, color: '#ffc3d6', opacity: 0.95, additive: false, flicker: false, tumble: 2.4, shape: 'flake', size: [0.1, 0.07], edge: 'flake' },
  leaves: { count: 500, half: [22, 9, 22], velocity: [1.1, -0.9, 0.3], sway: 0.9, swayHz: 0.22, color: '#d9782d', opacity: 0.95, additive: false, flicker: false, tumble: 1.8, shape: 'flake', size: [0.11, 0.07], edge: 'flake' },
});

const SEED = 0x7e47e3;

/** Sprites and streaks are scaled copies of a unit quad; flakes are modelled at their size and only rotate. */
function particleGeometry(cfg: WeatherConfig): BufferGeometry {
  return cfg.shape === 'flake' ? new PlaneGeometry(cfg.size[0], cfg.size[1]) : new PlaneGeometry(1, 1);
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Soft round sprite texture: opacity 1 in the middle, fading to 0 at the rim (`glow`) or a crisper disc (`flake`). */
export function spritePixels(size: number, edge: 'glow' | 'flake'): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = ((x + 0.5) / size) * 2 - 1;
      const dy = ((y + 0.5) / size) * 2 - 1;
      const r = Math.hypot(dx, dy);
      const a = edge === 'glow' ? Math.pow(1 - smoothstep(0, 1, r), 1.6) : 1 - smoothstep(0.55, 1, r);
      const o = (y * size + x) * 4;
      px[o] = 255;
      px[o + 1] = 255;
      px[o + 2] = 255;
      px[o + 3] = Math.round(a * 255);
    }
  }
  return px;
}

/** Rain streak texture: a thin, soft-edged line whose tail (top, v = 1) fades out and whose head is bright. */
export function streakPixels(w: number, h: number): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    // Row 0 is the bottom (the head of a falling drop).
    const along = y / (h - 1);
    const tail = Math.pow(1 - along, 1.3);
    const head = smoothstep(0, 0.06, along);
    for (let x = 0; x < w; x++) {
      const across = 1 - Math.abs(((x + 0.5) / w) * 2 - 1);
      const a = smoothstep(0, 0.7, across) * tail * head;
      const o = (y * w + x) * 4;
      px[o] = 255;
      px[o + 1] = 255;
      px[o + 2] = 255;
      px[o + 3] = Math.round(a * 255);
    }
  }
  return px;
}

function spriteTexture(cfg: WeatherConfig): DataTexture | null {
  const tex = cfg.shape === 'streak' ? new DataTexture(streakPixels(8, 64), 8, 64, RGBAFormat) : new DataTexture(spritePixels(32, cfg.edge ?? 'glow'), 32, 32, RGBAFormat);
  tex.colorSpace = NoColorSpace;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
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
    const map = spriteTexture(cfg);
    const material = new MeshBasicMaterial({
      ...(map ? { map } : {}),
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
    const mesh = new InstancedMesh(particleGeometry(cfg), material, cfg.count);
    // Captures may reorient weather between draws in the same node frame.
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
    const shape = cfg.shape;
    const sizeX = cfg.size[0];
    const sizeY = cfg.size[1];
    // Billboard basis shared by every sprite / streak this frame (the camera's right, up and back axes;
    // for streaks the up axis follows the fall direction instead).
    const ce = camera.matrixWorld.elements;
    let rx = ce[0] as number, ry = ce[1] as number, rz = ce[2] as number;
    let ux = ce[4] as number, uy = ce[5] as number, uz = ce[6] as number;
    let bx = ce[8] as number, by = ce[9] as number, bz = ce[10] as number;
    if (shape === 'streak') {
      const vl = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
      // The tail points up the fall direction; the quad turns around that axis to face the camera.
      ux = -vx / vl;
      uy = -vy / vl;
      uz = -vz / vl;
      rx = uy * bz - uz * by;
      ry = uz * bx - ux * bz;
      rz = ux * by - uy * bx;
      const rl = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
      rx /= rl;
      ry /= rl;
      rz /= rl;
      bx = ry * uz - rz * uy;
      by = rz * ux - rx * uz;
      bz = rx * uy - ry * ux;
    }
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
      if (shape === 'flake') {
        writeTumble(m, k, t * tumble + p, p * 1.7 + t * tumble * 0.6);
      } else {
        let s = cfg.flicker ? Math.max(0.05, 0.5 + 0.5 * Math.sin(t * 2.3 + p * 3.1)) : 1;
        if (shape === 'streak') {
          // A drop passing close to the lens would be a metre-long white bar across the frame: shrink the streaks inside ~4 m to nothing at the camera.
          const dx = x - cx, dy = y - cy, dz = z - cz;
          s = Math.min(1, Math.max(0, (Math.sqrt(dx * dx + dy * dy + dz * dz) - 0.8) / 3.2));
        }
        const sx = sizeX * s;
        const sy = sizeY * s;
        m[k] = rx * sx;
        m[k + 1] = ry * sx;
        m[k + 2] = rz * sx;
        m[k + 4] = ux * sy;
        m[k + 5] = uy * sy;
        m[k + 6] = uz * sy;
        m[k + 8] = bx;
        m[k + 9] = by;
        m[k + 10] = bz;
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
    const material = this.mesh.material as MeshBasicMaterial;
    material.map?.dispose();
    material.dispose();
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
