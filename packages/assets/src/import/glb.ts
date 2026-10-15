/**
 * Validation and sanitising of user-imported glTF 2.0 models (`.glb`, or a
 * self-contained `.gltf` whose buffers and images are `data:` URIs).
 *
 * Imported files are untrusted. Before anything reaches three.js:
 * - structure: GLB header, chunk table and lengths are checked exactly;
 * - JSON: size-capped, guarded against prototype-pollution keys and node
 *   bombs (`inspectUntrusted`), then validated with zod;
 * - references: no external URIs anywhere (only embedded buffer views or
 *   `data:` URIs), so a model can never make the viewer fetch a URL;
 * - budgets: bytes, triangles, nodes, meshes, materials, textures, clips,
 *   decoded vertex data (accessors without a buffer view are zero-filled
 *   by the loader, so their declared size counts too) and texture pixels:
 *   every embedded image's header is read and its size checked before any
 *   decoder sees it (a few-KB PNG can declare 65535 × 65535 pixels);
 * - extensions: only ones the studio can decode (no Draco / Basis);
 * - names: control characters stripped, clamped to 64 characters, `extras`
 *   dropped. The output is a fresh, canonical GLB.
 */
import { inspectUntrusted } from '@aether/core';
import { z } from 'zod';
import { validateImage } from './image';

/** Budgets for one imported model. */
export interface GltfLimits {
  maxBytes: number;
  maxJsonBytes: number;
  maxTriangles: number;
  maxNodes: number;
  maxMeshes: number;
  maxMaterials: number;
  maxTextures: number;
  maxAnimations: number;
  maxAccessors: number;
  /** Decoded size of all accessors together (bytes). */
  maxAccessorBytes: number;
  /** Longest side of one embedded texture (px). */
  maxTextureSide: number;
  /** Pixels of all embedded textures together. */
  maxTexturePixels: number;
}

export const DEFAULT_GLTF_LIMITS: GltfLimits = {
  maxBytes: 32 * 1024 * 1024,
  maxJsonBytes: 4 * 1024 * 1024,
  maxTriangles: 500_000,
  maxNodes: 4096,
  maxMeshes: 1024,
  maxMaterials: 256,
  maxTextures: 64,
  maxAnimations: 64,
  maxAccessors: 16_384,
  maxAccessorBytes: 256 * 1024 * 1024,
  maxTextureSide: 8192,
  maxTexturePixels: 80 * 1024 * 1024,
};

/** Extensions the studio's GLTFLoader can handle without extra decoders. */
export const SUPPORTED_GLTF_EXTENSIONS: ReadonlySet<string> = new Set([
  'KHR_materials_emissive_strength', 'KHR_materials_clearcoat', 'KHR_materials_ior', 'KHR_materials_specular',
  'KHR_materials_transmission', 'KHR_materials_unlit', 'KHR_materials_volume', 'KHR_materials_sheen',
  'KHR_materials_iridescence', 'KHR_materials_anisotropy', 'KHR_materials_dispersion', 'KHR_texture_transform',
  'KHR_mesh_quantization', 'EXT_meshopt_compression', 'KHR_lights_punctual', 'EXT_texture_webp', 'KHR_materials_pbrSpecularGlossiness',
]);

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const Uri = z.string().max(64 * 1024 * 1024);
const GltfJson = z
  .object({
    asset: z.object({ version: z.string().regex(/^2\.\d+$/, 'only glTF 2.x is supported') }).passthrough(),
    buffers: z.array(z.object({ byteLength: z.number().int().min(0), uri: Uri.optional() }).passthrough()).max(64).optional(),
    bufferViews: z.array(z.object({ buffer: z.number().int().min(0), byteLength: z.number().int().min(0), byteOffset: z.number().int().min(0).optional() }).passthrough()).max(16_384).optional(),
    accessors: z.array(z.object({ count: z.number().int().min(0), bufferView: z.number().int().min(0).optional(), componentType: z.number().int().optional(), type: z.string().max(16).optional() }).passthrough()).optional(),
    meshes: z.array(z.object({ primitives: z.array(z.object({ attributes: z.record(z.string(), z.number().int().min(0)), indices: z.number().int().min(0).optional(), mode: z.number().int().min(0).max(6).optional() }).passthrough()).max(256) }).passthrough()).optional(),
    nodes: z.array(z.object({}).passthrough()).optional(),
    materials: z.array(z.object({}).passthrough()).optional(),
    textures: z.array(z.object({}).passthrough()).optional(),
    images: z.array(z.object({ uri: Uri.optional(), bufferView: z.number().int().min(0).optional(), mimeType: z.string().max(64).optional() }).passthrough()).optional(),
    animations: z.array(z.object({ name: z.string().optional() }).passthrough()).optional(),
    extensionsUsed: z.array(z.string().max(128)).max(64).optional(),
    extensionsRequired: z.array(z.string().max(128)).max(64).optional(),
  })
  .passthrough();
type GltfJson = z.infer<typeof GltfJson>;

/** Facts about an accepted model. */
export interface GltfReport {
  /** Bounding-box size in model units (metres by glTF convention), after normalisation. */
  size: [number, number, number];
  triangles: number;
  nodes: number;
  meshes: number;
  materials: number;
  textures: number;
  /** Animation clip names (sanitised). */
  animations: string[];
  skinned: boolean;
}

export type GltfResult = { ok: true; glb: Uint8Array; report: GltfReport } | { ok: false; error: string };

const DATA_URI = /^data:([a-z0-9.+/-]{1,64});base64,/i;

/** Strip control / bidi characters, collapse whitespace, clamp to `max` characters. */
export function sanitizeName(name: unknown, max = 64): string {
  if (typeof name !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function fail(error: string): GltfResult {
  return { ok: false, error };
}

function decodeDataUri(uri: string, maxBytes: number): Uint8Array | null {
  const m = DATA_URI.exec(uri);
  if (!m) return null;
  const b64 = uri.slice(m[0].length);
  if ((b64.length * 3) / 4 > maxBytes) return null;
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Triangles drawn by one primitive (triangles, strips and fans; points/lines count 0). */
function primitiveTriangles(json: GltfJson, prim: { attributes: Record<string, number>; indices?: number | undefined; mode?: number | undefined }): number {
  const mode = prim.mode ?? 4;
  const accIndex = prim.indices ?? prim.attributes['POSITION'];
  const count = accIndex === undefined ? 0 : (json.accessors?.[accIndex]?.count ?? 0);
  if (mode === 4) return Math.floor(count / 3);
  if (mode === 5 || mode === 6) return Math.max(0, count - 2);
  return 0;
}

function sanitizeJson(json: GltfJson): void {
  const root = json as Record<string, unknown>;
  delete root['extras'];
  for (const key of ['scenes', 'nodes', 'meshes', 'materials', 'textures', 'images', 'samplers', 'skins', 'animations', 'cameras', 'accessors', 'bufferViews', 'buffers']) {
    const list = root[key];
    if (!Array.isArray(list)) continue;
    for (const item of list as Array<Record<string, unknown>>) {
      if (typeof item !== 'object' || item === null) continue;
      delete item['extras'];
      if ('name' in item) item['name'] = sanitizeName(item['name']);
    }
  }
}

function checkJson(json: GltfJson, limits: GltfLimits): string | null {
  for (const ext of json.extensionsRequired ?? []) if (!SUPPORTED_GLTF_EXTENSIONS.has(ext)) return `the model needs the unsupported extension ${sanitizeName(ext, 48)}`;
  if ((json.nodes?.length ?? 0) > limits.maxNodes) return `too many nodes (limit ${limits.maxNodes})`;
  if ((json.meshes?.length ?? 0) > limits.maxMeshes) return `too many meshes (limit ${limits.maxMeshes})`;
  if ((json.materials?.length ?? 0) > limits.maxMaterials) return `too many materials (limit ${limits.maxMaterials})`;
  if ((json.textures?.length ?? 0) > limits.maxTextures || (json.images?.length ?? 0) > limits.maxTextures) return `too many textures (limit ${limits.maxTextures})`;
  if ((json.animations?.length ?? 0) > limits.maxAnimations) return `too many animations (limit ${limits.maxAnimations})`;
  if ((json.accessors?.length ?? 0) > limits.maxAccessors) return `too many accessors (limit ${limits.maxAccessors})`;
  for (const img of json.images ?? []) {
    if (img.uri !== undefined && !/^data:image\/(png|jpeg|webp);base64,/i.test(img.uri)) return 'the model references an external image (embed textures in the file)';
  }
  let tris = 0;
  for (const mesh of json.meshes ?? []) for (const prim of mesh.primitives) tris += primitiveTriangles(json, prim);
  if (tris > limits.maxTriangles) return `too many triangles (${tris.toLocaleString('en-US')}, limit ${limits.maxTriangles.toLocaleString('en-US')})`;
  return null;
}

/** Bytes per component of a glTF accessor component type (unknown: the widest). */
const COMPONENT_BYTES: Readonly<Record<number, number>> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
/** Components per element of a glTF accessor type (unknown: the largest). */
const TYPE_COMPONENTS: Readonly<Record<string, number>> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

/** Decoded bytes of every accessor together (what the loader allocates). */
export function accessorBytes(json: GltfJson): number {
  let total = 0;
  for (const a of json.accessors ?? []) total += a.count * (COMPONENT_BYTES[a.componentType ?? 0] ?? 4) * (TYPE_COMPONENTS[a.type ?? ''] ?? 16);
  return total;
}

/**
 * Check the decoded-size budgets that need the binary data: accessor bytes
 * and every embedded image (format by magic bytes, side and total pixels).
 * `bin` is the (single, rebased) binary buffer.
 */
function checkPayload(json: GltfJson, bin: Uint8Array | null, limits: GltfLimits): string | null {
  if (accessorBytes(json) > limits.maxAccessorBytes) return `the model's vertex data is too large when decoded (limit ${Math.round(limits.maxAccessorBytes / 1024 / 1024)} MB)`;
  let pixels = 0;
  for (const img of json.images ?? []) {
    let bytes: Uint8Array | null = null;
    if (img.bufferView !== undefined) {
      const view = json.bufferViews?.[img.bufferView];
      if (!view || !bin) return 'an embedded image points outside the binary data';
      const at = view.byteOffset ?? 0;
      if (at + view.byteLength > bin.byteLength) return 'an embedded image points outside the binary data';
      bytes = bin.subarray(at, at + view.byteLength);
    } else if (img.uri !== undefined) {
      bytes = decodeDataUri(img.uri, limits.maxBytes);
      if (!bytes) return 'an embedded image data URI is malformed';
    } else continue;
    const r = validateImage(bytes, { maxBytes: limits.maxBytes, maxSide: limits.maxTextureSide });
    if (!r.ok) return `an embedded texture was rejected (${r.error})`;
    pixels += r.info.width * r.info.height;
    if (pixels > limits.maxTexturePixels) return `the model's textures are too large together (limit ${Math.round(limits.maxTexturePixels / 1024 / 1024)} megapixels)`;
  }
  return null;
}

type Mat = number[];

function matMul(a: Mat, b: Mat): Mat {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let v = 0;
    for (let k = 0; k < 4; k++) v += (a[k * 4 + r] as number) * (b[c * 4 + k] as number);
    o[c * 4 + r] = v;
  }
  return o;
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Local matrix of a glTF node (column-major), from `matrix` or TRS. */
function nodeMatrix(node: Record<string, unknown>): Mat {
  const m = node['matrix'];
  if (Array.isArray(m) && m.length === 16) return m.map((v) => num(v, 0));
  const t = Array.isArray(node['translation']) ? (node['translation'] as unknown[]) : [];
  const r = Array.isArray(node['rotation']) ? (node['rotation'] as unknown[]) : [];
  const sc = Array.isArray(node['scale']) ? (node['scale'] as unknown[]) : [];
  const [x, y, z, w] = [num(r[0], 0), num(r[1], 0), num(r[2], 0), num(r[3], 1)];
  const [sx, sy, sz] = [num(sc[0], 1), num(sc[1], 1), num(sc[2], 1)];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    num(t[0], 0), num(t[1], 0), num(t[2], 0), 1,
  ];
}

/**
 * World-space bounds of the default scene from accessor min/max (required
 * by the glTF spec for POSITION) and node transforms; null when unknown.
 */
export function gltfBounds(json: GltfJson): { min: [number, number, number]; max: [number, number, number] } | null {
  const root = json as Record<string, unknown>;
  const nodes = (Array.isArray(root['nodes']) ? root['nodes'] : []) as Array<Record<string, unknown>>;
  const scenes = (Array.isArray(root['scenes']) ? root['scenes'] : []) as Array<Record<string, unknown>>;
  const scene = scenes[num(root['scene'], 0)] ?? scenes[0];
  const roots = scene && Array.isArray(scene['nodes']) ? (scene['nodes'] as unknown[]) : nodes.map((_, i) => i);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const identity: Mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const stack: Array<{ i: number; m: Mat; depth: number }> = roots.filter((i): i is number => typeof i === 'number').map((i) => ({ i, m: identity, depth: 0 }));
  let visits = 0;
  while (stack.length > 0 && visits++ < 20_000) {
    const { i, m, depth } = stack.pop() as { i: number; m: Mat; depth: number };
    const node = nodes[i];
    if (!node || depth > 64) continue;
    const world = matMul(m, nodeMatrix(node));
    const meshIndex = node['mesh'];
    const mesh = typeof meshIndex === 'number' ? json.meshes?.[meshIndex] : undefined;
    for (const prim of mesh?.primitives ?? []) {
      const acc = json.accessors?.[prim.attributes['POSITION'] ?? -1] as Record<string, unknown> | undefined;
      const lo = acc?.['min'];
      const hi = acc?.['max'];
      if (!Array.isArray(lo) || !Array.isArray(hi) || lo.length < 3 || hi.length < 3) continue;
      for (let c = 0; c < 8; c++) {
        const px = num(c & 1 ? hi[0] : lo[0], 0);
        const py = num(c & 2 ? hi[1] : lo[1], 0);
        const pz = num(c & 4 ? hi[2] : lo[2], 0);
        const wx = (world[0] as number) * px + (world[4] as number) * py + (world[8] as number) * pz + (world[12] as number);
        const wy = (world[1] as number) * px + (world[5] as number) * py + (world[9] as number) * pz + (world[13] as number);
        const wz = (world[2] as number) * px + (world[6] as number) * py + (world[10] as number) * pz + (world[14] as number);
        min[0] = Math.min(min[0], wx);
        min[1] = Math.min(min[1], wy);
        min[2] = Math.min(min[2], wz);
        max[0] = Math.max(max[0], wx);
        max[1] = Math.max(max[1], wy);
        max[2] = Math.max(max[2], wz);
      }
    }
    const children = Array.isArray(node['children']) ? (node['children'] as unknown[]) : [];
    for (const c of children) if (typeof c === 'number') stack.push({ i: c, m: world, depth: depth + 1 });
  }
  if (!min.every(Number.isFinite) || !max.every(Number.isFinite)) return null;
  return { min, max };
}

/**
 * Normalise like the library: a new root node moves the model so its base
 * rests on y = 0 and it is centred on X/Z. Returns the resulting size.
 */
function normaliseRoot(json: GltfJson): [number, number, number] {
  const b = gltfBounds(json);
  if (!b) return [1, 1, 1];
  const r = (v: number): number => Math.round(v * 1000) / 1000;
  const size: [number, number, number] = [r(b.max[0] - b.min[0]), r(b.max[1] - b.min[1]), r(b.max[2] - b.min[2])];
  // Already normalised (e.g. re-importing an exported package): keep the bytes identical so ids match.
  const eps = 1e-4 * Math.max(1, ...size);
  if (Math.abs(b.min[1]) <= eps && Math.abs(b.min[0] + b.max[0]) <= eps && Math.abs(b.min[2] + b.max[2]) <= eps) return size;
  const root = json as Record<string, unknown>;
  const nodes = (Array.isArray(root['nodes']) ? root['nodes'] : (root['nodes'] = [])) as Array<Record<string, unknown>>;
  const scenes = (Array.isArray(root['scenes']) ? root['scenes'] : (root['scenes'] = [{ nodes: nodes.map((_, i) => i) }])) as Array<Record<string, unknown>>;
  const sceneIndex = num(root['scene'], 0);
  const scene = scenes[sceneIndex] ?? scenes[0];
  if (scene) {
    const children = Array.isArray(scene['nodes']) ? (scene['nodes'] as unknown[]).filter((i): i is number => typeof i === 'number') : [];
    const translation = [-(b.min[0] + b.max[0]) / 2, -b.min[1], -(b.min[2] + b.max[2]) / 2];
    nodes.push({ name: 'aether-root', translation, children });
    scene['nodes'] = [nodes.length - 1];
  }
  return size;
}

function report(json: GltfJson, size: [number, number, number]): GltfReport {
  let tris = 0;
  for (const mesh of json.meshes ?? []) for (const prim of mesh.primitives) tris += primitiveTriangles(json, prim);
  return {
    size,
    triangles: tris,
    nodes: json.nodes?.length ?? 0,
    meshes: json.meshes?.length ?? 0,
    materials: json.materials?.length ?? 0,
    textures: json.textures?.length ?? 0,
    animations: (json.animations ?? []).map((a, i) => sanitizeName(a.name) || `clip-${i + 1}`),
    skinned: Array.isArray((json as Record<string, unknown>)['skins']) && ((json as Record<string, unknown>)['skins'] as unknown[]).length > 0,
  };
}

function parseJson(bytes: Uint8Array, limits: GltfLimits): GltfJson | string {
  if (bytes.byteLength > limits.maxJsonBytes) return `the glTF JSON is too large (limit ${Math.round(limits.maxJsonBytes / 1024 / 1024)} MB)`;
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return 'the glTF JSON is not valid';
  }
  const guard = inspectUntrusted(value, { maxNodes: 2_000_000, maxStringLength: 64 * 1024 * 1024, maxDepth: 32 });
  if (!guard.ok) return `rejected glTF JSON (${guard.message})`;
  const r = GltfJson.safeParse(value);
  if (!r.success) return `not a valid glTF 2.0 file (${r.error.issues[0]?.path.join('.') ?? ''}: ${r.error.issues[0]?.message ?? 'invalid'})`;
  return r.data;
}

const pad4 = (n: number): number => (n + 3) & ~3;

/** Assemble a GLB from JSON and an optional BIN chunk. */
export function writeGlb(json: unknown, bin: Uint8Array | null): Uint8Array {
  let text = JSON.stringify(json);
  const enc = new TextEncoder();
  let jsonBytes = enc.encode(text);
  const jsonLen = pad4(jsonBytes.byteLength);
  if (jsonLen !== jsonBytes.byteLength) {
    text += ' '.repeat(jsonLen - jsonBytes.byteLength);
    jsonBytes = enc.encode(text);
  }
  const binLen = bin ? pad4(bin.byteLength) : 0;
  const total = 12 + 8 + jsonLen + (bin ? 8 + binLen : 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, GLB_MAGIC, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, CHUNK_JSON, true);
  out.set(jsonBytes, 20);
  if (bin) {
    const o = 20 + jsonLen;
    dv.setUint32(o, binLen, true);
    dv.setUint32(o + 4, CHUNK_BIN, true);
    out.set(bin, o + 8);
  }
  return out;
}

function validateGlb(bytes: Uint8Array, limits: GltfLimits): GltfResult {
  if (bytes.byteLength < 20) return fail('the file is too small to be a GLB');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== GLB_MAGIC) return fail('not a GLB file (bad magic)');
  if (dv.getUint32(4, true) !== 2) return fail('only glTF 2.0 binaries are supported');
  const total = dv.getUint32(8, true);
  if (total !== bytes.byteLength) return fail('the GLB length field does not match the file size');
  const jsonLen = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== CHUNK_JSON) return fail('the first GLB chunk must be JSON');
  if (jsonLen === 0 || 20 + jsonLen > total) return fail('the GLB JSON chunk is truncated');
  const parsed = parseJson(bytes.subarray(20, 20 + jsonLen), limits);
  if (typeof parsed === 'string') return fail(parsed);
  let bin: Uint8Array | null = null;
  const binAt = 20 + jsonLen;
  if (binAt < total) {
    if (binAt + 8 > total) return fail('the GLB binary chunk header is truncated');
    const binLen = dv.getUint32(binAt, true);
    if (dv.getUint32(binAt + 4, true) !== CHUNK_BIN) return fail('the second GLB chunk must be BIN');
    if (binAt + 8 + binLen > total) return fail('the GLB binary chunk is truncated');
    bin = bytes.subarray(binAt + 8, binAt + 8 + binLen);
  }
  const buffers = parsed.buffers ?? [];
  for (let i = 0; i < buffers.length; i++) {
    const b = buffers[i]!;
    if (b.uri !== undefined) return fail('the model references an external buffer (only self-contained files are accepted)');
    if (i !== 0) return fail('a GLB may only use its embedded binary buffer');
    if (!bin || b.byteLength > bin.byteLength) return fail('the GLB binary chunk is smaller than its buffer');
  }
  for (const v of parsed.bufferViews ?? []) {
    if (v.buffer !== 0 || !bin || (v.byteOffset ?? 0) + v.byteLength > bin.byteLength) return fail('a buffer view points outside the binary chunk');
  }
  const err = checkJson(parsed, limits) ?? checkPayload(parsed, bin, limits);
  if (err) return fail(err);
  sanitizeJson(parsed);
  const size = normaliseRoot(parsed);
  return { ok: true, glb: writeGlb(parsed, bin), report: report(parsed, size) };
}

function validateGltfJson(bytes: Uint8Array, limits: GltfLimits): GltfResult {
  const parsed = parseJson(bytes, { ...limits, maxJsonBytes: limits.maxBytes });
  if (typeof parsed === 'string') return fail(parsed);
  // Pack every data: buffer into one BIN chunk and rebase the buffer views.
  const buffers = parsed.buffers ?? [];
  const decoded: Uint8Array[] = [];
  let size = 0;
  for (const b of buffers) {
    if (b.uri === undefined || !DATA_URI.test(b.uri)) return fail('the .gltf references an external buffer: export a self-contained .glb instead');
    const data = decodeDataUri(b.uri, limits.maxBytes);
    if (!data || data.byteLength < b.byteLength) return fail('a buffer data URI is malformed');
    decoded.push(data);
    size += pad4(data.byteLength);
    if (size > limits.maxBytes) return fail('the model is too large');
  }
  const bin = new Uint8Array(size);
  const offsets: number[] = [];
  let at = 0;
  for (const d of decoded) {
    offsets.push(at);
    bin.set(d, at);
    at += pad4(d.byteLength);
  }
  for (const v of parsed.bufferViews ?? []) {
    const base = offsets[v.buffer];
    const len = decoded[v.buffer]?.byteLength;
    if (base === undefined || len === undefined || (v.byteOffset ?? 0) + v.byteLength > len) return fail('a buffer view points outside its buffer');
    (v as { byteOffset?: number }).byteOffset = base + (v.byteOffset ?? 0);
    (v as { buffer: number }).buffer = 0;
  }
  const err = checkJson(parsed, limits) ?? checkPayload(parsed, size > 0 ? bin : null, limits);
  if (err) return fail(err);
  (parsed as { buffers?: unknown }).buffers = size > 0 ? [{ byteLength: size }] : undefined;
  sanitizeJson(parsed);
  const dims = normaliseRoot(parsed);
  return { ok: true, glb: writeGlb(parsed, size > 0 ? bin : null), report: report(parsed, dims) };
}

/**
 * Validate an imported model file and return a sanitised, self-contained
 * GLB. Never throws.
 */
export function validateGltf(bytes: Uint8Array, limits: Partial<GltfLimits> = {}): GltfResult {
  const lim = { ...DEFAULT_GLTF_LIMITS, ...limits };
  try {
    if (bytes.byteLength > lim.maxBytes) return fail(`the file is too large (limit ${Math.round(lim.maxBytes / 1024 / 1024)} MB)`);
    if (bytes.byteLength >= 4 && new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true) === GLB_MAGIC) return validateGlb(bytes, lim);
    const first = bytes.findIndex((b) => b !== 0x20 && b !== 0x0a && b !== 0x0d && b !== 0x09 && b !== 0xef && b !== 0xbb && b !== 0xbf);
    if (first >= 0 && bytes[first] === 0x7b) return validateGltfJson(bytes, lim);
    return fail('not a glTF model (expected .glb or .gltf)');
  } catch (err) {
    return fail(`the model could not be read (${err instanceof Error ? err.message.slice(0, 80) : 'error'})`);
  }
}
