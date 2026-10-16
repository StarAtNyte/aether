/**
 * The photographic block materials as GPU texture arrays: albedo (sRGB), tangent-space normals and an
 * ORM map (R ambient occlusion, G roughness, B height) per material, one array layer each, with a full
 * mip chain and anisotropic filtering. Layers repeat natively, so a block face tiles its material with
 * the hardware sampler (no atlas bleeding at any distance).
 *
 * The sheets (`public/blocks/block-{albedo,normal,orm}.webp`, a grid of material tiles plus
 * `block-materials.json`) are produced by `scripts/voxel/block-textures.ts` from CC0 ambientCG
 * scans. Everything fetched is validated and size-capped; a failure returns null and the terrain
 * keeps its procedural atlas.
 */
import { DataArrayTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, RepeatWrapping, SRGBColorSpace, UnsignedByteType } from 'three';
/** One material of the sheets (structurally the voxel package's `SheetMaterial`). */
export interface SheetMaterial {
  key: string;
  slot: number;
  /** Mean linear colour of the albedo. */
  mean: readonly [number, number, number];
}

/** Largest sheet edge accepted (pixels). */
const MAX_SHEET_EDGE = 4096;
/** Most materials in a sheet. */
const MAX_LAYERS = 64;
/** Largest index file (bytes). */
const MAX_INDEX_BYTES = 64 * 1024;

/** Loaded block material arrays. */
export interface BlockSheets {
  albedo: DataArrayTexture;
  normal: DataArrayTexture;
  orm: DataArrayTexture;
  /** Material keys, slots (= array layers) and mean linear colours. */
  materials: readonly SheetMaterial[];
  /** Tile edge in pixels. */
  size: number;
  layers: number;
  dispose(): void;
}

/** Validate `block-materials.json`: returns the grid layout and materials, or null when malformed. */
export function parseSheetIndex(raw: unknown): { size: number; columns: number; rows: number; materials: SheetMaterial[] } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const { size, columns, rows, materials } = r;
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 16 || size > 1024 || (size & (size - 1)) !== 0) return null;
  if (typeof columns !== 'number' || !Number.isInteger(columns) || columns < 1 || columns > 32) return null;
  if (typeof rows !== 'number' || !Number.isInteger(rows) || rows < 1 || rows > 32) return null;
  if (!Array.isArray(materials) || materials.length < 1 || materials.length > MAX_LAYERS || materials.length > columns * rows) return null;
  const out: SheetMaterial[] = [];
  const seen = new Set<string>();
  for (const m of materials as unknown[]) {
    if (!m || typeof m !== 'object') return null;
    const { key, slot, mean } = m as Record<string, unknown>;
    if (typeof key !== 'string' || !/^[a-z][a-z-]{1,23}$/.test(key) || seen.has(key)) return null;
    if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || slot >= columns * rows) return null;
    if (!Array.isArray(mean) || mean.length !== 3 || !mean.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1)) return null;
    seen.add(key);
    out.push({ key, slot, mean: [mean[0] as number, mean[1] as number, mean[2] as number] });
  }
  return { size, columns, rows, materials: out };
}

/** Cut a `columns × rows` sheet of `size`-pixel tiles into layers of one array (slot = row·columns + column). */
export function sheetToLayers(pixels: Uint8ClampedArray | Uint8Array, sheetWidth: number, size: number, columns: number, layers: number): Uint8Array {
  const out = new Uint8Array(size * size * 4 * layers);
  const row = size * 4;
  for (let slot = 0; slot < layers; slot++) {
    const x0 = (slot % columns) * size;
    const y0 = Math.floor(slot / columns) * size;
    for (let y = 0; y < size; y++) {
      const src = ((y0 + y) * sheetWidth + x0) * 4;
      out.set(pixels.subarray(src, src + row), (slot * size + y) * row);
    }
  }
  return out;
}

async function decodeSheet(url: string, width: number, height: number, signal?: AbortSignal): Promise<Uint8ClampedArray> {
  const res = await fetch(url, signal ? { signal } : {});
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const blob = await res.blob();
  if (blob.size > 24 * 1024 * 1024) throw new Error(`${url}: too large`);
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  try {
    if (bmp.width !== width || bmp.height !== height) throw new Error(`${url}: expected ${width}×${height}, got ${bmp.width}×${bmp.height}`);
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
    const ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error('2d canvas unavailable');
    ctx.drawImage(bmp, 0, 0);
    return ctx.getImageData(0, 0, width, height).data;
  } finally {
    bmp.close();
  }
}

function arrayTexture(data: Uint8Array, size: number, layers: number, srgb: boolean, anisotropy: number): DataArrayTexture {
  const t = new DataArrayTexture(data, size, size, layers);
  t.format = RGBAFormat;
  t.type = UnsignedByteType;
  t.colorSpace = srgb ? SRGBColorSpace : '';
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
  return t;
}

/**
 * Fetch and decode the block material sheets from `baseUrl` (e.g. `/blocks/`). Resolves null on any
 * failure (offline, blocked canvas readback, malformed index): the terrain then keeps the pixel atlas.
 */
export async function loadBlockSheets(baseUrl: string, anisotropy: number, signal?: AbortSignal): Promise<BlockSheets | null> {
  try {
    const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const res = await fetch(`${base}block-materials.json`, signal ? { signal } : {});
    if (!res.ok) return null;
    const text = await res.text();
    if (text.length > MAX_INDEX_BYTES) return null;
    const index = parseSheetIndex(JSON.parse(text));
    if (!index) return null;
    const { size, columns, rows, materials } = index;
    const w = size * columns;
    const h = size * rows;
    if (w > MAX_SHEET_EDGE || h > MAX_SHEET_EDGE) return null;
    const layers = columns * rows;
    const [a, n, o] = await Promise.all([
      decodeSheet(`${base}block-albedo.webp`, w, h, signal),
      decodeSheet(`${base}block-normal.webp`, w, h, signal),
      decodeSheet(`${base}block-orm.webp`, w, h, signal),
    ]);
    const albedo = arrayTexture(sheetToLayers(a, w, size, columns, layers), size, layers, true, anisotropy);
    const normal = arrayTexture(sheetToLayers(n, w, size, columns, layers), size, layers, false, anisotropy);
    const orm = arrayTexture(sheetToLayers(o, w, size, columns, layers), size, layers, false, anisotropy);
    return {
      albedo,
      normal,
      orm,
      materials,
      size,
      layers,
      dispose() {
        albedo.dispose();
        normal.dispose();
        orm.dispose();
      },
    };
  } catch {
    return null;
  }
}
