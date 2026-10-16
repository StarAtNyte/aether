import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld } from '@aether/core';
import { runDesignTool } from '@aether/arch';
import { compareImages, extractPalette, isRaster, MAX_RASTER_PIXELS } from '../src/photo/score';
import { imageSize } from '../src/photo/image-size';
import { restorePatches } from '../src/photo/revert';
/** A deterministic test picture: a room-like layout (wall, floor, window, bed) with a tint. */
function picture(w, h, opts = {}) {
    const data = new Uint8ClampedArray(w * h * 4);
    let seed = 7;
    const rnd = () => {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
    };
    const tint = opts.tint ?? [1, 1, 1];
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const xx = x - (opts.shiftX ?? 0);
            let c = [150, 120, 130]; // wall
            if (y > h * 0.7)
                c = [70, 55, 60]; // floor
            if (xx > w * 0.2 && xx < w * 0.45 && y > h * 0.1 && y < h * 0.65)
                c = [240, 235, 215]; // window
            if (xx > w * 0.55 && xx < w * 0.95 && y > h * 0.62 && y < h * 0.85)
                c = [245, 242, 235]; // bed
            if (xx > w * 0.6 && xx < w * 0.72 && y > h * 0.25 && y < h * 0.4)
                c = [40, 30, 35]; // picture
            const n = (opts.noise ?? 0) * (rnd() - 0.5) * 255;
            const o = (y * w + x) * 4;
            let r = Math.max(0, Math.min(255, c[0] * tint[0] + n));
            let g = Math.max(0, Math.min(255, c[1] * tint[1] + n));
            let b = Math.max(0, Math.min(255, c[2] * tint[2] + n));
            if (opts.invert) {
                r = 255 - r;
                g = 255 - g;
                b = 255 - b;
            }
            data[o] = r;
            data[o + 1] = g;
            data[o + 2] = b;
            data[o + 3] = 255;
        }
    }
    return { width: w, height: h, data };
}
describe('photo similarity', () => {
    const photo = picture(240, 160);
    it('scores an identical picture at 1 and ignores the size of the render', () => {
        const same = compareImages(photo, picture(240, 160));
        expect(same?.overall).toBeGreaterThan(0.99);
        const small = compareImages(photo, picture(120, 80));
        expect(small?.overall).toBeGreaterThan(0.93);
    });
    it('does not penalise exposure: a darker render with the same structure still matches in structure and edges', () => {
        const dark = compareImages(photo, picture(240, 160, { tint: [0.6, 0.6, 0.6] }));
        expect(dark?.structure).toBeGreaterThan(0.9);
        expect(dark?.edges).toBeGreaterThan(0.9);
        // Colour does notice the brightness.
        expect(dark?.colour).toBeLessThan(0.95);
    });
    it('ranks a layout moved sideways below the right layout and noise below a clean render', () => {
        const right = compareImages(photo, picture(240, 160))?.overall ?? 0;
        const moved = compareImages(photo, picture(240, 160, { shiftX: 40 }))?.overall ?? 1;
        const noisy = compareImages(photo, picture(240, 160, { noise: 0.5 }))?.overall ?? 1;
        expect(moved).toBeLessThan(right - 0.1);
        expect(noisy).toBeLessThan(right - 0.05);
    });
    it('scores a colour-wrong render low on colour and an inverted one lowest overall', () => {
        const green = compareImages(photo, picture(240, 160, { tint: [0.4, 1.4, 0.4] }));
        expect(green?.colour).toBeLessThan(0.7);
        const inverted = compareImages(photo, picture(240, 160, { invert: true }));
        expect(inverted?.overall).toBeLessThan(0.5);
    });
    it('is monotonic as a layout drifts further from the photo', () => {
        const scores = [0, 10, 25, 50].map((s) => compareImages(photo, picture(240, 160, { shiftX: s }))?.overall ?? 0);
        for (let i = 1; i < scores.length; i++)
            expect(scores[i]).toBeLessThan(scores[i - 1] + 0.02);
    });
    it('refuses malformed rasters', () => {
        expect(isRaster({ width: 2, height: 2, data: new Uint8ClampedArray(3) })).toBe(false);
        expect(isRaster({ width: MAX_RASTER_PIXELS, height: 2, data: new Uint8ClampedArray(8) })).toBe(false);
        expect(compareImages(photo, { width: 0, height: 0, data: new Uint8Array(0) })).toBeNull();
        expect(isRaster(null)).toBe(false);
    });
});
describe('palette', () => {
    it('finds the dominant colours, brightness and warmth', () => {
        const p = extractPalette(picture(160, 100));
        expect(p).not.toBeNull();
        expect(p?.colours.length).toBeGreaterThanOrEqual(3);
        expect(p?.colours.every((c) => /^#[0-9a-f]{6}$/.test(c))).toBe(true);
        // Wall (150,120,130) fills most of the picture: the first colour is a mauve-grey, warmer than blue.
        expect(p?.warmth).toBeGreaterThan(0);
        expect(p?.brightness).toBeGreaterThan(0.3);
        expect(p?.brightness).toBeLessThan(0.8);
    });
    it('is cool for a blue picture and bright for a white one', () => {
        const blue = { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4).map((_, i) => (i % 4 === 2 ? 200 : i % 4 === 3 ? 255 : 30)) };
        expect(extractPalette(blue)?.warmth).toBeLessThan(0);
        const white = { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4).fill(250) };
        expect(extractPalette(white)?.brightness).toBeGreaterThan(0.95);
    });
});
describe('image size from the header', () => {
    const b64 = (bytes) => Buffer.from(bytes).toString('base64');
    it('reads a PNG', () => {
        const bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x07, 0x80, 0, 0, 0x04, 0xb0, 8, 6, 0, 0, 0];
        expect(imageSize(`data:image/png;base64,${b64(bytes)}`)).toEqual({ width: 1920, height: 1200 });
    });
    it('reads a JPEG whose frame header follows another segment', () => {
        const bytes = [0xff, 0xd8, 0xff, 0xe0, 0, 6, 1, 2, 3, 4, 0xff, 0xc0, 0, 17, 8, 0x04, 0xb0, 0x07, 0x80, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
        expect(imageSize(`data:image/jpeg;base64,${b64(bytes)}`)).toEqual({ width: 1920, height: 1200 });
    });
    it('returns null for junk', () => {
        expect(imageSize('data:image/png;base64,AAAA')).toBeNull();
        expect(imageSize('nonsense')).toBeNull();
    });
});
describe('restorePatches', () => {
    const PLAN = {
        id: 'home',
        name: 'Home',
        style: 'modern',
        levels: [{ height: 2.9, rooms: [{ id: 'bedroom', type: 'bedroom', rect: [0, 0, 4, 3.6] }], openings: [{ kind: 'door', room: 'bedroom', wall: 'south', to: 'outside', along: 2, width: 0.9, main: true }] }],
    };
    it('turns a changed room back into an earlier state: added pieces go, moved pieces return, removed pieces come back', () => {
        let w = createWorld({});
        w = applyPatches(w, runDesignTool(w, 'design_plan', { plan: PLAN }).patches).world;
        w = applyPatches(w, runDesignTool(w, 'place_items', { items: [{ kind: 'bed', room: 'bedroom', id: 'bed', wall: 'north', align: 'centre' }, { kind: 'nightstand', room: 'bedroom', id: 'ns', wall: 'north', t: 0.65 }] }).patches).world;
        const before = w;
        let after = applyPatches(w, runDesignTool(w, 'edit_items', { edits: [{ op: 'remove', ref: 'ns' }, { op: 'resize', ref: 'bed', params: { size: 'king' } }] }).patches).world;
        after = applyPatches(after, runDesignTool(after, 'place_items', { items: [{ kind: 'plant', room: 'bedroom', id: 'fern', at: [3.4, 3.0] }] }).patches).world;
        expect(Object.keys(after.entities)).not.toEqual(Object.keys(before.entities));
        const res = applyPatches(after, restorePatches(after, before));
        expect(res.errors).toEqual([]);
        expect(Object.keys(res.world.entities).sort()).toEqual(Object.keys(before.entities).sort());
        for (const id of Object.keys(before.entities))
            expect(res.world.entities[id]).toEqual(before.entities[id]);
    });
    it('is empty when nothing changed', () => {
        const w = createWorld({});
        expect(restorePatches(w, w)).toEqual([]);
    });
});
