const SEP = '\u0000';
/**
 * Interned ids stay below 2^15 so a pair key (< 2^30) is a small integer.
 * Worlds hold at most 5000 entities plus 1000 live spawns; when the space
 * runs out (ids churned by spawning), ids are compacted to those in contact.
 */
const ID_SPACE = 2 ** 15;
/** Distinct pairs remembered for impulse slots before the table is reset. */
const MAX_IMPULSE_SLOTS = 8192;
/** Shared empty output used between drains (never written). */
const NO_EVENTS = [];
/** Readable snapshot key of a pair (`a < b`), kept for snapshot compatibility. */
function stringKey(sensor, a, b) {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    return (sensor ? 's' : 'c') + SEP + lo + SEP + hi;
}
/** Stateful collector; one per PhysicsWorld. */
export class EventCollector {
    /** Active solid-contact counts per pair key. */
    counts = new Map();
    /** Active sensor-overlap counts per pair key. */
    sensorCounts = new Map();
    /**
     * Impulse slot per (solid) pair key. Persistent across steps: a slot is
     * valid only when its generation equals the current step's (clearing a
     * Map every step would allocate a new hash table each time).
     */
    impulseSlots = new Map();
    impulseValues = new Float64Array(64);
    impulseGens = new Int32Array(64);
    generation = 0;
    ids = new Map();
    names = [];
    nextIndex = 0;
    drainOut = NO_EVENTS;
    drainMaps = null;
    drainDt = 0;
    drainEmit = true;
    /** Interned index of an entity id (stable while the id is known). */
    index(id) {
        const known = this.ids.get(id);
        if (known !== undefined)
            return known;
        const i = this.nextIndex++;
        this.ids.set(id, i);
        this.names[i] = id;
        return i;
    }
    /** Re-number the ids that still have contacts (only after 2^25 distinct ids). */
    compact() {
        const live = this.entries();
        // Slots are keyed by the old numbering.
        this.impulseSlots.clear();
        this.ids.clear();
        this.names.length = 0;
        this.nextIndex = 0;
        this.load(live);
    }
    pairKey(a, b) {
        // Compact before interning so both indices come from the same numbering.
        if (this.nextIndex >= ID_SPACE - 2 && !(this.ids.has(a) && this.ids.has(b)))
            this.compact();
        const ia = this.index(a);
        const ib = this.index(b);
        return ia < ib ? ia * ID_SPACE + ib : ib * ID_SPACE + ia;
    }
    onForce = (ev) => {
        const maps = this.drainMaps;
        const a = maps.owner.get(ev.collider1());
        const b = maps.owner.get(ev.collider2());
        if (a === undefined || b === undefined || a === b)
            return;
        const key = this.pairKey(a, b);
        const j = ev.totalForceMagnitude() * this.drainDt;
        let slot = this.impulseSlots.get(key);
        if (slot === undefined) {
            slot = this.impulseSlots.size;
            if (slot >= this.impulseValues.length)
                this.growImpulses();
            this.impulseSlots.set(key, slot);
        }
        else if (this.impulseGens[slot] === this.generation) {
            if (j > this.impulseValues[slot])
                this.impulseValues[slot] = j;
            return;
        }
        this.impulseGens[slot] = this.generation;
        this.impulseValues[slot] = j;
    };
    growImpulses() {
        const values = new Float64Array(this.impulseValues.length * 2);
        values.set(this.impulseValues);
        const gens = new Int32Array(this.impulseGens.length * 2);
        gens.set(this.impulseGens);
        this.impulseValues = values;
        this.impulseGens = gens;
    }
    /** Impulse of a solid pair recorded in the current step, if any. */
    impulseOf(key) {
        const slot = this.impulseSlots.get(key);
        return slot !== undefined && this.impulseGens[slot] === this.generation ? this.impulseValues[slot] : undefined;
    }
    onCollision = (h1, h2, started) => {
        const maps = this.drainMaps;
        const a = maps.owner.get(h1);
        const b = maps.owner.get(h2);
        if (a === undefined || b === undefined || a === b)
            return;
        const s1 = maps.sensors.has(h1);
        const sensor = s1 || maps.sensors.has(h2);
        const key = this.pairKey(a, b);
        const counts = sensor ? this.sensorCounts : this.counts;
        const prev = counts.get(key) ?? 0;
        const next = started ? prev + 1 : Math.max(0, prev - 1);
        if (next === 0)
            counts.delete(key);
        else
            counts.set(key, next);
        if (started ? prev !== 0 : prev !== 1)
            return;
        if (!this.drainEmit && !sensor)
            return;
        const out = this.drainOut;
        if (sensor) {
            out.push({ type: started ? 'sensorEnter' : 'sensorExit', a: s1 ? a : b, b: s1 ? b : a });
        }
        else if (started) {
            const impulse = this.impulseOf(key);
            out.push(impulse !== undefined ? { type: 'collisionStart', a, b, impulse } : { type: 'collisionStart', a, b });
        }
        else {
            out.push({ type: 'collisionEnd', a, b });
        }
    };
    /**
     * Drain `queue` and append entity-level events to `out`.
     * When `emit` is false (priming step) contact counts are updated silently,
     * except sensor overlaps, which are still reported.
     */
    drain(queue, maps, dt, out, emit = true) {
        // New generation: last step's impulses become invalid without touching the map.
        this.generation = (this.generation + 1) | 0;
        if (this.generation === 0 || this.impulseSlots.size > MAX_IMPULSE_SLOTS) {
            this.impulseSlots.clear();
            this.impulseGens.fill(0);
            this.generation = 1;
        }
        this.drainMaps = maps;
        this.drainDt = dt;
        this.drainOut = out;
        this.drainEmit = emit;
        try {
            queue.drainContactForceEvents(this.onForce);
            queue.drainCollisionEvents(this.onCollision);
        }
        finally {
            this.drainMaps = null;
            this.drainOut = NO_EVENTS;
        }
    }
    /** Forget every contact involving `id` (called when an entity is removed). */
    forget(id) {
        const i = this.ids.get(id);
        if (i === undefined)
            return;
        for (const counts of [this.counts, this.sensorCounts]) {
            for (const key of counts.keys())
                if (Math.floor(key / ID_SPACE) === i || key % ID_SPACE === i)
                    counts.delete(key);
        }
        this.ids.delete(id);
        this.names[i] = undefined;
    }
    /** Number of active contact pairs (diagnostics, tests). */
    get activePairs() {
        return this.counts.size + this.sensorCounts.size;
    }
    /** Serializable contact state (for snapshots), keyed `"c\0a\0b"` / `"s\0a\0b"` with `a < b`. */
    entries() {
        const out = [];
        for (const [counts, sensor] of [[this.counts, false], [this.sensorCounts, true]]) {
            for (const [key, v] of counts) {
                const a = this.names[Math.floor(key / ID_SPACE)];
                const b = this.names[key % ID_SPACE];
                if (a === undefined || b === undefined)
                    continue;
                out.push([stringKey(sensor, a, b), v]);
            }
        }
        return out;
    }
    /** Restore contact state from {@link entries}. Malformed keys are skipped. */
    load(entries) {
        this.counts.clear();
        this.sensorCounts.clear();
        for (const [k, v] of entries) {
            if (!(v > 0))
                continue;
            const parts = k.split(SEP);
            if (parts.length !== 3 || (parts[0] !== 'c' && parts[0] !== 's'))
                continue;
            const a = parts[1];
            const b = parts[2];
            (parts[0] === 's' ? this.sensorCounts : this.counts).set(this.pairKey(a, b), v);
        }
    }
}
