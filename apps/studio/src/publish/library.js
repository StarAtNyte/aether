/**
 * The publish library: what was published from this browser (history with
 * re-downloadable files), camera paths per project, and version snapshots
 * per project. Its own IndexedDB database (`aether-publish`), independent
 * of the projects schema, with an in-memory fallback where IndexedDB is
 * unavailable. Everything read back is validated (zod for records,
 * `validateWorld` for snapshot worlds) and every store is capped: oldest
 * history entries and their files go first.
 */
import { z } from 'zod';
import { validateImportedValue } from '../lib/worldIO';
import { CameraPath, normalizePath } from './cameraPath';
/** Kinds of published items. */
export const PUBLISH_KINDS = ['game', 'video', 'render', 'model', 'plan', 'link', 'hosting', 'lan'];
/** Most history entries kept. */
export const MAX_ITEMS = 300;
/** Largest stored file (bytes). */
export const MAX_BLOB_BYTES = 120 * 1024 * 1024;
/** Total bytes of stored files (oldest are dropped beyond it; their entries stay). */
export const MAX_TOTAL_BLOB_BYTES = 400 * 1024 * 1024;
/** Most snapshots per project. */
export const MAX_SNAPSHOTS = 30;
/** Largest snapshot world (characters of JSON). */
export const MAX_SNAPSHOT_CHARS = 6 * 1024 * 1024;
const Id = z.string().regex(/^[a-z0-9]{8,40}$/);
const ProjectId = z.string().regex(/^[a-z0-9]{8,32}$/);
const Timestamp = z.number().finite().nonnegative().max(8.64e15);
/** One published item. */
export const PublishedItem = z.object({
    v: z.literal(1),
    id: Id,
    projectId: ProjectId.nullable(),
    kind: z.enum(PUBLISH_KINDS),
    title: z.string().max(120),
    detail: z.string().max(200).default(''),
    createdAt: Timestamp,
    fileName: z.string().max(160).optional(),
    mime: z.string().max(80).optional(),
    size: z.number().int().nonnegative().max(2 ** 40).default(0),
    /** A public https URL (hosting) or local/LAN URL; share links are stored as files (they can be megabytes). */
    url: z.string().max(2048).regex(/^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1|\d{1,3}(\.\d{1,3}){3})(:\d+)?\/)/).optional(),
    hasBlob: z.boolean().default(false),
    /** Small JPEG/WebP data URL preview (≤ 60 KB). */
    thumb: z.string().max(80_000).regex(/^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$/).optional(),
});
/** A version snapshot of a project. */
export const Snapshot = z.object({
    v: z.literal(1),
    id: Id,
    projectId: ProjectId,
    createdAt: Timestamp,
    label: z.string().max(120),
    entityCount: z.number().int().nonnegative().max(1_000_000),
    world: z.unknown(),
});
const STORES = ['items', 'blobs', 'paths', 'snapshots'];
const DB_NAME = 'aether-publish';
const TIMEOUT_MS = 5000;
function timeout(p) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('IndexedDB timed out')), TIMEOUT_MS);
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
/** IndexedDB backend. */
export class IdbLibrary {
    db;
    persistent = true;
    constructor(db) {
        this.db = db;
    }
    static async open(factory = typeof indexedDB !== 'undefined' ? indexedDB : undefined) {
        if (!factory)
            throw new Error('IndexedDB is not available');
        const db = await timeout(new Promise((resolve, reject) => {
            const r = factory.open(DB_NAME, 1);
            r.onupgradeneeded = () => {
                for (const s of STORES)
                    if (!r.result.objectStoreNames.contains(s))
                        r.result.createObjectStore(s);
            };
            r.onsuccess = () => {
                r.result.onversionchange = () => r.result.close();
                resolve(r.result);
            };
            r.onerror = () => reject(r.error ?? new Error('IndexedDB open failed'));
            r.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
        }));
        return new IdbLibrary(db);
    }
    async all(store) {
        const v = await timeout(req(this.db.transaction(store, 'readonly').objectStore(store).getAll()));
        return Array.isArray(v) ? v : [];
    }
    async get(store, key) {
        return (await timeout(req(this.db.transaction(store, 'readonly').objectStore(store).get(key)))) ?? null;
    }
    async put(store, key, value) {
        await timeout(req(this.db.transaction(store, 'readwrite').objectStore(store).put(value, key)));
    }
    async delete(store, key) {
        await timeout(req(this.db.transaction(store, 'readwrite').objectStore(store).delete(key)));
    }
}
/** In-memory backend (tests; browsers without IndexedDB). */
export class MemoryLibrary {
    persistent = false;
    maps = { items: new Map(), blobs: new Map(), paths: new Map(), snapshots: new Map() };
    async all(store) {
        return [...this.maps[store].values()];
    }
    async get(store, key) {
        return this.maps[store].get(key) ?? null;
    }
    async put(store, key, value) {
        this.maps[store].set(key, value);
    }
    async delete(store, key) {
        this.maps[store].delete(key);
    }
}
/** A fresh random id (base36, from the platform CSPRNG). */
export function newLibraryId() {
    const bytes = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function')
        crypto.getRandomValues(bytes);
    else
        for (let i = 0; i < bytes.length; i++)
            bytes[i] = Math.floor(Math.random() * 256);
    let out = '';
    for (const b of bytes)
        out += (b % 36).toString(36);
    return out;
}
/** The library API (see module docs). */
export class PublishLibrary {
    backend;
    now;
    listeners = new Set();
    constructor(backend, now = Date.now) {
        this.backend = backend;
        this.now = now;
    }
    /** Open the IndexedDB library, or a memory one when that fails. */
    static async open() {
        try {
            return new PublishLibrary(await IdbLibrary.open());
        }
        catch {
            return new PublishLibrary(new MemoryLibrary());
        }
    }
    subscribe(fn) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }
    emit() {
        for (const fn of [...this.listeners])
            fn();
    }
    /** Every valid item, newest first (optionally of one project). */
    async items(projectId) {
        let raw = [];
        try {
            raw = await this.backend.all('items');
        }
        catch {
            return [];
        }
        const out = [];
        for (const r of raw.slice(0, MAX_ITEMS * 2)) {
            const p = PublishedItem.safeParse(r);
            if (p.success && (projectId === undefined || p.data.projectId === projectId))
                out.push(p.data);
        }
        return out.sort((a, b) => b.createdAt - a.createdAt);
    }
    /** Record a publish (and keep its file when it fits). */
    async add(input) {
        const id = newLibraryId();
        const blob = input.blob && input.blob.size > 0 && input.blob.size <= MAX_BLOB_BYTES ? input.blob : null;
        const candidate = {
            v: 1,
            id,
            projectId: input.projectId,
            kind: input.kind,
            title: input.title.slice(0, 120),
            detail: (input.detail ?? '').slice(0, 200),
            createdAt: this.now(),
            ...(input.fileName ? { fileName: input.fileName.slice(0, 160) } : {}),
            ...(input.mime ? { mime: input.mime.slice(0, 80) } : {}),
            size: input.blob?.size ?? 0,
            ...(input.url ? { url: input.url } : {}),
            hasBlob: blob !== null,
            ...(input.thumb && input.thumb.length <= 80_000 ? { thumb: input.thumb } : {}),
        };
        const parsed = PublishedItem.safeParse(candidate);
        // An unexpected URL or thumbnail never blocks the history entry: drop the field instead.
        const item = parsed.success ? parsed.data : PublishedItem.parse({ ...candidate, url: undefined, thumb: undefined });
        try {
            if (blob)
                await this.backend.put('blobs', id, blob);
            await this.backend.put('items', id, item);
            await this.trim();
        }
        catch {
            /* storage full: history is best effort */
        }
        this.emit();
        return item;
    }
    /** The stored file of an item, or null. */
    async file(id) {
        try {
            const v = await this.backend.get('blobs', id);
            return typeof Blob !== 'undefined' && v instanceof Blob ? v : null;
        }
        catch {
            return null;
        }
    }
    /** Delete an item and its file. */
    async remove(id) {
        try {
            await this.backend.delete('blobs', id);
            await this.backend.delete('items', id);
        }
        catch {
            /* ignore */
        }
        this.emit();
    }
    /** Enforce the caps: oldest entries beyond {@link MAX_ITEMS}, oldest files beyond the byte budget. */
    async trim() {
        const items = await this.items();
        for (const old of items.slice(MAX_ITEMS)) {
            await this.backend.delete('blobs', old.id);
            await this.backend.delete('items', old.id);
        }
        let total = 0;
        for (const it of items.slice(0, MAX_ITEMS)) {
            if (!it.hasBlob)
                continue;
            total += it.size;
            if (total > MAX_TOTAL_BLOB_BYTES) {
                await this.backend.delete('blobs', it.id);
                await this.backend.put('items', it.id, { ...it, hasBlob: false });
            }
        }
    }
    // -------------------------------------------------------------------------
    // Camera paths
    // -------------------------------------------------------------------------
    /** The project's saved camera path, or null. */
    async path(projectId) {
        try {
            const r = CameraPath.safeParse(await this.backend.get('paths', projectId));
            return r.success ? normalizePath(r.data) : null;
        }
        catch {
            return null;
        }
    }
    async savePath(projectId, path) {
        try {
            await this.backend.put('paths', projectId, path);
        }
        catch {
            /* best effort */
        }
    }
    // -------------------------------------------------------------------------
    // Version snapshots
    // -------------------------------------------------------------------------
    /** Snapshots of a project, newest first (without their worlds). */
    async snapshots(projectId) {
        let raw = [];
        try {
            raw = await this.backend.all('snapshots');
        }
        catch {
            return [];
        }
        const out = [];
        for (const r of raw) {
            const p = Snapshot.safeParse(r);
            if (p.success && p.data.projectId === projectId)
                out.push({ id: p.data.id, projectId: p.data.projectId, createdAt: p.data.createdAt, label: p.data.label, entityCount: p.data.entityCount });
        }
        return out.sort((a, b) => b.createdAt - a.createdAt);
    }
    /** Save a version of a project's world. Returns null (and saves nothing) when it is too large. */
    async snapshot(projectId, world, label) {
        if (!ProjectId.safeParse(projectId).success)
            return null;
        let size = 0;
        try {
            size = JSON.stringify(world).length;
        }
        catch {
            return null;
        }
        if (size > MAX_SNAPSHOT_CHARS)
            return null;
        const rec = { v: 1, id: newLibraryId(), projectId, createdAt: this.now(), label: label.replace(/\s+/g, ' ').trim().slice(0, 120) || 'Version', entityCount: Object.keys(world.entities).length, world };
        try {
            await this.backend.put('snapshots', rec.id, rec);
            const list = await this.snapshots(projectId);
            for (const old of list.slice(MAX_SNAPSHOTS))
                await this.backend.delete('snapshots', old.id);
        }
        catch {
            return null;
        }
        this.emit();
        return { id: rec.id, projectId, createdAt: rec.createdAt, label: rec.label, entityCount: rec.entityCount };
    }
    /** A snapshot's world, validated; null when missing or damaged. */
    async snapshotWorld(id) {
        try {
            const p = Snapshot.safeParse(await this.backend.get('snapshots', id));
            if (!p.success)
                return null;
            const w = validateImportedValue(p.data.world);
            return w.ok ? w.world : null;
        }
        catch {
            return null;
        }
    }
    /** Delete a snapshot. */
    async removeSnapshot(id) {
        try {
            await this.backend.delete('snapshots', id);
        }
        catch {
            /* ignore */
        }
        this.emit();
    }
}
let shared = null;
/** The page-wide library (opened once). */
export function publishLibrary() {
    shared ??= PublishLibrary.open();
    return shared;
}
