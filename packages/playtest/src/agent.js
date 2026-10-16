/**
 * The autonomous playtest agent.
 *
 * Given a World IR it derives the goals (see `goals.ts`), samples a
 * navigation graph from an isolated physics world, then plays the game the
 * way a person would — by pressing movement keys and jump on the real
 * character controller, with the real gameplay logic running — until the
 * game is won, lost, or provably cannot be won:
 *
 * 1. pick the nearest reachable pending objective (Dijkstra over walk,
 *    jump and drop edges; jumps are validated by simulation),
 * 2. walk the path; open doors by proximity or key press; replan when the
 *    path is blocked and remember the bad edge,
 * 3. touch the objective (stand, then jump) and let the logic react,
 * 4. repeat; objectives behind a door that does not open are deferred and
 *    retried after something changes (a key picked up),
 * 5. win objectives (goal, winning zones) come last.
 *
 * It then explains what it found: unreachable objectives with the gap to
 * the nearest standable spot, doors that cannot open, an unwinnable
 * condition, pits the player can fall into and never leave (soft-locks),
 * places it got stuck, and the falls. Everything runs headless at the
 * fixed 60 Hz step, far faster than real time, with a sim-time cap, a
 * wall-clock budget and cooperative yielding (so it can live in a worker).
 */
import { validateWorld } from '@aether/core';
import { PhysicsWorld, entityBounds, yieldToHost } from '@aether/physics';
import { deriveGoals, inRegion, needsHold, touches, winThresholds } from './goals';
import { PLAYER_CAPSULE } from './host';
import { EdgeKind, NavGraph, airThrust, doorFitRadius, doorSlack, jumpHeight } from './nav';
import { hashWorld } from './proof';
import { deriveWalkGoals } from './rooms';
import { withDoorsOpen } from './doorpose';
import { checkBuildings } from '@aether/arch';
import { Session, STEP } from './session';
import { PLAYTEST_LIMITS, } from './types';
/** Error thrown when the run is cancelled through its signal. */
export class PlaytestAbortedError extends Error {
    name = 'AbortError';
    constructor() {
        super('playtest cancelled');
    }
}
function clamp(v, def, lo, hi) {
    return typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def;
}
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const r1 = (v) => Math.round(v * 10) / 10;
/** Searches per game plan before giving up: every invalid jump or drop found on the best path is excluded and the search repeats (a raised walkway has hundreds of side drops). A walkthrough keeps 14: it must not find its way through a door that is too narrow. */
const PLAN_ATTEMPTS = 160;
const r2 = (v) => Math.round(v * 100) / 100;
/** The key code a rule's key name stands for ("e" → KeyE, "1" → Digit1, "space" → Space). */
function keyCode(name) {
    const k = name.trim();
    if (/^[a-zA-Z]$/.test(k))
        return `Key${k.toUpperCase()}`;
    if (/^[0-9]$/.test(k))
        return `Digit${k}`;
    return k.length > 0 ? k[0]?.toUpperCase() + k.slice(1) : 'KeyE';
}
function truthy(v) {
    if (v === true)
        return true;
    if (typeof v === 'number')
        return v !== 0 && !Number.isNaN(v);
    if (typeof v === 'string')
        return v !== '' && v !== 'false' && v !== 'closed' && v !== 'off' && v !== '0';
    return false;
}
function fmtPos(p) {
    return `${r1(p[0])},${r1(p[2])}`;
}
/** Copy of `world` without the given entities and their descendants. */
export function withoutEntities(world, ids) {
    const doc = structuredClone(world);
    const drop = new Set(ids);
    for (let changed = true; changed;) {
        changed = false;
        for (const id in doc.entities) {
            const e = doc.entities[id];
            if (e.parent !== null && drop.has(e.parent) && !drop.has(id)) {
                drop.add(id);
                changed = true;
            }
        }
    }
    for (const id of drop)
        delete doc.entities[id];
    for (const id in doc.entities) {
        const e = doc.entities[id];
        if (e.joint && e.joint.target !== 'world' && drop.has(e.joint.target))
            delete e.joint;
    }
    return doc;
}
/** Why a world cannot be driven by the bot, or null. */
export function unsupportedReason(world) {
    if (world.voxel !== undefined)
        return 'block worlds are played with their own controls, which the bot cannot drive yet';
    const mode = world.player.mode;
    if (mode === 'orbit')
        return 'the player view is an orbit camera, so there is no character to play';
    if (mode === 'vehicle')
        return 'the player drives a vehicle, which the bot cannot drive yet';
    const c = world.player.controls;
    if (c && Object.prototype.hasOwnProperty.call(world.entities, c) && !world.entities[c].template)
        return 'the player is an avatar entity, which the bot cannot drive yet';
    for (const id in world.entities) {
        const e = world.entities[id];
        if (!e.template && e.behaviors.some((b) => b.type === 'playerController' && b.enabled))
            return 'the player is an avatar entity, which the bot cannot drive yet';
    }
    if (Object.prototype.hasOwnProperty.call(world.entities, 'player') && !world.entities['player'].template)
        return 'the player is an avatar entity, which the bot cannot drive yet';
    return null;
}
/**
 * The area the bot maps: the box around the spawn point and everything it
 * has to reach, grown by a margin for detours, and clipped to the solid
 * geometry's extent (a 400 m ground does not make a 400 m grid). Heights
 * come from the geometry inside that box.
 */
function navBounds(doc, points) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of points) {
        minX = Math.min(minX, p[0]);
        maxX = Math.max(maxX, p[0]);
        minZ = Math.min(minZ, p[2]);
        maxZ = Math.max(maxZ, p[2]);
    }
    const span = Math.max(maxX - minX, maxZ - minZ);
    const margin = Math.min(40, Math.max(7, span * 0.35));
    minX -= margin;
    maxX += margin;
    minZ -= margin;
    maxZ += margin;
    let minY = 0, maxY = 0;
    for (const p of points) {
        minY = Math.min(minY, p[1]);
        maxY = Math.max(maxY, p[1]);
    }
    // Structures that touch the area (a spiral of platforms, a building) are mapped whole.
    const solids = [];
    for (const id in doc.entities) {
        const e = doc.entities[id];
        if (e.template || !e.physics || e.physics.collider === 'none' || e.physics.sensor || e.shape.kind === 'none' || e.shape.kind === 'scatter')
            continue;
        const bb = entityBounds(doc, id);
        if (bb)
            solids.push(bb);
    }
    const used = new Array(solids.length).fill(false);
    for (let round = 0; round < 6; round++) {
        let grew = false;
        for (let i = 0; i < solids.length; i++) {
            const bb = solids[i];
            if (used[i])
                continue;
            if (bb.max[0] < minX - 1.5 || bb.min[0] > maxX + 1.5 || bb.max[2] < minZ - 1.5 || bb.min[2] > maxZ + 1.5)
                continue;
            used[i] = true;
            minY = Math.min(minY, bb.min[1]);
            maxY = Math.max(maxY, bb.max[1]);
            // Very wide slabs (a 400 m ground) do not stretch the area.
            if (bb.max[0] - bb.min[0] <= 80 && bb.max[2] - bb.min[2] <= 80) {
                const nx0 = Math.min(minX, bb.min[0]), nx1 = Math.max(maxX, bb.max[0]), nz0 = Math.min(minZ, bb.min[2]), nz1 = Math.max(maxZ, bb.max[2]);
                if (nx0 !== minX || nx1 !== maxX || nz0 !== minZ || nz1 !== maxZ)
                    grew = true;
                minX = nx0;
                maxX = nx1;
                minZ = nz0;
                maxZ = nz1;
            }
        }
        if (!grew)
            break;
    }
    const reach = 330;
    const spawn = doc.player.spawn;
    return {
        minX: Math.max(minX, spawn[0] - reach),
        maxX: Math.min(maxX, spawn[0] + reach),
        minZ: Math.max(minZ, spawn[2] - reach),
        maxZ: Math.min(maxZ, spawn[2] + reach),
        topY: Math.min(maxY, minY + 80) + 1.5,
        bottomY: Math.min(minY, 0) - 2,
    };
}
/** Run the autonomous playtest of a game. Never throws except for cancellation. */
export async function playtest(input, opts = {}) {
    const bot = new Bot(input, opts, 'game');
    return bot.run();
}
/**
 * Walk through a building: the bot enters at the player spawn and must reach
 * every room through its doors (pressing the door key where doors need it)
 * and up its stairs, while the document checks for furniture in the way of
 * doors and floating or overlapping pieces run alongside. Never throws except
 * for cancellation.
 */
export async function walkthrough(input, opts = {}) {
    const bot = new Bot(input, opts, 'walkthrough');
    return bot.run();
}
class Bot {
    opts;
    kind;
    t0 = nowMs();
    budgetMs;
    maxSim;
    world;
    goals;
    session;
    probe = null;
    graph;
    params;
    stopReason = null;
    lastYield = nowMs();
    lastProgress = 0;
    note = 'preparing';
    phase = 'prepare';
    results = new Map();
    pending = new Map();
    failedReason = new Map();
    replans = new Map();
    targetsCache = new Map();
    stuckPoints = [];
    stuckBlockers = new Map();
    findings = [];
    doorFailures = new Map();
    doorWas = new Map();
    /** Doors too narrow for the player: clear width and the width needed (m). */
    /** Room to spare per side at each doorway (m). */
    doorSlack = new Map();
    narrowDoors = new Map();
    fellCount = 0;
    /** `talk` objectives whose conversation delivered what the game needs. */
    talkDone = new Set();
    pressed = new Set();
    lifts = new Map();
    /** Why a conversation did not deliver (plain words), per objective. */
    talkWhy = new Map();
    startNode = -1;
    reachableFromStart = null;
    doneCount = 0;
    navMs = 0;
    planMs = 0;
    totalObjectives = 0;
    constructor(world, opts, kind) {
        this.opts = opts;
        this.kind = kind;
        this.world = world;
        this.budgetMs = clamp(opts.budgetMs, PLAYTEST_LIMITS.DEFAULT_BUDGET_MS, 500, PLAYTEST_LIMITS.MAX_BUDGET_MS);
        this.maxSim = clamp(opts.maxSimSeconds, PLAYTEST_LIMITS.DEFAULT_MAX_SIM_SECONDS, 5, PLAYTEST_LIMITS.MAX_SIM_SECONDS);
    }
    // -------------------------------------------------------------------
    // Plumbing
    // -------------------------------------------------------------------
    emit(force = false) {
        const cb = this.opts.onProgress;
        if (!cb)
            return;
        const t = nowMs();
        if (!force && t - this.lastProgress < 90)
            return;
        this.lastProgress = t;
        const total = Math.max(1, this.totalObjectives);
        const frac = this.phase === 'prepare' ? 0.05 : this.phase === 'analyse' ? 0.95 : this.phase === 'done' ? 1 : 0.1 + 0.8 * Math.min(1, this.doneCount / total);
        try {
            cb({ phase: this.phase, fraction: frac, seconds: this.session ? r2(this.session.time) : 0, note: this.note, ...(this.session ? { position: this.session.position } : {}) });
        }
        catch {
            /* a failing observer must not stop the run */
        }
    }
    async checkpoint() {
        if (this.opts.signal?.aborted)
            throw new PlaytestAbortedError();
        if (nowMs() - this.t0 > this.budgetMs)
            this.stopReason = 'budget';
        if (this.session && this.session.time > this.maxSim)
            this.stopReason = this.stopReason ?? 'time';
        if (nowMs() - this.lastYield > 8) {
            this.emit();
            await yieldToHost();
            this.lastYield = nowMs();
            if (this.opts.signal?.aborted)
                throw new PlaytestAbortedError();
        }
    }
    get stopped() {
        return this.stopReason !== null || this.session.over;
    }
    /** One tick with bookkeeping; false when the run must stop. */
    async step(forward, right, jump, yawDeg, keys) {
        if (this.stopped)
            return false;
        this.session.tick({ forward, right, jump, yawDeg, ...(keys ? { keys } : {}) });
        this.scanObjectives();
        if ((this.session.steps & 7) === 0)
            this.watchDoors();
        if ((this.session.steps & 31) === 0)
            await this.checkpoint();
        return !this.stopped;
    }
    async idle(seconds) {
        const n = Math.round(seconds / STEP);
        for (let i = 0; i < n; i++)
            if (!(await this.step(0, 0, false, this.session.yawDeg)))
                return false;
        return true;
    }
    /** Replay events for doors that swing open. */
    watchDoors() {
        for (const d of this.goals.doors) {
            const open = this.doorOpen(d);
            if (open !== (this.doorWas.get(d.id) ?? d.startOpen)) {
                this.doorWas.set(d.id, open);
                if (open)
                    this.session.note('door', `${d.id} opens`, d.center);
            }
        }
    }
    scanObjectives() {
        if (this.pending.size === 0)
            return;
        const s = this.session;
        const feet = s.character.position;
        const won = s.host.seen.outcome === 'win';
        for (const o of this.pending.values()) {
            let done = false;
            switch (o.kind) {
                case 'collect':
                    done = o.entity !== undefined && (s.host.seen.destroyed.has(o.entity) || s.host.seen.hidden.has(o.entity));
                    break;
                case 'goal':
                    done = won || (o.gated !== true && touches(o.touch, feet));
                    break;
                case 'press':
                    done = this.pressed.has(o.id) || won;
                    break;
                case 'zone':
                    done = (o.completes === 'game-over' && won) || touches(o.touch, feet);
                    break;
                case 'room':
                    done = o.region !== undefined && inRegion(o.region, feet, 0.12);
                    break;
                case 'talk':
                    done = this.talkDone.has(o.id) || (o.talk?.wins === true && won);
                    break;
                default:
                    done = touches(o.touch, feet);
            }
            if (done)
                this.complete(o);
        }
    }
    complete(o) {
        this.pending.delete(o.id);
        const r = this.results.get(o.id);
        if (r) {
            r.status = 'done';
            r.at = r2(this.session.time);
            delete r.reason;
        }
        this.doneCount++;
        this.note = `${o.kind === 'collect' ? 'collected' : 'reached'} ${o.label} (${this.doneCount}/${this.totalObjectives})`;
        this.session.note(o.kind === 'collect' ? 'pickup' : 'goal', o.label, o.position);
        this.emit(true);
    }
    // -------------------------------------------------------------------
    // Preparation
    // -------------------------------------------------------------------
    base(status, summary, extra = {}) {
        return {
            v: 1,
            kind: this.kind,
            status,
            won: false,
            outcome: null,
            seconds: 0,
            steps: 0,
            wallMs: Math.round(nowMs() - this.t0),
            objectives: [],
            findings: [],
            falls: 0,
            stuckPoints: [],
            path: [],
            summary,
            worldHash: hashWorld(this.world),
            ...extra,
        };
    }
    /** Run the playtest. */
    async run() {
        const verdict = validateWorld(this.world);
        if (!verdict.ok)
            return this.base('inconclusive', 'The world is not valid, so it cannot be played yet.', { findings: [{ code: 'budget', severity: 'error', message: 'the world document is invalid', entities: [], hint: 'fix the validation errors first' }] });
        const why = unsupportedReason(this.world);
        if (why) {
            return this.base('unsupported', `The bot cannot play this world: ${why}.`, { findings: [{ code: 'unsupported', severity: 'info', message: why, entities: [], hint: 'none' }] });
        }
        this.goals = this.kind === 'walkthrough' ? deriveWalkGoals(this.world) : deriveGoals(this.world);
        if (this.kind === 'walkthrough' && this.goals.objectives.length === 0) {
            return this.base('inconclusive', 'Nothing to walk through: this world has no building with rooms.', { findings: [{ code: 'no_entrance', severity: 'warning', message: 'no rooms were found in this world', entities: [], hint: 'build a house or an apartment first' }] });
        }
        if (this.goals.objectives.length === 0 && !this.goals.winDefined) {
            return this.base('inconclusive', 'Nothing to play yet: the world has no pickups, goal or win condition for a player to reach.', {
                findings: [{ code: 'no_win_condition', severity: 'warning', message: 'there is no goal, pickup or winning rule in this world', entities: [], hint: 'add a goal or a win rule' }],
            });
        }
        if (this.goals.hasScripts && !this.opts.scripts) {
            // Scripts can steer the game in ways the document does not show; say so instead of guessing.
            this.findings.push({ code: 'unsupported', severity: 'info', message: 'custom scripts are part of this game; the bot plays the document rules only', entities: [], hint: 'none' });
        }
        this.totalObjectives = this.goals.objectives.length;
        this.emit(true);
        let session = null;
        let runner;
        try {
            runner = this.goals.hasScripts ? this.opts.scripts?.() : undefined;
            session = await Session.create(this.world, { trace: this.opts.trace ?? true, traceHz: this.opts.traceHz ?? 12, ...(runner ? { scripts: runner } : {}) });
            this.session = session;
            await this.prepare();
            if (this.startNode >= 0 || this.findings.every((f) => f.code !== 'spawn_blocked'))
                await this.play();
            return await this.finish();
        }
        finally {
            this.graph?.dispose();
            this.probe?.dispose();
            session?.dispose();
            try {
                runner?.dispose();
            }
            catch {
                /* already disposed */
            }
        }
    }
    async prepare() {
        const w = this.world;
        const doorIds = new Set(this.goals.doors.map((d) => d.id));
        const probeDoc = doorIds.size > 0 ? withDoorsOpen(w, this.goals.doors) : w;
        this.probe = await PhysicsWorld.create(probeDoc, { fixedDt: STEP });
        const gravity = Math.abs(w.environment.gravity[1]) || 9.81;
        this.params = {
            radius: PLAYER_CAPSULE.radius,
            height: PLAYER_CAPSULE.height,
            stepHeight: 0.35,
            maxSlopeDeg: 50,
            speed: w.player.moveSpeed,
            jumpSpeed: w.player.jumpSpeed,
            gravity,
        };
        // Let the player land first: the spawn point is usually a little above the floor.
        this.phase = 'prepare';
        this.note = 'landing at the spawn point';
        const spawn = w.player.spawn;
        const buried = this.solidAt(spawn, this.session.pw);
        if (buried) {
            this.findings.push({
                code: 'spawn_blocked',
                severity: 'error',
                message: `the player spawns inside ${buried} at ${fmtPos(spawn)}`,
                entities: [buried],
                position: [spawn[0], spawn[1], spawn[2]],
                hint: 'move player.spawn to open floor',
                data: { x: spawn[0], y: spawn[1], z: spawn[2], inside: buried },
            });
            return;
        }
        for (let i = 0; i < 90 && !this.session.over; i++)
            this.session.tick({ forward: 0, right: 0, jump: false, yawDeg: 0 });
        const landed = this.session.position;
        const objectivePoints = this.goals.objectives.map((o) => o.position);
        const doorPoints = this.goals.doors.map((d) => d.center);
        this.note = 'mapping the level';
        const b = navBounds(probeDoc, [...objectivePoints, ...doorPoints, landed, [spawn[0], spawn[1], spawn[2]]]);
        const navT0 = nowMs();
        const portals = this.goals.doors
            .filter((d) => d.bounds !== null)
            .map((d) => {
            const bb = d.bounds;
            const thick = Math.abs(d.normal[0]) * (bb.max[0] - bb.min[0]) + Math.abs(d.normal[1]) * (bb.max[2] - bb.min[2]);
            return { door: d, center: [d.center[0], bb.min[1], d.center[2]], normal: d.normal, halfThickness: Math.min(0.4, thick / 2 + 0.06) };
        });
        // Doorways the player's body cannot get through at all, however carefully it is steered.
        for (const portal of portals) {
            const fit = doorFitRadius(this.probe, portal, this.params);
            const need = this.params.radius + 0.025;
            this.doorSlack.set(portal.door.id, doorSlack(this.probe, portal, this.params));
            if (fit < need - 1e-6)
                this.narrowDoors.set(portal.door.id, { clear: Math.round(fit * 2 * 100) / 100, need: Math.round(need * 2 * 100) / 100 });
        }
        this.graph = await NavGraph.build({
            pw: this.probe,
            ...b,
            params: this.params,
            hazards: this.goals.hazards,
            portals,
            tick: async () => {
                await this.checkpoint();
            },
        });
        this.navMs = Math.round(nowMs() - navT0);
        this.registerLifts();
        this.startNode = this.graph.nearest(landed, 2.5, 3);
        if (this.startNode < 0 || landed[1] < -20) {
            const inside = this.solidAt(spawn);
            const message = landed[1] < -20
                ? `the player spawns at ${fmtPos(spawn)} with no floor underneath and falls out of the world`
                : inside
                    ? `the player spawns inside ${inside} at ${fmtPos(spawn)}`
                    : `the player spawns at ${fmtPos(spawn)} where there is nowhere to stand`;
            this.findings.push({
                code: 'spawn_blocked',
                severity: 'error',
                message,
                entities: inside ? [inside] : [],
                position: [spawn[0], spawn[1], spawn[2]],
                hint: 'move player.spawn to open floor',
                data: { x: spawn[0], y: spawn[1], z: spawn[2], landedY: landed[1] },
            });
            return;
        }
        // Everything reachable from the start with all doors open: used to tell "behind a door" from "impossible".
        this.graph.blocked.fill(0);
        const full = this.graph.search(this.startNode);
        this.reachableFromStart = Float64Array.from(full.dist);
        for (const o of this.goals.objectives) {
            this.pending.set(o.id, o);
            this.results.set(o.id, { id: o.id, kind: o.kind, label: o.label, ...(o.entity ? { entity: o.entity } : {}), position: [o.position[0], o.position[1], o.position[2]], required: o.required, status: 'pending' });
        }
        this.session.note('start', 'start', landed);
    }
    /** Id of the solid entity at a point (spawn inside geometry), or null. */
    solidAt(p, pw = this.probe) {
        if (!pw)
            return null;
        for (const id of pw.overlapsSphere([p[0], p[1] + 0.9, p[2]], 0.3)) {
            const e = this.world.entities[id];
            if (e?.physics && !e.physics.sensor && e.physics.body !== 'dynamic')
                return id;
        }
        return null;
    }
    // -------------------------------------------------------------------
    // Doors
    // -------------------------------------------------------------------
    doorOpen(d) {
        return this.session.entityState(d.id)['open'] === true;
    }
    doorPassable(d) {
        if (this.doorOpen(d))
            return true;
        if (this.doorFailures.has(d.id))
            return false;
        switch (d.trigger) {
            case 'state':
                return d.stateKey !== '' && truthy(this.session.runtime.readState(d.stateKey));
            default:
                return true;
        }
    }
    doorBox(d) {
        if (!d.bounds)
            return null;
        const m = this.params.radius + 0.25;
        return { min: [d.bounds.min[0] - m, d.bounds.min[1] - 0.6, d.bounds.min[2] - m], max: [d.bounds.max[0] + m, d.bounds.max[1] + 0.1, d.bounds.max[2] + m] };
    }
    refreshDoors() {
        this.graph.blocked.fill(0);
        for (const d of this.goals.doors) {
            if (this.doorPassable(d))
                continue;
            const box = this.doorBox(d);
            if (box)
                this.graph.setBlocked(box.min, box.max, true);
        }
    }
    doorNear(p, slack = 0.9) {
        for (const d of this.goals.doors) {
            const b = d.bounds;
            if (!b)
                continue;
            if (p[0] >= b.min[0] - slack && p[0] <= b.max[0] + slack && p[2] >= b.min[2] - slack && p[2] <= b.max[2] + slack && p[1] >= b.min[1] - 0.6 && p[1] <= b.max[1] + 0.2)
                return d;
        }
        return null;
    }
    /** Make a door open (wait near it, press its key) and let the leaf swing. False when it never opens. */
    async openDoor(d, yaw) {
        if (this.doorOpen(d)) {
            return this.idle(0.05);
        }
        const t0 = this.session.time;
        let pressed = false;
        while (this.session.time - t0 < 4.5) {
            if (d.trigger === 'key' && !pressed) {
                pressed = true;
                if (!(await this.step(0, 0, false, yaw, [d.key])))
                    return false;
            }
            else if (!(await this.step(0, 0, false, yaw)))
                return false;
            if (this.doorOpen(d)) {
                return this.idle(d.duration * 0.95 + 0.1);
            }
        }
        return false;
    }
    // -------------------------------------------------------------------
    // Planning and travel
    // -------------------------------------------------------------------
    /** A character walks about: aim at where it stands now (never cached). */
    refreshTalk(o) {
        const t = o.talk;
        if (!t)
            return;
        const info = this.session.runtime.npcs.info(t.npc);
        const tr = this.session.host.getTransform(t.npc);
        if (!info || !tr)
            return;
        o.touch.center = [info.x, tr.position[1], info.z];
        o.position = o.touch.center;
    }
    /** The conversation can be had now: the options it needs are available (enough gold …). */
    talkReady(o) {
        const t = o.talk;
        if (!t)
            return true;
        const info = this.session.runtime.npcs.info(t.npc);
        if (!info || info.dead)
            return false;
        return needsHold(t.needs, (k) => this.session.runtime.readState(k));
    }
    targetsFor(o) {
        if (o.kind === 'talk') {
            this.refreshTalk(o);
            return this.scanTargets(o.touch, 0);
        }
        const hit = this.targetsCache.get(o.id);
        if (hit)
            return hit;
        let out;
        if (o.kind === 'room' && o.region) {
            out = this.scanRegion(o.region, 0.45);
            if (out.length === 0)
                out = this.scanRegion(o.region, 0.2);
        }
        else {
            out = this.scanTargets(o.touch, Math.max(0, jumpHeight(this.params) * 0.9));
        }
        if (this.targetsCache.size < 400)
            this.targetsCache.set(o.id, out);
        return out;
    }
    /** Nodes standing in a room region, at least `inset` metres inside its outline. */
    scanRegion(region, inset) {
        const g = this.graph;
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const p of region.poly) {
            minX = Math.min(minX, p[0]);
            maxX = Math.max(maxX, p[0]);
            minZ = Math.min(minZ, p[1]);
            maxZ = Math.max(maxZ, p[1]);
        }
        const cx0 = Math.max(0, Math.floor((minX - g.x0) / g.cell));
        const cx1 = Math.min(g.nx - 1, Math.floor((maxX - g.x0) / g.cell));
        const cz0 = Math.max(0, Math.floor((minZ - g.z0) / g.cell));
        const cz1 = Math.min(g.nz - 1, Math.floor((maxZ - g.z0) / g.cell));
        const feet = [0, 0, 0];
        const out = [];
        for (let cz = cz0; cz <= cz1; cz++) {
            for (let cx = cx0; cx <= cx1; cx++) {
                const c = cz * g.nx + cx;
                for (let n = g.cellFirst[c]; n < g.cellFirst[c + 1]; n++) {
                    feet[0] = g.px[n];
                    feet[1] = g.py[n];
                    feet[2] = g.pz[n];
                    if (inRegion(region, feet, inset))
                        out.push({ node: n, jump: false });
                }
            }
        }
        return out;
    }
    /** Nodes whose feet (raised by up to `apex` while jumping) are inside a trigger volume. */
    scanTargets(v, apex) {
        const g = this.graph;
        const hr = Math.max(v.shape.half[0], v.shape.half[2], v.shape.half[1]) + v.margin + 0.6;
        const out = [];
        const cx0 = Math.max(0, Math.floor((v.center[0] - hr - g.x0) / g.cell));
        const cx1 = Math.min(g.nx - 1, Math.floor((v.center[0] + hr - g.x0) / g.cell));
        const cz0 = Math.max(0, Math.floor((v.center[2] - hr - g.z0) / g.cell));
        const cz1 = Math.min(g.nz - 1, Math.floor((v.center[2] + hr - g.z0) / g.cell));
        const feet = [0, 0, 0];
        for (let cz = cz0; cz <= cz1; cz++) {
            for (let cx = cx0; cx <= cx1; cx++) {
                const c = cz * g.nx + cx;
                for (let n = g.cellFirst[c]; n < g.cellFirst[c + 1]; n++) {
                    feet[0] = g.px[n];
                    feet[2] = g.pz[n];
                    const y = g.py[n];
                    for (let h = 0; h <= apex + 1e-6; h += 0.3) {
                        feet[1] = y + h;
                        if (touches(v, feet)) {
                            out.push({ node: n, jump: h > 0 });
                            break;
                        }
                    }
                }
            }
        }
        return out;
    }
    isWinObjective(o) {
        return o.kind === 'goal' || (o.kind === 'zone' && o.completes === 'game-over');
    }
    /** Objectives done last: the ones that end the game and the key presses that set it off. */
    isFinale(o) {
        return this.isWinObjective(o) || o.kind === 'press';
    }
    /** Nearest reachable pending objective and the path to it, or null. */
    plan(from) {
        const planT0 = nowMs();
        try {
            return this.planInner(from);
        }
        finally {
            this.planMs += nowMs() - planT0;
        }
    }
    planInner(from) {
        const g = this.graph;
        this.refreshDoors();
        for (const phase of [0, 1]) {
            const owner = new Map();
            for (const o of this.pending.values()) {
                if (this.failedReason.has(o.id))
                    continue;
                if (o.kind === 'talk' && !this.talkReady(o))
                    continue;
                if ((phase === 0) === this.isFinale(o))
                    continue;
                for (const t of this.targetsFor(o)) {
                    const prev = owner.get(t.node);
                    if (!prev || (prev.jump && !t.jump))
                        owner.set(t.node, { o, jump: t.jump });
                }
            }
            if (owner.size === 0)
                continue;
            for (let attempt = 0; attempt < (this.kind === 'walkthrough' ? 14 : PLAN_ATTEMPTS); attempt++) {
                const res = g.search(from, (n) => owner.has(n));
                if (res.hit < 0)
                    break;
                const path = g.pathTo(res.parent, res.hit);
                let bad = -1;
                for (let i = 0; i + 1 < path.length; i++) {
                    const a = path[i];
                    const b = path[i + 1];
                    const kind = g.edgeKind(a, b);
                    if (kind !== EdgeKind.Walk && !g.validateLink(a, b, this.params.speed, this.params.jumpSpeed)) {
                        bad = i;
                        break;
                    }
                }
                if (bad >= 0)
                    continue;
                const t = owner.get(res.hit);
                return { objective: t.o, path, jumpAt: t.jump };
            }
        }
        return null;
    }
    yawTo(from, x, z) {
        return (Math.atan2(-(x - from[0]), -(z - from[2])) * 180) / Math.PI;
    }
    /** Walk a node path. Returns how it ended. */
    async travel(path) {
        const g = this.graph;
        const s = this.session;
        const tele0 = s.host.seen.playerTeleports;
        let idx = 1;
        let stalls = 0;
        let watchT = s.time;
        let watchPos = s.position;
        let nudgeUntil = 0;
        let strafeUntil = 0;
        let strafeDir = 1;
        const waypoint = [0, 0, 0];
        const resetWatch = () => {
            stalls = 0;
            watchT = s.time;
            watchPos = s.position;
        };
        while (idx < path.length) {
            if (this.stopped)
                return s.over ? 'ended' : 'stopped';
            if (s.host.seen.playerTeleports !== tele0)
                return 'teleported';
            let pos = s.position;
            // Skip the walk nodes we are already standing on.
            while (idx < path.length - 1 && g.edgeKind(path[idx - 1], path[idx]) === EdgeKind.Walk) {
                const n = g.pos(path[idx]);
                if (Math.hypot(n[0] - pos[0], n[2] - pos[2]) < 0.3 && Math.abs(n[1] - pos[1]) < 0.8)
                    idx++;
                else
                    break;
            }
            const a = path[idx - 1];
            const b = path[idx];
            const kind = g.edgeKind(a, b);
            if (kind !== EdgeKind.Walk) {
                // Arrive exactly at the take-off node, then jump or drop.
                const takeoff = g.pos(a);
                const dTake = Math.hypot(takeoff[0] - pos[0], takeoff[2] - pos[2]);
                if (dTake > 0.18 && Math.abs(takeoff[1] - pos[1]) < 1.2) {
                    const yaw = this.yawTo(pos, takeoff[0], takeoff[2]);
                    if (!(await this.step(Math.min(1, dTake / 0.4 + 0.25), 0, false, yaw)))
                        return s.over ? 'ended' : 'stopped';
                    if (s.time - watchT > 0.6) {
                        if (Math.hypot(s.position[0] - watchPos[0], s.position[2] - watchPos[2]) < 0.12) {
                            this.recordStuck(s.position, this.blockerAhead(s.position, yaw));
                            g.markBad(a, b);
                            return 'stuck';
                        }
                        resetWatch();
                    }
                    continue;
                }
                const res = kind === EdgeKind.Ride ? await this.doRide(a, b) : await this.doLink(a, b, kind);
                if (res !== 'arrived')
                    return res;
                idx++;
                resetWatch();
                continue;
            }
            // Look ahead along walk edges for a smoother line.
            // Doorways are narrow: follow their nodes one by one, slowly, so the capsule does not clip a jamb.
            const strict = this.doorNear(pos, 1.1) !== null || this.doorNear(g.pos(b), 1.1) !== null;
            let t = idx;
            while (!strict && t + 1 < path.length && g.edgeKind(path[t], path[t + 1]) === EdgeKind.Walk) {
                const nxt = g.pos(path[t + 1]);
                if (Math.hypot(nxt[0] - pos[0], nxt[2] - pos[2]) > 0.9 || Math.abs(nxt[1] - pos[1]) > 0.5)
                    break;
                t++;
            }
            g.pos(path[t], waypoint);
            // A door in the next steps: make sure it is open before walking into it.
            const door = this.doorNear(waypoint) ?? this.doorNear(g.pos(b));
            // Press a door's key from just inside its reach, so the leaf can swing without sweeping the player.
            const dOrigin = door ? Math.hypot(door.origin[0] - pos[0], door.origin[2] - pos[2]) : Infinity;
            if (door && !this.doorOpen(door) && door.trigger !== 'state' && dOrigin <= Math.max(0.6, door.radius - (door.trigger === 'key' ? 0.15 : 0.2))) {
                const ok = await this.openDoor(door, this.yawTo(pos, waypoint[0], waypoint[2]));
                if (this.stopped)
                    return s.over ? 'ended' : 'stopped';
                if (!ok) {
                    this.doorFailures.set(door.id, `${door.id} did not open when the player stood at it`);
                    this.recordStuck(pos, door.id);
                    return 'stuck';
                }
                resetWatch();
                pos = s.position;
            }
            const dx = waypoint[0] - pos[0];
            const dz = waypoint[2] - pos[2];
            const dist = Math.hypot(dx, dz);
            if (dist < (strict ? 0.07 : t === path.length - 1 ? 0.12 : 0.3) && Math.abs(waypoint[1] - pos[1]) < 0.8) {
                idx = t + 1;
                resetWatch();
                continue;
            }
            const yaw = this.yawTo(pos, waypoint[0], waypoint[2]);
            const lastLeg = t === path.length - 1;
            // A doorway with a hair of slack is crossed at a crawl; steering at walking speed overshoots a 2 cm window.
            const tight = strict && [...this.doorSlack].some(([id, sl]) => sl < 0.04 && this.doorNear(pos, 1.1)?.id === id);
            const forward = strict ? (tight ? Math.min(0.14, dist / 0.25 + 0.05) : Math.min(0.6, dist / 0.25 + 0.12)) : lastLeg ? Math.min(1, dist / 0.5 + 0.2) : 1;
            const jumpNudge = s.time < nudgeUntil;
            const strafing = s.time < strafeUntil;
            if (!(await this.step(strafing ? Math.min(forward, 0.45) : forward, strafing ? strafeDir * 0.4 : 0, jumpNudge, yaw)))
                return s.over ? 'ended' : 'stopped';
            // Fell off the path?
            const here = s.position;
            if (here[1] < Math.min(g.py[a], g.py[b]) - 2.2) {
                this.fellCount++;
                s.note('fall', 'fell off the path', here);
                return 'fell';
            }
            // Progress watchdog: the player must actually move.
            if (s.time - watchT >= 0.5) {
                const moved = Math.hypot(here[0] - watchPos[0], here[1] - watchPos[1], here[2] - watchPos[2]);
                if (moved < 0.15) {
                    stalls++;
                    // First a hop (steps, thresholds), then a sidestep each way (a snug doorway, a corner).
                    if (stalls === 1)
                        nudgeUntil = s.time + 0.4;
                    else if (stalls <= 3) {
                        strafeDir = stalls === 2 ? -1 : 1;
                        strafeUntil = s.time + 0.45;
                    }
                    else {
                        this.recordStuck(here, this.blockerAhead(here, yaw));
                        g.markBad(a, b);
                        return 'stuck';
                    }
                }
                else
                    stalls = 0;
                watchT = s.time;
                watchPos = here;
            }
        }
        return 'arrived';
    }
    blockerAhead(pos, yawDeg) {
        const yaw = (yawDeg * Math.PI) / 180;
        const dir = [-Math.sin(yaw), 0, -Math.cos(yaw)];
        for (const h of [0.5, 1.2]) {
            const hit = this.session.pw.raycast([pos[0] + dir[0] * 0.45, pos[1] + h, pos[2] + dir[2] * 0.45], dir, 1.0);
            if (hit?.id)
                return hit.id;
        }
        return null;
    }
    /** What the capsule overlaps at a stuck spot: furniture first, then doors, then other solids (never the floor, walls or itself). */
    culpritAt(p) {
        const ids = new Set();
        for (const dy of [0.2, 0.6, 1.0, 1.4])
            for (const id of this.session.pw.overlapsSphere([p[0], p[1] + dy, p[2]], 0.45))
                ids.add(id);
        let door = null;
        let other = null;
        for (const id of ids) {
            if (id === 'player')
                continue;
            const e = this.world.entities[id];
            const role = e?.arch?.role;
            if (role === 'furniture' || role === 'fixture')
                return id;
            if (this.goals.doors.some((d) => d.id === id))
                door = door ?? id;
            else if (role !== 'room' && role !== 'wall' && role !== 'level' && role !== 'site' && role !== 'ceiling' && role !== 'roof' && role !== 'building')
                other = other ?? id;
        }
        return door ?? other;
    }
    recordStuck(p, blocker) {
        const here = this.culpritAt(p);
        // What is physically touching the player says more than a ray ahead.
        if (here !== null && (blocker === null || this.world.entities[here]?.arch?.role === 'furniture'))
            blocker = here;
        if (!blocker) {
            // Stuck right at a doorway: the door (or its frame) is the culprit.
            for (const d of this.goals.doors) {
                if (Math.hypot(d.origin[0] - p[0], d.origin[2] - p[2]) < 1.3 && Math.abs(d.origin[1] - p[1]) < 1.5) {
                    blocker = d.id;
                    break;
                }
            }
        }
        if (this.stuckPoints.length < 12)
            this.stuckPoints.push([r2(p[0]), r2(p[1]), r2(p[2])]);
        if (blocker)
            this.stuckBlockers.set(blocker, (this.stuckBlockers.get(blocker) ?? 0) + 1);
        this.session.note('stuck', blocker ? `blocked by ${blocker}` : 'stuck', [p[0], p[1], p[2]]);
    }
    /**
     * Vertical lifts (a kinematic platform that patrols straight up and down) become one-way ride edges
     * from a node beside the platform at its lowest pose to a node level with it at its highest.
     */
    registerLifts() {
        const g = this.graph;
        for (const id in this.world.entities) {
            const e = this.world.entities[id];
            if (e.template || e.physics?.body !== 'kinematic')
                continue;
            const patrol = e.behaviors.find((b) => b.type === 'patrol' && b.enabled);
            const wps = patrol?.params['waypoints'];
            if (!Array.isArray(wps) || wps.length < 2 || wps.length > 16)
                continue;
            const pts = [];
            for (const w of wps) {
                if (!Array.isArray(w) || w.length !== 3 || !w.every((n) => typeof n === 'number' && Number.isFinite(n)))
                    break;
                pts.push([w[0], w[1], w[2]]);
            }
            if (pts.length !== wps.length)
                continue;
            const first = pts[0];
            const relative = patrol?.params['relative'] === true;
            const offs = pts.map((p) => [p[0] - (relative ? 0 : first[0]), p[1] - (relative ? 0 : first[1]), p[2] - (relative ? 0 : first[2])]);
            const lateral = Math.max(...offs.map((o) => Math.hypot(o[0] - offs[0][0], o[2] - offs[0][2])));
            const rise = Math.max(...offs.map((o) => o[1] - offs[0][1]));
            if (lateral > 0.3 || rise < 1)
                continue;
            const bounds = entityBounds(this.world, id);
            const st = this.session.pw.getState(id);
            if (!bounds || !st)
                continue;
            const cx = (bounds.min[0] + bounds.max[0]) / 2;
            const cz = (bounds.min[2] + bounds.max[2]) / 2;
            const topY = bounds.max[1];
            const dist = (x, z, b) => {
                const dx = Math.max(b.min[0] - x, 0, x - b.max[0]);
                const dz = Math.max(b.min[2] - z, 0, z - b.max[2]);
                return Math.hypot(dx, dz);
            };
            let from = -1, to = -1, bestFrom = Infinity, bestTo = Infinity;
            for (let n = 0; n < g.count; n++) {
                const x = g.px[n], y = g.py[n], z = g.pz[n];
                const d = dist(x, z, bounds);
                if (Math.abs(y - topY) < 0.6 && d >= 0.2 && d <= 2.8 && d < bestFrom) {
                    bestFrom = d;
                    from = n;
                }
                // Landings beside the platform at its highest pose.
                if (Math.abs(y - (topY + rise)) < 0.6 && d >= 0.2 && d <= 3.2) {
                    const dd = Math.hypot(x - cx, z - cz);
                    if (dd < bestTo) {
                        bestTo = dd;
                        to = n;
                    }
                }
            }
            if (from < 0 || to < 0 || from === to)
                continue;
            const info = { entity: id, centre: [cx, cz], startY: st.position[1], dyUp: rise };
            g.addRide(from, to, info);
            this.lifts.set(id, info);
        }
    }
    /** Board a lift when it is down, ride it up and step off at the landing. */
    async doRide(a, b) {
        const g = this.graph;
        const s = this.session;
        const info = g.linkOf(a, b)?.ride;
        if (!info)
            return 'stuck';
        const liftY = () => s.pw.getState(info.entity)?.position[1] ?? info.startY;
        const target = g.pos(b);
        // Wait at the edge until the platform is down.
        for (let i = 0; i < 60 * 40 && liftY() - info.startY > 0.1; i++)
            if (!(await this.step(0, 0, false, s.yawDeg)))
                return s.over ? 'ended' : 'stopped';
        // Step onto its middle.
        const t0 = s.time;
        while (s.time - t0 < 5) {
            const pos = s.position;
            const d = Math.hypot(info.centre[0] - pos[0], info.centre[1] - pos[2]);
            if (d < 0.3)
                break;
            if (!(await this.step(Math.min(1, d / 0.6 + 0.2), 0, false, this.yawTo(pos, info.centre[0], info.centre[1]))))
                return s.over ? 'ended' : 'stopped';
        }
        // Ride up.
        const r0 = s.time;
        while (s.time - r0 < 60 && s.position[1] < target[1] - 0.35) {
            if (!(await this.step(0, 0, false, s.yawDeg)))
                return s.over ? 'ended' : 'stopped';
        }
        // Step off towards the landing.
        const w0 = s.time;
        while (s.time - w0 < 4) {
            const pos = s.position;
            const d = Math.hypot(target[0] - pos[0], target[2] - pos[2]);
            if (d < 0.3 && Math.abs(target[1] - pos[1]) < 0.7 && s.character.grounded)
                return 'arrived';
            if (!(await this.step(d < 0.08 ? 0 : Math.min(1, d / 0.5 + 0.3), 0, false, this.yawTo(pos, target[0], target[2]))))
                return s.over ? 'ended' : 'stopped';
        }
        g.markBad(a, b);
        return 'stuck';
    }
    async doLink(a, b, kind) {
        const g = this.graph;
        const s = this.session;
        const target = g.pos(b);
        const t0 = s.time;
        let first = true;
        let airborne = false;
        while (s.time - t0 < (this.params.gravity < 6 ? 10 : 4)) {
            const pos = s.position;
            const dx = target[0] - pos[0];
            const dz = target[2] - pos[2];
            const near = Math.hypot(dx, dz);
            const yaw = this.yawTo(pos, target[0], target[2]);
            const wantJump = kind === EdgeKind.Jump && first;
            first = false;
            if (!(await this.step(near < 0.08 ? 0 : airThrust(near, this.params.speed, this.params.gravity, !s.character.grounded), 0, wantJump, yaw)))
                return s.over ? 'ended' : 'stopped';
            const q = s.position;
            if (!s.character.grounded)
                airborne = true;
            if (s.character.grounded && s.character.verticalSpeed <= 0.01 && (airborne || s.time - t0 > 0.25)) {
                if (Math.hypot(target[0] - q[0], target[2] - q[2]) <= Math.max(g.cell * 1.7, 0.4) + 0.1 && Math.abs(target[1] - q[1]) <= 0.6)
                    return 'arrived';
                if (airborne || s.time - t0 > 0.5)
                    break;
            }
            if (q[1] < Math.min(g.py[a], target[1]) - 6 && kind === EdgeKind.Jump) {
                this.fellCount++;
                s.note('fall', 'missed a jump', q);
                g.markBad(a, b);
                return 'fell';
            }
        }
        g.markBad(a, b);
        const here = s.position;
        if (here[1] < Math.min(g.py[a], target[1]) - 1.5) {
            this.fellCount++;
            s.note('fall', 'fell after a jump', here);
            return 'fell';
        }
        this.recordStuck(here, null);
        return 'stuck';
    }
    /** Stand at the objective and, if it did not trigger, jump and sweep around it. */
    async touch(o, needsJump, endNode) {
        const s = this.session;
        // First stand exactly on the node the plan ended at (inside the trigger volume by construction).
        const end = this.graph.pos(endNode);
        for (let i = 0; i < 40 && this.pending.has(o.id); i++) {
            const pos = s.position;
            const d = Math.hypot(end[0] - pos[0], end[2] - pos[2]);
            if (d < 0.06 || Math.abs(end[1] - pos[1]) > 1.2)
                break;
            if (!(await this.step(Math.min(1, d / 0.3 + 0.1), 0, false, this.yawTo(pos, end[0], end[2]))))
                return !this.pending.has(o.id);
        }
        if (o.kind === 'room') {
            // Rooms are entered, not jumped on: wait a moment for the trigger.
            if (this.pending.has(o.id))
                await this.idle(0.15);
            return !this.pending.has(o.id);
        }
        for (let attempt = 0; attempt < 5 && this.pending.has(o.id); attempt++) {
            const t0 = s.time;
            const jumpHere = needsJump || attempt > 0;
            while (s.time - t0 < (jumpHere ? 1.1 : 0.25) && this.pending.has(o.id)) {
                const pos = s.position;
                const dx = o.touch.center[0] - pos[0];
                const dz = o.touch.center[2] - pos[2];
                const near = Math.hypot(dx, dz);
                // Aim a little off-centre on later attempts so a thin trigger is crossed from another side.
                const wobble = attempt * 0.35;
                const yaw = this.yawTo(pos, o.touch.center[0] + Math.cos(attempt * 2.4) * wobble, o.touch.center[2] + Math.sin(attempt * 2.4) * wobble);
                if (!(await this.step(near < 0.12 ? 0 : Math.min(1, near / 0.6 + 0.2), 0, jumpHere && s.character.grounded, yaw)))
                    return !this.pending.has(o.id);
            }
        }
        return !this.pending.has(o.id);
    }
    /**
     * Stand on the spot a rule needs (a pressure plate) and press its key the way a person does; done once
     * the key was pressed with the player standing there and the logic had a moment to react.
     */
    async pressKey(o, endNode) {
        const s = this.session;
        const end = this.graph.pos(endNode);
        for (let i = 0; i < 60; i++) {
            const pos = s.position;
            const d = Math.hypot(end[0] - pos[0], end[2] - pos[2]);
            if (d < 0.06 || Math.abs(end[1] - pos[1]) > 1.2)
                break;
            if (!(await this.step(Math.min(1, d / 0.3 + 0.1), 0, false, this.yawTo(pos, end[0], end[2]))))
                return false;
        }
        // Let the plate register, then press and release a few times (the rule's conditions may take a tick).
        if (!(await this.idle(0.3)))
            return false;
        const key = keyCode(o.pressKey ?? 'e');
        for (let n = 0; n < 4 && !s.over; n++) {
            if (!(await this.step(0, 0, false, s.yawDeg, [key])))
                return false;
            if (!(await this.idle(0.35)))
                return false;
        }
        this.pressed.add(o.id);
        this.scanObjectives();
        return !this.pending.has(o.id);
    }
    /**
     * Talk to a character the way a person does: stand within reach, press E
     * when the hint shows, and pick the options that get what the game needs
     * (a key bought, a door unlocked). Done when the conversation delivered it.
     */
    async converse(o) {
        const t = o.talk;
        if (!t)
            return false;
        const s = this.session;
        const npcs = s.runtime.npcs;
        const fail = (why) => {
            this.talkWhy.set(o.id, why);
            return false;
        };
        // Face the character and wait for the "press E" hint (it appears only when it is willing to talk).
        for (let i = 0; i < 90 && !npcs.dialogue; i++) {
            this.refreshTalk(o);
            const pos = s.position;
            const info = npcs.info(t.npc);
            if (!info)
                return fail('the character is gone');
            const d = Math.hypot(info.x - pos[0], info.z - pos[2]);
            const yaw = this.yawTo(pos, info.x, info.z);
            const press = npcs.prompt?.npc === t.npc && i % 6 === 0;
            if (!(await this.step(d > t.range * 0.6 ? 0.5 : 0, 0, false, yaw, press ? ['KeyE'] : undefined)))
                return this.talkDone.has(o.id);
        }
        if (!npcs.dialogue || npcs.dialogue.npc !== t.npc)
            return fail(`${t.name} would not talk`);
        let stepNo = 0;
        for (let guard = 0; guard < 40 && npcs.dialogue; guard++) {
            const view = npcs.dialogue;
            let key;
            if (view.choices.length === 0) {
                key = 'KeyE';
            }
            else {
                const want = t.steps[stepNo];
                const idx = want === undefined ? -1 : view.choices.indexOf(want);
                if (idx < 0) {
                    // The planned option is not on offer (a condition changed): leave rather than guess.
                    npcs.endDialogue();
                    return fail(`${t.name} did not offer "${want ?? 'the right option'}"`);
                }
                key = `Digit${idx + 1}`;
                stepNo++;
            }
            if (!(await this.step(0, 0, false, s.yawDeg, [key])))
                break;
            if (!(await this.idle(0.1)))
                break;
        }
        if (npcs.dialogue)
            npcs.endDialogue();
        const got = t.writes.every((k) => truthy(s.runtime.readState(k)));
        if (!got && !(t.wins && s.host.seen.outcome === 'win'))
            return fail(`the conversation with ${t.name} did not give what the game needs (${t.writes.join(', ') || 'a win'})`);
        this.talkDone.add(o.id);
        this.scanObjectives();
        return !this.pending.has(o.id);
    }
    // -------------------------------------------------------------------
    // The play loop
    // -------------------------------------------------------------------
    markFailed(o, reason) {
        this.failedReason.set(o.id, reason);
    }
    async play() {
        if (this.startNode < 0)
            return;
        const s = this.session;
        this.phase = 'play';
        let stalls = 0;
        while (!this.stopped && this.pending.size > 0) {
            const here = s.position;
            // The surface the feet are on first (same height), then anything near.
            let from = this.graph.nearest(here, 1.2, 0.45);
            if (from < 0)
                from = this.graph.nearest(here, 2.5, 0.8);
            if (from < 0)
                from = this.graph.nearest(here, 1.5, 2.5);
            if (from < 0)
                from = this.graph.nearest(here, 4, 8);
            if (from < 0) {
                this.findings.push({ code: 'stuck', severity: 'error', message: `the player ended up at ${fmtPos(here)} where the bot found no way to continue`, entities: [], position: [here[0], here[1], here[2]], hint: 'check the floor around this spot' });
                break;
            }
            const plan = this.plan(from);
            if (!plan) {
                // Nothing reachable right now. A door that opens by proximity may only reveal itself on approach; give a state change one idle second.
                if (stalls++ < 1 && this.goals.doors.some((d) => d.trigger === 'state')) {
                    if (!(await this.idle(1)))
                        break;
                    continue;
                }
                break;
            }
            const o = plan.objective;
            this.note = `walking to ${o.label} (${this.doneCount + 1}/${this.totalObjectives})`;
            this.emit();
            const res = await this.travel(plan.path);
            if (res === 'ended' || res === 'stopped')
                break;
            if (res === 'arrived') {
                const ok = o.kind === 'talk' ? await this.converse(o) : o.kind === 'press' ? await this.pressKey(o, plan.path[plan.path.length - 1]) : await this.touch(o, plan.jumpAt, plan.path[plan.path.length - 1]);
                if (!ok && !this.stopped) {
                    this.markFailed(o, 'the player reached it but it did not trigger');
                    const r = this.results.get(o.id);
                    if (r)
                        r.status = 'untouched';
                }
                stalls = 0;
                continue;
            }
            // fell / stuck / teleported: replan, up to a cap per objective.
            const n = (this.replans.get(o.id) ?? 0) + 1;
            this.replans.set(o.id, n);
            if (res === 'fell') {
                // Wait to land.
                await this.idle(0.3);
            }
            if (n > PLAYTEST_LIMITS.MAX_REPLANS) {
                this.markFailed(o, 'the player kept getting stuck on the way');
                const r = this.results.get(o.id);
                if (r)
                    r.status = 'untouched';
            }
        }
        // Survive-style wins: nothing left to do, the game ends by itself.
        if (!this.stopped && this.goals.timerSeconds > 0 && !s.over) {
            this.note = 'waiting for the timer';
            const until = Math.min(this.maxSim, this.goals.timerSeconds + 3);
            while (!this.stopped && s.time < until)
                if (!(await this.idle(0.5)))
                    break;
        }
        // A game that only needs time to pass (a countdown to a win) is also given a chance.
        if (!this.stopped && this.pending.size === 0 && !s.over && this.goals.winDefined) {
            this.note = 'waiting for the game to end';
            await this.idle(2);
        }
    }
    // -------------------------------------------------------------------
    // Analysis and report
    // -------------------------------------------------------------------
    nearestReachable(p) {
        const d = this.reachableFromStart;
        if (!d)
            return null;
        const g = this.graph;
        let best = -1;
        let bestScore = Infinity;
        let bh = 0;
        let bv = 0;
        for (let i = 0; i < g.count; i++) {
            if (!Number.isFinite(d[i]))
                continue;
            const h = Math.hypot(g.px[i] - p[0], g.pz[i] - p[2]);
            const v = p[1] - g.py[i];
            const score = h + Math.abs(v - 0.5) * 0.9;
            if (score < bestScore) {
                bestScore = score;
                best = i;
                bh = h;
                bv = v;
            }
        }
        return best < 0 ? null : { node: best, h: bh, v: bv };
    }
    async finish() {
        const s = this.session;
        this.phase = 'analyse';
        this.note = 'analysing the run';
        this.emit(true);
        const outcome = s.host.seen.outcome;
        const jumpH = jumpHeight(this.params);
        // Objectives that were not completed: why.
        const unresolved = [...this.pending.values()];
        if (this.startNode >= 0)
            this.graph.clearBad();
        for (const o of unresolved) {
            const r = this.results.get(o.id);
            if (!r)
                continue;
            if (o.kind === 'talk' && o.talk && this.stopReason === null && !(s.over && outcome === 'win')) {
                const ready = this.talkReady(o);
                const why = this.talkWhy.get(o.id) ?? (ready ? null : `the options it needs never became available (${o.talk.needs.map((c) => `${c.key} ${c.op} ${c.value}`).join(', ')})`);
                if (why) {
                    r.status = 'untouched';
                    r.reason = why;
                    this.findings.push({
                        code: 'talk_failed',
                        severity: 'error',
                        message: `${o.talk.name} cannot give the game what it needs: ${why}`,
                        entities: [o.talk.npc],
                        position: o.position,
                        hint: ready ? `check ${o.talk.name}'s dialogue and where they stand` : `make the options in ${o.talk.name}'s dialogue reachable (enough pickups to pay with)`,
                        data: { npc: o.talk.npc },
                    });
                    continue;
                }
            }
            if (r.status === 'untouched') {
                r.reason = this.failedReason.get(o.id) ?? 'it did not trigger';
                continue;
            }
            if (this.stopReason !== null) {
                r.status = 'pending';
                r.reason = this.stopReason === 'budget' ? 'the check ran out of time' : 'the game ran too long';
                continue;
            }
            if (s.over && outcome === 'win') {
                // The game was won before this (optional) objective: not a defect.
                r.status = 'pending';
                r.reason = 'the game was won first';
                continue;
            }
            const targets = this.targetsFor(o);
            const reach = this.reachableFromStart;
            const ideal = reach !== null && targets.some((t) => Number.isFinite(reach[t.node]));
            if (ideal) {
                // Reachable when every door is open: something in the way did not open.
                r.status = 'blocked';
                const blockedBy = this.blockingDoors(o);
                r.reason = blockedBy.length > 0 ? `${blockedBy.map((d) => d.id).join(', ')} stayed shut` : 'a path exists but the bot could not follow it';
                const door = blockedBy[0];
                // A door is only blamed when it is locked by state, or the player really tried it and it did not open.
                if (door && (door.trigger === 'state' || this.doorFailures.has(door.id) || this.narrowDoors.has(door.id))) {
                    this.pushDoorFinding(door, o);
                }
                else if (!outcome) {
                    this.findings.push({ code: 'stuck', severity: o.required ? 'error' : 'warning', message: `the bot could not find a walkable route to ${o.label} at ${fmtPos(o.position)}${door ? ` (the way passes ${door.id})` : ''}`, entities: o.entity ? [o.entity] : [], position: o.position, hint: 'check the route for thin gaps or steep steps' });
                }
            }
            else {
                r.status = 'unreachable';
                if (this.kind === 'walkthrough') {
                    const near = this.nearestReachable(o.position);
                    r.reason = 'no walkable way in from the entrance';
                    this.findings.push({ code: 'room_unreachable', severity: 'error', message: `${o.label} cannot be reached on foot from the entrance`, entities: o.entity ? [o.entity] : [], position: o.position, hint: 'add a door, or clear the doorway and the walkway in front of it', ...(near ? { data: { nearX: this.graph.px[near.node], nearZ: this.graph.pz[near.node], gap: near.h } } : {}) });
                    continue;
                }
                // Lifts and moving platforms are planned on their starting pose only: a gap they may bridge is not a verdict.
                const maybeLift = this.goals.movers.length > 0;
                const near = this.nearestReachable(o.position);
                const gapH = near ? r1(near.h) : 0;
                const gapV = near ? r1(near.v) : 0;
                const tooHigh = gapV > jumpH * 0.9;
                const why = near
                    ? `${gapH} m from the nearest place the player can stand${tooHigh ? ` and ${r1(gapV)} m too high` : gapV < -2 ? ` and ${r1(-gapV)} m below it` : ''}`
                    : 'there is no floor near it';
                r.reason = why;
                this.findings.push({
                    code: 'unreachable_objective',
                    severity: o.required && !maybeLift ? 'error' : 'warning',
                    message: `${maybeLift ? 'could not check: ' : ''}${o.kind === 'collect' ? 'the pickup' : o.label} ${o.kind === 'collect' ? `${o.label} ` : ''}at ${fmtPos(o.position)} cannot be reached: ${why}`.replace(/\s+/g, ' '),
                    entities: o.entity ? [o.entity] : [],
                    position: o.position,
                    hint: near ? `bring it within reach: nearest standable spot is ${fmtPos(g3(this.graph, near.node))}` : 'give it some floor',
                    data: near ? { gapH: near.h, gapV: near.v, nodeX: this.graph.px[near.node], nodeY: this.graph.py[near.node], nodeZ: this.graph.pz[near.node], required: o.required } : { required: o.required },
                });
            }
        }
        // Doors the player's body cannot pass: always a defect in a building, and in a game when something stayed out of reach.
        if (this.kind === 'walkthrough' || this.pending.size > 0) {
            for (const [id, n] of this.narrowDoors) {
                if (this.kind === 'game' && !unresolved.some((o) => this.blockingDoors(o).some((d) => d.id === id)))
                    continue;
                const door = this.goals.doors.find((d) => d.id === id);
                const mattered = unresolved.length > 0 && unresolved.some((o) => this.blockingDoors(o).some((d) => d.id === id) || this.kind === 'walkthrough');
                this.findings.push({
                    code: 'door_blocked',
                    severity: mattered ? 'error' : 'warning',
                    message: `the door ${id} is ${mattered ? 'too narrow for the player' : 'a tight squeeze for the player'}: about ${n.clear} m of room, the player needs ${n.need} m`,
                    entities: [id],
                    ...(door ? { position: door.center } : {}),
                    hint: `make ${id} at least 0.9 m wide`,
                    data: { door: id, clear: n.clear, need: n.need },
                });
            }
        }
        // Stuck blockers that are doors or other things.
        for (const [id, n] of this.stuckBlockers) {
            const door = this.goals.doors.find((d) => d.id === id);
            if (door) {
                // A door the player struggled with only matters when something stayed unreachable.
                if (n >= 3 && this.pending.size > 0)
                    this.pushDoorFinding(door, null);
            }
            else if (n >= 2 && !this.findings.some((f) => f.code === 'stuck' && f.entities.includes(id))) {
                const furniture = this.world.entities[id]?.arch?.role === 'furniture';
                this.findings.push({ code: furniture ? 'clipping' : 'stuck', severity: this.pending.size > 0 ? 'error' : 'warning', message: furniture ? `${this.world.entities[id]?.name || id} (${id}) leaves too little room to walk past it` : `the player got stuck on ${id}`, entities: [id], hint: furniture ? `move ${id} away from the walkway` : `check the collider of ${id}` });
            }
        }
        if (s.falls + this.fellCount > 0) {
            this.findings.push({ code: 'fell', severity: 'info', message: `the bot fell ${s.falls + this.fellCount} time${s.falls + this.fellCount === 1 ? '' : 's'} on its way`, entities: [], hint: 'none' });
        }
        // The ending of the run.
        const required = [...this.results.values()].filter((r) => r.required);
        const requiredDone = required.every((r) => r.status === 'done');
        if (this.kind === 'walkthrough') {
            this.documentChecks();
        }
        else if (outcome === 'lose') {
            this.findings.push({ code: 'lost', severity: 'error', message: `the game was lost: "${s.host.seen.endText || 'game over'}"`, entities: [], hint: s.host.seen.endText || 'check what ends the game', data: { text: s.host.seen.endText, seconds: s.time } });
        }
        else if (outcome === null && this.stopReason === null && this.startNode >= 0) {
            if (!this.goals.winDefined && this.goals.objectives.length > 0) {
                this.findings.push({ code: 'no_win_condition', severity: 'error', message: requiredDone ? 'every pickup can be collected, but nothing ever ends the game' : 'nothing in this world ends the game', entities: [], hint: 'add a win rule', data: { done: requiredDone } });
            }
            else if (requiredDone && this.goals.winDefined) {
                const thr = this.thresholdFinding();
                this.findings.push(thr ?? { code: 'unwinnable', severity: 'error', message: 'everything was done but the win never triggered', entities: [], hint: 'check the winning rule conditions' });
            }
            else if (!requiredDone && !this.findings.some((f) => f.severity === 'error')) {
                this.findings.push({ code: 'unwinnable', severity: 'error', message: 'the bot ran out of things it could do without winning', entities: [], hint: 'check what is needed to win' });
            }
        }
        if (this.stopReason !== null && outcome === null && this.pending.size > 0) {
            this.findings.push({ code: 'budget', severity: 'warning', message: this.stopReason === 'budget' ? 'the check ran out of time before the game was decided' : 'the game ran for too long without finishing', entities: [], hint: 'make the course shorter or the goal closer' });
        }
        if (this.kind === 'game' && this.startNode >= 0 && this.goals.winDefined && this.reachableFromStart) {
            await this.softLocks();
        }
        return this.buildReport();
    }
    /** Furniture in the way of doors, overlapping and floating pieces, from the building checks. */
    documentChecks() {
        let reports;
        try {
            reports = checkBuildings(this.world);
        }
        catch {
            return;
        }
        for (const rep of reports) {
            for (const issue of rep.issues) {
                if (issue.code === 'unreachable_room' || issue.code === 'no_entrance')
                    continue;
                const code = issue.code === 'door_blocked' ? 'door_blocked' : 'clipping';
                this.findings.push({ code, severity: issue.code === 'door_blocked' ? 'error' : 'warning', message: issue.message, entities: issue.entities, hint: issue.hint });
            }
        }
    }
    blockingDoors(o) {
        const g = this.graph;
        const targets = new Set(this.targetsFor(o).map((t) => t.node));
        g.blocked.fill(0);
        const start = g.nearest(this.session.position, 3, 6);
        if (start < 0)
            return [];
        const res = g.search(start, (n) => targets.has(n));
        if (res.hit < 0)
            return [];
        const path = g.pathTo(res.parent, res.hit);
        const out = [];
        const p = [0, 0, 0];
        for (const n of path) {
            g.pos(n, p);
            const d = this.doorNear(p, 0.5);
            if (d && !out.includes(d) && !this.doorPassable(d))
                out.push(d);
        }
        if (out.length === 0) {
            for (const n of path) {
                g.pos(n, p);
                const d = this.doorNear(p, 0.5);
                if (d && !out.includes(d) && !this.doorOpen(d))
                    out.push(d);
            }
        }
        return out;
    }
    pushDoorFinding(d, o) {
        if (this.doorOpen(d) && d.trigger !== 'state') {
            if (this.narrowDoors.has(d.id) || this.findings.some((f) => f.code === 'door_blocked' && f.entities.includes(d.id)))
                return;
            const width = d.bounds ? Math.min(d.bounds.max[0] - d.bounds.min[0], d.bounds.max[2] - d.bounds.min[2]) : 0;
            const wide = d.bounds ? Math.max(d.bounds.max[0] - d.bounds.min[0], d.bounds.max[2] - d.bounds.min[2]) : 0;
            this.findings.push({
                code: 'door_blocked',
                severity: 'error',
                message: `the player cannot squeeze through the door ${d.id}: even open it leaves too little room for the player's body (about 0.7 m wide)${wide > 0 ? `, the leaf is ${r2(Math.max(width, wide))} m` : ''}${o ? ` (it leads to ${o.label})` : ''}`,
                entities: [d.id],
                position: d.center,
                hint: `make ${d.id} wider (0.9 m or more) or clear the frame around it`,
                data: { door: d.id },
            });
            return;
        }
        const code = this.findings.some((f) => (f.code === 'door_locked' || f.code === 'door_stuck') && f.entities.includes(d.id));
        if (code)
            return;
        if (d.trigger === 'state') {
            const producers = d.stateKey ? this.producersOf(d.stateKey) : 0;
            const hasKey = d.stateKey !== '';
            this.findings.push({
                code: 'door_locked',
                severity: 'error',
                message: !hasKey
                    ? `the door ${d.id} is set to open from a state key but none is named, so it never opens${o ? ` (it blocks ${o.label})` : ''}`
                    : producers === 0
                        ? `the door ${d.id} opens when "${d.stateKey}" is set, but nothing in the game ever sets it${o ? ` (it blocks ${o.label})` : ''}`
                        : `the door ${d.id} stayed locked: "${d.stateKey}" was never set${o ? ` (it blocks ${o.label})` : ''}`,
                entities: [d.id],
                position: d.center,
                hint: producers === 0 ? `make ${d.id} open by proximity, or add a pickup or rule that sets "${d.stateKey}"` : `make sure the pickup that sets "${d.stateKey}" can be reached`,
                data: { door: d.id, stateKey: d.stateKey, producers },
            });
        }
        else {
            this.findings.push({
                code: 'door_stuck',
                severity: 'error',
                message: `the door ${d.id} did not open when the player walked up to it${d.trigger === 'key' ? ` and pressed "${d.key}"` : ''}`,
                entities: [d.id],
                position: d.center,
                hint: d.trigger === 'key' ? `check the key and radius of ${d.id}` : `check the radius of ${d.id}`,
                data: { door: d.id, trigger: d.trigger, radius: d.radius },
            });
        }
    }
    /** Count of things that can raise a state key: pickups and rules. */
    producersOf(key) {
        const base = key.split('.')[0];
        let n = 0;
        for (const o of this.goals.objectives)
            if (o.key === base && o.kind !== 'goal')
                n++;
        for (const r of this.world.rules)
            if (r.enabled && r.then.some((a) => (a.do === 'set' || a.do === 'add') && a.key.split('.')[0] === base))
                n++;
        for (const id in this.world.entities) {
            const e = this.world.entities[id];
            if (e.behaviors.some((b) => b.enabled && b.type === 'pressurePlate' && b.params['stateKey'] === key))
                n++;
            if (this.goals.objectives.some((o) => o.kind === 'talk' && o.entity === id && o.talk?.writes.some((k) => k === base)))
                n++;
        }
        return n;
    }
    /** "The win needs score ≥ 10 but only 8 can be collected." */
    thresholdFinding() {
        for (const t of winThresholds(this.world)) {
            const available = (this.goals.producible.get(t.key) ?? 0) + (typeof this.world.state[t.key] === 'number' ? this.world.state[t.key] : 0);
            const needsMore = (t.op === '>=' || t.op === '==') && available < t.value;
            const needsMoreStrict = t.op === '>' && available <= t.value;
            if (needsMore || needsMoreStrict) {
                return {
                    code: 'unwinnable',
                    severity: 'error',
                    message: `winning needs ${t.key} ${t.op} ${t.value}, but only ${available} can ever be collected`,
                    entities: [],
                    hint: `lower the target to ${available} or add more pickups`,
                    data: { ruleId: t.ruleId, key: t.key, op: t.op, needed: t.value, available },
                };
            }
        }
        return null;
    }
    /** Places the player can fall into and never leave. */
    async softLocks() {
        const g = this.graph;
        const reach = this.reachableFromStart;
        if (g.count > 90_000)
            return;
        g.blocked.fill(0);
        // Forward edges over the reachable set, then reverse reachability of the winning spots.
        const winTargets = new Set();
        for (const o of this.goals.objectives)
            if (o.required && (this.isWinObjective(o) || o.kind === 'collect'))
                for (const t of this.targetsFor(o))
                    if (Number.isFinite(reach[t.node]))
                        winTargets.add(t.node);
        if (winTargets.size === 0)
            return;
        const n = g.count;
        const deg = new Int32Array(n + 1);
        const from = [];
        const to = [];
        let work = 0;
        for (let u = 0; u < n; u++) {
            if (!Number.isFinite(reach[u]))
                continue;
            g.forEachEdge(u, (v) => {
                from.push(u);
                to.push(v);
                deg[v + 1] = deg[v + 1] + 1;
            });
            if (++work % 3000 === 0)
                await this.checkpoint();
            if (this.stopReason === 'budget')
                return;
        }
        for (let i = 0; i < n; i++)
            deg[i + 1] = deg[i + 1] + deg[i];
        const rev = new Int32Array(from.length);
        const fill = deg.slice(0, n);
        for (let e = 0; e < from.length; e++) {
            const v = to[e];
            rev[fill[v]] = from[e];
            fill[v] = fill[v] + 1;
        }
        const can = new Uint8Array(n);
        const queue = [];
        for (const t of winTargets) {
            can[t] = 1;
            queue.push(t);
        }
        for (let qi = 0; qi < queue.length; qi++) {
            const v = queue[qi];
            for (let k = deg[v]; k < deg[v + 1]; k++) {
                const u = rev[k];
                if (!can[u]) {
                    can[u] = 1;
                    queue.push(u);
                }
            }
        }
        // Trapped = reachable but cannot reach a winning spot. Cluster them.
        const seen = new Uint8Array(n);
        const clusters = [];
        const edge = g.cell * 4;
        const x1 = g.x0 + g.nx * g.cell;
        const z1 = g.z0 + g.nz * g.cell;
        for (let u = 0; u < n; u++) {
            if (!Number.isFinite(reach[u]) || can[u] || seen[u])
                continue;
            const stack = [u];
            seen[u] = 1;
            const c = { size: 0, sum: [0, 0, 0], minY: Infinity, edge: false };
            while (stack.length > 0) {
                const x = stack.pop();
                c.size++;
                c.sum[0] += g.px[x];
                c.sum[1] += g.py[x];
                c.sum[2] += g.pz[x];
                c.minY = Math.min(c.minY, g.py[x]);
                // A pocket against the edge of the mapped area may continue outside it: no verdict there.
                const gx = g.px[x];
                const gz = g.pz[x];
                if (gx < g.x0 + edge || gx > x1 - edge || gz < g.z0 + edge || gz > z1 - edge)
                    c.edge = true;
                g.forEachEdge(x, (v) => {
                    if (!can[v] && !seen[v] && Number.isFinite(reach[v])) {
                        seen[v] = 1;
                        stack.push(v);
                    }
                });
            }
            clusters.push(c);
        }
        clusters.sort((a, b) => b.size - a.size);
        // Ignore specks (a few nodes) and report the biggest few.
        const minSize = Math.max(6, Math.round(1.2 / (g.cell * g.cell)));
        for (const c of clusters.slice(0, 3)) {
            if (c.size < minSize || c.edge)
                continue;
            const centre = [c.sum[0] / c.size, c.sum[1] / c.size, c.sum[2] / c.size];
            this.findings.push({
                code: 'soft_lock',
                severity: 'warning',
                message: `a player can drop into the area around ${fmtPos(centre)} (height ${r1(centre[1])}) and never get out again`,
                entities: [],
                position: centre,
                hint: 'add a way back up (a ramp or steps) or a respawn',
                data: { x: centre[0], y: centre[1], z: centre[2], cells: c.size },
            });
        }
    }
    buildReport() {
        const s = this.session;
        const outcome = s.host.seen.outcome;
        const trace = this.opts.trace === false ? undefined : s.finishTrace();
        if (outcome)
            s.note(outcome === 'win' ? 'win' : 'lose', s.host.seen.endText || outcome);
        const objectives = [...this.results.values()];
        const errors = this.findings.filter((f) => f.severity === 'error');
        let status;
        const everyRoom = this.kind === 'walkthrough' && objectives.length > 0 && objectives.every((o) => o.status === 'done');
        if (this.startNode < 0 && this.findings.some((f) => f.code === 'spawn_blocked'))
            status = 'failed';
        else if (this.kind === 'walkthrough')
            status = errors.length > 0 ? 'failed' : everyRoom ? 'passed' : 'inconclusive';
        else if (outcome === 'win')
            status = errors.length === 0 ? 'passed' : 'failed';
        else if (errors.length > 0)
            status = 'failed';
        else
            status = 'inconclusive';
        // A win with unreachable *required* objectives cannot happen; with optional ones it is still a pass.
        const won = this.kind === 'walkthrough' ? status === 'passed' : outcome === 'win';
        const doneOpt = objectives.filter((o) => o.status === 'done').length;
        const seconds = r1(s.time);
        const findings = this.findings.slice(0, PLAYTEST_LIMITS.MAX_FINDINGS);
        let summary;
        if (status === 'passed' && this.kind === 'walkthrough') {
            const doors = this.goals.doors.filter((d) => this.doorWas.get(d.id) === true).length;
            summary = `Verified walkable: the bot reached all ${objectives.length} room${objectives.length === 1 ? '' : 's'} in ${seconds} s${doors > 0 ? `, opening ${doors} door${doors === 1 ? '' : 's'}` : ''}, with nothing in the way.`;
        }
        else if (status === 'passed') {
            const pick = objectives.filter((o) => o.kind === 'collect');
            const got = pick.filter((o) => o.status === 'done').length;
            const talks = objectives.filter((o) => o.kind === 'talk' && o.status === 'done');
            const extra = (pick.length > 0 ? `, collecting ${got} of ${pick.length} pickup${pick.length === 1 ? '' : 's'}` : '') + (talks.length > 0 ? `${pick.length > 0 ? ' and' : ','} talking to ${talks.map((o) => o.label.replace(/^talk to /, '')).slice(0, 3).join(' and ')}` : '');
            summary = `Verified playable: the bot won in ${seconds} s${extra}${s.falls + this.fellCount > 0 ? ` (it fell ${s.falls + this.fellCount}x on the way)` : ''}.`;
        }
        else if (status === 'failed') {
            const first = errors[0];
            summary = `Could not verify: ${first ? first.message : this.kind === 'walkthrough' ? 'a room could not be reached' : 'the game could not be won'}.`;
        }
        else {
            const note = findings.find((f) => f.severity === 'warning');
            summary = `Not verified yet${note ? `: ${note.message}` : ` (${doneOpt} of ${objectives.length} objectives done in ${seconds} s)`}.`;
        }
        this.phase = 'done';
        this.note = summary;
        this.emit(true);
        const path = downsample(s.sampledPath(), PLAYTEST_LIMITS.MAX_PATH_POINTS);
        return {
            v: 1,
            kind: this.kind,
            status,
            won,
            outcome,
            seconds: r2(s.time),
            steps: s.steps,
            wallMs: Math.round(nowMs() - this.t0),
            objectives,
            findings,
            falls: s.falls + this.fellCount,
            stuckPoints: this.stuckPoints,
            path,
            ...(trace ? { trace } : {}),
            summary,
            worldHash: hashWorld(this.world),
            ...(s.host.seen.endText ? { endText: s.host.seen.endText } : {}),
            stats: { searches: this.graph ? this.graph.searches : 0, expanded: this.graph ? this.graph.expandedTotal : 0, navNodes: this.graph ? this.graph.count : 0, navCell: this.graph ? this.graph.cell : 0, navMs: this.navMs, planMs: Math.round(this.planMs) },
        };
    }
    /**
     * Build the walking map of the world and answer reach questions about it without playing: the level
     * tools use this to tell the assistant, while it places things, what the player can get to.
     */
    async openProbe() {
        const none = (problem) => ({ ok: false, problem, objectives: () => [], reachFrom: () => null, spawnOk: false, dispose: () => undefined });
        const verdict = validateWorld(this.world);
        if (!verdict.ok)
            return none('the world document is invalid');
        const why = unsupportedReason(this.world);
        if (why)
            return none(`reach cannot be measured here: ${why}`);
        this.goals = deriveGoals(this.world);
        const session = await Session.create(this.world, { trace: false });
        this.session = session;
        const dispose = () => {
            this.graph?.dispose();
            this.probe?.dispose();
            session.dispose();
        };
        try {
            await this.prepare();
        }
        catch (e) {
            dispose();
            throw e;
        }
        const spawnOk = this.startNode >= 0 && this.findings.every((f) => f.code !== 'spawn_blocked');
        const problem = spawnOk ? '' : (this.findings.find((f) => f.code === 'spawn_blocked')?.message ?? 'the player has nowhere to stand at the spawn point');
        const explain = (pos) => {
            const jumpH = jumpHeight(this.params);
            const reach = this.reachableFromStart;
            if (!spawnOk || !reach)
                return { reachable: false, reason: problem, gapH: 0, gapV: 0, nearest: null };
            const touch = { shape: { kind: 'cylinder', half: [0.5, 0.9, 0.5] }, center: [pos[0], pos[1], pos[2]], rot: [0, 0, 0, 1], margin: 0.3 };
            const targets = this.scanTargets(touch, Math.max(0, jumpH * 0.9));
            if (targets.some((t) => Number.isFinite(reach[t.node])))
                return { reachable: true, reason: '', gapH: 0, gapV: 0, nearest: null };
            const near = this.nearestReachable(pos);
            if (!near)
                return { reachable: false, reason: 'there is no floor near it', gapH: 0, gapV: 0, nearest: null };
            const tooHigh = near.v > jumpH * 0.9;
            const reason = `${r1(near.h)} m from the nearest place the player can stand${tooHigh ? ` and ${r1(near.v)} m too high (a jump reaches ${r1(jumpH * 0.85)} m)` : near.v < -2 ? ` and ${r1(-near.v)} m below it` : ''}`;
            return { reachable: false, reason, gapH: near.h, gapV: near.v, nearest: g3(this.graph, near.node) };
        };
        const objectives = () => this.goals.objectives.map((o) => {
            const e = explain(o.position);
            return { id: o.id, kind: o.kind, label: o.label, position: [o.position[0], o.position[1], o.position[2]], required: o.required, reachable: e.reachable, reason: e.reason, nearest: e.nearest };
        });
        return { ok: spawnOk, problem, objectives, reachFrom: (pos) => explain(pos), spawnOk, dispose };
    }
}
/** Build the walking map of a game for reach questions. The caller disposes it. */
export async function probeLevel(input) {
    return new Bot(input, {}, 'game').openProbe();
}
function g3(g, node) {
    return g.pos(node);
}
/** Keep at most `max` evenly spaced points (the last one always). */
export function downsample(list, max) {
    if (list.length <= max)
        return list.slice();
    const out = [];
    const step = (list.length - 1) / (max - 1);
    for (let i = 0; i < max; i++)
        out.push(list[Math.round(i * step)]);
    return out;
}
