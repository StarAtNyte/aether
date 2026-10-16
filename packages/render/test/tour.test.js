import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { CameraTour, tourKeys } from '../src/view/tour';
import { CameraRig } from '../src/view/camera-rig';
import { describeSites, probeAllocations } from '../../../tests/unit/alloc-probe';
const from = { pos: [30, 20, 40], target: [0, 1, 0] };
describe('camera tour', () => {
    it('loops around the content from and back to the current pose, above the floor', () => {
        const keys = tourKeys(from, [0, 0, 0], 20, [[5, 2, 5]], 1);
        expect(keys[0]).toBe(from);
        expect(keys[keys.length - 1].pos).toEqual(from.pos);
        for (const k of keys)
            expect(k.pos[1]).toBeGreaterThanOrEqual(1);
        // Low passes look at the focus point.
        expect(keys.some((k) => k.target[0] === 5 && k.target[2] === 5)).toBe(true);
        // Keys circle the centre: their bearings cover more than half a turn.
        const bearings = keys.map((k) => Math.atan2(k.pos[0], k.pos[2]));
        expect(Math.max(...bearings) - Math.min(...bearings)).toBeGreaterThan(Math.PI);
    });
    it('plays smoothly from start to end and then stops', () => {
        const tour = new CameraTour(tourKeys(from, [0, 0, 0], 20), 10);
        const cam = new PerspectiveCamera();
        const target = new Vector3();
        let steps = 0;
        let prev = cam.position.clone();
        let maxJump = 0;
        while (tour.update(1 / 30, cam, target, 0.5)) {
            if (steps > 0)
                maxJump = Math.max(maxJump, cam.position.distanceTo(prev));
            prev = cam.position.clone();
            steps++;
        }
        expect(steps).toBeGreaterThanOrEqual(300);
        expect(steps).toBeLessThanOrEqual(301);
        expect(tour.active).toBe(false);
        expect(cam.position.distanceTo(new Vector3(...from.pos))).toBeLessThan(1e-3);
        expect(maxJump).toBeLessThan(2);
    });
    it('is stopped by camera commands on the rig and allocates nothing per frame', async () => {
        const cam = new PerspectiveCamera();
        const rig = new CameraRig(cam, null);
        rig.startTour(new CameraTour(tourKeys(from, [0, 0, 0], 20), 1000));
        expect(rig.touring).toBe(true);
        expect(rig.update(0.016)).toBe(true);
        const r = await probeAllocations(() => rig.update(0.016), { iterations: 300, warmup: 20_000, match: /packages\/render\/src\// });
        expect(r.bytesPerIteration, describeSites(r)).toBeLessThan(16);
        rig.flyTo(new Vector3(1, 2, 3), new Vector3(), 0);
        expect(rig.touring).toBe(false);
        rig.startTour(new CameraTour(tourKeys(from, [0, 0, 0], 20), 1000));
        rig.setMode('orbit', null);
        expect(rig.touring).toBe(false);
    });
});
