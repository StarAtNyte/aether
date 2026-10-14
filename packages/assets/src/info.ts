/**
 * Uniform facts about any asset id — library entry or user import — for
 * the renderer, physics, bounds checks and the planner. Library facts come
 * from the installed catalog; user imports are registered by the host (the
 * studio) when a project opens.
 */
import type { AssetShape } from '@aether/core';
import { catalogEntry, libraryUrl } from './registry';
import type { CatalogAnims, CatalogCollider, CatalogEntry } from './schema';
import { isUserAssetId, type UserAssetMeta } from './user';

type Vec3 = [number, number, number];

/** A registered user import: metadata, a fetchable URL (usually `blob:`) and its measured size. */
export interface UserAssetEntry {
  meta: UserAssetMeta;
  url: string;
  /** Model size in metres once measured (models), or the poster size (images). */
  size?: Vec3;
}

const users = new Map<string, UserAssetEntry>();
const listeners = new Set<() => void>();

/** Register (or replace) a user asset. */
export function registerUserAsset(entry: UserAssetEntry): void {
  users.set(entry.meta.id, entry);
  for (const l of listeners) l();
}

/** Forget a user asset (the caller revokes its URL). */
export function unregisterUserAsset(id: string): void {
  if (users.delete(id)) for (const l of listeners) l();
}

/** Every registered user asset. */
export function userAssets(): UserAssetEntry[] {
  return [...users.values()];
}

/** One registered user asset, or null. */
export function userAsset(id: string): UserAssetEntry | null {
  return users.get(id) ?? null;
}

/** Subscribe to user-asset registry changes. Returns an unsubscribe function. */
export function onUserAssetsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Default poster width for imported images (metres). */
export const POSTER_WIDTH = 1.2;
/** Poster thickness (metres). */
export const POSTER_DEPTH = 0.02;

/** Everything a consumer needs to place, draw and collide an asset. */
export interface AssetInfo {
  id: string;
  kind: 'model' | 'image' | 'hdri' | 'generator';
  /** Natural size in metres (before `fitSize`). */
  size: Vec3;
  collider: CatalogCollider;
  /** Main file URL (models, images, HDRIs); null for generators. */
  url: string | null;
  /** Lower-detail file URLs (library models only). */
  lodUrls: string[];
  anims: CatalogAnims | null;
  entry: CatalogEntry | null;
  user: UserAssetMeta | null;
}

/** Facts for an asset id, or null when it is neither in the catalog nor registered. */
export function assetInfo(id: string): AssetInfo | null {
  if (isUserAssetId(id)) {
    const u = users.get(id);
    if (!u) return null;
    const kind = u.meta.kind;
    let size: Vec3 = u.size ?? (u.meta.size ? [u.meta.size[0], u.meta.size[1], u.meta.size[2]] : [1, 1, 1]);
    if (kind === 'image' && !u.size) {
      const aspect = (u.meta.height ?? 1) / (u.meta.width ?? 1);
      size = [POSTER_WIDTH, POSTER_WIDTH * aspect, POSTER_DEPTH];
    }
    const anims: CatalogAnims | null = u.meta.clips && u.meta.clips.length > 0 ? { ...pickRoles(u.meta.clips), clips: u.meta.clips } : null;
    return { id, kind, size, collider: { type: 'box' }, url: u.url, lodUrls: [], anims, entry: null, user: u.meta };
  }
  const e = catalogEntry(id);
  if (!e) return null;
  return {
    id,
    kind: e.kind,
    size: [e.size[0], e.size[1], e.size[2]],
    collider: e.collider,
    url: e.file ? libraryUrl(e.file) : null,
    lodUrls: e.lods.map((l) => libraryUrl(l.file)),
    anims: e.anims ?? null,
    entry: e,
    user: null,
  };
}

/** The id a shape actually shows: its `variant` when the catalog lists it, else its `id`. */
export function effectiveAssetId(shape: Pick<AssetShape, 'id' | 'variant'>): string {
  if (!shape.variant || shape.variant === shape.id) return shape.id;
  const e = catalogEntry(shape.id);
  return e?.variants?.includes(shape.variant) ? shape.variant : shape.id;
}

/** Uniform scale applied for `fitSize` (1 when absent or the size is unknown). */
export function fitScale(size: Readonly<Vec3>, fitSize: number | undefined): number {
  if (fitSize === undefined) return 1;
  const largest = Math.max(size[0], size[1], size[2]);
  return largest > 1e-6 ? fitSize / largest : 1;
}

/** Displayed size of an asset shape in metres, or null when the asset is unknown. */
export function assetShapeSize(shape: Pick<AssetShape, 'id' | 'variant' | 'fitSize'>): Vec3 | null {
  const info = assetInfo(effectiveAssetId(shape));
  if (!info || info.kind === 'hdri') return null;
  const s = fitScale(info.size, shape.fitSize);
  return [info.size[0] * s, info.size[1] * s, info.size[2] * s];
}

/** Resolve idle / walk / run clip names from a list of clip names. */
export function pickRoles(clips: readonly string[]): Pick<CatalogAnims, 'idle' | 'walk' | 'run'> {
  const find = (...words: string[]): string | undefined => {
    for (const w of words) {
      const hit = clips.find((c) => c.toLowerCase() === w) ?? clips.find((c) => c.toLowerCase().includes(w));
      if (hit) return hit;
    }
    return undefined;
  };
  const out: Pick<CatalogAnims, 'idle' | 'walk' | 'run'> = {};
  const idle = find('idle', 'stand', 'breath');
  const walk = find('walk');
  const run = find('run', 'sprint', 'jog', 'gallop');
  if (idle) out.idle = idle;
  if (walk) out.walk = walk;
  if (run) out.run = run;
  return out;
}
