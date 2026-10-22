/**
 * Texture sharpness at grazing angles: floors and long walls seen at a low angle blur (or crawl, when a texture has no mip chain)
 * unless the sampler is anisotropic. 16 is the usual hardware ceiling; three clamps it to what the GPU reports.
 */
import type { Material, Object3D, Texture } from 'three';

/** Anisotropy asked of every colour, normal and ORM map. */
export const TEXTURE_ANISOTROPY = 16;

const MAP_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'bumpMap', 'displacementMap', 'alphaMap'] as const;

/** Ask one texture for full anisotropic filtering (never lowers a value already set higher). Returns whether it changed. */
export function sharpen(tex: Texture | null | undefined): boolean {
  if (!tex || tex.anisotropy >= TEXTURE_ANISOTROPY) return false;
  tex.anisotropy = TEXTURE_ANISOTROPY;
  tex.needsUpdate = true;
  return true;
}

/** Sharpen every map of one material. */
export function sharpenMaterial(m: Material): void {
  const rec = m as unknown as Record<string, Texture | null | undefined>;
  for (const k of MAP_KEYS) sharpen(rec[k]);
}

/** Sharpen every map of every mesh material below `root` (loaded models arrive with the loader's default of 1). */
export function sharpenObject(root: Object3D): void {
  root.traverse((o) => {
    const mat = (o as { material?: Material | Material[] }).material;
    if (!mat) return;
    for (const m of Array.isArray(mat) ? mat : [mat]) sharpenMaterial(m);
  });
}
