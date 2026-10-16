import { describe, expect, it } from 'vitest';
import { FURNITURE, resolveSpec } from '../src/furniture/index';
import { FURNITURE_SLOTS, findSlot, slotNames, slotPatch } from '../src/furniture/slots';
describe('furniture material slots', () => {
    it('every slot points at real generator params', () => {
        for (const [kind, table] of Object.entries(FURNITURE_SLOTS)) {
            const def = FURNITURE.find((f) => f.kind === kind);
            expect(def, `kind ${kind}`).toBeDefined();
            for (const [slot, s] of Object.entries(table)) {
                if (s.finish)
                    expect(def?.params[s.finish]?.type, `${kind}.${slot}.finish`).toBe('enum');
                if (s.color)
                    expect(def?.params[s.color]?.type, `${kind}.${slot}.color`).toBe('color');
                expect(s.finish || s.color, `${kind}.${slot} is editable`).toBeTruthy();
            }
        }
    });
    it('every piece with a material or colour param has at least one slot', () => {
        for (const f of FURNITURE) {
            const editable = Object.entries(f.params).some(([k, v]) => v.type === 'color' || (v.type === 'enum' && /finish|wood|top|body|legs|base|frame|seat|upholstery|front|worktop|pot|stone|splashback/.test(k)));
            if (editable)
                expect(slotNames(f.kind).length, f.kind).toBeGreaterThan(0);
        }
    });
    it('resolves words to slots', () => {
        expect(findSlot('sofa', 'cover')).toBe('upholstery');
        expect(findSlot('sofa', 'feet')).toBe('legs');
        expect(findSlot('kitchen', 'countertop')).toBe('worktop');
        expect(findSlot('sofa', 'nonsense')).toBeUndefined();
    });
    it('turns a slot edit into the minimal valid param override', () => {
        const p = slotPatch('sofa', 'upholstery', { finish: 'velvet', color: '#2f5d46' });
        expect(p.params).toEqual({ upholstery: 'velvet', color: '#2f5d46' });
        expect(p.dropped).toEqual([]);
        const bad = slotPatch('sofa', 'legs', { finish: 'velvet' });
        expect(bad.params).toEqual({});
        expect(bad.dropped[0]).toContain('cannot be velvet');
        const nocolor = slotPatch('sofa', 'legs', { color: '#ff0000' });
        expect(nocolor.dropped[0]).toContain('cannot be recoloured');
        const sofa = FURNITURE.find((f) => f.kind === 'sofa');
        expect(resolveSpec(sofa.params, p.params)['upholstery']).toBe('velvet');
    });
});
