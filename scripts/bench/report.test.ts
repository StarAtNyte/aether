import { describe, expect, it } from 'vitest';
import { RESULTS_END, RESULTS_START, compactJson, spliceResults } from './report';

describe('spliceResults', () => {
  it('replaces only the generated section and keeps the prose around it', () => {
    const doc = `intro\n\n${RESULTS_START}\nold numbers\n${RESULTS_END}\n\noutro\n`;
    const out = spliceResults(doc, 'new numbers\n');
    expect(out).toContain('intro');
    expect(out).toContain('outro');
    expect(out).toContain(`${RESULTS_START}\nnew numbers\n${RESULTS_END}`);
    expect(out).not.toContain('old numbers');
  });

  it('is idempotent', () => {
    const doc = `a\n${RESULTS_START}\nx\n${RESULTS_END}\nb\n`;
    const once = spliceResults(doc, 'y');
    expect(spliceResults(once, 'y')).toBe(once);
  });

  it('appends the section when the markers are missing', () => {
    const out = spliceResults('just prose\n', 'numbers');
    expect(out.startsWith('just prose')).toBe(true);
    expect(out).toContain(`${RESULTS_START}\nnumbers\n${RESULTS_END}`);
  });
});

describe('compactJson', () => {
  it('is valid JSON that round-trips', () => {
    const value = { a: 1, b: [{ x: 1, y: [1, 2] }, { x: 2 }], c: { d: { e: [1, { f: 2 }] } }, g: null, h: 'text "quoted"', i: [] as number[], j: {} };
    expect(JSON.parse(compactJson(value))).toEqual(value);
  });

  it('puts every row on one line and drops undefined fields', () => {
    const text = compactJson({ rows: [{ id: 1, nested: { k: [1, 2, 3] } }, { id: 2, skip: undefined }] });
    const lines = text.split('\n');
    expect(lines.some((l) => l.includes('"id":1') && l.includes('"k":[1,2,3]'))).toBe(true);
    expect(text).not.toContain('skip');
    expect(lines.length).toBeLessThan(10);
  });
});
