/**
 * From derived maps to a stored texture set: the content-hash id, the world record (`TextureSetDef`) and the encoded files of each
 * tier. Encoding to WebP is the host's job (a canvas in the browser, an encoder script in Node), so this module takes it as a function
 * and only enforces what the project's store promises: tiers, size caps, a stable id.
 */
import { TEXTURE_TIERS, type MaterialFinish, type TextureProvenance, type TextureSetDef, type TextureTier } from '@aether/core';
import { ALBEDO_SCALE, buildMaps, type PbrMaps, type SurfaceClass } from './maps';
import type { FImage } from './raster';

/** Largest bytes per stored map per tier (the project store's caps; mirrors `TEXTURE_LIMITS` of `@aether/assets`). */
export const MAP_BYTE_CAPS: Readonly<Record<TextureTier, number>> = Object.freeze({ 256: 96 * 1024, 512: 320 * 1024, 1024: 1100 * 1024 });

export type StoredMapName = 'albedo' | 'orm' | 'normal';

/** Encodes `size x size` RGBA8 pixels (WebP or PNG). `quality` is 0..1; the caller lowers it until the bytes fit. */
export type MapEncoder = (rgba: Uint8Array, size: number, map: StoredMapName, quality: number) => Promise<Uint8Array> | Uint8Array;

/** One stored file of a set. */
export interface StoredFile {
  tier: TextureTier;
  map: StoredMapName;
  bytes: Uint8Array;
}

/** A texture set ready to store: its id, world record and files. */
export interface TextureSetBuild {
  id: string;
  def: TextureSetDef;
  files: StoredFile[];
  /** Tiers dropped because their maps would not fit the caps, with the reason. */
  dropped: string[];
}

/** Everything a set needs besides its pixels. */
export interface TextureSetInfo {
  name: string;
  provenance: TextureProvenance;
  tileMetres: number;
  /** Mean colour of the source, `#rrggbb`. */
  mean: string;
  cls: SurfaceClass;
  source?: TextureSetDef['source'];
  finish?: MaterialFinish;
  /** Folder of bundled worlds (see `TextureSetDef.base`). */
  base?: string;
}

/** FNV-1a over bytes, 32 bits, with a seed (two seeds make 64 bits of id). */
function fnv(bytes: Uint8Array, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i] as number;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The id of a set: `tex-` and 12 hex characters of a hash of its 256 px maps and tile size. */
export function textureSetId(maps256: PbrMaps, tileMetres: number): string {
  const tail = new TextEncoder().encode(`|${tileMetres.toFixed(3)}`);
  const parts = [maps256.albedo, maps256.orm, maps256.normal, tail];
  let a = 0x811c9dc5;
  let b = 0x1b873593;
  for (const p of parts) {
    a = fnv(p, a);
    b = fnv(p, b ^ 0x9e3779b9);
  }
  return `tex-${a.toString(16).padStart(8, '0')}${(b & 0xffff).toString(16).padStart(4, '0')}`;
}

/** Encode one map under its cap: lower the quality until the bytes fit; null when even the lowest does not. */
async function encodeWithin(enc: MapEncoder, rgba: Uint8Array, size: TextureTier, map: StoredMapName): Promise<Uint8Array | null> {
  // Normals tolerate less loss than albedo (a blocky normal map shows as faceting under a raking light).
  const ladder = map === 'normal' ? [0.95, 0.9, 0.82, 0.7] : [0.92, 0.84, 0.72, 0.6, 0.45];
  for (const q of ladder) {
    const bytes = await enc(rgba, size, map, q);
    if (bytes.byteLength <= MAP_BYTE_CAPS[size]) return bytes;
  }
  return null;
}

/** Build a texture set from a master tile: the maps of every tier, encoded under the caps. */
export async function buildTextureSet(tile: FImage, info: TextureSetInfo, enc: MapEncoder, tiers: readonly TextureTier[] = TEXTURE_TIERS): Promise<TextureSetBuild | null> {
  const want = TEXTURE_TIERS.filter((t) => tiers.includes(t));
  const maps = new Map<TextureTier, PbrMaps>();
  for (const t of want) maps.set(t, buildMaps(tile, { tileMetres: info.tileMetres, cls: info.cls, size: t }));
  const small = maps.get(256) ?? buildMaps(tile, { tileMetres: info.tileMetres, cls: info.cls, size: 256 });
  const id = textureSetId(small, info.tileMetres);
  const files: StoredFile[] = [];
  const dropped: string[] = [];
  const kept: TextureTier[] = [];
  for (const t of want) {
    const m = maps.get(t) as PbrMaps;
    const tierFiles: StoredFile[] = [];
    let fits = true;
    for (const [map, rgba] of [['albedo', m.albedo], ['orm', m.orm], ['normal', m.normal]] as const) {
      const bytes = await encodeWithin(enc, rgba, t, map);
      if (!bytes) {
        fits = false;
        dropped.push(`${t}px ${map} does not fit ${Math.round(MAP_BYTE_CAPS[t] / 1024)} KB`);
        break;
      }
      tierFiles.push({ tier: t, map, bytes });
    }
    if (fits) {
      files.push(...tierFiles);
      kept.push(t);
    }
  }
  if (kept.length === 0) return null;
  const def: TextureSetDef = {
    name: info.name.slice(0, 64),
    provenance: info.provenance,
    tile: Math.max(0.05, Math.min(16, info.tileMetres)),
    tiers: kept as TextureSetDef['tiers'],
    albedoScale: ALBEDO_SCALE,
    mean: info.mean,
    ...(info.finish ? { finish: info.finish } : {}),
    ...(info.source ? { source: info.source } : {}),
    ...(info.base !== undefined ? { base: info.base } : {}),
  };
  return { id, def, files, dropped };
}
