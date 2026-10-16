/**
 * Runtime view of entities: identity, tags, owned state, kinematic pose
 * composition and selector resolution over live (non-destroyed) entities,
 * including entities spawned at runtime.
 */
import { eulerDegToQuat, hasOwn, quatMultiply } from '@aether/core';
import { zoneShapeOf } from './bounds';
import { cloneState } from './state';
import { copy3, copyQuat, yawQuat } from './vec';
/**
 * A live entity. Kinematic behaviors compose a pose every tick:
 *
 *   position = anchor + offset
 *   rotation = yaw(yawDeg) · baseRot · extraRot
 *
 * `anchor` and `yawDeg` persist across ticks (movement: patrol, orbit, follow…);
 * `offset` and `extraRot` are rebuilt every tick (bob, spin, door…), which is
 * what makes behaviors like bob + spin compose instead of fighting.
 */
export class RuntimeEntity {
    id;
    spec;
    tags;
    alive = true;
    /** Simulated by physics as a dynamic body (move with velocities, not poses). */
    dynamic;
    /** Created at runtime by a spawn action/behavior. */
    spawned;
    state;
    zone;
    basePos = [0, 0, 0];
    baseRot = [0, 0, 0, 1];
    // --- kinematic pose composition -------------------------------------------------
    anchor = [0, 0, 0];
    yawDeg = 0;
    offset = [0, 0, 0];
    extraRot = [0, 0, 0, 1];
    /** Last pose written to the host (valid when `hasPose`). */
    outPos = [0, 0, 0];
    outRot = [0, 0, 0, 1];
    hasPose = false;
    /** Tick number at which offset/extraRot were last reset. */
    poseTick = -1;
    behaviors = [];
    constructor(spec, worldPos, worldRot, spawned) {
        this.id = spec.id;
        this.spec = spec;
        this.tags = new Set(spec.tags);
        this.dynamic = spec.physics?.body === 'dynamic';
        this.spawned = spawned;
        this.state = cloneState(spec.state);
        this.zone = zoneShapeOf(spec);
        this.setBase(worldPos, worldRot);
    }
    /** Reset the base (rest) pose and the persistent anchor to it. */
    setBase(worldPos, worldRot) {
        copy3(this.basePos, worldPos);
        copyQuat(this.baseRot, worldRot);
        copy3(this.anchor, worldPos);
        copy3(this.outPos, worldPos);
        copyQuat(this.outRot, worldRot);
        this.yawDeg = 0;
    }
    /** Compose the current pose into `outPos` / `outRot`. */
    composePose(scratch) {
        this.outPos[0] = this.anchor[0] + this.offset[0];
        this.outPos[1] = this.anchor[1] + this.offset[1];
        this.outPos[2] = this.anchor[2] + this.offset[2];
        yawQuat(scratch, this.yawDeg);
        quatMultiply(scratch, this.baseRot, this.outRot);
        quatMultiply(this.outRot, this.extraRot, this.outRot);
        this.hasPose = true;
    }
}
const TAG_SELECTOR = /^#[^\s#]{1,64}$/;
/** Ordered registry of live entities with a tag index. Iteration order is insertion order (deterministic). */
export class EntityRegistry {
    byId = new Map();
    byTag = new Map();
    /** Insertion sequence per live id (defines the deterministic order of tag lookups). */
    seq = new Map();
    nextSeq = 0;
    list = [];
    listDirty = false;
    /** Number of live entities. */
    get size() {
        return this.byId.size;
    }
    /** Live entity by id. */
    get(id) {
        return this.byId.get(id);
    }
    /** True when an id is taken by a live entity. */
    has(id) {
        return this.byId.has(id);
    }
    /** Add (or replace) an entity. */
    add(e) {
        if (this.byId.has(e.id))
            this.remove(e.id);
        this.byId.set(e.id, e);
        this.seq.set(e.id, this.nextSeq++);
        for (const t of e.tags)
            this.indexTag(t, e.id);
        this.list.push(e);
    }
    /** Remove an entity by id. */
    remove(id) {
        const e = this.byId.get(id);
        if (!e)
            return undefined;
        e.alive = false;
        this.byId.delete(id);
        for (const t of e.tags)
            this.unindexTag(t, id);
        this.seq.delete(id);
        this.listDirty = true;
        return e;
    }
    /** Replace an entity's tag set, keeping the index consistent. */
    retag(e, tags) {
        for (const t of e.tags)
            this.unindexTag(t, e.id);
        e.tags = new Set(tags);
        for (const t of e.tags)
            this.indexTag(t, e.id);
    }
    indexTag(tag, id) {
        let idx = this.byTag.get(tag);
        if (!idx) {
            idx = { ids: new Set(), ordered: null };
            this.byTag.set(tag, idx);
        }
        if (!idx.ids.has(id)) {
            idx.ids.add(id);
            idx.ordered = null;
        }
    }
    unindexTag(tag, id) {
        const idx = this.byTag.get(tag);
        if (idx?.ids.delete(id))
            idx.ordered = null;
    }
    /** Tag members in insertion order; rebuilt only after the tag's membership changed. */
    orderedTag(idx) {
        if (idx.ordered)
            return idx.ordered;
        const seq = this.seq;
        idx.ordered = [...idx.ids].sort((a, b) => (seq.get(a) ?? 0) - (seq.get(b) ?? 0));
        return idx.ordered;
    }
    /** Live entities in insertion order. The array is reused; do not keep it. */
    all() {
        if (this.listDirty) {
            this.list = this.list.filter((e) => e.alive);
            this.listDirty = false;
        }
        return this.list;
    }
    /** Remove everything. */
    clear() {
        for (const e of this.list)
            e.alive = false;
        this.byId.clear();
        this.byTag.clear();
        this.seq.clear();
        this.list = [];
        this.listDirty = false;
    }
    /**
     * Resolve a selector to live entity ids in insertion order.
     * "player" resolves to `playerId` (which may be a host-only avatar id).
     */
    resolve(selector, playerId, out = []) {
        out.length = 0;
        if (selector === '*') {
            for (const e of this.all())
                out.push(e.id);
        }
        else if (selector === 'player') {
            if (playerId !== undefined)
                out.push(playerId);
        }
        else if (selector.startsWith('#')) {
            if (!TAG_SELECTOR.test(selector))
                return out;
            // O(matches): no scan over every live entity.
            const idx = this.byTag.get(selector.slice(1));
            if (idx && idx.ids.size > 0)
                for (const id of this.orderedTag(idx))
                    out.push(id);
        }
        else if (this.byId.has(selector)) {
            out.push(selector);
        }
        return out;
    }
    /** True when `id` is matched by `selector` (O(1)). */
    matches(id, selector, playerId) {
        if (selector === '*')
            return this.byId.has(id) || id === playerId;
        if (selector === 'player')
            return playerId !== undefined && id === playerId;
        if (selector.startsWith('#')) {
            const e = this.byId.get(id);
            return e !== undefined && e.tags.has(selector.slice(1));
        }
        return selector === id;
    }
}
/** Euler rotation in degrees → quaternion tuple (fresh). */
export function quatFromEulerDeg(r) {
    return eulerDegToQuat([r[0], r[1], r[2]]);
}
/** Own-property lookup for entity records keyed by untrusted ids. */
export function lookupEntity(entities, id) {
    return hasOwn(entities, id) ? entities[id] : undefined;
}
