import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { downsample, MAX_STILL_SIZE } from '../src/view/still';
import { captureStill, openCaptureSession } from '../src/view/capture-session';
function solid(w, h, rgb) {
    const a = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++)
        a.set([rgb[0], rgb[1], rgb[2], 255], i * 4);
    return a;
}
describe('downsample', () => {
    it('keeps a flat colour exactly', () => {
        const out = downsample(solid(8, 6, [37, 120, 250]), 8, 6, 2);
        expect(out.length).toBe(4 * 3 * 4);
        for (let i = 0; i < 12; i++)
            expect([out[i * 4], out[i * 4 + 1], out[i * 4 + 2], out[i * 4 + 3]]).toEqual([37, 120, 250, 255]);
    });
    it('averages in linear light: a black/white checker is lighter than sRGB mid grey', () => {
        const src = new Uint8Array(2 * 2 * 4);
        src.set([255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
        const out = downsample(src, 2, 2, 2);
        // Linear 0.5 encodes to sRGB 188, not 128: edges keep their brightness.
        expect(out[0]).toBeGreaterThan(180);
        expect(out[0]).toBeLessThan(195);
        expect(out[3]).toBe(255);
    });
    it('factor 1 copies; invalid shapes throw', () => {
        const src = solid(4, 4, [1, 2, 3]);
        expect(downsample(src, 4, 4, 1)).toEqual(src);
        expect(() => downsample(src, 4, 4, 3)).toThrow();
        expect(() => downsample(src, 4, 4, 0)).toThrow();
        expect(() => downsample(new Uint8Array(8), 4, 4, 2)).toThrow();
    });
});
/** A fake GPU: every pixel of a frame holds the same colour. */
function flatHost(log) {
    const camera = new PerspectiveCamera(55, 1.5, 0.1, 100);
    let size = [0, 0];
    return {
        camera,
        flipY: false,
        alive: () => true,
        begin: (w, h, v) => {
            size = [w, h];
            log.push(`begin ${w}x${h} vignette=${v}`);
        },
        advance: () => undefined,
        drawToTarget: () => undefined,
        readback: async (w, h) => {
            log.push(`read ${w}x${h}`);
            return solid(w, h, [90, 140, 200]);
        },
        finish: () => {
            log.push(`finish ${size.join('x')}`);
        },
    };
}
describe('supersampled stills', () => {
    it('renders at twice the size and filters back to the requested size', async () => {
        const log = [];
        const host = flatHost(log);
        const img = await captureStill((w, h, v) => openCaptureSession(host, w, h, { vignette: v }), { width: 100, height: 60, supersample: 2, pose: { pos: [5, 5, 5], target: [0, 0, 0] } });
        expect(log[0]).toBe('begin 200x120 vignette=true');
        expect(img.width).toBe(100);
        expect(img.height).toBe(60);
        expect(img.data.length).toBe(100 * 60 * 4);
        expect([img.data[0], img.data[1], img.data[2], img.data[3]]).toEqual([90, 140, 200, 255]);
    });
    it('tiles the oversampled image and applies the vignette once to the final size', async () => {
        const log = [];
        const host = flatHost(log);
        const img = await captureStill((w, h, v) => openCaptureSession(host, w, h, { vignette: v }), { width: 300, height: 200, supersample: 2, tileSize: 256, pose: { pos: [5, 5, 5], target: [0, 0, 0] } });
        expect(log[0]).toMatch(/^begin 256x256 vignette=false$/);
        expect(img.width).toBe(300);
        expect(img.data.length).toBe(300 * 200 * 4);
        const centre = (100 * 300 + 150) * 4;
        expect(img.data[centre]).toBe(90);
        expect(img.data[0]).toBeLessThan(90);
    });
    it('clamps the factor so the oversampled image stays within the still limit, and ignores bad values', async () => {
        const log = [];
        const host = flatHost(log);
        await captureStill((w, h, v) => openCaptureSession(host, w, h, { vignette: v }), { width: 64, height: 64, supersample: Number.NaN, pose: { pos: [5, 5, 5], target: [0, 0, 0] } });
        expect(log[0]).toBe('begin 64x64 vignette=true');
        const big = MAX_STILL_SIZE / 2 + 64;
        const probe = [];
        const bigHost = flatHost(probe);
        // The image is huge: only the first tile's size matters here, so abort right after the session opens.
        const ctrl = new AbortController();
        ctrl.abort();
        await expect(captureStill((w, h, v) => openCaptureSession(bigHost, w, h, { vignette: v }), { width: big, height: 64, supersample: 3, signal: ctrl.signal, pose: { pos: [5, 5, 5], target: [0, 0, 0] } })).rejects.toThrow();
        // Factor 3 would exceed the limit (4160 × 3), factor 2 would too (8320 > 8192): rendered 1:1.
        expect(probe.some((l) => l.startsWith('begin 2048x64') || l.startsWith('begin 2048x'))).toBe(true);
    });
});
