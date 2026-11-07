/**
 * glTF / GLB export of what the renderer draws. The scene content is
 * flattened into a fresh export graph (world transforms baked into each
 * node): every mesh the camera renders (static-prop batches and merged
 * buildings instead of their hidden members, scatter fields and virtual
 * geometry at their current level of detail) with plain
 * `MeshStandardMaterial` copies of the node materials, so three's
 * `GLTFExporter` (loaded lazily) writes clean PBR materials. Editor
 * overlays, the sky and helpers are never part of it.
 *
 * Budgets keep exports bounded: a triangle cap (instanced meshes count
 * every instance) and only RGBA8 textures (procedural float textures are
 * skipped rather than failing the export). Block-compressed (KTX2) library
 * textures are decompressed by the exporter through a WebGL2 context when
 * that context can sample their format, and skipped otherwise. This one pipeline
 * backs both the editor's quick "Export 3D model" action ({@link exportGlb})
 * and the Publish hub ({@link exportGltf}).
 */
import { gateWorker } from '@aether/core';
import {
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  RGBAFormat,
  RGBA_ASTC_4x4_Format,
  RGBA_BPTC_Format,
  RGBA_ETC2_EAC_Format,
  RGBA_PVRTC_4BPPV1_Format,
  RGBA_S3TC_DXT1_Format,
  RGBA_S3TC_DXT5_Format,
  RGB_ETC1_Format,
  RGB_ETC2_Format,
  RGB_PVRTC_4BPPV1_Format,
  RGB_S3TC_DXT1_Format,
  NoColorSpace,
  SRGBColorSpace,
  Source,
  Vector3,
  type Camera,
  type SkinnedMesh,
  type Material,
  type Object3D,
  type Texture,
} from 'three';
import { cpuGeometry } from '../gpu/cpu-release';
import { ENTITY_ID_KEY } from '../sync/entity-node';
import { FINISH_MAPS_KEY, type AntiTileMaps } from '../materials/anti-tile';

/** Most triangles written (instances included). */
export const MAX_EXPORT_TRIANGLES = 6_000_000;
/** Largest texture side written. */
export const MAX_EXPORT_TEXTURE = 2048;

/** Result of {@link buildExportScene}. */
export interface ExportScene {
  root: Group;
  meshes: number;
  triangles: number;
  /** Meshes left out because the triangle budget was spent. */
  skipped: number;
  dispose(): void;
}

function triangleCount(mesh: Mesh): number {
  const g = mesh.geometry;
  const index = g.getIndex();
  const pos = g.getAttribute('position');
  const tris = index ? index.count / 3 : pos ? pos.count / 3 : 0;
  const drawCount = Number.isFinite(g.drawRange.count) ? Math.min(g.drawRange.count / 3, tris) : tris;
  return Math.floor(drawCount) * (mesh instanceof InstancedMesh ? mesh.count : 1);
}

/** Texture slots the export copies. */
const MAP_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap'] as const;

function isDrawable(img: unknown): boolean {
  return (
    (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement) ||
    (typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement) ||
    (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) ||
    (typeof OffscreenCanvas !== 'undefined' && img instanceof OffscreenCanvas)
  );
}

/** 8-bit RGBA pixel data of the stated size (a procedural DataTexture), or null. Pure. */
export function rgbaPixels(tex: Pick<Texture, 'image' | 'format'>): { data: Uint8Array | Uint8ClampedArray; width: number; height: number } | null {
  const img = tex.image as unknown;
  if (typeof img !== 'object' || img === null || tex.format !== RGBAFormat) return null;
  if ((tex as { isCompressedTexture?: boolean }).isCompressedTexture) return null;
  const d = img as { data?: unknown; width?: unknown; height?: unknown };
  const w = typeof d.width === 'number' ? d.width : 0;
  const h = typeof d.height === 'number' ? d.height : 0;
  if (!(d.data instanceof Uint8Array || d.data instanceof Uint8ClampedArray) || w <= 0 || h <= 0 || w > 4096 || h > 4096 || d.data.length !== w * h * 4) return null;
  return { data: d.data, width: w, height: h };
}

/**
 * WebGL extensions a WebGL2 context needs to sample a block-compressed texture of `format` (`srgb`: an sRGB
 * texture), or null for formats this export never meets. Pure.
 */
export function compressedFormatExtensions(format: number, srgb: boolean): string[] | null {
  switch (format) {
    case RGBA_BPTC_Format:
      return ['EXT_texture_compression_bptc'];
    case RGB_S3TC_DXT1_Format:
    case RGBA_S3TC_DXT1_Format:
    case RGBA_S3TC_DXT5_Format:
      return srgb ? ['WEBGL_compressed_texture_s3tc', 'WEBGL_compressed_texture_s3tc_srgb'] : ['WEBGL_compressed_texture_s3tc'];
    case RGBA_ASTC_4x4_Format:
      return ['WEBGL_compressed_texture_astc'];
    case RGB_ETC1_Format:
      return ['WEBGL_compressed_texture_etc1'];
    case RGB_ETC2_Format:
    case RGBA_ETC2_EAC_Format:
      return ['WEBGL_compressed_texture_etc'];
    case RGB_PVRTC_4BPPV1_Format:
    case RGBA_PVRTC_4BPPV1_Format:
      return ['WEBGL_compressed_texture_pvrtc'];
    default:
      return null;
  }
}

let webglExtensionCache: ReadonlySet<string> | null = null;

/** Extensions of a throwaway WebGL2 context (cached; empty without a DOM or WebGL2). */
function webglExtensions(): ReadonlySet<string> {
  if (webglExtensionCache) return webglExtensionCache;
  let set = new Set<string>();
  try {
    if (typeof document !== 'undefined') {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (gl) {
        set = new Set(gl.getSupportedExtensions() ?? []);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
    }
  } catch {
    /* no WebGL2: compressed textures are left out */
  }
  webglExtensionCache = set;
  return set;
}

/** True when a WebGL2 context here can sample `tex` (a block-compressed texture), so it can be decompressed or path traced. */
export function compressedTextureUsable(tex: Pick<Texture, 'format' | 'colorSpace'>, extensions: ReadonlySet<string> = webglExtensions()): boolean {
  const need = compressedFormatExtensions(tex.format, tex.colorSpace === SRGBColorSpace);
  return need !== null && need.every((e) => extensions.has(e));
}

/** What to do with block-compressed textures: leave them out (default) or keep the usable ones. */
export type CompressedPolicy = 'drop' | 'keep';

/**
 * How a texture goes into the file: as is (a drawable image, or with
 * `compressed: 'keep'` a block-compressed texture a WebGL2 context can
 * sample), converted to a canvas (8-bit RGBA pixel data; the exporter
 * redraws some maps through a 2D canvas, which raw data cannot go through),
 * or left out (float data, render-target, video, cube or unusable
 * compressed textures, which would make the exporter throw). `null` means
 * "no texture".
 */
export function textureExportMode(tex: Pick<Texture, 'image' | 'format'> | null | undefined, compressed: CompressedPolicy = 'drop'): 'keep' | 'canvas' | 'drop' {
  if (!tex) return 'keep';
  if ((tex as { isCompressedTexture?: boolean }).isCompressedTexture) return compressed === 'keep' && compressedTextureUsable(tex as Texture) ? 'keep' : 'drop';
  if (isDrawable(tex.image)) return 'keep';
  return rgbaPixels(tex) ? 'canvas' : 'drop';
}

/**
 * A canvas-backed copy of an RGBA8 data texture (in a browser). Without a
 * DOM the data texture itself is kept (headless tests; the exporter is not
 * run there).
 */
function canvasCopy(t: Texture, copies: Map<Texture, Texture>): Texture {
  const px = rgbaPixels(t);
  if (!px || typeof document === 'undefined' || typeof ImageData === 'undefined') return t;
  const hit = copies.get(t);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = px.width;
  canvas.height = px.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return t;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(px.data.buffer, px.data.byteOffset, px.width * px.height * 4).slice(), px.width, px.height), 0, 0);
  const c = new CanvasTexture(canvas);
  c.flipY = t.flipY;
  c.wrapS = t.wrapS;
  c.wrapT = t.wrapT;
  c.magFilter = t.magFilter;
  c.minFilter = t.minFilter;
  c.repeat.copy(t.repeat);
  c.offset.copy(t.offset);
  c.rotation = t.rotation;
  c.colorSpace = t.colorSpace;
  c.channel = t.channel;
  c.name = t.name;
  copies.set(t, c);
  return c;
}

/** Plain PBR copy of a (node) material. */
function standardCopy(src: Material, cache: Map<Material, MeshStandardMaterial>, copies: Map<Texture, Texture>, compressed: CompressedPolicy): MeshStandardMaterial {
  const hit = cache.get(src);
  if (hit) return hit;
  const s = src as Material & {
    color?: { getHex(): number };
    roughness?: number;
    metalness?: number;
    emissive?: { getHex(): number };
    emissiveIntensity?: number;
    map?: Texture | null;
    normalMap?: Texture | null;
    roughnessMap?: Texture | null;
    metalnessMap?: Texture | null;
    emissiveMap?: Texture | null;
    aoMap?: Texture | null;
    vertexColors?: boolean;
  };
  const m = new MeshStandardMaterial({
    name: src.name || 'material',
    color: s.color ? s.color.getHex() : 0xcccccc,
    roughness: Number.isFinite(s.roughness) ? (s.roughness as number) : 0.8,
    metalness: Number.isFinite(s.metalness) ? (s.metalness as number) : 0,
    emissive: s.emissive ? s.emissive.getHex() : 0,
    emissiveIntensity: Number.isFinite(s.emissiveIntensity) ? (s.emissiveIntensity as number) : 1,
    transparent: src.transparent,
    opacity: src.opacity,
    alphaTest: src.alphaTest,
    side: src.side === DoubleSide ? DoubleSide : src.side,
    vertexColors: s.vertexColors === true,
  });
  const slots = { ...(s as unknown as Record<string, Texture | null | undefined>) };
  // Anti-tiled finishes sample their maps with nodes and bind none: export the textures they carry.
  const finish = src.userData[FINISH_MAPS_KEY] as AntiTileMaps | undefined;
  if (finish) {
    slots['map'] ??= finish.map;
    slots['roughnessMap'] ??= finish.orm;
    slots['normalMap'] ??= finish.normal;
  }
  const out = m as unknown as Record<string, Texture | null>;
  for (const k of MAP_KEYS) {
    const t = slots[k];
    const mode = textureExportMode(t, compressed);
    if (!t || mode === 'drop') continue;
    out[k] = mode === 'canvas' ? canvasCopy(t, copies) : t;
  }
  cache.set(src, m);
  return m;
}

const _skinV = new Vector3();

/**
 * A copy of a skinned mesh's geometry with the current pose baked into its
 * vertices (the exported graph has no skeleton, so a person would otherwise
 * be drawn in the bind pose). Positions are in the mesh's local space.
 */
function bakeSkinned(mesh: SkinnedMesh): BufferGeometry {
  const src = mesh.geometry;
  const pos = src.getAttribute('position');
  const out = new Float32Array(pos.count * 3);
  mesh.skeleton.update();
  for (let i = 0; i < pos.count; i++) {
    mesh.getVertexPosition(i, _skinV);
    out[i * 3] = _skinV.x;
    out[i * 3 + 1] = _skinV.y;
    out[i * 3 + 2] = _skinV.z;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(out, 3));
  const uv = src.getAttribute('uv');
  if (uv) g.setAttribute('uv', uv);
  const index = src.getIndex();
  if (index) g.setIndex(index);
  for (const group of src.groups) g.addGroup(group.start, group.count, group.materialIndex);
  g.computeVertexNormals();
  return g;
}

function entityOf(o: Object3D): string | null {
  for (let p: Object3D | null = o; p; p = p.parent) {
    const id = p.userData[ENTITY_ID_KEY] as unknown;
    if (typeof id === 'string') return id;
  }
  return null;
}

function visibleChain(o: Object3D, stop: Object3D): boolean {
  for (let p: Object3D | null = o; p && p !== stop; p = p.parent) if (!p.visible) return false;
  return stop.visible;
}

/** Triangles of the visible meshes under `root` (instanced meshes count every instance). Pure. */
export function countTriangles(root: Object3D): number {
  let total = 0;
  root.traverseVisible((o) => {
    if (o instanceof Mesh && o.geometry) total += triangleCount(o);
  });
  return total;
}

/**
 * Flatten what `camera` would draw under `content` into a new graph
 * (without a camera: every visible mesh). The geometries are shared with
 * the live scene (never disposed here); the material copies are released
 * by `dispose()`.
 */
export function buildExportScene(content: Object3D, camera: Camera | null, maxTriangles = MAX_EXPORT_TRIANGLES, compressed: CompressedPolicy = 'drop'): ExportScene {
  content.updateMatrixWorld(true);
  const root = new Group();
  root.name = 'world';
  const cache = new Map<Material, MeshStandardMaterial>();
  const copies = new Map<Texture, Texture>();
  let triangles = 0;
  let meshes = 0;
  let skipped = 0;
  const seen = new Set<string>();
  const baked: BufferGeometry[] = [];
  content.traverse((o) => {
    if (!(o instanceof Mesh) || (o as { isBatchedMesh?: boolean }).isBatchedMesh || o.userData['shadowOnly'] === true) return;
    if ((camera && !o.layers.test(camera.layers)) || !visibleChain(o, content)) return;
    const pos = o.geometry?.getAttribute('position');
    if (!pos || pos.count === 0) return;
    if (o instanceof InstancedMesh && o.count === 0) return;
    const tris = triangleCount(o);
    if (tris <= 0) return;
    if (triangles + tris > maxTriangles) {
      skipped++;
      return;
    }
    const mats = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => standardCopy(m, cache, copies, compressed));
    const material = Array.isArray(o.material) ? mats : (mats[0] as MeshStandardMaterial);
    let node: Mesh;
    if (o instanceof InstancedMesh) {
      const im = new InstancedMesh(o.geometry, material, o.count);
      im.instanceMatrix.array.set(o.instanceMatrix.array.subarray(0, o.count * 16));
      im.instanceMatrix.needsUpdate = true;
      node = im;
    } else if ((o as SkinnedMesh).isSkinnedMesh && (o as SkinnedMesh).skeleton) {
      const geometry = bakeSkinned(o as SkinnedMesh);
      baked.push(geometry);
      node = new Mesh(geometry, material);
    } else {
      // Render-only geometry whose CPU arrays went after upload is made again by its owner (gpu/cpu-release.ts).
      const data = cpuGeometry(o.geometry);
      if (!data) {
        skipped++;
        return;
      }
      if (data.temporary) baked.push(data.geometry);
      node = new Mesh(data.geometry, material);
    }
    o.matrixWorld.decompose(node.position, node.quaternion, node.scale);
    const id = entityOf(o) ?? 'mesh';
    let name = id;
    for (let i = 2; seen.has(name); i++) name = `${id}-${i}`;
    seen.add(name);
    node.name = name;
    root.add(node);
    triangles += tris;
    meshes++;
  });
  return {
    root,
    meshes,
    triangles,
    skipped,
    dispose: () => {
      for (const m of cache.values()) m.dispose();
      for (const g of baked) g.dispose();
      for (const t of copies.values()) {
        const img = t.image as { width?: number; height?: number } | null;
        t.dispose();
        // Release the copy's 2D backing store now rather than at GC time.
        if (img && typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement) {
          img.width = 0;
          img.height = 0;
        }
      }
      root.clear();
    },
  };
}

interface MergeSource {
  bitmap?: ImageBitmap;
  data?: Uint8ClampedArray;
  width: number;
  height: number;
  srgb: boolean;
}

/** A texture's pixels as something a worker can take (an ImageBitmap snapshot or a copy of its data), or null. */
async function mergeSource(t: Texture | null | undefined): Promise<MergeSource | null | undefined> {
  if (!t) return null;
  if ((t as { isCompressedTexture?: boolean }).isCompressedTexture) return undefined;
  const srgb = t.colorSpace === SRGBColorSpace;
  const px = rgbaPixels(t);
  if (px) return { data: new Uint8ClampedArray(px.data.buffer.slice(px.data.byteOffset, px.data.byteOffset + px.width * px.height * 4)), width: px.width, height: px.height, srgb };
  const img = t.image as { width?: number; height?: number } | null;
  if (!isDrawable(img) || typeof createImageBitmap !== 'function' || !img?.width || !img.height) return undefined;
  return { bitmap: await createImageBitmap(img as ImageBitmapSource), width: img.width, height: img.height, srgb };
}

/**
 * Give every material that has a roughness map and no (or another) metalness map the single merged texture the exporter
 * would otherwise build on the main thread (a full-size read-back per texture): the composite is made in a worker and both
 * slots then hold the same texture, which the exporter writes as it is. Anything that cannot be merged here is left alone
 * (the exporter merges it itself). Returns the textures made, for disposal.
 */
async function premergeMetalRough(root: Object3D): Promise<Texture[]> {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return [];
  const pairs = new Map<string, { rough: Texture | null; metal: Texture | null; mats: MeshStandardMaterial[] }>();
  const ids = new Map<Texture, number>();
  const idOf = (t: Texture | null): number => (t ? (ids.get(t) ?? (ids.set(t, ids.size + 1), ids.size)) : 0);
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!(m instanceof MeshStandardMaterial) || m.roughnessMap === m.metalnessMap || (!m.roughnessMap && !m.metalnessMap)) continue;
      const key = `${idOf(m.roughnessMap)}/${idOf(m.metalnessMap)}`;
      const e = pairs.get(key) ?? { rough: m.roughnessMap, metal: m.metalnessMap, mats: [] };
      if (!e.mats.includes(m)) e.mats.push(m);
      pairs.set(key, e);
    }
  });
  if (pairs.size === 0) return [];
  let worker: Worker;
  try {
    worker = gateWorker(new Worker(new URL('./metal-rough.worker.ts', import.meta.url), { type: 'module', name: 'aether-metal-rough' }), 'background');
  } catch {
    return [];
  }
  const made: Texture[] = [];
  let nextId = 0;
  const run = (req: { rough: MergeSource | null; metal: MergeSource | null }): Promise<HTMLCanvasElement | null> =>
    new Promise((resolve) => {
      const id = ++nextId;
      worker.onmessage = (e: MessageEvent): void => {
        const d = e.data as { id: number; data?: ArrayBuffer; width?: number; height?: number };
        if (d.id !== id) return;
        if (!d.data || !d.width || !d.height) return resolve(null);
        // A CPU-backed canvas (as the exporter's own merge makes): drawing and encoding it later does not wait for the GPU.
        const canvas = document.createElement('canvas');
        canvas.width = d.width;
        canvas.height = d.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.putImageData(new ImageData(new Uint8ClampedArray(d.data), d.width, d.height), 0, 0);
        resolve(canvas);
      };
      worker.onerror = (): void => resolve(null);
      const transfer: Transferable[] = [];
      for (const s of [req.rough, req.metal]) {
        if (s?.bitmap) transfer.push(s.bitmap);
        else if (s?.data) transfer.push(s.data.buffer);
      }
      worker.postMessage({ id, ...req }, transfer);
    });
  try {
    for (const e of pairs.values()) {
      const rough = await mergeSource(e.rough);
      const metal = await mergeSource(e.metal);
      if (rough === undefined || metal === undefined) {
        for (const s of [rough, metal]) s?.bitmap?.close();
        continue;
      }
      const canvas = await run({ rough, metal });
      if (!canvas) continue;
      const reference = (e.metal ?? e.rough) as Texture;
      const merged = reference.clone();
      merged.source = new Source(canvas);
      merged.colorSpace = NoColorSpace;
      merged.needsUpdate = true;
      made.push(merged);
      for (const m of e.mats) {
        m.roughnessMap = merged;
        m.metalnessMap = merged;
      }
    }
  } finally {
    worker.terminate();
  }
  return made;
}

/**
 * While the exporter runs its scratch 2D canvases are software canvases: it draws every texture to one and encodes it with
 * `toBlob`, and on a GPU-accelerated canvas that encode waits for a read-back of the GPU (seconds for a furnished room, on
 * the page). `willReadFrequently` keeps the pixels in memory. Returns the function that restores `getContext`.
 */
function softwareCanvases(): () => void {
  if (typeof HTMLCanvasElement === 'undefined') return () => undefined;
  const proto = HTMLCanvasElement.prototype as unknown as { getContext: (this: HTMLCanvasElement, type: string, attrs?: Record<string, unknown>) => unknown };
  const original = proto.getContext;
  proto.getContext = function (this: HTMLCanvasElement, type: string, attrs?: Record<string, unknown>): unknown {
    return original.call(this, type, type === '2d' ? { willReadFrequently: true, ...attrs } : attrs);
  };
  return () => {
    proto.getContext = original;
  };
}

/** Export options. */
export interface GltfExportOptions {
  /** GLB (one binary file, default) or glTF JSON with embedded buffers. */
  binary?: boolean;
  maxTriangles?: number;
}

/** Result of {@link exportGltf}. */
export interface GltfExportResult {
  /** GLB bytes, or glTF JSON text. */
  data: Uint8Array | string;
  meshes: number;
  triangles: number;
  skipped: number;
}

/**
 * Export `content` as glTF/GLB with three's GLTFExporter (lazy-loaded).
 * Rejects with a readable message when there is nothing to export or every
 * mesh is over the triangle budget (checked before the exporter loads).
 */
export async function exportGltf(content: Object3D, camera: Camera | null, opts: GltfExportOptions = {}): Promise<GltfExportResult> {
  const max = opts.maxTriangles ?? MAX_EXPORT_TRIANGLES;
  // Compressed library textures are decompressed by the exporter (WebGL2 texture utilities, loaded with it).
  const scene = buildExportScene(content, camera, max, 'keep');
  let madeTextures: Texture[] = [];
  try {
    if (scene.meshes === 0 && scene.skipped > 0) throw new Error(`the scene is over the export limit of ${max.toLocaleString('en-US')} triangles`);
    if (scene.meshes === 0) throw new Error('there is nothing to export yet');
    const [{ GLTFExporter }, textureUtils] = await Promise.all([import('three/addons/exporters/GLTFExporter.js'), import('three/addons/utils/WebGLTextureUtils.js')]);
    const merged = await premergeMetalRough(scene.root).catch(() => [] as Texture[]);
    madeTextures = merged;
    const exporter = new GLTFExporter();
    exporter.setTextureUtils(textureUtils);
    const binary = opts.binary !== false;
    const restore = softwareCanvases();
    let out: ArrayBuffer | Record<string, unknown>;
    try {
      out = (await exporter.parseAsync(scene.root, { binary, onlyVisible: true, maxTextureSize: MAX_EXPORT_TEXTURE, includeCustomExtensions: false })) as ArrayBuffer | Record<string, unknown>;
    } finally {
      restore();
    }
    const data = out instanceof ArrayBuffer ? new Uint8Array(out) : JSON.stringify(out);
    return { data, meshes: scene.meshes, triangles: scene.triangles, skipped: scene.skipped };
  } finally {
    for (const t of madeTextures) {
      const img = t.image as HTMLCanvasElement | null;
      t.dispose();
      if (img) {
        img.width = 0;
        img.height = 0;
      }
    }
    scene.dispose();
  }
}

/**
 * Export every visible mesh under `root` as one binary glTF (.glb). Rejects
 * with a readable message when the scene is empty or over the triangle cap.
 */
export async function exportGlb(root: Object3D, maxTriangles = MAX_EXPORT_TRIANGLES): Promise<ArrayBuffer> {
  const r = await exportGltf(root, null, { binary: true, maxTriangles });
  if (typeof r.data === 'string') throw new Error('the exporter returned no binary data');
  return r.data.buffer.slice(r.data.byteOffset, r.data.byteOffset + r.data.byteLength) as ArrayBuffer;
}

/** What {@link verifyGltf} found in a file. */
export interface GltfCheck {
  meshes: number;
  materials: number;
  triangles: number;
  textures: number;
}

/**
 * Parse an exported glTF / GLB back with three's GLTFLoader (lazy-loaded)
 * and count what it contains; throws when the file does not load. Every
 * GPU-less resource it created is released afterwards.
 */
export async function verifyGltf(data: Uint8Array | string): Promise<GltfCheck> {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  const input = typeof data === 'string' ? data : (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
  const gltf = await loader.parseAsync(input, '');
  const materials = new Set<unknown>();
  const textures = new Set<{ dispose(): void }>();
  let meshes = 0;
  let triangles = 0;
  gltf.scene.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    meshes++;
    const g = o.geometry;
    const index = g.getIndex();
    const pos = g.getAttribute('position');
    triangles += Math.floor((index ? index.count : pos ? pos.count : 0) / 3) * (o instanceof InstancedMesh ? o.count : 1);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      materials.add(m);
      for (const v of Object.values(m as unknown as Record<string, unknown>)) if (v && typeof v === 'object' && (v as { isTexture?: boolean }).isTexture) textures.add(v as { dispose(): void });
    }
  });
  gltf.scene.traverse((o) => {
    if (o instanceof Mesh) o.geometry.dispose();
  });
  for (const m of materials) (m as { dispose(): void }).dispose();
  for (const t of textures) t.dispose();
  return { meshes, materials: materials.size, triangles, textures: textures.size };
}
