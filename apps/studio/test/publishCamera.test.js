import { describe, expect, it } from 'vitest';
import { CompiledPath, ease, newPose, parseCameraPath, presetPath, PRESET_IDS, removeKey, rescalePath, retimeKey, upsertKey } from '../src/publish/cameraPath';
import { directOffline, findSubject, parseModelPlan, parseShotScript, resolvePlan } from '../src/publish/director';
import { describeSites, probeAllocations } from '../../../tests/unit/alloc-probe';
const scene = { center: [0, 2, 0], radius: 10, camera: { pos: [12, 9, 16], target: [0, 1, 0], fov: 55 }, floorY: 0.5 };
const path = {
    v: 1,
    name: 'Test',
    duration: 4,
    easeInOut: false,
    keys: [
        { t: 0, pos: [0, 1, 10], target: [0, 1, 0], fov: 50, ease: 'linear' },
        { t: 2, pos: [10, 3, 0], target: [0, 1, 0], fov: 50, ease: 'linear' },
        { t: 4, pos: [0, 5, -10], target: [0, 2, 0], fov: 30, ease: 'linear' },
    ],
};
describe('camera paths', () => {
    it('passes exactly through every key and clamps outside the timeline', () => {
        const c = new CompiledPath(path);
        const p = newPose();
        for (const k of path.keys) {
            c.sample(k.t, p);
            expect(p.pos.map((v) => Math.round(v * 1e6) / 1e6)).toEqual(k.pos);
            expect(p.fov).toBeCloseTo(k.fov);
        }
        expect(c.sample(-5, p).pos).toEqual([0, 1, 10]);
        expect(c.sample(99, p).pos).toEqual([0, 5, -10]);
        expect(c.sample(Number.NaN, p).pos).toEqual([0, 1, 10]);
    });
    it('moves smoothly (no jumps between frames at 60 fps)', () => {
        const c = new CompiledPath({ ...path, easeInOut: true });
        const p = newPose();
        let prev = [...c.sample(0, p).pos];
        let maxStep = 0;
        for (let i = 1; i <= 240; i++) {
            const cur = c.sample((i / 240) * 4, p).pos;
            maxStep = Math.max(maxStep, Math.hypot(cur[0] - prev[0], cur[1] - prev[1], cur[2] - prev[2]));
            prev = [...cur];
        }
        expect(maxStep).toBeLessThan(0.4);
    });
    it('cut segments hold, then jump', () => {
        const c = new CompiledPath({ ...path, keys: path.keys.map((k, i) => (i === 0 ? { ...k, ease: 'cut' } : k)) });
        const p = newPose();
        expect(c.sample(1.99, p).pos).toEqual([0, 1, 10]);
        expect(c.sample(2, p).pos).toEqual([10, 3, 0]);
    });
    it('samples without allocating', async () => {
        const c = new CompiledPath(path);
        const p = newPose();
        const io = new Float64Array(1);
        const r = await probeAllocations(() => {
            io[0] = (io[0] + 0.013) % 4;
            c.sample(io[0], p);
        }, { iterations: 400, warmup: 20_000, match: /apps\/studio\/src\/publish\// });
        expect(r.bytesPerIteration, describeSites(r)).toBeLessThan(16);
    });
    it('validates untrusted paths', () => {
        expect(parseCameraPath(path)).not.toBeNull();
        expect(parseCameraPath({ ...path, keys: [] })).toBeNull();
        expect(parseCameraPath({ ...path, duration: 1e9 })).toBeNull();
        expect(parseCameraPath({ ...path, keys: [{ ...path.keys[0], pos: [0, Number.NaN, 0] }] })).toBeNull();
        const unsorted = parseCameraPath({ ...path, keys: [...path.keys].reverse() });
        expect(unsorted?.keys.map((k) => k.t)).toEqual([0, 2, 4]);
    });
    it('edits keys: upsert, remove, retime, rescale', () => {
        const added = upsertKey(path, { t: 1, pos: [1, 1, 1], target: [0, 0, 0], fov: 55, ease: 'ease' });
        expect(added.keys.map((k) => k.t)).toEqual([0, 1, 2, 4]);
        const replaced = upsertKey(added, { t: 1, pos: [2, 2, 2], target: [0, 0, 0], fov: 55, ease: 'ease' });
        expect(replaced.keys).toHaveLength(4);
        expect(replaced.keys[1]?.pos).toEqual([2, 2, 2]);
        expect(removeKey(added, 1).keys).toHaveLength(3);
        expect(removeKey({ ...path, keys: [path.keys[0]] }, 0).keys).toHaveLength(1);
        expect(retimeKey(path, 1, 3.5).keys.map((k) => k.t)).toEqual([0, 3.5, 4]);
        expect(rescalePath(path, 8).keys.map((k) => k.t)).toEqual([0, 4, 8]);
    });
    it('builds every preset as a valid path above the floor', () => {
        for (const id of PRESET_IDS) {
            const p = parseCameraPath(presetPath(id, scene));
            expect(p, id).not.toBeNull();
            if (!p)
                continue;
            expect(p.keys.length).toBeGreaterThanOrEqual(2);
            for (const k of p.keys)
                expect(k.pos[1], id).toBeGreaterThanOrEqual(scene.floorY - 1e-9);
        }
        const tt = presetPath('turntable', scene);
        const first = tt.keys[0];
        const last = tt.keys[tt.keys.length - 1];
        expect(first && last && Math.hypot(first.pos[0] - last.pos[0], first.pos[2] - last.pos[2])).toBeLessThan(1e-6);
    });
    it('eases', () => {
        expect(ease('ease', 0.5)).toBe(0.5);
        expect(ease('easeIn', 0.5)).toBe(0.25);
        expect(ease('easeOut', 0.5)).toBe(0.75);
        expect(ease('linear', 2)).toBe(1);
    });
});
const living = { name: 'Living room', aliases: ['lounge'], kind: 'room', min: [0, 0, 0], max: [8, 2.7, 5] };
const kitchen = { name: 'Kitchen', kind: 'room', min: [8, 0, 0], max: [12, 2.7, 5] };
const villa = { name: 'Villa', aliases: ['roof', 'house', 'building'], kind: 'building', min: [0, 0, 0], max: [12, 7, 10] };
const directorScene = { center: [6, 2, 5], radius: 9, floorY: 0.3, subjects: [living, kitchen, villa], camera: { pos: [20, 8, 20], target: [6, 2, 5], fov: 55 } };
describe('camera director', () => {
    it('parses "slow dolly through the living room then rise above the roof"', () => {
        const plan = parseShotScript('slow dolly through the living room then rise above the roof');
        expect(plan?.shots).toEqual([
            { move: 'dolly', subject: 'living room', speed: 'slow' },
            { move: 'rise', subject: 'roof' },
        ]);
        expect(findSubject('living room', directorScene.subjects)?.name).toBe('Living room');
        expect(findSubject('the lounge', directorScene.subjects)?.name).toBe('Living room');
        expect(findSubject('roof', directorScene.subjects)?.name).toBe('Villa');
        expect(findSubject('garage', directorScene.subjects)).toBeNull();
    });
    it('resolves the dolly inside the room at eye height and ends above the roof', () => {
        const p = directOffline('slow dolly through the living room then rise above the roof', directorScene);
        expect(p).not.toBeNull();
        if (!p)
            return;
        const c = new CompiledPath(p);
        const pose = newPose();
        // Mid-dolly: inside the room, at eye height.
        const dollyEnd = (6 * 1.6);
        c.sample(dollyEnd * 0.8, pose);
        expect(pose.pos[0]).toBeGreaterThanOrEqual(0);
        expect(pose.pos[0]).toBeLessThanOrEqual(8);
        expect(pose.pos[1]).toBeGreaterThan(1);
        expect(pose.pos[1]).toBeLessThan(2.4);
        // End: above the villa's roof, looking down at it.
        c.sample(p.duration, pose);
        expect(pose.pos[1]).toBeGreaterThan(villa.max[1]);
        expect(pose.target[1]).toBeLessThan(pose.pos[1]);
        expect(p.duration).toBeCloseTo(6 * 1.6 + 5, 3);
    });
    it('understands orbits, speeds, explicit durations and directions', () => {
        const plan = parseShotScript('orbit the kitchen twice to the left for 8 seconds; then a quick top-down view');
        expect(plan?.shots[0]).toMatchObject({ move: 'orbit', subject: 'kitchen', turns: 2, direction: 'left', seconds: 8 });
        expect(plan?.shots[1]).toMatchObject({ move: 'topdown', speed: 'fast' });
        const p = plan ? resolvePlan(plan, directorScene) : null;
        expect(p?.duration).toBeCloseTo(8 + 6 * 0.6, 3);
    });
    it('keeps decimal durations in one clause (regression: "1.5 seconds" split at the point)', () => {
        const plan = parseShotScript('slow orbit around the island for 1.5 seconds. Then a top-down view.');
        expect(plan?.shots).toHaveLength(2);
        expect(plan?.shots[0]).toMatchObject({ move: 'orbit', seconds: 1.5 });
        expect(resolvePlan({ shots: [plan?.shots[0]] }, directorScene).duration).toBeCloseTo(1.5, 5);
    });
    it('returns null for text with no camera move', () => {
        expect(parseShotScript('hello there')).toBeNull();
        expect(directOffline('', directorScene)).toBeNull();
    });
    it('accepts only valid model plans and never raw coordinates', () => {
        expect(parseModelPlan('Sure! {"shots":[{"move":"orbit","subject":"Villa","speed":"slow"}]} Enjoy')?.shots).toHaveLength(1);
        expect(parseModelPlan('{"shots":[{"move":"teleport"}]}')).toBeNull();
        expect(parseModelPlan('{"shots":[{"move":"orbit","pos":[1,2,3]}]}')?.shots[0]).toEqual({ move: 'orbit' });
        expect(parseModelPlan('no json')).toBeNull();
    });
    it('keeps every key above the floor and inside the path limits', () => {
        const p = directOffline('fly through then descend then pull back then pan right then establishing shot then hold', directorScene);
        expect(p).not.toBeNull();
        for (const k of p?.keys ?? [])
            expect(k.pos[1]).toBeGreaterThanOrEqual(directorScene.floorY);
        expect(parseCameraPath(p)).not.toBeNull();
    });
});
