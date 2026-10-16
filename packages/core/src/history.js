/**
 * Undo/redo history with named branches and time travel.
 *
 * Design: every entry stores its resulting immutable `WorldDoc`. Because
 * `applyPatches` shares structure, an entry costs roughly the changed
 * entities plus one shallow copy of the containers that changed, and
 * undo/redo/checkout are O(1) pointer moves (no re-application, no inverse
 * patches needed). Serialization stores only the applied (normalized) patches
 * plus a full snapshot for each root entry; `fromJSON` re-validates the
 * snapshots and replays the patches atomically.
 *
 * Each branch is a linear list of entry ids with a cursor. Committing after an
 * undo discards the redo tail of the current branch (unless another branch
 * still references those entries). Entries are pruned from the front once a
 * branch exceeds `maxEntries` (the oldest remaining entry becomes the base).
 */
import { z } from 'zod';
import { applyPatches } from './patch/apply';
import { validateWorld } from './validate';
import { inspectUntrusted } from './guard';
import { issuesText } from './issues';
import { truncate } from './json';
import { Emitter } from './emitter';
const DEFAULT_MAX_ENTRIES = 200;
const MAX_MAX_ENTRIES = 10_000;
const MAX_BRANCHES = 64;
const MAX_MESSAGE = 500;
const BRANCH_NAME = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,63}$/;
const SourceSchema = z.enum(['agent', 'user', 'system']);
const HistoryJsonSchema = z.object({
    format: z.literal('aether-history'),
    version: z.literal(1),
    maxEntries: z.number().int().min(1).max(MAX_MAX_ENTRIES),
    nextId: z.number().int().min(1),
    currentBranch: z.string().regex(BRANCH_NAME),
    branches: z
        .array(z.object({ name: z.string().regex(BRANCH_NAME), ids: z.array(z.number().int().min(0)).min(1).max(MAX_MAX_ENTRIES + 1), cursor: z.number().int().min(0) }))
        .min(1)
        .max(MAX_BRANCHES),
    entries: z
        .array(z.object({
        id: z.number().int().min(0),
        parent: z.number().int().min(0).nullable(),
        message: z.string().max(MAX_MESSAGE),
        source: SourceSchema,
        patches: z.array(z.unknown()),
        world: z.unknown().optional(),
    }))
        .min(1)
        .max(MAX_MAX_ENTRIES * 4),
});
function assertBranchName(name) {
    if (!BRANCH_NAME.test(name))
        throw new Error(`invalid branch name ${JSON.stringify(truncate(name, 80))} (letters, digits, . _ - /; max 64)`);
}
/** Undo/redo history with branches; see the module documentation for the design. */
export class History {
    byId = new Map();
    branchMap = new Map();
    active = 'main';
    nextId = 1;
    maxEntries;
    events = new Emitter();
    /**
     * @param initial the base world (trusted; validate untrusted input with `validateWorld` first)
     * @param opts.maxEntries maximum entries kept per branch, excluding the base (default 200)
     */
    constructor(initial, opts = {}) {
        const max = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
        this.maxEntries = Number.isFinite(max) ? Math.min(MAX_MAX_ENTRIES, Math.max(1, Math.floor(max))) : DEFAULT_MAX_ENTRIES;
        this.byId.set(0, { id: 0, parent: null, message: 'initial', source: 'system', patches: [], world: initial });
        this.branchMap.set('main', { ids: [0], cursor: 0 });
    }
    get branchState() {
        return this.branchMap.get(this.active);
    }
    get headEntry() {
        const b = this.branchState;
        return this.byId.get(b.ids[b.cursor]);
    }
    /** The world at the current position. */
    get current() {
        return this.headEntry.world;
    }
    /** Id of the entry at the current position. */
    get head() {
        return this.headEntry.id;
    }
    /**
     * Apply patches to the current world and record an entry when anything
     * changed. Returns the `applyPatches` result (errors included).
     */
    commit(patches, message, source = 'user', opts = {}) {
        const before = this.current;
        const result = applyPatches(before, patches, opts);
        if (result.applied.length === 0 || result.world === before)
            return result;
        const branch = this.branchState;
        const entry = {
            id: this.nextId++,
            parent: this.head,
            message: truncate(String(message), MAX_MESSAGE),
            source: SourceSchema.safeParse(source).success ? source : 'user',
            patches: result.applied,
            world: result.world,
        };
        this.byId.set(entry.id, entry);
        branch.ids.length = branch.cursor + 1;
        branch.ids.push(entry.id);
        branch.cursor = branch.ids.length - 1;
        if (branch.ids.length > this.maxEntries + 1) {
            const drop = branch.ids.length - (this.maxEntries + 1);
            branch.ids.splice(0, drop);
            branch.cursor -= drop;
        }
        this.collectGarbage();
        this.notify();
        return result;
    }
    /** Number of entries held in memory across all branches (base entries included). */
    get size() {
        return this.byId.size;
    }
    /** Current per-branch entry cap (see the constructor). */
    get entryLimit() {
        return this.maxEntries;
    }
    /**
     * Change the per-branch entry cap (e.g. a low-memory mode) and prune the
     * oldest entries of every branch down to it right away. The current
     * position is never pruned: on a branch whose cursor sits deeper in the
     * past than the cap allows, only the entries before the cursor go. Change
     * listeners fire only when something was dropped (the world itself never
     * changes). Returns the effective cap (clamped like the constructor's).
     */
    setMaxEntries(max) {
        this.maxEntries = Number.isFinite(max) ? Math.min(MAX_MAX_ENTRIES, Math.max(1, Math.floor(max))) : this.maxEntries;
        let pruned = false;
        for (const b of this.branchMap.values()) {
            const drop = Math.min(b.ids.length - (this.maxEntries + 1), b.cursor);
            if (drop <= 0)
                continue;
            b.ids.splice(0, drop);
            b.cursor -= drop;
            pruned = true;
        }
        if (pruned) {
            this.collectGarbage();
            this.notify();
        }
        return this.maxEntries;
    }
    /** Step back one entry on the current branch. Returns the new world, or null at the start. */
    undo() {
        const b = this.branchState;
        if (b.cursor === 0)
            return null;
        b.cursor--;
        this.notify();
        return this.current;
    }
    /** Step forward one entry on the current branch. Returns the new world, or null at the end. */
    redo() {
        const b = this.branchState;
        if (b.cursor >= b.ids.length - 1)
            return null;
        b.cursor++;
        this.notify();
        return this.current;
    }
    /** True when {@link undo} would succeed. */
    canUndo() {
        return this.branchState.cursor > 0;
    }
    /** True when {@link redo} would succeed. */
    canRedo() {
        const b = this.branchState;
        return b.cursor < b.ids.length - 1;
    }
    /** Entries of the current branch (oldest first, base included). */
    entries() {
        return this.branchState.ids.map((id) => {
            const e = this.byId.get(id);
            return { id: e.id, message: e.message, source: e.source, patchCount: e.patches.length };
        });
    }
    /**
     * The commits leading to the current position, newest first (the base entry
     * excluded): source, message and the applied patches. At most `limit`.
     */
    recentCommits(limit = 50) {
        const b = this.branchState;
        const out = [];
        for (let i = b.cursor; i > 0 && out.length < Math.max(0, limit); i--) {
            const e = this.byId.get(b.ids[i]);
            if (e.parent === null)
                break;
            out.push({ id: e.id, source: e.source, message: e.message, patches: e.patches });
        }
        return out;
    }
    /**
     * Time travel: move to `entryId` without discarding anything (redo stays
     * available). Searches the current branch first, then other branches
     * (switching to the first one containing the entry). Throws `RangeError`
     * for unknown ids.
     */
    checkout(entryId) {
        const tryBranch = (name) => {
            const b = this.branchMap.get(name);
            const idx = b.ids.indexOf(entryId);
            if (idx < 0)
                return false;
            this.active = name;
            b.cursor = idx;
            return true;
        };
        let found = tryBranch(this.active);
        if (!found)
            for (const name of this.branchMap.keys())
                if (name !== this.active && tryBranch(name)) {
                    found = true;
                    break;
                }
        if (!found)
            throw new RangeError(`unknown history entry ${entryId}`);
        this.notify();
        return this.current;
    }
    /**
     * Fork a new branch at the current position and make it active (like
     * `git switch -c`). Throws for invalid or existing names.
     */
    branch(name) {
        assertBranchName(name);
        if (this.branchMap.has(name))
            throw new Error(`branch '${name}' already exists`);
        if (this.branchMap.size >= MAX_BRANCHES)
            throw new Error(`too many branches (max ${MAX_BRANCHES})`);
        const b = this.branchState;
        this.branchMap.set(name, { ids: b.ids.slice(0, b.cursor + 1), cursor: b.cursor });
        this.active = name;
    }
    /** Activate an existing branch at its own position. Throws for unknown names. */
    switchBranch(name) {
        if (!this.branchMap.has(name))
            throw new Error(`unknown branch '${truncate(String(name), 64)}'`);
        if (name !== this.active) {
            this.active = name;
            this.notify();
        }
        return this.current;
    }
    /** Delete a non-active branch and release entries only it referenced. */
    deleteBranch(name) {
        if (name === this.active)
            throw new Error('cannot delete the active branch');
        if (!this.branchMap.delete(name))
            throw new Error(`unknown branch '${truncate(String(name), 64)}'`);
        this.collectGarbage();
    }
    /** All branch names (creation order). */
    branches() {
        return [...this.branchMap.keys()];
    }
    /** Name of the active branch. */
    currentBranch() {
        return this.active;
    }
    /** Listen to every change of {@link current}. Returns an unsubscribe function. */
    subscribe(fn) {
        return this.events.on('change', fn);
    }
    notify() {
        this.events.emit('change', this.current);
    }
    collectGarbage() {
        const live = new Set();
        for (const b of this.branchMap.values())
            for (const id of b.ids)
                live.add(id);
        for (const id of [...this.byId.keys()])
            if (!live.has(id))
                this.byId.delete(id);
    }
    /** Serializable form (patches + root snapshots). */
    toJSON() {
        const ids = [...this.byId.keys()].sort((a, b) => a - b);
        return {
            format: 'aether-history',
            version: 1,
            maxEntries: this.maxEntries,
            nextId: this.nextId,
            currentBranch: this.active,
            branches: [...this.branchMap].map(([name, b]) => ({ name, ids: b.ids.slice(), cursor: b.cursor })),
            entries: ids.map((id) => {
                const e = this.byId.get(id);
                const root = e.parent === null || !this.byId.has(e.parent);
                return { id: e.id, parent: root ? null : e.parent, message: e.message, source: e.source, patches: e.patches, ...(root ? { world: e.world } : {}) };
            }),
        };
    }
    /**
     * Rebuild a history from {@link toJSON} output. Untrusted input is fully
     * validated (structure, world snapshots, patch replay, branch chains).
     * Throws `Error` describing the first problem.
     */
    static fromJSON(json) {
        const guard = inspectUntrusted(json);
        if (!guard.ok)
            throw new Error(`History.fromJSON: ${guard.path}: ${guard.message}`);
        const parsed = HistoryJsonSchema.safeParse(json);
        if (!parsed.success)
            throw new Error(`History.fromJSON: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).slice(0, 3).join('; ')}`);
        const data = parsed.data;
        const built = new Map();
        const sorted = [...data.entries].sort((a, b) => a.id - b.id);
        for (const raw of sorted) {
            if (built.has(raw.id))
                throw new Error(`History.fromJSON: duplicate entry id ${raw.id}`);
            let world;
            let patches;
            if (raw.parent === null) {
                const v = validateWorld(raw.world);
                if (!v.ok)
                    throw new Error(`History.fromJSON: entry ${raw.id} snapshot invalid: ${issuesText(v.issues, 3)}`);
                world = v.world;
                patches = [];
                if (raw.patches.length > 0) {
                    const r = applyPatches(world, raw.patches, { atomic: true });
                    if (r.errors.length > 0)
                        throw new Error(`History.fromJSON: entry ${raw.id} patches invalid: ${r.errors[0]?.message ?? ''}`);
                    patches = r.applied;
                }
            }
            else {
                const parent = built.get(raw.parent);
                if (!parent || raw.parent >= raw.id)
                    throw new Error(`History.fromJSON: entry ${raw.id} has unknown parent ${raw.parent}`);
                const r = applyPatches(parent.world, raw.patches, { atomic: true });
                if (r.errors.length > 0)
                    throw new Error(`History.fromJSON: entry ${raw.id} replay failed: ${r.errors[0]?.message ?? ''}`);
                world = r.world;
                patches = r.applied;
            }
            built.set(raw.id, { id: raw.id, parent: raw.parent, message: raw.message, source: raw.source, patches, world });
        }
        const names = new Set();
        for (const b of data.branches) {
            if (names.has(b.name))
                throw new Error(`History.fromJSON: duplicate branch '${b.name}'`);
            names.add(b.name);
            if (b.cursor >= b.ids.length)
                throw new Error(`History.fromJSON: branch '${b.name}' cursor out of range`);
            b.ids.forEach((id, i) => {
                const e = built.get(id);
                if (!e)
                    throw new Error(`History.fromJSON: branch '${b.name}' references unknown entry ${id}`);
                if (i > 0 && e.parent !== b.ids[i - 1])
                    throw new Error(`History.fromJSON: branch '${b.name}' is not a parent chain at entry ${id}`);
            });
        }
        if (!names.has(data.currentBranch))
            throw new Error(`History.fromJSON: unknown current branch '${data.currentBranch}'`);
        const maxId = sorted[sorted.length - 1]?.id ?? 0;
        if (data.nextId <= maxId)
            throw new Error('History.fromJSON: nextId must exceed every entry id');
        const firstBranch = data.branches[0];
        const h = new History(built.get(firstBranch.ids[0]).world, { maxEntries: data.maxEntries });
        h.byId.clear();
        h.branchMap.clear();
        for (const [id, e] of built)
            h.byId.set(id, e);
        for (const b of data.branches)
            h.branchMap.set(b.name, { ids: b.ids.slice(), cursor: b.cursor });
        h.active = data.currentBranch;
        h.nextId = data.nextId;
        h.collectGarbage();
        return h;
    }
}
