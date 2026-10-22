/**
 * Texture sets of a project: photographed, AI-generated or procedural PBR maps (albedo, occlusion / roughness, normal) kept in the
 * project's asset store and drawn by the renderer instead of a finish's procedural maps.
 *
 * Identity, size caps and the host registry live here (pure, no I/O); storage is the host's job (the studio keeps the bytes in
 * IndexedDB with the project, packages carry `assets/tex-<id>.<map>.<tier>.webp`, bundled worlds serve them from `def.base`).
 * The renderer asks {@link textureSet} for the URLs of a set and subscribes with {@link onTextureSetsChanged}.
 */
import { TEXTURE_ID, TEXTURE_TIERS, type TextureSetDef, type TextureTier } from '@aether/core';
import { validateImage } from './import/image';

/** The three maps of a set. `orm`: R = ambient occlusion, G = roughness, B = unused (0). */
export type TextureMapName = 'albedo' | 'orm' | 'normal';
export const TEXTURE_MAPS: readonly TextureMapName[] = ['albedo', 'orm', 'normal'];

/** Size caps of stored texture maps (bytes per file, WebP) and of a project's sets. */
export const TEXTURE_LIMITS = Object.freeze({
  mapBytes: { 256: 96 * 1024, 512: 320 * 1024, 1024: 1100 * 1024 } as Readonly<Record<TextureTier, number>>,
  /** All maps and tiers of one set. */
  setBytes: 4 * 1024 * 1024,
  /** All sets of one world. */
  worldBytes: 24 * 1024 * 1024,
  maxSets: 48,
});

/** URLs of the three maps of one tier. */
export interface TextureSetFiles {
  albedo: string;
  orm: string;
  normal: string;
}

/** A set the host has registered. */
export interface TextureSetEntry {
  id: string;
  def: TextureSetDef;
  tiers: Partial<Record<TextureTier, TextureSetFiles>>;
}

/** True for ids naming texture sets. */
export function isTextureId(id: string): boolean {
  return TEXTURE_ID.test(id);
}

/** File name of one map of a set in an asset store (`tex-0123456789ab.albedo.512.webp`). */
export function textureFileName(id: string, map: TextureMapName, tier: TextureTier): string {
  return `${id}.${map}.${tier}.webp`;
}

const sets = new Map<string, TextureSetEntry>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      /* a listener must not break registration */
    }
  }
}

/** Register (or replace) a set. */
export function registerTextureSet(entry: TextureSetEntry): void {
  if (!isTextureId(entry.id)) throw new Error(`not a texture id: ${entry.id}`);
  sets.set(entry.id, entry);
  notify();
}

/** Forget a set (the host revokes its blob URLs itself). */
export function unregisterTextureSet(id: string): void {
  if (sets.delete(id)) notify();
}

/** The registered set, or null. */
export function textureSet(id: string): TextureSetEntry | null {
  return sets.get(id) ?? null;
}

/** Every registered set. */
export function textureSets(): TextureSetEntry[] {
  return [...sets.values()];
}

/** Call `fn` whenever a set is registered or forgotten. Returns the unsubscribe function. */
export function onTextureSetsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Forget every set (tests and a project switch). */
export function clearTextureSets(): void {
  if (sets.size === 0) return;
  sets.clear();
  notify();
}

/**
 * The tier to load for a wanted edge length: the largest stored tier not above it, else the smallest stored one.
 * Null when the set stores no tier at all.
 */
export function pickTextureTier(tiers: readonly TextureTier[], wanted: number): TextureTier | null {
  const have = TEXTURE_TIERS.filter((t) => tiers.includes(t));
  if (have.length === 0) return null;
  let best: TextureTier | null = null;
  for (const t of have) if (t <= wanted) best = t;
  return best ?? (have[0] as TextureTier);
}

/**
 * Register the sets of a bundled world whose records carry a `base` folder: the maps are static files next to the world
 * (`<root><base>/tex-<id>.<map>.<tier>.webp`). Sets without a `base` are left to the project's asset store.
 */
export function registerBundledTextureSets(textures: Readonly<Record<string, TextureSetDef>> | undefined, root: string): number {
  let n = 0;
  for (const [id, def] of Object.entries(textures ?? {})) {
    if (def.base === undefined || !isTextureId(id) || sets.get(id)?.def === def) continue;
    const dir = `${root}${def.base.length > 0 && !def.base.endsWith('/') ? `${def.base}/` : def.base}`;
    const tiers: TextureSetEntry['tiers'] = {};
    for (const t of def.tiers) tiers[t] = { albedo: `${dir}${textureFileName(id, 'albedo', t)}`, orm: `${dir}${textureFileName(id, 'orm', t)}`, normal: `${dir}${textureFileName(id, 'normal', t)}` };
    sets.set(id, { id, def, tiers });
    n++;
  }
  if (n > 0) notify();
  return n;
}

/** Check one stored map: an image whose header says PNG or WebP, square at the tier's edge, within the tier's byte cap. */
export function validateTextureMap(bytes: Uint8Array, tier: TextureTier): { ok: true } | { ok: false; error: string } {
  if (bytes.byteLength > TEXTURE_LIMITS.mapBytes[tier]) return { ok: false, error: `the ${tier}px map is ${Math.round(bytes.byteLength / 1024)} KB (limit ${Math.round(TEXTURE_LIMITS.mapBytes[tier] / 1024)} KB)` };
  const r = validateImage(bytes);
  if (!r.ok) return { ok: false, error: r.error };
  if (r.info.format === 'jpeg') return { ok: false, error: 'texture maps are WebP or PNG (JPEG has no lossless normals)' };
  if (r.info.width !== tier || r.info.height !== tier) return { ok: false, error: `the map is ${r.info.width}x${r.info.height}, expected ${tier}x${tier}` };
  return { ok: true };
}

/** Provenance wording shown in the UI and the credits (one place, so every surface says the same thing). */
export const TEXTURE_PROVENANCE_LABEL: Readonly<Record<TextureSetDef['provenance'], string>> = Object.freeze({
  photographed: 'photographed (sampled from your photo)',
  'ai-generated': 'AI-generated',
  procedural: 'procedural (made by the app)',
});
