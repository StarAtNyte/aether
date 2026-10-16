import { reviveChat } from '../lib/chat';
import { exportWorld, parseWorldImport, validateImportedValue } from '../lib/worldIO';
import { MAX_PROJECT_CHARS, MAX_PROJECTS, MAX_THUMBNAIL_BYTES, PROJECTS_SCHEMA_VERSION, cleanProjectName, newProjectId, parseProjectMeta, } from './model';
const CHANNEL = 'aether-projects';
/** Image types accepted as thumbnails (never SVG). */
const THUMB_TYPE = /^image\/(webp|jpeg|png)$/;
function ok(value) {
    return { ok: true, value };
}
function fail(error) {
    return { ok: false, error };
}
/** User-facing text for a storage failure (quota errors get actionable advice). */
export function storageErrorMessage(err) {
    const name = typeof err === 'object' && err !== null && 'name' in err ? String(err.name) : '';
    if (name === 'QuotaExceededError' || /quota/i.test(String(err)))
        return 'Browser storage is full. Export or delete some projects, then try again.';
    const msg = err instanceof Error ? err.message : String(err);
    return `Could not save to browser storage (${msg.slice(0, 120)}).`;
}
function entityCount(world) {
    return Object.keys(world.entities).length;
}
/** Projects repository. See module docs. */
export class ProjectRepo {
    backend;
    now;
    newId;
    listeners = new Set();
    channel;
    /**
     * @param backend storage backend
     * @param now clock (injectable for tests)
     * @param newId id generator (injectable for tests)
     */
    constructor(backend, now = Date.now, newId = () => newProjectId()) {
        this.backend = backend;
        this.now = now;
        this.newId = newId;
        let channel = null;
        try {
            if (typeof BroadcastChannel !== 'undefined') {
                channel = new BroadcastChannel(CHANNEL);
                // Only the fact that something changed crosses tabs; the data is re-read and re-validated.
                channel.onmessage = () => this.emit(false);
            }
        }
        catch {
            channel = null;
        }
        this.channel = channel;
    }
    /** True when projects survive a reload (IndexedDB available). */
    get persistent() {
        return this.backend.persistent;
    }
    /** Listen for changes (this tab or another). Returns an unsubscribe function. */
    subscribe(fn) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }
    emit(broadcast = true) {
        for (const fn of [...this.listeners])
            fn();
        if (broadcast) {
            try {
                this.channel?.postMessage('changed');
            }
            catch {
                /* channel closed */
            }
        }
    }
    /** All valid projects, most recently updated first. Invalid records are skipped. */
    async list() {
        let raw = [];
        try {
            raw = await this.backend.listMeta();
        }
        catch {
            return [];
        }
        const out = [];
        for (const r of raw.slice(0, MAX_PROJECTS * 2)) {
            const m = parseProjectMeta(r);
            if (m)
                out.push(m);
        }
        return out.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    /** One project's metadata (null when missing or invalid). */
    async meta(id) {
        try {
            return parseProjectMeta(await this.backend.getMeta(id));
        }
        catch {
            return null;
        }
    }
    serialize(id, world, chat) {
        const data = { id, world, chat: [...chat] };
        let size = 0;
        try {
            size = JSON.stringify(data).length;
        }
        catch {
            return fail('The project could not be serialized.');
        }
        if (size > MAX_PROJECT_CHARS)
            return fail(`The project is too large to save (${Math.round(size / 1024 / 1024)} MB, limit ${Math.round(MAX_PROJECT_CHARS / 1024 / 1024)} MB).`);
        return ok(data);
    }
    /** Create a project. */
    async create(input) {
        const existing = await this.list();
        if (existing.length >= MAX_PROJECTS)
            return fail(`You have ${MAX_PROJECTS} projects, the most this browser keeps. Delete some first.`);
        const name = cleanProjectName(input.name ?? input.world.name) || 'Untitled world';
        const world = input.world.name === name ? input.world : { ...input.world, name };
        const id = this.newId();
        const data = this.serialize(id, world, input.chat ?? []);
        if (!data.ok)
            return data;
        const t = this.now();
        const meta = {
            v: PROJECTS_SCHEMA_VERSION,
            id,
            name,
            createdAt: t,
            updatedAt: t,
            openedAt: t,
            template: input.template ?? null,
            entityCount: entityCount(world),
            hasThumbnail: false,
        };
        try {
            await this.backend.put(meta, data.value);
        }
        catch (err) {
            return fail(storageErrorMessage(err));
        }
        this.emit();
        return ok(meta);
    }
    /** Load and validate a project for the editor; bumps its "opened" time. */
    async open(id) {
        const meta = await this.meta(id);
        if (!meta)
            return fail('This project does not exist (it may have been deleted).');
        let raw;
        try {
            raw = await this.backend.getData(id);
        }
        catch (err) {
            return fail(storageErrorMessage(err));
        }
        const body = typeof raw === 'object' && raw !== null ? raw : null;
        if (!body)
            return fail('This project is damaged: its world is missing.');
        const r = validateImportedValue(body['world']);
        if (!r.ok)
            return fail(`This project is damaged: ${r.error}`);
        const chat = reviveChat(body['chat']);
        const opened = { ...meta, openedAt: this.now() };
        try {
            await this.backend.put(opened);
        }
        catch {
            /* the opened-at bump is cosmetic */
        }
        return ok({ meta: opened, world: r.world, chat });
    }
    /** Save the editor state (world + chat). The project name follows the world name. */
    async save(id, world, chat) {
        const meta = await this.meta(id);
        if (!meta)
            return fail('This project no longer exists.');
        const data = this.serialize(id, world, chat);
        if (!data.ok)
            return data;
        const next = { ...meta, name: cleanProjectName(world.name) || meta.name, updatedAt: this.now(), entityCount: entityCount(world) };
        try {
            await this.backend.put(next, data.value);
        }
        catch (err) {
            return fail(storageErrorMessage(err));
        }
        this.emit();
        return ok(next);
    }
    /** Rename a project (and its world). */
    async rename(id, name) {
        const clean = cleanProjectName(name);
        if (!clean)
            return fail('Enter a name.');
        const opened = await this.open(id);
        if (!opened.ok)
            return opened;
        return this.save(id, { ...opened.value.world, name: clean }, opened.value.chat);
    }
    /** Copy a project (world, chat and thumbnail) as "<name> copy". */
    async duplicate(id) {
        const opened = await this.open(id);
        if (!opened.ok)
            return opened;
        const name = cleanProjectName(`${opened.value.meta.name} copy`);
        const created = await this.create({ world: { ...opened.value.world, name }, chat: opened.value.chat, name, template: opened.value.meta.template });
        if (!created.ok)
            return created;
        const thumb = await this.thumbnail(id);
        if (thumb)
            await this.setThumbnail(created.value.id, thumb);
        return ok((await this.meta(created.value.id)) ?? created.value);
    }
    /** Delete a project. Returns what {@link restore} needs to undo it. */
    async remove(id) {
        const meta = await this.meta(id);
        if (!meta)
            return fail('This project no longer exists.');
        let data = null;
        let thumb = null;
        try {
            const raw = await this.backend.getData(id);
            if (typeof raw === 'object' && raw !== null)
                data = raw;
            thumb = await this.backend.getThumb(id);
            await this.backend.remove(id);
        }
        catch (err) {
            return fail(storageErrorMessage(err));
        }
        this.emit();
        return ok({ meta, data, thumb });
    }
    /** Undo a {@link remove}. */
    async restore(deleted) {
        const meta = parseProjectMeta(deleted.meta);
        if (!meta)
            return fail('Nothing to restore.');
        try {
            await this.backend.put(meta, deleted.data ?? undefined);
            if (deleted.thumb)
                await this.backend.putThumb(meta.id, deleted.thumb);
        }
        catch (err) {
            return fail(storageErrorMessage(err));
        }
        this.emit();
        return ok(meta);
    }
    /** Store a thumbnail (≤ {@link MAX_THUMBNAIL_BYTES}, image/* only). */
    async setThumbnail(id, blob) {
        if (blob.size === 0 || blob.size > MAX_THUMBNAIL_BYTES)
            return fail('Thumbnail too large.');
        if (!THUMB_TYPE.test(blob.type))
            return fail('Unsupported thumbnail type.');
        const meta = await this.meta(id);
        if (!meta)
            return fail('This project no longer exists.');
        try {
            await this.backend.putThumb(id, blob);
            if (!meta.hasThumbnail)
                await this.backend.put({ ...meta, hasThumbnail: true });
        }
        catch (err) {
            return fail(storageErrorMessage(err));
        }
        this.emit();
        return ok(true);
    }
    /** The stored thumbnail, or null. */
    async thumbnail(id) {
        try {
            const b = await this.backend.getThumb(id);
            return b && b.size > 0 && b.size <= MAX_THUMBNAIL_BYTES && THUMB_TYPE.test(b.type) ? b : null;
        }
        catch {
            return null;
        }
    }
    /** Serialized `.aether.json` export of a project. */
    async exportText(id) {
        const opened = await this.open(id);
        if (!opened.ok)
            return opened;
        return ok({ name: opened.value.meta.name, text: exportWorld(opened.value.world), world: opened.value.world });
    }
    /** Import a `.aether.json` (or bare world JSON) file as a new project. */
    async importText(text) {
        const r = parseWorldImport(text);
        if (!r.ok)
            return fail(r.error);
        return this.create({ world: r.world });
    }
    /** Release the backend and the cross-tab channel. */
    dispose() {
        this.listeners.clear();
        try {
            this.channel?.close();
        }
        catch {
            /* already closed */
        }
        this.backend.close();
    }
}
