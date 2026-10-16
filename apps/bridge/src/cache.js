/**
 * Response cache keyed by a content hash of (backend, model, effort,
 * request). Identical requests — a retried prompt, an eval re-run — are
 * answered instantly without spending the subscription again. Bounded by
 * entry count and total bytes (LRU).
 */
import { createHash } from 'node:crypto';
import { stableStringify } from '@aether/core';
/** SHA-256 of the stable JSON of `value`. */
export function contentHash(value) {
    return createHash('sha256').update(stableStringify(value)).digest('hex');
}
/** LRU of serialized responses. */
export class ResponseCache {
    maxEntries;
    maxBytes;
    map = new Map();
    bytes = 0;
    constructor(maxEntries = 128, maxBytes = 16 * 1024 * 1024) {
        this.maxEntries = maxEntries;
        this.maxBytes = maxBytes;
    }
    get(key) {
        const hit = this.map.get(key);
        if (!hit)
            return undefined;
        this.map.delete(key);
        this.map.set(key, hit);
        return hit.v;
    }
    set(key, v) {
        const bytes = stableStringify(v).length;
        if (bytes > this.maxBytes / 4)
            return;
        const old = this.map.get(key);
        if (old) {
            this.bytes -= old.bytes;
            this.map.delete(key);
        }
        this.map.set(key, { v, bytes });
        this.bytes += bytes;
        while (this.map.size > this.maxEntries || this.bytes > this.maxBytes) {
            const first = this.map.keys().next();
            if (first.done)
                break;
            const e = this.map.get(first.value);
            if (e)
                this.bytes -= e.bytes;
            this.map.delete(first.value);
        }
    }
    get size() {
        return this.map.size;
    }
    get totalBytes() {
        return this.bytes;
    }
}
