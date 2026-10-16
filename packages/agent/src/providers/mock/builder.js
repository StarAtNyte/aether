/**
 * Deterministic world builder used by the offline mock planner.
 *
 * Collects patches in a canonical order (meta, environment, player, entities,
 * state, HUD, rules, tests), hands out unique slug ids, and keeps a simple
 * occupancy map of footprint circles so generated objects do not overlap.
 */
import { rng, slugify } from '@aether/core';
import { realisticStandIn } from './realistic';
import { CLUSTERED_GENERATORS, clusterPoints } from './cluster';
/** Round to centimeters so generated JSON stays compact and stable. */
export function r2(n) {
    return Math.round(n * 100) / 100;
}
function physicsSpec(p) {
    return typeof p === 'string' ? { body: p } : p;
}
/** Collects patches for one mock response. */
export class Builder {
    mood;
    seed;
    random;
    ids;
    counters = new Map();
    circles = [];
    /** Areas decorative scatter must stay out of (water surfaces). */
    keepOut = [];
    entities = [];
    envSet = {};
    playerSet = {};
    stateSet = new Map();
    hudList = [];
    keptHud = 0;
    rules = [];
    tests = [];
    ruleIds = new Set();
    testIds = new Set();
    extra = [];
    metaName;
    metaDescription;
    /** Kind of theme currently building (see {@link setPhase}). */
    phase = 'setting';
    /** When true, settings' `focus` tags are dropped: the activity owns the camera. */
    activityOwnsFocus = false;
    /**
     * When true, `gen` and `scatter` exchange the stylised nature generators (tree-oak, tree-pine, bush,
     * grass-tuft, rock) for the realistic leaf-card vegetation. Flagships turn it on unless they are
     * painterly on purpose.
     */
    realisticNature = false;
    constructor(seed, existingIds, mood, existingTests = [], existingRules = []) {
        this.seed = seed >>> 0;
        this.random = rng(this.seed);
        this.ids = new Set(existingIds);
        this.mood = mood;
        for (const t of existingTests)
            this.testIds.add(t);
        for (const r of existingRules)
            this.ruleIds.add(r);
    }
    // -- randomness -------------------------------------------------------------
    /** Uniform in [a, b). */
    rand(a = 0, b = 1) {
        return a + (b - a) * this.random();
    }
    /** Integer in [a, b]. */
    int(a, b) {
        return Math.floor(this.rand(a, b + 1));
    }
    /** Random element (array must be non-empty). */
    pick(items) {
        return items[Math.floor(this.random() * items.length) % items.length];
    }
    /** True with probability p. */
    chance(p) {
        return this.random() < p;
    }
    /** A fresh 31-bit seed for generator variation. */
    subSeed() {
        return Math.floor(this.random() * 2_147_483_647);
    }
    // -- camera focus ---------------------------------------------------------------
    /**
     * Declare which kind of theme the following entities belong to. Once
     * `activityOwnsFocus` is set (a world with a playable mechanic), `focus`
     * tags from settings are dropped so the framing camera looks at the
     * mechanic instead of, say, a castle keep next to it.
     */
    setPhase(kind, activityOwnsFocus = this.activityOwnsFocus) {
        this.phase = kind;
        this.activityOwnsFocus = activityOwnsFocus;
    }
    // -- ids & occupancy ----------------------------------------------------------
    /** Unique id from a base name: "tree" → "tree-1", "tree-2", …; `single` tries the bare base first. */
    id(base, single = false) {
        const slug = slugify(base) || 'object';
        if (single && !this.ids.has(slug)) {
            this.ids.add(slug);
            return slug;
        }
        let n = this.counters.get(slug) ?? 0;
        let candidate;
        do {
            n++;
            candidate = `${slug}-${n}`.slice(0, 64);
        } while (this.ids.has(candidate));
        this.counters.set(slug, n);
        this.ids.add(candidate);
        return candidate;
    }
    /** Whether an id is taken (existing world or this builder). */
    has(id) {
        return this.ids.has(id);
    }
    /** Reserve a footprint circle. */
    reserve(x, z, r) {
        if (r > 0)
            this.circles.push({ x, z, r });
    }
    /** True when a circle at (x, z) with radius r touches no reserved circle. */
    isFree(x, z, r) {
        for (const c of this.circles) {
            const dx = c.x - x;
            const dz = c.z - z;
            const min = c.r + r;
            if (dx * dx + dz * dz < min * min)
                return false;
        }
        return true;
    }
    /**
     * Random free spot in the annulus [minR, maxR] around (cx, cz); reserves it.
     * Returns null when no free spot is found (callers then skip the object).
     */
    spot(cx, cz, minR, maxR, r, tries = 40) {
        for (let i = 0; i < tries; i++) {
            const a = this.rand(0, Math.PI * 2);
            const d = Math.sqrt(this.rand(minR * minR, maxR * maxR));
            const x = r2(cx + Math.cos(a) * d);
            const z = r2(cz + Math.sin(a) * d);
            if (this.isFree(x, z, r)) {
                this.reserve(x, z, r);
                return [x, z];
            }
        }
        return null;
    }
    /** Keep decorative scatter (grass, flowers) out of a circle, e.g. a lake surface. */
    keepClear(x, z, r) {
        if (r > 0)
            this.keepOut.push({ x, z, r });
    }
    /** True when a square patch of half-size `half` centered at (x, z) touches a keep-clear circle. */
    touchesKeepClear(x, z, half) {
        for (const c of this.keepOut) {
            const dx = Math.max(0, Math.abs(c.x - x) - half);
            const dz = Math.max(0, Math.abs(c.z - z) - half);
            if (dx * dx + dz * dz < c.r * c.r)
                return true;
        }
        return false;
    }
    /** Reserve (x, z) if free; returns whether it was. */
    claim(x, z, r) {
        if (!this.isFree(x, z, r))
            return false;
        this.reserve(x, z, r);
        return true;
    }
    // -- entities -------------------------------------------------------------------
    /** Add a raw entity (id must come from {@link id}). */
    add(entity) {
        this.entities.push({ op: 'add', entity });
        return entity.id;
    }
    compose(id, pos, shape, o) {
        const e = { id, transform: { position: [r2(pos[0]), r2(pos[1]), r2(pos[2])] }, shape };
        const rot = o.rot ?? (o.yaw !== undefined ? [0, r2(o.yaw), 0] : undefined);
        if (rot && e.transform)
            e.transform.rotation = rot;
        if (o.scale !== undefined && e.transform)
            e.transform.scale = typeof o.scale === 'number' ? [r2(o.scale), r2(o.scale), r2(o.scale)] : o.scale;
        if (o.name)
            e.name = o.name;
        if (o.description)
            e.description = o.description;
        if (o.tags) {
            const tags = this.phase === 'setting' && this.activityOwnsFocus ? o.tags.filter((t) => t !== 'focus') : o.tags;
            if (tags.length > 0)
                e.tags = tags;
        }
        if (o.physics)
            e.physics = physicsSpec(o.physics);
        if (o.material)
            e.material = o.material;
        if (o.behaviors)
            e.behaviors = o.behaviors;
        if (o.light)
            e.light = o.light;
        if (o.joint)
            e.joint = o.joint;
        if (o.state)
            e.state = o.state;
        if (o.npc)
            e.npc = o.npc;
        if (o.character)
            e.character = o.character;
        if (o.parent)
            e.parent = o.parent;
        if (o.visible === false)
            e.visible = false;
        if (o.castShadow === false)
            e.castShadow = false;
        if (o.template)
            e.template = true;
        if (o.footprint)
            this.reserve(pos[0], pos[2], o.footprint);
        return e;
    }
    /**
     * The generator and params to use for a nature part: the realistic stand-in when {@link realisticNature}
     * is on and the generator has one, else the arguments unchanged.
     */
    nature(generator, params) {
        return (this.realisticNature ? realisticStandIn(generator, params) : null) ?? { generator, params };
    }
    /** Procedural (generator) entity standing at `pos` (base at pos.y). */
    gen(base, generator, params, pos, o = {}) {
        const id = this.id(base);
        if (this.realisticNature) {
            const stand = realisticStandIn(generator, params);
            if (stand) {
                generator = stand.generator;
                params = stand.params;
            }
        }
        this.add(this.compose(id, pos, { kind: 'procedural', generator, params, seed: this.subSeed() % 100_000 }, o));
        return id;
    }
    /**
     * Library asset standing at `pos` (base at pos.y, real-world size). The
     * renderer shows `fallback` (or a box of the asset's size) when the asset
     * cannot be loaded.
     */
    asset(base, assetId, pos, o = {}) {
        const id = this.id(base);
        const shape = { kind: 'asset', id: assetId, ...(o.fallback && (o.fallback.kind === 'procedural' || o.fallback.kind === 'primitive') ? { fallback: o.fallback } : {}), ...(o.fitSize ? { fitSize: o.fitSize } : {}), ...(o.animation ? { animation: o.animation } : {}) };
        this.add(this.compose(id, pos, shape, o));
        return id;
    }
    /** Primitive entity centered at `pos`. */
    prim(base, primitive, size, pos, o = {}) {
        const id = this.id(base);
        this.add(this.compose(id, pos, { kind: 'primitive', primitive, size }, o));
        return id;
    }
    /** Shape-less entity (group, light, zone). */
    empty(base, pos, o = {}) {
        const id = this.id(base);
        this.add(this.compose(id, pos, { kind: 'none' }, o));
        return id;
    }
    /** GPU-instanced scatter of a generator over a w×d area centered at pos. */
    scatter(base, generator, params, count, area, pos, o = {}) {
        const id = this.id(base);
        if (this.realisticNature) {
            const stand = realisticStandIn(generator, params);
            if (stand) {
                generator = stand.generator;
                params = stand.params;
            }
        }
        const scatterSeed = this.subSeed();
        // Natural ground cover grows in clumps: lay it out as a clustered point process (deterministic).
        const clustered = this.realisticNature && CLUSTERED_GENERATORS.has(generator) && count >= 12 ? clusterPoints(count, area[0], area[1], scatterSeed, { ...(o.minSpacing ? { minSpacing: o.minSpacing } : {}) }) : null;
        const shape = {
            kind: 'scatter',
            of: { kind: 'procedural', generator, params },
            count: Math.max(1, clustered ? clustered.length : Math.floor(count)),
            area,
            seed: scatterSeed % 100_000,
            ...(o.scaleRange ? { scaleRange: o.scaleRange } : {}),
            ...(o.minSpacing !== undefined ? { minSpacing: o.minSpacing } : {}),
            ...(o.randomYaw === false ? { randomYaw: false } : {}),
            ...(o.onSurface ? { onSurface: o.onSurface } : {}),
            ...(clustered && clustered.length > 0 ? { points: clustered } : {}),
        };
        this.add(this.compose(id, pos, shape, o));
        return id;
    }
    /** A point light child entity at local `offset`. */
    light(parent, offset, color, intensity, range, behaviors) {
        return this.empty(`${parent}-light`, offset, { parent, light: { type: 'point', color, intensity, range, castShadow: false }, ...(behaviors ? { behaviors } : {}) });
    }
    // -- world-level ------------------------------------------------------------------
    /** Merge environment fields (later calls win per key). */
    env(set) {
        Object.assign(this.envSet, set);
    }
    /** Current pending environment value. */
    envValue(key) {
        return this.envSet[key];
    }
    /** Merge player fields. */
    player(set) {
        Object.assign(this.playerSet, set);
    }
    /** Copy of the pending player fields. */
    playerSnapshot() {
        return { ...this.playerSet };
    }
    /** Pending player field value. */
    playerValue(key) {
        return this.playerSet[key];
    }
    /** `base`, or `base2`, `base3`… — the first state key not yet used by this build. */
    freshStateKey(base) {
        let key = base;
        for (let n = 2; this.stateSet.has(key); n++)
            key = `${base}${n}`;
        return key;
    }
    /** Set (or overwrite) a world state variable. */
    state(key, value) {
        this.stateSet.set(key, value);
    }
    /** Add a HUD binding (deduplicated by key). */
    hud(key, label) {
        if (!this.hudList.some((h) => h.key === key))
            this.hudList.push({ key, label });
    }
    /** Add a rule; its id is made unique. Returns the final id. */
    rule(rule) {
        let id = rule.id;
        for (let n = 2; this.ruleIds.has(id); n++)
            id = `${rule.id}-${n}`;
        this.ruleIds.add(id);
        this.rules.push({ op: 'addRule', rule: { ...rule, id } });
        return id;
    }
    /** Add a verification test; its id is made unique. */
    test(test) {
        let id = test.id;
        for (let n = 2; this.testIds.has(id); n++)
            id = `${test.id}-${n}`;
        this.testIds.add(id);
        this.tests.push({ op: 'addTest', test: { ...test, id } });
        return id;
    }
    /** Seed HUD entries that already exist (setHud replaces the whole list). */
    keepHud(entries) {
        for (const e of entries)
            this.hud(e.key, e.label);
        this.keptHud = this.hudList.length;
    }
    /** Append a raw patch after entities (updates/removes in edits). */
    patch(p) {
        this.extra.push(p);
    }
    /** Set the world name/description (first caller wins for the name). */
    meta(name, description) {
        this.metaName ??= name;
        if (description)
            this.metaDescription ??= description;
    }
    /** Number of entities added so far. */
    get entityCount() {
        return this.entities.length;
    }
    /** All patches in canonical order. */
    build() {
        const out = [];
        if (this.metaName !== undefined || this.metaDescription !== undefined) {
            out.push({ op: 'setMeta', ...(this.metaName !== undefined ? { name: this.metaName } : {}), ...(this.metaDescription !== undefined ? { description: this.metaDescription } : {}) });
        }
        if (Object.keys(this.envSet).length > 0)
            out.push({ op: 'setEnvironment', set: { ...this.envSet } });
        if (Object.keys(this.playerSet).length > 0)
            out.push({ op: 'setPlayer', set: { ...this.playerSet } });
        out.push(...this.entities, ...this.extra);
        for (const [key, value] of this.stateSet)
            out.push({ op: 'setState', key, value });
        if (this.hudList.length > this.keptHud)
            out.push({ op: 'setHud', hud: [...this.hudList] });
        out.push(...this.rules, ...this.tests);
        return out;
    }
}
