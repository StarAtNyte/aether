/**
 * Storage of user-imported assets (models, images, HDRIs) in their own
 * IndexedDB database, keyed by content id (`user-<sha256 prefix>`), so the
 * same file imported into several projects is stored once. Records read
 * back are untrusted: metadata is re-validated with zod and the blob's size
 * must match. When IndexedDB is unavailable (some private windows) imports
 * live in memory for the session.
 *
 * Budgets: {@link MAX_USER_ASSETS} files and {@link MAX_USER_BYTES} bytes.
 */
import { GeneratorDef } from '@aether/core';
import { UserAssetMeta } from '@aether/assets';

/** Database name. */
export const ASSETS_DB = 'aether-assets';
const STORE_META = 'meta';
const STORE_BLOBS = 'blobs';
const STORE_GENERATORS = 'generators';
const DB_VERSION = 2;
/** Most saved creations (forged generators). */
export const MAX_CREATIONS = 100;
/** Largest stored creation thumbnail (data URL characters). */
const MAX_THUMB_CHARS = 200_000;
const TIMEOUT_MS = 5000;
/** Most stored imports. */
export const MAX_USER_ASSETS = 200;
/** Most stored bytes over all imports. */
export const MAX_USER_BYTES = 400 * 1024 * 1024;

/** One stored import. */
export interface StoredAsset {
  meta: UserAssetMeta;
  blob: Blob;
}

/** A forged generator saved to the user's library (editable, parametric). */
export interface Creation {
  def: GeneratorDef;
  /** Contact sheet / thumbnail of the best iteration (JPEG data URL). */
  thumb: string | null;
  /** Quality gate score 0–1 of the saved version (null without a critic). */
  score: number | null;
  createdAt: number;
}

/** Storage backend (IndexedDB or memory). */
export interface UserAssetStore {
  readonly persistent: boolean;
  list(): Promise<UserAssetMeta[]>;
  get(id: string): Promise<StoredAsset | null>;
  put(meta: UserAssetMeta, data: Uint8Array): Promise<void>;
  remove(id: string): Promise<void>;
  listCreations(): Promise<Creation[]>;
  putCreation(c: Creation): Promise<void>;
  removeCreation(id: string): Promise<void>;
}

/** Validate a creation read back from storage (null when malformed). */
export function reviveCreation(value: unknown): Creation | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const def = GeneratorDef.safeParse(v['def']);
  if (!def.success) return null;
  const thumb = typeof v['thumb'] === 'string' && v['thumb'].length <= MAX_THUMB_CHARS && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v['thumb']) ? v['thumb'] : null;
  const score = typeof v['score'] === 'number' && Number.isFinite(v['score']) ? Math.max(0, Math.min(1, v['score'])) : null;
  const createdAt = typeof v['createdAt'] === 'number' && Number.isFinite(v['createdAt']) ? v['createdAt'] : 0;
  return { def: def.data, thumb, score, createdAt };
}

function timed<T>(p: Promise<T>, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`IndexedDB ${what} timed out`)), TIMEOUT_MS);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });
}

/** Validate a metadata record read back from storage (null when malformed). */
export function reviveMeta(value: unknown): UserAssetMeta | null {
  const r = UserAssetMeta.safeParse(value);
  return r.success ? r.data : null;
}

function checkBudget(existing: readonly UserAssetMeta[], meta: UserAssetMeta): void {
  if (existing.some((m) => m.id === meta.id)) return;
  if (existing.length >= MAX_USER_ASSETS) throw new Error(`you can keep up to ${MAX_USER_ASSETS} imported files; remove some first`);
  const bytes = existing.reduce((s, m) => s + m.bytes, 0);
  if (bytes + meta.bytes > MAX_USER_BYTES) throw new Error(`imported files may use up to ${Math.round(MAX_USER_BYTES / 1024 / 1024)} MB; remove some first`);
}

class IdbAssetStore implements UserAssetStore {
  readonly persistent = true;
  constructor(private readonly db: IDBDatabase) {}

  async list(): Promise<UserAssetMeta[]> {
    const tx = this.db.transaction(STORE_META, 'readonly');
    const all = await timed(req<unknown[]>(tx.objectStore(STORE_META).getAll()), 'read');
    return (Array.isArray(all) ? all : []).map(reviveMeta).filter((m): m is UserAssetMeta => m !== null).sort((a, b) => b.createdAt - a.createdAt);
  }

  async get(id: string): Promise<StoredAsset | null> {
    const tx = this.db.transaction([STORE_META, STORE_BLOBS], 'readonly');
    const [m, b] = await timed(Promise.all([req<unknown>(tx.objectStore(STORE_META).get(id)), req<unknown>(tx.objectStore(STORE_BLOBS).get(id))]), 'read');
    const meta = reviveMeta(m);
    if (!meta || meta.id !== id || !(b instanceof Blob) || b.size !== meta.bytes) return null;
    return { meta, blob: b };
  }

  async put(meta: UserAssetMeta, data: Uint8Array): Promise<void> {
    checkBudget(await this.list(), meta);
    const tx = this.db.transaction([STORE_META, STORE_BLOBS], 'readwrite');
    tx.objectStore(STORE_META).put(meta, meta.id);
    tx.objectStore(STORE_BLOBS).put(new Blob([data as Uint8Array<ArrayBuffer>], { type: meta.mime }), meta.id);
    await timed(txDone(tx), 'write');
  }

  async remove(id: string): Promise<void> {
    const tx = this.db.transaction([STORE_META, STORE_BLOBS], 'readwrite');
    tx.objectStore(STORE_META).delete(id);
    tx.objectStore(STORE_BLOBS).delete(id);
    await timed(txDone(tx), 'delete');
  }

  async listCreations(): Promise<Creation[]> {
    const tx = this.db.transaction(STORE_GENERATORS, 'readonly');
    const all = await timed(req<unknown[]>(tx.objectStore(STORE_GENERATORS).getAll()), 'read');
    return (Array.isArray(all) ? all : []).map(reviveCreation).filter((c): c is Creation => c !== null).sort((a, b) => b.createdAt - a.createdAt);
  }

  async putCreation(c: Creation): Promise<void> {
    const existing = await this.listCreations();
    if (!existing.some((x) => x.def.id === c.def.id) && existing.length >= MAX_CREATIONS) throw new Error(`you can keep up to ${MAX_CREATIONS} creations; remove some first`);
    const tx = this.db.transaction(STORE_GENERATORS, 'readwrite');
    tx.objectStore(STORE_GENERATORS).put(c, c.def.id);
    await timed(txDone(tx), 'write');
  }

  async removeCreation(id: string): Promise<void> {
    const tx = this.db.transaction(STORE_GENERATORS, 'readwrite');
    tx.objectStore(STORE_GENERATORS).delete(id);
    await timed(txDone(tx), 'delete');
  }
}

/** Session-only store (no IndexedDB). */
export class MemoryAssetStore implements UserAssetStore {
  readonly persistent = false;
  private readonly items = new Map<string, StoredAsset>();

  async list(): Promise<UserAssetMeta[]> {
    return [...this.items.values()].map((i) => i.meta).sort((a, b) => b.createdAt - a.createdAt);
  }

  async get(id: string): Promise<StoredAsset | null> {
    return this.items.get(id) ?? null;
  }

  async put(meta: UserAssetMeta, data: Uint8Array): Promise<void> {
    checkBudget(await this.list(), meta);
    this.items.set(meta.id, { meta, blob: new Blob([data as Uint8Array<ArrayBuffer>], { type: meta.mime }) });
  }

  async remove(id: string): Promise<void> {
    this.items.delete(id);
  }

  private readonly creations = new Map<string, Creation>();

  async listCreations(): Promise<Creation[]> {
    return [...this.creations.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  async putCreation(c: Creation): Promise<void> {
    if (!this.creations.has(c.def.id) && this.creations.size >= MAX_CREATIONS) throw new Error(`you can keep up to ${MAX_CREATIONS} creations; remove some first`);
    const r = reviveCreation(c);
    if (!r) throw new Error('invalid creation');
    this.creations.set(c.def.id, r);
  }

  async removeCreation(id: string): Promise<void> {
    this.creations.delete(id);
  }
}

/** Open the IndexedDB store, falling back to memory when IndexedDB is unavailable. */
export async function openUserAssetStore(factory: IDBFactory | undefined = typeof indexedDB !== 'undefined' ? indexedDB : undefined): Promise<UserAssetStore> {
  if (!factory) return new MemoryAssetStore();
  try {
    const db = await timed(
      new Promise<IDBDatabase>((resolve, reject) => {
        const r = factory.open(ASSETS_DB, DB_VERSION);
        r.onupgradeneeded = () => {
          const d = r.result;
          if (!d.objectStoreNames.contains(STORE_META)) d.createObjectStore(STORE_META);
          if (!d.objectStoreNames.contains(STORE_BLOBS)) d.createObjectStore(STORE_BLOBS);
          // Version 2: forged generators ("creations").
          if (!d.objectStoreNames.contains(STORE_GENERATORS)) d.createObjectStore(STORE_GENERATORS);
        };
        r.onsuccess = () => {
          r.result.onversionchange = () => r.result.close();
          resolve(r.result);
        };
        r.onerror = () => reject(r.error ?? new Error('IndexedDB open failed'));
        r.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
      }),
      'open',
    );
    return new IdbAssetStore(db);
  } catch {
    return new MemoryAssetStore();
  }
}
