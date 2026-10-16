/**
 * Where voxel game saves live: an IndexedDB database of its own
 * (`aether-voxel`, independent of the projects schema) with one row per
 * modified chunk and one row per player state, all keyed by a save key
 * (project + terrain identity). Rows hold the compressed bytes produced by
 * `@aether/voxel`'s save codec; everything read back is decoded by that
 * codec, which validates it. Without IndexedDB (private modes) an
 * in-memory store keeps the session working.
 */
const DB = 'aether-voxel';
const VERSION = 1;
const CHUNKS = 'chunks';
const PLAYERS = 'players';
const TIMEOUT_MS = 8000;
/** Largest row accepted from storage (a compressed chunk is a few KB). */
const MAX_ROW_BYTES = 512 * 1024;
function timeout(p, what) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`voxel save ${what} timed out`)), TIMEOUT_MS);
        p.then((v) => {
            clearTimeout(t);
            resolve(v);
        }, (e) => {
            clearTimeout(t);
            reject(e instanceof Error ? e : new Error(String(e)));
        });
    });
}
function req(r) {
    return new Promise((resolve, reject) => {
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
    });
}
function done(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    });
}
function rowKey(save, cx, cz) {
    return `${save}|${cx},${cz}`;
}
function asBytes(v) {
    if (v instanceof Uint8Array)
        return v.length <= MAX_ROW_BYTES ? v : null;
    if (v instanceof ArrayBuffer)
        return v.byteLength <= MAX_ROW_BYTES ? new Uint8Array(v) : null;
    return null;
}
/** IndexedDB-backed store. */
export class IdbVoxelStore {
    db;
    constructor(db) {
        this.db = db;
    }
    /** Open the database (rejects when IndexedDB is unavailable or blocked). */
    static async open(factory = typeof indexedDB !== 'undefined' ? indexedDB : undefined) {
        if (!factory)
            throw new Error('IndexedDB is not available');
        const db = await timeout(new Promise((resolve, reject) => {
            let r;
            try {
                r = factory.open(DB, VERSION);
            }
            catch (e) {
                reject(e instanceof Error ? e : new Error('IndexedDB open failed'));
                return;
            }
            r.onupgradeneeded = () => {
                const d = r.result;
                if (!d.objectStoreNames.contains(CHUNKS))
                    d.createObjectStore(CHUNKS);
                if (!d.objectStoreNames.contains(PLAYERS))
                    d.createObjectStore(PLAYERS);
            };
            r.onsuccess = () => {
                r.result.onversionchange = () => r.result.close();
                resolve(r.result);
            };
            r.onerror = () => reject(r.error ?? new Error('IndexedDB open failed'));
            r.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
        }), 'open');
        return new IdbVoxelStore(db);
    }
    async listChunks(save) {
        const tx = this.db.transaction(CHUNKS, 'readonly');
        const keys = await timeout(req(tx.objectStore(CHUNKS).getAllKeys(IDBKeyRange.bound(`${save}|`, `${save}|￿`))), 'list');
        const out = [];
        for (const k of keys)
            if (typeof k === 'string')
                out.push(k.slice(save.length + 1));
        return out;
    }
    async getChunk(save, cx, cz) {
        const tx = this.db.transaction(CHUNKS, 'readonly');
        return asBytes(await timeout(req(tx.objectStore(CHUNKS).get(rowKey(save, cx, cz))), 'read'));
    }
    async putChunks(save, rows) {
        if (rows.length === 0)
            return;
        const tx = this.db.transaction(CHUNKS, 'readwrite');
        const s = tx.objectStore(CHUNKS);
        for (const r of rows)
            s.put(r.bytes, rowKey(save, r.cx, r.cz));
        await timeout(done(tx), 'write');
    }
    async getPlayer(save) {
        const tx = this.db.transaction(PLAYERS, 'readonly');
        return asBytes(await timeout(req(tx.objectStore(PLAYERS).get(save)), 'read'));
    }
    async putPlayer(save, bytes) {
        const tx = this.db.transaction(PLAYERS, 'readwrite');
        tx.objectStore(PLAYERS).put(bytes, save);
        await timeout(done(tx), 'write');
    }
    async clear(save) {
        const tx = this.db.transaction([CHUNKS, PLAYERS], 'readwrite');
        tx.objectStore(CHUNKS).delete(IDBKeyRange.bound(`${save}|`, `${save}|￿`));
        tx.objectStore(PLAYERS).delete(save);
        await timeout(done(tx), 'clear');
    }
}
/** In-memory store (no IndexedDB, tests). */
export class MemoryVoxelStore {
    chunks = new Map();
    players = new Map();
    async listChunks(save) {
        const out = [];
        for (const k of this.chunks.keys())
            if (k.startsWith(`${save}|`))
                out.push(k.slice(save.length + 1));
        return out;
    }
    async getChunk(save, cx, cz) {
        return this.chunks.get(rowKey(save, cx, cz)) ?? null;
    }
    async putChunks(save, rows) {
        for (const r of rows)
            this.chunks.set(rowKey(save, r.cx, r.cz), r.bytes);
    }
    async getPlayer(save) {
        return this.players.get(save) ?? null;
    }
    async putPlayer(save, bytes) {
        this.players.set(save, bytes);
    }
    async clear(save) {
        for (const k of [...this.chunks.keys()])
            if (k.startsWith(`${save}|`))
                this.chunks.delete(k);
        this.players.delete(save);
    }
}
let shared = null;
/** The app-wide store (IndexedDB when available, memory otherwise). */
export function voxelSaveStore() {
    shared ??= IdbVoxelStore.open().catch(() => new MemoryVoxelStore());
    return shared;
}
/** Parse a "cx,cz" key (null when malformed or out of range). */
export function parseChunkKey(k) {
    const m = /^(-?\d{1,6}),(-?\d{1,6})$/.exec(k);
    if (!m)
        return null;
    const cx = Number(m[1]);
    const cz = Number(m[2]);
    return Math.abs(cx) <= 16383 && Math.abs(cz) <= 16383 ? [cx, cz] : null;
}
