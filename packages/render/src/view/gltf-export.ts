/**
 * glTF export of the static scene: the world's meshes as a binary .glb
 * (three's GLTFExporter, loaded on demand — it ships with three). Only the
 * entity graph is exported: no sky, helpers, gizmos, ghosts or overlays.
 * Large scenes are refused up front (triangle cap) instead of freezing the
 * page.
 */
import { RGBAFormat, type Material, type Object3D, type Texture } from 'three';

/** Most triangles exported in one file. */
export const MAX_EXPORT_TRIANGLES = 3_000_000;
/** Largest texture side written into the file. */
export const EXPORT_MAX_TEXTURE = 1024;

/** Triangles of the visible meshes under `root` (instanced meshes count every instance). Pure. */
export function countTriangles(root: Object3D): number {
  let total = 0;
  root.traverseVisible((o) => {
    const m = o as Object3D & { isMesh?: boolean; geometry?: { index: { count: number } | null; attributes: { position?: { count: number } } }; count?: number; isInstancedMesh?: boolean };
    if (!m.isMesh || !m.geometry) return;
    const g = m.geometry;
    const tris = g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3;
    total += tris * (m.isInstancedMesh ? Math.max(0, m.count ?? 0) : 1);
  });
  return Math.round(total);
}

/** Texture slots the exporter reads. */
const MAP_KEYS = ['map', 'normalMap', 'emissiveMap', 'aoMap', 'alphaMap', 'roughnessMap', 'metalnessMap'] as const;

function drawable(img: unknown): boolean {
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
  const d = img as { data?: unknown; width?: unknown; height?: unknown };
  const w = typeof d.width === 'number' ? d.width : 0;
  const h = typeof d.height === 'number' ? d.height : 0;
  if (!(d.data instanceof Uint8Array || d.data instanceof Uint8ClampedArray) || w <= 0 || h <= 0 || w > 4096 || h > 4096 || d.data.length !== w * h * 4) return null;
  return { data: d.data, width: w, height: h };
}

/**
 * How a texture goes into the file: as is (a drawable image), converted to
 * a canvas (8-bit RGBA pixel data; the exporter draws some maps, which raw
 * data cannot be), or left out (float data, cube or compressed textures,
 * which would make the exporter throw). Pure.
 */
export function textureExportMode(tex: Pick<Texture, 'image' | 'format'> | null | undefined): 'keep' | 'canvas' | 'drop' {
  if (!tex) return 'keep';
  if (drawable(tex.image)) return 'keep';
  return rgbaPixels(tex) ? 'canvas' : 'drop';
}

/** A copy of `tex` whose image is a canvas holding its pixels (null outside a browser). */
function canvasTexture(tex: Texture): Texture | null {
  const px = rgbaPixels(tex);
  if (!px || typeof document === 'undefined' || typeof ImageData === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = px.width;
  canvas.height = px.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.putImageData(new ImageData(Uint8ClampedArray.from(px.data), px.width, px.height), 0, 0);
  const copy = tex.clone();
  copy.image = canvas;
  return copy;
}

/**
 * An export copy of `root`: the object graph is cloned (geometry shared,
 * nothing uploaded, the live scene untouched) and every material holding a
 * texture the exporter cannot read directly gets a copy with that texture
 * converted to a canvas, or left out. Call `dispose` afterwards to release
 * the copies.
 */
export function exportScene(root: Object3D): { scene: Object3D; dispose: () => void } {
  const scene = root.clone(true);
  const materials = new Map<Material, Material>();
  const textures = new Map<Texture, Texture | null>();
  const fix = (m: Material): Material => {
    const slots = m as unknown as Record<string, Texture | null | undefined>;
    if (!MAP_KEYS.some((k) => textureExportMode(slots[k]) !== 'keep')) return m;
    let copy = materials.get(m);
    if (!copy) {
      copy = m.clone();
      const cs = copy as unknown as Record<string, Texture | null | undefined>;
      for (const k of MAP_KEYS) {
        const t = cs[k];
        const mode = textureExportMode(t);
        if (!t || mode === 'keep') continue;
        if (!textures.has(t)) textures.set(t, mode === 'canvas' ? canvasTexture(t) : null);
        cs[k] = textures.get(t) ?? null;
      }
      materials.set(m, copy);
    }
    return copy;
  };
  scene.traverse((o) => {
    const holder = o as Object3D & { material?: Material | Material[] };
    if (Array.isArray(holder.material)) holder.material = holder.material.map(fix);
    else if (holder.material) holder.material = fix(holder.material);
  });
  return {
    scene,
    dispose: () => {
      materials.forEach((c) => c.dispose());
      textures.forEach((t) => t?.dispose());
    },
  };
}

/**
 * Export `root` as a binary glTF. Rejects with a readable message when the
 * scene is too large or the exporter fails.
 */
export async function exportGlb(root: Object3D, maxTriangles = MAX_EXPORT_TRIANGLES): Promise<ArrayBuffer> {
  const triangles = countTriangles(root);
  if (triangles === 0) throw new Error('there is nothing to export yet');
  if (triangles > maxTriangles) throw new Error(`the scene has ${(triangles / 1e6).toFixed(1)}M triangles (export limit ${(maxTriangles / 1e6).toFixed(0)}M)`);
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  const exporter = new GLTFExporter();
  // Textures the exporter cannot write are left out of a copy (the meshes keep their colours);
  // the live scene keeps drawing untouched while the export runs.
  const { scene, dispose } = exportScene(root);
  let out: ArrayBuffer | object;
  try {
    out = await exporter.parseAsync(scene, { binary: true, onlyVisible: true, maxTextureSize: EXPORT_MAX_TEXTURE });
  } finally {
    dispose();
  }
  if (!(out instanceof ArrayBuffer)) throw new Error('the exporter returned no binary data');
  return out;
}
