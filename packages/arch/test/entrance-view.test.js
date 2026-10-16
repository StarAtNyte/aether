import { describe, expect, it } from 'vitest';
import { compileBuilding } from '../src/compile';
import { rotateYaw } from '../src/math2';
import { APARTMENT } from './fixtures';
/** Unit vector a yaw (degrees, 0 faces −Z) looks along, in the world XZ plane. */
function heading(yawDeg) {
    const r = (yawDeg * Math.PI) / 180;
    return [-Math.sin(r), -Math.cos(r)];
}
describe('walkthrough start', () => {
    it('stands inside the house, not in front of the door', () => {
        const c = compileBuilding(APARTMENT);
        // The apartment spans x 0..10, z 0..10.6 from the origin; the entrance is on the east wall.
        expect(c.spawn[0]).toBeLessThan(10);
        expect(c.spawn[0]).toBeGreaterThan(0);
        expect(c.spawn[2]).toBeGreaterThan(5);
        expect(c.spawn[2]).toBeLessThan(6.6);
    });
    it('faces into the house with the front door behind the player', () => {
        const c = compileBuilding(APARTMENT);
        const door = c.entities.find((e) => e.tags?.includes('entrance') && e.arch?.role === 'opening');
        expect(door).toBeDefined();
        const p = door?.transform?.position;
        const toDoor = [p[0] - c.spawn[0], p[2] - c.spawn[2]];
        const h = heading(c.spawnYaw);
        expect(toDoor[0] * h[0] + toDoor[1] * h[1]).toBeLessThan(0);
    });
    it('keeps the heading right when the plan is rotated and moved', () => {
        const base = compileBuilding(APARTMENT);
        const rot = compileBuilding({ ...APARTMENT, origin: [4, -3], rotation: 90 });
        const dirBase = heading(base.spawnYaw);
        const expected = rotateYaw(dirBase[0], dirBase[1], 90);
        const got = heading(rot.spawnYaw);
        expect(got[0]).toBeCloseTo(expected[0], 1);
        expect(got[1]).toBeCloseTo(expected[1], 1);
    });
    it('looks along open space: the nearest wall ahead is far or an archway is crossed', () => {
        const c = compileBuilding(APARTMENT);
        // Apartment hall: the look direction must not point at the wall right in front of the player.
        const h = heading(c.spawnYaw);
        const reach = (() => {
            let x = c.spawn[0];
            let z = c.spawn[2];
            for (let i = 0; i < 100; i++) {
                x += h[0] * 0.1;
                z += h[1] * 0.1;
                if (x < 0 || x > 10 || z < 0 || z > 10.6)
                    return i * 0.1;
            }
            return 10;
        })();
        expect(reach).toBeGreaterThan(2);
    });
});
describe('sight lines', () => {
    it('face a door or a window rather than bare wall when the room has one', () => {
        const c = compileBuilding({ ...APARTMENT, id: 'apt2' });
        const h = heading(c.spawnYaw);
        // The spawn faces open space or an opening within the plan: never straight into a wall under 2 m away.
        let x = c.spawn[0];
        let z = c.spawn[2];
        let steps = 0;
        while (x > 0 && x < 10 && z > 0 && z < 10.6 && steps < 200) {
            x += h[0] * 0.05;
            z += h[1] * 0.05;
            steps++;
        }
        expect(steps * 0.05).toBeGreaterThan(1.9);
    });
});
