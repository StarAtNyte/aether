/** Speeds (m/s) that separate stillness from motion. */
export const STILL_BELOW = 0.12;
const MOVE_ABOVE = 0.2;
/** Play-rate clamp of locomotion clips. */
const RATE_MIN = 0.6;
const RATE_MAX = 1.7;
/** Seconds of falling before the fall pose replaces the jump pose. */
const FALL_AFTER = 0.55;
/** Vertical speed below which an airborne body is falling, not rising. */
const FALL_VY = -2.5;
/** Clip for a mood when standing. */
export function idleClipFor(mood) {
    switch (mood) {
        case 'tired':
            return 'idle_breathe';
        case 'angry':
            return 'idle_angry';
        case 'nervous':
            return 'idle_nervous';
        case 'calm':
            return 'idle_wait';
        case 'cheerful':
            return 'idle_b';
        case 'hurt':
            return 'idle_breathe';
        default:
            return 'idle';
    }
}
/** Talking gesture clips for a mood, in the order they alternate. */
export function talkClipsFor(mood) {
    switch (mood) {
        case 'cheerful':
            return ['talk_excited', 'talk_b'];
        case 'angry':
            return ['talk_angry', 'talk'];
        case 'tired':
        case 'calm':
        case 'hurt':
            return ['talk_calm', 'talk_b'];
        case 'nervous':
            return ['talk_b', 'talk'];
        default:
            return ['talk', 'talk_b', 'talk_calm'];
    }
}
/** The walking clip a mood prefers at walking speeds, or null for the plain gait ladder. */
export function walkClipFor(mood) {
    switch (mood) {
        case 'tired':
            return 'walk_slow';
        case 'hurt':
            return 'walk_hurt';
        case 'drunk':
            return 'walk_drunk';
        case 'calm':
            return 'stroll';
        case 'angry':
            return 'walk_fast';
        default:
            return null;
    }
}
/** Gait ladder: clips ordered by captured speed. */
const LADDER = ['walk_slow', 'walk', 'walk_fast', 'jog', 'run', 'sprint'];
/** The ordered locomotion clips that exist in a motion set with their strides. */
export function gaitLadder(table) {
    const out = [];
    for (const name of LADDER) {
        const c = table.get(name);
        if (c && c.stride > 0.1)
            out.push({ clip: name, stride: c.stride });
    }
    return out.sort((a, b) => a.stride - b.stride);
}
/** Clip each action plays (falls back to nothing when the set lacks it). */
export const ACTION_CLIP = {
    wave: 'wave',
    nod: 'nod',
    shake_head: 'shake_head',
    shrug: 'shrug',
    cheer: 'cheer',
    clap: 'clap',
    pickup: 'pickup',
    throw: 'throw',
    knock: 'knock',
    door: 'door',
    drink: 'drink',
    laugh: 'laugh',
    attack: 'attack',
    hit: 'hit',
    read: 'read',
    take: 'take',
    present: 'present',
    think: 'think',
};
/** The machine. One per body. */
export class LocomotionMachine {
    table;
    ladder;
    state = 'loco';
    clip = '';
    stateTime = 0;
    airTime = 0;
    gait = -1;
    oneShot = null;
    talkIndex = 0;
    talkLeft = 0;
    wasGrounded = true;
    sitPhase = 'none';
    dead = false;
    lastHint = 'idle';
    constructor(table) {
        this.table = table;
        this.ladder = gaitLadder(table);
    }
    /** The state now. */
    get current() {
        return this.state;
    }
    /** True once the body died (terminal). */
    get isDead() {
        return this.dead;
    }
    has(name) {
        return this.table.has(name);
    }
    dur(name) {
        return this.table.get(name)?.duration ?? 1;
    }
    /** Ask for a one-shot action. Returns false when it is not available (dead, airborne, no clip). */
    trigger(action) {
        const clip = ACTION_CLIP[action];
        if (this.dead || !this.has(clip) || this.state === 'air' || this.state === 'fall' || this.state === 'jump')
            return false;
        const state = action === 'hit' ? 'hit' : action === 'attack' || action === 'throw' ? 'attack' : 'action';
        this.oneShot = { clip, left: this.dur(clip), state };
        return true;
    }
    /** Pick the gait clip for a speed (hysteresis keeps the choice from flickering at boundaries). */
    pickGait(speed, mood, sprinting) {
        if (this.ladder.length === 0)
            return null;
        const preferred = speed < (this.ladder.find((g) => g.clip === 'jog')?.stride ?? 2.4) * 0.85 ? walkClipFor(mood) : null;
        if (preferred) {
            const c = this.table.get(preferred);
            if (c && c.stride > 0.1) {
                this.gait = -1;
                return { clip: preferred, stride: c.stride };
            }
        }
        let best = 0;
        let bestErr = Infinity;
        for (let i = 0; i < this.ladder.length; i++) {
            const g = this.ladder[i];
            let err = Math.abs(Math.log(Math.max(0.05, speed) / g.stride));
            if (i === this.gait)
                err *= 0.7;
            if (sprinting && g.clip === 'sprint')
                err *= 0.5;
            if (err < bestErr) {
                bestErr = err;
                best = i;
            }
        }
        this.gait = best;
        return this.ladder[best];
    }
    /** Advance by `dt` seconds. */
    update(dt, input) {
        const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 0;
        this.stateTime += step;
        const prevState = this.state;
        let clip = this.clip;
        let timeScale = 1;
        let loop = true;
        let fade = 0.22;
        if (this.dead || input.hint === 'dead') {
            if (!this.dead && this.has('death')) {
                this.dead = true;
                this.state = 'dead';
                this.stateTime = 0;
            }
            if (this.dead) {
                return this.finish('death', 1, false, 0.12, prevState);
            }
        }
        // One-shot overrides: hit / attack hints from the NPC runtime, and requested actions.
        if (input.hint !== this.lastHint) {
            if (input.hint === 'hurt')
                this.trigger('hit');
            else if (input.hint === 'attack')
                this.trigger('attack');
            this.lastHint = input.hint;
        }
        if (this.oneShot) {
            this.oneShot.left -= step;
            if (this.oneShot.left <= 0)
                this.oneShot = null;
        }
        if (this.oneShot) {
            this.state = this.oneShot.state;
            return this.finish(this.oneShot.clip, 1, false, this.oneShot.state === 'hit' ? 0.06 : 0.14, prevState);
        }
        const moving = input.speed > (this.state === 'loco' && this.gait >= 0 ? STILL_BELOW : MOVE_ABOVE);
        // Airborne: jump, rise, fall, land.
        if (!input.grounded) {
            this.airTime += step;
            if (this.wasGrounded && input.vy > 1) {
                this.state = 'jump';
                this.stateTime = 0;
            }
            this.wasGrounded = false;
            if (this.state === 'jump' && this.stateTime > this.dur('jump_start') * 0.95)
                this.state = 'air';
            if (this.state !== 'jump' && (input.vy < FALL_VY || this.airTime > FALL_AFTER) && input.vy < -0.5)
                this.state = this.has('fall') ? 'fall' : 'air';
            if (this.state === 'loco' || this.state === 'crouch' || this.state === 'talk' || this.state === 'sit' || this.state === 'sit_down' || this.state === 'stand_up')
                this.state = input.vy > 0 ? 'air' : this.has('fall') ? 'fall' : 'air';
            const c = this.state === 'jump' ? 'jump_start' : this.state === 'fall' ? 'fall' : 'jump_air';
            return this.finish(this.has(c) ? c : 'idle', 1, this.state !== 'jump', 0.12, prevState);
        }
        if (!this.wasGrounded) {
            this.wasGrounded = true;
            if ((this.state === 'air' || this.state === 'fall' || this.state === 'jump') && this.airTime > 0.25 && this.has('land')) {
                this.state = 'land';
                this.stateTime = 0;
            }
            else
                this.state = 'loco';
            this.airTime = 0;
        }
        if (this.state === 'land') {
            if (this.stateTime < this.dur('land') * 0.9 && !(moving && input.speed > 2.2))
                return this.finish('land', 1, false, 0.08, prevState);
            this.state = 'loco';
        }
        this.airTime = 0;
        // Sitting.
        if (input.sitting || this.sitPhase === 'down' || this.sitPhase === 'sit') {
            if (input.sitting) {
                if (this.sitPhase === 'none' || this.sitPhase === 'up') {
                    this.sitPhase = this.has('sit_down') ? 'down' : 'sit';
                    this.stateTime = 0;
                }
                if (this.sitPhase === 'down' && this.stateTime >= this.dur('sit_down') * 0.97) {
                    this.sitPhase = 'sit';
                    this.stateTime = 0;
                }
                if (this.sitPhase === 'down') {
                    this.state = 'sit_down';
                    return this.finish('sit_down', 1, false, 0.2, prevState);
                }
                this.state = 'sit';
                const sitting = input.talking && this.has('sit_shrug') ? 'sit_shrug' : this.has('sit') ? 'sit' : 'idle';
                return this.finish(sitting, 1, true, 0.25, prevState);
            }
            this.sitPhase = this.has('stand_up') ? 'up' : 'none';
            this.stateTime = 0;
        }
        if (this.sitPhase === 'up') {
            if (this.stateTime < this.dur('stand_up') * 0.95) {
                this.state = 'stand_up';
                return this.finish('stand_up', 1, false, 0.2, prevState);
            }
            this.sitPhase = 'none';
        }
        // Locomotion.
        if (moving) {
            this.state = input.crouching && this.has('crouch_walk') ? 'crouch' : 'loco';
            if (this.state === 'crouch') {
                const c = this.table.get('crouch_walk');
                timeScale = clamp(input.speed / Math.max(0.3, c.stride), RATE_MIN, RATE_MAX);
                return this.finish('crouch_walk', timeScale, true, 0.2, prevState);
            }
            const g = this.pickGait(input.speed, input.mood, input.sprinting);
            if (g) {
                timeScale = clamp(input.speed / g.stride, RATE_MIN, RATE_MAX);
                return this.finish(g.clip, timeScale, true, 0.25, prevState);
            }
        }
        this.gait = -1;
        // Standing: crouch, talk, or an idle that matches the mood.
        if (input.crouching && this.has('crouch')) {
            this.state = 'crouch';
            return this.finish('crouch', 1, true, 0.25, prevState);
        }
        if (input.talking || input.hint === 'talk') {
            this.state = 'talk';
            this.talkLeft -= step;
            const list = talkClipsFor(input.mood).filter((n) => this.has(n));
            if (list.length > 0) {
                if (this.talkLeft <= 0 || this.clip === '' || !list.includes(this.clip)) {
                    this.talkIndex = (this.talkIndex + (this.talkLeft <= 0 ? 1 : 0)) % list.length;
                    this.talkLeft = this.dur(list[this.talkIndex]) * 0.98;
                }
                return this.finish(list[this.talkIndex], 1, true, 0.3, prevState);
            }
        }
        else
            this.talkLeft = 0;
        this.state = 'loco';
        clip = idleClipFor(input.mood);
        if (!this.has(clip))
            clip = 'idle';
        fade = 0.3;
        loop = true;
        return this.finish(clip, timeScale, loop, fade, prevState);
    }
    finish(clip, timeScale, loop, fade, prev) {
        const changed = clip !== this.clip;
        this.clip = clip;
        if (this.state !== prev)
            this.stateTime = this.state === 'sit_down' || this.state === 'stand_up' ? this.stateTime : 0;
        return { clip, timeScale, loop, fade, changed, state: this.state };
    }
}
function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}
