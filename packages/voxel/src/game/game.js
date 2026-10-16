import { rng } from '@aether/core';
import { createBody, moveBody, overlapsSolid, resolvePenetration } from '../collide';
import { AIR, HEIGHT } from '../constants';
import { createHit, raycastVoxels } from '../raycast';
import { DayClock } from './clock';
import { RecipeBook } from './crafting';
import { Inventory } from './inventory';
import { HAND, ItemRegistry } from './items';
import { createMob, hurtMob, MOB_SPECS, rayMob, tickMob } from './mobs';
/** A fresh input record. */
export function createInput() {
    return { forward: 0, right: 0, jump: false, sneak: false, sprint: false, yaw: 0, pitch: 0, primary: false, use: false, attack: false, toggleFly: false };
}
/** Player box. */
export const PLAYER_HALF_WIDTH = 0.3;
export const PLAYER_HEIGHT = 1.8;
/** Eye height above the feet. */
export const EYE_HEIGHT = 1.62;
/** Reach (blocks) in survival / creative. */
export const REACH = 5;
export const CREATIVE_REACH = 7;
/** Most drops alive (oldest despawn first). */
export const MAX_DROPS = 200;
const GRAVITY = 28;
const JUMP_SPEED = 8.4;
const WALK = 4.3;
const SPRINT = 5.7;
const SNEAK = 1.4;
const FLY = 10.5;
const FLY_SPRINT = 21;
const TERMINAL = -60;
const PICKUP_RANGE = 1.6;
/** Largest vertical gap between a drop and the player's body that still picks it up (blocks). */
const PICKUP_REACH_Y = 1.1;
/** Drops closer than this drift toward the player (blocks). */
const MAGNET_RANGE = 2.6;
const DROP_LIFETIME = 300;
const SPAWN_INTERVAL = 1;
const DESPAWN_RANGE = 96;
/** See the module docs. */
export class VoxelGame {
    world;
    reg;
    settings;
    items;
    recipes;
    inventory;
    clock;
    player;
    mobs = [];
    drops = [];
    target = { hit: createHit(), valid: false, progress: 0 };
    /** Events since the last {@link drainEvents}. */
    events = [];
    /** Game time (s). */
    time = 0;
    rand;
    nextId = 1;
    spawnTimer = 0;
    useCooldown = 0;
    attackCooldown = 0;
    mobOut = { hit: 0, kx: 0, kz: 0 };
    mobWorld;
    isTarget;
    getBlock;
    lava;
    water;
    constructor(opts) {
        this.world = opts.world;
        this.reg = opts.reg;
        this.settings = opts.settings;
        this.items = new ItemRegistry(opts.reg);
        this.recipes = new RecipeBook(this.items, opts.settings.recipes);
        this.inventory = new Inventory(this.items);
        this.clock = new DayClock(opts.settings.startHour, opts.settings.dayLength, opts.settings.cycle);
        this.rand = rng(opts.seed ^ 0x6a3e);
        const [sx, sy, sz] = opts.spawn;
        this.player = {
            body: createBody(sx, sy, sz, PLAYER_HALF_WIDTH, PLAYER_HEIGHT), health: 20, hunger: 20, saturation: 5, exhaustion: 0, air: 10, yaw: 0, pitch: 0,
            flying: false, dead: false, immune: 0, fallFrom: sy, spawn: [sx, sy, sz], stepOffset: 0, stepTimer: 0,
        };
        for (const s of opts.settings.startItems)
            this.inventory.add(s.item, s.count);
        const w = this.world;
        const reg = this.reg;
        this.lava = reg.idOr('lava');
        this.water = reg.idOr('water');
        const lava = this.lava;
        this.mobWorld = {
            isSolid: (x, y, z) => w.isSolid(x, y, z),
            isLiquid: (x, y, z) => w.isLiquid(x, y, z),
            isHazard: (x, y, z) => w.get(x, y, z) === lava,
        };
        this.getBlock = (x, y, z) => w.get(x, y, z);
        this.isTarget = (id) => id !== AIR && reg.render[id] !== 0 && reg.render[id] !== 4;
    }
    /** Creative mode (instant breaking, infinite blocks, flight, no damage). */
    get creative() {
        return this.settings.mode === 'creative';
    }
    /** Survival rules active (health, hunger, drops). */
    get survival() {
        return this.settings.mode === 'survival';
    }
    /** Eye position of the player (camera), including the step glide. */
    eye(out) {
        const b = this.player.body;
        out[0] = b.x;
        out[1] = b.y + EYE_HEIGHT - this.player.stepOffset - (this.player.body.onGround && this.lastSneak ? 0.12 : 0);
        out[2] = b.z;
        return out;
    }
    lastSneak = false;
    /** Item in the selected hotbar slot (the hand when empty). */
    heldItem() {
        const s = this.inventory.held;
        return (s && this.items.get(s.item)) || HAND;
    }
    /** Advance the game by `dt` seconds (call with a fixed step). */
    tick(dt, input) {
        if (!(dt > 0))
            return;
        this.time += dt;
        this.clock.tick(dt);
        const p = this.player;
        p.yaw = Number.isFinite(input.yaw) ? input.yaw : p.yaw;
        p.pitch = Number.isFinite(input.pitch) ? Math.max(-1.55, Math.min(1.55, input.pitch)) : p.pitch;
        this.lastSneak = input.sneak;
        if (!p.dead) {
            if (input.toggleFly && this.creative)
                p.flying = !p.flying;
            this.movePlayer(dt, input);
            this.survivalRules(dt);
            this.interact(dt, input);
        }
        this.tickMobs(dt);
        this.tickDrops(dt);
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
            this.spawnTimer = SPAWN_INTERVAL;
            this.spawnMobs();
        }
    }
    /** Hand pending events to `fn` and clear the queue. */
    drainEvents(fn) {
        for (let i = 0; i < this.events.length; i++)
            fn(this.events[i]);
        this.events.length = 0;
    }
    emit(e) {
        if (this.events.length < 256)
            this.events.push(e);
    }
    sound(name, x, y, z) {
        this.emit({ type: 'sound', name, x, y, z });
    }
    // -------------------------------------------------------------------------
    // Movement
    // -------------------------------------------------------------------------
    movePlayer(dt, input) {
        const p = this.player;
        const b = p.body;
        const fwd = clamp1(input.forward);
        const right = clamp1(input.right);
        const sin = Math.sin(p.yaw);
        const cos = Math.cos(p.yaw);
        // Forward is −Z at yaw 0; right is +X.
        let wx = -sin * fwd + cos * right;
        let wz = -cos * fwd - sin * right;
        const len = Math.hypot(wx, wz);
        if (len > 1) {
            wx /= len;
            wz /= len;
        }
        const sprinting = input.sprint && fwd > 0 && (p.hunger > 6 || !this.survival);
        if (p.flying) {
            const speed = sprinting ? FLY_SPRINT : FLY;
            approach(b, wx * speed, wz * speed, dt * 10);
            const vy = (input.jump ? 1 : 0) - (input.sneak ? 1 : 0);
            b.vy += (vy * 8 - b.vy) * Math.min(1, dt * 10);
            moveBody(this.world, b, dt, false);
            // Sinking onto the ground ends the flight.
            if (b.onGround && input.sneak)
                p.flying = false;
            p.fallFrom = b.y;
            return;
        }
        const inLiquid = b.liquid > 0;
        let speed = input.sneak ? SNEAK : sprinting ? SPRINT : WALK;
        if (inLiquid)
            speed *= 0.55;
        const control = b.onGround ? 14 : inLiquid ? 6 : 2.6;
        approach(b, wx * speed, wz * speed, dt * control);
        if (inLiquid) {
            b.vy -= 5 * dt;
            b.vy *= 1 - Math.min(1, dt * 2.5);
            if (input.jump)
                b.vy = Math.min(b.vy + 22 * dt, 3.4);
            // Leaving the water at a bank: a small boost so the player can climb out.
            if (input.jump && (b.hitX || b.hitZ) && !b.submerged)
                b.vy = Math.max(b.vy, 6.5);
        }
        else {
            b.vy = Math.max(TERMINAL, b.vy - GRAVITY * dt);
            if (input.jump && b.onGround) {
                b.vy = JUMP_SPEED;
                if (sprinting) {
                    b.vx += wx * 1.2;
                    b.vz += wz * 1.2;
                }
                this.exhaust(sprinting ? 0.2 : 0.05);
            }
        }
        const x0 = b.x;
        const z0 = b.z;
        const y0 = b.y;
        const wasGround = b.onGround;
        moveBody(this.world, b, dt, true);
        // Sneaking never walks off an edge.
        if (input.sneak && wasGround && !b.onGround && b.vy <= 0 && !inLiquid) {
            b.x = x0;
            b.z = z0;
            b.y = y0;
            b.vx = 0;
            b.vz = 0;
            b.vy = 0;
            b.onGround = true;
        }
        // Camera glides up after an auto-step instead of popping.
        const rise = b.y - y0 - b.vy * dt;
        if (rise > 0.3 && b.onGround)
            p.stepOffset = Math.min(1, p.stepOffset + rise);
        p.stepOffset = Math.max(0, p.stepOffset - dt * 7);
        const moved = Math.hypot(b.x - x0, b.z - z0);
        if (sprinting && moved > 0)
            this.exhaust(moved * 0.1);
        if (b.onGround && moved > 0.001) {
            p.stepTimer += moved;
            if (p.stepTimer > 1.9) {
                p.stepTimer = 0;
                this.sound('step', b.x, b.y, b.z);
            }
        }
        if (!wasGround && b.onGround)
            this.land();
        if (b.onGround || inLiquid)
            p.fallFrom = b.y;
        else
            p.fallFrom = Math.max(p.fallFrom, b.y);
        if (!wasGround && inLiquid && b.vy < -6)
            this.sound('splash', b.x, b.y, b.z);
    }
    land() {
        const p = this.player;
        const fall = p.fallFrom - p.body.y;
        if (fall > 3.4 && this.survival && this.settings.fallDamage && p.body.liquid === 0)
            this.damage(Math.floor(fall - 3), 'fall');
        else if (fall > 1.2)
            this.sound('step', p.body.x, p.body.y, p.body.z);
    }
    exhaust(amount) {
        if (!this.survival || !this.settings.hunger)
            return;
        const p = this.player;
        p.exhaustion += amount;
        while (p.exhaustion >= 4) {
            p.exhaustion -= 4;
            if (p.saturation > 0)
                p.saturation = Math.max(0, p.saturation - 1);
            else
                p.hunger = Math.max(0, p.hunger - 1);
        }
    }
    // -------------------------------------------------------------------------
    // Survival
    // -------------------------------------------------------------------------
    regenTimer = 0;
    hazardTimer = 0;
    survivalRules(dt) {
        const p = this.player;
        const b = p.body;
        p.immune = Math.max(0, p.immune - dt);
        if (b.y < -16) {
            this.damage(100, 'void');
            return;
        }
        if (!this.survival) {
            p.health = 20;
            p.hunger = 20;
            p.air = 10;
            return;
        }
        // Lava at the feet or chest.
        const fx = Math.floor(b.x);
        const fz = Math.floor(b.z);
        this.hazardTimer -= dt;
        const inLava = this.world.get(fx, Math.floor(b.y + 0.2), fz) === this.lava || this.world.get(fx, Math.floor(b.y + 1.1), fz) === this.lava;
        if (inLava && this.hazardTimer <= 0) {
            this.hazardTimer = 0.5;
            this.damage(4, 'lava');
        }
        // Breath.
        if (b.submerged && this.world.get(fx, Math.floor(b.y + EYE_HEIGHT), fz) === this.water) {
            p.air = Math.max(0, p.air - dt);
            if (p.air <= 0 && this.hazardTimer <= 0) {
                this.hazardTimer = 1;
                this.damage(2, 'drown');
            }
        }
        else {
            p.air = Math.min(10, p.air + dt * 4);
        }
        // Hunger: regenerate when well fed, starve when empty.
        this.exhaust(dt * 0.005);
        this.regenTimer += dt;
        if (this.regenTimer >= 4) {
            this.regenTimer = 0;
            if (!this.settings.hunger) {
                if (p.health < 20)
                    p.health = Math.min(20, p.health + 1);
            }
            else if (p.hunger >= 18 && p.health < 20) {
                p.health = Math.min(20, p.health + 1);
                this.exhaust(1.5);
            }
            else if (p.hunger <= 0) {
                this.damage(1, 'starve');
            }
        }
    }
    /** Damage the player (ignored in creative / explore and while immune). */
    damage(amount, cause) {
        const p = this.player;
        if (p.dead || amount <= 0)
            return;
        if (cause !== 'void' && (!this.survival || p.immune > 0))
            return;
        p.health = Math.max(0, p.health - amount);
        p.immune = 0.5;
        this.emit({ type: 'damage', amount, cause });
        this.sound('hurt', p.body.x, p.body.y, p.body.z);
        if (p.health <= 0)
            this.die(cause);
    }
    die(cause) {
        const p = this.player;
        p.dead = true;
        this.target.valid = false;
        this.target.progress = 0;
        if (!this.settings.keepInventory && this.survival) {
            const slots = this.inventory.snapshot();
            this.inventory.clear();
            for (const s of slots)
                if (s)
                    this.spawnDrop(s.item, s.count, p.body.x, p.body.y + 1, p.body.z, true);
        }
        this.emit({ type: 'death', cause });
        this.sound('death', p.body.x, p.body.y, p.body.z);
    }
    /** Respawn at the spawn point with full health. */
    respawn() {
        const p = this.player;
        const b = p.body;
        b.x = p.spawn[0];
        b.y = p.spawn[1];
        b.z = p.spawn[2];
        b.vx = 0;
        b.vy = 0;
        b.vz = 0;
        resolvePenetration(this.world, b);
        p.health = 20;
        p.hunger = 20;
        p.saturation = 5;
        p.air = 10;
        p.dead = false;
        p.immune = 2;
        p.fallFrom = b.y;
        p.flying = false;
        this.emit({ type: 'respawn' });
    }
    /** Eat the held food (true when eaten). */
    eat(item) {
        const p = this.player;
        if (item.food <= 0 || (p.hunger >= 20 && this.survival))
            return false;
        if (this.inventory.takeOne(this.inventory.selected) === null)
            return false;
        p.hunger = Math.min(20, p.hunger + item.food);
        p.saturation = Math.min(p.hunger, p.saturation + item.food * 0.6);
        this.sound('eat', p.body.x, p.body.y, p.body.z);
        return true;
    }
    // -------------------------------------------------------------------------
    // Blocks: target, break, place
    // -------------------------------------------------------------------------
    /** Seconds to break `block` with `item` (Infinity: unbreakable). Exposed for the UI and tests. */
    breakTime(block, item) {
        const t = this.reg.type(block);
        if (t.hardness < 0)
            return Infinity;
        if (this.creative)
            return 0.12;
        if (t.hardness === 0)
            return 0.05;
        let time = t.hardness * 1.5;
        const tool = item.tool;
        const right = tool !== undefined && t.tool !== undefined && tool.kind === t.tool;
        if (right)
            time /= tool.speed;
        if (t.tier > 0 && (!right || tool.tier < t.tier))
            time *= 3.3;
        return time;
    }
    /** True when breaking `block` with `item` yields its drop. */
    harvests(block, item) {
        const t = this.reg.type(block);
        if (t.tier <= 0)
            return true;
        return item.tool !== undefined && item.tool.kind === t.tool && item.tool.tier >= t.tier;
    }
    lookDir(out) {
        const p = this.player;
        const cp = Math.cos(p.pitch);
        out[0] = -Math.sin(p.yaw) * cp;
        out[1] = Math.sin(p.pitch);
        out[2] = -Math.cos(p.yaw) * cp;
        return out;
    }
    eyeTmp = [0, 0, 0];
    dirTmp = [0, 0, 0];
    prevHit = { x: 0, y: 0, z: 0, valid: false };
    /** Re-cast the crosshair ray (also used by the host between ticks). */
    updateTarget() {
        const eye = this.eye(this.eyeTmp);
        const dir = this.lookDir(this.dirTmp);
        const t = this.target;
        const reach = this.creative ? CREATIVE_REACH : REACH;
        t.valid = !this.player.dead && this.settings.mode !== 'explore' && raycastVoxels(this.getBlock, eye[0], eye[1], eye[2], dir[0], dir[1], dir[2], reach, this.isTarget, t.hit);
    }
    interact(dt, input) {
        this.useCooldown = Math.max(0, this.useCooldown - dt);
        this.attackCooldown = Math.max(0, this.attackCooldown - dt);
        this.updateTarget();
        const t = this.target;
        const prev = this.prevHit;
        const moved = !t.valid || !prev.valid || prev.x !== t.hit.x || prev.y !== t.hit.y || prev.z !== t.hit.z;
        if (moved)
            t.progress = 0;
        prev.valid = t.valid;
        prev.x = t.hit.x;
        prev.y = t.hit.y;
        prev.z = t.hit.z;
        const held = this.heldItem();
        // Attack a mob in front of the block.
        if ((input.attack || (input.primary && this.attackCooldown <= 0)) && this.attackMob(t.valid ? t.hit.distance : this.creative ? CREATIVE_REACH : REACH, held)) {
            t.progress = 0;
            return;
        }
        if (this.settings.mode === 'explore')
            return;
        if (input.primary && t.valid) {
            const time = this.breakTime(t.hit.block, held);
            if (Number.isFinite(time)) {
                const before = t.progress;
                t.progress += dt / Math.max(0.05, time);
                if (Math.floor(before * 4) !== Math.floor(t.progress * 4))
                    this.sound('dig', t.hit.x + 0.5, t.hit.y + 0.5, t.hit.z + 0.5);
                if (t.progress >= 1) {
                    this.breakBlock(t.hit.x, t.hit.y, t.hit.z, held);
                    t.progress = 0;
                    // Creative breaking repeats at a steady pace while held.
                    this.updateTarget();
                }
            }
        }
        else if (!input.primary) {
            t.progress = 0;
        }
        if (input.use && this.useCooldown <= 0) {
            if (held.food > 0 && this.eat(held)) {
                this.useCooldown = 0.6;
                return;
            }
            if (held.block >= 0 && t.valid) {
                if (this.placeBlock(t.hit, held))
                    this.useCooldown = 0.15;
            }
        }
    }
    attackMob(maxDist, held) {
        const eye = this.eye(this.eyeTmp);
        const dir = this.lookDir(this.dirTmp);
        let best = null;
        let bestT = Math.min(maxDist, REACH - 1.5);
        for (const m of this.mobs) {
            if (m.dead)
                continue;
            const d = rayMob(m, eye[0], eye[1], eye[2], dir[0], dir[1], dir[2], bestT);
            if (d < bestT) {
                bestT = d;
                best = m;
            }
        }
        if (!best)
            return false;
        if (this.attackCooldown > 0)
            return true;
        this.attackCooldown = 0.45;
        const kx = dir[0];
        const kz = dir[2];
        const kl = Math.hypot(kx, kz) || 1;
        this.sound(best.spec.sound, best.body.x, best.body.y, best.body.z);
        // A mob killed here drops its loot in the next mob update.
        hurtMob(best, held.damage, kx / kl, kz / kl, this.rand);
        this.exhaust(0.1);
        return true;
    }
    killMob(m) {
        this.sound('poof', m.body.x, m.body.y, m.body.z);
        for (const [item, min, max] of m.spec.drops) {
            const n = min + Math.floor(this.rand() * (max - min + 1));
            if (n > 0 && this.items.has(item))
                this.spawnDrop(item, n, m.body.x, m.body.y + 0.5, m.body.z, true);
        }
    }
    /** Break a block (player action): drops, sounds, plants on top fall too. Returns true when something broke. */
    breakBlock(x, y, z, held = this.heldItem()) {
        const block = this.world.get(x, y, z);
        if (block === AIR || !this.isTarget(block))
            return false;
        const prev = this.world.set(x, y, z, AIR);
        if (prev < 0)
            return false;
        this.emit({ type: 'block', x, y, z, from: prev, to: AIR });
        this.sound('break', x + 0.5, y + 0.5, z + 0.5);
        if (this.survival) {
            const t = this.reg.type(prev);
            if (this.harvests(prev, held)) {
                const drop = t.drops === undefined ? t.id : t.drops;
                if (drop && this.items.has(drop))
                    this.spawnDrop(drop, 1, x + 0.5, y + 0.25, z + 0.5, false);
                if (t.bonus && this.rand() < t.bonus.chance && this.items.has(t.bonus.item))
                    this.spawnDrop(t.bonus.item, 1, x + 0.5, y + 0.25, z + 0.5, false);
            }
            this.exhaust(0.005);
        }
        // A plant standing on the broken block goes with it.
        const above = this.world.get(x, y + 1, z);
        if (y + 1 < HEIGHT && this.reg.render[above] === 3)
            this.breakBlock(x, y + 1, z, held);
        return true;
    }
    /** Place the held block against the targeted face. Returns true when placed. */
    placeBlock(hit, held) {
        const x = hit.x + hit.nx;
        const y = hit.y + hit.ny;
        const z = hit.z + hit.nz;
        if (y < 0 || y >= HEIGHT)
            return false;
        // Placing on a plant replaces the plant.
        const targetIsPlant = this.reg.render[hit.block] === 3;
        const px = targetIsPlant ? hit.x : x;
        const py = targetIsPlant ? hit.y : y;
        const pz = targetIsPlant ? hit.z : z;
        const cur = this.world.get(px, py, pz);
        if (cur === 0xffff)
            return false;
        if (cur !== AIR && this.reg.render[cur] !== 4 && this.reg.render[cur] !== 3)
            return false;
        const block = held.block;
        // Plants need ground under them.
        if (this.reg.render[block] === 3 && !this.world.isSolid(px, py - 1, pz))
            return false;
        if (this.reg.solid[block] === 1) {
            const b = this.player.body;
            if (boxHitsCell(b.x, b.y, b.z, b.halfWidth, b.height, px, py, pz))
                return false;
            for (const m of this.mobs)
                if (!m.dead && boxHitsCell(m.body.x, m.body.y, m.body.z, m.body.halfWidth, m.body.height, px, py, pz))
                    return false;
        }
        if (this.survival && this.inventory.takeOne(this.inventory.selected) === null)
            return false;
        const prev = this.world.set(px, py, pz, block);
        if (prev < 0)
            return false;
        this.emit({ type: 'block', x: px, y: py, z: pz, from: prev, to: block });
        this.sound('place', px + 0.5, py + 0.5, pz + 0.5);
        return true;
    }
    /** True when a crafting table is within 4 blocks of the player. */
    nearCraftingTable() {
        const table = this.reg.id('crafting_table');
        if (table === undefined)
            return false;
        const b = this.player.body;
        const bx = Math.floor(b.x);
        const by = Math.floor(b.y);
        const bz = Math.floor(b.z);
        for (let y = by - 2; y <= by + 3; y++)
            for (let z = bz - 4; z <= bz + 4; z++)
                for (let x = bx - 4; x <= bx + 4; x++)
                    if (this.world.get(x, y, z) === table)
                        return true;
        return false;
    }
    /** Craft a recipe once from the inventory. */
    craft(recipe) {
        const rec = typeof recipe === 'string' ? this.recipes.get(recipe) : recipe;
        if (!rec || this.player.dead)
            return false;
        const ok = this.recipes.craft(rec, this.inventory, this.creative || this.nearCraftingTable());
        if (ok)
            this.sound('craft', this.player.body.x, this.player.body.y, this.player.body.z);
        return ok;
    }
    // -------------------------------------------------------------------------
    // Mobs and drops
    // -------------------------------------------------------------------------
    /** Spawn a mob at a feet position (null when the cap is reached). */
    spawnMob(kind, x, y, z) {
        if (this.mobs.length >= this.settings.maxMobs)
            return null;
        const m = createMob(this.nextId++, MOB_SPECS[kind], x, y, z, this.rand() * Math.PI * 2);
        this.mobs.push(m);
        return m;
    }
    tickMobs(dt) {
        const p = this.player;
        const b = p.body;
        const night = this.clock.isNight;
        for (let i = this.mobs.length - 1; i >= 0; i--) {
            const m = this.mobs[i];
            if (m.dead) {
                this.killMob(m);
                this.mobs.splice(i, 1);
                continue;
            }
            // Unloaded ground: freeze (never fall through terrain that is streaming in).
            if (!this.world.isLoaded(Math.floor(m.body.x), Math.floor(m.body.z)))
                continue;
            const r = tickMob(m, this.mobWorld, dt, b.x, b.y, b.z, !p.dead && this.survival, night, this.rand, this.mobOut);
            if (r.hit > 0) {
                this.damage(r.hit, 'mob');
                b.vx += r.kx * 7;
                b.vz += r.kz * 7;
                b.vy = Math.max(b.vy, 4.5);
            }
            if (m.dead)
                continue;
            const far = Math.hypot(m.body.x - b.x, m.body.z - b.z) > DESPAWN_RANGE;
            const daylightHostile = m.spec.hostile && !night && this.clock.daylight > 0.8 && Math.hypot(m.body.x - b.x, m.body.z - b.z) > 20;
            if (far || daylightHostile || m.body.y < -16)
                this.mobs.splice(i, 1);
        }
    }
    /** Try to spawn a few mobs around the player (passive by day on grass, hostile at night). */
    spawnMobs() {
        const s = this.settings;
        if (!s.mobs || this.mobs.length >= s.maxMobs || this.player.dead)
            return;
        const night = this.clock.isNight;
        const pool = night && s.hostile.length > 0 && this.rand() < 0.7 ? s.hostile : s.passive;
        if (pool.length === 0)
            return;
        let hostile = 0;
        let passive = 0;
        for (const m of this.mobs) {
            if (m.spec.hostile)
                hostile++;
            else
                passive++;
        }
        const kind = pool[Math.floor(this.rand() * pool.length)];
        const spec = MOB_SPECS[kind];
        if (spec.hostile && hostile >= Math.ceil(s.maxMobs * 0.6))
            return;
        if (!spec.hostile && passive >= Math.ceil(s.maxMobs * 0.6))
            return;
        const b = this.player.body;
        const grass = this.reg.id('grass');
        const groupSize = spec.hostile ? 1 : 1 + Math.floor(this.rand() * 3);
        const a = this.rand() * Math.PI * 2;
        const r = spec.hostile ? 20 + this.rand() * 16 : 14 + this.rand() * 26;
        const cx = b.x + Math.cos(a) * r;
        const cz = b.z + Math.sin(a) * r;
        for (let k = 0; k < groupSize; k++) {
            const x = Math.floor(cx + (this.rand() - 0.5) * 4);
            const z = Math.floor(cz + (this.rand() - 0.5) * 4);
            if (!this.world.isLoaded(x, z))
                return;
            const top = this.world.surfaceY(x, z);
            if (top <= 0 || top >= HEIGHT - 2)
                continue;
            const ground = this.world.get(x, top - 1, z);
            if (this.reg.render[ground] === 4)
                continue;
            if (!spec.hostile && ground !== grass)
                continue;
            if (overlapsSolid(this.world, x + 0.5, top, z + 0.5, spec.halfWidth, spec.height))
                continue;
            this.spawnMob(kind, x + 0.5, top + 0.01, z + 0.5);
        }
    }
    /** Drop items into the world (scattered when `toss`). */
    spawnDrop(item, count, x, y, z, toss) {
        if (count <= 0 || !this.items.has(item))
            return;
        if (this.drops.length >= MAX_DROPS)
            this.drops.shift();
        const body = createBody(x, y, z, 0.125, 0.25);
        body.vx = (this.rand() - 0.5) * (toss ? 5 : 2);
        body.vz = (this.rand() - 0.5) * (toss ? 5 : 2);
        body.vy = 3 + this.rand() * 2;
        this.drops.push({ id: this.nextId++, item, count, body, age: 0, delay: toss ? 1.5 : 0.4 });
    }
    tickDrops(dt) {
        const p = this.player;
        const pb = p.body;
        for (let i = this.drops.length - 1; i >= 0; i--) {
            const d = this.drops[i];
            d.age += dt;
            d.delay -= dt;
            const b = d.body;
            if (!this.world.isLoaded(Math.floor(b.x), Math.floor(b.z)))
                continue;
            if (b.liquid > 0) {
                b.vy = Math.min(b.vy + 10 * dt, 1);
            }
            else
                b.vy = Math.max(-30, b.vy - GRAVITY * dt);
            const f = b.onGround ? Math.max(0, 1 - dt * 8) : 1;
            b.vx *= f;
            b.vz *= f;
            moveBody(this.world, b, dt, false);
            resolvePenetration(this.world, b, 2);
            // Magnet + pickup, measured against the player's body (feet to head), so a drop
            // lying in the hole just dug under or beside the player is collected too.
            if (!p.dead && d.delay <= 0 && this.settings.mode !== 'explore') {
                const dx = pb.x - b.x;
                const dz = pb.z - b.z;
                const horiz = Math.hypot(dx, dz);
                const below = pb.y - (b.y + b.height);
                const above = b.y - (pb.y + pb.height);
                const gap = below > 0 ? below : above > 0 ? above : 0;
                if (horiz < PICKUP_RANGE && gap < PICKUP_REACH_Y) {
                    const left = this.inventory.add(d.item, d.count);
                    const taken = d.count - left;
                    if (taken > 0) {
                        this.emit({ type: 'pickup', item: d.item, count: taken });
                        this.sound('pickup', b.x, b.y, b.z);
                    }
                    d.count = left;
                    if (left === 0) {
                        this.drops.splice(i, 1);
                        continue;
                    }
                }
                else if (horiz < MAGNET_RANGE && gap < MAGNET_RANGE) {
                    const dist = Math.max(0.05, horiz);
                    b.vx += (dx / dist) * dt * 18;
                    b.vz += (dz / dist) * dt * 18;
                    // A drop resting below the player (a hole, a step down) hops up toward them.
                    if (b.onGround && below > 0.2)
                        b.vy = Math.min(7, 3.2 + below * 1.8);
                }
            }
            if (d.age > DROP_LIFETIME || b.y < -16)
                this.drops.splice(i, 1);
        }
    }
    // -------------------------------------------------------------------------
    // Saves
    // -------------------------------------------------------------------------
    /** The player's state for a save. */
    snapshotPlayer() {
        const p = this.player;
        return {
            position: [p.body.x, p.body.y, p.body.z], yaw: p.yaw, pitch: p.pitch, health: p.health, hunger: p.hunger,
            slots: this.inventory.snapshot(), selected: this.inventory.selected, hour: this.clock.hour, day: this.clock.day, spawn: [p.spawn[0], p.spawn[1], p.spawn[2]],
        };
    }
    /** Restore the player's state from a save. */
    loadPlayer(s) {
        const p = this.player;
        p.body.x = s.position[0];
        p.body.y = Math.max(-8, Math.min(HEIGHT + 32, s.position[1]));
        p.body.z = s.position[2];
        p.body.vx = 0;
        p.body.vy = 0;
        p.body.vz = 0;
        p.yaw = s.yaw;
        p.pitch = Math.max(-1.55, Math.min(1.55, s.pitch));
        p.health = Math.max(1, s.health);
        p.hunger = s.hunger;
        p.fallFrom = p.body.y;
        p.spawn = [s.spawn[0], s.spawn[1], s.spawn[2]];
        this.inventory.load(s.slots, s.selected);
        this.clock.set(s.day, s.hour);
    }
}
function clamp1(v) {
    return Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
}
function approach(b, tx, tz, rate) {
    const k = Math.min(1, rate);
    b.vx += (tx - b.vx) * k;
    b.vz += (tz - b.vz) * k;
}
function boxHitsCell(x, y, z, hw, h, cx, cy, cz) {
    return x + hw > cx && x - hw < cx + 1 && y + h > cy && y < cy + 1 && z + hw > cz && z - hw < cz + 1;
}
