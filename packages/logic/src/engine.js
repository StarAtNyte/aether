/**
 * The logic engine: owns runtime entities, state, rules, behaviors and the
 * script bridge, and implements the services behaviors and actions use.
 * {@link LogicRuntime} is the public facade over it.
 */
import { hashString, hasOwn, LIMITS, rng, stableStringify, worldTransform, } from '@aether/core';
import { executeAction, locate } from './actions';
import { insideZone, onTopOfZone, zoneShapeOf } from './bounds';
import { BEHAVIORS } from './behaviors';
import { moveToward } from './behaviors/move';
import { EntityRegistry, lookupEntity, quatFromEulerDeg, RuntimeEntity } from './entities';
import { KeyEdges } from './keys';
import { NpcSystem } from './npc/system';
import { ParamReader } from './params';
import { errorText, RuleEngine } from './rules';
import { checkIntent } from './scripting/intents';
import { cloneState, readState, showValue, writeState } from './state';
import { copy3 } from './vec';
/** Max log entries kept (ring buffer). */
export const MAX_LOG_ENTRIES = 500;
/** Max entities spawned per tick. */
export const MAX_SPAWNS_PER_TICK = 200;
/** Max runtime-spawned entities alive at once. */
export const MAX_LIVE_SPAWNED = 1000;
/** Max physics events processed per tick. */
const MAX_EVENTS_PER_TICK = 4096;
/** Max queued clicks / external events between ticks. */
const MAX_PENDING_INPUTS = 64;
/** Largest accepted fixed step (s): protects against huge catch-up steps. */
const MAX_DT = 0.25;
/** Script snapshot: neighbours within this radius… */
const NEARBY_RADIUS = 15;
/** …and at most this many. */
const NEARBY_MAX = 16;
/** Script snapshot: scan at most this many entities for neighbours. */
const NEARBY_SCAN_LIMIT = 4000;
/**
 * Script calls per tick across all entities. Deterministic (a count, not wall
 * time): beyond it, script slots are served round-robin over the next ticks
 * and receive the simulated time they missed.
 */
export const MAX_SCRIPT_CALLS_PER_TICK = 24;
/** Longest catch-up step handed to a deferred script (s). */
const MAX_SCRIPT_CATCHUP = 0.5;
function cellCoord(v) {
    return Math.floor(v / NEARBY_RADIUS);
}
/** Hash of a grid cell (collisions only add candidates; distances are exact). */
function cellKey(ix, iy, iz) {
    return ((ix & 0x3ff) << 20) | ((iy & 0x3ff) << 10) | (iz & 0x3ff);
}
const EMPTY_STATE = Object.freeze({});
const EMPTY_USED = new Set();
const EMPTY_CONTACTS = Object.freeze([]);
function clampAxis(v) {
    return typeof v === 'number' && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
}
/** Engine implementation. Not exported from the package: use LogicRuntime. */
export class Engine {
    /** Trace ring buffer storage: O(1) writes, ordered view materialized on read. */
    ring = new Array(MAX_LOG_ENTRIES);
    ringHead = 0;
    ringSize = 0;
    ringView = [];
    host;
    world;
    scripts;
    seed;
    registry = new EntityRegistry();
    worldState = {};
    /**
     * JSON of {@link worldState} shared by every script call of a tick;
     * cleared at tick start and on every state write, so scripts always see
     * current values but the record is serialized once in the common case.
     */
    worldJson = null;
    scope;
    rules;
    keyEdges = new KeyEdges();
    inputState = {
        forward: 0,
        right: 0,
        jump: false,
        action: false,
        keys: new Set(),
        pointerYawDeg: 0,
    };
    spawnRandom;
    _time = 0;
    _dt = 0;
    tickNo = 0;
    _status = 'playing';
    started = false;
    disposed = false;
    resetPending = false;
    clicks = [];
    uses = [];
    usedNow = new Set();
    externalEvents = [];
    contacts = new Map();
    active = new Map();
    poseDirty = [];
    hostPos = new Map();
    /** Per-tick cache of dynamic zone frames (one host.getTransform per zone per tick). */
    zoneFrames = new Map();
    spawnCounters = new Map();
    spawnedThisTick = 0;
    liveSpawned = 0;
    defaultPlayer;
    playerTick = -1;
    playerCache;
    moversTick = -1;
    /** Script slots encountered this tick / last tick, and the round-robin offset. */
    scriptSeen = 0;
    scriptTotalPrev = 0;
    scriptRotation = 0;
    /** Uniform grid (cell = NEARBY_RADIUS) over live entities, rebuilt at most once per tick. */
    nearGrid = new Map();
    nearPool = [];
    nearGridTick = -1;
    moversList = [];
    resolveScratch = [];
    quatScratch = [0, 0, 0, 1];
    warned = new Set();
    respawnPoint;
    /** NPC minds, navigation, dialogue and speech (see `./npc`). */
    npcs;
    constructor(world, host, opts = {}) {
        this.world = world;
        this.host = host;
        this.npcs = new NpcSystem({ env: this, world: () => this.world, bounds: host });
        this.scripts = opts.scripts;
        this.seed = (Number.isFinite(opts.seed) ? opts.seed : world.seed) >>> 0;
        this.spawnRandom = rng(this.seed ^ 0x5bd1e995);
        const states = { world: () => this.worldState, entity: (id) => this.registry.get(id)?.state };
        this.scope = {
            get world() {
                return states.world();
            },
            entityState: states.entity,
        };
        this.rules = new RuleEngine(this);
        this.loadScripts(world);
        this.build(world);
    }
    // ---------------------------------------------------------------------------
    // Public facade API
    // ---------------------------------------------------------------------------
    get time() {
        return this._time;
    }
    get dt() {
        return this._dt;
    }
    get status() {
        return this._status;
    }
    get input() {
        return this.inputState;
    }
    get pressed() {
        return this.keyEdges.pressed;
    }
    get playerSpawn() {
        return this.world.player.spawn;
    }
    /** World state record (live; treat as read-only). */
    get state() {
        return this.worldState;
    }
    /** Entity state record (live; treat as read-only). Empty for unknown entities. */
    entityState(id) {
        return this.registry.get(id)?.state ?? EMPTY_STATE;
    }
    start() {
        if (this.disposed || this.started)
            return;
        this.started = true;
        this.log('play started');
        this.guard('start rules', () => this.rules.fireStart());
    }
    /** Queue a click on an entity; processed at the next tick. */
    click(id) {
        if (typeof id !== 'string' || id.length === 0 || id.length > 64)
            return;
        if (this.clicks.length < MAX_PENDING_INPUTS)
            this.clicks.push(id);
    }
    /** Queue a use (aim + use key) of an entity; its `operable` behaviors react at the next tick. */
    use(id) {
        if (typeof id !== 'string' || id.length === 0 || id.length > 64)
            return;
        if (this.uses.length < MAX_PENDING_INPUTS)
            this.uses.push(id);
    }
    get used() {
        return this.usedNow;
    }
    /** Queue an external event; processed at the next tick. */
    emitExternal(event) {
        if (typeof event !== 'string' || event.length === 0 || event.length > 100)
            return;
        if (this.externalEvents.length < MAX_PENDING_INPUTS)
            this.externalEvents.push(event);
    }
    tick(dt, input, events) {
        if (this.disposed)
            return;
        this.readInput(input);
        if (!this.started)
            this.start();
        if (this._status !== 'playing')
            return;
        const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, MAX_DT) : 0;
        this.tickNo++;
        this._dt = step;
        this._time += step;
        this.hostPos.clear();
        this.zoneFrames.clear();
        this.worldJson = null;
        this.scriptTotalPrev = this.scriptSeen;
        this.scriptSeen = 0;
        if (this.scriptTotalPrev > MAX_SCRIPT_CALLS_PER_TICK) {
            this.scriptRotation = (this.scriptRotation + MAX_SCRIPT_CALLS_PER_TICK) % this.scriptTotalPrev;
        }
        else
            this.scriptRotation = 0;
        this.rules.beginTick();
        this.spawnedThisTick = 0;
        this.guard('physics events', () => this.ingestEvents(events));
        this.guard('delayed events', () => this.rules.processDue());
        if (this.externalEvents.length > 0) {
            const evs = this.externalEvents;
            this.externalEvents = [];
            for (const e of evs)
                this.guard('event', () => this.rules.dispatch(e, 0));
        }
        if (this.clicks.length > 0) {
            const cs = this.clicks;
            this.clicks = [];
            for (const id of cs)
                this.guard('click', () => this.rules.click(id));
        }
        this.guard('timers', () => this.rules.timers(step));
        this.guard('keys', () => this.rules.keys(this.keyEdges.pressed));
        this.guard('collisions', () => this.rules.collisions(events));
        this.guard('zones', () => this.rules.zones());
        this.guard('falls', () => this.rules.falls());
        this.usedNow = this.uses.length > 0 ? new Set(this.uses) : EMPTY_USED;
        this.uses = [];
        this.updateBehaviors(step);
        this.guard('state rules', () => this.rules.states());
        this.guard('poses', () => this.flushPoses());
        this.drainScriptDiagnostics();
        if (this.resetPending)
            this.guard('reset', () => this.performReset());
    }
    readState(key) {
        if (typeof key !== 'string')
            return undefined;
        return readState(this.scope, key);
    }
    /** Hot reload: replace rules/behaviors/entities while preserving runtime state. */
    updateWorld(next) {
        if (this.disposed)
            return;
        const prev = this.world;
        this.world = next;
        this.loadScripts(next);
        this.worldJson = null;
        this.npcs.invalidate();
        for (const k of Object.keys(next.state)) {
            if (!hasOwn(this.worldState, k) && Object.keys(this.worldState).length < LIMITS.MAX_STATE_KEYS) {
                this.worldState[k] = cloneState({ [k]: next.state[k] })[k];
            }
        }
        // Entities: update changed, add new, drop removed (spawned entities are kept).
        for (const e of this.registry.all().slice()) {
            if (e.spawned)
                continue;
            const spec = lookupEntity(next.entities, e.id);
            if (!spec || spec.template)
                this.removeEntity(e);
        }
        for (const id of Object.keys(next.entities)) {
            const spec = next.entities[id];
            if (spec.template)
                continue;
            const existing = this.registry.get(id);
            if (!existing || existing.spawned) {
                if (existing)
                    this.removeEntity(existing);
                this.addEntity(spec, false);
                continue;
            }
            const old = lookupEntity(prev.entities, id);
            if (old === spec)
                continue;
            this.refreshEntity(existing, spec, old);
        }
        this.defaultPlayer = this.findDefaultPlayer();
        this.playerTick = -1;
        this.rules.load(next.rules);
        this.log('world updated (hot reload)');
    }
    dispose() {
        if (this.disposed)
            return;
        for (const e of this.registry.all())
            this.disposeBehaviors(e);
        this.registry.clear();
        this.rules.load([]);
        this.contacts.clear();
        this.active.clear();
        this.poseDirty.length = 0;
        this.disposed = true;
    }
    // ---------------------------------------------------------------------------
    // Construction / reload
    // ---------------------------------------------------------------------------
    build(world) {
        this.registry.clear();
        this.worldState = cloneState(world.state);
        this.worldJson = null;
        for (const id of Object.keys(world.entities)) {
            const spec = world.entities[id];
            if (!spec.template)
                this.addEntity(spec, false);
        }
        this.defaultPlayer = this.findDefaultPlayer();
        this.rules.load(world.rules);
    }
    loadScripts(world) {
        if (!this.scripts)
            return;
        for (const id of Object.keys(world.scripts)) {
            const def = world.scripts[id];
            if (!def)
                continue;
            try {
                this.scripts.load(def);
            }
            catch (err) {
                this.log(`script '${id}' failed to load: ${errorText(err)}`);
            }
        }
    }
    findDefaultPlayer() {
        const controls = this.world.player.controls;
        if (controls !== undefined && this.registry.has(controls))
            return controls;
        for (const e of this.registry.all()) {
            if (e.spec.behaviors.some((b) => b.type === 'playerController'))
                return e.id;
        }
        return this.registry.has('player') ? 'player' : undefined;
    }
    worldPose(spec) {
        if (spec.parent !== null && hasOwn(this.world.entities, spec.id)) {
            try {
                const t = worldTransform(this.world, spec.id);
                return { pos: t.position, rot: t.quaternion };
            }
            catch {
                // broken chain: fall back to the local transform
            }
        }
        const p = spec.transform.position;
        return { pos: [p[0], p[1], p[2]], rot: quatFromEulerDeg(spec.transform.rotation) };
    }
    addEntity(spec, spawned, at) {
        const pose = this.worldPose(spec);
        if (at)
            copy3(pose.pos, at);
        const e = new RuntimeEntity(spec, pose.pos, pose.rot, spawned);
        this.registry.add(e);
        this.createBehaviors(e);
        return e;
    }
    refreshEntity(e, spec, old) {
        const oldSpec = e.spec;
        e.spec = spec;
        if (stableStringify(oldSpec.tags) !== stableStringify(spec.tags))
            this.registry.retag(e, spec.tags);
        e.dynamic = spec.physics?.body === 'dynamic';
        const transformChanged = !old || stableStringify(old.transform) !== stableStringify(spec.transform) || old.parent !== spec.parent;
        if (transformChanged || stableStringify(oldSpec.shape) !== stableStringify(spec.shape)) {
            e.zone = zoneShapeOf(spec);
        }
        if (transformChanged) {
            const pose = this.worldPose(spec);
            e.setBase(pose.pos, pose.rot);
            e.hasPose = false;
        }
        // New state keys from the document are added; existing runtime values are preserved.
        for (const k of Object.keys(spec.state)) {
            if (!hasOwn(e.state, k))
                e.state[k] = cloneState({ [k]: spec.state[k] })[k];
        }
        const keys = spec.behaviors.map((b, i) => `${i}:${stableStringify(b)}`);
        if (spec.npc)
            keys.push(npcKey(spec.npc));
        const same = keys.length === e.behaviors.length && keys.every((k, i) => e.behaviors[i]?.key === k);
        if (!same) {
            this.disposeBehaviors(e);
            this.createBehaviors(e);
        }
    }
    createBehaviors(e) {
        const slots = [];
        e.spec.behaviors.forEach((b, i) => {
            const key = `${i}:${stableStringify(b)}`;
            const random = rng(this.seed ^ hashString(`${e.id}#${i}#${b.type}`));
            if (b.type === 'script') {
                const raw = b.params['script'] ?? b.params['id'];
                const scriptId = typeof raw === 'string' ? raw : '';
                const slot = { type: 'script', enabled: b.enabled, key, scriptId, instance: {} };
                slot.instance = { update: (_env, dt) => this.runScript(e, slot, dt) };
                slots.push(slot);
                return;
            }
            const def = BEHAVIORS[b.type];
            if (!def) {
                this.warnOnce(`unknown:${b.type}`, `unknown behavior '${b.type}' on ${e.id}`);
                return;
            }
            try {
                const instance = def.create(e, new ParamReader(def.params, b.params), random);
                slots.push({ type: b.type, enabled: b.enabled, key, instance });
            }
            catch (err) {
                this.log(`behavior ${b.type} on ${e.id} failed to start: ${errorText(err)}`);
            }
        });
        if (e.spec.npc) {
            try {
                slots.push({ type: 'npc-brain', enabled: true, key: npcKey(e.spec.npc), instance: this.npcs.createBrain(e, rng(this.seed ^ hashString(`${e.id}#npc`))) });
            }
            catch (err) {
                this.log(`npc brain on ${e.id} failed to start: ${errorText(err)}`);
            }
        }
        e.behaviors = slots;
    }
    disposeBehaviors(e) {
        for (const slot of e.behaviors) {
            try {
                slot.instance.dispose?.(this);
            }
            catch (err) {
                this.log(`behavior ${slot.type} on ${e.id} failed to dispose: ${errorText(err)}`);
            }
        }
        e.behaviors = [];
    }
    removeEntity(e) {
        this.disposeBehaviors(e);
        this.registry.remove(e.id);
        if (e.spawned)
            this.liveSpawned = Math.max(0, this.liveSpawned - 1);
        this.dropContacts(e.id);
    }
    performReset() {
        this.resetPending = false;
        this.host.reset();
        for (const e of this.registry.all())
            this.disposeBehaviors(e);
        this.rules.resetState();
        this.npcs.reset();
        this.spawnCounters.clear();
        this.spawnRandom = rng(this.seed ^ 0x5bd1e995);
        this.contacts.clear();
        this.active.clear();
        this.poseDirty.length = 0;
        this.keyEdges.clear();
        this.liveSpawned = 0;
        this.respawnPoint = undefined;
        this.clicks = [];
        this.uses = [];
        this.usedNow = EMPTY_USED;
        this.externalEvents = [];
        this._time = 0;
        this._status = 'playing';
        this.started = false;
        this.build(this.world);
        this.log('world reset');
    }
    // ---------------------------------------------------------------------------
    // Tick phases
    // ---------------------------------------------------------------------------
    readInput(input) {
        const s = this.inputState;
        s.forward = clampAxis(input?.forward);
        s.right = clampAxis(input?.right);
        s.jump = input?.jump === true;
        s.action = input?.action === true;
        const keys = input?.keys;
        s.keys = isKeySet(keys) ? keys : EMPTY_KEYS;
        const yaw = input?.pointerYawDeg;
        s.pointerYawDeg = typeof yaw === 'number' && Number.isFinite(yaw) ? yaw : 0;
        this.keyEdges.update(s.keys);
    }
    ingestEvents(events) {
        this.contacts.clear();
        if (!Array.isArray(events))
            return;
        const n = Math.min(events.length, MAX_EVENTS_PER_TICK);
        for (let i = 0; i < n; i++) {
            const ev = events[i];
            if (!ev || typeof ev.a !== 'string' || typeof ev.b !== 'string')
                continue;
            switch (ev.type) {
                case 'collisionStart':
                case 'sensorEnter': {
                    const kind = ev.type === 'collisionStart' ? 'collision' : 'sensor';
                    const impulse = typeof ev.impulse === 'number' && Number.isFinite(ev.impulse) ? ev.impulse : 0;
                    this.link(ev.a, ev.b);
                    this.link(ev.b, ev.a);
                    this.pushContact(ev.a, { other: ev.b, kind, impulse });
                    this.pushContact(ev.b, { other: ev.a, kind, impulse });
                    break;
                }
                case 'collisionEnd':
                case 'sensorExit':
                    this.active.get(ev.a)?.delete(ev.b);
                    this.active.get(ev.b)?.delete(ev.a);
                    break;
            }
        }
    }
    link(a, b) {
        let s = this.active.get(a);
        if (!s) {
            if (this.active.size >= LIMITS.MAX_ENTITIES * 2)
                return;
            this.active.set(a, (s = new Set()));
        }
        if (s.size < 1024)
            s.add(b);
    }
    pushContact(id, c) {
        const list = this.contacts.get(id);
        if (list) {
            if (list.length < 256)
                list.push(c);
        }
        else
            this.contacts.set(id, [c]);
    }
    dropContacts(id) {
        const s = this.active.get(id);
        if (s)
            for (const other of s)
                this.active.get(other)?.delete(id);
        this.active.delete(id);
    }
    updateBehaviors(dt) {
        if (this.npcs.count > 0)
            this.guard('npc tick', () => this.npcs.beginTick(dt));
        const list = this.registry.all();
        const n = list.length;
        for (let i = 0; i < n; i++) {
            const e = list[i];
            const slots = e.behaviors;
            for (let j = 0; j < slots.length; j++) {
                if (!e.alive || this._status !== 'playing')
                    break;
                const slot = slots[j];
                if (!slot.enabled || !slot.instance.update)
                    continue;
                try {
                    slot.instance.update(this, dt);
                }
                catch (err) {
                    slot.enabled = false;
                    this.log(`behavior ${slot.type} on ${e.id} disabled after error: ${errorText(err)}`);
                }
            }
        }
    }
    flushPoses() {
        const q = this.quatScratch;
        for (const e of this.poseDirty) {
            if (!e.alive || e.dynamic)
                continue;
            e.composePose(q);
            this.host.setKinematic(e.id, e.outPos, e.outRot);
        }
        this.poseDirty.length = 0;
    }
    drainScriptDiagnostics() {
        const take = this.scripts?.takeDiagnostics;
        if (!take)
            return;
        let diags;
        try {
            diags = take.call(this.scripts);
        }
        catch {
            return;
        }
        for (const d of diags)
            this.log(`script '${d.scriptId}'${d.entityId ? ` on ${d.entityId}` : ''}: ${d.text}`);
    }
    guard(phase, fn) {
        try {
            fn();
        }
        catch (err) {
            this.log(`internal error during ${phase}: ${errorText(err)}`);
        }
    }
    warnOnce(key, text) {
        if (this.warned.has(key) || this.warned.size > 256)
            return;
        this.warned.add(key);
        this.log(text);
    }
    // ---------------------------------------------------------------------------
    // Scripts
    // ---------------------------------------------------------------------------
    runScript(e, slot, tickDt) {
        const id = slot.scriptId ?? '';
        // Deterministic aggregate budget: at most MAX_SCRIPT_CALLS_PER_TICK calls,
        // rotating which slots run so none starves.
        const idx = this.scriptSeen++;
        const total = Math.max(this.scriptTotalPrev, idx + 1);
        if (total > MAX_SCRIPT_CALLS_PER_TICK && (idx - this.scriptRotation + total) % total >= MAX_SCRIPT_CALLS_PER_TICK) {
            slot.deferredDt = Math.min(MAX_SCRIPT_CATCHUP, (slot.deferredDt ?? 0) + tickDt);
            return;
        }
        const dt = Math.min(MAX_SCRIPT_CATCHUP, tickDt + (slot.deferredDt ?? 0));
        slot.deferredDt = 0;
        if (!this.scripts) {
            this.warnOnce(`norunner:${id}`, `script '${id}' on ${e.id} skipped: no ScriptRunner configured`);
            return;
        }
        if (!id || !hasOwn(this.world.scripts, id)) {
            this.warnOnce(`noscript:${e.id}:${id}`, `script '${id}' on ${e.id} not found in world.scripts`);
            return;
        }
        const intents = this.scripts.update(id, e.id, this.snapshot(e, dt), { worldJson: this.sharedWorldJson() });
        if (!Array.isArray(intents))
            return;
        const ctx = { depth: 0, selfId: e.id };
        const n = Math.min(intents.length, 32);
        for (let i = 0; i < n; i++) {
            if (!e.alive)
                return;
            const checked = checkIntent(intents[i]);
            if (!checked.ok) {
                this.log(`script '${id}' on ${e.id}: intent rejected: ${checked.error}`);
                continue;
            }
            const intent = checked.intent;
            try {
                if (intent.do === 'moveTo') {
                    moveToward(this, e, intent.target, intent.speed, dt, { flat: false, face: false });
                }
                else if (intent.do === 'setSelfState') {
                    this.worldJson = null;
                    writeState(this.scope, `${e.id}.${intent.key}`, intent.value);
                }
                else {
                    const desc = executeAction(intent, this, ctx);
                    if (intent.do !== 'setVelocity' && intent.do !== 'impulse' && intent.do !== 'setProperty') {
                        this.log(`script '${id}' on ${e.id}: ${desc}`);
                    }
                }
            }
            catch (err) {
                this.log(`script '${id}' on ${e.id}: ${intent.do} failed: ${errorText(err)}`);
            }
        }
    }
    /** Serialized world state for this tick (see {@link worldJson}); undefined when it cannot be serialized. */
    sharedWorldJson() {
        if (this.worldJson === null) {
            try {
                this.worldJson = JSON.stringify(this.worldState);
            }
            catch {
                return undefined;
            }
        }
        return this.worldJson;
    }
    snapshot(e, dt) {
        const p = this.positionOf(e.id) ?? e.basePos;
        const position = [p[0], p[1], p[2]];
        const v = this.host.getVelocity(e.id);
        const snap = {
            dt,
            time: this._time,
            self: { id: e.id, position, velocity: v ? [v[0], v[1], v[2]] : [0, 0, 0], state: e.state },
            world: this.worldState,
            nearby: this.nearby(e, position),
            input: { forward: this.inputState.forward, right: this.inputState.right, jump: this.inputState.jump, action: this.inputState.action },
        };
        const pid = this.playerId();
        const pp = pid !== undefined ? this.positionOf(pid) : undefined;
        if (pp)
            snap.player = { position: [pp[0], pp[1], pp[2]] };
        return snap;
    }
    /** Bucket live entities into the per-tick neighbour grid (O(n) once per tick). */
    buildNearGrid() {
        for (const bucket of this.nearGrid.values()) {
            bucket.length = 0;
            this.nearPool.push(bucket);
        }
        this.nearGrid.clear();
        const list = this.registry.all();
        const n = Math.min(list.length, NEARBY_SCAN_LIMIT);
        for (let i = 0; i < n; i++) {
            const o = list[i];
            const q = this.positionOf(o.id);
            if (!q)
                continue;
            const key = cellKey(cellCoord(q[0]), cellCoord(q[1]), cellCoord(q[2]));
            let bucket = this.nearGrid.get(key);
            if (!bucket) {
                bucket = this.nearPool.pop() ?? [];
                this.nearGrid.set(key, bucket);
            }
            bucket.push(o);
        }
        this.nearGridTick = this.tickNo;
    }
    nearby(self, at) {
        if (this.nearGridTick !== this.tickNo)
            this.buildNearGrid();
        const found = [];
        const r2 = NEARBY_RADIUS * NEARBY_RADIUS;
        const cx = cellCoord(at[0]);
        const cy = cellCoord(at[1]);
        const cz = cellCoord(at[2]);
        const visited = new Set();
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const key = cellKey(cx + dx, cy + dy, cz + dz);
                    if (visited.has(key))
                        continue;
                    visited.add(key);
                    const bucket = this.nearGrid.get(key);
                    if (!bucket)
                        continue;
                    for (const o of bucket) {
                        if (o === self || !o.alive)
                            continue;
                        const q = this.positionOf(o.id);
                        if (!q)
                            continue;
                        const ox = q[0] - at[0], oy = q[1] - at[1], oz = q[2] - at[2];
                        const d = ox * ox + oy * oy + oz * oz;
                        if (d <= r2)
                            found.push({ d, e: o, p: [q[0], q[1], q[2]] });
                    }
                }
            }
        }
        found.sort((a, b) => a.d - b.d || (a.e.id < b.e.id ? -1 : 1));
        return found.slice(0, NEARBY_MAX).map((f) => ({ id: f.e.id, tags: f.e.spec.tags.slice(0, 16), position: f.p }));
    }
    // ---------------------------------------------------------------------------
    // BehaviorEnv / RuleHost services
    // ---------------------------------------------------------------------------
    playing() {
        return this._status === 'playing';
    }
    log(text, rule) {
        const entry = rule === undefined ? { t: Math.round(this._time * 1000) / 1000, text } : { t: Math.round(this._time * 1000) / 1000, rule, text };
        // Fixed-size ring: O(1) per entry even when rules log every tick.
        this.ring[(this.ringHead + this.ringSize) % MAX_LOG_ENTRIES] = entry;
        if (this.ringSize < MAX_LOG_ENTRIES)
            this.ringSize++;
        else
            this.ringHead = (this.ringHead + 1) % MAX_LOG_ENTRIES;
        this.ringView = null;
        return entry;
    }
    /**
     * Trace entries, oldest first (at most {@link MAX_LOG_ENTRIES}). The array is
     * rebuilt lazily after new entries and reused between reads; treat it as read-only.
     */
    get entries() {
        if (this.ringView)
            return this.ringView;
        const out = new Array(this.ringSize);
        for (let i = 0; i < this.ringSize; i++)
            out[i] = this.ring[(this.ringHead + i) % MAX_LOG_ENTRIES];
        this.ringView = out;
        return out;
    }
    playerId() {
        if (this.playerTick === this.tickNo)
            return this.playerCache;
        let id;
        try {
            const h = this.host.playerId();
            id = typeof h === 'string' && h.length > 0 ? h : undefined;
        }
        catch {
            id = undefined;
        }
        if (id === undefined && this.defaultPlayer !== undefined && this.registry.has(this.defaultPlayer))
            id = this.defaultPlayer;
        this.playerCache = id;
        this.playerTick = this.tickNo;
        return id;
    }
    entity(id) {
        return this.registry.get(id);
    }
    positionOf(id) {
        const e = this.registry.get(id);
        if (e && !e.dynamic && e.hasPose)
            return e.outPos;
        const cached = this.hostPos.get(id);
        if (cached)
            return cached;
        const t = this.host.getTransform(id);
        if (t && Array.isArray(t.position)) {
            this.hostPos.set(id, t.position);
            return t.position;
        }
        return e ? (e.hasPose ? e.outPos : e.basePos) : undefined;
    }
    velocityOf(id) {
        return this.host.getVelocity(id);
    }
    resolve(selector) {
        return this.registry.resolve(selector, this.playerId(), this.resolveScratch);
    }
    /** Fresh-array resolution for rule/action code (safe across nested calls). */
    select(selector) {
        return this.registry.resolve(selector, this.playerId());
    }
    matches(id, selector) {
        return this.registry.matches(id, selector, this.playerId());
    }
    movers() {
        if (this.moversTick === this.tickNo)
            return this.moversList;
        this.moversTick = this.tickNo;
        const out = this.moversList;
        out.length = 0;
        for (const e of this.registry.all())
            if (e.dynamic)
                out.push(e.id);
        const pid = this.playerId();
        if (pid !== undefined && !out.includes(pid))
            out.push(pid);
        return out;
    }
    frameOf(zone) {
        if (zone.dynamic) {
            const cached = this.zoneFrames.get(zone.id);
            if (cached)
                return cached;
            const t = this.host.getTransform(zone.id);
            if (t) {
                const frame = { pos: t.position, rot: t.quaternion };
                this.zoneFrames.set(zone.id, frame);
                return frame;
            }
        }
        return zone.hasPose ? { pos: zone.outPos, rot: zone.outRot } : { pos: zone.basePos, rot: zone.baseRot };
    }
    touching(zone, otherId, margin) {
        if (this.active.get(zone.id)?.has(otherId))
            return true;
        const p = this.positionOf(otherId);
        if (!p)
            return false;
        const f = this.frameOf(zone);
        return insideZone(zone.zone, f.pos, f.rot, p, margin);
    }
    onTopOf(zone, otherId, height) {
        if (this.active.get(zone.id)?.has(otherId))
            return true;
        const p = this.positionOf(otherId);
        if (!p)
            return false;
        const f = this.frameOf(zone);
        return onTopOfZone(zone.zone, f.pos, f.rot, p, height);
    }
    inZone(zoneId, whoId) {
        const zone = this.registry.get(zoneId);
        return zone !== undefined && this.touching(zone, whoId, 0);
    }
    contactsOf(id) {
        return this.contacts.get(id) ?? EMPTY_CONTACTS;
    }
    pose(self) {
        if (self.poseTick === this.tickNo)
            return;
        self.poseTick = this.tickNo;
        self.offset[0] = 0;
        self.offset[1] = 0;
        self.offset[2] = 0;
        self.extraRot[0] = 0;
        self.extraRot[1] = 0;
        self.extraRot[2] = 0;
        self.extraRot[3] = 1;
        this.poseDirty.push(self);
    }
    setState(key, value) {
        this.worldJson = null;
        const before = writeState(this.scope, key, value);
        return `${key} ${showValue(before)}→${showValue(value)}`;
    }
    addState(key, amount) {
        const cur = readState(this.scope, key);
        if (cur !== undefined && typeof cur !== 'number')
            throw new Error(`'${key}' is not a number (${showValue(cur)})`);
        const next = (cur ?? 0) + amount;
        if (!Number.isFinite(next))
            throw new Error(`'${key}' would become non-finite`);
        this.worldJson = null;
        writeState(this.scope, key, next);
        return `${key} ${showValue(cur)}→${showValue(next)}`;
    }
    spawn(template, at, count, spread, ctx = { depth: 0 }) {
        const tpl = lookupEntity(this.world.entities, template);
        if (!tpl)
            throw new Error(`unknown template '${template}'`);
        const n = Math.max(0, Math.min(Math.floor(Number.isFinite(count) ? count : 1), 500));
        const radius = Number.isFinite(spread) && spread > 0 ? Math.min(spread, 1000) : 0;
        let base;
        if (at === undefined)
            base = this.worldPose(tpl).pos;
        else {
            const loc = locate(this, at, ctx);
            if (!loc)
                throw new Error(`spawn location '${String(at)}' not found`);
            base = loc;
        }
        const ids = [];
        for (let i = 0; i < n; i++) {
            if (this.spawnedThisTick >= MAX_SPAWNS_PER_TICK || this.liveSpawned >= MAX_LIVE_SPAWNED || this.registry.size >= LIMITS.MAX_ENTITIES) {
                this.warnOnce(`spawncap:${this.tickNo}`, `spawn limit reached (≤${MAX_SPAWNS_PER_TICK}/tick, ≤${MAX_LIVE_SPAWNED} alive)`);
                break;
            }
            const pos = [base[0], base[1], base[2]];
            if (radius > 0) {
                const a = this.spawnRandom() * Math.PI * 2;
                const r = Math.sqrt(this.spawnRandom()) * radius;
                pos[0] += Math.cos(a) * r;
                pos[2] += Math.sin(a) * r;
            }
            const id = this.nextSpawnId(template);
            // The template is part of the validated WorldDoc (plain JSON data): a
            // structured clone is enough; hosts may skip re-validation (trusted spawn).
            const clone = structuredClone(tpl);
            clone.id = id;
            clone.template = false;
            clone.parent = null;
            clone.transform.position = pos;
            this.addEntity(clone, true, pos);
            this.spawnedThisTick++;
            this.liveSpawned++;
            ids.push(id);
            this.host.spawn(clone);
        }
        return ids;
    }
    nextSpawnId(template) {
        let n = this.spawnCounters.get(template) ?? 0;
        for (;;) {
            n++;
            const suffix = `-${n}`;
            const id = `${template.slice(0, 64 - suffix.length)}${suffix}`;
            if (!this.registry.has(id) && !hasOwn(this.world.entities, id)) {
                this.spawnCounters.set(template, n);
                return id;
            }
        }
    }
    destroy(id) {
        const e = this.registry.get(id);
        if (!e)
            return;
        this.removeEntity(e);
        this.host.destroy(id);
    }
    emit(event, delay = 0, ctx = { depth: 0 }) {
        this.rules.emit(event, delay, ctx);
    }
    gameOver(result, text, why) {
        if (this._status !== 'playing')
            return;
        this._status = result === 'win' ? 'won' : 'lost';
        this.log(`${result === 'win' ? 'WIN' : 'LOSE'}: "${text}" (${why})`);
        this.host.gameOver(result, text);
    }
    teleport(id, p) {
        this.host.teleport(id, p);
        this.hostPos.delete(id);
        const e = this.registry.get(id);
        if (e && !e.dynamic) {
            copy3(e.anchor, p);
            this.pose(e);
        }
    }
    setVelocity(id, v) {
        this.host.setVelocity(id, v);
    }
    impulse(id, v) {
        this.host.applyImpulse(id, v);
    }
    setProperty(id, path, value) {
        this.host.setProperty(id, path, value);
    }
    enableBehavior(id, behavior, enabled) {
        const e = this.registry.get(id);
        if (!e)
            return 0;
        let n = 0;
        for (const slot of e.behaviors) {
            if (behavior === '*' || slot.type === behavior || (slot.type === 'script' && behavior === `script:${slot.scriptId ?? ''}`)) {
                slot.enabled = enabled;
                n++;
            }
        }
        return n;
    }
    explode(center, force, radius) {
        this.host.explode(center, force, radius);
    }
    setGravity(v) {
        this.host.setGravity(v);
    }
    message(text, duration) {
        this.host.message(text, duration);
    }
    sound(name) {
        this.host.sound(name);
    }
    requestReset() {
        this.resetPending = true;
    }
}
const EMPTY_KEYS = new Set();
/** Hot-reload key of an entity's NPC spec. */
function npcKey(npc) {
    return `npc:${stableStringify(npc)}`;
}
/** Accept any iterable set-like (e.g. a ReadonlySet from another realm). */
function isKeySet(v) {
    return (typeof v === 'object' &&
        v !== null &&
        typeof v.size === 'number' &&
        typeof v[Symbol.iterator] === 'function');
}
