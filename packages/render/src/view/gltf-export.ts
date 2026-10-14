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
 * every instance) and only RGBA8 textures (procedural float or compressed
 * textures are skipped rather than failing the export). This one pipeline
 * backs both the editor's quick "Export 3D model" action ({@link exportGlb})
 * and the Publish hub ({@link exportGltf}).
 */
import { CanvasTexture, DoubleSide, Group, InstancedMesh, Mesh, MeshStandardMaterial, RGBAFormat, type Camera, type Material, type Object3D, type Texture } from 'three';
import { ENTITY_ID_KEY } from '../sync/entity-node';

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
 * How a texture goes into the file: as is (a drawable image), converted to
 * a canvas (8-bit RGBA pixel data; the exporter redraws some maps through a
 * 2D canvas, which raw data cannot go through), or left out (float data,
 * render-target, video, cube or compressed textures, which would make the
 * exporter throw). `null` means "no texture". Pure.
 */
export function textureExportMode(tex: Pick<Texture, 'image' | 'format'> | null | undefined): 'keep' | 'canvas' | 'drop' {
  if (!tex) return 'keep';
  if ((tex as { isCompressedTexture?: boolean }).isCompressedTexture) return 'drop';
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
function standardCopy(src: Material, cache: Map<Material, MeshStandardMaterial>, copies: Map<Texture, Texture>): MeshStandardMaterial {
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
  const slots = s as unknown as Record<string, Texture | null | undefined>;
  const out = m as unknown as Record<string, Texture | null>;
  for (const k of MAP_KEYS) {
    const t = slots[k];
    const mode = textureExportMode(t);
    if (!t || mode === 'drop') continue;
    out[k] = mode === 'canvas' ? canvasCopy(t, copies) : t;
  }
  cache.set(src, m);
  return m;
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
export function buildExportScene(content: Object3D, camera: Camera | null, maxTriangles = MAX_EXPORT_TRIANGLES): ExportScene {
  content.updateMatrixWorld(true);
  const root = new Group();
  root.name = 'world';
  const cache = new Map<Material, MeshStandardMaterial>();
  const copies = new Map<Texture, Texture>();
  let triangles = 0;
  let meshes = 0;
  let skipped = 0;
  const seen = new Set<string>();
  content.traverse((o) => {
    if (!(o instanceof Mesh) || (o as { isBatchedMesh?: boolean }).isBatchedMesh) return;
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
    const mats = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => standardCopy(m, cache, copies));
    const material = Array.isArray(o.material) ? mats : (mats[0] as MeshStandardMaterial);
    let node: Mesh;
    if (o instanceof InstancedMesh) {
      const im = new InstancedMesh(o.geometry, material, o.count);
      im.instanceMatrix.array.set(o.instanceMatrix.array.subarray(0, o.count * 16));
      im.instanceMatrix.needsUpdate = true;
      node = im;
    } else {
      node = new Mesh(o.geometry, material);
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
  const scene = buildExportScene(content, camera, max);
  try {
    if (scene.meshes === 0 && scene.skipped > 0) throw new Error(`the scene is over the export limit of ${max.toLocaleString('en-US')} triangles`);
    if (scene.meshes === 0) throw new Error('there is nothing to export yet');
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const exporter = new GLTFExporter();
    const binary = opts.binary !== false;
    const out = (await exporter.parseAsync(scene.root, { binary, onlyVisible: true, maxTextureSize: MAX_EXPORT_TEXTURE, includeCustomExtensions: false })) as ArrayBuffer | Record<string, unknown>;
    const data = out instanceof ArrayBuffer ? new Uint8Array(out) : JSON.stringify(out);
    return { data, meshes: scene.meshes, triangles: scene.triangles, skipped: scene.skipped };
  } finally {
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
