/**
 * The particle pool: a fixed-capacity ring of particle records in typed
 * arrays, laid out exactly as the GPU reads them (six vec4 instance
 * attributes). Pure TypeScript (no three.js), so the writing, the seeding
 * and the no-allocation rule are unit-tested headlessly.
 *
 * A particle is written once, at birth, and never touched again: the vertex
 * shader evaluates its motion from the birth record and the clock. When the
 * ring is full the oldest particles are overwritten, so the budget is a hard
 * cap and nothing ever grows. Writes are tracked as one dirty slot range that
 * the renderer uploads (`addUpdateRange`) once per frame.
 */
import type { VfxLayer } from './presets';

/** Floats per particle in each attribute. */
export const STRIDE = 4;
/** Offset that keeps an encoded spin negative (spins stay within ±50 rad/s). */
export const SPIN_BIAS = 100;
/** Below every real ground: "no floor". */
export const NO_FLOOR = -1e6;

/**
 * Seeded mulberry32 stream with explicit state (no closure per use). The state lives in an `Int32Array` and
 * {@link fill} writes a batch into a `Float64Array`, so the hot path never boxes a number.
 */
export class SeededRandom {
  private readonly st = new Int32Array(1);
  constructor(seed = 1) {
    this.reset(seed);
  }
  reset(seed: number): void {
    this.st[0] = (Number.isFinite(seed) ? Math.trunc(seed) : 0) | 0;
  }
  /** Uniform in [0, 1). */
  next(): number {
    const st = this.st;
    const s = (st[0]! + 0x6d2b79f5) | 0;
    st[0] = s;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Write `n` uniforms in [0, 1) to `out` (allocation-free). */
  fill(out: Float64Array, n: number): void {
    const st = this.st;
    let s = st[0]!;
    for (let i = 0; i < n; i++) {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), s | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      out[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    st[0] = s;
  }
  /** Uniform in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }
  get state(): number {
    return this.st[0]! >>> 0;
  }
}

/** Uniforms one particle consumes. */
const DRAWS = 12;

/** Mix a few integers into a 32-bit seed (order matters). */
export function mixSeed(a: number, b: number, c = 0, d = 0): number {
  let h = 0x811c9dc5 ^ (a | 0);
  h = Math.imul(h ^ (b | 0), 0x01000193);
  h = Math.imul(h ^ (c | 0), 0x01000193);
  h = Math.imul(h ^ (d | 0), 0x01000193);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

const colorCache = new Map<string, Float32Array>();

/** `#rrggbb` → linear RGB (cached; the cache holds a few dozen preset colours). */
export function linearColor(hex: string): Float32Array {
  let c = colorCache.get(hex);
  if (c) return c;
  const v = /^#([0-9a-f]{6})$/i.exec(hex) ? parseInt(hex.slice(1), 16) : 0xffffff;
  const lin = (x: number): number => {
    const s = x / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  c = new Float32Array([lin((v >> 16) & 255), lin((v >> 8) & 255), lin(v & 255)]);
  if (colorCache.size < 512) colorCache.set(hex, c);
  return c;
}

/** Per-burst options. */
export interface SpawnOptions {
  /** Size multiplier (and count multiplier, square-rooted). */
  scale: number;
  /** Tint replacing the layer's colours (linear RGB) or null. */
  tint: Float32Array | null;
  /** Ground height particles rest on (`NO_FLOOR` for none). */
  floorY: number;
}

/** A fixed-capacity ring of particle records. */
export class ParticlePool {
  readonly capacity: number;
  /** x, y, z, birth time. */
  readonly origin: Float32Array;
  /** vx, vy, vz, life (s). */
  readonly velocity: Float32Array;
  /** size at birth, size at death, seed 0..1, sprite cell. */
  readonly shape: Float32Array;
  /** r, g, b (linear, HDR for additive), alpha. */
  readonly color0: Float32Array;
  /** r, g, b at death, floor height. */
  readonly color1: Float32Array;
  /** gravity, drag, turbulence, and either the velocity stretch (> 0) or `-(SPIN_BIAS + spin)` (rad/s, signed). */
  readonly motion: Float32Array;
  private head = 0;
  /** Slots ever written (≤ capacity): the instance count to draw. */
  private written = 0;
  private dirtyLo = Infinity;
  private dirtyHi = -Infinity;
  /** Time at which the last written particle dies. */
  private lastDeath = -Infinity;
  /** Particles written since construction (diagnostics, tests). */
  spawned = 0;
  /** Random draws of the particle being written. */
  private readonly r = new Float64Array(DRAWS);

  constructor(capacity: number) {
    const cap = Math.max(1, Math.floor(capacity));
    this.capacity = cap;
    this.origin = new Float32Array(cap * STRIDE);
    this.velocity = new Float32Array(cap * STRIDE);
    this.shape = new Float32Array(cap * STRIDE);
    this.color0 = new Float32Array(cap * STRIDE);
    this.color1 = new Float32Array(cap * STRIDE);
    this.motion = new Float32Array(cap * STRIDE);
    // Every slot starts dead: born in the far past with a tiny life.
    for (let i = 0; i < cap; i++) {
      this.origin[i * STRIDE + 3] = -1e9;
      this.velocity[i * STRIDE + 3] = 1e-3;
      this.color1[i * STRIDE + 3] = NO_FLOOR;
    }
  }

  /** Instances to draw. */
  get count(): number {
    return this.written;
  }

  /** True while any particle may still be alive at `time`. */
  alive(time: number): boolean {
    return time <= this.lastDeath;
  }

  /**
   * The slot range written since the last call (`start`, `count` in particles); false when nothing was written. A
   * frame whose writes wrap around the ring marks the span between them (at worst the whole ring).
   */
  takeDirty(out: { start: number; count: number }): boolean {
    if (this.dirtyHi < this.dirtyLo) return false;
    out.start = this.dirtyLo;
    out.count = this.dirtyHi - this.dirtyLo + 1;
    this.dirtyLo = Infinity;
    this.dirtyHi = -Infinity;
    return true;
  }

  /** Kill every particle (world switch). */
  clear(): void {
    for (let i = 0; i < this.capacity; i++) this.origin[i * STRIDE + 3] = -1e9;
    this.head = 0;
    this.lastDeath = -Infinity;
    this.dirtyLo = 0;
    this.dirtyHi = this.capacity - 1;
  }

  /**
   * Write one particle of `layer` born at `time` at (x, y, z) heading along (dx, dy, dz) (unit). Zero allocations.
   */
  spawn(layer: VfxLayer, x: number, y: number, z: number, dx: number, dy: number, dz: number, time: number, rand: SeededRandom, opts: SpawnOptions): void {
    const e = this.at;
    e[0] = x;
    e[1] = y;
    e[2] = z;
    e[3] = dx;
    e[4] = dy;
    e[5] = dz;
    e[6] = time;
    this.write(layer, rand, opts);
  }

  /**
   * Where and when the next {@link write} emits: x, y, z, direction x, y, z (unit), birth time. Callers on hot paths
   * fill it and call `write`, because passing fractional numbers as arguments to a large function boxes each one.
   */
  readonly at = new Float64Array(7);

  /** Write one particle of `layer` at {@link at}. Zero allocations. */
  write(layer: VfxLayer, rand: SeededRandom, opts: SpawnOptions): void {
    const e = this.at;
    const x = e[0]!;
    const y = e[1]!;
    const z = e[2]!;
    const dx = e[3]!;
    const dy = e[4]!;
    const dz = e[5]!;
    const time = e[6]!;
    const i = this.head;
    this.head = (this.head + 1) % this.capacity;
    if (this.written < this.capacity) this.written++;
    if (i < this.dirtyLo) this.dirtyLo = i;
    if (i > this.dirtyHi) this.dirtyHi = i;
    this.spawned++;
    const k = i * STRIDE;
    const scale = opts.scale;
    const r = this.r;
    rand.fill(r, DRAWS);
    // Direction inside the emission shape.
    let vx = dx;
    let vy = dy;
    let vz = dz;
    let ox = 0;
    let oy = 0;
    let oz = 0;
    const shape = layer.shape;
    if (shape === 'sphere') {
      const u = r[0]! * 2 - 1;
      const phi = r[1]! * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      vx = s * Math.cos(phi);
      vy = u;
      vz = s * Math.sin(phi);
      const rad = layer.radius * scale * Math.cbrt(r[2]!);
      ox = vx * rad;
      oy = vy * rad;
      oz = vz * rad;
    } else if (shape === 'cone') {
      // Uniform in the cap of half-angle `spread` around (dx, dy, dz).
      const cosMax = Math.cos(Math.min(Math.PI, layer.spread));
      const ct = 1 - r[0]! * (1 - cosMax);
      const st = Math.sqrt(Math.max(0, 1 - ct * ct));
      const phi = r[1]! * Math.PI * 2;
      // Orthonormal basis around the axis.
      let ax = 0;
      let ay = 1;
      let az = 0;
      if (Math.abs(dy) > 0.9) {
        ax = 1;
        ay = 0;
      }
      // t1 = normalize(cross(axis, a)), t2 = cross(axis, t1)
      let t1x = dy * az - dz * ay;
      let t1y = dz * ax - dx * az;
      let t1z = dx * ay - dy * ax;
      const tl = Math.hypot(t1x, t1y, t1z) || 1;
      t1x /= tl;
      t1y /= tl;
      t1z /= tl;
      const t2x = dy * t1z - dz * t1y;
      const t2y = dz * t1x - dx * t1z;
      const t2z = dx * t1y - dy * t1x;
      const c = Math.cos(phi) * st;
      const s = Math.sin(phi) * st;
      vx = dx * ct + t1x * c + t2x * s;
      vy = dy * ct + t1y * c + t2y * s;
      vz = dz * ct + t1z * c + t2z * s;
      const rad = layer.radius * scale * Math.sqrt(r[2]!);
      const a = r[3]! * Math.PI * 2;
      ox = (t1x * Math.cos(a) + t2x * Math.sin(a)) * rad;
      oy = (t1y * Math.cos(a) + t2y * Math.sin(a)) * rad;
      oz = (t1z * Math.cos(a) + t2z * Math.sin(a)) * rad;
    } else if (shape === 'ring') {
      const a = r[0]! * Math.PI * 2;
      const lift = 0.12 + r[1]! * 0.25;
      const h = Math.sqrt(1 - lift * lift);
      vx = Math.cos(a) * h;
      vy = lift;
      vz = Math.sin(a) * h;
      const rad = layer.radius * scale;
      ox = Math.cos(a) * rad;
      oz = Math.sin(a) * rad;
    }
    const sp = layer.speed;
    const lf = layer.life;
    const speed = (sp[0] + (sp[1] - sp[0]) * r[4]!) * (0.75 + 0.25 * scale);
    const life = lf[0] + (lf[1] - lf[0]) * r[5]!;
    const jitter = 1 + (r[6]! * 2 - 1) * layer.sizeJitter;
    const seed = r[7]!;
    const o = this.origin;
    o[k] = x + ox;
    o[k + 1] = y + oy;
    o[k + 2] = z + oz;
    o[k + 3] = time;
    const v = this.velocity;
    v[k] = vx * speed;
    v[k + 1] = vy * speed;
    v[k + 2] = vz * speed;
    v[k + 3] = life;
    const sh = this.shape;
    sh[k] = layer.size[0] * scale * jitter;
    sh[k + 1] = layer.size[1] * scale * jitter;
    sh[k + 2] = seed;
    sh[k + 3] = layer.sprite;
    // Colours: a palette pick, a tint, or the layer's own; additive light gets its HDR intensity.
    const pal = layer.palette;
    let c0 = linearColor(layer.color0);
    let c1 = linearColor(layer.color1);
    if (pal && pal.length > 0) {
      c0 = linearColor(pal[Math.floor(r[8]! * pal.length) % pal.length] as string);
      c1 = c0;
    }
    const tint = opts.tint;
    const gain = layer.blend === 'add' ? layer.intensity : 1;
    const c0a = this.color0;
    const c1a = this.color1;
    for (let j = 0; j < 3; j++) {
      const a0 = tint ? (tint[j] as number) : (c0[j] as number);
      const a1 = tint ? (tint[j] as number) * 0.55 + (c1[j] as number) * 0.25 : (c1[j] as number);
      c0a[k + j] = a0 * gain;
      c1a[k + j] = a1 * gain;
    }
    c0a[k + 3] = layer.alpha;
    c1a[k + 3] = layer.floor ? opts.floorY : NO_FLOOR;
    const m = this.motion;
    m[k] = layer.gravity;
    m[k + 1] = layer.drag;
    m[k + 2] = layer.turbulence * scale;
    m[k + 3] = layer.stretch > 0 ? layer.stretch : -(SPIN_BIAS + layer.spin * (r[9]! < 0.5 ? -1 : 1));
    if (time + life > this.lastDeath) this.lastDeath = time + life;
  }
}
