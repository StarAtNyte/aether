import { NpcBrain } from './brain';
import { DialogueSession } from './dialogue';
import { resolveNpc } from './graph';
import { buildNavFor } from './obstacles';
import { hyp } from './math';
/** Speech bubbles shown at once. */
export const MAX_BUBBLES = 6;
/** Most NPC brains one world runs (the rest are inert). */
export const MAX_NPCS = 400;
/** Most grids kept (level × agent size). */
const MAX_GRIDS = 6;
/** Neighbour hash cell (m). */
const HASH_CELL = 3;
/** Separation radius between NPCs (m). */
const SEPARATE = 1.0;
const SKY_HOURS = { day: 12, dawn: 6.5, sunset: 17.5, night: 22, overcast: 12, space: 12, studio: 12 };
const sepOut = [0, 0];
/** Keys that choose dialogue options, in order. */
const CHOICE_KEYS = ['1', '2', '3', '4', '5', '6'];
/** Runtime of all NPCs in one world. */
export class NpcSystem {
    ctx;
    /** Live brains in creation order. */
    brains = [];
    tickNo = 0;
    /** Bumps whenever navigation data became stale (brains rebuild their grid reference). */
    navVersion = 0;
    byId = new Map();
    grids = new Map();
    effCache = new WeakMap();
    nextIndex = 0;
    // --- dialogue ---------------------------------------------------------------------
    session = null;
    sessionBrain = null;
    usedChoices = new Map();
    promptOut = { npc: '', name: '', distance: 0 };
    promptOn = false;
    cooldown = 0;
    // --- bubbles ----------------------------------------------------------------------
    slots = [];
    liveN = 0;
    // --- noise / player tracking --------------------------------------------------------
    px = Number.NaN;
    pz = Number.NaN;
    noise = 0;
    hourTick = -1;
    hourVal = 12;
    // --- neighbour hash ------------------------------------------------------------------
    hash = new Map();
    buckets = [];
    /** World damage taken by the player from NPCs this session (diagnostics). */
    playerDamage = 0;
    constructor(ctx) {
        this.ctx = ctx;
        for (let i = 0; i < MAX_BUBBLES; i++)
            this.slots.push({ npc: '', name: '', text: '', kind: 'bark', until: -1, x: 0, y: 0, z: 0 });
    }
    /** The behaviour environment (the logic engine). */
    get env() {
        return this.ctx.env;
    }
    // ---------------------------------------------------------------------------
    // Brain lifecycle
    // ---------------------------------------------------------------------------
    /** Create the brain of `e` (called by the engine for entities with `npc`). */
    createBrain(e, random) {
        if (this.brains.length >= MAX_NPCS)
            return {};
        const brain = new NpcBrain(e, this, random, this.nextIndex++);
        this.brains.push(brain);
        this.byId.set(e.id, brain);
        if (this.grids.size > 0) {
            // A late arrival may stand outside the area the grids cover.
            const first = this.grids.values().next().value;
            if (first && first.index(e.anchor[0], e.anchor[2]) < 0)
                this.invalidate();
        }
        return brain;
    }
    /** Drop a disposed brain. */
    forget(b) {
        const i = this.brains.indexOf(b);
        if (i >= 0)
            this.brains.splice(i, 1);
        if (this.byId.get(b.id) === b)
            this.byId.delete(b.id);
        if (this.sessionBrain === b)
            this.endDialogue();
    }
    /** Live brain of an entity. */
    brainOf(id) {
        return this.byId.get(id);
    }
    /** Resolve (and cache) the effective parameters of a spec. */
    effective(spec) {
        let eff = this.effCache.get(spec);
        if (!eff) {
            eff = resolveNpc(spec);
            this.effCache.set(spec, eff);
        }
        return eff;
    }
    /** Static geometry changed (hot reload): grids are rebuilt on demand. */
    invalidate() {
        this.grids.clear();
        this.navVersion++;
    }
    /** Clear transient state (a world reset). */
    reset() {
        this.endDialogue();
        this.usedChoices.clear();
        for (const b of this.slots)
            b.until = -1;
        this.liveN = 0;
        this.px = Number.NaN;
        this.cooldown = 0;
        this.promptOn = false;
    }
    // ---------------------------------------------------------------------------
    // Navigation
    // ---------------------------------------------------------------------------
    /** Entity pivots are centred for primitives and at the feet for generated/asset shapes. */
    feetGuess(self, y) {
        if (self.spec.shape.kind === 'primitive')
            return y - self.zone.half[1];
        return y;
    }
    /** The navigation grid for a brain's floor level and body size (built on first use). */
    gridFor(b) {
        const spec = b.spec;
        const level = Math.round(b.feetY / 1.5);
        const rKey = Math.round(spec.radius * 4);
        const key = `${level}|${rKey}|${Math.round(spec.height * 2)}`;
        const have = this.grids.get(key);
        if (have)
            return have;
        if (this.grids.size >= MAX_GRIDS)
            return null;
        const world = this.ctx.world();
        const points = [];
        for (const o of this.brains) {
            if (Math.round(o.feetY / 1.5) !== level)
                continue;
            points.push([o.self.anchor[0], 0, o.self.anchor[2]]);
            for (const w of o.spec.waypoints)
                points.push(w);
        }
        points.push(world.player.spawn);
        if (points.length === 0)
            return null;
        try {
            const grid = buildNavFor(world, { refY: level * 1.5, radius: spec.radius, height: spec.height, points }, this.ctx.bounds);
            this.grids.set(key, grid);
            return grid;
        }
        catch (err) {
            this.ctx.env.log(`navigation grid failed: ${err instanceof Error ? err.message : String(err)}`);
            return null;
        }
    }
    /** Ground height under (x, z) from the host (a ray cast), or undefined. */
    groundHeight(x, z, fromY, exclude) {
        const host = this.ctx.env.host;
        return host.groundHeight?.(x, z, fromY, exclude);
    }
    /** Steering push away from nearby NPCs; the returned pair is reused. */
    separation(b) {
        const x = b.x;
        const z = b.z;
        sepOut[0] = 0;
        sepOut[1] = 0;
        const cx = Math.floor(x / HASH_CELL);
        const cz = Math.floor(z / HASH_CELL);
        for (let dz = -1; dz <= 1; dz++) {
            for (let dx = -1; dx <= 1; dx++) {
                const bucket = this.hash.get(hashKey(cx + dx, cz + dz));
                if (!bucket)
                    continue;
                for (let i = 0; i < bucket.n; i++) {
                    const o = bucket.items[i];
                    if (o === b)
                        continue;
                    const ox = x - o.x;
                    const oz = z - o.z;
                    const d = hyp(ox, oz);
                    if (d >= SEPARATE)
                        continue;
                    const k = (1 - d / SEPARATE) / Math.max(d, 0.05);
                    sepOut[0] += ox * k;
                    sepOut[1] += oz * k;
                }
            }
        }
        return sepOut;
    }
    rebuildHash() {
        // Buckets persist between ticks and are refilled by index: `length = 0` would free their storage.
        const list = this.buckets;
        for (let i = 0; i < list.length; i++)
            list[i].n = 0;
        if (this.tickNo % 900 === 0 && list.length > this.brains.length * 4 + 16) {
            this.hash.clear();
            list.length = 0;
        }
        for (const b of this.brains) {
            if (b.dead)
                continue;
            const key = hashKey(Math.floor(b.x / HASH_CELL), Math.floor(b.z / HASH_CELL));
            let bucket = this.hash.get(key);
            if (!bucket) {
                bucket = { n: 0, items: [] };
                this.hash.set(key, bucket);
                list.push(bucket);
            }
            bucket.items[bucket.n++] = b;
        }
    }
    // ---------------------------------------------------------------------------
    // World facts
    // ---------------------------------------------------------------------------
    /** Hour of day: a `timeOfDay` world state wins, then the environment. */
    hour() {
        if (this.hourTick === this.tickNo)
            return this.hourVal;
        this.hourTick = this.tickNo;
        const live = this.ctx.env.readState('timeOfDay');
        if (typeof live === 'number' && Number.isFinite(live))
            this.hourVal = ((live % 24) + 24) % 24;
        else {
            const env = this.ctx.world().environment;
            this.hourVal = env.timeOfDay ?? SKY_HOURS[env.sky] ?? 12;
        }
        return this.hourVal;
    }
    /** Multiplier on sight range: darkness hampers everyone except hunters and light carriers. */
    sightFactor(b) {
        if (b.spec.archetype === 'predator')
            return 1;
        const h = this.hour();
        const night = h >= 20.5 || h < 5;
        if (!night)
            return 1;
        return b.spec.carries.includes('torch') || b.spec.carries.includes('lantern') ? 1 : 0.7;
    }
    /** Radius within which `b` hears the player right now (m). */
    hearingRadius(b) {
        return b.spec.perception.hearing * this.noise;
    }
    /** Read a world/entity state value for conditions. */
    readValue(key) {
        const v = this.ctx.env.readState(key);
        return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null ? v : undefined;
    }
    /** Make a noise at (x, z): hostile-capable NPCs within `radius` hear it. */
    makeNoise(x, z, radius, source) {
        const r2 = radius * radius;
        for (const o of this.brains) {
            if (o === source || o.dead)
                continue;
            const dx = o.x - x;
            const dz = o.z - z;
            if (dx * dx + dz * dz <= r2 && (source === null || o.isHostileTo(source)))
                o.hear(x, z);
        }
    }
    /** `from` spotted a foe: allies within its alert radius learn where. */
    alertAllies(from, x, z) {
        const r = from.eff.alert;
        const r2 = r * r;
        const t = from.targetRef;
        const kind = t.kind;
        const id = t.id;
        for (const o of this.brains) {
            if (o === from || o.dead)
                continue;
            if (o.spec.faction !== from.spec.faction && !from.eff.allies.has(o.spec.faction))
                continue;
            const dx = o.x - from.x;
            const dz = o.z - from.z;
            if (dx * dx + dz * dz <= r2)
                o.warn(x, z, kind, id);
        }
    }
    /** A blow lands: damage the player or another NPC and make a noise. */
    hit(from, kind, id, damage) {
        const env = this.ctx.env;
        if (kind === 1) {
            const cur = env.readState('health');
            const hp = typeof cur === 'number' && Number.isFinite(cur) ? cur : 100;
            const next = Math.max(0, hp - damage);
            this.playerDamage += hp - next;
            env.setState('health', next);
            env.host.sound('hit');
            env.log(`npc ${from.id} hits the player for ${damage} (health ${hp}→${next})`);
            if (next <= 0)
                env.gameOver('lose', `${this.nameOf(from)} brought you down`, `npc ${from.id} attack`);
        }
        else if (kind === 2 && id !== null) {
            const o = this.byId.get(id);
            if (o && !o.dead) {
                const cur = o.self.state['health'];
                o.self.state['health'] = (typeof cur === 'number' ? cur : o.hp) - damage;
                env.log(`npc ${from.id} hits ${id} for ${damage}`);
            }
        }
        this.makeNoise(from.x, from.z, 10, from);
    }
    /** An NPC died. */
    onDeath(b) {
        if (this.sessionBrain === b)
            this.endDialogue();
    }
    /** Deal damage to an NPC from outside (rules, scripts, tools). */
    damage(id, amount) {
        const b = this.byId.get(id);
        if (!b || b.dead || !Number.isFinite(amount))
            return false;
        const cur = b.self.state['health'];
        b.self.state['health'] = (typeof cur === 'number' ? cur : b.hp) - amount;
        return true;
    }
    nameOf(b) {
        return b.self.spec.name || b.spec.role || b.id;
    }
    // ---------------------------------------------------------------------------
    // Speech
    // ---------------------------------------------------------------------------
    /** Show a line above an NPC (a bark). */
    say(b, text, kind) {
        const t = this.ctx.env.time;
        let slot;
        for (const s of this.slots)
            if (s.npc === b.id && s.until > t)
                slot = s;
        if (!slot)
            slot = this.slots.find((s) => s.until <= t);
        if (!slot) {
            slot = this.slots[0];
            for (const s of this.slots)
                if (s.until < slot.until)
                    slot = s;
        }
        slot.npc = b.id;
        slot.name = this.nameOf(b);
        slot.text = text.slice(0, 160);
        slot.kind = kind;
        slot.until = t + 2.4 + Math.min(3, text.length * 0.045);
        this.placeBubble(slot, b);
    }
    placeBubble(s, b) {
        s.x = b.x;
        s.z = b.z;
        s.y = b.feetY + b.spec.height + 0.35;
    }
    /** Number of active bubbles (the first `bubbleCount` entries of {@link bubbleAt}). */
    get bubbleCount() {
        return this.liveN;
    }
    /** Active bubble `i` (< `bubbleCount`); the object is reused by the system. */
    bubbleAt(i) {
        return i >= 0 && i < this.liveN ? this.slots[i] : undefined;
    }
    /** Active bubbles as a fresh array (for UI code that runs a few times a second). */
    activeBubbles() {
        return this.slots.slice(0, this.liveN);
    }
    // ---------------------------------------------------------------------------
    // Tick
    // ---------------------------------------------------------------------------
    /** Per-tick bookkeeping before the brains update. */
    beginTick(dt) {
        this.tickNo++;
        const env = this.ctx.env;
        this.cooldown = Math.max(0, this.cooldown - dt);
        this.trackPlayerNoise(dt);
        this.rebuildHash();
        // Live bubbles follow their speakers and expire.
        // Compact the live bubbles to the front of the slot array (stable, no allocation).
        const t = env.time;
        let n = 0;
        const slots = this.slots;
        for (let i = 0; i < slots.length; i++) {
            const s = slots[i];
            if (s.until <= t)
                continue;
            const b = this.byId.get(s.npc);
            if (b)
                this.placeBubble(s, b);
            if (n !== i) {
                slots[i] = slots[n];
                slots[n] = s;
            }
            n++;
        }
        this.liveN = n;
        if (this.session)
            this.handleDialogue();
        else
            this.handleTalkStart();
    }
    trackPlayerNoise(dt) {
        const env = this.ctx.env;
        const pid = env.playerId();
        const pp = pid !== undefined ? env.positionOf(pid) : undefined;
        if (!pp) {
            this.noise = 0;
            return;
        }
        if (!Number.isNaN(this.px) && dt > 1e-6) {
            const speed = hyp(pp[0] - this.px, pp[2] - this.pz) / dt;
            // Relative to the player's top speed: full pace is loud, a sneak (half pace) is quiet, standing still is silent.
            const loud = this.ctx.world().player.moveSpeed * 0.7;
            this.noise = speed > loud ? 1 : speed > 0.8 ? 0.4 : 0;
        }
        if (env.input.jump)
            this.noise = Math.max(this.noise, 0.6);
        this.px = pp[0];
        this.pz = pp[2];
    }
    // ---------------------------------------------------------------------------
    // Dialogue
    // ---------------------------------------------------------------------------
    /** The running conversation's view, or null. The object is reused (see `version`). */
    get dialogue() {
        return this.session && !this.session.ended ? this.session.view : null;
    }
    /** The "talk" hint for the nearest NPC in reach, or null. */
    get prompt() {
        return this.promptOn && !this.session ? this.promptOut : null;
    }
    /** True while `id` is in a conversation. */
    talkingWith(id) {
        return this.sessionBrain !== null && this.sessionBrain.id === id && this.session !== null && !this.session.ended;
    }
    /** Mode the conversation puts its NPC in. */
    talkMode(id) {
        return this.session && this.sessionBrain?.id === id && this.session.view.mode === 'trade' ? 'trade' : 'talk';
    }
    canTalk(b) {
        if (b.dead || !b.spec.dialogue)
            return false;
        const m = b.mode;
        if (m === 'chase' || m === 'attack' || m === 'flee')
            return false;
        return !b.isResting();
    }
    playerPos() {
        const env = this.ctx.env;
        const pid = env.playerId();
        return pid !== undefined ? env.positionOf(pid) : undefined;
    }
    nearestTalkable() {
        const pp = this.playerPos();
        if (!pp)
            return null;
        let best = null;
        let bestD = Infinity;
        for (const b of this.brains) {
            if (!this.canTalk(b))
                continue;
            const d = hyp(b.x - pp[0], b.z - pp[2]);
            if (d <= b.spec.talkRange && d < bestD && Math.abs(b.feetY - pp[1]) < 3) {
                bestD = d;
                best = b;
            }
        }
        return best ? { b: best, d: bestD } : null;
    }
    handleTalkStart() {
        const env = this.ctx.env;
        const near = this.nearestTalkable();
        if (!near) {
            this.promptOn = false;
            return;
        }
        this.promptOn = true;
        this.promptOut.npc = near.b.id;
        this.promptOut.name = this.nameOf(near.b);
        this.promptOut.distance = near.d;
        if (this.cooldown <= 0 && env.pressed.has('e'))
            this.startWith(near.b);
    }
    /** Start a conversation with NPC `id` (touch buttons, rules). Returns false when it cannot talk. */
    startDialogue(id) {
        const b = this.byId.get(id);
        if (!b || this.session || !this.canTalk(b))
            return false;
        this.startWith(b);
        return this.session !== null;
    }
    startWith(b) {
        const tree = b.spec.dialogue;
        if (!tree)
            return;
        let used = this.usedChoices.get(b.id);
        if (!used) {
            used = new Set();
            this.usedChoices.set(b.id, used);
        }
        this.promptOn = false;
        this.sessionBrain = b;
        this.session = new DialogueSession(b.id, this.nameOf(b), tree, this, used);
        this.session.view.chat = b.spec.chat !== undefined;
        this.ctx.env.log(`dialogue with ${b.id} started`);
        if (this.session.ended)
            this.endDialogue();
    }
    handleDialogue() {
        const s = this.session;
        const b = this.sessionBrain;
        const env = this.ctx.env;
        const pp = this.playerPos();
        const far = !pp || hyp(b.x - pp[0], b.z - pp[2]) > b.spec.talkRange * 2;
        if (s.ended || b.dead || far || b.mode === 'chase' || b.mode === 'attack' || b.mode === 'flee') {
            this.endDialogue();
            return;
        }
        const pressed = env.pressed;
        if (pressed.size === 0)
            return;
        for (let i = 0; i < CHOICE_KEYS.length; i++) {
            if (pressed.has(CHOICE_KEYS[i])) {
                this.choose(i);
                return;
            }
        }
        if (pressed.has('e') || pressed.has('enter')) {
            if (s.awaitingChoice) {
                if (s.view.choices.length === 1)
                    this.choose(0);
            }
            else
                this.advance();
        }
    }
    /** Take choice `i` (0-based) of the running conversation. */
    choose(i) {
        const s = this.session;
        if (!s || s.ended)
            return false;
        const ok = s.choose(i);
        if (s.ended)
            this.endDialogue();
        return ok;
    }
    /** Continue the running conversation (no-op while a choice is pending). */
    advance() {
        const s = this.session;
        if (!s || s.ended)
            return false;
        const ok = s.advance();
        if (s.ended)
            this.endDialogue();
        return ok;
    }
    /**
     * What a language model needs to play the character in the running
     * conversation, or null (no conversation, or the NPC has no `chat` spec).
     * Plain data: the studio sends it to a connected model; the logic runtime
     * itself never talks to a network.
     */
    chatContext() {
        const s = this.session;
        const b = this.sessionBrain;
        if (!s || s.ended || !b || !b.spec.chat)
            return null;
        const c = b.spec.chat;
        return { npc: b.id, name: this.nameOf(b), role: b.spec.role, persona: c.persona, facts: c.facts, maxTurns: c.maxTurns, shown: s.view.text, choices: s.view.choices };
    }
    /** Show a free-conversation reply from the character (the authored choices stay). Returns false without a conversation. */
    freeReply(text) {
        const s = this.session;
        if (!s || s.ended || typeof text !== 'string')
            return false;
        const clean = text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 320);
        if (clean.length === 0)
            return false;
        s.say(clean);
        return true;
    }
    /** Close the running conversation. */
    endDialogue() {
        if (!this.session)
            return;
        this.session.end();
        this.ctx.env.log(`dialogue with ${this.sessionBrain?.id ?? '?'} ended`);
        this.session = null;
        this.sessionBrain = null;
        this.cooldown = 0.6;
    }
    // --- DialogueHost -----------------------------------------------------------------
    read(key) {
        return this.readValue(key);
    }
    apply(fx, npc) {
        const env = this.ctx.env;
        const b = this.byId.get(npc);
        try {
            switch (fx.do) {
                case 'set':
                    env.log(`dialogue: ${env.setState(fx.key, fx.value)}`);
                    break;
                case 'add':
                    env.log(`dialogue: ${env.addState(fx.key, fx.amount)}`);
                    break;
                case 'give':
                    env.log(`dialogue: ${env.addState(fx.item, fx.count)}`);
                    env.host.sound('pickup');
                    env.host.message(fx.count > 1 ? `Received ${fx.count} × ${fx.item}` : `Received: ${fx.item}`, 2.5);
                    break;
                case 'take': {
                    const cur = env.readState(fx.item);
                    const have = typeof cur === 'number' ? cur : 0;
                    env.log(`dialogue: ${env.addState(fx.item, -Math.min(fx.count, have))}`);
                    break;
                }
                case 'openDoor':
                    env.log(`dialogue: ${env.setState(`${fx.target}-unlocked`, true)}`);
                    env.host.sound('click');
                    break;
                case 'emit':
                    env.emit(fx.event);
                    break;
                case 'message':
                    env.host.message(fx.text, 3);
                    break;
                case 'provoke':
                    b?.provoke();
                    break;
                case 'calm':
                    b?.calm();
                    break;
                case 'follow':
                    if (b)
                        b.following = fx.on;
                    break;
                case 'win':
                    env.gameOver('win', fx.text, `dialogue with ${npc}`);
                    break;
            }
        }
        catch (err) {
            env.log(`dialogue effect '${fx.do}' failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    // ---------------------------------------------------------------------------
    // Introspection
    // ---------------------------------------------------------------------------
    /** Snapshot of every NPC (tests, inspector, verification). Allocates. */
    infos() {
        return this.brains.map((b) => b.info());
    }
    /** Snapshot of one NPC. */
    info(id) {
        return this.byId.get(id)?.info();
    }
    /** Number of live NPC brains. */
    get count() {
        return this.brains.length;
    }
}
function hashKey(ix, iz) {
    // Stays inside the small-integer range (no boxed keys): 14 bits per axis.
    return (ix & 0x3fff) * 16384 + (iz & 0x3fff);
}
