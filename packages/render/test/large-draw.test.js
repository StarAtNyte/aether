import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { captureStill, openCaptureSession } from '../src/view/capture-session';
/** A fake GPU: every pixel of a frame is the same colour. */
function host(log) {
    return {
        camera: new PerspectiveCamera(55, 1.5, 0.1, 100),
        flipY: false,
        alive: () => true,
        begin: (w, h, v) => log.push(`begin ${w}x${h} vignette=${v}`),
        advance: () => undefined,
        drawToTarget: () => undefined,
        readback: async (w, h) => {
            log.push(`read ${w}x${h}`);
            return new Uint8Array(w * h * 4).fill(120);
        },
        finish: () => undefined,
    };
}
describe('large single draws', () => {
    it('draws a still in one piece when the requested tile size covers it (regression: a 4096 request was clamped to 2048 and tiled, leaving seams in the bloom)', async () => {
        const log = [];
        const h = host(log);
        const img = await captureStill((w, hh, v) => openCaptureSession(h, w, hh, { vignette: v }), { width: 3000, height: 1700, tileSize: 4096, pose: { pos: [5, 5, 5], target: [0, 0, 0] } });
        expect(log[0]).toBe('begin 3000x1700 vignette=true');
        expect(log.filter((l) => l.startsWith('read'))).toHaveLength(1);
        expect(img.width).toBe(3000);
        expect(img.height).toBe(1700);
    });
    it('never draws larger than the session limit even when asked to', async () => {
        const log = [];
        const h = host(log);
        await captureStill((w, hh, v) => openCaptureSession(h, w, hh, { vignette: v }), { width: 5000, height: 300, tileSize: 100_000, pose: { pos: [5, 5, 5], target: [0, 0, 0] } });
        const begin = /begin (\d+)x(\d+)/.exec(log[0] ?? '');
        expect(Number(begin?.[1])).toBeLessThanOrEqual(4096);
        expect(log.filter((l) => l.startsWith('read')).length).toBeGreaterThan(1);
    });
});
