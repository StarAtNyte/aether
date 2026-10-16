import { describe, expect, it } from 'vitest';
import { createWorld } from '@aether/core';
import { CARRY_MAX_SPEED, HOLD_DISTANCE, PlayInteraction, THROW_SPEED, carryVelocity, describeInteraction, holdPoint, seatPose, SEATED_EYE, promptFor, throwVelocity, usableEntity, } from '../src/engine/interaction';
function world() {
    return createWorld({
        entities: {
            drawer: { id: 'drawer', name: 'Drawer', interact: { kind: 'drawer', label: 'drawer' } },
            cabinet: { id: 'cabinet', name: 'Cabinet door', interact: { kind: 'cabinet', label: 'cabinet door', reach: 1.5 } },
            tap: { id: 'tap', name: 'Tap', interact: { kind: 'tap', label: 'tap' } },
            mug: { id: 'mug', name: 'Mug', interact: { kind: 'pickup', label: 'mug' }, physics: { body: 'dynamic' } },
            statue: { id: 'statue', name: 'Statue', interact: { kind: 'pickup', label: 'statue' }, physics: { body: 'static' } },
            piece: { id: 'piece', name: 'Kitchen', interact: { kind: 'appliance' } },
            child: { id: 'child', name: 'Kitchen door', parent: 'piece' },
            sofa: { id: 'sofa', name: 'Sofa', interact: { kind: 'seat', label: 'sofa' } },
            plain: { id: 'plain', name: 'Plain wall' },
        },
    });
}
describe('interaction decisions', () => {
    const w = world();
    it('resolves a hit to the entity or its parent that carries interact', () => {
        expect(usableEntity(w, 'drawer')?.id).toBe('drawer');
        expect(usableEntity(w, 'child')?.id).toBe('piece');
        expect(usableEntity(w, 'plain')).toBeNull();
        expect(usableEntity(w, null)).toBeNull();
        expect(usableEntity(w, 'missing')).toBeNull();
    });
    it('words the prompt from the state', () => {
        const drawer = w.entities['drawer'];
        const tap = w.entities['tap'];
        const mug = w.entities['mug'];
        if (!drawer || !tap || !mug)
            throw new Error('fixture');
        expect(promptFor(drawer, { open: false }, 1, false)?.text).toBe('E · Open drawer');
        expect(promptFor(drawer, { open: true }, 1, false)?.text).toBe('E · Close drawer');
        expect(promptFor(tap, { on: true }, 1, false)?.text).toBe('E · Turn off tap');
        expect(promptFor(tap, {}, 1, false)?.text).toBe('E · Turn on tap');
        expect(promptFor(mug, {}, 1, false)?.verb).toBe('Pick up');
        const carried = promptFor(mug, {}, 0, true);
        expect(carried?.verb).toBe('Drop');
        expect(carried?.hint).toBe('Click · Throw');
        expect(describeInteraction({ kind: 'seat' }, 'Sofa', {}, false).verb).toBe('Sit on');
    });
    it('respects reach', () => {
        const cabinet = w.entities['cabinet'];
        if (!cabinet)
            throw new Error('fixture');
        expect(promptFor(cabinet, {}, 1.4, false)).not.toBeNull();
        expect(promptFor(cabinet, {}, 1.6, false)).toBeNull();
        const drawer = w.entities['drawer'];
        expect(drawer && promptFor(drawer, {}, 2.5, false)).toBeNull();
    });
    it('holds a prop ahead of the eye, pulled back by walls and above the floor', () => {
        const eye = [0, 1.6, 0];
        const free = holdPoint(eye, [0, 0, 1], null, 0);
        expect(free[2]).toBeCloseTo(HOLD_DISTANCE, 5);
        const near = holdPoint(eye, [0, 0, 1], 0.7, 0);
        expect(near[2]).toBeCloseTo(0.5, 5);
        const down = holdPoint(eye, [0, -1, 0], null, 1.5);
        expect(down[1]).toBeGreaterThanOrEqual(1.65);
    });
    it('caps carry and gives throws the aim direction', () => {
        const v = carryVelocity([0, 0, 0], [10, 0, 0]);
        expect(Math.hypot(...v)).toBeLessThanOrEqual(CARRY_MAX_SPEED + 1e-9);
        const small = carryVelocity([0, 0, 0], [0.1, 0, 0]);
        expect(small[0]).toBeCloseTo(1.4, 5);
        const t = throwVelocity([0, 0, 2]);
        expect(t[2]).toBeCloseTo(THROW_SPEED, 5);
        expect(t[1]).toBeGreaterThan(0);
    });
});
class FakeSession {
    world = world();
    hit = null;
    used = [];
    velocities = [];
    positions = new Map([['mug', [0, 1.5, 1]]]);
    state = {};
    /** Extra hits behind the first (overlapping colliders). */
    behind = [];
    raycastAll(_origin, _dir, _max, exclude) {
        const all = this.hit ? [this.hit, ...this.behind] : [];
        return all.filter((h) => h.id === null || h.id !== exclude).map((h) => ({ ...h, point: [0, 0, 0] }));
    }
    position(id) {
        return this.positions.get(id) ?? null;
    }
    setVelocity(id, v) {
        this.velocities.push({ id, v });
    }
    setAngularVelocity() { }
    isDynamic(id) {
        return this.world.entities[id]?.physics?.body === 'dynamic';
    }
    entityState(id) {
        return this.state[id] ?? {};
    }
    use(id) {
        this.used.push(id);
    }
    sitting = false;
    sat = [];
    sit(id) {
        this.sat.push(id);
        this.sitting = true;
        return true;
    }
    isSitting() {
        return this.sitting;
    }
    stand() {
        this.sitting = false;
    }
}
function controller() {
    const s = new FakeSession();
    const prompts = [];
    const sounds = [];
    const toasts = [];
    const c = new PlayInteraction(s, { aim: () => ({ eye: [0, 1.6, 0], dir: [0, 0, 1] }), playerVelocity: () => [0, 0, 0], floorY: () => 0 }, { prompt: (p) => prompts.push(p), sound: (n) => sounds.push(n), toast: (t) => toasts.push(t) });
    return { c, s, prompts, sounds, toasts };
}
describe('PlayInteraction', () => {
    it('shows a prompt for what the crosshair is on and clears it, reporting changes only', () => {
        const { c, s, prompts } = controller();
        s.hit = { id: 'drawer', distance: 1 };
        c.frame();
        c.frame();
        expect(prompts.map((p) => p?.text)).toEqual(['E · Open drawer']);
        s.state['drawer'] = { open: true };
        c.frame();
        s.hit = { id: 'plain', distance: 1 };
        c.frame();
        expect(prompts.map((p) => p?.text ?? null)).toEqual(['E · Open drawer', 'E · Close drawer', null]);
    });
    it('use acts on the aimed entity only, and only within reach', () => {
        const { c, s } = controller();
        s.hit = { id: 'cabinet', distance: 2 };
        expect(c.use()).toBe(false);
        s.hit = { id: 'cabinet', distance: 1 };
        expect(c.use()).toBe(true);
        expect(s.used).toEqual(['cabinet']);
        s.hit = null;
        expect(c.use()).toBe(false);
        s.hit = { id: 'plain', distance: 1 };
        expect(c.use()).toBe(false);
        expect(s.used).toEqual(['cabinet']);
    });
    it('finds a drawer whose front sits inside the cabinet collider that the ray reaches first', () => {
        const { c, s, prompts } = controller();
        s.hit = { id: 'plain', distance: 0.5 };
        s.behind = [{ id: 'drawer', distance: 0.55 }];
        c.frame();
        expect(prompts.at(-1)?.text).toBe('E · Open drawer');
        expect(c.use()).toBe(true);
        expect(s.used).toEqual(['drawer']);
        // A cabinet far behind a wall does not count.
        s.used.length = 0;
        s.behind = [{ id: 'drawer', distance: 1.3 }];
        c.frame();
        expect(prompts.at(-1)).toBeNull();
        expect(c.use()).toBe(false);
    });
    it('picks up a dynamic prop, carries it toward the hold point and throws it on click', () => {
        const { c, s, sounds } = controller();
        s.hit = { id: 'mug', distance: 1 };
        expect(c.use()).toBe(true);
        expect(c.carrying).toBe('mug');
        expect(s.used).toEqual([]);
        c.frame();
        const carry = s.velocities.at(-1);
        expect(carry?.id).toBe('mug');
        expect(carry?.v[2]).toBeGreaterThan(-0.01);
        expect(c.throwCarried()).toBe(true);
        expect(c.carrying).toBeNull();
        const thrown = s.velocities.at(-1);
        expect(thrown?.v[2]).toBeCloseTo(THROW_SPEED, 3);
        expect(sounds).toEqual(['pickup', 'whoosh']);
        expect(c.throwCarried()).toBe(false);
    });
    it('E again drops a carried prop and static props are too heavy', () => {
        const { c, s, toasts } = controller();
        s.hit = { id: 'mug', distance: 1 };
        c.use();
        expect(c.use()).toBe(true);
        expect(c.carrying).toBeNull();
        s.hit = { id: 'statue', distance: 1 };
        expect(c.use()).toBe(true);
        expect(c.carrying).toBeNull();
        expect(toasts).toEqual(['Too heavy to lift']);
    });
    it('lets go of a prop that is left far behind', () => {
        const { c, s } = controller();
        s.hit = { id: 'mug', distance: 1 };
        c.use();
        s.positions.set('mug', [0, 1.5, 9]);
        c.frame();
        expect(c.carrying).toBeNull();
    });
    it('dispose clears the prompt and ignores later input', () => {
        const { c, s, prompts } = controller();
        s.hit = { id: 'drawer', distance: 1 };
        c.frame();
        c.dispose();
        expect(prompts.at(-1)).toBeNull();
        expect(c.use()).toBe(false);
    });
});
describe('sitting', () => {
    it('seat poses put the feet on the seat surface, face out of the front and stand up in front', () => {
        const pose = seatPose('sofa', [2, 0, 3], 0, [2.2, 0, 4.5], 2.2);
        expect(pose?.feet[1]).toBeCloseTo(0.42, 5);
        expect(pose?.yawDeg).toBeCloseTo(180, 5);
        expect(pose?.stand[2]).toBeGreaterThan(3.5);
        expect(pose?.stand[1]).toBeCloseTo(0.02, 5);
        expect(pose?.eye).toBe(SEATED_EYE);
        // A sofa seats the player where they came from, clamped to the cushions.
        const left = seatPose('sofa', [0, 0, 0], 0, [-5, 0, 1], 2.2);
        const right = seatPose('sofa', [0, 0, 0], 0, [5, 0, 1], 2.2);
        expect(Math.abs((left?.feet[0] ?? 0) - (right?.feet[0] ?? 0))).toBeGreaterThan(1);
        expect(Math.abs(left?.feet[0] ?? 9)).toBeLessThanOrEqual(0.71);
        // A chair is centred; a turned piece turns the pose.
        const chair = seatPose('chair', [1, 0, 1], 90, [5, 0, 5]);
        expect(chair?.feet[0]).toBeCloseTo(1 + Math.sin(Math.PI / 2) * 0.02, 5);
        expect(chair?.stand[0]).toBeGreaterThan(1.5);
        expect(seatPose('dining-table', [0, 0, 0], 0, [0, 0, 0])).toBeNull();
        expect(seatPose('sofa', [Number.NaN, 0, 0], 0, [0, 0, 0])).toBeNull();
    });
    it('use on a seat sits, the prompt then offers standing up, and use stands', () => {
        const { c, s, prompts, toasts } = controller();
        s.hit = { id: 'sofa', distance: 1 };
        c.frame();
        expect(prompts.at(-1)?.text).toBe('E · Sit on sofa');
        expect(c.use()).toBe(true);
        expect(s.sat).toEqual(['sofa']);
        expect(s.used).toEqual([]);
        c.frame();
        expect(prompts.at(-1)?.text).toBe('E · Stand up');
        expect(c.use()).toBe(true);
        expect(s.sitting).toBe(false);
        expect(toasts).toEqual([]);
    });
});
