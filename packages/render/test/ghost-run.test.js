import { describe, expect, it } from 'vitest';
import { GhostRun, ghostPoseAt, validGhostTrace } from '../src/view/ghost-run';
function trace() {
    // 0 s: (0,0,0) facing 350°; 1 s: (10,2,0) facing 10°; 2 s: (10,2,10) facing 90°.
    return {
        dt: 1,
        frames: 3,
        poses: new Float32Array([0, 0, 0, 350, 10, 2, 0, 10, 10, 2, 10, 90]),
        events: [
            { t: 1, kind: 'pickup', label: 'coin', position: [10, 2, 0] },
            { t: 2, kind: 'win', label: 'win', position: [10, 2, 10] },
            { t: 0, kind: 'start', label: 'start', position: [0, 0, 0] },
        ],
    };
}
describe('ghost run', () => {
    it('interpolates the pose and turns the short way round', () => {
        const t = trace();
        expect(ghostPoseAt(t, 0.5).map((v) => Math.round(v * 100) / 100)).toEqual([5, 1, 0, 360]);
        const end = ghostPoseAt(t, 99);
        expect(end.slice(0, 3)).toEqual([10, 2, 10]);
        expect(ghostPoseAt(t, -3).slice(0, 3)).toEqual([0, 0, 0]);
    });
    it('rejects malformed traces', () => {
        expect(validGhostTrace(trace())).toBe(true);
        expect(validGhostTrace({ ...trace(), frames: 1 })).toBe(false);
        expect(validGhostTrace({ ...trace(), poses: new Float32Array(5) })).toBe(false);
        expect(validGhostTrace({ ...trace(), dt: 0 })).toBe(false);
        expect(validGhostTrace(null)).toBe(false);
    });
    it('plays, pauses, seeks, changes speed and reports the end once', () => {
        const g = new GhostRun();
        let ended = 0;
        expect(g.start({ ...trace(), poses: new Float32Array(2) })).toBe(false);
        expect(g.active).toBe(false);
        expect(g.start(trace(), { onEnd: () => ended++ })).toBe(true);
        expect(g.active).toBe(true);
        expect(g.length).toBe(2);
        expect(g.update(0.5)).toBe(true);
        expect(g.time).toBeCloseTo(0.5);
        g.pause();
        expect(g.update(1)).toBe(false);
        expect(g.time).toBeCloseTo(0.5);
        g.seek(1.5);
        expect(g.position()).toEqual([10, 2, 5]);
        g.setSpeed(4);
        g.play();
        expect(g.update(1)).toBe(true);
        expect(g.time).toBe(2);
        expect(g.playing).toBe(false);
        expect(ended).toBe(1);
        // Playing again restarts from the beginning, and the end fires only once per run.
        g.play();
        expect(g.time).toBe(0);
        g.update(10);
        expect(ended).toBe(1);
        g.stop();
        expect(g.active).toBe(false);
        expect(g.position()).toBeNull();
        g.dispose();
    });
    it('follows live positions while the bot is still playing, then hands over to the recording', () => {
        const g = new GhostRun();
        expect(g.active).toBe(false);
        g.live(1, 0, 1);
        expect(g.active).toBe(true);
        expect(g.group.visible).toBe(true);
        expect(g.position()).toBeNull(); // no recording yet
        g.live(5, 0, 1);
        for (let i = 0; i < 40; i++)
            g.update(1 / 60);
        const figure = g.group.children[0];
        expect(figure.position.x).toBeGreaterThan(4.5);
        g.live(Number.NaN, 0, 0); // ignored
        expect(g.start(trace(), { autoplay: false })).toBe(true);
        g.live(9, 9, 9); // ignored while a recording is shown
        expect(g.position()).toEqual([0, 0, 0]);
        g.stop();
        g.live(2, 0, 2);
        g.stopLive();
        expect(g.active).toBe(false);
        expect(g.group.visible).toBe(false);
        g.dispose();
    });
    it('marks pickups on the route but not the start', () => {
        const g = new GhostRun();
        g.start(trace(), { autoplay: false });
        // two markers (pickup, win); the start event is not marked
        const markers = g.group.children.filter((c) => c.isMesh && c !== g.group.children[0]);
        expect(markers.length).toBe(2);
        g.dispose();
    });
});
