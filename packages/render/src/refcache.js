/**
 * Reference-counted cache: values are created on first `acquire`, shared by
 * every later `acquire` with the same key and disposed when the last holder
 * calls `release`.
 */
export class RefCache {
    disposeValue;
    entries = new Map();
    /**
     * @param disposeValue called exactly once when a value's refcount drops to zero
     *   (or on {@link clear}).
     */
    constructor(disposeValue) {
        this.disposeValue = disposeValue;
    }
    /** Get (and retain) the value for `key`, creating it with `create` if missing. */
    acquire(key, create) {
        const hit = this.entries.get(key);
        if (hit) {
            hit.refs++;
            return hit.value;
        }
        const value = create();
        this.entries.set(key, { value, refs: 1 });
        return value;
    }
    /** Retain an existing value. Returns false when the key is unknown. */
    retain(key) {
        const hit = this.entries.get(key);
        if (!hit)
            return false;
        hit.refs++;
        return true;
    }
    /** Peek without retaining. */
    peek(key) {
        return this.entries.get(key)?.value;
    }
    /** Release one reference; disposes the value at zero. Unknown keys are ignored. */
    release(key) {
        const hit = this.entries.get(key);
        if (!hit)
            return;
        hit.refs--;
        if (hit.refs <= 0) {
            this.entries.delete(key);
            this.disposeValue(hit.value);
        }
    }
    /** Current reference count of `key` (0 when absent). */
    refs(key) {
        return this.entries.get(key)?.refs ?? 0;
    }
    /** Call `fn` with every live value (no particular order). */
    forEach(fn) {
        for (const { value } of this.entries.values())
            fn(value);
    }
    /** Number of live entries. */
    get size() {
        return this.entries.size;
    }
    /** Dispose every value regardless of refcount. */
    clear() {
        for (const { value } of this.entries.values())
            this.disposeValue(value);
        this.entries.clear();
    }
}
