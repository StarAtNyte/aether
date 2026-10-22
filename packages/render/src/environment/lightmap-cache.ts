/**
 * Browser cache of baked lightmap files (see `lightmap-asset.ts`), so a world opened again shows its baked light as soon as
 * the building is built. Same rules as the light-volume cache: IndexedDB, least recently used first out under an entry
 * and byte cap, every operation best effort (a blocked database or a full quota means "no cache", never an error).
 */
import { LIGHTMAP_MAX_ASSET_BYTES } from './lightmap-asset';

export const LIGHTMAP_CACHE_MAX_ENTRIES = 8;
export const LIGHTMAP_CACHE_MAX_BYTES = 16 * 1024 * 1024;
/** Bakes quicker than this (ms) are not worth keeping. */
export const LIGHTMAP_CACHE_MIN_BAKE_MS = 1500;

/** What the controller needs of a cache. Tests inject a fake. */
export interface LightmapCache {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, bytes: Uint8Array): Promise<void>;
}

const DB = 'aether-lightmaps';
const DATA = 'data';
const META = 'meta';
const TIMEOUT_MS = 4000;

interface Meta {
  key: string;
  bytes: number;
  used: number;
}

/** IndexedDB-backed cache; null when IndexedDB is not available. */
export function createIdbLightmapCache(): LightmapCache | null {
  if (typeof indexedDB === 'undefined') return null;
  let opened: Promise<IDBDatabase | null> | null = null;
  const open = (): Promise<IDBDatabase | null> => {
    opened ??= new Promise<IDBDatabase | null>((resolve) => {
      let done = false;
      const finish = (db: IDBDatabase | null): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(db);
      };
      const timer = setTimeout(() => finish(null), TIMEOUT_MS);
      try {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(DATA)) req.result.createObjectStore(DATA);
          if (!req.result.objectStoreNames.contains(META)) req.result.createObjectStore(META, { keyPath: 'key' });
        };
        req.onsuccess = () => finish(req.result);
        req.onerror = () => finish(null);
        req.onblocked = () => finish(null);
      } catch {
        finish(null);
      }
    });
    return opened;
  };
  const wrap = <T>(req: IDBRequest<T>): Promise<T | null> =>
    new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  return {
    async get(key) {
      try {
        const db = await open();
        if (!db) return null;
        const tx = db.transaction([DATA, META], 'readwrite');
        const data = (await wrap(tx.objectStore(DATA).get(key))) as unknown;
        if (!(data instanceof Uint8Array) || data.byteLength > LIGHTMAP_MAX_ASSET_BYTES * 4) return null;
        tx.objectStore(META).put({ key, bytes: data.byteLength, used: Date.now() } satisfies Meta);
        return data;
      } catch {
        return null;
      }
    },
    async put(key, bytes) {
      try {
        const db = await open();
        if (!db) return;
        const tx = db.transaction([DATA, META], 'readwrite');
        const done = new Promise<void>((resolve) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
        });
        tx.objectStore(DATA).put(bytes, key);
        tx.objectStore(META).put({ key, bytes: bytes.byteLength, used: Date.now() } satisfies Meta);
        const metas = ((await wrap(tx.objectStore(META).getAll())) ?? []) as Meta[];
        metas.sort((p, q) => q.used - p.used);
        let total = 0;
        for (const [i, m] of metas.entries()) {
          total += m.bytes;
          if ((i >= LIGHTMAP_CACHE_MAX_ENTRIES || total > LIGHTMAP_CACHE_MAX_BYTES) && m.key !== key) {
            tx.objectStore(DATA).delete(m.key);
            tx.objectStore(META).delete(m.key);
          }
        }
        await done;
      } catch {
        /* a full quota or a closed database: the bake simply is not cached */
      }
    },
  };
}
