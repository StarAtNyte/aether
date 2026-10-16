import { describe, expect, it } from 'vitest';
import { nextFrame, onNextFrame } from '../src/lib/frame';
/** A scheduler whose frames and timers fire only when the test says so. */
function manual(withRaf = true) {
    const frames = new Map();
    const timers = new Map();
    let id = 0;
    const s = {
        cancelled: [],
        cleared: 0,
        ...(withRaf
            ? {
                requestAnimationFrame: (cb) => {
                    frames.set(++id, cb);
                    return id;
                },
                cancelAnimationFrame: (n) => {
                    s.cancelled.push(n);
                    frames.delete(n);
                },
            }
            : {}),
        setTimeout: (cb) => {
            timers.set(++id, cb);
            return id;
        },
        clearTimeout: (n) => {
            s.cleared++;
            timers.delete(n);
        },
        frame() {
            const list = [...frames.values()];
            frames.clear();
            for (const cb of list)
                cb();
        },
        tick() {
            const list = [...timers.values()];
            timers.clear();
            for (const cb of list)
                cb();
        },
    };
    return s;
}
const settled = async (p) => {
    let done = false;
    void p.then(() => (done = true));
    await Promise.resolve();
    await Promise.resolve();
    return done;
};
describe('nextFrame', () => {
    it('resolves from the animation frame and clears the fallback timer', async () => {
        const s = manual();
        const p = nextFrame(250, s);
        expect(await settled(p)).toBe(false);
        s.frame();
        expect(await settled(p)).toBe(true);
        expect(s.cleared).toBe(1);
    });
    it('falls back to the timer when no frame comes (hidden tab) and cancels the frame request', async () => {
        const s = manual();
        const p = nextFrame(250, s);
        s.tick();
        expect(await settled(p)).toBe(true);
        expect(s.cancelled).toHaveLength(1);
        // A late frame changes nothing.
        s.frame();
        expect(await settled(p)).toBe(true);
    });
    it('works without requestAnimationFrame', async () => {
        const s = manual(false);
        const p = nextFrame(10, s);
        expect(await settled(p)).toBe(false);
        s.tick();
        expect(await settled(p)).toBe(true);
    });
});
describe('onNextFrame', () => {
    it('runs once in the next frame and can be cancelled (coalescing bursts)', () => {
        const s = manual();
        let runs = 0;
        const cancel = onNextFrame(() => runs++, s);
        cancel();
        onNextFrame(() => runs++, s);
        expect(runs).toBe(0);
        s.frame();
        expect(runs).toBe(1);
    });
    it('uses a timer without requestAnimationFrame', () => {
        const s = manual(false);
        let runs = 0;
        const cancel = onNextFrame(() => runs++, s);
        s.tick();
        expect(runs).toBe(1);
        cancel();
        const c2 = onNextFrame(() => runs++, s);
        c2();
        s.tick();
        expect(runs).toBe(1);
    });
});
