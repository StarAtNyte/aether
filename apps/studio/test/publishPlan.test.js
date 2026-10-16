import { describe, expect, it } from 'vitest';
import { escapeXml, planDrawing, planSvg, planText } from '../src/publish/floorplan';
import { pdfString, planPdf } from '../src/publish/pdf';
const plan = {
    building: 'villa',
    level: 0,
    levelName: 'Ground floor',
    height: 3,
    rooms: [
        { id: 'r1', name: 'Living <room> & "kitchen"', kind: 'living', polygon: [[0, 0], [6, 0], [6, 4], [0, 4]], area: 24, label: [3, 2] },
        { id: 'r2', name: 'Bedroom', kind: 'bedroom', polygon: [[6, 0], [10, 0], [10, 4], [6, 4]], area: 16, label: [8, 2] },
    ],
    walls: [{ id: 'w1', exterior: true, pieces: [[[0, -0.1], [10, -0.1], [10, 0.1], [0, 0.1]]] }],
    doors: [{ id: 'd1', a: [6, 1], b: [6, 2], kind: 'swing', hinge: [6, 1], open: [7, 1], closed: [6, 2] }, { id: 'd2', a: [2, 4], b: [3, 4], kind: 'sliding' }],
    windows: [{ id: 'win', a: [1, 0], b: [3, 0], thickness: 0.2 }],
    items: [{ id: 'sofa', kind: 'sofa', polygon: [[1, 1], [3, 1], [3, 2], [1, 2]] }],
    stairs: [{ id: 's', outline: [[8, 3], [9, 3], [9, 4], [8, 4]], treads: [[[8, 3.5], [9, 3.5]]], arrow: [[8.5, 3.1], [8.5, 3.9]] }],
    dimensions: [{ a: [0, 0], b: [10, 0], normal: [0, -1], label: '10.00 m' }],
    bounds: [0, -0.1, 10, 4],
};
describe('floor plan export', () => {
    it('draws rooms, walls, doors, windows, stairs, labels, dimensions and a title block', () => {
        const d = planDrawing(plan, { title: 'Villa <script>' });
        expect(d.items.filter((p) => p.k === 'arc')).toHaveLength(1);
        const texts = d.items.filter((p) => p.k === 'text').map((p) => (p.k === 'text' ? p.text : ''));
        expect(texts).toContain('Bedroom');
        expect(texts).toContain('16 m²');
        expect(texts).toContain('10.00 m');
        expect(texts).toContain('N');
        expect(d.sheet[0]).toBeLessThan(0);
        expect(d.sheet[3]).toBeGreaterThan(4);
    });
    it('writes a standalone SVG at print scale with every text escaped', () => {
        const svg = planSvg(planDrawing(plan, { title: 'Villa <script>alert(1)</script>' }));
        expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
        expect(svg).toMatch(/width="[\d.]+mm"/);
        expect(svg).not.toContain('<script>');
        expect(svg).toContain('&lt;script&gt;');
        expect(svg).toContain('Living &lt;room&gt; &amp; &quot;kitchen&quot;');
        expect(svg.match(/<polygon/g)?.length).toBeGreaterThan(5);
        expect(svg).toContain(' A');
        expect(svg.trim().endsWith('</svg>')).toBe(true);
    });
    it('writes a PDF whose cross-reference table points at every object', () => {
        const pdf = planPdf(planDrawing(plan, { title: 'Villa (ground) \\ test' }));
        const text = String.fromCharCode(...pdf);
        expect(text.startsWith('%PDF-1.4')).toBe(true);
        expect(text.trim().endsWith('%%EOF')).toBe(true);
        const startxref = Number(/startxref\n(\d+)/.exec(text)?.[1]);
        expect(text.slice(startxref, startxref + 4)).toBe('xref');
        const entries = [...text.slice(startxref).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
        expect(entries).toHaveLength(7);
        entries.forEach((off, i) => expect(text.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
        const len = Number(/\/Length (\d+) >>\nstream\n/.exec(text)?.[1]);
        const s = text.indexOf('stream\n') + 7;
        expect(text.slice(s + len, s + len + 10)).toBe('\nendstream');
        expect(text).toContain('/BaseFont /Helvetica');
        expect(text).toContain('(Villa \\(ground\\) \\\\ test)');
    });
    it('encodes PDF strings in WinAnsi and cleans labels', () => {
        expect(pdfString('m²')).toBe('(m\\262)');
        expect(pdfString('日本')).toBe('(??)');
        expect(planText('a‮b\u0000c')).toBe('a b c');
        expect(escapeXml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    });
});
