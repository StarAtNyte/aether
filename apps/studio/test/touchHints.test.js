import { describe, expect, it } from 'vitest';
import { touchHint, touchHints } from '../src/lib/touchHints';
describe('touch hints (D5)', () => {
    it('turns keyboard hints into touch controls', () => {
        expect(touchHints(['WASD — move', 'Space — jump', 'Mouse — look', 'R — restart', 'Esc — editor'])).toEqual(['Left stick — move', 'Jump button — jump', 'Drag — look']);
    });
    it('never shows keyboard-only wording on a touch screen', () => {
        const all = touchHints(['W / S — paddle', 'A / D — steer', 'R — restart', 'Esc — editor', 'Shift to hurry', '1–9 — hotbar', 'Right click — place']);
        for (const h of all)
            expect(h).not.toMatch(/\b(?:WASD|Esc|Shift|R —|click)\b/);
    });
    it('maps E to the hand button and clicks to taps', () => {
        expect(touchHint('E — ring the bell')).toBe('Hand button — ring the bell');
        expect(touchHint('Click — start a machine')).toBe('Tap — start a machine');
        expect(touchHint('Drag — orbit')).toBe('Drag — orbit');
        expect(touchHint('WASD to walk')).toBe('Left stick — walk');
    });
    it('falls back to the standard three and is capped', () => {
        expect(touchHints([])).toHaveLength(3);
        expect(touchHints(['R — restart'])).toEqual(['Left stick — move', 'Jump button — jump', 'Hand button — use']);
        expect(touchHints(Array.from({ length: 20 }, (_, i) => `Drag — thing ${i}`))).toHaveLength(5);
    });
});
describe('landscape phone layout (D5)', () => {
    it('keeps the Tweak pill out of the top-right corner where the camera switch sits', async () => {
        const { readFileSync } = await import('node:fs');
        const css = readFileSync(new URL('../src/styles/editor.css', import.meta.url), 'utf8');
        const rule = /@media \(pointer: coarse\) and \(orientation: landscape\) and \(max-height: 520px\) \{[\s\S]*?\.play-tweak \{([^}]*)\}/.exec(css);
        expect(rule).not.toBeNull();
        expect(rule?.[1]).toMatch(/inset:\s*auto 0 /);
        expect(rule?.[1]).not.toMatch(/auto auto/);
    });
});
describe('offline notice layout (D1)', () => {
    it('lets the notice wrap so its example buttons sit under the text instead of squeezing it', async () => {
        const { readFileSync } = await import('node:fs');
        const css = readFileSync(new URL('../src/styles/panels.css', import.meta.url), 'utf8');
        expect(css).toMatch(/\.ev--notice \{\s*flex-wrap: wrap;/);
        expect(css).toMatch(/\.ev--notice > \.clarify__choices \{\s*flex: 1 1 100%;/);
    });
});
