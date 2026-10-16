import { Engine } from './engine';
/** Deterministic gameplay runtime: built-in behaviors + rules + sandboxed scripts. */
export class LogicRuntime {
    engine;
    /**
     * Trace for the "why did this happen" panel: bounded ring buffer (500
     * entries, newest last). Rule firings carry the rule id and read like
     * "rule 'coin-pickup' fired: player entered coin-3 → score 2→3".
     */
    get log() {
        return this.engine.entries;
    }
    constructor(world, host, opts = {}) {
        this.engine = new Engine(world, host, opts);
    }
    /** Fire 'start' rules (idempotent; also done automatically by the first tick). */
    start() {
        this.engine.start();
    }
    /**
     * Advance the simulation by one fixed step. `events` are the physics events
     * produced by the matching physics step. Never throws.
     */
    tick(dt, input, events) {
        this.engine.tick(dt, input, events);
    }
    /** Report a click/tap on an entity (handled at the next tick). */
    click(id) {
        this.engine.click(id);
    }
    /** The player aimed at an entity and pressed the use key (handled at the next tick). */
    use(id) {
        this.engine.use(id);
    }
    /** Emit a named event from outside (handled at the next tick). */
    emit(event) {
        this.engine.emitExternal(event);
    }
    /** World state (score, lives…). Live view — do not mutate. */
    get state() {
        return this.engine.state;
    }
    /** An entity's state (e.g. door `open`). Live view — do not mutate. */
    entityState(id) {
        return this.engine.entityState(id);
    }
    /** Read "score" or "door-1.open" (same semantics as `readStateKey`). */
    readState(key) {
        return this.engine.readState(key);
    }
    /** Simulated seconds since start (reset by the `reset` action). */
    get time() {
        return this.engine.time;
    }
    /** 'playing' until a win/lose action or behavior ends the session. */
    get status() {
        return this.engine.status;
    }
    /**
     * NPC services: the running conversation (`dialogue`), the talk prompt,
     * speech bubbles, `choose` / `advance` / `startDialogue` for touch and
     * pointer input, damage and introspection. Always present; inert when the
     * world has no NPCs.
     */
    get npcs() {
        return this.engine.npcs;
    }
    /** Hot-reload rules, behaviors and entities while preserving runtime state. */
    updateWorld(world) {
        this.engine.updateWorld(world);
    }
    /** Release behaviors and internal state. Does not dispose the caller-owned ScriptRunner. */
    dispose() {
        this.engine.dispose();
    }
}
