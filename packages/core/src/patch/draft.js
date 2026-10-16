import { hasOwn } from '../json';
import { scatterCount } from '../validate';
/** Mutable, copy-on-write view over a {@link WorldDoc}. */
export class Draft {
    base;
    doc;
    copied = new Set();
    dirty = false;
    children = null;
    /** Ids of entities holding references to other entities (joint target, scatter surface); lazily built. */
    holders = null;
    scatter = null;
    count = null;
    stateKeys = null;
    hintsLeft = HINT_BUDGET;
    constructor(base) {
        this.base = base;
        this.doc = { ...base };
    }
    /** Consume one "did you mean" hint from the per-batch budget. */
    takeHint() {
        return this.hintsLeft-- > 0;
    }
    /** The resulting document (the original object when nothing changed). */
    result() {
        return this.dirty ? this.doc : this.base;
    }
    /** Current (read-only) view. */
    get world() {
        return this.doc;
    }
    writable(key) {
        this.dirty = true;
        if (!this.copied.has(key)) {
            this.copied.add(key);
            const cur = this.doc[key];
            this.doc[key] = Array.isArray(cur) ? cur.slice() : { ...cur };
        }
        return this.doc[key];
    }
    // -- entities -------------------------------------------------------------
    /** Entity by id (own properties only). */
    entity(id) {
        return hasOwn(this.doc.entities, id) ? this.doc.entities[id] : undefined;
    }
    /** True when an entity with this id exists. */
    has(id) {
        return hasOwn(this.doc.entities, id);
    }
    /** Number of entities. */
    entityCount() {
        this.count ??= Object.keys(this.doc.entities).length;
        return this.count;
    }
    /** Total scatter instances (computed once, then maintained incrementally). */
    scatterTotal() {
        if (this.scatter === null) {
            let total = 0;
            for (const id of Object.keys(this.doc.entities))
                total += scatterCount(this.doc.entities[id]);
            this.scatter = total;
        }
        return this.scatter;
    }
    childIndex() {
        if (!this.children) {
            const idx = new Map();
            for (const id of Object.keys(this.doc.entities)) {
                const p = this.doc.entities[id].parent;
                if (p !== null)
                    addChild(idx, p, id);
            }
            this.children = idx;
        }
        return this.children;
    }
    /** Direct children ids of `id`. */
    childrenOf(id) {
        return this.childIndex().get(id) ?? EMPTY_SET;
    }
    /** `id` plus all of its descendants (breadth-first). */
    subtree(id) {
        const out = [id];
        for (let i = 0; i < out.length; i++)
            for (const c of this.childrenOf(out[i]))
                out.push(c);
        return out;
    }
    /** Number of levels below `id` (0 for a leaf). */
    subtreeHeight(id) {
        let level = [id];
        let height = 0;
        for (;;) {
            const next = [];
            for (const n of level)
                for (const c of this.childrenOf(n))
                    next.push(c);
            if (next.length === 0)
                return height;
            height++;
            level = next;
        }
    }
    /** Depth of `id` (roots are 0). Bounded walk; returns Infinity on a corrupt cycle. */
    depthOf(id, bound) {
        let d = 0;
        for (let cur = this.entity(id)?.parent ?? null; cur !== null; cur = this.entity(cur)?.parent ?? null) {
            if (++d > bound)
                return Number.POSITIVE_INFINITY;
        }
        return d;
    }
    /** True when `ancestor` is `id` or one of its ancestors. */
    isAncestorOrSelf(ancestor, id, bound) {
        let steps = 0;
        for (let cur = id; cur !== null; cur = this.entity(cur)?.parent ?? null) {
            if (cur === ancestor)
                return true;
            if (++steps > bound)
                return true;
        }
        return false;
    }
    /**
     * Ids of entities that reference other entities through a joint target or
     * a scatter surface (what `remove` has to clean up). Maintained
     * incrementally, so removing many entities stays linear.
     */
    referenceHolders() {
        if (!this.holders) {
            const set = new Set();
            for (const id of Object.keys(this.doc.entities))
                if (holdsRefs(this.doc.entities[id]))
                    set.add(id);
            this.holders = set;
        }
        return this.holders;
    }
    /** Insert or replace an entity (keeps document order for replacements). */
    setEntity(e) {
        const prev = this.entity(e.id);
        if (prev === e)
            return;
        if (this.holders) {
            if (holdsRefs(e))
                this.holders.add(e.id);
            else
                this.holders.delete(e.id);
        }
        if (this.scatter !== null)
            this.scatter += scatterCount(e) - (prev ? scatterCount(prev) : 0);
        if (!prev && this.count !== null)
            this.count++;
        if (this.children && prev?.parent !== e.parent) {
            if (prev && prev.parent !== null)
                this.children.get(prev.parent)?.delete(e.id);
            if (e.parent !== null)
                addChild(this.children, e.parent, e.id);
        }
        this.writable('entities')[e.id] = e;
    }
    /** Delete an entity (the caller handles references to it). */
    deleteEntity(id) {
        const prev = this.entity(id);
        if (!prev)
            return;
        if (this.scatter !== null)
            this.scatter -= scatterCount(prev);
        if (this.count !== null)
            this.count--;
        this.holders?.delete(id);
        if (this.children) {
            if (prev.parent !== null)
                this.children.get(prev.parent)?.delete(id);
            this.children.delete(id);
        }
        delete this.writable('entities')[id];
    }
    /** Replace the whole entity map (rename, clear). Indexes are rebuilt lazily. */
    replaceEntities(entities) {
        this.dirty = true;
        this.copied.add('entities');
        this.doc.entities = entities;
        this.children = null;
        this.holders = null;
        this.scatter = null;
        this.count = null;
    }
    // -- other containers -----------------------------------------------------
    /** Writable rules array. */
    rules() {
        return this.writable('rules');
    }
    /** Writable tests array. */
    tests() {
        return this.writable('tests');
    }
    /** Number of global state variables (cached). */
    stateKeyCount() {
        this.stateKeys ??= Object.keys(this.doc.state).length;
        return this.stateKeys;
    }
    /** Set (or with `undefined`, delete) a global state variable. */
    setStateVar(key, value) {
        const exists = hasOwn(this.doc.state, key);
        if (value === undefined) {
            if (!exists)
                return;
            delete this.writable('state')[key];
            if (this.stateKeys !== null)
                this.stateKeys--;
            return;
        }
        if (!exists && this.stateKeys !== null)
            this.stateKeys++;
        this.writable('state')[key] = value;
    }
    /** Writable generator map. */
    generators() {
        return this.writable('generators');
    }
    /** Writable script map. */
    scripts() {
        return this.writable('scripts');
    }
    /** Writable mesh asset map. */
    meshes() {
        return this.writable('meshes');
    }
    /** Set (or with `undefined`, remove) the voxel terrain. */
    setVoxel(value) {
        if (value === this.doc.voxel)
            return;
        this.dirty = true;
        if (value === undefined)
            delete this.doc.voxel;
        else
            this.doc.voxel = value;
    }
    /** Set (or with `undefined`, remove) the title card. */
    setIntro(value) {
        if (value === this.doc.intro)
            return;
        this.dirty = true;
        if (value === undefined)
            delete this.doc.intro;
        else
            this.doc.intro = value;
    }
    /** Assign a top-level value-like field. */
    set(key, value) {
        this.dirty = true;
        if (key === 'rules' || key === 'tests' || key === 'state')
            this.copied.add(key);
        if (key === 'state')
            this.stateKeys = null;
        this.doc[key] = value;
    }
}
const EMPTY_SET = new Set();
function holdsRefs(e) {
    return (e.joint !== undefined && e.joint.target !== 'world') || (e.shape.kind === 'scatter' && e.shape.onSurface !== undefined);
}
/** Max number of O(n) suggestion lookups per batch (DoS guard). */
const HINT_BUDGET = 16;
function addChild(idx, parent, child) {
    let set = idx.get(parent);
    if (!set) {
        set = new Set();
        idx.set(parent, set);
    }
    set.add(child);
}
