/** Non-persistent backend (tests; fallback when IndexedDB is blocked). Values are deep-copied like structured clone. */
export class MemoryBackend {
    persistent = false;
    meta = new Map();
    data = new Map();
    thumbs = new Map();
    /** Test hook: throw this from the next `put` (e.g. a quota error). */
    failNextPut = null;
    async listMeta() {
        return [...this.meta.values()].map((s) => JSON.parse(s));
    }
    async getMeta(id) {
        const s = this.meta.get(id);
        return s === undefined ? null : JSON.parse(s);
    }
    async getData(id) {
        const s = this.data.get(id);
        return s === undefined ? null : JSON.parse(s);
    }
    async put(meta, data) {
        if (this.failNextPut) {
            const e = this.failNextPut;
            this.failNextPut = null;
            throw e;
        }
        this.meta.set(meta.id, JSON.stringify(meta));
        if (data)
            this.data.set(meta.id, JSON.stringify(data));
    }
    async getThumb(id) {
        return this.thumbs.get(id) ?? null;
    }
    async putThumb(id, blob) {
        this.thumbs.set(id, blob);
    }
    async remove(id) {
        this.meta.delete(id);
        this.data.delete(id);
        this.thumbs.delete(id);
    }
    close() {
        /* nothing to release */
    }
}
