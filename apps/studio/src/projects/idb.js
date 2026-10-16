import { PROJECTS_SCHEMA_VERSION } from './model';
/** Database name. */
export const DB_NAME = 'aether-studio';
const STORE_META = 'meta';
const STORE_DATA = 'data';
const STORE_THUMBS = 'thumbs';
/** Longest wait for any IndexedDB operation (ms). */
export const IDB_TIMEOUT_MS = 5000;
function withTimeout(p, what) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`IndexedDB ${what} timed out`)), IDB_TIMEOUT_MS);
        p.then((v) => {
            clearTimeout(timer);
            resolve(v);
        }, (e) => {
            clearTimeout(timer);
            reject(e instanceof Error ? e : new Error(String(e)));
        });
    });
}
function request(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
    });
}
function done(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    });
}
/** Open (and create/upgrade) the projects database. Rejects when IndexedDB is unavailable. */
export async function openProjectsDb(factory = typeof indexedDB !== 'undefined' ? indexedDB : undefined) {
    if (!factory)
        throw new Error('IndexedDB is not available');
    const open = new Promise((resolve, reject) => {
        let req;
        try {
            req = factory.open(DB_NAME, PROJECTS_SCHEMA_VERSION);
        }
        catch (e) {
            reject(e instanceof Error ? e : new Error('IndexedDB open failed'));
            return;
        }
        req.onupgradeneeded = () => {
            const db = req.result;
            // Version 1: initial layout. Later versions add migrations here, keyed on event.oldVersion.
            if (!db.objectStoreNames.contains(STORE_META))
                db.createObjectStore(STORE_META, { keyPath: 'id' });
            if (!db.objectStoreNames.contains(STORE_DATA))
                db.createObjectStore(STORE_DATA, { keyPath: 'id' });
            if (!db.objectStoreNames.contains(STORE_THUMBS))
                db.createObjectStore(STORE_THUMBS);
        };
        req.onsuccess = () => {
            const db = req.result;
            // Another tab upgrading the schema: step aside so it is not blocked forever.
            db.onversionchange = () => db.close();
            resolve(db);
        };
        req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
        req.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
    });
    return withTimeout(open, 'open');
}
/** IndexedDB-backed {@link ProjectBackend}. */
export class IdbBackend {
    db;
    persistent = true;
    constructor(db) {
        this.db = db;
    }
    /** Open the database and wrap it. */
    static async open(factory) {
        return new IdbBackend(await openProjectsDb(factory));
    }
    read(store, fn) {
        return withTimeout((async () => {
            const tx = this.db.transaction(store, 'readonly');
            return request(fn(tx.objectStore(store)));
        })(), 'read');
    }
    async listMeta() {
        const all = await this.read(STORE_META, (s) => s.getAll());
        return Array.isArray(all) ? all : [];
    }
    async getMeta(id) {
        return (await this.read(STORE_META, (s) => s.get(id))) ?? null;
    }
    async getData(id) {
        return (await this.read(STORE_DATA, (s) => s.get(id))) ?? null;
    }
    async put(meta, data) {
        const stores = data ? [STORE_META, STORE_DATA] : [STORE_META];
        const tx = this.db.transaction(stores, 'readwrite');
        tx.objectStore(STORE_META).put(meta);
        if (data)
            tx.objectStore(STORE_DATA).put(data);
        await withTimeout(done(tx), 'write');
    }
    async getThumb(id) {
        const v = await this.read(STORE_THUMBS, (s) => s.get(id));
        return typeof Blob !== 'undefined' && v instanceof Blob ? v : null;
    }
    async putThumb(id, blob) {
        const tx = this.db.transaction(STORE_THUMBS, 'readwrite');
        tx.objectStore(STORE_THUMBS).put(blob, id);
        await withTimeout(done(tx), 'write');
    }
    async remove(id) {
        const tx = this.db.transaction([STORE_META, STORE_DATA, STORE_THUMBS], 'readwrite');
        tx.objectStore(STORE_META).delete(id);
        tx.objectStore(STORE_DATA).delete(id);
        tx.objectStore(STORE_THUMBS).delete(id);
        await withTimeout(done(tx), 'delete');
    }
    close() {
        this.db.close();
    }
}
