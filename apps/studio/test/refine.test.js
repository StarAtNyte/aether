import { createWorld } from '@aether/core';
import { describe, expect, it } from 'vitest';
import { toEventView } from '../src/lib/chat';
import { composerPlaceholder, hasContent, refineChips } from '../src/lib/refine';
function worldWith(names) {
    return createWorld({
        entities: Object.fromEntries(names.map(([id, name]) => [id, { id, name, shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] } }])),
    });
}
describe('composer copy', () => {
    it('describes a world when there is none, refines when there is one', () => {
        expect(hasContent(createWorld())).toBe(false);
        expect(composerPlaceholder(createWorld(), [], false)).toBe('Describe a world…');
        const w = worldWith([['sofa', 'Sofa']]);
        expect(hasContent(w)).toBe(true);
        expect(composerPlaceholder(w, [], false)).toMatch(/refining/i);
    });
    it('names the selected object', () => {
        const w = worldWith([['sofa', 'Sofa']]);
        expect(composerPlaceholder(w, ['sofa'], false)).toContain('sofa');
    });
    it('says it is working while busy', () => {
        expect(composerPlaceholder(worldWith([['a', 'A']]), [], true)).toMatch(/working/i);
    });
});
describe('one-tap follow-ups', () => {
    it('act on the selection when there is one', () => {
        const w = worldWith([['sofa', 'Sofa']]);
        const chips = refineChips(w, ['sofa']);
        expect(chips.map((c) => c.prompt).join(' ')).toMatch(/make it/);
        expect(chips.length).toBeGreaterThanOrEqual(3);
    });
    it('name something in the world otherwise', () => {
        const chips = refineChips(worldWith([['lamp', 'Lamp']]), []);
        expect(chips[0]?.prompt).toBe('make the lamp red');
        expect(chips.length).toBeLessThanOrEqual(3);
    });
});
describe('chat views of small edits', () => {
    it('keeps the compact diff, notes and history position', () => {
        const v = toEventView({ type: 'edit', summary: 'Made the sofa dark green velvet', diff: [{ id: 's', subject: 'Sofa', property: 'colour', from: 'grey', to: 'dark green', fromColor: '#888888', toColor: '#1f4d36', kind: 'change' }], targets: ['s'], cosmetic: true, notes: ['a note'], ms: 0.8, local: true }, { head: 7 });
        expect(v.type).toBe('edit');
        if (v.type !== 'edit')
            return;
        expect(v.lines[0]?.text).toBe('Sofa · colour: grey → dark green');
        expect(v.lines[0]?.toColor).toBe('#1f4d36');
        expect(v.head).toBe(7);
        expect(v.local).toBe(true);
    });
    it('never stores a hostile colour', () => {
        const v = toEventView({ type: 'edit', summary: 'x', diff: [{ id: 's', subject: 'S', property: 'p', toColor: 'url(javascript:alert(1))', kind: 'change' }], targets: [], cosmetic: true, notes: [], ms: 1, local: true });
        expect(v.type === 'edit' && v.lines[0]?.toColor).toBeFalsy();
    });
    it('keeps the candidates of a question', () => {
        const v = toEventView({ type: 'clarify', text: 'Which chair?', candidates: [{ id: 'chair-1', label: 'Chair' }] });
        expect(v).toEqual({ type: 'clarify', text: 'Which chair?', candidates: [{ id: 'chair-1', label: 'Chair' }] });
    });
    it('control events are not chat lines', () => {
        expect(toEventView({ type: 'history', action: 'undo' })).toEqual({ type: 'status', text: '' });
    });
});
