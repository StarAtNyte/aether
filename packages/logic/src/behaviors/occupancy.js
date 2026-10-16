/** Tracks which ids are inside a zone and reports enter/exit transitions. */
export class Occupancy {
    stamps = new Map();
    generation = 0;
    /** Number of ids currently inside. */
    get count() {
        return this.stamps.size;
    }
    /**
     * Re-evaluate occupancy. `isInside` is called for every candidate; ids that
     * were inside but are no longer inside (or no longer candidates, e.g.
     * destroyed) are reported through `onExit`.
     */
    update(candidates, isInside, onEnter, onExit) {
        const gen = ++this.generation;
        for (const id of candidates) {
            if (!isInside(id))
                continue;
            const had = this.stamps.has(id);
            this.stamps.set(id, gen);
            if (!had)
                onEnter?.(id);
        }
        if (this.stamps.size === 0)
            return;
        for (const [id, stamp] of this.stamps) {
            if (stamp === gen)
                continue;
            this.stamps.delete(id);
            onExit?.(id);
        }
    }
    /** Forget everyone. */
    clear() {
        this.stamps.clear();
    }
}
