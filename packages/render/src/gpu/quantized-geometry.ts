/**
 * Quantized vertex streams on the GPU (WebGL2; docs/PERFORMANCE.md, "Quantized geometry on the GPU").
 *
 * Geometry reaches the page as float32 streams (the cooked packs store them quantized, the lanes decode them), and three
 * uploads what the CPU holds: 12 bytes a position, 12 a normal. A geometry registered with {@link quantizeOnGpu} keeps
 * its float arrays on the CPU, so every reader (picking, merges, shadow batches, physics, lightmaps, export) is unchanged,
 * while its GPU buffers hold integers:
 *
 * - positions: int16 on a power-of-two grid, `p = c + q · step`, `step` the finest power of two that holds the geometry
 *   around `c`, at least the cooked packs' 2^-11 m (whose positions then keep their exact values) and at most
 *   {@link MAX_STEP} (else the positions stay float; {@link ORIGIN_MAX_STEP} for geometry that may not be translated). The
 *   shader reads them normalized, and the dequantization is folded into the object's world matrix while it draws,
 *   `M · T(c) · S(32767 · step)` with a uniform scale, so no shader changes: the program sources, and the cooked program
 *   sets recorded from them, stay what they were. `c` is the origin unless the geometry does not fit around it and no
 *   material of it hashes the object's origin (anti-tiled finishes hash it for their tone);
 * - normals: 10 bits a component in one 32-bit word (`INT_2_10_10_10_REV`, an error under 0.12°;
 *   `__AETHER_GPU_NORMAL_BITS = 16` or `8`: normalized int16 or int8 xyz); the shader normalizes them as before;
 * - colours and terrain layer weights within 0..1: normalized uint16; other colours: half floats;
 * - UVs within 0..1 (foliage atlases, the lightmap) or -1..1 (the metre UVs of parts within a metre): normalized uint16 or
 *   int16. Larger metre UVs stay float: they would need a per-mesh scale in the shader.
 *
 * Positions are folded only where the geometry's frame is the object's: not for instanced, batched or skinned meshes, nor
 * with materials that read object space (a position node, a displacement map, or layers and shading expressions, which
 * read object-space positions; `aetherShaded`). A geometry whose positions went up quantized and is then drawn by such an
 * object or material goes back to float positions, from its CPU array (merges and batches, whose arrays
 * `gpu/cpu-release.ts` takes, are registered with the one mesh that draws them).
 *
 * The integers go up in three's own upload (`attributeUtils.createAttribute`, the array swapped for the call) and the
 * vertex layout reads them normalized (`_createVao`). The render object's cache key is unchanged (the CPU attribute keeps
 * its flags). Three-component 16-bit and 10:10:10:2 formats are native on desktop GL, Vulkan and Metal; ANGLE on D3D11
 * widens them when it uploads. On WebGPU nothing changes: there the vertex format is chosen from the CPU array when a
 * pipeline is made.
 *
 * `__AETHER_GPU_QUANTIZE = false` keeps every stream float (A/B runs). Counters: `globalThis.__aetherGpuQuantized`.
 */
import { DataUtils, type BufferAttribute, type BufferGeometry, type InterleavedBufferAttribute, type Material, type Object3D } from 'three';

/** Finest position grid (m): the cooked packs' 2^-11 m. */
export const MIN_STEP = 2 ** -11;
/** Coarsest position grid (m) of drawn geometry, an error of at most half of it: 2^-10 m holds a geometry of 64 m. */
export const MAX_STEP = 2 ** -10;
/**
 * Coarsest grid of drawn geometry that may not be translated (its material hashes the origin): 2^-9 m, an error of at
 * most 1 mm, holds a geometry within 64 m of its origin (building and prop merges in their parent's frame).
 */
export const ORIGIN_MAX_STEP = 2 ** -9;
/** `userData` key of a material with layers or shading expressions (materials/shading.ts): they read object space. */
const SHADED_KEY = 'aetherShaded';
/** `userData` flag of a material that hashes the object's origin (anti-tile tone) unless the geometry carries it. */
const PIECE_TONE_KEY = 'aetherPieceTone';
const PIECE_ORIGIN = 'aetherPieceOrigin';
/** The lightmap's UVs (`environment/light-volume-light.ts`). */
const LIGHTMAP_UV = 'aetherLM';
const STATIC_DRAW = 35044;

const Q = 32767;

/** Counters for probes. */
export interface GpuQuantizeStats {
  geometries: number;
  /** Float bytes of the streams that went up quantized, and the bytes they took on the GPU. */
  floatBytes: number;
  gpuBytes: number;
  positions: number;
  /** Positions left float, and their float bytes by reason: the object or material reads object space; too large. */
  positionsFloat: number;
  floatObjectSpace: number;
  floatLarge: number;
  /** Of those too large, the bytes of geometry whose material hashes the origin (no translation allowed). */
  floatLargeOrigin: number;
  /** Float bytes of those too large, by the grid they would need (and whether a translation was allowed). */
  largeSteps: Record<string, number>;
  reverted: number;
  /** Draws left out: drawn by an object or material that reads object space, with the CPU positions already released. */
  skipped: number;
  /** Why the last draw was left out (diagnostics). */
  lastSkip?: string;
}

const stats: GpuQuantizeStats = { geometries: 0, floatBytes: 0, gpuBytes: 0, positions: 0, positionsFloat: 0, floatObjectSpace: 0, floatLarge: 0, floatLargeOrigin: 0, largeSteps: {}, reverted: 0, skipped: 0 };
(globalThis as { __aetherGpuQuantized?: GpuQuantizeStats }).__aetherGpuQuantized = stats;

/** How a stream is stored on the GPU. */
type Kind = 'position' | 'snorm10' | 'snorm8' | 'snorm16' | 'unorm16' | 'half';
type Ints = Int16Array | Int8Array | Uint16Array | Int32Array;

interface Stream {
  kind: Kind | null;
  /** The integers until three uploads them. */
  ints: Ints | null;
  uploaded: boolean;
}

/** Position dequantization of a geometry: `p = c + q · step`. */
interface Fold {
  attr: BufferAttribute;
  step: number;
  cx: number;
  cy: number;
  cz: number;
}

interface Plan {
  /** Positions may be folded (no registration said otherwise). */
  positions: boolean;
  /** A translation is allowed (no material hashes the origin). */
  offset: boolean;
  /** Coarsest position grid allowed. */
  maxStep: number;
  made: boolean;
}

const plans = new WeakMap<BufferGeometry, Plan>();
const streams = new WeakMap<object, Stream>();
/** The geometry a stream was first registered with (geometries may share streams: virtual geometry instances). */
const geometryOf = new WeakMap<object, BufferGeometry>();
/** Position streams that go up quantized, by attribute. */
const folds = new WeakMap<object, Fold>();

function enabled(): boolean {
  return (globalThis as { __AETHER_GPU_QUANTIZE?: boolean }).__AETHER_GPU_QUANTIZE !== false;
}

/** Whether an object draws its geometry's positions in its own frame (no instancing, batching or skinning). */
function plainObject(o: Object3D): boolean {
  const x = o as Object3D & { isInstancedMesh?: boolean; isBatchedMesh?: boolean; isSkinnedMesh?: boolean; isMesh?: boolean };
  return x.isMesh === true && x.isInstancedMesh !== true && x.isBatchedMesh !== true && x.isSkinnedMesh !== true;
}

/** Whether a material reads object-space positions (a position node, a displacement map, layers or shading expressions). */
export function readsObjectSpace(m: Material | null | undefined): boolean {
  if (!m) return false;
  const n = m as Material & { positionNode?: unknown; displacementMap?: unknown };
  return n.positionNode != null || n.displacementMap != null || m.userData?.[SHADED_KEY] !== undefined;
}

function each(m: Material | Material[] | null | undefined, f: (m: Material) => boolean): boolean {
  return Array.isArray(m) ? m.some(f) : !!m && f(m);
}

/**
 * Register `geometry` to go up quantized: static geometry only, whose arrays do not change once uploaded. `object` is the
 * object that will draw it: positions are quantized only for a plain mesh whose material reads no object space.
 * `maxStep`: the coarsest position grid allowed (depth-only geometry takes a coarser one). Call before the geometry is
 * first drawn or prepared; a stream already uploaded stays as it is.
 */
export function quantizeOnGpu(geometry: BufferGeometry, object: Object3D, opts: { maxStep?: number } = {}): void {
  if (!enabled()) return;
  const material = (object as Object3D & { material?: Material | Material[] }).material;
  const positions = plainObject(object) && !each(material, readsObjectSpace);
  const offset = !each(material, (x) => x.userData?.[PIECE_TONE_KEY] === true && !geometry.hasAttribute(PIECE_ORIGIN));
  const maxStep = opts.maxStep ?? MAX_STEP;
  const p = plans.get(geometry);
  if (p) {
    // Shared geometry (the geometry cache): the strictest registration wins while nothing is made yet.
    if (!p.made) {
      p.positions &&= positions;
      p.offset &&= offset;
      p.maxStep = Math.min(p.maxStep, maxStep);
    }
    return;
  }
  plans.set(geometry, { positions, offset, maxStep, made: false });
  for (const name in geometry.attributes) {
    const a = geometry.attributes[name]!;
    if (geometryOf.has(a)) continue;
    streams.set(a, { kind: null, ints: null, uploaded: false });
    geometryOf.set(a, geometry);
  }
}

/** The float array of a plain static attribute, or null. */
function floatArray(a: BufferAttribute | InterleavedBufferAttribute | undefined): Float32Array | null {
  if (!a || (a as InterleavedBufferAttribute).isInterleavedBufferAttribute) return null;
  const b = a as BufferAttribute & { isInstancedBufferAttribute?: boolean };
  if (!(b.array instanceof Float32Array) || b.normalized || b.isInstancedBufferAttribute || b.usage !== STATIC_DRAW) return null;
  if (b.array.length === 0 || b.array.length !== b.count * b.itemSize) return null;
  return b.array;
}

/** Positions on the finest power-of-two grid that holds them, around the origin or (`offset`) the box centre; null when none does. */
function positionGrid(a: Float32Array, offset: boolean, maxStep: number): Omit<Fold, 'attr'> | null {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < a.length; i += 3) {
    const x = a[i]!, y = a[i + 1]!, z = a[i + 2]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minX + minY + minZ + maxX + maxY + maxZ)) return null;
  const stepFor = (m: number): number => Math.max(MIN_STEP, 2 ** Math.ceil(Math.log2(Math.max(m, 1e-30) / Q)));
  let step = stepFor(Math.max(-minX, maxX, -minY, maxY, -minZ, maxZ));
  let cx = 0, cy = 0, cz = 0;
  // Finer around the box centre when a translation is allowed. The centre is on the coarsest grid allowed, so values on
  // a finer grid (the cooked 2^-11 m) stay on it after the shift.
  if (step > MIN_STEP && offset) {
    const snap = (v: number): number => Math.round(v / maxStep) * maxStep;
    cx = snap((minX + maxX) / 2);
    cy = snap((minY + maxY) / 2);
    cz = snap((minZ + maxZ) / 2);
    step = stepFor(Math.max(maxX - cx, cx - minX, maxY - cy, cy - minY, maxZ - cz, cz - minZ));
  }
  if (!offset) maxStep = Math.max(maxStep, ORIGIN_MAX_STEP);
  if (step > maxStep) {
    const k = `2^${Math.log2(step)}${offset ? '' : ' origin'}`;
    stats.largeSteps[k] = (stats.largeSteps[k] ?? 0) + a.byteLength;
    return null;
  }
  return { step, cx, cy, cz };
}

/** Smallest and largest value of `a`; NaN when any value is not finite. Plain loops: this runs over every stream. */
function range(a: Float32Array): [number, number] {
  let lo = Infinity, hi = -Infinity, nan = false;
  for (let i = 0; i < a.length; i++) {
    const v = a[i]!;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
    if (v !== v) nan = true;
  }
  return nan || !Number.isFinite(lo) || !Number.isFinite(hi) ? [Number.NaN, Number.NaN] : [lo, hi];
}

/** `a` stored as `kind` (values outside the kind's range are clamped; a stream is given a kind that holds it). */
function encode(a: Float32Array, kind: Kind, fold: Fold | null): Ints {
  const len = a.length;
  if (kind === 'position') {
    const f = fold!;
    const inv = 1 / f.step;
    const cx = f.cx, cy = f.cy, cz = f.cz;
    const out = new Int16Array(len);
    for (let i = 0; i < len; i += 3) {
      // Math.floor(x + 0.5) rounds as Math.round does; the grid holds every value, the clamp is for changed arrays.
      const x = Math.floor((a[i]! - cx) * inv + 0.5), y = Math.floor((a[i + 1]! - cy) * inv + 0.5), z = Math.floor((a[i + 2]! - cz) * inv + 0.5);
      out[i] = x > Q ? Q : x < -Q ? -Q : x;
      out[i + 1] = y > Q ? Q : y < -Q ? -Q : y;
      out[i + 2] = z > Q ? Q : z < -Q ? -Q : z;
    }
    return out;
  }
  if (kind === 'snorm10') {
    // xyz in 10 bits each (two's complement), w 0: one 32-bit word, read as INT_2_10_10_10_REV.
    const n = len / 3;
    const out = new Int32Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 3) {
      const x = a[j]!, y = a[j + 1]!, z = a[j + 2]!;
      const qx = Math.floor((x > 1 ? 1 : x < -1 ? -1 : x) * 511 + 0.5) & 1023;
      const qy = Math.floor((y > 1 ? 1 : y < -1 ? -1 : y) * 511 + 0.5) & 1023;
      const qz = Math.floor((z > 1 ? 1 : z < -1 ? -1 : z) * 511 + 0.5) & 1023;
      out[i] = qx | (qy << 10) | (qz << 20);
    }
    return out;
  }
  if (kind === 'half') {
    const out = new Uint16Array(len);
    for (let i = 0; i < len; i++) out[i] = DataUtils.toHalfFloat(a[i]!);
    return out;
  }
  if (kind === 'unorm16') {
    const out = new Uint16Array(len);
    for (let i = 0; i < len; i++) {
      const v = a[i]!;
      out[i] = Math.floor((v > 1 ? 1 : v < 0 ? 0 : v) * 65535 + 0.5);
    }
    return out;
  }
  const k = kind === 'snorm8' ? 127 : Q;
  const out = kind === 'snorm8' ? new Int8Array(len) : new Int16Array(len);
  for (let i = 0; i < len; i++) {
    const v = a[i]!;
    out[i] = Math.floor((v > 1 ? 1 : v < -1 ? -1 : v) * k + 0.5);
  }
  return out;
}

/** The kind a stream named `name` goes up as, or null (stays float). */
function kindOf(name: string, b: BufferAttribute, data: Float32Array): Kind | null {
  const isNormal = name === 'normal' && b.itemSize === 3;
  const isUv = (name === 'uv' || name === LIGHTMAP_UV) && b.itemSize === 2;
  const isUnit = name === 'color' || name === 'splat';
  if (!isNormal && !isUv && !isUnit) return null;
  const [lo, hi] = range(data);
  if (Number.isNaN(lo)) return null;
  if (isNormal) {
    if (lo < -1 || hi > 1) return null;
    const bits = (globalThis as { __AETHER_GPU_NORMAL_BITS?: number }).__AETHER_GPU_NORMAL_BITS;
    return bits === 8 ? 'snorm8' : bits === 16 ? 'snorm16' : 'snorm10';
  }
  if (lo >= 0 && hi <= 1) return 'unorm16';
  if (isUv) return lo >= -1 && hi <= 1 ? 'snorm16' : null;
  return lo > -65000 && hi < 65000 ? 'half' : null;
}

/** The parts of three's WebGL2 backend and renderer used here. */
interface Backend {
  isWebGLBackend?: boolean;
  gl: { INT_2_10_10_10_REV: number };
  get(object: object): { bufferGPU?: unknown; type?: number; isInteger?: boolean };
  has(object: object): boolean;
  attributeUtils: { createAttribute(attribute: object, bufferType: number): unknown; updateAttribute(attribute: object): unknown };
  _createVao?(attributes: object[]): unknown;
}
interface Renderer {
  backend: Backend;
  _renderObjectDirect: (object: Object3D, material: Material, ...rest: unknown[]) => unknown;
  _currentSourceMaterial?: Material | null;
  _attributes?: { delete(attribute: object): unknown };
  _geometries?: { attributeCall?: WeakMap<object, unknown> };
}

/** Choose the kind of every registered stream of `g` not yet uploaded and make its integers (once, on first use). */
function make(g: BufferGeometry, p: Plan, backend: Backend): void {
  p.made = true;
  stats.geometries++;
  for (const name in g.attributes) {
    const attr = g.attributes[name]!;
    const s = streams.get(attr);
    // Not registered, or made already through another geometry sharing it.
    if (!s || s.kind || s.uploaded) continue;
    const data = floatArray(attr);
    if (!data || (backend.has(attr) && backend.get(attr).bufferGPU !== undefined)) {
      streams.delete(attr);
      continue;
    }
    const b = attr as BufferAttribute;
    let kind: Kind | null = null;
    if (name === 'position' && b.itemSize === 3) {
      const grid = p.positions ? positionGrid(data, p.offset, p.maxStep) : null;
      if (grid) {
        kind = 'position';
        folds.set(b, { attr: b, ...grid });
        stats.positions++;
      } else {
        stats.positionsFloat++;
        if (!p.positions) stats.floatObjectSpace += data.byteLength;
        else {
          stats.floatLarge += data.byteLength;
          if (!p.offset) stats.floatLargeOrigin += data.byteLength;
        }
      }
    } else kind = kindOf(name, b, data);
    if (!kind) {
      streams.delete(attr);
      continue;
    }
    s.kind = kind;
    s.ints = encode(data, kind, folds.get(b) ?? null);
    stats.floatBytes += data.byteLength;
    stats.gpuBytes += s.ints.byteLength;
  }
}

/** Back to float positions (an object or material that reads object space draws them); false when the CPU array is gone. */
function revert(r: Renderer, attr: BufferAttribute): boolean {
  if (!(attr.array instanceof Float32Array) || attr.array.length !== attr.count * 3) return false;
  const s = streams.get(attr);
  streams.delete(attr);
  folds.delete(attr);
  stats.reverted++;
  if (s?.uploaded) {
    r._attributes?.delete(attr);
    r._geometries?.attributeCall?.delete(attr);
  }
  return true;
}

const installed = new WeakSet<object>();
const COLUMNS = [0, 1, 2, 4, 5, 6, 8, 9, 10] as const;

/**
 * Install on a renderer (WebGL2 backend only; elsewhere nothing happens). Install before anything else wraps
 * `_renderObjectDirect`: the preparation queue draws through what it finds there.
 */
export function installGpuQuantize(renderer: unknown): void {
  const r = renderer as Renderer;
  const b = r?.backend;
  if (!enabled() || !b || b.isWebGLBackend !== true || installed.has(r) || typeof b._createVao !== 'function' || typeof r._renderObjectDirect !== 'function') return;
  installed.add(r);
  const utils = b.attributeUtils;
  const create = utils.createAttribute.bind(utils);
  const update = utils.updateAttribute.bind(utils);
  /** Upload `attribute` with `ints` in place of its array (and as half floats for that kind). */
  const swapped = <T>(attribute: object, ints: Ints, kind: Kind, f: () => T): T => {
    const a = attribute as BufferAttribute & { isFloat16BufferAttribute?: boolean };
    const real = a.array;
    (a as { array: unknown }).array = ints;
    if (kind === 'half') a.isFloat16BufferAttribute = true;
    try {
      return f();
    } finally {
      (a as { array: unknown }).array = real;
      if (kind === 'half') delete a.isFloat16BufferAttribute;
    }
  };
  utils.createAttribute = (attribute: object, bufferType: number): unknown => {
    let s = streams.get(attribute);
    if (s && !s.uploaded && !s.ints) {
      const g = geometryOf.get(attribute);
      const p = g ? plans.get(g) : undefined;
      if (g && p && !p.made) make(g, p, b);
      s = streams.get(attribute);
    }
    if (!s?.kind) return create(attribute, bufferType);
    // Up again (its geometry was disposed while undrawn, or the context was lost): encoded again from the CPU array.
    const cpu = (attribute as BufferAttribute).array;
    if (!s.ints && cpu instanceof Float32Array && cpu.length > 0) {
      s.ints = encode(cpu, s.kind, folds.get(attribute) ?? null);
    }
    if (!s.ints) return create(attribute, bufferType);
    const ints = s.ints;
    s.ints = null;
    s.uploaded = true;
    const made = swapped(attribute, ints, s.kind, () => create(attribute, bufferType));
    if (s.kind === 'snorm10') {
      const d = b.get(attribute);
      d.type = b.gl.INT_2_10_10_10_REV;
      d.isInteger = false;
    }
    return made;
  };
  // A registered stream should never change; if one does, its new values go up the same way.
  utils.updateAttribute = (attribute: object): unknown => {
    const s = streams.get(attribute);
    const a = attribute as BufferAttribute;
    if (!s?.uploaded || !s.kind || !(a.array instanceof Float32Array)) return update(attribute);
    const fold = folds.get(a) ?? null;
    if (s.kind === 'position' && !fold) return update(attribute);
    return swapped(attribute, encode(a.array, s.kind, fold), s.kind, () => update(attribute));
  };
  const vao = b._createVao.bind(b);
  b._createVao = (attributes: object[]): unknown => {
    const set: Array<[BufferAttribute, number]> = [];
    for (const a of attributes) {
      const s = streams.get(a);
      const x = a as BufferAttribute;
      // Positions too: normalized 16-bit is a native vertex format on every backend, plain integers read as floats are not.
      if (s?.uploaded && s.kind && s.kind !== 'half' && !x.normalized) {
        set.push([x, x.itemSize]);
        x.normalized = true;
        // The packed type is read four components at a time (the shader reads xyz).
        if (s.kind === 'snorm10') x.itemSize = 4;
      }
    }
    try {
      return vao(attributes);
    } finally {
      for (const [x, size] of set) {
        x.normalized = false;
        x.itemSize = size;
      }
    }
  };
  const direct = r._renderObjectDirect;
  const saved = new Float64Array(16);
  r._renderObjectDirect = function (this: unknown, object: Object3D, material: Material, ...rest: unknown[]): unknown {
    const g = (object as Object3D & { geometry?: BufferGeometry }).geometry;
    const p = g ? plans.get(g) : undefined;
    if (!p || !g) return direct.call(this, object, material, ...rest);
    if (!p.made) make(g, p, b);
    const position = g.attributes['position'];
    const fold = position ? folds.get(position) : undefined;
    if (!fold) return direct.call(this, object, material, ...rest);
    if (!plainObject(object) || readsObjectSpace(material) || readsObjectSpace(r._currentSourceMaterial)) {
      // Not drawn rather than drawn wrong (never seen: merges and batches keep their material).
      if (!revert(r, fold.attr)) {
        stats.skipped++;
        const sm = r._currentSourceMaterial as (Material & { type?: string; name?: string }) | null;
        stats.lastSkip = `${(object as Object3D & { type?: string }).type ?? '?'} ${object.name} material ${(material as Material & { type?: string }).type} pos ${String((material as { positionNode?: unknown }).positionNode != null)} src ${sm ? `${sm.type} ${sm.name} pos ${String((sm as { positionNode?: unknown }).positionNode != null)}` : 'none'}`;
        return undefined;
      }
      return direct.call(this, object, material, ...rest);
    }
    const e = object.matrixWorld.elements;
    for (let i = 0; i < 16; i++) saved[i] = e[i]!;
    const { step, cx, cy, cz } = fold;
    // The shader reads q / 32767: the scale is the grid's step times 32767.
    const scale = step * Q;
    e[12] = saved[0]! * cx + saved[4]! * cy + saved[8]! * cz + saved[12]!;
    e[13] = saved[1]! * cx + saved[5]! * cy + saved[9]! * cz + saved[13]!;
    e[14] = saved[2]! * cx + saved[6]! * cy + saved[10]! * cz + saved[14]!;
    for (const i of COLUMNS) e[i] = saved[i]! * scale;
    try {
      return direct.call(this, object, material, ...rest);
    } finally {
      for (let i = 0; i < 16; i++) e[i] = saved[i]!;
    }
  };
}
