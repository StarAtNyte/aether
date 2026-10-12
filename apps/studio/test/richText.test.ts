import { describe, expect, it } from 'vitest';
import { MAX_RICH_TEXT, parseInline, parseRichText } from '../src/lib/richText';

describe('parseRichText', () => {
  it('keeps HTML as literal text (never markup)', () => {
    const blocks = parseRichText('<script>alert(1)</script> and <img src=x onerror=alert(1)>');
    expect(blocks).toEqual([{ type: 'paragraph', inlines: [{ type: 'text', text: '<script>alert(1)</script> and <img src=x onerror=alert(1)>' }] }]);
  });

  it('parses fenced code with language', () => {
    const blocks = parseRichText('Here:\n```js\nconst a = "<b>";\n```\nafter');
    expect(blocks).toEqual([
      { type: 'paragraph', inlines: [{ type: 'text', text: 'Here:' }] },
      { type: 'code', lang: 'js', code: 'const a = "<b>";' },
      { type: 'paragraph', inlines: [{ type: 'text', text: 'after' }] },
    ]);
  });

  it('treats an unterminated fence as code to the end', () => {
    const blocks = parseRichText('```\nline1\nline2');
    expect(blocks).toEqual([{ type: 'code', lang: '', code: 'line1\nline2' }]);
  });

  it('parses bullet lists and numbered lists', () => {
    const blocks = parseRichText('- one\n* **two**\n3. `three`');
    expect(blocks).toEqual([
      {
        type: 'list',
        items: [[{ type: 'text', text: 'one' }], [{ type: 'bold', text: 'two' }], [{ type: 'code', text: 'three' }]],
      },
    ]);
  });

  it('splits paragraphs on blank lines and normalizes CRLF', () => {
    const blocks = parseRichText('a\r\nb\r\n\r\nc');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ type: 'paragraph', inlines: [{ type: 'text', text: 'a\nb' }] });
  });

  it('truncates very long input', () => {
    const blocks = parseRichText('x'.repeat(MAX_RICH_TEXT + 500));
    const p = blocks[0];
    expect(p?.type).toBe('paragraph');
    const text = p && p.type === 'paragraph' ? p.inlines.map((i) => i.text).join('') : '';
    expect(text.length).toBeLessThan(MAX_RICH_TEXT + 50);
    expect(text).toContain('(truncated)');
  });

  it('never throws on non-string input', () => {
    expect(() => parseRichText(undefined as unknown as string)).not.toThrow();
    expect(parseRichText(42 as unknown as string)).toEqual([{ type: 'paragraph', inlines: [{ type: 'text', text: '42' }] }]);
  });
});

describe('parseInline', () => {
  it('leaves unbalanced markers literal', () => {
    expect(parseInline('a ** b ` c')).toEqual([{ type: 'text', text: 'a ** b ` c' }]);
  });

  it('mixes bold, code and text', () => {
    expect(parseInline('**hi** `x` y')).toEqual([
      { type: 'bold', text: 'hi' },
      { type: 'text', text: ' ' },
      { type: 'code', text: 'x' },
      { type: 'text', text: ' y' },
    ]);
  });

  it('is linear-ish on adversarial input', () => {
    const t0 = performance.now();
    parseInline('**`'.repeat(20_000));
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
