import { afterEach, describe, expect, it } from 'vitest';
import { BlueprintMarks, BLUEPRINT_HOLD_SECONDS } from '../src/view/blueprint';
describe('blueprint marks expiry', () => {
    const real = BlueprintMarks.now;
    afterEach(() => {
        BlueprintMarks.now = real;
    });
    it('go away by wall-clock time even when slow frames advance the animation clock very little', () => {
        let t = 1000;
        BlueprintMarks.now = () => t;
        const marks = new BlueprintMarks();
        marks.show([{ min: [0, 0, 0], max: [1, 1, 1] }]);
        expect(marks.active).toBe(true);
        marks.update(0.01);
        expect(marks.active).toBe(true);
        t += (BLUEPRINT_HOLD_SECONDS + 5) * 1000;
        marks.update(0.01);
        expect(marks.active).toBe(false);
    });
});
