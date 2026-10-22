/**
 * Storage of the project's texture sets (photographed, AI-generated, procedural): the encoded maps of each tier in their own
 * IndexedDB database, keyed by set id and file name, so the same set is stored once whichever project uses it. Records read
 * back are untrusted: the world record is re-validated with zod and every file is checked against the tier's caps and header.
 * Without IndexedDB the sets live in memory for the session.
 */
import { TextureSetDef, TEXTURE_TIERS, type TextureTier } from '@aether/core';
import { TEXTURE_LIMITS, TEXTURE_MAPS, isTextureId, validateTextureMap, type TextureMapName } from '@aether/assets';

export const TEXTURE_DB = 'aether-textures';
const STORE_SETS = 'sets';
const STORE_FILES = 'files';
const TIMEOUT_MS = 5000;

/** A stored set. */
export interface StoredTextureSet {
  id: string;
  def: TextureSetDef;
  createdAt: number;
  /** One blob per `${map}.${tier}`. */
  files: Map<string, Blob>;
}

/** Storage backend (IndexedDB or memory). */
export interface TextureStore {
  readonly persistent: boolean;
  get(id: string): Promise<StoredTextureSet | null>;
  put(id: string, def: TextureSetDef, files: ReadonlyArray<{ map: TextureMapName; tier: TextureTier; bytes: Uint8Array }>, mime?: string): Promise<void>;
  remove(id: string): Promise<void>;
  list(): Promise<Array<{ id: string; def: TextureSetDef; createdAt: number }>>;
}

const fileKey = (map: string, tier: number): string => `${map}.${tier}`;

function timed<T>(p: Promise<T>, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`IndexedDB ${what} timed out`)), TIMEOUT_MS);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e: unknown) => { clearTimeout(t); reject(e instanceof Error ? e : new Error(String(e))); });
  });
}
const req = <T,>(r: IDBRequest<T>): Promise<T> => new Promise<T>((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed')); });
const txDone = (tx: IDBTransaction): Promise<void> => new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? new Error('aborted')); tx.onerror = () => reject(tx.error ?? new Error('failed')); });

/** Check a set's files before they are stored: the caps per tier and the whole set. Returns an error or null. */
export function checkSetFiles(def: TextureSetDef, files: ReadonlyArray<{ map: TextureMapName; tier: TextureTier; bytes: Uint8Array }>): string | null {
  let total = 0;
  for (const tier of def.tiers) {
    for (const map of TEXTURE_MAPS) {
      const f = files.find((x) => x.map === map && x.tier === tier);
      if (!f) return `the ${tier}px ${map} map is missing`;
      const v = validateTextureMap(f.bytes, tier);
      if (!v.ok) return v.error;
      total += f.bytes.byteLength;
    }
  }
  if (total > TEXTURE_LIMITS.setBytes) return `the set is ${(total / 1048576).toFixed(1)} MB (limit ${TEXTURE_LIMITS.setBytes / 1048576} MB)`;
  return null;
}

function revive(id: string, rec: unknown, blobs: Map<string, Blob>): StoredTextureSet | null {
  if (!isTextureId(id) || typeof rec !== 'object' || rec === null) return null;
  const r = rec as Record<string, unknown>;
  const def = TextureSetDef.safeParse(r['def']);
  if (!def.success) return null;
  const files = new Map<string, Blob>();
  for (const tier of def.data.tiers) for (const map of TEXTURE_MAPS) {
    const b = blobs.get(fileKey(map, tier));
    if (!(b instanceof Blob) || b.size > TEXTURE_LIMITS.mapBytes[tier]) return null;
    files.set(fileKey(map, tier), b);
  }
  return { id, def: def.data, createdAt: typeof r['createdAt'] === 'number' ? r['createdAt'] : 0, files };
}

class IdbTextureStore implements TextureStore {
  readonly persistent = true;
  constructor(private readonly db: IDBDatabase) {}

  async get(id: string): Promise<StoredTextureSet | null> {
    const tx = this.db.transaction([STORE_SETS, STORE_FILES], 'readonly');
    const rec = await timed(req<unknown>(tx.objectStore(STORE_SETS).get(id)), 'read');
    const blobs = new Map<string, Blob>();
    const def = TextureSetDef.safeParse((rec as { def?: unknown } | undefined)?.def);
    if (!def.success) return null;
    for (const tier of def.data.tiers) for (const map of TEXTURE_MAPS) {
      const b = await timed(req<unknown>(tx.objectStore(STORE_FILES).get(`${id}/${fileKey(map, tier)}`)), 'read');
      if (b instanceof Blob) blobs.set(fileKey(map, tier), b);
    }
    return revive(id, rec, blobs);
  }

  async put(id: string, def: TextureSetDef, files: ReadonlyArray<{ map: TextureMapName; tier: TextureTier; bytes: Uint8Array }>, mime = 'image/webp'): Promise<void> {
    const err = checkSetFiles(def, files);
    if (err) throw new Error(err);
    const tx = this.db.transaction([STORE_SETS, STORE_FILES], 'readwrite');
    tx.objectStore(STORE_SETS).put({ def, createdAt: Date.now() }, id);
    for (const f of files) tx.objectStore(STORE_FILES).put(new Blob([f.bytes as Uint8Array<ArrayBuffer>], { type: mime }), `${id}/${fileKey(f.map, f.tier)}`);
    await timed(txDone(tx), 'write');
  }

  async remove(id: string): Promise<void> {
    const tx = this.db.transaction([STORE_SETS, STORE_FILES], 'readwrite');
    tx.objectStore(STORE_SETS).delete(id);
    for (const tier of TEXTURE_TIERS) for (const map of TEXTURE_MAPS) tx.objectStore(STORE_FILES).delete(`${id}/${fileKey(map, tier)}`);
    await timed(txDone(tx), 'delete');
  }

  async list(): Promise<Array<{ id: string; def: TextureSetDef; createdAt: number }>> {
    const tx = this.db.transaction(STORE_SETS, 'readonly');
    const keys = await timed(req<IDBValidKey[]>(tx.objectStore(STORE_SETS).getAllKeys()), 'read');
    const vals = await timed(req<unknown[]>(tx.objectStore(STORE_SETS).getAll()), 'read');
    const out: Array<{ id: string; def: TextureSetDef; createdAt: number }> = [];
    keys.forEach((k, i) => {
      const def = TextureSetDef.safeParse((vals[i] as { def?: unknown } | undefined)?.def);
      if (typeof k === 'string' && isTextureId(k) && def.success) out.push({ id: k, def: def.data, createdAt: Number((vals[i] as { createdAt?: number }).createdAt ?? 0) });
    });
    return out;
  }
}

/** Session-only store (no IndexedDB). */
export class MemoryTextureStore implements TextureStore {
  readonly persistent = false;
  private readonly sets = new Map<string, StoredTextureSet>();

  async get(id: string): Promise<StoredTextureSet | null> {
    return this.sets.get(id) ?? null;
  }

  async put(id: string, def: TextureSetDef, files: ReadonlyArray<{ map: TextureMapName; tier: TextureTier; bytes: Uint8Array }>, mime = 'image/webp'): Promise<void> {
    const err = checkSetFiles(def, files);
    if (err) throw new Error(err);
    const m = new Map<string, Blob>();
    for (const f of files) m.set(fileKey(f.map, f.tier), new Blob([f.bytes as Uint8Array<ArrayBuffer>], { type: mime }));
    this.sets.set(id, { id, def, createdAt: Date.now(), files: m });
  }

  async remove(id: string): Promise<void> {
    this.sets.delete(id);
  }

  async list(): Promise<Array<{ id: string; def: TextureSetDef; createdAt: number }>> {
    return [...this.sets.values()].map((s) => ({ id: s.id, def: s.def, createdAt: s.createdAt }));
  }
}

/** Open the IndexedDB store, falling back to memory. */
export async function openTextureStore(factory: IDBFactory | undefined = typeof indexedDB !== 'undefined' ? indexedDB : undefined): Promise<TextureStore> {
  if (!factory) return new MemoryTextureStore();
  try {
    const db = await timed(
      new Promise<IDBDatabase>((resolve, reject) => {
        const r = factory.open(TEXTURE_DB, 1);
        r.onupgradeneeded = () => {
          if (!r.result.objectStoreNames.contains(STORE_SETS)) r.result.createObjectStore(STORE_SETS);
          if (!r.result.objectStoreNames.contains(STORE_FILES)) r.result.createObjectStore(STORE_FILES);
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
    return new IdbTextureStore(db);
  } catch {
    return new MemoryTextureStore();
  }
}
